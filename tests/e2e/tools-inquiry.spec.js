import { test, expect } from '@playwright/test';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities, clickWorld, screenPoint,
} from './helpers.js';

// Layers, selection, inquiries and views on a layered fixture. Inquiries are
// read from the probe result shown in the Measurements panel and must leave
// the drawing untouched.

const layered = document => {
    const base = withContent({ entities: [
        { id: 'w1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, layerId: 'walls' },
        { id: 'w2', type: 'line', x1: 0, y1: 5, x2: 10, y2: 5, layerId: 'walls', color: '#ff0000' },
        { id: 'r1', type: 'rectangle', x: 20, y: 0, width: 10, height: 5, layerId: 'roof' },
        { id: 'c1', type: 'circle', cx: 40, cy: 2, r: 2 },
        { id: 'pt', type: 'point', x: 50, y: 2 },
    ] })(document);
    const template = base.content.layers[0];
    const layer = (id, name, color) => ({ ...template, id, name, color });
    return { ...base, content: { ...base.content, layers: [...base.content.layers, layer('walls', 'Walls', '#ff0000'), layer('roof', 'Roof', '#0000ff')] } };
};

async function open(page) {
    await start(page);
    await openDrawing(page, layered);
    await fit(page);
    return entities(page);
}
const content = async page => (await state(page)).document.content;
const layer = async (page, name) => (await content(page)).layers.find(item => item.name === name);
const inquiry = async page => (await state(page)).editor.inquiryResult;
const W1 = { x: 3, y: 0 };
const R1 = { x: 20, y: 2 };
const C1 = { x: 40, y: 0 };

async function inquire(page, input, points = null) {
    const before = await entities(page);
    if (points) await pickEntities(page, points);
    await command(page, input);
    expect(await entities(page)).toEqual(before);
    expect((await state(page)).editor.canUndo).toBe(false);
    return inquiry(page);
}

test('SELECT activates the select tool and window selection picks enclosed objects', async ({ page }) => {
    await open(page);
    await command(page, 'LINE');
    await command(page, 'SELECT');
    expect((await state(page)).editor.activeTool).toBe('select');
    await clickWorld(page, { x: -1, y: -1 });
    await clickWorld(page, { x: 11, y: 6 });
    expect((await state(page)).selection.sort()).toEqual(['w1', 'w2']);
});

test('GROUPEDIT ADD, RENAME and REMOVE edit a named group', async ({ page }) => {
    await open(page);
    await pickEntities(page, [W1]);
    await command(page, 'GROUP "Roof"');
    await pickEntities(page, [C1]);
    await command(page, 'GROUPEDIT "Roof" ADD');
    expect((await content(page)).groups[0]).toMatchObject({ name: 'Roof', entityIds: ['w1', 'c1'] });
    await command(page, 'GROUPEDIT "Roof" RENAME "Ridge"');
    expect((await content(page)).groups[0].name).toBe('Ridge');
    // Collective selection would pick the whole group; turn it off to pick one member.
    await command(page, 'GROUPEDIT "Ridge" OFF');
    await pickEntities(page, [C1]);
    await command(page, 'GROUPEDIT "Ridge" REMOVE');
    expect((await content(page)).groups[0].entityIds).toEqual(['w1']);
});

test('ISOLATEOBJECTS hides every other object until UNISOLATEOBJECTS', async ({ page }) => {
    await open(page);
    await pickEntities(page, [W1]);
    await command(page, 'ISOLATEOBJECTS');
    expect((await state(page)).editor.hiddenObjectIds.sort()).toEqual(['c1', 'pt', 'r1', 'w2']);
    await command(page, 'UNISOLATEOBJECTS');
    expect((await state(page)).editor.hiddenObjectIds).toEqual([]);
});

test('FILTER SAVE and APPLY select the objects matching a stored predicate', async ({ page }) => {
    await open(page);
    await command(page, 'FILTER SAVE "Red" COLOR #ff0000');
    expect((await content(page)).selectionFilters.map(filter => filter.name)).toContain('Red');
    await command(page, 'FILTER APPLY "Red"');
    // Colour predicates use the effective colour: w1 is red through its layer.
    expect((await state(page)).selection.sort()).toEqual(['w1', 'w2']);
});

test('SELECTSIMILAR extends the selection to objects of the same type and layer', async ({ page }) => {
    await open(page);
    await pickEntities(page, [W1]);
    await command(page, 'SELECTSIMILAR');
    expect((await state(page)).selection.sort()).toEqual(['w1', 'w2']);
});

test('SELECTCOUNT reports the selection by type and layer', async ({ page }) => {
    await open(page);
    const result = await inquire(page, 'SELECTCOUNT', [W1, R1]);
    expect(result.rows).toEqual([{ type: 'line', layer: 'Walls', block: '', count: 1 }, { type: 'rectangle', layer: 'Roof', block: '', count: 1 }]);
});

test('COUNT ALL counts every visible object', async ({ page }) => {
    await open(page);
    const result = await inquire(page, 'COUNT ALL');
    expect(result.total).toBe(5);
});

test('COUNTAREA counts objects wholly inside a rectangle', async ({ page }) => {
    await open(page);
    const result = await inquire(page, 'COUNTAREA -1 -1 11 6');
    expect(result.occurrences.map(item => item.rootId)).toEqual(['w1', 'w2']);
});

test('COUNTLIST GROUP type lists counts without editing the drawing', async ({ page }) => {
    await open(page);
    await inquire(page, 'COUNTLIST GROUP type');
    expect((await state(page)).editor.message).toBe('5 occurrences in 4 groups (first 30 shown).\nline: 2\nrectangle: 1\ncircle: 1\npoint: 1');
});

test('COUNTTABLE LINKED inserts a query-backed table that refreshes after edits', async ({ page }) => {
    await open(page);
    await command(page, 'COUNTTABLE 0 20 LINKED GROUP type');
    const table = (await entities(page)).at(-1);
    expect(JSON.stringify(table)).toMatch(/line/);
    await pickEntities(page, [C1]);
    await command(page, 'DELETE');
    const refreshed = (await entities(page)).find(entity => entity.id === table.id);
    expect(JSON.stringify(refreshed.table)).not.toMatch(/circle/);
});

test('DATAEXTRACTION downloads the extracted objects as CSV', async ({ page }) => {
    await open(page);
    const downloading = page.waitForEvent('download');
    await command(page, 'DATAEXTRACTION CSV');
    const file = await downloading;
    const { readFile } = await import('node:fs/promises');
    const csv = await readFile(await file.path(), 'utf8');
    expect(csv).toMatch(/line/);
    expect(csv).toMatch(/rectangle/);
});

test('MEASUREGEOM DISTANCE and ANGLE report without editing', async ({ page }) => {
    await open(page);
    expect(await inquire(page, 'MEASUREGEOM DISTANCE 0 0 3 4')).toMatchObject({ distance: 5 });
    expect(await inquire(page, 'MEASUREGEOM ANGLE 0 0 1 0 0 1')).toMatchObject({ mode: 'angle', angle: 45 });
});

test('DIST reports distance and deltas between two typed points', async ({ page }) => {
    await open(page);
    expect(await inquire(page, 'DIST 0 0 3 4')).toMatchObject({ mode: 'distance', distance: 5, dx: 3, dy: 4 });
});

test('AREA reports area and perimeter of a selected rectangle', async ({ page }) => {
    await open(page);
    const result = await inquire(page, 'AREA', [R1]);
    expect(result.totalArea).toBeCloseTo(50, 9);
    expect(result.totalPerimeter).toBe(30);
});

test('ID reports the coordinates of a typed point', async ({ page }) => {
    await open(page);
    expect(await inquire(page, 'ID 2 3')).toMatchObject({ mode: 'id', x: 2, y: 3 });
});

test('LIST lists the geometry of the selected circle', async ({ page }) => {
    await open(page);
    const result = await inquire(page, 'LIST', [C1]);
    expect(result.objects).toEqual([expect.objectContaining({ id: 'c1', cx: 40, cy: 2, r: 2 })]);
});

test('STATUS reports object, layer and selection counts', async ({ page }) => {
    await open(page);
    expect(await inquire(page, 'STATUS', [W1])).toEqual({ unit: 'm', objects: 5, layers: 5, blocks: 0, selected: 1 });
});

test('MASSPROP reports area, centroid and moments', async ({ page }) => {
    await open(page);
    const [object] = (await inquire(page, 'MASSPROP', [R1])).objects;
    expect(object.centroidX).toBe(25);
    expect(object.centroidY).toBe(2.5);
    expect(object.inertiaX).toBeCloseTo(104.1667, 3);
});

test('LAYERSTATE SAVE and RESTORE bring back layer visibility', async ({ page }) => {
    await open(page);
    await command(page, 'LAYERSTATE SAVE "Plan"');
    await command(page, 'LAYER "Walls" VISIBLE OFF');
    expect((await layer(page, 'Walls')).visible).toBe(false);
    await command(page, 'LAYERSTATE RESTORE "Plan"');
    expect((await layer(page, 'Walls')).visible).toBe(true);
});

test('LAYERSTATESAVE stores a named state in the catalogue', async ({ page }) => {
    await open(page);
    await command(page, 'LAYERSTATESAVE "Second"');
    await command(page, 'LAYERSTATE LIST');
    expect((await state(page)).editor.message).toBe('Layer states: Second');
});

test('LAYISO turns off other layers and LAYUNISO restores them', async ({ page }) => {
    await open(page);
    await pickEntities(page, [W1]);
    await command(page, 'LAYISO');
    expect((await layer(page, 'Roof')).visible === false || (await layer(page, 'Roof')).locked === true).toBe(true);
    expect((await layer(page, 'Walls')).visible).toBe(true);
    await command(page, 'LAYUNISO');
    expect((await layer(page, 'Roof'))).toMatchObject({ visible: true, locked: false });
});

test('LAYWALK shows only the walked layer and END restores the state', async ({ page }) => {
    await open(page);
    await command(page, 'LAYWALK "Roof"');
    expect((await layer(page, 'Walls')).visible).toBe(false);
    expect((await layer(page, 'Roof')).visible).toBe(true);
    await command(page, 'LAYWALK END');
    expect((await layer(page, 'Walls')).visible).toBe(true);
});

test('LAYMRG merges a layer into another and removes it', async ({ page }) => {
    const before = await open(page);
    await command(page, 'LAYMRG "Roof" "Walls"');
    expect(await layer(page, 'Roof')).toBeUndefined();
    expect((await entities(page)).find(entity => entity.id === 'r1').layerId).toBe('walls');
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
});

test('LAYTRANS maps one layer onto an existing layer', async ({ page }) => {
    await open(page);
    await command(page, 'LAYTRANS "Walls" "Roof"');
    expect((await entities(page)).filter(entity => entity.layerId === 'roof').map(entity => entity.id).sort()).toEqual(['r1', 'w1', 'w2']);
});

test('LAYERFILTER filters the Layers tab by name', async ({ page }) => {
    await open(page);
    await command(page, 'LAYERFILTER Wal');
    await expect(page.getByRole('tab', { name: 'Layers', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.drawing-sidebar input').first()).toHaveValue('Wal');
    const names = await page.locator('.drawing-layer-row .drawing-layer-main input').evaluateAll(inputs => inputs.map(input => input.value));
    expect(names).toEqual(['Walls']);
});

test('LAYER LOCK ON locks a layer so its objects can no longer be moved', async ({ page }) => {
    const before = await open(page);
    await command(page, 'LAYER "Roof" LOCK ON');
    expect((await layer(page, 'Roof')).locked).toBe(true);
    await command(page, 'QSELECT TYPE rectangle');
    await command(page, 'DELETE');
    expect((await entities(page)).find(entity => entity.id === 'r1')).toEqual(before.find(entity => entity.id === 'r1'));
});

test('LAYMCUR makes the picked object layer current', async ({ page }) => {
    await open(page);
    await pickEntities(page, [W1]);
    await command(page, 'LAYMCUR');
    expect((await content(page)).activeLayerId).toBe('walls');
});

test('VIEW SAVE and RESTORE return to a saved zoom', async ({ page }) => {
    await open(page);
    await command(page, 'ZOOM 4');
    const saved = (await state(page)).editor.viewport;
    await command(page, 'VIEW SAVE "Detail"');
    await fit(page);
    expect((await state(page)).editor.viewport.width).not.toBeCloseTo(saved.width, 6);
    await command(page, 'VIEW RESTORE "Detail"');
    await expect.poll(async () => (await state(page)).editor.viewport.width).toBeCloseTo(saved.width, 6);
});

test('VIEWGO restores a named view without a history entry', async ({ page }) => {
    await open(page);
    await command(page, 'ZOOM 4');
    const saved = (await state(page)).editor.viewport;
    await command(page, 'VIEW SAVE "Detail"');
    await fit(page);
    const canUndo = (await state(page)).editor.canUndo;
    await command(page, 'VIEWGO "Detail"');
    await expect.poll(async () => (await state(page)).editor.viewport.width).toBeCloseTo(saved.width, 6);
    expect((await state(page)).editor.canUndo).toBe(canUndo);
});

test('ZOOM 2 halves the view around its centre', async ({ page }) => {
    await open(page);
    const before = (await state(page)).editor.viewport;
    await command(page, 'ZOOM 2');
    await expect.poll(async () => (await state(page)).editor.viewport.width).toBeCloseTo(before.width / 2, 6);
    expect((await state(page)).editor.viewport.x).toBeCloseTo(before.x, 6);
});

test('EXTENTS fits every visible object in the view', async ({ page }) => {
    await open(page);
    await command(page, 'ZOOM 8');
    await command(page, 'EXTENTS');
    await page.waitForTimeout(300);
    const view = (await state(page)).editor.viewport;
    expect(view.x - view.width / 2).toBeLessThanOrEqual(0);
    expect(view.x + view.width / 2).toBeGreaterThanOrEqual(50);
});

test('PAN drags the view with the pointer without a history entry', async ({ page }) => {
    await open(page);
    const before = (await state(page)).editor.viewport;
    await command(page, 'PAN');
    const from = await screenPoint(page, { x: 20, y: 2 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 100, from.y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).editor.viewport.x).toBeLessThan(before.x);
    expect((await state(page)).editor.canUndo).toBe(false);
    await cancel(page);
});

test('QUICKCALC assigns a session variable and reuses it', async ({ page }) => {
    await open(page);
    await command(page, 'QUICKCALC x=2*3');
    expect((await state(page)).editor.inputVariables).toMatchObject({ x: 6 });
    await command(page, 'QUICKCALC x+1');
    expect((await state(page)).editor.message).toBe('Calculator result: 7');
});
