import { test, expect } from '@playwright/test';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities,
    runSteps, expectUndoRedo, typeInTextEditor,
} from './helpers.js';

// Successful creation workflows: real command line, pointer and editor input,
// exact resulting entities, then undo/redo of the whole creation.

const sources = withContent({ entities: [
    { id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'l2', type: 'line', x1: 0, y1: 4, x2: 10, y2: 4 },
    { id: 'arc', type: 'arc', cx: 30, cy: 0, r: 5, startAngle: Math.PI, endAngle: 2 * Math.PI, counterClockwise: true },
    { id: 'c1', type: 'circle', cx: 50, cy: 0, r: 3 },
    { id: 'sq', type: 'polyline', closed: true, points: [{ x: 60, y: 0 }, { x: 70, y: 0 }, { x: 70, y: 10 }, { x: 60, y: 10 }] },
    { id: 'p1', type: 'point', x: 80, y: 0 },
] });

async function openSources(page) {
    await start(page);
    await openDrawing(page, sources);
    await fit(page);
    return entities(page);
}

test('TEXT creates a single-line label typed in the in-place editor', async ({ page }) => {
    const before = await openSources(page);
    const [text] = await runSteps(page, ['TEXT', '0,20', '6,22', page => typeInTextEditor(page, ['Roof A'])]);
    expect(text).toMatchObject({ type: 'text', x: 0, y: 20, width: 6, height: 2, text: 'Roof A', textMode: 'singleLine' });
    await cancel(page);
    await expectUndoRedo(page, before, await entities(page));
});

test('MTEXT keeps typed paragraphs on separate lines', async ({ page }) => {
    const before = await openSources(page);
    const [text] = await runSteps(page, ['MTEXT', '0,20', '8,24', page => typeInTextEditor(page, ['Line one', 'Line two'])]);
    expect(text).toMatchObject({ type: 'text', textMode: 'multiline', width: 8, height: 4, text: 'Line one\nLine two' });
    await cancel(page);
    await expectUndoRedo(page, before, await entities(page));
});

test('SKETCH records typed samples as one sampled polyline', async ({ page }) => {
    const before = await openSources(page);
    const [stroke] = await runSteps(page, ['SKETCH 0.5 POLYLINE', '0,60', '2,61', '4,60', 'END']);
    await cancel(page);
    expect(stroke.type).toBe('polyline');
    expect(stroke.points[0]).toEqual({ x: 0, y: 60 });
    expect(stroke.points.at(-1)).toEqual({ x: 4, y: 60 });
    for (const [index, point] of stroke.points.slice(1).entries()) {
        expect(Math.hypot(point.x - stroke.points[index].x, point.y - stroke.points[index].y)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
    await expectUndoRedo(page, before, await entities(page));
});

test('BREAKLINE creates an editable zigzag between two endpoints', async ({ page }) => {
    const before = await openSources(page);
    const [breakLine] = await runSteps(page, ['BREAKLINE 0.5', '0,30', '10,30']);
    expect(breakLine.revisionSymbol).toMatchObject({ kind: 'break', start: { x: 0, y: 30 }, end: { x: 10, y: 30 }, size: 0.5, extension: 0.25 });
    await expectUndoRedo(page, before, await entities(page));
});

test('MLEADER places a block-backed leader with its text at the anchor', async ({ page }) => {
    const before = await openSources(page);
    const added = await runSteps(page, ['MLEADER "Roof"', '0,40', '3,43', 'DONE', '6,43']);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: 'blockReference', transform: { e: 6, f: 43 } });
    const block = (await state(page)).document.content.blocks.find(item => item.id === added[0].blockId);
    expect(JSON.stringify(block)).toContain('Roof');
    await expectUndoRedo(page, before, await entities(page));
});

test('TOLERANCE inserts a feature control frame with datum and diameter', async ({ page }) => {
    const before = await openSources(page);
    const [frame] = await runSteps(page, ['TOLERANCE position 0.1 DIAMETER DATUM A', '0,50']);
    expect(frame.tolerance.rows).toEqual([{ symbol: 'position', values: [{ value: '0.1', diameter: true, material: '' }], datums: [{ label: 'A', material: '' }] }]);
    expect(frame.tolerance.transform).toMatchObject({ e: 0, f: 50 });
    await expectUndoRedo(page, before, await entities(page));
});

test('WIPEOUT closes a masking polygon without deleting what lies beneath', async ({ page }) => {
    const before = await openSources(page);
    const [mask] = await runSteps(page, ['WIPEOUT', '60,20', '70,20', '70,30', 'DONE']);
    expect(mask).toMatchObject({ type: 'polyline', closed: true, wipeout: { frame: true },
        points: [{ x: 60, y: 20 }, { x: 70, y: 20 }, { x: 70, y: 30 }] });
    expect((await entities(page)).slice(0, before.length)).toEqual(before);
    await expectUndoRedo(page, before, await entities(page));
});

test('REGION turns a selected closed polyline into a region and keeps the source', async ({ page }) => {
    const before = await openSources(page);
    await pickEntities(page, [{ x: 65, y: 0 }]);
    const [region] = await runSteps(page, ['REGION']);
    expect(region.type).toBe('region');
    expect(region.boundaries).toHaveLength(1);
    expect((await entities(page)).find(entity => entity.id === 'sq')).toEqual(before.find(entity => entity.id === 'sq'));
    await expectUndoRedo(page, before, await entities(page));
});

test('BOUNDARY picks inside a closed square and creates its outline', async ({ page }) => {
    const before = await openSources(page);
    const [outline] = await runSteps(page, ['BOUNDARY', '65,5']);
    await cancel(page);
    expect(outline).toMatchObject({ type: 'polyline', closed: true });
    const xs = (outline.points || outline.parts.flatMap(part => [part.x1, part.x2])).map(point => (typeof point === 'number' ? point : point.x));
    expect(Math.min(...xs)).toBeCloseTo(60, 9);
    expect(Math.max(...xs)).toBeCloseTo(70, 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('CENTERLINE creates an associative midline between two parallel lines', async ({ page }) => {
    const before = await openSources(page);
    await pickEntities(page, [{ x: 5, y: 0 }, { x: 5, y: 4 }]);
    const [centerLine] = await runSteps(page, ['CENTERLINE']);
    expect(centerLine).toMatchObject({ type: 'centerLine', sourceIds: ['l1', 'l2'], extension: 0.25 });
    await expectUndoRedo(page, before, await entities(page));
});

test('CENTERMARK marks a selected circle associatively', async ({ page }) => {
    const before = await openSources(page);
    await pickEntities(page, [{ x: 53, y: 0 }]);
    const [mark] = await runSteps(page, ['CENTERMARK']);
    expect(mark).toMatchObject({ type: 'centerMark', sourceId: 'c1', size: 0.25 });
    await expectUndoRedo(page, before, await entities(page));
});

test('ARCTEXT writes linked text along a selected arc', async ({ page }) => {
    const before = await openSources(page);
    await pickEntities(page, [{ x: 30, y: -5 }]);
    const [label] = await runSteps(page, ['ARCTEXT "Roof" HEIGHT 0.3']);
    expect(label).toMatchObject({ sourceId: 'arc', arcText: { text: 'Roof', arc: { cx: 30, cy: 0, r: 5 } } });
    await expectUndoRedo(page, before, await entities(page));
});

test('FIELD binds a text to an object length and keeps its definition', async ({ page }) => {
    await openSources(page);
    await runSteps(page, ['TEXT', '0,20', '6,22', page => typeInTextEditor(page, ['Label'])]);
    await cancel(page);
    const before = await entities(page);
    await pickEntities(page, [{ x: 3, y: 21 }]);
    await command(page, 'FIELD OBJECT l1 length');
    const text = (await entities(page)).at(-1);
    expect(text.text).toBe('10');
    await command(page, 'FIELD SHOW');
    expect(JSON.parse((await state(page)).editor.message)).toEqual({ kind: 'object', entityId: 'l1', property: 'length' });
    await command(page, 'UNDO');
    await expect.poll(async () => (await entities(page)).at(-1).text).toBe('Label');
    expect(await entities(page)).toEqual(before);
});

test('DDPTYPE sets the default point style and updates the selected point', async ({ page }) => {
    const before = await openSources(page);
    await pickEntities(page, [{ x: 80, y: 0 }]);
    await command(page, 'DDPTYPE circle 0.5');
    const point = (await entities(page)).find(entity => entity.id === 'p1');
    expect(point.pointStyle).toEqual({ symbol: 'circle', size: 0.5 });
    expect((await state(page)).document.content.settings.pointStyle).toEqual({ symbol: 'circle', size: 0.5 });
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
    expect((await state(page)).document.content.settings.pointStyle).toEqual({ symbol: 'cross', size: 0.2 });
});

test('TRACKPOINT acquires a tracking origin without adding a vertex', async ({ page }) => {
    await openSources(page);
    const added = await runSteps(page, ['LINE', 'TRACKPOINT', '0,0', '1,1', '4,1']);
    await cancel(page);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: 'line', x1: 1, y1: 1, x2: 4, y2: 1 });
});
