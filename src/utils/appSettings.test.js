import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_APP_SETTINGS, normalizeAppSettings, normalizeTemplatePath } from '../settings/appSettings.js';
import { createLcadDocument } from './lcadDocument.js';

test('application settings use safe complete defaults', () => {
    assert.deepEqual(normalizeAppSettings(), DEFAULT_APP_SETTINGS);
    assert.equal(DEFAULT_APP_SETTINGS.language, 'en');
    assert.equal(DEFAULT_APP_SETTINGS.drawingDefaults.designer, '');
    assert.equal(DEFAULT_APP_SETTINGS.drawingDefaults.angleUnit, 'degrees');
    assert.equal(DEFAULT_APP_SETTINGS.drawingDefaults.clockwiseAngles, false);
    assert.equal(DEFAULT_APP_SETTINGS.drawingDefaults.mirrorText, false);
    assert.equal(DEFAULT_APP_SETTINGS.mcp.enabled, true);
    assert.equal(DEFAULT_APP_SETTINGS.mcp.preferredPort, 43622);
});

test('application settings normalize persisted and user-entered values', () => {
    assert.deepEqual(normalizeAppSettings({
        language: 'fr-FR',
        autosaveDelayMs: 20,
        drawingDefaults: {
            designer: `  ${'L'.repeat(140)}  `,
            gridSpacing: 0,
            tracking: 1,
            angleUnit: 'turns',
            clockwiseAngles: 1,
            mirrorText: true,
        },
        mcp: { enabled: false, preferredPort: 80 },
    }), {
        version: 1,
        language: 'fr',
        autosaveDelayMs: 300,
        drawingDefaults: {
            designer: 'L'.repeat(120),
            templatePath: '',
            gridSpacing: 0.0001,
            tracking: true,
            angleUnit: 'degrees',
            clockwiseAngles: true,
            mirrorText: true,
        },
        mcp: { enabled: false, preferredPort: 1024 },
        cadInterchange: { libredwgDirectory: '' },
        commandAliases: [],
        commandShortcuts: DEFAULT_APP_SETTINGS.commandShortcuts,
    });
});

test('new drawing preferences are applied without changing the .lcad schema', () => {
    const document = createLcadDocument({
        gridSpacing: 0.001,
        tracking: true,
    });
    assert.equal(document.content.settings.gridSpacing, 0.001);
    assert.equal(document.content.settings.tracking, true);
    assert.equal(document.content.version, 1);
});

test('quick-new templates persist only bounded absolute .lcad locations', () => {
    for (const path of ['/templates/office.lcad', 'C:\\templates\\office.lcad', '\\\\server\\share\\office.LCAD']) {
        assert.equal(normalizeTemplatePath(` ${path} `), path);
        assert.equal(normalizeAppSettings({ drawingDefaults: { templatePath: path } }).drawingDefaults.templatePath, path);
    }
    for (const path of [null, {}, 'office.lcad', '/templates/file.dwt', '/bad\u0000.lcad', `/${'a'.repeat(4096)}.lcad`]) {
        assert.equal(normalizeTemplatePath(path), '');
    }
});

test('the LibreDWG folder preference keeps only absolute directories', () => {
    for (const path of ['/opt/homebrew/bin', 'C:\\Tools\\LibreDWG']) {
        assert.equal(normalizeAppSettings({ cadInterchange: { libredwgDirectory: ` ${path} ` } }).cadInterchange.libredwgDirectory, path);
    }
    for (const path of ['bin', '/bad\nfolder', 42]) {
        assert.equal(normalizeAppSettings({ cadInterchange: { libredwgDirectory: path } }).cadInterchange.libredwgDirectory, '');
    }
});


test('personal aliases persist normalized targets and invalid settings cannot shadow built-ins', () => {
    const settings = normalizeAppSettings({ commandAliases: [{ alias: ' myline ', command: 'LINE' }] });
    assert.deepEqual(normalizeAppSettings(JSON.parse(JSON.stringify(settings))), settings);
    assert.deepEqual(settings.commandAliases, [{ alias: 'MYLINE', command: 'line' }]);
    assert.deepEqual(normalizeAppSettings({ commandAliases: [{ alias: 'L', command: 'circle' }] }).commandAliases, []);
});

test('shortcut preferences retain explicit empty and rebind states across settings normalization', () => {
    assert.deepEqual(normalizeAppSettings({ commandShortcuts: [] }).commandShortcuts, []);
    const custom = [{ shortcut: 'alt+F7', command: '@toggleOrtho' }];
    const settings = normalizeAppSettings({ commandShortcuts: custom });
    assert.deepEqual(normalizeAppSettings(JSON.parse(JSON.stringify(settings))), settings);
    assert.deepEqual(settings.commandShortcuts, [{ shortcut: 'ALT+F7', command: '@toggleOrtho' }]);
    assert.deepEqual(normalizeAppSettings({ commandShortcuts: [{ shortcut: 'F8', command: '@missing' }] }).commandShortcuts, DEFAULT_APP_SETTINGS.commandShortcuts);
});
