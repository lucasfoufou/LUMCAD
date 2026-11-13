import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readDrawingDxf } from '../../src/utils/drawingDxfReader.js';
import { start, state, command, cancel, entities, clickWorld, screenPoint, openDrawing, withContent } from './helpers.js';

// The default "Y axis up (like AutoCAD)" preference, end to end. Stored
// coordinates keep Y pointing down the screen (.lcad, MCP); what the user
// types and reads has Y up and counter-clockwise angles. Every path asserts
// both the stored geometry and the value shown to the user.

const LANGUAGES = {
    fr: { separator: ';', cursor: '2 m ; 3 m', move: 'Déplacement de ΔX 3 m, ΔY 3 m appliqué.', rotate: 'Rotation de 30 ° appliquée.',
        settingsDialog: 'Paramètres', drawingSection: 'Dessin', yAxisLabel: 'Axe Y vers le haut (comme AutoCAD)', save: 'Enregistrer les paramètres' },
    en: { separator: ',', cursor: '2 m, 3 m', move: 'Move of ΔX 3 m, ΔY 3 m applied.', rotate: 'Rotation of 30 ° applied.',
        settingsDialog: 'Settings', drawingSection: 'Drawing', yAxisLabel: 'Y axis up (like AutoCAD)', save: 'Save settings' },
};

async function startIn(page, language) {
    await page.addInitScript(locale => localStorage.setItem('lumcad.settings.v1', JSON.stringify({ language: locale })), language);
    return start(page, { yAxisUp: true });
}

const lines = async page => (await entities(page)).filter(entity => entity.type === 'line');
const message = async page => (await state(page)).editor.message;
const field = (page, label) => page.locator('.drawing-creation-controls label').filter({ has: page.getByText(label, { exact: true }) }).locator('input');

async function expectPoint(actual, expected) {
    expect(actual.x).toBeCloseTo(expected.x, 6);
    expect(actual.y).toBeCloseTo(expected.y, 6);
}

for (const [language, text] of Object.entries(LANGUAGES)) {
    const pair = (x, y) => `${x}${text.separator}${y}`;

    test(`${language}: absolute, relative and polar points are typed with Y up and stored screen-down`, async ({ page }) => {
        const errors = await startIn(page, language);
        await command(page, 'LINE'); await command(page, pair(2, 3)); await command(page, `@${pair(0, 5)}`); await cancel(page);
        await command(page, 'LINE'); await command(page, pair(0, 0)); await command(page, '@4<90'); await command(page, '@3<0'); await cancel(page);
        await expect.poll(async () => (await lines(page)).length).toBe(3);
        const [vertical, polarUp, polarRight] = await lines(page);
        expect([vertical.x1, vertical.y1, vertical.x2, vertical.y2]).toEqual([2, -3, 2, -8]);
        await expectPoint({ x: polarUp.x2, y: polarUp.y2 }, { x: 0, y: -4 });
        await expectPoint({ x: polarRight.x2, y: polarRight.y2 }, { x: 3, y: -4 });

        // Properties read the same values back, and writing Y2 stores its mirror.
        await command(page, 'SELECT'); await clickWorld(page, { x: 2, y: -5 });
        await expect.poll(async () => (await state(page)).selection).toEqual([vertical.id]);
        await expect(field(page, 'Y1 (m)')).toHaveValue('3');
        await expect(field(page, 'Y2 (m)')).toHaveValue('8');
        await expect(field(page, 'Angle (°)')).toHaveValue('90');
        await field(page, 'Y2 (m)').fill('10');
        await field(page, 'Y2 (m)').blur();
        await expect.poll(async () => (await lines(page))[0].y2).toBe(-10);
        await expect(field(page, 'Y2 (m)')).toHaveValue('10');

        // The cursor position in the status bar reads Y up.
        await cancel(page);
        const target = await screenPoint(page, { x: 2, y: -3 });
        await page.mouse.move(target.x, target.y);
        await expect(page.locator('.drawing-cursor-position output')).toHaveText(text.cursor);
        // The UCS icon shows a plain Y pointing up.
        await expect(page.locator('.drawing-canvas-svg text').filter({ hasText: /^Y$/ })).toHaveCount(1);
        await expect(page.locator('.drawing-canvas-svg text').filter({ hasText: '−Y' })).toHaveCount(0);
        expect(errors).toEqual([]);
    });

    test(`${language}: MOVE and ROTATE take user offsets and angles and report them`, async ({ page }) => {
        await startIn(page, language);
        await command(page, 'LINE'); await command(page, pair(0, 0)); await command(page, pair(10, 0)); await cancel(page);
        await expect.poll(async () => (await lines(page)).length).toBe(1);
        await command(page, 'SELECT'); await clickWorld(page, { x: 5, y: 0 });
        await command(page, 'MOVE'); await command(page, pair(0, 0)); await command(page, `@${pair(3, 3)}`);
        await expect.poll(async () => message(page)).toBe(text.move);
        let [line] = await lines(page);
        expect([line.x1, line.y1, line.x2, line.y2]).toEqual([3, -3, 13, -3]);

        await command(page, 'ROTATE'); await command(page, pair(3, 3)); await command(page, '30');
        await expect.poll(async () => message(page)).toBe(text.rotate);
        [line] = await lines(page);
        // 30° counter-clockwise on screen: the stored end goes up, i.e. towards negative Y.
        await expectPoint({ x: line.x2, y: line.y2 }, { x: 3 + 10 * Math.cos(Math.PI / 6), y: -3 - 10 * Math.sin(Math.PI / 6) });
        await expect(field(page, 'Angle (°)')).toHaveValue('30');
        await expect(field(page, 'Y2 (m)')).toHaveValue('8');
    });
}

test('DIST and LIST report user coordinates; a Y ordinate dimension reads Y up', async ({ page }) => {
    await startIn(page, 'en');
    await openDrawing(page, withContent({ entities: [
        { id: 'roof', type: 'line', x1: 0, y1: 0, x2: 0, y2: -5 },
        { id: 'height', type: 'ordinateDimension', axis: 'y', origin: { x: 0, y: 0 }, featurePoint: { x: 4, y: -3 }, leaderPoint: { x: 6, y: -3 } },
    ] }), 'ordinate');
    await expect(page.locator('.drawing-dimension text')).toHaveText(/^3(\.0+)?( m)?$/);

    await command(page, 'DIST 0 0 3 4');
    const distance = (await state(page)).editor.inquiryResult;
    expect(distance).toMatchObject({ mode: 'distance', distance: 5, dx: 3, dy: 4 });
    expect(distance.angle).toBeCloseTo(53.130102, 5);
    await command(page, 'DIST'); await clickWorld(page, { x: 0, y: 0 }); await clickWorld(page, { x: 0, y: -5 });
    await expect.poll(async () => (await state(page)).editor.inquiryResult?.dy).toBe(5);
    expect((await state(page)).editor.inquiryResult.angle).toBe(90);

    await command(page, 'SELECT'); await clickWorld(page, { x: 0, y: -2 });
    await command(page, 'LIST');
    const listed = page.locator('.drawing-inquiry-object').first();
    await expect(listed.locator('dd').filter({ hasText: /^0 m, 5 m$/ })).toHaveCount(1);
    expect((await state(page)).editor.inquiryResult.objects[0]).toMatchObject({ id: 'roof', y2: -5 });
});

test('UCS SET and LIST use the user origin and a counter-clockwise rotation', async ({ page }) => {
    await startIn(page, 'en');
    await command(page, 'UCS SET 10 20 30');
    expect((await state(page)).document.content.settings.ucs).toEqual({ x: 10, y: -20, rotation: 330 });
    await command(page, 'UCS LIST');
    await expect.poll(async () => message(page)).toMatch(/^UCS origin: 10, 20; rotation: 30°/);
    await command(page, 'LINE'); await command(page, '0,0'); await command(page, '@2<0'); await cancel(page);
    const [line] = await lines(page);
    await expectPoint({ x: line.x1, y: line.y1 }, { x: 10, y: -20 });
    await expectPoint({ x: line.x2, y: line.y2 }, { x: 10 + 2 * Math.cos(Math.PI / 6), y: -20 - 2 * Math.sin(Math.PI / 6) });
});

test('MCP input keeps the stored frame while the user frame has Y up', async ({ page }) => {
    await startIn(page, 'en');
    const act = action => page.evaluate(value => window.__LUMCAD_E2E_STATE__.executeAction(value), action);
    await act({ type: 'command', command: 'line' });
    await act({ type: 'input', value: '2,3' });
    await act({ type: 'input', value: '@0,5' });
    await act({ type: 'escape' });
    await expect.poll(async () => (await lines(page)).length).toBe(1);
    const [line] = await lines(page);
    expect([line.x1, line.y1, line.x2, line.y2]).toEqual([2, 3, 2, 8]);
    // Typed by the user right after, the same input is read with Y up.
    await command(page, 'LINE'); await command(page, '2,3'); await command(page, '@0,5'); await cancel(page);
    await expect.poll(async () => (await lines(page)).length).toBe(2);
    expect((await lines(page))[1]).toMatchObject({ x1: 2, y1: -3, x2: 2, y2: -8 });
});

test('a DXF point at (10, 5) reads (10, 5) after import and is written back at (10, 5)', async ({ page }) => {
    await startIn(page, 'en');
    const dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nRoof\n10\n10\n20\n5\n11\n20\n21\n5\n0\nENDSEC\n0\nEOF\n';
    const chooser = page.waitForEvent('filechooser'); await command(page, 'DXFIN');
    await (await chooser).setFiles({ name: 'survey.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
    await expect.poll(async () => (await lines(page)).length).toBe(1);
    const [line] = await lines(page);
    expect([line.x1, line.y1, line.x2, line.y2]).toEqual([10, -5, 20, -5]);
    await command(page, 'SELECT'); await clickWorld(page, { x: 15, y: -5 });
    await expect(field(page, 'X1 (m)')).toHaveValue('10');
    await expect(field(page, 'Y1 (m)')).toHaveValue('5');
    await cancel(page);
    const download = page.waitForEvent('download'); await command(page, 'DXFOUT');
    const written = readDrawingDxf(await readFile(await (await download).path(), 'utf8'));
    expect(written.entities[0]).toMatchObject({ type: 'LINE', start: { x: 10, y: 5 }, end: { x: 20, y: 5 } });
});

test('turning the preference off in Settings restores the screen-down reading', async ({ page }) => {
    await startIn(page, 'fr');
    await command(page, 'OPTIONS');
    const dialog = page.getByRole('dialog', { name: LANGUAGES.fr.settingsDialog });
    await dialog.locator('.lumcad-settings-nav').getByText(LANGUAGES.fr.drawingSection, { exact: true }).click();
    const toggle = dialog.getByRole('checkbox', { name: new RegExp(`^${LANGUAGES.fr.yAxisLabel.replace(/[()]/g, '\\$&')}`) });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await dialog.getByRole('button', { name: LANGUAGES.fr.save }).click();
    await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('lumcad.settings.v1'))).drawingDefaults.yAxisUp).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await command(page, 'LINE'); await command(page, '0;0'); await command(page, '@0;5'); await cancel(page);
    await expect.poll(async () => (await lines(page)).length).toBe(1);
    expect((await lines(page))[0]).toMatchObject({ x2: 0, y2: 5 });
    await expect(page.locator('.drawing-canvas-svg text').filter({ hasText: '−Y' })).toHaveCount(1);
});

test('angles typed in commands turn counter-clockwise and read back the same', async ({ page }) => {
    await startIn(page, 'en');
    const rotationOf = entity => {
        const { a, b } = entity.transform;
        return ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360;
    };
    // INSERT rotation and insertion point.
    await command(page, 'LINE'); await command(page, '0,0'); await command(page, '10,0'); await cancel(page);
    await command(page, 'QSELECT LOCKED NO');
    await command(page, 'BLOCK "Panel" 0 0');
    await command(page, 'INSERT "Panel" 20 5 1 30');
    const reference = (await entities(page)).at(-1);
    expect(reference.transform.e).toBe(20);
    expect(reference.transform.f).toBe(-5);
    expect(rotationOf(reference)).toBeCloseTo(330, 6);
    await command(page, 'SELECT'); await clickWorld(page, { x: 20 + 5 * Math.cos(Math.PI / 6), y: -5 - 5 * Math.sin(Math.PI / 6) });
    await expect.poll(async () => (await state(page)).selection).toEqual([reference.id]);
    await expect(field(page, 'Rotation (°)')).toHaveValue('30');
    await cancel(page);

    // Additional polar angles are typed and listed in the user frame.
    await command(page, 'POLAR 45 30');
    expect((await state(page)).document.content.settings.polarAngles).toEqual([150]);
    await command(page, 'DSETTINGS');
    await expect(page.locator('input[placeholder="e.g. 15; 37.5"]')).toHaveValue('30');
    await page.keyboard.press('Escape');
    await cancel(page);

    // ARRAYPOLAR ANGLE: the fill angle is counter-clockwise and shown as typed.
    await command(page, 'LINE'); await command(page, '30,0'); await command(page, '32,0'); await cancel(page);
    const motif = (await lines(page)).at(-1);
    await page.evaluate(id => window.__LUMCAD_E2E_STATE__.executeAction({ type: 'selection', ids: [id] }), motif.id);
    await command(page, 'ARRAYPOLAR'); await command(page, '20,0'); await command(page, 'ANGLE 90');
    await expect.poll(async () => (await state(page)).editor.interactiveOperation?.angle).toBe(-90);
    await expect.poll(async () => message(page)).toMatch(/items over 90°/);
    await cancel(page);

    // LIMITS bounds are typed with Y up: (5, 5) is inside 0 0 10 10, (5, -5) is not.
    await cancel(page);
    await command(page, 'LIMITS 0 0 10 10');
    expect((await state(page)).document.content.settings.limits).toMatchObject({ minX: 0, minY: -10, maxX: 10, maxY: 0, enabled: true });
    const before = (await entities(page)).length;
    await command(page, 'POINT'); await command(page, '5,5'); await command(page, '5,-5'); await cancel(page);
    await expect.poll(async () => (await entities(page)).length).toBe(before + 1);
    expect((await entities(page)).at(-1)).toMatchObject({ type: 'point', x: 5, y: -5 });
});

test('Properties show a rectangle rotation and a circle centre in the user frame and write them back', async ({ page }) => {
    await startIn(page, 'fr');
    await openDrawing(page, withContent({ entities: [
        { id: 'panel', type: 'rectangle', x: 0, y: 0, width: 4, height: -2, rotation: 330, cornerStyle: 'square', cornerValue: 0 },
        { id: 'pole', type: 'circle', cx: 10, cy: -6, r: 1 },
    ] }), 'properties');
    await page.evaluate(() => window.__LUMCAD_E2E_STATE__.executeAction({ type: 'selection', ids: ['panel'] }));
    await page.locator('.drawing-creation-controls .drawing-creation-details-toggle').first().click();
    await expect(field(page, 'Rotation (°)')).toHaveValue('30');
    await expect(field(page, 'Y (m)')).toHaveValue('0');
    // The stored height runs down the screen (-2); read with Y up it is +2.
    await expect(field(page, 'Hauteur (m)')).toHaveValue('2');
    await field(page, 'Rotation (°)').fill('45');
    await field(page, 'Rotation (°)').blur();
    await expect.poll(async () => (await entities(page)).find(entity => entity.id === 'panel').rotation).toBeCloseTo(315, 6);
    await page.evaluate(() => window.__LUMCAD_E2E_STATE__.executeAction({ type: 'selection', ids: ['pole'] }));
    await page.locator('.drawing-creation-controls .drawing-creation-details-toggle').first().click();
    await expect(field(page, 'Centre Y (m)')).toHaveValue('6');
    await field(page, 'Centre Y (m)').fill('2');
    await field(page, 'Centre Y (m)').blur();
    await expect.poll(async () => (await entities(page)).find(entity => entity.id === 'pole').cy).toBe(-2);
});

test('DIMROTATED takes a counter-clockwise angle that the dimension panel shows back', async ({ page }) => {
    await startIn(page, 'en');
    await openDrawing(page, withContent({ entities: [{ id: 'edge', type: 'line', x1: 0, y1: 0, x2: 6, y2: 0 }] }), 'rotated');
    await command(page, 'DIMROTATED 30'); await clickWorld(page, { x: 3, y: 0 }); await command(page, ''); await cancel(page);
    const dimension = (await entities(page)).at(-1);
    expect(dimension).toMatchObject({ type: 'linearDimension', measurementMode: 'rotated' });
    expect(((dimension.dimensionAngle * 180 / Math.PI) + 360) % 360).toBeCloseTo(330, 6);
    await command(page, 'SELECT');
    await page.evaluate(id => window.__LUMCAD_E2E_STATE__.executeAction({ type: 'selection', ids: [id] }), dimension.id);
    await expect(page.locator('.drawing-dimension-fields label').filter({ hasText: 'Rotation (°)' }).locator('input').first()).toHaveValue('30');
});
