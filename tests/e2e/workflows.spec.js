import { test, expect } from '@playwright/test';
import { start, command, cancel, state, drawLine } from './helpers.js';

const creationCases = [
    ['LINE', ['0,0', '10,0'], 'line'],
    ['RECTANGLE', ['0,0', '10,5'], 'rectangle'],
    ['CIRCLE', ['0,0', '5'], 'circle'],
    ['ELLIPSE', ['0,0', '10,0', '5,3'], 'ellipse'],
    ['ARC', ['0,0', '5,5', '10,0'], 'arc'],
    ['POINT', ['2,3'], 'point'],
    ['XLINE', ['0,0', '10,0'], 'xline'],
    ['RAY', ['0,0', '10,0'], 'ray'],
    ['POLYGON', ['0,0', '5'], 'polygon'],
];
for (const [name, points, type] of creationCases) {
    test(`${name} creates geometry with undo and redo`, async ({ page }) => {
        const errors = await start(page);
        await command(page, name);
        for (const point of points) await command(page, point);
        await cancel(page);
        await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
        const entities = (await state(page)).document.content.entities;
        expect(entities[0].type).toBe(type);
        await command(page, 'UNDO');
        await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
        await command(page, 'REDO');
        await expect.poll(async () => (await state(page)).document.content.entities).toEqual(entities);
        expect(errors).toEqual([]);
    });
    test(`${name} cancels without creating partial geometry`, async ({ page }) => {
        await start(page);
        await command(page, name);
        if (name !== 'POINT') await command(page, '0,0');
        await cancel(page);
        expect((await state(page)).document.content.entities).toHaveLength(0);
        expect((await state(page)).editor.activeTool).toBe('select');
    });
}

for (const [name, key, value] of [['ORTHO', 'ortho', true], ['OTRACK', 'tracking', true], ['DYNMODE', 'dynamicInput', false]]) {
    test(`${name} changes drafting settings and undo restores them`, async ({ page }) => {
        await start(page);
        const before = (await state(page)).document.content.settings;
        await command(page, `${name} ${value ? '1' : '0'}`);
        expect((await state(page)).document.content.settings[key]).toBe(value);
        await command(page, 'UNDO');
        expect((await state(page)).document.content.settings).toEqual(before);
    });
}

test('line exact coordinates, selection, delete and undo through keyboard', async ({ page }) => {
    await start(page);
    await drawLine(page);
    const before = (await state(page)).document.content.entities;
    expect(before[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 });
    await command(page, 'QSELECT LOCKED NO');
    await expect.poll(async () => (await state(page)).selection.length).toBe(1);
    await command(page, 'DELETE');
    expect((await state(page)).document.content.entities).toHaveLength(0);
    await command(page, 'UNDO');
    expect((await state(page)).document.content.entities).toEqual(before);
});

for (const [name, input, added] of [['DIVIDE', '4', 3], ['MEASURE', '2', 4]]) {
    test(`${name} places points at exact distances and restores in one undo`, async ({ page }) => {
        await start(page);
        await drawLine(page);
        await command(page, 'QSELECT LOCKED NO');
        await command(page, `${name} ${input}`);
        await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(added + 1);
        const points = (await state(page)).document.content.entities.filter(e => e.type === 'point');
        expect(points.map(p => p.x)).toEqual(name === 'DIVIDE' ? [2.5, 5, 7.5] : [2, 4, 6, 8]);
        expect(points.every(p => p.y === 0)).toBe(true);
        await command(page, 'UNDO');
        expect((await state(page)).document.content.entities).toHaveLength(1);
    });
}

for (const [name, inputs, count, coordinates] of [
    ['MOVE', ['0,0', '2,3'], 1, { x1: 2, y1: 3, x2: 12, y2: 3 }],
    ['COPY', ['0,0', '2,3'], 2, { x1: 2, y1: 3, x2: 12, y2: 3 }],
    ['SCALE', ['0,0', '2'], 1, { x1: 0, y1: 0, x2: 20, y2: 0 }],
    ['ROTATE', ['0,0', '90'], 1, { x1: 0, y1: 0, x2: 0, y2: 10 }],
]) {
    test(`${name} transforms a selected line and undo preserves its identity`, async ({ page }) => {
        await start(page); await drawLine(page);
        const before = (await state(page)).document.content.entities;
        await command(page, 'QSELECT LOCKED NO');
        await command(page, name);
        for (const input of inputs) await command(page, input);
        await cancel(page);
        const after = (await state(page)).document.content.entities;
        expect(after).toHaveLength(count);
        for (const [key, value] of Object.entries(coordinates)) expect(after.at(-1)[key]).toBeCloseTo(value, 8);
        await command(page, 'UNDO');
        expect((await state(page)).document.content.entities).toEqual(before);
        await command(page, 'REDO');
        expect((await state(page)).document.content.entities).toEqual(after);
    });
}

for (const [name, points] of [
    ['PLINE 0.2 0.2', ['0,0', '10,0', '10,5', 'END']],
    ['MLINE', ['0,0', '10,0', '10,5', 'END']],
    ['SPLINE', ['0,0', '5,5', '10,0', 'DONE']],
    ['DONUT 2 4', ['5,5']],
    ['REVCLOUD RECT 0.5', ['0,0', '10,5']],
    ['TABLE 2 3', ['0,0']],
]) {
    test(`${name} completes a compound creation and restores exactly through history`, async ({ page }) => {
        await start(page);
        await command(page, name);
        for (const point of points) await command(page, point);
        await cancel(page);
        const entities = (await state(page)).document.content.entities;
        expect(entities).toHaveLength(1);
        await command(page, 'UNDO');
        expect((await state(page)).document.content.entities).toHaveLength(0);
        await command(page, 'REDO');
        expect((await state(page)).document.content.entities).toEqual(entities);
    });
}

for (const name of ['HATCH', 'SOLID', 'GRADIENT']) {
    test(`${name} fills a closed boundary and undo retains the source`, async ({ page }) => {
        await start(page);
        for (const input of ['RECTANGLE', '0,0', '10,5']) await command(page, input);
        await cancel(page);
        const before = (await state(page)).document.content.entities;
        await command(page, 'QSELECT LOCKED NO');
        await command(page, name);
        const entities = (await state(page)).document.content.entities;
        expect(entities).toHaveLength(2);
        expect(entities[1].type).toBe('hatch');
        expect(entities[1].sourceIds).toContain(before[0].id);
        await command(page, 'UNDO');
        expect((await state(page)).document.content.entities).toEqual(before);
    });
}

test('BLOCK, INSERT and EXPLODE retain native source geometry', async ({ page }) => {
    await start(page); await drawLine(page);
    await command(page, 'QSELECT LOCKED NO');
    await command(page, 'BLOCK "Test block" 0 0');
    let current = await state(page);
    expect(current.document.content.entities[0].type).toBe('blockReference');
    expect(current.document.content.blocks).toHaveLength(1);
    await command(page, 'INSERT "Test block" 20 0');
    expect((await state(page)).document.content.entities).toHaveLength(2);
    await command(page, 'QSELECT LOCKED NO');
    await command(page, 'EXPLODE');
    current = await state(page);
    expect(current.document.content.entities.every(e => e.type === 'line')).toBe(true);
    expect(current.document.content.entities.map(e => e.x1).sort((a,b) => a-b)).toEqual([0,20]);
});

test('GROUP, UNGROUP, HIDEOBJECTS and UNISOLATEOBJECTS preserve geometry', async ({ page }) => {
    await start(page); await drawLine(page);
    await command(page, 'QSELECT LOCKED NO');
    await command(page, 'GROUP "Test group"');
    expect((await state(page)).document.content.groups).toHaveLength(1);
    await command(page, 'QSELECT LOCKED NO');
    await command(page, 'UNGROUP');
    expect((await state(page)).document.content.groups).toHaveLength(0);
    const entities = (await state(page)).document.content.entities;
    await command(page, 'QSELECT LOCKED NO');
    await command(page, 'HIDEOBJECTS');
    expect((await state(page)).editor.hiddenObjectIds).toEqual([entities[0].id]);
    await command(page, 'UNISOLATEOBJECTS');
    expect((await state(page)).editor.hiddenObjectIds).toEqual([]);
    expect((await state(page)).document.content.entities).toEqual(entities);
});

test('drawing archive downloads and reopens through the actual file input', async ({ page }) => {
    await start(page); await drawLine(page);
    const before = (await state(page)).document.content.entities;
    const downloading = page.waitForEvent('download');
    await command(page, 'SAVEAS');
    const download = await downloading;
    const path = await download.path();
    await command(page, 'NEW');
    expect((await state(page)).document.content.entities).toHaveLength(0);
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'OPEN');
    await (await choosing).setFiles(path);
    await expect.poll(async () => (await state(page))?.document.content.entities).toEqual(before);
});

for (const language of ['en', 'fr']) {
    test(`pointer drawing and selection work in ${language}`, async ({ page }) => {
        await page.addInitScript(locale => localStorage.setItem('lumcad.settings.v1', JSON.stringify({ language: locale })), language);
        await start(page);
        await expect(page.getByRole('button', { name: language === 'fr' ? 'Nouveau' : 'New', exact: true })).toBeVisible();
        await command(page, 'LINE');
        const canvas = page.locator('.drawing-canvas-svg');
        const box = await canvas.boundingBox();
        await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.4 } });
        await canvas.click({ position: { x: box.width * 0.6, y: box.height * 0.4 } });
        await cancel(page);
        await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
        await canvas.click({ position: { x: box.width * 0.45, y: box.height * 0.4 } });
        await expect.poll(async () => (await state(page)).selection.length).toBe(1);
        await page.keyboard.press('Delete');
        await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
        await command(page, 'UNDO');
        expect((await state(page)).document.content.entities).toHaveLength(1);
    });
}

test('publication writes a real downloadable PDF from the front', async ({ page }) => {
    await start(page); await drawLine(page);
    await command(page, 'MVIEW');
    await command(page, '20,20');
    await command(page, '500,400');
    await cancel(page);
    expect((await state(page)).document.layouts[0].viewports).toHaveLength(1);
    await command(page, 'PDF');
    await expect(page.locator('.drawing-publish-dialog')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.locator('.drawing-publish-dialog').getByRole('button', { name: 'Save PDF…', exact: true }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/\.pdf$/);
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(await file.path());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
});
