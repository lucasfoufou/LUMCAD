import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../settings/appSettings.js';
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
            gridSpacing: 0.0001,
            tracking: true,
            angleUnit: 'degrees',
            clockwiseAngles: true,
            mirrorText: true,
        },
        mcp: { enabled: false, preferredPort: 1024 },
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
