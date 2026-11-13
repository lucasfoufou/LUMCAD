import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import manifest from '../../src/mcp/commands.json' with { type: 'json' };
import { start, state, command, cancel, drawLine, messageMatchesKeys } from './helpers.js';

// Application shell: File menu, unsaved-changes prompt, import/export routing,
// save, settings, help palette and the command search.

const dxf = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nRoof\n10\n1000\n20\n2000\n11\n3000\n21\n4000\n0\nENDSEC\n0\nEOF\n';

async function waitForLocalRecovery(page) {
    // The drawing only exists in local recovery once autosave has written it.
    await expect(page.locator('.drawing-save-status')).toHaveClass(/is-warning/);
    await expect.poll(() => page.evaluate(() => Boolean(localStorage.getItem('lumcad.recovery.v1')))).toBe(true);
}

test('NEW on a drawing without a file: Cancel and Escape keep it, Don\'t save replaces it', async ({ page }) => {
    const errors = await start(page);
    await drawLine(page);
    await waitForLocalRecovery(page);
    const before = await state(page);
    const recovery = await page.evaluate(() => localStorage.getItem('lumcad.recovery.v1'));

    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^New/ }).click();
    const dialog = page.getByRole('dialog', { name: /Save changes to/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    let after = await state(page);
    expect(after.document.id).toBe(before.document.id);
    expect(after.document.content.entities).toEqual(before.document.content.entities);
    expect(messageMatchesKeys(after.editor.message, ['file.replaceCancelled'])).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('lumcad.recovery.v1'))).toBe(recovery);
    // Undo still has the line: nothing was replaced behind the user's back.
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);
    await command(page, 'REDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);

    await command(page, 'NEW');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect((await state(page)).document.id).toBe(before.document.id);

    await command(page, 'NEW');
    await dialog.getByRole('button', { name: 'Don’t save' }).click();
    await expect.poll(async () => (await state(page)).document.id).not.toBe(before.document.id);
    after = await state(page);
    expect(after.document.content.entities).toHaveLength(0);
    expect(errors).toEqual([]);
});

test('OPEN cancelled in the prompt keeps the drawing and never shows the file chooser', async ({ page }) => {
    await start(page);
    await drawLine(page);
    await waitForLocalRecovery(page);
    const before = await state(page);
    let chooser = false;
    page.on('filechooser', () => { chooser = true; });
    await page.keyboard.press('Control+o');
    const dialog = page.getByRole('dialog', { name: /Save changes to/ });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(chooser).toBe(false);
    expect((await state(page)).document.content.entities).toEqual(before.document.content.entities);
});

test('IMPORT routes a DXF to DXFIN in one undo step; OPEN of a DXF starts a new imported drawing', async ({ page }) => {
    await start(page);
    let choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Import/ }).click();
    await (await choosing).setFiles({ name: 'roof.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);
    const imported = (await state(page)).document.content.entities[0];
    expect([imported.x1, imported.y1, imported.x2, imported.y2]).toEqual([1, -2, 3, -4]);
    await command(page, 'UNDO');
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(0);

    choosing = page.waitForEvent('filechooser');
    await command(page, 'IMPORT');
    await (await choosing).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await expect.poll(async () => messageMatchesKeys((await state(page)).editor.message, ['import.unsupported'])).toBe(true);

    const before = await state(page);
    choosing = page.waitForEvent('filechooser');
    await command(page, 'OPEN');
    // The undone import may have reached local recovery: then the prompt asks first.
    const firstPrompt = page.getByRole('dialog', { name: /Save changes to/ });
    await firstPrompt.waitFor({ timeout: 1500 }).then(() => firstPrompt.getByRole('button', { name: 'Don’t save' }).click()).catch(() => {});
    await (await choosing).setFiles({ name: 'Toiture Dupont.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
    await expect.poll(async () => (await state(page))?.document.name).toBe('Toiture Dupont');
    const opened = await state(page);
    expect(opened.document.id).not.toBe(before.document.id);
    await expect.poll(async () => (await state(page)).document.content.entities.length).toBe(1);

    choosing = page.waitForEvent('filechooser');
    await command(page, 'OPEN');
    const prompt = page.getByRole('dialog', { name: /Save changes to/ });
    await prompt.getByRole('button', { name: 'Don’t save' }).click();
    await (await choosing).setFiles({ name: 'survey.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') });
    await expect.poll(async () => messageMatchesKeys((await state(page)).editor.message, ['file.openUnsupported'])).toBe(true);
    expect((await state(page)).document.id).toBe(opened.document.id);
});

test('EXPORT DXF writes a file; EXPORT DWG explains it needs the desktop app', async ({ page }) => {
    await start(page);
    await drawLine(page);
    const downloading = page.waitForEvent('download');
    await command(page, 'EXPORT DXF');
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.dxf$/);
    expect(await readFile(await download.path(), 'utf8')).toContain('LINE');
    await command(page, 'EXPORTER DWG');
    expect(messageMatchesKeys((await state(page)).editor.message, ['cad.error.cadDwgDesktop'])).toBe(true);
    await command(page, 'EXPORT');
    await expect(page.getByRole('menu', { name: 'Export' })).toBeVisible();
});

test('Ctrl+S and QSAVE save; Ctrl+, and OPTIONS FILES open Settings; F1 and HELP list every command', async ({ page }) => {
    await start(page);
    await drawLine(page);
    let downloading = page.waitForEvent('download');
    await page.locator('.drawing-canvas-svg').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+s');
    expect((await downloading).suggestedFilename()).toMatch(/\.lcad$/);
    downloading = page.waitForEvent('download');
    await command(page, 'QSAVE');
    await downloading;

    await page.keyboard.press('Control+,');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await command(page, 'OPTIONS FILES');
    await expect(page.locator('.lumcad-settings-nav [aria-current="page"]')).toHaveText('Files and DWG');
    await page.keyboard.press('Escape');

    await page.locator('.drawing-canvas-svg').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F1');
    const palette = page.getByRole('dialog', { name: 'All commands' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('circle');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect.poll(async () => (await state(page)).editor.activeTool).toBe('circle');
    await cancel(page);
    await command(page, '?');
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('option')).toHaveCount(manifest.length);
});

test('the command line finds French words and shows long replies in full', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('lumcad.settings.v1', JSON.stringify({ language: 'fr' })));
    await start(page);
    const input = page.locator('.drawing-command-bar input');
    await input.fill('importer');
    const names = await page.locator('.drawing-command-suggestions [role=option] strong').allInnerTexts();
    expect(names[0]).toBe('IMPORT');
    expect(names).toEqual(expect.arrayContaining(['DWGIN', 'DXFIN', 'PDFIMPORT']));
    await input.fill('calque');
    await expect(page.locator('.drawing-command-suggestions [role=option] strong').first()).toHaveText('LAYER');
    await input.fill('');
    await command(page, 'DWGIN');
    await expect(page.locator('.drawing-command-full-message')).toContainText('application de bureau');
    await page.locator('.drawing-command-prompt').click();
    await expect(page.locator('.drawing-command-log')).toContainText('> DWGIN');
});
