import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities, runSteps,
    expectUndoRedo, undoRestores,
} from './helpers.js';
import {
    pngDataUrl, pdfBytes, dgnBytes, SHP_FONT, shxStrokes, damagedLcadBytes, lcadBytes,
} from './fixtures.js';
import { createDrawingLayout } from '../../src/utils/drawingLayouts.js';

// Files, external references, attached underlays, imports and the clipboard.
// Every input is a real file chosen through the browser file chooser and every
// output is a real download whose bytes are read back.

const content = async page => (await state(page)).document.content;
const editor = async page => (await state(page)).editor;
const message = async page => (await editor(page)).message;

async function choose(page, run, file) {
    const choosing = page.waitForEvent('filechooser');
    await run();
    await (await choosing).setFiles(file);
}
async function download(page, run) {
    const downloading = page.waitForEvent('download');
    await run();
    const file = await downloading;
    return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}
const lcadFile = (name, build) => ({ name, mimeType: 'application/octet-stream', buffer: lcadBytes(build, name) });
const added = (before, after) => after.filter(entity => !before.some(item => item.id === entity.id));

const basic = withContent({ entities: [
    { id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
    { id: 'c1', type: 'circle', cx: 20, cy: 0, r: 2 },
] });

// ---- Templates, recovery and integrity -----------------------------------

test('SAVETEMPLATE downloads the drawing and NEW TEMPLATE instantiates it with a fresh identity', async ({ page }) => {
    await start(page);
    const original = await openDrawing(page, basic);
    const template = await download(page, () => command(page, 'SAVETEMPLATE'));
    expect(template.bytes.subarray(0, 2).toString()).toBe('PK');
    await command(page, 'NEW');
    await expect.poll(async () => (await content(page)).entities.length).toBe(0);
    await choose(page, () => command(page, 'NEW TEMPLATE'), { name: template.name, mimeType: 'application/octet-stream', buffer: template.bytes });
    await expect.poll(async () => (await content(page)).entities.map(entity => entity.id)).toEqual(['l1', 'c1']);
    expect((await state(page)).document.id).not.toBe(original.id);
});

test('QNEW without a configured template starts a blank drawing', async ({ page }) => {
    await start(page);
    const original = await openDrawing(page, basic);
    await command(page, 'QNEW');
    await expect.poll(async () => (await content(page)).entities.length).toBe(0);
    expect((await state(page)).document.id).not.toBe(original.id);
});

test('RECOVER reads a damaged archive, REPORT shows the loss and OPEN opens the surviving geometry', async ({ page }) => {
    await start(page);
    await choose(page, () => command(page, 'RECOVER'), { name: 'damaged.lcad', mimeType: 'application/octet-stream', buffer: damagedLcadBytes() });
    await expect.poll(() => message(page)).toMatch(/recover/i);
    expect(await entities(page)).toEqual([]);
    await command(page, 'RECOVER REPORT');
    expect(JSON.stringify((await editor(page)).inquiryResult)).toMatch(/lost/);
    await command(page, 'RECOVER OPEN');
    await expect.poll(async () => (await entities(page)).map(entity => entity.id)).toEqual(['survivor']);
});

test('AUDIT reports an orphan layer reference and AUDIT REPAIR restores it in one undo step', async ({ page }) => {
    await start(page);
    await openDrawing(page, document => {
        const next = basic(document);
        return { ...next, content: { ...next.content, entities: [...next.content.entities, { id: 'orphan', type: 'line', layerId: 'ghost', x1: 0, y1: 5, x2: 5, y2: 5 }] } };
    });
    await command(page, 'AUDIT');
    expect(await message(page)).not.toMatch(/No integrity issues/);
    const before = await content(page);
    await command(page, 'AUDIT REPAIR');
    const repaired = await content(page);
    const orphan = repaired.entities.find(entity => entity.id === 'orphan');
    expect(repaired.layers.some(layer => layer.id === orphan.layerId)).toBe(true);
    expect(orphan).toMatchObject({ x1: 0, y1: 5, x2: 5, y2: 5 });
    await command(page, 'AUDIT');
    expect(await message(page)).toMatch(/No integrity issues/);
    await command(page, 'UNDO');
    await expect.poll(() => content(page)).toEqual(before);
});

test('PURGE PREVIEW reports unused definitions and PURGE ALL removes them; undo restores', async ({ page }) => {
    await start(page);
    await openDrawing(page, document => {
        const next = basic(document);
        return { ...next, content: { ...next.content,
            layers: [...next.content.layers, { ...next.content.layers[0], id: 'unused-layer', name: 'Unused' }],
            blocks: [{ id: 'unused-block', name: 'Spare', basePoint: { x: 0, y: 0 }, entities: [{ id: 'b1', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 }] }] } };
    });
    const before = await content(page);
    await command(page, 'PURGE PREVIEW');
    expect(await message(page)).toMatch(/[1-9]\d* unused/);
    expect(await content(page)).toEqual(before);
    await command(page, 'PURGE ALL');
    const purged = await content(page);
    expect(purged.blocks.map(block => block.id)).not.toContain('unused-block');
    expect(purged.layers.map(layer => layer.id)).not.toContain('unused-layer');
    expect(purged.entities).toEqual(before.entities);
    await command(page, 'UNDO');
    await expect.poll(() => content(page)).toEqual(before);
});

// ---- Comparison and standards ---------------------------------------------

const edited = document => {
    const next = basic(document);
    return { ...next, content: { ...next.content, entities: [
        { ...next.content.entities[0], x2: 12 },
        next.content.entities[1],
        { id: 'new-line', type: 'line', layerId: next.content.activeLayerId, x1: 0, y1: 8, x2: 4, y2: 8 },
    ] } };
};

test('COMPARE reads an edited copy and reports the changed and added objects without editing', async ({ page }) => {
    await start(page);
    const before = await openDrawing(page, basic);
    await choose(page, () => command(page, 'COMPARE'), lcadFile('edited.lcad', edited));
    await expect.poll(async () => (await editor(page)).comparison?.changes?.length || 0).toBeGreaterThan(0);
    const report = JSON.stringify((await editor(page)).comparison);
    expect(report).toMatch(/l1/);
    expect(report).toMatch(/new-line/);
    expect((await state(page)).document.content).toEqual(before.content);
});

test('COMPAREIMPORT ALL applies the compared differences in one undo step', async ({ page }) => {
    await start(page);
    const before = await openDrawing(page, basic);
    await choose(page, () => command(page, 'COMPARE'), lcadFile('edited.lcad', edited));
    await expect.poll(async () => (await editor(page)).comparison?.changes?.length || 0).toBeGreaterThan(0);
    await command(page, 'COMPAREIMPORT ALL');
    const imported = await entities(page);
    expect(imported.find(entity => entity.id === 'l1').x2).toBe(12);
    expect(imported.map(entity => entity.id)).toContain('new-line');
    await command(page, 'UNDO');
    await expect.poll(async () => (await entities(page))).toEqual(before.content.entities);
});

test('STANDARDS SAVE downloads the definitions and STANDARDS LOAD embeds them', async ({ page }) => {
    await start(page);
    await openDrawing(page, basic);
    const standard = await download(page, () => command(page, 'STANDARDS SAVE'));
    const json = JSON.parse(standard.bytes.toString('utf8'));
    expect(JSON.stringify(json)).toMatch(/"name":"0"/);
    await choose(page, () => command(page, 'STANDARDS LOAD'), { name: 'office.json', mimeType: 'application/json', buffer: standard.bytes });
    await expect.poll(async () => Boolean((await content(page)).standards)).toBe(true);
});

test('CHECKSTANDARDS lists a nonconforming layer and FIX ALL repairs it in one undo step', async ({ page }) => {
    await start(page);
    await openDrawing(page, basic);
    const standard = await download(page, () => command(page, 'STANDARDS SAVE'));
    // The office standard requires layer 0 in green; the drawing still has it in the default colour.
    const office = standard.bytes.toString('utf8').replace(/("name":\s*"0"[^}]*?"color":\s*")#[0-9a-f]{6}/i, '$1#00ff00');
    expect(office).toMatch(/#00ff00/);
    await choose(page, () => command(page, 'STANDARDS LOAD'), { name: 'office.json', mimeType: 'application/json', buffer: Buffer.from(office) });
    await expect.poll(async () => Boolean((await content(page)).standards)).toBe(true);
    expect((await content(page)).layers[0].color).not.toBe('#00ff00');
    await command(page, 'CHECKSTANDARDS');
    expect((await editor(page)).standards?.issues?.length).toBeGreaterThan(0);
    const before = await content(page);
    await command(page, 'CHECKSTANDARDS FIX ALL');
    expect((await content(page)).layers[0].color).toBe('#00ff00');
    await command(page, 'UNDO');
    await expect.poll(() => content(page)).toEqual(before);
});

// ---- External drawing references ------------------------------------------

const referenceSource = document => withContent({ entities: [
    { id: 'src-line', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 },
    { id: 'src-circle', type: 'circle', cx: 2, cy: 2, r: 1 },
] })(document);
const referenceSourceEdited = document => withContent({ entities: [
    { id: 'src-line', type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 },
    { id: 'src-extra', type: 'point', x: 3, y: 3 },
] })(document);

async function attachReference(page, input = 'XATTACH') {
    await start(page);
    await openDrawing(page, basic);
    const before = await entities(page);
    await choose(page, () => command(page, input), lcadFile('source.lcad', referenceSource));
    await expect.poll(async () => (await entities(page)).length).toBe(before.length + 1);
    const [reference] = added(before, await entities(page));
    return { before, reference };
}

test('XATTACH caches the chosen drawing as an external reference at the origin', async ({ page }) => {
    const { before, reference } = await attachReference(page);
    expect(reference).toMatchObject({ type: 'blockReference' });
    expect(reference.externalReference).toBeTruthy();
    const block = (await content(page)).blocks.find(item => item.id === reference.blockId);
    expect(block.entities.map(entity => entity.type).sort()).toEqual(['circle', 'line']);
    await undoRestores(page, before);
});

test('XREF LIST, UNLOAD, RELOAD and DETACH manage the reference state', async ({ page }) => {
    const { before, reference } = await attachReference(page, 'XREF ATTACH');
    await command(page, 'XREF LIST');
    expect(JSON.stringify((await editor(page)).inquiryResult)).toMatch(/source/);
    await command(page, `XREF UNLOAD ${reference.id}`);
    const unloaded = (await entities(page)).find(entity => entity.id === reference.id);
    expect(unloaded.externalReference).toMatchObject({ loaded: false });
    await choose(page, () => command(page, `XREF RELOAD ${reference.id}`), lcadFile('source.lcad', referenceSource));
    await expect.poll(async () => (await entities(page)).find(entity => entity.id === reference.id).externalReference.loaded).not.toBe(false);
    await command(page, `XREF DETACH ${reference.id}`);
    expect(await entities(page)).toEqual(before);
});

test('XBIND converts the reference to ordinary block geometry in one undo step', async ({ page }) => {
    const { reference } = await attachReference(page);
    const attached = await entities(page);
    await command(page, `XBIND ${reference.id}`);
    const bound = (await entities(page)).find(entity => entity.id === reference.id);
    expect(bound.type).toBe('blockReference');
    expect(bound.externalReference).toBeFalsy();
    await expectUndoRedo(page, attached, await entities(page));
});

test('XCLIP RECT clips the selected reference; undo removes the clip', async ({ page }) => {
    const { reference } = await attachReference(page);
    const attached = await entities(page);
    await pickEntities(page, [{ x: 2, y: 3 }]);
    await command(page, 'XCLIP RECT 0 -1 3 4');
    const clipped = (await entities(page)).find(entity => entity.id === reference.id);
    expect(clipped.blockClip).toMatchObject({ enabled: true });
    await expectUndoRedo(page, attached, await entities(page));
});

test('XCOMPARE reports the source objects added and removed since attachment', async ({ page }) => {
    const { reference } = await attachReference(page);
    const attached = await entities(page);
    await choose(page, () => command(page, `XCOMPARE ${reference.id}`), lcadFile('source.lcad', referenceSourceEdited));
    await expect.poll(async () => JSON.stringify((await editor(page)).inquiryResult || null)).toMatch(/src-extra/);
    expect(JSON.stringify((await editor(page)).inquiryResult)).toMatch(/src-circle/);
    expect(await entities(page)).toEqual(attached);
});

// ---- Raster images --------------------------------------------------------

const withImage = document => {
    const next = basic(document);
    return { ...next,
        assets: [{ id: 'photo', name: 'photo.png', mimeType: 'image/png', width: 8, height: 8, link: pngDataUrl(8, 8) }],
        content: { ...next.content, entities: [...next.content.entities, {
            id: 'img', type: 'image', layerId: next.content.activeLayerId, assetId: 'photo', x: 30, y: 0, width: 8, height: 8,
            rotation: 0, opacity: 1, imageSource: { mode: 'linked', path: '/Volumes/Shared/photo.png' },
        }] } };
};
async function selectImage(page) {
    await start(page);
    await openDrawing(page, withImage);
    await fit(page);
    await pickEntities(page, [{ x: 30, y: 4 }]);
    return entities(page);
}
const image = async page => (await entities(page)).find(entity => entity.id === 'img');

test('IMAGE opens the source controls and Embed keeps the snapshot without the link', async ({ page }) => {
    const before = await selectImage(page);
    await command(page, 'IMAGE');
    await page.getByText('Source file', { exact: true }).click();
    await expect(page.getByLabel('Source path')).toHaveValue('/Volumes/Shared/photo.png');
    await page.getByRole('button', { name: 'Embed snapshot and remove link' }).click();
    await expect(page.getByLabel('Source path')).toHaveValue('Embedded image');
    const embedded = await image(page);
    expect(embedded.imageSource).toBeUndefined();
    expect(embedded.assetId).toBe('photo');
    await expectUndoRedo(page, before, await entities(page));
});

test('IMAGECLIP RECT crops the selected image in local fractions', async ({ page }) => {
    const before = await selectImage(page);
    await command(page, 'IMAGECLIP RECT 0 0 0.5 1');
    expect(JSON.stringify(await image(page))).toMatch(/0\.5/);
    expect((await image(page)).width).toBe(8);
    await expectUndoRedo(page, before, await entities(page));
});

test('IMAGEADJUST BRIGHTNESS and MONO store nondestructive adjustments', async ({ page }) => {
    const before = await selectImage(page);
    await command(page, 'IMAGEADJUST BRIGHTNESS 140');
    await command(page, 'IMAGEADJUST MONO ON');
    expect(JSON.stringify(await image(page))).toMatch(/140/);
    expect(JSON.stringify(await image(page))).toMatch(/mono[^,]*true/i);
    expect((await image(page)).assetId).toBe('photo');
    await command(page, 'UNDO');
    await command(page, 'UNDO');
    await expect.poll(() => entities(page)).toEqual(before);
});

// ---- PDF ------------------------------------------------------------------

const pdfFile = { name: 'plan.pdf', mimeType: 'application/pdf', buffer: pdfBytes() };

test('PDFIMPORT turns the PDF line and text into editable objects in one undo step', async ({ page }) => {
    await start(page);
    await openDrawing(page, basic);
    const before = await entities(page);
    await choose(page, () => command(page, 'PDFIMPORT'), pdfFile);
    await expect.poll(async () => (await entities(page)).length).toBeGreaterThan(before.length);
    const imported = added(before, await entities(page));
    const line = imported.find(entity => entity.type === 'line');
    expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1)).toBeCloseTo(0.08, 6);
    expect(JSON.stringify(imported)).toMatch(/LUMCAD/);
    await undoRestores(page, before);
});

async function attachPdf(page) {
    await start(page);
    await openDrawing(page, basic);
    const before = await entities(page);
    await choose(page, () => command(page, 'PDFATTACH'), pdfFile);
    await expect.poll(async () => (await entities(page)).length).toBe(before.length + 1);
    const [underlay] = added(before, await entities(page));
    return { before, underlay };
}

test('PDFATTACH places the page as a native underlay at paper scale', async ({ page }) => {
    const { before, underlay } = await attachPdf(page);
    expect(JSON.stringify(underlay)).toMatch(/pdf/i);
    const asset = (await state(page)).document.assets.find(item => item.mimeType === 'application/pdf');
    expect(asset).toBeTruthy();
    await undoRestores(page, before);
});

test('PDFCLIP RECT clips the selected underlay; undo removes the clip', async ({ page }) => {
    const { underlay } = await attachPdf(page);
    const attached = await entities(page);
    await command(page, `SELECT`);
    await page.keyboard.press('Escape');
    await command(page, `QSELECT TYPE ${underlay.type}`);
    await command(page, 'PDFCLIP RECT 0 0 0.05 0.05');
    expect((await entities(page)).find(entity => entity.id === underlay.id).blockClip).toMatchObject({ enabled: true });
    await expectUndoRedo(page, attached, await entities(page));
});

test('PDFLAYERS lists the optional-content layers and OFF hides one', async ({ page }) => {
    const { underlay } = await attachPdf(page);
    await command(page, `QSELECT TYPE ${underlay.type}`);
    const listed = async () => {
        await command(page, 'PDFLAYERS LIST');
        return JSON.stringify((await editor(page)).inquiryResult);
    };
    const initial = await listed();
    expect(initial).toMatch(/Walls/);
    expect(initial).toMatch(/Notes/);
    const attached = await entities(page);
    await command(page, 'PDFLAYERS OFF "Notes"');
    await expect.poll(async () => JSON.stringify(await entities(page))).not.toBe(JSON.stringify(attached));
    expect(await listed()).not.toBe(initial);
    await command(page, 'UNDO');
    await expect.poll(() => entities(page)).toEqual(attached);
});

test('PDFSHXTEXT recognises imported SHX strokes as text with the chosen font', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [...shxStrokes('a', 10), ...shxStrokes('b', 18)] }));
    await fit(page);
    const before = await entities(page);
    await command(page, 'SELECT');
    await page.keyboard.press('Control+A');
    await command(page, 'QSELECT TYPE line');
    await choose(page, () => command(page, 'PDFSHXTEXT HEIGHT 10'), { name: 'fixture.shp', mimeType: 'text/plain', buffer: Buffer.from(SHP_FONT) });
    await expect.poll(async () => (await entities(page)).map(entity => entity.type)).toEqual(['text']);
    expect((await entities(page))[0].text).toBe('HH');
    await undoRestores(page, before);
});

// ---- DGN, DWFx and WMF ----------------------------------------------------

const dgnFile = { name: 'site.dgn', mimeType: 'application/octet-stream', buffer: dgnBytes() };

test('DGNIMPORT brings levels and geometry in as editable objects in one undo step', async ({ page }) => {
    await start(page);
    await openDrawing(page, basic);
    const before = await entities(page);
    await choose(page, () => command(page, 'DGNIMPORT'), dgnFile);
    await expect.poll(async () => (await entities(page)).length).toBe(before.length + 2);
    const imported = added(before, await entities(page));
    expect(imported.map(entity => entity.type).sort()).toEqual(['line', 'polyline']);
    const layers = (await content(page)).layers.map(layer => layer.name);
    expect(layers).toEqual(expect.arrayContaining(['DGN 4', 'DGN 7']));
    await undoRestores(page, before);
});

async function attachDgn(page) {
    await start(page);
    await openDrawing(page, basic);
    const before = await entities(page);
    await choose(page, () => command(page, 'DGNATTACH'), dgnFile);
    await expect.poll(async () => (await entities(page)).length).toBe(before.length + 1);
    return { before, reference: added(before, await entities(page))[0] };
}

test('DGNATTACH adds one vector reference with its embedded source', async ({ page }) => {
    const { before, reference } = await attachDgn(page);
    expect(reference.type).toBe('blockReference');
    expect((await state(page)).document.assets.some(asset => /dgn/i.test(asset.name))).toBe(true);
    await undoRestores(page, before);
});

test('DGNCLIP RECT clips the selected DGN reference', async ({ page }) => {
    const { reference } = await attachDgn(page);
    const attached = await entities(page);
    await command(page, 'QSELECT TYPE blockReference');
    await command(page, 'DGNCLIP RECT 0 -1 3 1');
    expect((await entities(page)).find(entity => entity.id === reference.id).blockClip).toMatchObject({ enabled: true });
    await expectUndoRedo(page, attached, await entities(page));
});

async function publishedDwfx(page) {
    await start(page);
    await openDrawing(page, document => ({ ...basic(document), layouts: [createDrawingLayout({ name: 'Sheet', format: 'A4' })] }));
    await command(page, 'DWFXOUT');
    await expect(page.locator('.drawing-publish-dialog')).toBeVisible();
    const downloading = page.waitForEvent('download');
    await page.locator('.drawing-publish-dialog').getByRole('button', { name: /Save/ }).click();
    const file = await downloading;
    const bytes = await readFile(await file.path());
    return { name: 'sheet.dwfx', mimeType: 'application/octet-stream', buffer: bytes };
}

async function attachDwfx(page) {
    const file = await publishedDwfx(page);
    const before = await entities(page);
    await choose(page, () => command(page, 'DWFATTACH'), file);
    await expect.poll(async () => (await entities(page)).length).toBe(before.length + 1);
    return { before, underlay: added(before, await entities(page))[0] };
}

test('DWFATTACH attaches a DWFx page as an underlay with a preview', async ({ page }) => {
    const { before, underlay } = await attachDwfx(page);
    expect(underlay.type).toBe('blockReference');
    expect((await state(page)).document.assets.some(asset => asset.mimeType === 'image/png')).toBe(true);
    await undoRestores(page, before);
});

test('DWFCLIP RECT crops the selected DWFx underlay', async ({ page }) => {
    const { underlay } = await attachDwfx(page);
    const attached = await entities(page);
    await command(page, 'QSELECT TYPE blockReference');
    await command(page, 'DWFCLIP RECT 0 0 0.05 0.05');
    expect((await entities(page)).find(entity => entity.id === underlay.id).blockClip).toMatchObject({ enabled: true });
    await expectUndoRedo(page, attached, await entities(page));
});

test('WMFIN imports a WMF written by WMFOUT as editable vector geometry', async ({ page }) => {
    await start(page);
    await openDrawing(page, basic);
    await fit(page);
    const downloading = page.waitForEvent('download');
    await command(page, 'WMFOUT');
    const wmf = await readFile(await (await downloading).path());
    await command(page, 'NEW');
    await expect.poll(async () => (await entities(page)).length).toBe(0);
    await choose(page, () => command(page, 'WMFIN'), { name: 'plan.wmf', mimeType: 'application/octet-stream', buffer: wmf });
    await expect.poll(async () => (await entities(page)).length).toBeGreaterThan(0);
    expect((await entities(page)).every(entity => entity.type !== 'image')).toBe(true);
    await undoRestores(page, []);
});

// ---- Clipboard ------------------------------------------------------------

test.describe('clipboard', () => {
    test.beforeEach(async ({ context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    });

    test('COPYCLIP then PASTECLIP places a copy at the picked point', async ({ page }) => {
        await start(page);
        await openDrawing(page, basic);
        await fit(page);
        await pickEntities(page, [{ x: 5, y: 0 }]);
        await command(page, 'COPYCLIP');
        const before = await entities(page);
        const [copy] = await runSteps(page, ['PASTECLIP', '50,10']);
        await cancel(page);
        expect(copy).toMatchObject({ type: 'line' });
        expect(copy.x2 - copy.x1).toBeCloseTo(10, 9);
        expect(copy.id).not.toBe('l1');
        await expectUndoRedo(page, before, await entities(page));
    });

    test('COPYBASE pastes relative to the picked base point', async ({ page }) => {
        await start(page);
        await openDrawing(page, basic);
        await fit(page);
        await pickEntities(page, [{ x: 5, y: 0 }]);
        await runSteps(page, ['COPYBASE', '0,0']);
        const [copy] = await runSteps(page, ['PASTECLIP', '50,10']);
        await cancel(page);
        expect(copy).toMatchObject({ x1: 50, y1: 10, x2: 60, y2: 10 });
    });

    test('CUTCLIP removes the selection after copying and PASTEORIG restores it in place', async ({ page }) => {
        await start(page);
        await openDrawing(page, basic);
        await fit(page);
        const before = await entities(page);
        await pickEntities(page, [{ x: 5, y: 0 }]);
        await command(page, 'CUTCLIP');
        await expect.poll(async () => (await entities(page)).map(entity => entity.id)).toEqual(['c1']);
        await command(page, 'PASTEORIG');
        const pasted = (await entities(page)).find(entity => entity.type === 'line');
        expect(pasted).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 0 });
        await command(page, 'UNDO');
        await command(page, 'UNDO');
        await expect.poll(() => entities(page)).toEqual(before);
    });

    test('PASTECLIP reads SVG geometry from the plain-text clipboard', async ({ page }) => {
        await start(page);
        await page.evaluate(() => navigator.clipboard.writeText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="0" stroke="black"/></svg>'));
        const [line] = await runSteps(page, ['PASTECLIP', '5,5']);
        await cancel(page);
        expect(line).toMatchObject({ type: 'line' });
        expect(Math.hypot(line.x2 - line.x1, line.y2 - line.y1)).toBeGreaterThan(0);
    });
});

// ---- Personal aliases -----------------------------------------------------

test('ALIASEDIT SET defines a personal alias that starts LINE, and REMOVE deletes it', async ({ page }) => {
    await start(page);
    await command(page, 'ALIASEDIT SET MYL LINE');
    const [line] = await runSteps(page, ['MYL', '0,0', '3,4']);
    await cancel(page);
    expect(line).toMatchObject({ type: 'line', x1: 0, y1: 0, x2: 3, y2: 4 });
    await command(page, 'ALIASEDIT REMOVE MYL');
    await command(page, 'MYL');
    expect(await message(page)).toMatch(/Unknown command: MYL/);
});
