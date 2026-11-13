import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
    start, state, command, cancel, entities, openDrawing, withContent, fit, pickEntities,
} from './helpers.js';
import { createDrawingLayout, createDrawingPageSetup, createDrawingViewport } from '../../src/utils/drawingLayouts.js';

// Layouts, viewports, page setups and every publication/export format. Files
// produced in the browser are downloaded and their bytes checked.

const sheets = document => {
    const base = withContent({ entities: [
        { id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'c1', type: 'circle', cx: 5, cy: 3, r: 2, color: '#ff0000' },
    ] })(document);
    const viewport = () => createDrawingViewport({ rect: { x: 20, y: 20, width: 180, height: 120 }, modelViewBox: { x: -2, y: -4, width: 16, height: 10 } });
    const layouts = [
        createDrawingLayout({ name: 'Plan', format: 'A4', viewports: [viewport()] }),
        createDrawingLayout({ name: 'Detail', format: 'A3', viewports: [viewport()] }),
    ];
    const pageSetups = [createDrawingPageSetup({ name: 'A3 portrait', format: 'A3', orientation: 'portrait' })];
    return { ...base, layouts, pageSetups };
};

async function open(page) {
    await start(page);
    await openDrawing(page, sheets);
    await fit(page);
    return state(page);
}
const editor = async page => (await state(page)).editor;
const layouts = async page => (await state(page)).document.layouts;
const activeLayout = async page => {
    const current = await state(page);
    return current.document.layouts.find(layout => layout.id === current.editor.activeLayoutId);
};

async function download(page, run) {
    const downloading = page.waitForEvent('download');
    await run();
    const file = await downloading;
    return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}
const pdfPages = bytes => (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

async function newViewport(page) {
    await command(page, 'PSPACE');
    await command(page, 'MVIEW');
    await command(page, '20,160');
    await command(page, '120,200');
    await expect.poll(async () => (await editor(page)).selectedViewportId).not.toBeNull();
    return (await editor(page)).selectedViewportId;
}

async function publishFromDialog(page, button = /Save PDF/) {
    await expect(page.locator('.drawing-publish-dialog')).toBeVisible();
    return download(page, () => page.locator('.drawing-publish-dialog').getByRole('button', { name: button }).click());
}

test('LAYOUT FOUR creates a layout with four viewports and opens it', async ({ page }) => {
    await open(page);
    await command(page, 'LAYOUT FOUR');
    const layout = await activeLayout(page);
    expect((await editor(page)).workspaceMode).toBe('layout');
    expect(layout.viewports).toHaveLength(4);
    expect(await layouts(page)).toHaveLength(3);
});

test('PAGESETUP opens the page controls and the paper format change applies', async ({ page }) => {
    await open(page);
    await command(page, 'PAGESETUP');
    const format = page.locator('.drawing-sidebar-field').filter({ hasText: 'Paper format' }).locator('select');
    await expect(format).toBeVisible();
    await format.selectOption('A2');
    await expect.poll(async () => (await activeLayout(page)).format).toBe('A2');
    await command(page, 'UNDO');
    await expect.poll(async () => (await activeLayout(page)).format).toBe('A4');
});

test('PSETOUT downloads page setups that PSETUPIN imports into another drawing', async ({ page }) => {
    await open(page);
    await command(page, 'PSPACE');
    const exported = await download(page, () => command(page, 'PSETOUT'));
    expect(exported.name).toMatch(/\.lcad$/);
    await command(page, 'NEW');
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'PSETUPIN');
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const path = join(await mkdtemp(join(tmpdir(), 'lumcad-setup-')), 'setups.lcad');
    await writeFile(path, exported.bytes);
    await (await choosing).setFiles(path);
    await expect.poll(async () => (await state(page)).document.pageSetups.length).toBeGreaterThan(0);
});

test('MODEL and PSPACE switch between model and the active layout', async ({ page }) => {
    await open(page);
    await command(page, 'PSPACE');
    expect((await editor(page)).workspaceMode).toBe('layout');
    expect((await activeLayout(page)).name).toBe('Plan');
    await command(page, 'MODEL');
    expect((await editor(page)).workspaceMode).toBe('model');
});

test('VPMAX maximises the selected viewport and VPMIN returns to the sheet', async ({ page }) => {
    await open(page);
    const id = await newViewport(page);
    await command(page, 'VPMAX');
    expect((await editor(page)).maximizedViewportId).toBe(id);
    await command(page, 'VPMIN');
    expect((await editor(page)).maximizedViewportId).toBeNull();
});

test('VPCLIP gives the selected viewport a clip boundary', async ({ page }) => {
    await open(page);
    const id = await newViewport(page);
    await command(page, 'VPCLIP');
    const viewport = (await activeLayout(page)).viewports.find(item => item.id === id);
    expect(viewport.clipBoundary).toBeTruthy();
    await command(page, 'UNDO');
    await expect.poll(async () => (await activeLayout(page)).viewports.find(item => item.id === id).clipBoundary ?? null).toBeNull();
});

test('VPLAYER freezes a layer in one viewport only', async ({ page }) => {
    await open(page);
    const id = await newViewport(page);
    await command(page, 'VPLAYER');
    const toggles = page.locator('.drawing-viewport-layers input[type="checkbox"]');
    await expect(toggles.first()).toBeVisible();
    await toggles.first().click();
    const viewport = (await activeLayout(page)).viewports.find(item => item.id === id);
    const firstLayer = (await state(page)).document.content.layers[0].id;
    expect(viewport.hiddenLayerIds).toContain(firstLayer);
    const others = (await activeLayout(page)).viewports.filter(item => item.id !== id);
    for (const other of others) expect(other.hiddenLayerIds || []).not.toContain(firstLayer);
});

test('ALIGNSPACE scales and centres a viewport on paper points', async ({ page }) => {
    await open(page);
    const id = await newViewport(page);
    await command(page, 'ALIGNSPACE 0 0 10 0 30 180 110 180');
    const viewport = (await activeLayout(page)).viewports.find(item => item.id === id);
    // 10 m of model now spans 80 mm of paper.
    expect(viewport.width / viewport.modelViewBox.width).toBeCloseTo(8, 6);
});

test('CHSPACE moves a model object onto the active layout paper', async ({ page }) => {
    await open(page);
    const paperBefore = (await layouts(page)).flatMap(layout => layout.paperEntities || []).map(entity => entity.id);
    await pickEntities(page, [{ x: 3, y: 0 }]);
    await command(page, 'CHSPACE');
    expect((await entities(page)).map(entity => entity.id)).toEqual(['c1']);
    const added = (await layouts(page)).flatMap(layout => layout.paperEntities || [])
        .filter(entity => !paperBefore.includes(entity.id));
    // Paper transfer wraps the native line in an editable block container.
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: 'blockReference', spaceTransfer: true });
    const container = (await state(page)).document.content.blocks.find(block => block.id === added[0].blockId);
    expect(container.entities.map(entity => entity.type)).toEqual(['line']);
});

test('EXPORTLAYOUT downloads the active layout as a separate drawing', async ({ page }) => {
    await open(page);
    await command(page, 'PSPACE');
    const file = await download(page, () => command(page, 'EXPORTLAYOUT'));
    expect(file.name).toMatch(/\.lcad$/);
    expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
});

test('PLOT writes a one-page PDF of the active layout', async ({ page }) => {
    await open(page);
    await command(page, 'PSPACE');
    await command(page, 'PLOT');
    const file = await publishFromDialog(page);
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPages(file.bytes)).toBe(1);
});

test('PDFALL writes every layout into one ordered PDF', async ({ page }) => {
    await open(page);
    await command(page, 'PDFALL');
    const file = await publishFromDialog(page);
    expect(pdfPages(file.bytes)).toBe(2);
});

test('PDFSELECTED writes only the selected layout tab', async ({ page }) => {
    await open(page);
    await command(page, 'PSPACE');
    await command(page, 'PDFSELECTED');
    const file = await publishFromDialog(page);
    expect(pdfPages(file.bytes)).toBe(1);
});

test('PUBLISH previews all layouts and writes a multi-page PDF', async ({ page }) => {
    await open(page);
    await command(page, 'PUBLISH');
    const file = await publishFromDialog(page);
    expect(pdfPages(file.bytes)).toBe(2);
});

const viewportScale = viewport => viewport.modelViewBox.width * 1000 / viewport.width;
const roof = withContent({ entities: [
    { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 30, height: 20 },
    { id: 'r2', type: 'line', x1: 0, y1: 0, x2: 30, y2: 20 },
] });

test('the standard arrangement selector places one viewport at a standard scale', async ({ page }) => {
    const errors = await start(page);
    await openDrawing(page, roof);
    await command(page, 'PSPACE');
    await page.locator('.drawing-layout-arrangement-field select').selectOption('single');
    await expect.poll(async () => (await activeLayout(page)).viewports.length).toBe(1);
    const [viewport] = (await activeLayout(page)).viewports;
    expect([1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 2000, 5000]).toContain(Math.round(viewportScale(viewport) * 1e6) / 1e6);
    expect(errors).toEqual([]);
});

test('PLOT from the model of a new drawing puts it on an A3 sheet at 1:100 with a title block', async ({ page }) => {
    await start(page);
    await openDrawing(page, roof);
    const before = await layouts(page);
    expect(before[0].viewports).toHaveLength(0);
    expect(before[0].format).toBe('A3');
    await command(page, 'PLOT');
    const dialog = page.locator('.drawing-publish-dialog');
    const setup = dialog.locator('.drawing-sheet-setup');
    await expect(setup).toBeVisible();
    await setup.getByLabel('Scale').selectOption('100');
    await dialog.getByRole('button', { name: 'Place on the sheet' }).click();
    await expect.poll(async () => (await layouts(page))[0].viewports.length).toBe(1);
    const [layout] = await layouts(page);
    const [viewport] = layout.viewports;
    expect(layout.format).toBe('A3');
    expect(layout.orientation).toBe('landscape');
    expect(viewport.locked).toBe(true);
    expect(viewportScale(viewport)).toBeCloseTo(100, 6);
    expect(viewport.modelViewBox.x + viewport.modelViewBox.width / 2).toBeCloseTo(15, 6);
    const texts = layout.paperEntities.filter(entity => entity.type === 'text').map(entity => entity.text);
    expect(texts).toEqual(expect.arrayContaining(['Drawing title', 'Scale', '1:100', 'A3']));
    await expect(dialog.locator('.drawing-publish-sheets')).toContainText('A3 landscape · 1:100');
    const file = await publishFromDialog(page);
    expect(pdfPages(file.bytes)).toBe(1);
    const mediaBox = /MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)/.exec(file.bytes.toString('latin1'));
    expect(Number(mediaBox[1])).toBeCloseTo(1190.55, 2);
    expect(Number(mediaBox[2])).toBeCloseTo(841.89, 2);
    await page.keyboard.press('Escape');
    // Saving remembers the plot settings (one step); the sheet setup itself is one more.
    await command(page, 'UNDO');
    expect((await layouts(page))[0].viewports).toHaveLength(1);
    await command(page, 'UNDO');
    await expect.poll(async () => (await layouts(page))[0].viewports.length).toBe(0);
    expect((await layouts(page))[0].paperEntities).toHaveLength(0);
});

test('VPSCALE sets the selected viewport to an exact standard scale', async ({ page }) => {
    await open(page);
    const id = await newViewport(page);
    await command(page, 'VPSCALE 1:50');
    await expect.poll(async () => viewportScale((await activeLayout(page)).viewports.find(item => item.id === id))).toBeCloseTo(50, 6);
    await command(page, 'UNDO');
    await expect.poll(async () => viewportScale((await activeLayout(page)).viewports.find(item => item.id === id))).not.toBeCloseTo(50, 6);
});

test('the wheel over a viewport zooms the paper, never the viewport scale', async ({ page }) => {
    await open(page);
    const id = await newViewport(page);
    const scale = viewportScale((await activeLayout(page)).viewports.find(item => item.id === id));
    const frame = await page.locator(`.drawing-layout-viewport-frame[data-layout-viewport-id="${id}"]`).boundingBox();
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.wheel(0, -300);
    await page.mouse.wheel(0, 300);
    expect(viewportScale((await activeLayout(page)).viewports.find(item => item.id === id))).toBeCloseTo(scale, 9);
});

test('dragging with the viewport tool creates one viewport and returns to selection', async ({ page }) => {
    await open(page);
    await command(page, 'PSPACE');
    const count = (await activeLayout(page)).viewports.length;
    await command(page, 'MVIEW');
    const box = await page.locator('.drawing-layout-stage svg').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => (await activeLayout(page)).viewports.length).toBe(count + 1);
    expect((await editor(page)).layoutTool).toBe('select');
    expect((await editor(page)).selectedViewportId).not.toBeNull();
    await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.65);
    expect((await activeLayout(page)).viewports.length).toBe(count + 1);
});

test('AUTOPUBLISH refuses an unsaved browser drawing without writing anything', async ({ page }) => {
    await open(page);
    let downloaded = false;
    page.on('download', () => { downloaded = true; });
    await command(page, 'AUTOPUBLISH');
    expect((await editor(page)).message).toMatch(/saved .*drawing/i);
    expect(downloaded).toBe(false);
});

test('DWFXOUT publishes a DWFx package with one page per layout', async ({ page }) => {
    await open(page);
    await command(page, 'DWFXOUT');
    const file = await publishFromDialog(page, /Save DWFx|Save/);
    expect(file.name).toMatch(/\.dwfx$/i);
    expect(file.bytes.subarray(0, 2).toString()).toBe('PK');
    expect((file.bytes.toString('latin1').match(/\.fpage/g) || []).length).toBeGreaterThanOrEqual(2);
});

test('PNGOUT WIDTH 256 downloads a PNG within 256 px', async ({ page }) => {
    await open(page);
    const file = await download(page, () => command(page, 'PNGOUT WIDTH 256'));
    expect(file.bytes.subarray(1, 4).toString()).toBe('PNG');
    // WIDTH is the pixel budget; the frame rounds to whole scene pixels.
    const width = file.bytes.readUInt32BE(16);
    expect(width).toBeLessThanOrEqual(256);
    expect(width).toBeGreaterThan(240);
});

test('JPGOUT downloads an opaque JPEG', async ({ page }) => {
    await open(page);
    const file = await download(page, () => command(page, 'JPGOUT WIDTH 256 BACKGROUND #ffffff'));
    expect([...file.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});

test('SVGOUT downloads an SVG containing the drawn geometry', async ({ page }) => {
    await open(page);
    const file = await download(page, () => command(page, 'SVGOUT WIDTH 256'));
    const svg = file.bytes.toString('utf8');
    expect(svg).toMatch(/<svg/);
    expect(svg).toMatch(/<(line|path|circle)/);
});

test('WMFOUT downloads a placeable WMF', async ({ page }) => {
    await open(page);
    const file = await download(page, () => command(page, 'WMFOUT'));
    expect(file.bytes.readUInt32LE(0)).toBe(0x9ac6cdd7);
});

test('STYLESMANAGER opens the plot style manager', async ({ page }) => {
    await open(page);
    await command(page, 'STYLESMANAGER');
    await expect(page.locator('.drawing-manager-window')).toBeVisible();
});

test('PLOTSTYLE SAVE and APPLY assign a named plot style to the selection', async ({ page }) => {
    await open(page);
    await command(page, 'PLOTSTYLE SAVE "Thin" - #000000 1 100 continuous');
    expect((await state(page)).document.content.plotStyles.map(style => style.name)).toContain('Thin');
    await pickEntities(page, [{ x: 3, y: 0 }]);
    await command(page, 'PLOTSTYLE APPLY "Thin"');
    expect((await entities(page))[0].plotStyleName).toBe('Thin');
});

test('CONVERTPSTYLES NAMED switches publication to named plot styles', async ({ page }) => {
    await open(page);
    await command(page, 'CONVERTPSTYLES NAMED');
    expect((await state(page)).document.content.settings.plotStyleMode).toBe('named');
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.settings.plotStyleMode).toBe('off');
});

test('CONVERTCTB converts colour rules to named plot assignments', async ({ page }) => {
    await open(page);
    await command(page, 'PLOTSTYLE SAVE "Red pen" #ff0000 #000000 2 100 -');
    await command(page, 'CONVERTCTB');
    const content = (await state(page)).document.content;
    expect(content.settings.plotStyleMode).toBe('named');
    expect(content.entities.find(entity => entity.id === 'c1').plotStyleName).toBe('Red pen');
    expect(content.entities.find(entity => entity.id === 'l1').plotStyleName).toBeUndefined();
});

test('NEWSHEETSET creates a sheet set index without touching the drawing', async ({ page }) => {
    const before = await open(page);
    await command(page, 'NEWSHEETSET "Project"');
    expect((await editor(page)).sheetSet).toMatchObject({ name: 'Project' });
    expect((await state(page)).document).toEqual(before.document);
});

test('OPENSHEETSET reads a sheet set index from the file chooser', async ({ page }) => {
    await open(page);
    await command(page, 'NEWSHEETSET "Project"');
    const saved = await download(page, () => command(page, 'SHEETSET SAVE'));
    await command(page, 'NEW');
    const choosing = page.waitForEvent('filechooser');
    await command(page, 'OPENSHEETSET');
    await (await choosing).setFiles({ name: saved.name, mimeType: 'application/json', buffer: saved.bytes });
    await expect.poll(async () => (await editor(page)).sheetSet?.name).toBe('Project');
});

test('SHEETSET REPORT and SAVE expose and download the sheet index', async ({ page }) => {
    await open(page);
    await command(page, 'NEWSHEETSET "Project"');
    await command(page, 'SHEETSET REPORT');
    expect((await editor(page)).sheetSet).toMatchObject({ name: 'Project' });
    const saved = await download(page, () => command(page, 'SHEETSET SAVE'));
    expect(JSON.parse(saved.bytes.toString('utf8'))).toMatchObject({ name: 'Project' });
});

test('ETRANSMIT reports that packaging needs the desktop application', async ({ page }) => {
    await open(page);
    await command(page, 'NEWSHEETSET "Project"');
    await command(page, 'ETRANSMIT');
    expect((await editor(page)).message).toMatch(/desktop/i);
});
