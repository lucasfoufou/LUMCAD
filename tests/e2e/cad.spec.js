import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readDrawingDxf } from '../../src/utils/drawingDxfReader.js';
import { start, state, command, drawLine, messageMatchesKeys } from './helpers.js';

const fixture = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nRoof\n10\n1000\n20\n2000\n11\n3000\n21\n4000\n0\nENDSEC\n0\nEOF\n';

test('DXFIN uses the file picker, converts millimetres and undoes the whole import', async ({ page }) => {
    const errors = await start(page);
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN');
    await (await chooser).setFiles({ name: 'roof.dxf', mimeType: 'application/dxf', buffer: Buffer.from(fixture) });
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
    const line = (await state(page)).document.content.entities[0];
    expect([line.x1, line.y1, line.x2, line.y2]).toEqual([1, -2, 3, -4]);
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
    await command(page, 'REDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
    expect(errors).toEqual([]);
});

test('DXFOUT produces a real metre-based file without changing history', async ({ page }) => {
    await start(page); await drawLine(page);
    const before = (await state(page)).document.content.entities;
    const download = page.waitForEvent('download'); await command(page, 'DXFOUT');
    const file = await download;
    const parsed = readDrawingDxf(await readFile(await file.path(), 'utf8'));
    expect(parsed.header.$INSUNITS).toBe('6');
    expect(parsed.entities[0].type).toBe('LINE'); expect(parsed.entities[0].end.x).toBe(10);
    expect((await state(page)).document.content.entities).toEqual(before);
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
});

test('unsupported DXF import leaves the existing drawing untouched', async ({ page }) => {
    await start(page); await drawLine(page);
    const before = (await state(page)).document.content;
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN');
    await (await chooser).setFiles({ name: 'unsupported.dxf', mimeType: 'application/dxf', buffer: Buffer.from(fixture.replace('LINE', '3DSOLID')) });
    await expect.poll(async () => messageMatchesKeys((await state(page)).editor.message, ['cad.error.cadUnsupportedObjects'])).toBe(true);
    expect((await state(page)).editor.message).toContain('3DSOLID ×1');
    expect((await state(page)).document.content).toEqual(before);
});

test('imported WIPEOUT renders as a native opaque mask and remains undoable', async ({ page }) => {
    const errors = await start(page);
    const mask = '0\nWIPEOUT\n10\n1000\n20\n2000\n11\n4000\n21\n0\n12\n0\n22\n3000\n13\n1\n23\n1\n71\n2\n14\n-0.5\n24\n-0.5\n14\n0.5\n24\n-0.5\n14\n0.25\n24\n0.5\n';
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN');
    await (await chooser).setFiles({ name: 'mask.dxf', mimeType: 'application/dxf',
        buffer: Buffer.from(fixture.replace('0\nENDSEC\n0\nEOF', `${mask}0\nENDSEC\n0\nEOF`)) });
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(2);
    const entity = (await state(page)).document.content.entities[1];
    expect(entity.type).toBe('polyline'); expect(entity.wipeout).toEqual({ frame: false });
    // The model scene omits entity wrappers; data-entity-id belongs to the
    // separate selection decoration, whose outline intentionally has no fill.
    const rendered = page.locator('.drawing-scene polygon[fill="#ffffff"]');
    await expect(rendered).toHaveCount(1);
    await expect(rendered).toHaveAttribute('fill', '#ffffff');
    await expect(rendered).toHaveAttribute('stroke', 'none');
    expect(await rendered.evaluate(node => Array.from(node.points, point => [point.x, point.y]))).toEqual([[1, -5], [5, -5], [4, -2]]);
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
    expect(errors).toEqual([]);
});

test('DXFIN SKIP imports supported objects, ignores paper space and lists what was left out', async ({ page }) => {
    await start(page);
    const extra = '0\nIMAGE\n8\nRoof\n0\nVIEWPORT\n67\n1\n8\n0\n0\nENDSEC';
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN SKIP');
    await (await chooser).setFiles({ name: 'mixed.dxf', mimeType: 'application/dxf', buffer: Buffer.from(fixture.replace('0\nENDSEC\n0\nEOF', `${extra}\n0\nEOF`)) });
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
    const { message } = (await state(page)).editor;
    expect(message).toContain('IMAGE ×1');
    expect(message).toContain('paper-space');
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
});

test('an edit made during worker conversion is preserved and refuses the stale import', async ({ page }) => {
    await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
            postMessage(...args) {
                window.__releaseCadConversion = () => super.postMessage(...args);
            }
        };
    });
    await start(page);
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN');
    await (await chooser).setFiles({ name: 'roof.dxf', mimeType: 'application/dxf', buffer: Buffer.from(fixture) });
    await expect.poll(() => page.evaluate(() => typeof window.__releaseCadConversion)).toBe('function');
    await drawLine(page);
    const edited = (await state(page)).document.content;
    await page.evaluate(() => window.__releaseCadConversion());
    await expect.poll(async () => messageMatchesKeys((await state(page)).editor.message, ['cad.error.cadContextChanged'])).toBe(true);
    expect((await state(page)).document.content).toEqual(edited);
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
});

test('large nested CAD blocks batch curve spans while retaining text, fills and painter order', async ({ page }) => {
    const errors = await start(page);
    const line = '0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1000\n21\n1000\n';
    const fill = '0\nSOLID\n8\n0\n10\n0\n20\n0\n11\n1000\n21\n0\n12\n0\n22\n1000\n13\n0\n23\n1000\n';
    const text = '0\nMTEXT\n8\n0\n10\n0\n20\n0\n40\n100\n1\nRoof\n';
    const blocks = `0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\nRoof\n10\n0\n20\n0\n${line.repeat(2000)}${fill}${line}${text}0\nENDBLK\n0\nBLOCK\n2\nNested\n10\n0\n20\n0\n0\nINSERT\n2\nRoof\n10\n0\n20\n0\n0\nENDBLK\n0\nENDSEC\n`;
    // Replace only model-space content; block records themselves must stay intact.
    const data = fixture.slice(0, fixture.indexOf('0\nSECTION\n2\nENTITIES')) + blocks
        + '0\nSECTION\n2\nENTITIES\n0\nINSERT\n2\nNested\n10\n0\n20\n0\n0\nENDSEC\n0\nEOF\n';
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN');
    await (await chooser).setFiles({ name: 'nested.dxf', mimeType: 'application/dxf', buffer: Buffer.from(data) });
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
    const scene = page.locator('svg .drawing-scene');
    await expect(scene.locator('.drawing-linework')).toHaveCount(2);
    await expect(scene.locator('text')).toHaveText('Roof');
    const order = await scene.locator('path,text').evaluateAll(nodes => nodes.map(n => n.tagName === 'text' ? 'text' : n.classList.contains('drawing-linework') ? 'linework' : 'fill'));
    expect(order).toEqual(['linework', 'fill', 'linework', 'text']);
    expect(await scene.locator('*').count()).toBeLessThan(30);
    expect(errors).toEqual([]);
});
