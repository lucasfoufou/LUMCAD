import { test, expect } from '@playwright/test';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities, clickWorld,
    runSteps, expectUndoRedo, typeInTextEditor,
} from './helpers.js';

// Successful modification workflows on known fixtures: selection and picks
// through the canvas, exact resulting geometry, preserved IDs, undo/redo.

const geometry = withContent({ entities: [
    { id: 'h', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'v', type: 'line', x1: 5, y1: -5, x2: 5, y2: 5 },
    { id: 'wall', type: 'line', x1: 20, y1: -5, x2: 20, y2: 5 },
    { id: 'short', type: 'line', x1: 12, y1: 2, x2: 15, y2: 2 },
    { id: 'a', type: 'line', x1: 30, y1: 0, x2: 40, y2: 0 },
    { id: 'b', type: 'line', x1: 30, y1: 0, x2: 30, y2: 10 },
    { id: 'c', type: 'line', x1: 50, y1: 0, x2: 55, y2: 0 },
    { id: 'd', type: 'line', x1: 55, y1: 0, x2: 60, y2: 5 },
    { id: 'circ', type: 'circle', cx: 70, cy: 0, r: 2 },
    { id: 'rect', type: 'rectangle', x: 80, y: 0, width: 10, height: 5 },
] });

const dynamicBlock = {
    id: 'dyn', name: 'Panel', basePoint: { x: 0, y: 0 },
    entities: [{ id: 'edge', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 }],
    dynamic: { parameters: [{ name: 'Width', type: 'distance', default: 2 }],
        actions: [{ id: 'grow', targets: ['edge'], parameter: 'Width', type: 'stretch', direction: { x: 1, y: 0 }, window: { minX: 1, minY: -1, maxX: 3, maxY: 1 } }] },
};

const annotated = document => {
    const base = withContent({ entities: [
        { id: 'pl', type: 'polyline', closed: false, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }] },
        { id: 'src', type: 'line', x1: 0, y1: 20, x2: 10, y2: 20, layerId: 'red', color: '#00aa00', lineType: 'dashed' },
        { id: 'tgt', type: 'line', x1: 0, y1: 25, x2: 10, y2: 25 },
        { id: 'dup1', type: 'line', x1: 0, y1: 30, x2: 10, y2: 30 },
        { id: 'dup2', type: 'line', x1: 0, y1: 30, x2: 10, y2: 30 },
        { id: 'txt', type: 'text', x: 20, y: 0, width: 6, height: 1.5, fontSize: 1, text: 'Note', textMode: 'singleLine' },
        { id: 'box', type: 'polyline', closed: true, points: [{ x: 30, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 30, y: 10 }] },
        { id: 'over', type: 'line', x1: 25, y1: 5, x2: 45, y2: 5 },
        { id: 'panel', type: 'blockReference', blockId: 'dyn', transform: { a: 1, b: 0, c: 0, d: 1, e: 60, f: 20 }, dynamicValues: { Width: 4 } },
    ] })(document);
    const red = { ...base.content.layers[0], id: 'red', name: 'Red', color: '#ff0000' };
    return { ...base, content: { ...base.content, layers: [...base.content.layers, red], blocks: [dynamicBlock] } };
};

async function open(page, fixture = geometry) {
    await start(page);
    await openDrawing(page, fixture);
    await fit(page);
    return entities(page);
}
const byId = async (page, id) => (await entities(page)).find(entity => entity.id === id);

test('OFFSET copies a line at the given distance on the clicked side', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 2, y: 0 }]);
    const [copy] = await runSteps(page, ['OFFSET', '1', '2,3']);
    await cancel(page);
    expect(copy).toMatchObject({ type: 'line', x1: 0, y1: 1, x2: 10, y2: 1 });
    await expectUndoRedo(page, before, await entities(page));
});

test('TRIM removes the clicked portion beyond a crossing line', async ({ page }) => {
    const before = await open(page);
    await command(page, 'TRIM');
    await clickWorld(page, { x: 8, y: 0 });
    await cancel(page);
    const horizontal = (await entities(page)).filter(entity => entity.type === 'line' && entity.y1 === 0 && entity.y2 === 0 && entity.x1 < 10);
    expect(horizontal.map(line => [line.x1, line.x2])).toEqual([[0, 5]]);
    await expectUndoRedo(page, before, await entities(page));
});

test('EXTEND moves the clicked endpoint onto the nearest boundary', async ({ page }) => {
    const before = await open(page);
    await command(page, 'EXTEND');
    await clickWorld(page, { x: 14.8, y: 2 });
    await cancel(page);
    expect(await byId(page, 'short')).toMatchObject({ x1: 12, y1: 2, x2: 20, y2: 2 });
    await expectUndoRedo(page, before, await entities(page));
});

test('MIRROR keeps the source and adds a reflected copy', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    const [copy] = await runSteps(page, ['MIRROR', '70,10', '80,10', '']);
    expect(copy).toMatchObject({ type: 'circle', cx: 70, cy: 20, r: 2 });
    expect(await byId(page, 'circ')).toEqual(before.find(entity => entity.id === 'circ'));
    await expectUndoRedo(page, before, await entities(page));
});

test('ARRAY and ARRAYCLOSE build a 3 × 2 rectangular array with exact spacing', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    await runSteps(page, ['ARRAY', 'COLUMNS 3', 'ROWS 2', 'XSPACING 5', 'YSPACING 6', 'ARRAYCLOSE']);
    const array = (await entities(page)).at(-1);
    expect(array.type).toBe('polyline');
    expect(array.parts.map(part => [part.cx, part.cy])).toEqual([[70, 0], [75, 0], [80, 0], [70, 6], [75, 6], [80, 6]]);
    expect(await byId(page, 'circ')).toBeUndefined();
    await expectUndoRedo(page, before, await entities(page));
});

test('ARRAYEDIT changes the saved rows and keeps the array identity', async ({ page }) => {
    await open(page);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    await runSteps(page, ['ARRAY', 'COLUMNS 3', 'ROWS 2', 'XSPACING 5', 'YSPACING 6', 'ARRAYCLOSE']);
    const created = await entities(page);
    const array = created.at(-1);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    await runSteps(page, ['ARRAYEDIT', 'ROWS 3', 'ARRAYCLOSE']);
    const edited = (await entities(page)).at(-1);
    expect(edited.id).toBe(array.id);
    expect(edited.parts).toHaveLength(9);
    await expectUndoRedo(page, created, await entities(page));
});

test('ARRAYPOLAR places four copies around a typed centre', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 13, y: 2 }]);
    await runSteps(page, ['ARRAYPOLAR', '13,10', 'COUNT 4', 'ARRAYCLOSE']);
    const array = (await entities(page)).at(-1);
    expect(array.parts).toHaveLength(4);
    const centres = array.parts.map(part => [(part.x1 + part.x2) / 2, (part.y1 + part.y2) / 2]);
    for (const [x, y] of centres) expect(Math.hypot(x - 13, y - 10)).toBeCloseTo(Math.hypot(13.5 - 13, 2 - 10), 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('ARRAYPATH spreads three copies along a picked line', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    await command(page, 'ARRAYPATH');
    await clickWorld(page, { x: 35, y: 0 });
    await runSteps(page, ['COUNT 3', 'ARRAYCLOSE']);
    const array = (await entities(page)).at(-1);
    expect(array.parts.map(part => part.cx)).toEqual([32, 37, 42]);
    await expectUndoRedo(page, before, await entities(page));
});

test('BREAK removes the interval between two points of a line', async ({ page }) => {
    const before = await open(page);
    await command(page, 'BREAK');
    await clickWorld(page, { x: 2, y: 0 });
    await command(page, '4,0');
    const lines = (await entities(page)).filter(entity => entity.type === 'line' && entity.y1 === 0 && entity.y2 === 0 && entity.x2 <= 10);
    expect(lines.map(line => [line.x1, line.x2]).sort((a, b) => a[0] - b[0])).toEqual([[0, 2], [4, 10]]);
    await expectUndoRedo(page, before, await entities(page));
});

test('BREAKATPOINT splits a line into two touching parts', async ({ page }) => {
    const before = await open(page);
    await command(page, 'BREAKATPOINT');
    await clickWorld(page, { x: 20, y: 1 });
    const parts = (await entities(page)).filter(entity => entity.type === 'line' && entity.x1 === 20 && entity.x2 === 20);
    expect(parts).toHaveLength(2);
    const ys = parts.flatMap(part => [part.y1, part.y2]).sort((a, b) => a - b);
    expect(ys[0]).toBe(-5);
    expect(ys[3]).toBe(5);
    expect(ys[1]).toBeCloseTo(ys[2], 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('STRETCH moves only the vertices inside the crossing window', async ({ page }) => {
    const before = await open(page);
    await runSteps(page, ['STRETCH', '79,-1', '86,6', '80,0', '82,0']);
    const stretched = await byId(page, 'rect');
    const xs = (stretched.points || [{ x: stretched.x }, { x: stretched.x + stretched.width }]).map(point => point.x);
    expect(Math.min(...xs)).toBeCloseTo(82, 9);
    expect(Math.max(...xs)).toBeCloseTo(90, 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('LENGTHEN DELTA adds two metres to the picked end', async ({ page }) => {
    const before = await open(page);
    await command(page, 'LENGTHEN');
    await command(page, 'DELTA 2');
    await clickWorld(page, { x: 14.8, y: 2 });
    await cancel(page);
    expect(await byId(page, 'short')).toMatchObject({ x1: 12, y1: 2, x2: 17, y2: 2 });
    await expectUndoRedo(page, before, await entities(page));
});

test('JOIN merges two connected lines into one ordered path', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 52, y: 0 }, { x: 57, y: 2 }]);
    const [path] = await runSteps(page, ['JOIN']);
    expect(path.type).toBe('polyline');
    expect(path.parts.map(part => [part.x1, part.y1, part.x2, part.y2])).toEqual([[50, 0, 55, 0], [55, 0, 60, 5]]);
    expect(await byId(page, 'c')).toBeUndefined();
    await expectUndoRedo(page, before, await entities(page));
});

test('XPLODE splits a joined path back into lines with part properties', async ({ page }) => {
    await open(page);
    await pickEntities(page, [{ x: 52, y: 0 }, { x: 57, y: 2 }]);
    await command(page, 'JOIN');
    const joined = await entities(page);
    await pickEntities(page, [{ x: 52, y: 0 }]);
    const added = await runSteps(page, ['XPLODE', 'PARTS', '']);
    expect(added.map(entity => [entity.type, entity.x1, entity.x2])).toEqual([['line', 50, 55], ['line', 55, 60]]);
    await expectUndoRedo(page, joined, await entities(page));
});

test('ALIGN moves a circle onto destination points without scaling', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    await runSteps(page, ['ALIGN', '70,0', '0,30', '72,0', '0,32', 'NO']);
    const aligned = await byId(page, 'circ');
    expect(aligned.cx).toBeCloseTo(0, 9);
    expect(aligned.cy).toBeCloseTo(30, 9);
    expect(aligned.r).toBeCloseTo(2, 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('FILLET RADIUS 1 rounds a right-angle corner with a tangent arc', async ({ page }) => {
    const before = await open(page);
    await runSteps(page, ['FILLET', 'RADIUS 1']);
    await clickWorld(page, { x: 35, y: 0 });
    await clickWorld(page, { x: 30, y: 5 });
    const arc = (await entities(page)).find(entity => entity.type === 'arc');
    expect(arc).toMatchObject({ cx: 31, cy: 1, r: 1 });
    expect(await byId(page, 'a')).toMatchObject({ x1: 31, x2: 40 });
    expect(await byId(page, 'b')).toMatchObject({ y1: 1, y2: 10 });
    await expectUndoRedo(page, before, await entities(page));
});

test('CHAMFER 1 1 bevels a right-angle corner', async ({ page }) => {
    const before = await open(page);
    await runSteps(page, ['CHAMFER', 'DISTANCE 1 1']);
    await clickWorld(page, { x: 35, y: 0 });
    await clickWorld(page, { x: 30, y: 5 });
    const bevel = (await entities(page)).find(entity => entity.id.startsWith('chamfer'));
    expect(bevel).toMatchObject({ type: 'line', x1: 31, y1: 0, x2: 30, y2: 1 });
    await expectUndoRedo(page, before, await entities(page));
});

test('BLEND joins two open ends with a tangent cubic spline', async ({ page }) => {
    const before = await open(page);
    await command(page, 'BLEND');
    await clickWorld(page, { x: 54.5, y: 0 });
    await clickWorld(page, { x: 12.3, y: 2 });
    const blend = (await entities(page)).at(-1);
    expect(blend.type).toBe('spline');
    expect(blend.controlPoints[0]).toEqual({ x: 55, y: 0 });
    expect(blend.controlPoints.at(-1)).toEqual({ x: 12, y: 2 });
    await expectUndoRedo(page, before, await entities(page));
});

test('PEDIT INSERT adds a vertex at the requested position', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 5, y: 0 }]);
    await command(page, 'PEDIT INSERT 2 4 2');
    expect((await byId(page, 'pl')).points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 2 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
    await expectUndoRedo(page, before, await entities(page));
});

test('SPLINEDIT CONTROL moves one control point of a spline', async ({ page }) => {
    await open(page);
    await runSteps(page, ['SPLINE', '0,40', '5,45', '10,40', 'DONE']);
    await cancel(page);
    const created = await entities(page);
    await pickEntities(page, [{ x: 0, y: 40 }]);
    await command(page, 'SPLINEDIT CONTROL 1 2 3 46');
    expect((await entities(page)).at(-1).parts[0].controlPoints[1]).toEqual({ x: 3, y: 46 });
    await expectUndoRedo(page, created, await entities(page));
});

test('MLEDIT DIAMETERS resizes a donut', async ({ page }) => {
    await open(page);
    await runSteps(page, ['DONUT 2 4', '0,60']);
    await cancel(page);
    const created = await entities(page);
    await fit(page);
    // Wide linework is picked on its centreline (ring radius 1.5 m).
    await pickEntities(page, [{ x: 0, y: 58.5 }]);
    await command(page, 'MLEDIT DIAMETERS 1 3');
    const donut = (await entities(page)).at(-1);
    expect(donut.linework).toMatchObject({ kind: 'donut', innerDiameter: 1, outerDiameter: 3 });
    await expectUndoRedo(page, created, await entities(page));
});

test('HATCHEDIT changes the pattern spacing and keeps the boundary association', async ({ page }) => {
    await open(page, annotated);
    await pickEntities(page, [{ x: 35, y: 0 }]);
    await command(page, 'HATCH');
    await cancel(page);
    const created = await entities(page);
    const hatch = created.at(-1);
    await pickEntities(page, [{ x: 35, y: 2 }]);
    await command(page, 'HATCHEDIT LINES 0.5 45');
    const edited = (await entities(page)).find(entity => entity.id === hatch.id);
    expect(edited.pattern).toMatchObject({ name: 'lines', spacing: 0.5, angle: 45 });
    expect(edited.sourceIds).toEqual(hatch.sourceIds);
    await expectUndoRedo(page, created, await entities(page));
});

test('HATCHTOBACK moves every hatch behind the other objects', async ({ page }) => {
    await open(page, annotated);
    await pickEntities(page, [{ x: 35, y: 0 }]);
    await command(page, 'HATCH');
    await cancel(page);
    const created = await entities(page);
    await command(page, 'HATCHTOBACK');
    expect((await entities(page))[0].type).toBe('hatch');
    await expectUndoRedo(page, created, await entities(page));
});

test('DRAWORDER BACK moves the selected object to the start of the order', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 44, y: 5 }]);
    await command(page, 'DRAWORDER BACK');
    expect((await entities(page))[0].id).toBe('over');
    await expectUndoRedo(page, before, await entities(page));
});

test('TEXTTOFRONT brings text after every other object', async ({ page }) => {
    const before = await open(page, annotated);
    await command(page, 'TEXTTOFRONT');
    expect((await entities(page)).at(-1).id).toBe('txt');
    await expectUndoRedo(page, before, await entities(page));
});

test('TRANSPARENCY 50 sets an override on the selection', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 5, y: 25 }]);
    await command(page, 'TRANSPARENCY 50');
    expect((await byId(page, 'tgt')).transparency).toBe(50);
    await expectUndoRedo(page, before, await entities(page));
});

test('FLATTEN PREVIEW reports and FLATTEN ALL clears residual elevations', async ({ page }) => {
    const before = await open(page, withContent({ entities: [
        { id: 'raised', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, z1: 2, z2: 3 },
        { id: 'flat', type: 'line', x1: 0, y1: 5, x2: 10, y2: 5 },
    ] }));
    test.skip(before[0].z1 === undefined, 'Archive normalization already drops residual z values.');
    await command(page, 'FLATTEN PREVIEW');
    expect(await entities(page)).toEqual(before);
    await command(page, 'FLATTEN ALL');
    expect(await byId(page, 'raised')).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 });
    expect((await byId(page, 'raised')).z1 || 0).toBe(0);
    await expectUndoRedo(page, before, await entities(page));
});

test('OVERKILL ALL removes the exact duplicate and keeps the first identity', async ({ page }) => {
    const before = await open(page, annotated);
    await command(page, 'OVERKILL ALL');
    const ids = (await entities(page)).map(entity => entity.id);
    expect(ids).toContain('dup1');
    expect(ids).not.toContain('dup2');
    expect((await state(page)).editor.message).toMatch(/1 duplicates? removed/);
    await expectUndoRedo(page, before, await entities(page));
});

test('REVCLOUDPROPERTIES rebuilds a revision cloud with a new arc length and direction', async ({ page }) => {
    await open(page, annotated);
    await runSteps(page, ['REVCLOUD RECT 0.5', '50,0', '56,4']);
    await cancel(page);
    const created = await entities(page);
    const cloud = created.at(-1);
    await pickEntities(page, [{ x: 50, y: 2 }]);
    await command(page, 'REVCLOUDPROPERTIES 0.8 REVERSE');
    const rebuilt = (await entities(page)).find(entity => entity.id === cloud.id);
    expect(rebuilt.revisionSymbol).toMatchObject({ kind: 'cloud' });
    expect(JSON.stringify(rebuilt.revisionSymbol)).toMatch(/0\.8/);
    expect(rebuilt.revisionSymbol).not.toEqual(cloud.revisionSymbol);
    await expectUndoRedo(page, created, await entities(page));
});

test('MATCHPROP copies layer, colour and line type from a source object', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 5, y: 25 }]);
    await command(page, 'MATCHPROP src');
    expect(await byId(page, 'tgt')).toMatchObject({ layerId: 'red', color: '#00aa00', lineType: 'dashed' });
    await expectUndoRedo(page, before, await entities(page));
});

test('LAYMCH changes only the layer of the target', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 5, y: 25 }]);
    await command(page, 'LAYMCH src');
    const target = await byId(page, 'tgt');
    expect(target.layerId).toBe('red');
    expect(target.color).toBeUndefined();
    await expectUndoRedo(page, before, await entities(page));
});

test('COPYTOLAYER duplicates the selection in place on another layer', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 5, y: 0 }]);
    const [copy] = await runSteps(page, ['COPYTOLAYER Red']);
    expect(copy).toMatchObject({ layerId: 'red', type: 'polyline', points: before.find(entity => entity.id === 'pl').points });
    expect(copy.id).not.toBe('pl');
    await expectUndoRedo(page, before, await entities(page));
});

test('TEXTEDIT opens the in-place editor and replaces the content', async ({ page }) => {
    const before = await open(page, annotated);
    await pickEntities(page, [{ x: 22, y: 0.7 }]);
    await command(page, 'TEXTEDIT');
    await typeInTextEditor(page, ['Revised']);
    expect((await byId(page, 'txt')).text).toBe('Revised');
    await expectUndoRedo(page, before, await entities(page));
});

test('CREATIONPANEL edits the radius of a selected circle from the Properties tab', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 70, y: 2 }]);
    await command(page, 'CREATIONPANEL');
    const radius = page.locator('.drawing-sidebar').getByLabel(/^R(adius)? \(m\)$|^Radius/).first();
    await radius.fill('3.5');
    await radius.press('Enter');
    await expect.poll(async () => (await byId(page, 'circ')).r).toBe(3.5);
    await expectUndoRedo(page, before, await entities(page));
});

test('RESETBLOCK restores a dynamic block instance to its defaults', async ({ page }) => {
    const before = await open(page, annotated);
    expect((await byId(page, 'panel')).dynamicValues).toEqual({ Width: 4 });
    await pickEntities(page, [{ x: 61, y: 20 }]);
    await command(page, 'RESETBLOCK');
    const reset = await byId(page, 'panel');
    expect(reset.dynamicValues?.Width ?? 2).toBe(2);
    expect(reset.transform).toEqual(before.find(entity => entity.id === 'panel').transform);
    await expectUndoRedo(page, before, await entities(page));
});
