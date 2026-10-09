import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDrawingAliases, expandDrawingAlias, normalizeDrawingShortcut, drawingShortcutFromEvent,
    validateDrawingCommandShortcuts, formatDrawingShortcut } from './drawingCommandPreferences.js';

test('personal aliases preserve quoted arguments and reject ambiguous or chained definitions', () => {
    const input = [{ alias: ' imageperso ', command: 'PNGOUT' }];
    const aliases = validateDrawingAliases(input);
    assert.deepEqual(aliases, [{ alias: 'IMAGEPERSO', command: 'pngOut' }]);
    assert.equal(expandDrawingAlias('imageperso TO "/tmp/a b.png" WIDTH 512', aliases), 'PNGOUT TO "/tmp/a b.png" WIDTH 512');
    assert.equal(expandDrawingAlias('12,4 5', aliases), '12,4 5');
    assert.equal(input[0].alias, ' imageperso ');
    for (const rows of [
        [{ alias: 'L', command: 'circle' }],
        [{ alias: 'CIRCLE', command: 'line' }],
        [{ alias: 'CUSTOM', command: 'CUSTOM2' }],
        [{ alias: '123', command: 'line' }],
        [{ alias: 'CUSTOM', command: 'line' }, { alias: 'custom', command: 'circle' }],
    ]) assert.throws(() => validateDrawingAliases(rows));
});

test('portable command shortcuts detect normalized conflicts and preserve typing and composition', () => {
    assert.equal(normalizeDrawingShortcut('shift+mod+k'), 'MOD+SHIFT+K');
    assert.equal(drawingShortcutFromEvent({ key: 'k', metaKey: true, shiftKey: true }), 'MOD+SHIFT+K');
    assert.equal(drawingShortcutFromEvent({ key: 'k', ctrlKey: true, shiftKey: true }), 'MOD+SHIFT+K');
    assert.equal(drawingShortcutFromEvent({ key: 'k' }), null);
    assert.equal(drawingShortcutFromEvent({ key: 'k', metaKey: true, isComposing: true }), null);
    assert.equal(drawingShortcutFromEvent({ key: 'Escape' }), null);
    assert.throws(() => normalizeDrawingShortcut('Mod+Mod+K'));
    assert.throws(() => validateDrawingCommandShortcuts([{ shortcut: 'Mod+K', command: 'line' }], ['MOD+K']));
    assert.throws(() => validateDrawingCommandShortcuts([
        { shortcut: 'Shift+Mod+K', command: 'line' }, { shortcut: 'mod+shift+k', command: 'circle' },
    ]));
    assert.deepEqual(validateDrawingCommandShortcuts([{ shortcut: 'alt+F6', command: 'LINE' }]),
        [{ shortcut: 'ALT+F6', command: 'line' }]);
});

test('existing actions can be rebound, removed and restored without hidden shortcut collisions', async () => {
    const { DEFAULT_DRAWING_SHORTCUTS } = await import('./drawingCommandPreferences.js');
    assert.deepEqual(validateDrawingCommandShortcuts(DEFAULT_DRAWING_SHORTCUTS), DEFAULT_DRAWING_SHORTCUTS);
    const rebound = DEFAULT_DRAWING_SHORTCUTS.map(row => row.shortcut === 'F8' ? { ...row, shortcut: 'Alt+F7' } : row);
    assert.ok(validateDrawingCommandShortcuts(rebound).some(row => row.shortcut === 'ALT+F7' && row.command === '@toggleOrtho'));
    assert.deepEqual(validateDrawingCommandShortcuts([]), []);
    assert.throws(() => validateDrawingCommandShortcuts([...DEFAULT_DRAWING_SHORTCUTS, { shortcut: 'F8', command: 'line' }]));
    for (const shortcut of ['MOD+Q', 'MOD+W', 'MOD+S', 'ALT+F4']) assert.throws(() => normalizeDrawingShortcut(shortcut));
    assert.throws(() => validateDrawingCommandShortcuts([{ shortcut: 'F6', command: '@missing' }]));
});

test('shortcut display is localized to platform while persisted bindings remain portable', () => {
    assert.equal(formatDrawingShortcut('MOD+SHIFT+K', 'MacIntel'), 'Cmd + Shift + K');
    assert.equal(formatDrawingShortcut('MOD+ALT+K', 'Win32'), 'Ctrl + Alt + K');
    assert.equal(formatDrawingShortcut('F8', 'Linux'), 'F8');
    assert.equal(drawingShortcutFromEvent({ key: 'Dead', altKey: true }), null);
    assert.equal(drawingShortcutFromEvent({ key: 'k', ctrlKey: true, metaKey: true }), null);
});
