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
                fontSize: 0.8,
                horizontalAlign: 'center',
                verticalAlign: 'bottom',
            },
        },
    );

    assert.equal(text.text, '');
    assert.equal(text.fontSize, 0.8);
    assert.equal(text.horizontalAlign, 'center');
    assert.equal(text.verticalAlign, 'bottom');
});
