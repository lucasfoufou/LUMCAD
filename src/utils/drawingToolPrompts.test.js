import assert from 'node:assert/strict';
import test from 'node:test';

import en from '../i18n/locales/en.js';
import fr from '../i18n/locales/fr.js';
import { drawingToolPromptKey, drawingToolPromptMessage } from './drawingToolPrompts.js';

test('common creation tools start with an actionable prompt showing a coordinate example', () => {
    for (const tool of ['line', 'rectangle', 'circle', 'arc', 'polygon', 'ellipse', 'spline', 'point', 'xline', 'ray']) {
        const key = drawingToolPromptKey(tool);
        assert.equal(key, `toolPrompt.${tool}`);
        assert.match(fr[key], /10;5/);
        assert.match(en[key], /10,5/);
    }
    assert.equal(drawingToolPromptKey('hatch'), 'messages.toolActive');
    const t = (key, values) => `${key}${values ? JSON.stringify(values) : ''}`;
    assert.equal(drawingToolPromptMessage('line', t), 'toolPrompt.line');
    assert.equal(drawingToolPromptMessage('pan', t), 'messages.toolActive{"tool":"commands.pan"}');
});
