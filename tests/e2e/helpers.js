import { expect } from '@playwright/test';

export async function state(page) {
    return page.evaluate(() => window.__LUMCAD_E2E_STATE__?.getState());
}

export async function start(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
    await page.goto('/');
    await expect.poll(async () => Boolean(await state(page))).toBe(true);
    return errors;
}

export async function command(page, value) {
    const input = page.locator('.drawing-command-bar input');
    await input.fill(value);
    await input.press('Enter');
    await expect(input).toHaveValue('');
    // Wait for React handlers/geometry to commit; assertions below retry on state.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function cancel(page) {
    await page.locator('.drawing-command-bar input').press('Escape');
}

export async function drawLine(page) {
    await command(page, 'LINE');
    await command(page, '0,0');
    await command(page, '10,0');
    await cancel(page);
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
}
