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

test('DXFIN SKIP imports supported objects, ignores paper space and lists what was left out', async ({ page }) => {
    await start(page);
    const extra = '0\nHATCH\n8\nRoof\n0\nVIEWPORT\n67\n1\n8\n0\n0\nENDSEC';
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN SKIP');
    await (await chooser).setFiles({ name: 'mixed.dxf', mimeType: 'application/dxf', buffer: Buffer.from(fixture.replace('0\nENDSEC\n0\nEOF', `${extra}\n0\nEOF`)) });
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
    const { message } = (await state(page)).editor;
    expect(message).toContain('HATCH ×1');
    expect(message).toContain('paper-space');
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
});
