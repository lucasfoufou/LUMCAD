import { expect } from '@playwright/test';
import en from '../../src/i18n/locales/en.js';
import { createLcadDocument, createLcadEnvelope } from '../../src/utils/lcadDocument.js';
import { createLcadArchive } from '../../src/utils/lcadArchive.js';

const templatePatterns = new Map();

/** Matches a rendered message against translation templates, treating {{values}} as wildcards. */
export function messageMatchesKeys(message, keys, catalog = en) {
    return keys.some(key => {
        if (typeof catalog[key] !== 'string') return false;
        if (!templatePatterns.has(catalog[key])) {
            const escaped = catalog[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            templatePatterns.set(catalog[key], new RegExp(`^${escaped.replace(/\\\{\\\{\w+\\\}\\\}/g, '[\\s\\S]*?')}$`));
        }
        return templatePatterns.get(catalog[key]).test(message);
    });
}

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

export async function entities(page) {
    return (await state(page)).document.content.entities;
}

/** Waits until the probe reports a stable value, then returns it. */
export async function settled(page, read) {
    let value;
    await expect.poll(async () => { value = await read(await state(page)); return value !== undefined && value !== null; }).toBe(true);
    return value;
}

/**
 * Opens a drawing built in Node through the real OPEN file chooser. `build`
 * receives a blank document and returns the fixture document.
 */
export async function openDrawing(page, build, name = 'fixture') {
    const document = build(createLcadDocument({ name }));
    const bytes = createLcadArchive(createLcadEnvelope(document));
    const chooser = page.waitForEvent('filechooser');
    await command(page, 'OPEN');
    await (await chooser).setFiles({ name: `${name}.lcad`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    const ids = document.content.entities.map(entity => entity.id);
    await expect.poll(async () => (await state(page))?.document.content.entities.map(entity => entity.id)).toEqual(ids);
    return (await state(page)).document;
}

/** Fixture helper: replaces the model entities (and optional content fields) of a blank document. */
export function withContent(patch) {
    return document => {
        const layerId = document.content.activeLayerId;
        const entities = (patch.entities || []).map(entity => ({ layerId, ...entity }));
        return { ...document, ...(patch.document || {}), content: { ...document.content, ...patch, entities } };
    };
}

/** Screen position of a world point on the model canvas (xMidYMid meet viewBox). */
export async function screenPoint(page, point) {
    // The probe reports the view centre and size; the SVG viewBox starts at its corner.
    const view = (await state(page)).editor.viewport;
    const viewBox = { x: view.x - view.width / 2, y: view.y - view.height / 2, width: view.width, height: view.height };
    const box = await page.locator('.drawing-canvas-svg').boundingBox();
    const scale = Math.min(box.width / viewBox.width, box.height / viewBox.height);
    const offsetX = (box.width - viewBox.width * scale) / 2;
    const offsetY = (box.height - viewBox.height * scale) / 2;
    return { x: box.x + offsetX + (point.x - viewBox.x) * scale, y: box.y + offsetY + (point.y - viewBox.y) * scale };
}

export async function clickWorld(page, point, options = {}) {
    const target = await screenPoint(page, point);
    await page.mouse.click(target.x, target.y, options);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * Selects exactly the entities under the given points: Escape clears the
 * current selection, then each select-tool click adds one object (PICKADD).
 */
export async function pickEntities(page, points) {
    await cancel(page);
    await command(page, 'SELECT');
    for (const point of points) await clickWorld(page, point);
    await expect.poll(async () => (await state(page)).selection.length).toBe(points.length);
}

/** Window selection (click, click) of everything fully inside the two corners. */
export async function windowSelect(page, first, second) {
    await cancel(page);
    await command(page, 'SELECT');
    await clickWorld(page, first);
    await clickWorld(page, second);
}

/** Fits the model view so world-coordinate clicks land on visible geometry. */
export async function fit(page) {
    await command(page, 'EXTENTS');
    await page.waitForTimeout(400);
}

export async function undoRestores(page, before) {
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities).toEqual(before);
}

/**
 * Runs command-line steps (strings) or custom steps (async functions receiving
 * the page) and returns the entities that were added, in document order.
 */
export async function runSteps(page, steps) {
    const before = new Set((await entities(page)).map(entity => entity.id));
    for (const step of steps) {
        if (typeof step === 'function') await step(page);
        else await command(page, step);
    }
    return (await entities(page)).filter(entity => !before.has(entity.id));
}

/** Undo restores `before` exactly, then redo restores `after` exactly. */
export async function expectUndoRedo(page, before, after) {
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
    await command(page, 'REDO');
    await expect.poll(async () => entities(page)).toEqual(after);
}

/** Replaces the content of the open in-place text editor and commits it. */
export async function typeInTextEditor(page, lines) {
    const editor = page.locator('.drawing-text-editor__content');
    await expect(editor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    for (const [index, line] of lines.entries()) {
        if (index) await page.keyboard.press('Enter');
        await page.keyboard.type(line);
    }
    await page.keyboard.press(lines.length > 1 ? 'ControlOrMeta+Enter' : 'Enter');
    await expect(editor).toHaveCount(0);
}
