import { getEntityBounds } from './drawingGeometry.js';
import { applyCurrentStyleToNewDimensions, saveDimensionStyle } from './drawingDimensionStyles.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getDimensionGeometry } from './drawingDimensions.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';

function linear() {
    return getDimensionGeometry({ type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2 });
}

test('extension gaps and overruns alter only presentation and preserve measurements', () => {
    const original = linear(); const before = structuredClone(original);
    const rendered = presentDrawingDimension(original, { extensionGap: 0.2, extensionOverrun: 0.4 });
    const extension = rendered.lines.find(line => line.role === 'extension');
    assert.equal(Math.hypot(extension.start.x, extension.start.y), 0.2);
    assert.equal(Math.hypot(extension.end.x, extension.end.y), 2.4);
    assert.equal(rendered.value, 10); assert.deepEqual(original, before);
    assert.equal(presentDrawingDimension(original, { extensionGap: 5 }).lines.filter(line => line.role === 'extension').length, 0);
});

test('closed arrows point at the measured endpoints with bases inside the dimension line', () => {
    const geometry = linear();
    const rendered = presentDrawingDimension(geometry, { arrowType: 'closed', arrowSize: 0.5 });
    assert.equal(rendered.markers[0].type, 'polygon');
    assert.deepEqual(rendered.markers[0].points[1], geometry.ticks[0].point);
    assert.ok(rendered.markers[0].points[0].x > geometry.ticks[0].point.x);
    assert.ok(rendered.markers[1].points[0].x < geometry.ticks[1].point.x);
    assert.equal(presentDrawingDimension(geometry, { arrowType: 'open' }).markers[0].type, 'polyline');
    assert.equal(presentDrawingDimension(geometry, { arrowType: 'none' }).markers.length, 0);
    assert.equal(presentDrawingDimension(geometry, { arrowSize: 0 }).markers.length, 0);
});

test('styled bounds include extension overruns and draft creation uses the same style as commit', () => {
    const dimension = { id: 'draft', type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, offset: 2, extensionOverrun: 3 };
    assert.ok(getEntityBounds(dimension).maxY >= 5);
    let content = saveDimensionStyle(createDefaultDrawingContent(), { id: 'custom', name: 'Custom', values: { arrowType: 'open', textSize: 0.8 } }).content;
    content = { ...content, activeDimensionStyleId: 'custom' };
    const draftContent = { ...content, entities: [dimension] };
    const preview = applyCurrentStyleToNewDimensions(draftContent, content).entities[0];
    const committed = applyCurrentStyleToNewDimensions(draftContent, content).entities[0];
    assert.deepEqual(preview, committed);
    assert.equal(preview.textSize, 0.8);
    const copy = { ...dimension, previewMode: 'copy', textSize: 0.25 };
    assert.equal(applyCurrentStyleToNewDimensions({ ...content, entities: [copy] }, content).entities[0].textSize, 0.25);
});
