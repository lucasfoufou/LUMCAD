import { test, expect } from '@playwright/test';
import expectations from './catalog-expectations.json' with { type: 'json' };
import manifest from '../../src/mcp/commands.json' with { type: 'json' };
import { start, command, state } from './helpers.js';

// Baseline coverage for EVERY registered command. Exact observed prompts/stages
// are reviewed snapshots; these are entry/precondition tests, not geometry proofs.
// Behavioral workflows are in workflows.spec.js and are reported separately.
const inputs = {
    pngOut: 'WIDTH 64', jpegOut: 'WIDTH 64', svgOut: 'WIDTH 64',
    drawingCompare: 'REPORT', contentBrowser: 'OPEN', layerFilter: 'DIM', recover: 'REPORT', recoverAll: 'REPORT',
    quickCalc: '2+3', zoom: '2',
};

test('catalog coverage has an explicit reviewed expectation for every command', () => {
    expect(Object.keys(expectations).sort()).toEqual(manifest.map(item => item.command).sort());
});

for (const definition of manifest) {
    test(`${definition.name} — command entry and preconditions`, async ({ page }) => {
        const errors = await start(page);
        const before = await state(page);
        let fileChooser = false;
        let download = false;
        page.on('filechooser', () => { fileChooser = true; });
        page.on('download', () => { download = true; });
        await command(page, [definition.name, inputs[definition.command]].filter(Boolean).join(' '));
        const panels = { attributeManager: 'Library', attributeDefine: 'Library', attributeEdit: 'Properties', blockSearch: 'Library', layerFilter: 'Layers' };
        if (panels[definition.command]) {
            await expect(page.getByRole('tab', { name: panels[definition.command], exact: true })).toHaveAttribute('aria-selected', 'true');
        }
        // Async file output and page changes settle through a visible prompt,
        // chooser/download, or command state, rather than an arbitrary screenshot.
        await expect.poll(async () => {
            const current = await state(page);
            return Boolean(current && (current.editor.message || current.editor.activeTool !== 'select'
                || current.editor.interactiveOperation || fileChooser || download || panels[definition.command]
                || await page.locator('[role="dialog"]').count()
                || ['select', 'new', 'quickNew', 'fit', 'zoom', 'delete', 'undo', 'redo', 'modelSpace', 'pan', 'creationPanel', 'imageAttach'].includes(definition.command)));
        }).toBe(true);
        const current = await state(page);
        expect(current).toBeTruthy();
        if (['plot', 'pdf', 'pdfAll', 'pdfSelected', 'publish', 'dwfx'].includes(definition.command)) {
            await expect(page.locator('.drawing-publish-dialog')).toBeVisible();
        }
        if (definition.command === 'aliasEdit') await expect(page.locator('.lumcad-settings-dialog')).toBeVisible();
        if (definition.command === 'styleManager') await expect(page.locator('.drawing-manager-window')).toBeVisible();
        if (definition.command === 'layerFilter') await expect(page.locator('.drawing-sidebar input').first()).toHaveValue('DIM');
        if (['new', 'quickNew'].includes(definition.command)) expect(current.document.id).not.toBe(before.document.id);
        if (definition.command === 'zoom') expect(current.editor.viewport.width).not.toBe(before.editor.viewport.width);
        expect(current.editor.message).not.toMatch(/Unknown command|Commande inconnue|\{\w+\}/);
        expect(errors).toEqual([]);
        const result = {
            activeTool: current.editor.activeTool,
            operation: current.editor.interactiveOperation?.type || null,
            stage: current.editor.interactiveOperation?.stage || null,
            workspace: current.editor.workspaceMode,
            layoutTool: current.editor.layoutTool,
            message: current.editor.message.replace(/\b\d{4}-\d\d-\d\d[^ ]*/g, '<date>'),
            entities: current.document.content.entities.length,
            fileChooser,
        };
        expect(result).toEqual(expectations[definition.command]);
    });
}
