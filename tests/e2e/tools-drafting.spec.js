import { test, expect } from '@playwright/test';
import { start, state, command, cancel, entities, clickWorld, runSteps } from './helpers.js';

// Drafting settings change point input: each test sets the mode through the
// front, then proves its effect on the coordinates actually created.

const settings = async page => (await state(page)).document.content.settings;

test('POLAR 45 snaps a pointer-drawn segment onto the 45° increment', async ({ page }) => {
    await start(page);
    await command(page, 'POLAR 45');
    expect(await settings(page)).toMatchObject({ polarTracking: true, polarIncrement: 45 });
    await command(page, 'LINE');
    await command(page, '10,10');
    await clickWorld(page, { x: 15, y: 14.7 });
    await cancel(page);
    const [line] = await entities(page);
    const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI;
    expect(Math.abs(((angle % 45) + 45) % 45)).toBeLessThan(1e-6);
});

test('DSETTINGS opens the drafting settings and a polar change applies', async ({ page }) => {
    await start(page);
    await command(page, 'DSETTINGS');
    const panel = page.locator('.drawing-status-popover, [role="dialog"], .drawing-drafting-settings').filter({ hasText: /polar/i }).first();
    await expect(panel).toBeVisible();
    await command(page, 'POLAR 30');
    expect((await settings(page)).polarIncrement).toBe(30);
});

test('UNITS DISPLAY mm formats distances in millimetres', async ({ page }) => {
    await start(page);
    await command(page, 'UNITS DISPLAY mm PRECISION 1');
    expect((await settings(page)).units).toMatchObject({ display: 'mm', precision: 1 });
    await command(page, 'DIST 0 0 3 4');
    // The inquiry keeps metres internally; the Measurements panel shows display units.
    expect((await state(page)).editor.inquiryResult).toMatchObject({ distance: 5, dx: 3, dy: 4 });
    await expect(page.getByText(/^5[,\s\u202f]?000(\.0)? mm$/).first()).toBeVisible();
    await command(page, 'UNDO');
    await expect.poll(async () => (await settings(page)).units?.display ?? 'm').toBe('m');
});

test('UCS SET rotates and moves typed coordinates; UCS WORLD restores them', async ({ page }) => {
    await start(page);
    await command(page, 'UCS SET 10 0 90');
    const [rotated] = await runSteps(page, ['LINE', '1,0', '2,0']);
    await cancel(page);
    expect(rotated).toMatchObject({ x1: 10, y1: 1, x2: 10, y2: 2 });
    await command(page, 'UCS WORLD');
    const [world] = await runSteps(page, ['LINE', '1,0', '2,0']);
    await cancel(page);
    expect(world).toMatchObject({ x1: 1, y1: 0, x2: 2, y2: 0 });
});

test('UCSICON OFF hides the UCS indicator and ON shows it again', async ({ page }) => {
    await start(page);
    await command(page, 'UCSICON OFF');
    expect((await settings(page)).ucsIcon).toBe(false);
    await command(page, 'UCSICON ON');
    expect((await settings(page)).ucsIcon).toBe(true);
});

test('LIMITS refuses points outside the bounds until LIMITS OFF', async ({ page }) => {
    await start(page);
    await command(page, 'LIMITS 0 0 10 10');
    await runSteps(page, ['POINT', '20,20']);
    expect(await entities(page)).toEqual([]);
    expect((await state(page)).editor.message).toMatch(/outside the drawing limits/i);
    await runSteps(page, ['POINT', '5,5']);
    expect(await entities(page)).toHaveLength(1);
    await cancel(page);
    await command(page, 'LIMITS OFF');
    await runSteps(page, ['POINT', '20,20']);
    await cancel(page);
    expect((await entities(page)).map(point => [point.x, point.y])).toEqual([[5, 5], [20, 20]]);
});
