import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDrawingEntity } from './drawingEntityFactory.js';

test('text creation options are preserved by the shared entity factory', () => {
    const text = buildDrawingEntity(
        'text',
        { x: 1, y: 2 },
        { x: 5, y: 4 },
        'geometry',
        'text-options',
        {
            defaultText: 'Default',
            options: {
                text: '',
                textMode: 'singleLine',
                textStyleId: 'notes',
                fontFamily: 'serif',
                fontSize: 0.8,
                bold: true,
                italic: true,
                underline: true,
                strikethrough: true,
                horizontalAlign: 'center',
                verticalAlign: 'bottom',
            },
        },
    );

    assert.equal(text.text, '');
    assert.equal(text.textMode, 'singleLine');
    assert.equal(text.wrapMode, 'none');
    assert.equal(text.textStyleId, 'notes');
    assert.equal(text.fontFamily, 'serif');
    assert.equal(text.fontSize, 0.8);
    assert.equal(text.fontWeight, 700);
    assert.equal(text.fontStyle, 'italic');
    assert.equal(text.underline, true);
    assert.equal(text.strikethrough, true);
    assert.deepEqual(text.runs, []);
    assert.equal(text.horizontalAlign, 'center');
    assert.equal(text.verticalAlign, 'bottom');
});

test('legacy text creation defaults to a wrapped multiline frame', () => {
    const text = buildDrawingEntity(
        'text',
        { x: 0, y: 0 },
        { x: 2, y: 1 },
        'geometry',
        'legacy-text',
    );

    assert.equal(text.textMode, 'multiline');
    assert.equal(text.wrapMode, 'word');
    assert.equal(text.textStyleId, 'text-style-standard');
});
