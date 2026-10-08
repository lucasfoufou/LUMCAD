import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDrawingSketch, appendDrawingSketch, drawingSketchEntities, commitDrawingSketch } from './drawingSketch.js';
import { createDefaultDrawingContent } from './drawingDocument.js';

test('sketch increment follows travelled distance independent of pointer event subdivisions', () => {
    const start = beginDrawingSketch({ x: 0, y: 0 }, 1);
    const single = appendDrawingSketch(start, { x: 3.5, y: 0 });
    let subdivided = start;
    for (const x of [0.2, 0.7, 1, 1.9, 3.5]) subdivided = appendDrawingSketch(subdivided, { x, y: 0 });
    assert.deepEqual(single.points, subdivided.points);
    assert.deepEqual(single.points.map(point => point.x), [0, 1, 2, 3]);
    assert.equal(drawingSketchEntities(single, 'geometry')[0].points.at(-1).x, 3.5);
    assert.equal(start.points.length, 1);
});

test('sketch can output independent lines in one atomic document change', () => {
    const sketch = appendDrawingSketch(beginDrawingSketch({ x: 0, y: 0 }, 1, 'lines'), { x: 2.5, y: 0 });
    const content = createDefaultDrawingContent();
    const result = commitDrawingSketch(content, sketch);
    assert.equal(result.content.entities.length, 3);
    assert.ok(result.content.entities.every(entity => entity.type === 'line'));
    assert.equal(content.entities.length, 0);
    assert.equal(new Set(result.selectedIds).size, 3);
});

test('sketch rejects invalid steps, empty strokes and oversized sample sequences', () => {
    assert.equal(beginDrawingSketch({ x: 0, y: 0 }, 0), null);
    const start = beginDrawingSketch({ x: 0, y: 0 }, 0.001);
    assert.deepEqual(drawingSketchEntities(start, 'geometry'), []);
    const huge = appendDrawingSketch(start, { x: 100, y: 0 });
    assert.equal(huge.overflow, true);
    assert.equal(commitDrawingSketch(createDefaultDrawingContent(), huge).error, 'limit');
});

test('sketch native geometry survives archive storage without introducing a new entity type', async () => {
    const { createLcadDocument, createLcadEnvelope } = await import('./lcadDocument.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const document = createLcadDocument();
    let sketch = beginDrawingSketch({ x: 0, y: 0 }, 0.2);
    sketch = appendDrawingSketch(sketch, { x: 2, y: 1 });
    sketch = appendDrawingSketch(sketch, { x: 3, y: 0 });
    document.content = commitDrawingSketch(document.content, sketch).content;
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.entities, document.content.entities);
});
