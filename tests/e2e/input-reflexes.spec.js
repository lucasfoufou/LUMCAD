import { test, expect } from '@playwright/test';
import { start, state, command, cancel, entities, openDrawing, withContent, fit, screenPoint } from './helpers.js';

// Pointer and command-line reflexes: no click lost to the dynamic input, Enter
// never autoruns a prefix, and the AutoCAD gestures (ZOOM, E, Enter/Space
// repeat, right click, drag window, Ctrl+A) do what a CAD user expects.

const canvas = page => page.locator('.drawing-canvas-svg').first();

async function typeAndEnter(page, value) {
    const input = page.locator('.drawing-command-bar input');
    await input.click();
    await input.fill('');
    await input.pressSequentially(value);
    await input.press('Enter');
}

test('eight mouse-drawn rectangles are all created: the dynamic input never swallows a click', async ({ page }) => {
    await start(page);
    const box = await canvas(page).boundingBox();
    for (let index = 0; index < 8; index += 1) {
        await command(page, 'RECTANGLE');
        const x0 = box.x + 120 + index * 70;
        const y0 = box.y + 250;
        await page.mouse.move(x0, y0, { steps: 3 });
        await page.mouse.click(x0, y0);
        const x1 = x0 + 40 + index * 3;
        const y1 = y0 + 60 + index * 4;
        await page.mouse.move(x1, y1, { steps: 6 });
        const under = await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.drawing-dynamic-input')), [x1, y1]);
        expect(under).toBe(false);
        await page.mouse.click(x1, y1);
        await cancel(page);
    }
    await expect.poll(async () => (await entities(page)).filter(entity => entity.type === 'rectangle').length).toBe(8);
});

test('CIRCLE then a typed 2 creates a radius-2 circle instead of switching to 2P', async ({ page }) => {
    await start(page);
    await command(page, 'CIRCLE');
    await command(page, '4,6');
    await typeAndEnter(page, '2');
    await expect.poll(async () => (await entities(page)).find(entity => entity.type === 'circle')?.r).toBe(2);
});

test('Enter never runs a command prefix: E, ALL, SAVE and OP start nothing', async ({ page }) => {
    await start(page);
    let fileChooser = false;
    page.on('filechooser', () => { fileChooser = true; });
    for (const typed of ['ALL', 'SAVE', 'OP']) {
        await typeAndEnter(page, typed);
        const current = await state(page);
        expect(current.editor.activeTool).toBe('select');
        expect(current.editor.interactiveOperation).toBeFalsy();
        expect(current.editor.message).toMatch(/Unknown command/);
    }
    await typeAndEnter(page, 'E');
    expect((await state(page)).editor.activeTool).toBe('select');
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
    expect(fileChooser).toBe(false);
});

test('E erases the selection like ERASE', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [{ id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] }));
    await fit(page);
    await page.keyboard.press('ControlOrMeta+a');
    await expect.poll(async () => (await state(page)).selection.length).toBe(1);
    await command(page, 'E');
    await expect.poll(async () => (await entities(page)).length).toBe(0);
});

test('ZOOM, Z and ZOOM E/W are recognised and confirmed', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [{ id: 'l1', type: 'line', x1: 0, y1: 0, x2: 40, y2: 20 }] }));
    await command(page, 'ZOOM E');
    expect((await state(page)).editor.message).toMatch(/extents/);
    await command(page, 'Z 2');
    expect((await state(page)).editor.message).toMatch(/Zoom ×2/);
    await command(page, 'ZOOM');
    expect((await state(page)).editor.interactiveOperation?.type).toBe('zoom');
    const before = (await state(page)).editor.viewport.width;
    const first = await screenPoint(page, { x: 16, y: 8 });
    const second = await screenPoint(page, { x: 22, y: 11 });
    await page.mouse.click(first.x, first.y);
    await page.mouse.click(second.x, second.y);
    await expect.poll(async () => (await state(page)).editor.viewport.width).toBeLessThan(before);
    expect((await state(page)).editor.interactiveOperation).toBeFalsy();
    await command(page, 'ZOOM Q');
    expect((await state(page)).editor.message).toMatch(/ZOOM expects/);
});

test('right click ends LINE, then Enter on the idle canvas repeats it', async ({ page }) => {
    await start(page);
    const box = await canvas(page).boundingBox();
    await command(page, 'LINE');
    await page.mouse.click(box.x + 200, box.y + 200);
    await page.mouse.click(box.x + 400, box.y + 220);
    await page.mouse.click(box.x + 500, box.y + 300, { button: 'right' });
    await expect.poll(async () => (await state(page)).editor.activeTool).toBe('select');
    expect((await entities(page)).filter(entity => entity.type === 'line')).toHaveLength(1);
    await page.mouse.move(box.x + 600, box.y + 400);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).editor.activeTool).toBe('line');
});

test('right click on an idle selection opens a keyboard menu closed by Escape', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [{ id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] }));
    await fit(page);
    await page.keyboard.press('ControlOrMeta+a');
    const box = await canvas(page).boundingBox();
    await page.mouse.click(box.x + 300, box.y + 120, { button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /Move/ })).toBeVisible();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
});

test('press-drag-release selects through a window', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [
        { id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'l2', type: 'line', x1: 0, y1: 4, x2: 10, y2: 4 },
    ] }));
    await fit(page);
    // From one corner of the fitted view to the other, which encloses both lines.
    const box = await canvas(page).boundingBox();
    const from = { x: box.x + 15, y: box.y + 15 };
    const to = { x: box.x + box.width - 15, y: box.y + box.height - 15 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).selection.length).toBe(2);
});

test('COPY repeats until an empty Enter ends it', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [{ id: 'l1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }] }));
    await fit(page);
    await page.keyboard.press('ControlOrMeta+a');
    await command(page, 'COPY');
    await command(page, '0,0');
    await command(page, '0,5');
    await command(page, '0,10');
    await command(page, '');
    await expect.poll(async () => (await state(page)).editor.interactiveOperation).toBeFalsy();
    expect(await entities(page)).toHaveLength(3);
});
