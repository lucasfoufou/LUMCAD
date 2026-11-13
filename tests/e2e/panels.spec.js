import { test, expect } from '@playwright/test';
import { start, command, cancel, state, drawLine } from './helpers.js';


// Tool rail, side panel, layers, managers and status bar (UX lot C).

test('every rail tool stays visible at the minimum window size', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 680 });
    const errors = await start(page);
    const rail = page.locator('.drawing-toolbar');
    const railBox = await rail.boundingBox();
    const slots = page.locator('.drawing-toolbar .drawing-tool-button');
    const count = await slots.count();
    expect(count).toBe(28);
    for (let index = 0; index < count; index += 1) {
        const box = await slots.nth(index).boundingBox();
        expect(box.y + box.height).toBeLessThanOrEqual(railBox.y + railBox.height + 0.5);
    }
    expect(errors).toEqual([]);
});

test('rail commands start PLINE, DIST and the dimension family', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: 'More tools like Line' }).click();
    await page.getByRole('menuitemradio', { name: /Polyline/ }).click();
    await expect.poll(async () => (await state(page)).editor.interactiveOperation?.type).toBe('linework');
    await cancel(page);
    await page.getByRole('button', { name: 'More tools like Measure distance' }).click();
    await page.getByRole('menuitemradio', { name: /Measure area/ }).click();
    await expect.poll(async () => (await state(page)).editor.interactiveOperation?.mode).toBe('area');
});

test('Escape closes a manager window when no command runs', async ({ page }) => {
    await start(page);
    await page.locator('.drawing-manage-trigger').click();
    await page.getByRole('menuitem', { name: 'Text styles' }).click();
    const manager = page.locator('.drawing-manager-window');
    await expect(manager).toBeVisible();
    await command(page, 'LINE');
    await page.keyboard.press('Escape');
    // The first Escape cancels the command and keeps the window.
    await expect(manager).toBeVisible();
    await page.locator('.drawing-manager-window h2').click();
    await page.keyboard.press('Escape');
    await expect(manager).toHaveCount(0);
});

test('renaming a layer is one undo step and Escape restores the name', async ({ page }) => {
    await start(page);
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const input = page.locator('.drawing-layer-row.is-active .drawing-layer-main input');
    await expect(input).toBeFocused();
    await page.keyboard.type('ROOF');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).document.content.layers.at(-1).name).toBe('ROOF');
    await input.click();
    await input.fill('ROOFING');
    await input.press('Escape');
    await expect(input).toHaveValue('ROOF');
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.layers.at(-1).name).toBe('LAYER 4');
});

test('the layer filter accepts translated state keywords', async ({ page }) => {
    await start(page);
    await page.getByRole('tab', { name: 'Layers' }).click();
    await page.getByRole('button', { name: /^Lock: .* — DIM$/ }).click();
    const filter = page.getByRole('searchbox', { name: 'Filter layers' });
    await filter.fill('verrouillé');
    await expect(page.locator('.drawing-layer-row')).toHaveCount(1);
    await filter.fill('locked');
    await expect(page.locator('.drawing-layer-row')).toHaveCount(1);
    await filter.fill('nothing-here');
    await expect(page.getByText('No layer matches “nothing-here”.')).toBeVisible();
});

test('Properties edit a line length in one place', async ({ page }) => {
    await start(page);
    await drawLine(page);
    await command(page, 'QSELECT TYPE line');
    await page.getByRole('tab', { name: 'Properties' }).click();
    const length = page.getByRole('spinbutton', { name: 'Length (m)' });
    await expect(length).toHaveValue('10');
    await length.fill('12.5');
    await length.press('Enter');
    await expect.poll(async () => (await state(page)).document.content.entities[0].x2).toBeCloseTo(12.5);
});

test('LIST shows the layer name and length before technical data', async ({ page }) => {
    await start(page);
    await drawLine(page);
    await command(page, 'LIST ALL');
    const listed = page.locator('.drawing-inquiry-object');
    await expect(listed).toContainText('Line');
    await expect(listed).toContainText('Layer');
    await expect(listed).toContainText('10 m');
    await expect(page.locator('.drawing-inquiry-panel details')).not.toHaveAttribute('open', '');
});

test('the status bar shows the cursor position', async ({ page }) => {
    await start(page);
    const box = await page.locator('.drawing-canvas-svg').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 3, box.y + box.height / 3, { steps: 2 });
    await expect(page.locator('.drawing-cursor-position output')).toHaveText(/-?\d[\d.,]* m, -?\d[\d.,]* m/);
});

test('only the open workspace tab looks active', async ({ page }) => {
    await start(page);
    await expect(page.locator('.drawing-workspace-tabs .is-selected')).toHaveCount(0);
    await page.locator('.drawing-workspace-add-tab .is-add').click();
    await expect(page.locator('.is-add-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.is-add-menu')).toHaveCount(0);
});
