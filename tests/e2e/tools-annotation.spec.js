import { test, expect } from '@playwright/test';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities, clickWorld,
    runSteps, expectUndoRedo,
} from './helpers.js';

// Dimensions, leaders, tables, fields and annotation styles: created through
// the front, then checked for measured values, associativity and undo/redo.

const shapes = withContent({ entities: [
    { id: 'h', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'inc', type: 'line', x1: 20, y1: 0, x2: 26, y2: 8 },
    { id: 'p1', type: 'line', x1: 40, y1: 0, x2: 50, y2: 0 },
    { id: 'p2', type: 'line', x1: 40, y1: 0, x2: 40, y2: 10 },
    { id: 'arc', type: 'arc', cx: 60, cy: 0, r: 5, startAngle: Math.PI, endAngle: 2 * Math.PI, counterClockwise: true },
    { id: 'circ', type: 'circle', cx: 80, cy: 0, r: 5 },
    { id: 'q1', type: 'line', x1: 0, y1: 20, x2: 4, y2: 20 },
    { id: 'q2', type: 'line', x1: 4, y1: 20, x2: 10, y2: 20 },
    { id: 'q3', type: 'line', x1: 10, y1: 20, x2: 16, y2: 20 },
    { id: 'pt', type: 'point', x: 100, y: 5 },
    { id: 'circ2', type: 'circle', cx: 80, cy: 30, r: 3 },
] });

const dimensioned = withContent({ entities: [
    { id: 'h', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'h2', type: 'line', x1: 0, y1: -8, x2: 10, y2: -8 },
    { id: 'dim1', type: 'linearDimension', layerId: 'dimensions', sourceId: 'h', measurementMode: 'aligned', dimensionAngle: 0, offset: 0.6, edgeIndex: 0 },
    { id: 'dim2', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, measurementMode: 'aligned', dimensionAngle: 0, offset: 3, linePoint: { x: 0, y: 3 } },
    { id: 'c1', type: 'circle', cx: 30, cy: 0, r: 2 },
    { id: 'c2', type: 'circle', cx: 40, cy: 0, r: 2 },
    { id: 'mark', type: 'centerMark', layerId: 'dimensions', sourceId: 'c1', size: 0.6, extension: 0.3 },
    { id: 'label', type: 'text', x: 0, y: 10, width: 6, height: 1.5, fontSize: 1, text: 'Note', textMode: 'singleLine' },
] });

async function open(page, fixture = shapes) {
    await start(page);
    await openDrawing(page, fixture);
    await fit(page);
    return entities(page);
}
const byId = async (page, id) => (await entities(page)).find(entity => entity.id === id);
const selectDimensions = page => command(page, 'QSELECT TYPE linearDimension');

async function createDimension(page, commandName, point, followUps = []) {
    await command(page, commandName);
    await clickWorld(page, point);
    for (const input of followUps) await command(page, input);
    await cancel(page);
}

test('DIMENSION on a picked line creates an associative dimension that follows MOVE', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMENSION', { x: 3, y: 0 });
    const dimension = (await entities(page)).at(-1);
    expect(dimension).toMatchObject({ type: 'linearDimension', sourceId: 'h', measurementMode: 'aligned' });
    const created = await entities(page);
    await command(page, 'QSELECT TYPE line');
    await runSteps(page, ['MOVE', '0,0', '0,5']);
    await cancel(page);
    expect(await byId(page, 'h')).toMatchObject({ y1: 5, y2: 5 });
    expect(await byId(page, dimension.id)).toEqual(dimension);
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(created);
    await expectUndoRedo(page, before, created);
});

test('DIMLINEAR measures an inclined line horizontally', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMLINEAR', { x: 21.5, y: 2 });
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'linearDimension', sourceId: 'inc', measurementMode: 'horizontal' });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMALIGNED measures an inclined line along its direction', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMALIGNED', { x: 21.5, y: 2 });
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'linearDimension', sourceId: 'inc', measurementMode: 'aligned' });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMROTATED 30 measures along a typed angle', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMROTATED 30', { x: 3, y: 0 });
    const dimension = (await entities(page)).at(-1);
    expect(dimension).toMatchObject({ type: 'linearDimension', measurementMode: 'rotated' });
    expect(dimension.dimensionAngle).toBeCloseTo(Math.PI / 6, 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMANGULAR dimensions the angle between two picked lines', async ({ page }) => {
    const before = await open(page);
    await command(page, 'DIMANGULAR');
    await clickWorld(page, { x: 45, y: 0 });
    await clickWorld(page, { x: 40, y: 5 });
    await cancel(page);
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'angularDimension', sourceIds: ['p1', 'p2'] });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMARC measures a picked arc length', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMARC', { x: 63, y: -4 });
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'arcLengthDimension', sourceId: 'arc' });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMRADIUS dimensions a picked circle and follows a radius edit', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMRADIUS', { x: 84, y: 3 });
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'radialDimension', sourceId: 'circ', mode: 'radius' });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMDIAMETER dimensions a picked circle', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMDIAMETER', { x: 84, y: 3 });
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'radialDimension', sourceId: 'circ', mode: 'diameter' });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMJOGGED creates a jogged radius on a picked circle', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMJOGGED', { x: 84, y: -3 });
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'radialDimension', sourceId: 'circ', mode: 'joggedRadius' });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMORDINATE records the X ordinate of a picked point', async ({ page }) => {
    const before = await open(page);
    await createDimension(page, 'DIMORDINATE', { x: 100, y: 5 }, ['104,5']);
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'ordinateDimension', axis: 'x', featurePoint: { x: 100, y: 5 }, leaderPoint: { x: 104, y: 5 } });
    await expectUndoRedo(page, before, await entities(page));
});

test('QDIM creates a continuous series over three collinear lines', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 2, y: 20 }, { x: 7, y: 20 }, { x: 13, y: 20 }]);
    const added = await runSteps(page, ['QDIM']);
    expect(added.map(dimension => [dimension.p1.x, dimension.p2.x, dimension.seriesMode])).toEqual([[0, 4, 'continuous'], [4, 10, 'continuous'], [10, 16, 'continuous']]);
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMBASELINE creates a baseline series from the first point', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 2, y: 20 }, { x: 7, y: 20 }, { x: 13, y: 20 }]);
    const added = await runSteps(page, ['DIMBASELINE']);
    expect(added.map(dimension => [dimension.p1.x, dimension.p2.x, dimension.seriesMode])).toEqual([[0, 4, 'baseline'], [0, 10, 'baseline'], [0, 16, 'baseline']]);
    expect(new Set(added.map(dimension => dimension.offset)).size).toBe(3);
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMCONTINUE chains dimensions over two lines', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 2, y: 20 }, { x: 7, y: 20 }]);
    const added = await runSteps(page, ['DIMCONTINUE']);
    expect(added.map(dimension => [dimension.p1.x, dimension.p2.x])).toEqual([[0, 4], [4, 10]]);
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMBREAK adds a manual gap on the selected dimension', async ({ page }) => {
    const before = await open(page, withContent({ entities: [
        { id: 'h', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'dim1', type: 'linearDimension', layerId: 'dimensions', sourceId: 'h', measurementMode: 'aligned', dimensionAngle: 0, offset: 0.6, edgeIndex: 0 },
    ] }));
    await selectDimensions(page);
    await command(page, 'DIMBREAK 2 0 4 0');
    expect((await byId(page, 'dim1')).dimensionBreaks).toEqual([{ kind: 'line', index: 2, start: 0.2, end: 0.4 }]);
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMSPACE spaces parallel dimensions from the base', async ({ page }) => {
    const before = await open(page, dimensioned);
    await selectDimensions(page);
    await command(page, 'DIMSPACE 1');
    expect(await byId(page, 'dim1')).toEqual(before.find(entity => entity.id === 'dim1'));
    expect((await byId(page, 'dim2')).linePoint).toEqual({ x: 0, y: 1.6 });
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMTEDIT POSITION moves the label without changing the measurement', async ({ page }) => {
    const before = await open(page, dimensioned);
    await selectDimensions(page);
    await command(page, 'DIMTEDIT POSITION 5 5');
    expect((await byId(page, 'dim1')).dimensionTextPosition).toEqual({ x: 5, y: 5 });
    expect((await byId(page, 'dim1')).sourceId).toBe('h');
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMEDIT NEW overrides the label and keeps the measured value token', async ({ page }) => {
    const before = await open(page, dimensioned);
    await selectDimensions(page);
    await command(page, 'DIMEDIT NEW "<> m"');
    expect((await byId(page, 'dim1')).dimensionTextOverride).toBe('<> m');
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMDISASSOCIATE detaches a dimension from its source line', async ({ page }) => {
    const before = await open(page, dimensioned);
    await selectDimensions(page);
    await command(page, 'DIMDISASSOCIATE');
    const detached = await byId(page, 'dim1');
    expect(detached.sourceId).toBeUndefined();
    expect(detached.id).toBe('dim1');
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMREASSOCIATE links the selected dimensions to another line', async ({ page }) => {
    const before = await open(page, dimensioned);
    await selectDimensions(page);
    await command(page, 'DIMREASSOCIATE h2');
    expect((await byId(page, 'dim1')).sourceId).toBe('h2');
    await expectUndoRedo(page, before, await entities(page));
});

test('DIMUPDATE applies the current named style to selected dimensions', async ({ page }) => {
    const before = await open(page, dimensioned);
    await runSteps(page, ['DIMSTYLE SAVE "Arch"', 'DIMSTYLE CURRENT "Arch"']);
    const styleId = (await state(page)).document.content.activeDimensionStyleId;
    await selectDimensions(page);
    await command(page, 'DIMUPDATE');
    expect((await byId(page, 'dim1')).dimensionStyleId).toBe(styleId);
    await command(page, 'UNDO');
    await expect.poll(async () => (await byId(page, 'dim1')).dimensionStyleId).not.toBe(styleId);
    expect(before.length).toBe((await entities(page)).length);
});

test('DIMREGEN refreshes every dimension in one undoable step', async ({ page }) => {
    await open(page, dimensioned);
    await command(page, 'DIMREGEN');
    expect((await state(page)).editor.message).toMatch(/updated/i);
    expect((await entities(page)).map(entity => entity.id)).toEqual(['h', 'h2', 'dim1', 'dim2', 'c1', 'c2', 'mark', 'label']);
});

test('DIMINSPECT ON adds an inspection frame and OFF removes it', async ({ page }) => {
    const before = await open(page, dimensioned);
    await selectDimensions(page);
    await command(page, 'DIMINSPECT ON "Check" "100%"');
    expect((await byId(page, 'dim1')).dimensionFormat.inspection).toEqual({ enabled: true, label: 'Check', rate: '100%' });
    await command(page, 'DIMINSPECT OFF');
    expect((await byId(page, 'dim1')).dimensionFormat.inspection.enabled).toBe(false);
    await command(page, 'UNDO');
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
});

test('DIMSTYLE creates, renames and makes a style current', async ({ page }) => {
    await open(page, dimensioned);
    await runSteps(page, ['DIMSTYLE SAVE "Arch"', 'DIMSTYLE RENAME "Arch" "Architectural"', 'DIMSTYLE CURRENT "Architectural"']);
    const content = (await state(page)).document.content;
    const style = content.dimensionStyles.find(item => item.name === 'Architectural');
    expect(style).toBeTruthy();
    expect(content.activeDimensionStyleId).toBe(style.id);
    await createDimension(page, 'DIMENSION', { x: 3, y: -8 });
    expect((await entities(page)).at(-1).dimensionStyleId).toBe(style.id);
});

test('CENTERREASSOCIATE moves a centre mark to another circle', async ({ page }) => {
    const before = await open(page, dimensioned);
    await command(page, 'QSELECT TYPE centerMark');
    await command(page, 'CENTERREASSOCIATE c2');
    expect((await byId(page, 'mark')).sourceId).toBe('c2');
    await expectUndoRedo(page, before, await entities(page));
});

test('CENTERDISASSOCIATE keeps the mark where it is after its circle moves', async ({ page }) => {
    const before = await open(page, dimensioned);
    await command(page, 'QSELECT TYPE centerMark');
    await command(page, 'CENTERDISASSOCIATE');
    const detached = await byId(page, 'mark');
    expect(detached.sourceId).toBeUndefined();
    await expectUndoRedo(page, before, await entities(page));
});

test('CENTERRESET restores the default size and extension', async ({ page }) => {
    const before = await open(page, dimensioned);
    await command(page, 'QSELECT TYPE centerMark');
    await command(page, 'CENTERRESET');
    expect(await byId(page, 'mark')).toMatchObject({ sourceId: 'c1', size: 0.25, extension: 0 });
    await expectUndoRedo(page, before, await entities(page));
});

async function leader(page, text, tip, anchor) {
    await runSteps(page, [`MLEADER "${text}"`, `${tip.x},${tip.y}`, `${tip.x + 2},${tip.y + 2}`, 'DONE', `${anchor.x},${anchor.y}`]);
    await cancel(page);
    return (await entities(page)).at(-1);
}

test('MLEADEREDIT replaces the leader text', async ({ page }) => {
    await open(page);
    const created = await leader(page, 'Old', { x: 0, y: 40 }, { x: 6, y: 43 });
    const before = await entities(page);
    await fit(page);
    await command(page, 'QSELECT TYPE blockReference');
    await command(page, 'MLEADEREDIT TEXT "New"');
    const edited = await byId(page, created.id);
    const block = (await state(page)).document.content.blocks.find(item => item.id === edited.blockId);
    expect(JSON.stringify(block)).toContain('New');
    await expectUndoRedo(page, before, await entities(page));
});

test('MLEADERALIGN X aligns leader contents on the first leader', async ({ page }) => {
    await open(page);
    const first = await leader(page, 'A', { x: 0, y: 40 }, { x: 6, y: 43 });
    const second = await leader(page, 'B', { x: 0, y: 50 }, { x: 9, y: 53 });
    const before = await entities(page);
    await command(page, 'QSELECT TYPE blockReference');
    await command(page, 'MLEADERALIGN X');
    expect((await byId(page, second.id)).transform.e).toBeCloseTo((await byId(page, first.id)).transform.e, 9);
    await expectUndoRedo(page, before, await entities(page));
});

test('MLEADERCOLLECT merges two leaders into one with both branches', async ({ page }) => {
    await open(page);
    const first = await leader(page, 'A', { x: 0, y: 40 }, { x: 6, y: 43 });
    await leader(page, 'B', { x: 0, y: 50 }, { x: 9, y: 53 });
    const before = await entities(page);
    await command(page, 'QSELECT TYPE blockReference');
    await command(page, 'MLEADERCOLLECT');
    const leaders = (await entities(page)).filter(entity => entity.type === 'blockReference');
    expect(leaders.map(entity => entity.id)).toEqual([first.id]);
    await expectUndoRedo(page, before, await entities(page));
});

test('MLEADERSTYLE SAVE and USE size the next leader', async ({ page }) => {
    await open(page);
    await runSteps(page, ['MLEADERSTYLE SAVE "Big" 0.8 0.5 1 closed', 'MLEADERSTYLE USE "Big"']);
    const content = (await state(page)).document.content;
    expect(content.leaderStyles.some(style => style.name === 'Big')).toBe(true);
    const created = await leader(page, 'Styled', { x: 0, y: 40 }, { x: 6, y: 43 });
    const block = (await state(page)).document.content.blocks.find(item => item.id === created.blockId);
    expect(JSON.stringify(block)).toMatch(/0\.8/);
});

test('STYLE opens the text style manager and a new style applies to text', async ({ page }) => {
    await open(page, dimensioned);
    await command(page, 'STYLE');
    await expect(page.locator('.drawing-manager-window')).toBeVisible();
    await expect(page.locator('.drawing-manager-window')).toContainText(/Standard/);
});

test('MLSTYLE SET defines a two-element style used by MLINE', async ({ page }) => {
    await open(page);
    await command(page, 'MLSTYLE SET "Wall" ELEMENT 0.15 ELEMENT -0.15');
    const style = (await state(page)).document.content.multilineStyles.find(item => item.name === 'Wall');
    expect(style.elements.map(element => element.offset).sort((a, b) => a - b)).toEqual([-0.15, 0.15]);
    const [wall] = await runSteps(page, ['MLINE STYLE "Wall"', '0,60', '10,60', 'END']);
    await cancel(page);
    expect(JSON.stringify(wall)).toMatch(/0\.15/);
});

async function table(page) {
    const [created] = await runSteps(page, ['TABLE 2 3', '0,70']);
    await cancel(page);
    await fit(page);
    await command(page, 'QSELECT TYPE table');
    if (!(await state(page)).selection.length) await command(page, 'QSELECT TYPE polyline');
    return created;
}

test('TABLESTYLE SET then APPLY changes the selected table', async ({ page }) => {
    await open(page);
    const created = await table(page);
    const before = await entities(page);
    await runSteps(page, ['TABLESTYLE SET "Grid" PADDING 0.2 ROWHEIGHT 1', 'TABLESTYLE APPLY "Grid"']);
    const styled = await byId(page, created.id);
    expect(JSON.stringify(styled.table)).toMatch(/"Grid"|0\.2/);
    await expectUndoRedo(page, before, await entities(page));
});

test('TABLEDIT CELL sets a value and a formula', async ({ page }) => {
    await open(page);
    const created = await table(page);
    await command(page, 'TABLEDIT CELL A1 "4"');
    const before = await entities(page);
    await command(page, 'TABLEDIT CELL B1 "=A1*2"');
    const cells = (await byId(page, created.id)).table.cells;
    expect(cells[0][0].value).toBe('4');
    expect(cells[0][1].value).toBe('=A1*2');
    await expectUndoRedo(page, before, await entities(page));
});

test('TABLEEXPORT downloads the selected table as CSV', async ({ page }) => {
    await open(page);
    await table(page);
    await command(page, 'TABLEDIT CELL A1 "Roof"');
    const downloading = page.waitForEvent('download');
    await command(page, 'TABLEEXPORT VALUES');
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const { readFile } = await import('node:fs/promises');
    expect((await readFile(await file.path(), 'utf8')).split(/\r?\n/)[0]).toContain('Roof');
});

test('DATALINK ATTACH fills a table from a chosen CSV file', async ({ page }) => {
    await open(page);
    const created = await table(page);
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'DATALINK ATTACH');
    await (await choosing).setFiles({ name: 'panels.csv', mimeType: 'text/csv', buffer: Buffer.from('Panel,Power\nA,400\n') });
    await expect.poll(async () => JSON.stringify((await byId(page, created.id)).table)).toContain('Power');
});

test('DATALINKUPDATE reloads a linked table from its CSV source', async ({ page }) => {
    await open(page);
    const created = await table(page);
    let choosing = page.waitForEvent('filechooser');
    await command(page, 'DATALINK ATTACH');
    await (await choosing).setFiles({ name: 'panels.csv', mimeType: 'text/csv', buffer: Buffer.from('Panel,Power\nA,400\n') });
    await expect.poll(async () => JSON.stringify((await byId(page, created.id)).table)).toContain('400');
    choosing = page.waitForEvent('filechooser');
    await command(page, 'DATALINKUPDATE');
    await (await choosing).setFiles({ name: 'panels.csv', mimeType: 'text/csv', buffer: Buffer.from('Panel,Power\nA,450\n') });
    await expect.poll(async () => JSON.stringify((await byId(page, created.id)).table)).toContain('450');
});

test('UPDATEFIELD ALL refreshes a field after its source changes', async ({ page }) => {
    await open(page, dimensioned);
    await pickEntities(page, [{ x: 3, y: 10.7 }]);
    await command(page, 'FIELD OBJECT h length');
    expect((await byId(page, 'label')).text).toBe('10');
    await pickEntities(page, [{ x: 3, y: 0 }]);
    await runSteps(page, ['SCALE', '0,0', '2']);
    await cancel(page);
    await command(page, 'UPDATEFIELD ALL');
    await expect.poll(async () => (await byId(page, 'label')).text).toBe('20');
});

test('OBJECTSCALE ADD gives annotative text a second scale representation', async ({ page }) => {
    const before = await open(page, dimensioned);
    await pickEntities(page, [{ x: 3, y: 10.7 }]);
    await runSteps(page, ['OBJECTSCALE ON', 'OBJECTSCALE ADD 50']);
    expect(JSON.stringify((await byId(page, 'label')).annotation)).toMatch(/50/);
    await command(page, 'UNDO');
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
});

test('SCALELISTEDIT ADD and CURRENT update the annotation scale catalogue', async ({ page }) => {
    await open(page);
    await runSteps(page, ['SCALELISTEDIT ADD 75', 'SCALELISTEDIT CURRENT 75']);
    const content = (await state(page)).document.content;
    expect(JSON.stringify(content.settings)).toMatch(/75/);
});

test('ANNOUPDATE and ANNORESET rebase and reset annotative representations', async ({ page }) => {
    await open(page, dimensioned);
    await pickEntities(page, [{ x: 3, y: 10.7 }]);
    await runSteps(page, ['OBJECTSCALE ON', 'OBJECTSCALE ADD 50', 'OBJECTSCALE OFFSET 50 1 1']);
    const offset = await byId(page, 'label');
    expect(JSON.stringify(offset.annotation)).toMatch(/"x":1/);
    await command(page, 'ANNORESET');
    expect(JSON.stringify((await byId(page, 'label')).annotation)).not.toMatch(/"x":1,"y":1/);
    await command(page, 'ANNOUPDATE');
    expect((await state(page)).editor.message).not.toMatch(/Unknown/);
});

test('HYPERLINK SET adds a link and REMOVE deletes it', async ({ page }) => {
    const before = await open(page, dimensioned);
    await pickEntities(page, [{ x: 3, y: 0 }]);
    await command(page, 'HYPERLINK SET "https://example.org/spec" "Spec"');
    expect((await byId(page, 'h')).hyperlink).toMatchObject({ url: 'https://example.org/spec', label: 'Spec' });
    await command(page, 'HYPERLINK REMOVE');
    expect((await byId(page, 'h')).hyperlink).toBeUndefined();
    await command(page, 'UNDO');
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
});
