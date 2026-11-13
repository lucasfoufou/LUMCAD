import assert from 'node:assert/strict';
import test from 'node:test';
import { entityHitsPoint } from './drawingSelection.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';

const dimension = { id: 'd', type: 'linearDimension', layerId: 'l', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, measurementMode: 'aligned', offset: 2, textSize: 1 };

test('a dimension is picked anywhere inside its label, not only on its lines', () => {
    const label = presentDrawingDimension(getDimensionGeometry(dimension), dimension, 1).label.point;
    // Inside the text body, well away from the dimension line and the frame outline.
    const inside = { x: label.x + 0.3, y: label.y - 0.6 };
    assert.equal(entityHitsPoint(dimension, inside, 0.01), true);
    assert.equal(entityHitsPoint(dimension, { x: 5, y: -5 }, 0.01), false);
});

test('free linear dimensions expose line, text and origin grips; the text grip moves only the label', async () => {
    const { getEntityGrips, editEntityGrip } = await import('./drawingSelection.js');
    const grips = getEntityGrips(dimension);
    assert.deepEqual(grips.map(grip => grip.id), ['dimension-position', 'dimension-text', 'dimension-origin-1', 'dimension-origin-2']);
    const text = grips.find(grip => grip.id === 'dimension-text');
    const moved = editEntityGrip(dimension, 'dimension-text', { x: text.x + 3, y: text.y - 4 });
    assert.equal(moved.offset, dimension.offset);
    assert.deepEqual(moved.p1, dimension.p1);
    const movedText = getEntityGrips(moved).find(grip => grip.id === 'dimension-text');
    assert.ok(Math.abs(movedText.x - text.x - 3) < 1e-9 && Math.abs(movedText.y - text.y + 4) < 1e-9);
    // The label left the dimension: a leader joins it back to the dimension line.
    const presented = presentDrawingDimension(getDimensionGeometry(moved), moved, 1);
    assert.ok(presented.lines.some(line => line.role === 'textLeader'));
    const origin = editEntityGrip(dimension, 'dimension-origin-2', { x: 12, y: 0 });
    assert.deepEqual(origin.p2, { x: 12, y: 0 });
});
