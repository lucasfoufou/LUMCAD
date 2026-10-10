import { test, expect } from '@playwright/test';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities, clickWorld, runSteps, expectUndoRedo,
} from './helpers.js';

// Block definitions, dynamic blocks and attributes: edited through BEDIT and
// the command line, then checked on definitions and every reference.

const blocks = [
    { id: 'panel', name: 'Panel', basePoint: { x: 0, y: 0 }, entities: [{ id: 'edge', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 }] },
    { id: 'other', name: 'Other', basePoint: { x: 0, y: 0 }, entities: [{ id: 'ring', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: 1 }] },
];
const library = document => {
    const base = withContent({ entities: [
        { id: 'i1', type: 'blockReference', blockId: 'panel', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
        { id: 'i2', type: 'blockReference', blockId: 'panel', transform: { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 } },
        { id: 'm1', type: 'line', x1: 20, y1: 0, x2: 21, y2: 0 },
        { id: 'm2', type: 'line', x1: 30, y1: 0, x2: 31, y2: 0 },
        { id: 'm3', type: 'line', x1: 40, y1: 0, x2: 41, y2: 0 },
    ] })(document);
    return { ...base, content: { ...base.content, blocks } };
};

async function open(page, fixture = library) {
    await start(page);
    await openDrawing(page, fixture);
    await fit(page);
    return entities(page);
}
const content = async page => (await state(page)).document.content;
const block = async (page, name) => (await content(page)).blocks.find(item => item.name === name);
const draft = async page => (await state(page)).editor.blockEdit;
const byId = async (page, id) => (await entities(page)).find(entity => entity.id === id);
const I1 = { x: 1, y: 0 };

async function editPanel(page) {
    await command(page, 'BEDIT "Panel"');
    expect((await draft(page)).name).toBe('Panel');
    await fit(page);
}

async function pickInDraft(page, point) {
    await cancel(page);
    await command(page, 'SELECT');
    await clickWorld(page, point);
}

test('BEDIT opens an isolated draft that leaves the saved model unchanged', async ({ page }) => {
    const before = await open(page);
    await editPanel(page);
    await runSteps(page, ['LINE', '0,0', '0,2']);
    await cancel(page);
    expect((await draft(page)).content.entities).toHaveLength(2);
    expect(await entities(page)).toEqual(before);
    expect((await block(page, 'Panel')).entities).toHaveLength(1);
});

test('BSAVE applies the draft to the definition and every reference', async ({ page }) => {
    await open(page);
    await editPanel(page);
    await runSteps(page, ['LINE', '0,0', '0,2']);
    await cancel(page);
    await command(page, 'BSAVE');
    expect((await block(page, 'Panel')).entities.map(entity => entity.type)).toEqual(['line', 'line']);
    expect((await draft(page))?.name).toBe('Panel');
    await command(page, 'BCLOSE');
    expect(await draft(page)).toBeNull();
    await command(page, 'UNDO');
    await expect.poll(async () => (await block(page, 'Panel')).entities.length).toBe(1);
});

test('BCLOSE DISCARD abandons the draft and SAVE applies it', async ({ page }) => {
    await open(page);
    await editPanel(page);
    await runSteps(page, ['LINE', '0,0', '0,2']);
    await cancel(page);
    await command(page, 'BCLOSE DISCARD');
    expect(await draft(page)).toBeNull();
    expect((await block(page, 'Panel')).entities).toHaveLength(1);
    await editPanel(page);
    await runSteps(page, ['LINE', '0,0', '0,3']);
    await cancel(page);
    await command(page, 'BCLOSE SAVE');
    expect((await block(page, 'Panel')).entities).toHaveLength(2);
});

test('BSEARCH filters the Library tab by block name', async ({ page }) => {
    await open(page);
    await command(page, 'BSEARCH pan');
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.drawing-sidebar input[type="search"], .drawing-sidebar input').first()).toHaveValue('pan');
    await expect(page.locator('.drawing-sidebar').getByText('Panel', { exact: true }).first()).toBeVisible();
    await expect(page.locator('.drawing-sidebar').getByText('Other', { exact: true })).toHaveCount(0);
});

test('BASE sets the drawing insertion base point', async ({ page }) => {
    await open(page);
    await command(page, 'BASE 2 3');
    expect(JSON.stringify(await content(page))).toMatch(/"insertionBase":\{"x":2,"y":3\}|"basePoint":\{"x":2,"y":3\}/);
    await command(page, 'UNDO');
    await expect.poll(async () => JSON.stringify(await content(page))).not.toMatch(/\{"x":2,"y":3\}/);
});

test('BLOCKDETECT finds every occurrence of the selected motif without editing', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 20.5, y: 0 }]);
    await command(page, 'BLOCKDETECT');
    expect((await state(page)).editor.message).toBe('3 occurrences detected, including the selected motif.');
    expect(await entities(page)).toEqual(before);
});

test('BCONVERT replaces matching motifs with references to one new block', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [{ x: 20.5, y: 0 }]);
    await command(page, 'BCONVERT "Seg"');
    const seg = await block(page, 'Seg');
    const converted = ['m1', 'm2', 'm3'].map(id => before.find(entity => entity.id === id) && id);
    for (const id of converted) expect(await byId(page, id)).toMatchObject({ type: 'blockReference', blockId: seg.id });
    await expectUndoRedo(page, before, await entities(page));
});

test('BLOCKREPLACE swaps the definition of a reference and keeps its identity', async ({ page }) => {
    const before = await open(page);
    await pickEntities(page, [I1]);
    await command(page, 'BLOCKREPLACE "Other"');
    expect(await byId(page, 'i1')).toMatchObject({ blockId: 'other', transform: before[0].transform });
    await expectUndoRedo(page, before, await entities(page));
});

test('BCOUNT counts references per block', async ({ page }) => {
    await open(page);
    await command(page, 'BCOUNT');
    const result = (await state(page)).editor.inquiryResult;
    expect(result.rows).toEqual([expect.objectContaining({ block: 'Panel', count: 2 })]);
});

async function dynamicPanel(page) {
    await editPanel(page);
    await command(page, 'BPARAMETER SET Width distance 2 MIN 1 MAX 5');
    await pickInDraft(page, { x: 1.5, y: 0 });
    await command(page, 'BACTION SET grow STRETCH Width 1 0 1 -1 3 1');
    await command(page, 'BSAVE');
    await command(page, 'BCLOSE');
    await fit(page);
}

test('BPARAMETER defines a parameter in BEDIT and sets it on an instance', async ({ page }) => {
    await open(page);
    await editPanel(page);
    await command(page, 'BPARAMETER SET Width distance 2 MIN 1 MAX 5');
    await command(page, 'BPARAMETER LIST');
    expect(JSON.parse((await state(page)).editor.message).parameters).toEqual([{ name: 'Width', type: 'distance', min: 1, max: 5, default: 2 }]);
    await command(page, 'BCLOSE');
    await fit(page);
    await pickEntities(page, [I1]);
    await command(page, 'BPARAMETER SET Width 3');
    expect((await byId(page, 'i1')).dynamicValues).toEqual({ Width: 3 });
});

test('BACTION STRETCH bound to a parameter stretches the instance geometry', async ({ page }) => {
    await open(page);
    await dynamicPanel(page);
    expect((await block(page, 'Panel')).dynamic.actions).toEqual([expect.objectContaining({ id: 'grow', type: 'stretch', parameter: 'Width', targets: ['edge'] })]);
    await pickEntities(page, [I1]);
    await command(page, 'BPARAMETER SET Width 4');
    expect((await byId(page, 'i1')).dynamicValues).toEqual({ Width: 4 });
});

test('BVSTATE SET defines visibility states switched on an instance', async ({ page }) => {
    await open(page);
    await editPanel(page);
    await command(page, 'BPARAMETER SET State choice On On Off');
    await pickInDraft(page, { x: 1.5, y: 0 });
    await command(page, 'BVSTATE SET State On');
    await cancel(page);
    await command(page, 'BVSTATE SET State Off');
    await command(page, 'BCLOSE');
    const visibility = (await block(page, 'Panel')).dynamic.visibility;
    expect(visibility).toMatchObject({ parameter: 'State', states: { On: ['edge'], Off: [] } });
    await fit(page);
    await pickEntities(page, [I1]);
    await command(page, 'BPARAMETER SET State Off');
    expect((await byId(page, 'i1')).dynamicValues).toMatchObject({ State: 'Off' });
});

test('BLOOKUPTABLE builds a variant row and BTABLE applies it', async ({ page }) => {
    await open(page);
    await editPanel(page);
    await command(page, 'BPARAMETER SET Width distance 2 MIN 1 MAX 5');
    await command(page, 'BPARAMETER SET Size choice Small Small Large');
    await command(page, 'BLOOKUPTABLE SET Sizes Size Large Width 4');
    await command(page, 'BCLOSE');
    expect(JSON.stringify((await block(page, 'Panel')).dynamic)).toMatch(/Sizes/);
    await fit(page);
    await pickEntities(page, [I1]);
    await command(page, 'BTABLE APPLY Sizes Large');
    expect((await byId(page, 'i1')).dynamicValues).toMatchObject({ Size: 'Large', Width: 4 });
});

test('BTABLE APPLY is one undoable step on the selected instance', async ({ page }) => {
    await open(page);
    await editPanel(page);
    await command(page, 'BPARAMETER SET Width distance 2 MIN 1 MAX 5');
    await command(page, 'BPARAMETER SET Size choice Small Small Large');
    await command(page, 'BLOOKUPTABLE SET Sizes Size Large Width 4');
    await command(page, 'BCLOSE');
    await fit(page);
    const before = await entities(page);
    await pickEntities(page, [I1]);
    await command(page, 'BTABLE APPLY Sizes Large');
    await expectUndoRedo(page, before, await entities(page));
});

async function attributedBlock(page) {
    await editPanel(page);
    await command(page, 'ATTDEF REF "A1" 0 1 HEIGHT 0.3 PROMPT "Reference"');
    await command(page, 'BCLOSE');
    await fit(page);
}

test('ATTDEF in BEDIT adds an attribute definition to the block', async ({ page }) => {
    await open(page);
    await attributedBlock(page);
    expect(JSON.stringify((await block(page, 'Panel')).entities)).toMatch(/"tag":"REF"/);
});

test('ATTSYNC gives existing references the new attribute default', async ({ page }) => {
    await open(page);
    await attributedBlock(page);
    await command(page, 'ATTSYNC "Panel"');
    expect(JSON.stringify(await byId(page, 'i1'))).toMatch(/A1/);
    expect(JSON.stringify(await byId(page, 'i2'))).toMatch(/A1/);
});

test('ATTEDIT sets one reference value without touching the other', async ({ page }) => {
    await open(page);
    await attributedBlock(page);
    await command(page, 'ATTSYNC "Panel"');
    const before = await entities(page);
    await pickEntities(page, [I1]);
    await command(page, 'ATTEDIT REF "B7"');
    expect(JSON.stringify(await byId(page, 'i1'))).toMatch(/B7/);
    expect(JSON.stringify(await byId(page, 'i2'))).not.toMatch(/B7/);
    await expectUndoRedo(page, before, await entities(page));
});

test('ATTDISP OFF hides attribute values and NORMAL restores them', async ({ page }) => {
    await open(page);
    await command(page, 'ATTDISP OFF');
    expect((await content(page)).settings.attributeDisplay).toBe('off');
    await command(page, 'ATTDISP ALL');
    expect((await content(page)).settings.attributeDisplay).toBe('all');
    await command(page, 'ATTDISP NORMAL');
    expect((await content(page)).settings.attributeDisplay).toBe('normal');
});

test('BATTMAN renames an attribute tag and migrates reference values', async ({ page }) => {
    await open(page);
    await attributedBlock(page);
    await command(page, 'ATTSYNC "Panel"');
    await command(page, 'BATTMAN "Panel" REF TAG "CODE"');
    expect(JSON.stringify((await block(page, 'Panel')).entities)).toMatch(/"tag":"CODE"/);
    expect(JSON.stringify(await byId(page, 'i1'))).toMatch(/CODE/);
});

test('ATTEXT downloads the attribute values as CSV', async ({ page }) => {
    await open(page);
    await attributedBlock(page);
    await command(page, 'ATTSYNC "Panel"');
    const downloading = page.waitForEvent('download');
    await command(page, 'ATTEXT CSV ALL');
    const file = await downloading;
    const { readFile } = await import('node:fs/promises');
    const csv = await readFile(await file.path(), 'utf8');
    expect(csv).toMatch(/REF/);
    expect(csv.split(/\r?\n/).filter(line => line.includes('A1'))).toHaveLength(2);
});

test('WBLOCK LIBRARY downloads a library that BLOCKIMPORT brings back', async ({ page }) => {
    await open(page);
    const downloading = page.waitForEvent('download');
    await command(page, 'WBLOCK LIBRARY');
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/\.lcad$/);
    const path = await file.path();
    await command(page, 'NEW');
    await expect.poll(async () => (await content(page)).blocks.length).toBe(0);
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'BLOCKIMPORT');
    await (await choosing).setFiles(path);
    await expect.poll(async () => (await content(page)).blocks.map(item => item.name).sort()).toEqual(['Other', 'Panel']);
});

test('BLOCKIMPORT renames colliding definitions from another drawing', async ({ page }) => {
    await open(page);
    const downloading = page.waitForEvent('download');
    await command(page, 'WBLOCK LIBRARY');
    const path = await (await downloading).path();
    // Change the local Panel so the library copy really conflicts with it.
    await editPanel(page);
    await runSteps(page, ['LINE', '0,0', '0,2']);
    await cancel(page);
    await command(page, 'BCLOSE');
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'BLOCKIMPORT');
    await (await choosing).setFiles(path);
    await expect.poll(async () => (await content(page)).blocks.length).toBe(3);
    const imported = (await content(page)).blocks.filter(item => item.name.startsWith('Panel'));
    expect(imported.map(item => item.entities.length).sort()).toEqual([1, 2]);
    expect(new Set(imported.map(item => item.name)).size).toBe(2);
});

test('ADCENTER OPEN lists a library and IMPORT brings one entry in', async ({ page }) => {
    await open(page);
    const downloading = page.waitForEvent('download');
    await command(page, 'WBLOCK LIBRARY');
    const path = await (await downloading).path();
    await command(page, 'NEW');
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'ADCENTER OPEN');
    await (await choosing).setFiles(path);
    await expect.poll(async () => (await state(page)).editor.contentBrowser?.entries?.length || 0).toBeGreaterThan(0);
    const entries = (await state(page)).editor.contentBrowser.entries;
    const index = entries.findIndex(entry => JSON.stringify(entry).includes('Other')) + 1;
    await command(page, `ADCENTER IMPORT ${index}`);
    await expect.poll(async () => (await content(page)).blocks.map(item => item.name)).toEqual(['Other']);
});

test('PASTEBLOCK pastes copied geometry as one anonymous block reference', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await pickEntities(page, [{ x: 20.5, y: 0 }]);
    await command(page, 'COPYCLIP');
    const before = await entities(page);
    const [pasted] = await runSteps(page, ['PASTEBLOCK', '50,10']);
    await cancel(page);
    expect(pasted).toMatchObject({ type: 'blockReference' });
    expect(pasted.transform).toMatchObject({ e: 50, f: 10 });
    await expectUndoRedo(page, before, await entities(page));
});
