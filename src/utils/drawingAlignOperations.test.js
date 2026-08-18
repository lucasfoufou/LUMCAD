import assert from 'node:assert/strict';
import test from 'node:test';

import {
    alignDrawingEntities,
    createAlignPreviewEntities,
    previewAlignDrawingContent,
    resolveAlignTransform,
    transformAlignPoint,
} from './drawingAlignOperations.js';
import { createDefaultDrawingContent } from './drawingDocument.js';

const EPSILON = 1e-8;

test('two-pair alignment resolves translation and rotation without changing scale', () => {
    const translation = resolveAlignTransform([
        pair(0, 0, 5, -3),
        pair(2, 0, 7, -3),
    ]);
    assert.equal(translation.valid, true);
    approximately(translation.angleDegrees, 0);
    approximately(translation.scaleFactor, 1);
    pointApproximately(transformAlignPoint({ x: 1, y: 4 }, translation), { x: 6, y: 1 });

    const rotation = resolveAlignTransform([
        pair(0, 0, 4, 5),
        pair(2, 0, 4, 7),
    ]);
    assert.equal(rotation.valid, true);
    approximately(rotation.angleDegrees, 90);
    pointApproximately(transformAlignPoint({ x: 1, y: 1 }, rotation), { x: 3, y: 6 });
});

test('uniform scaling is optional and reversed directions resolve as a rotation', () => {
    const pairs = [pair(0, 0, 2, 1), pair(2, 0, 2, 7)];
    const rigid = resolveAlignTransform(pairs);
    const scaled = resolveAlignTransform(pairs, { scale: true });
    assert.equal(rigid.valid, true);
    assert.equal(scaled.valid, true);
    approximately(rigid.scaleFactor, 1);
    approximately(scaled.scaleFactor, 3);
    pointApproximately(transformAlignPoint({ x: 2, y: 0 }, rigid), { x: 2, y: 5 });
    pointApproximately(transformAlignPoint({ x: 2, y: 0 }, scaled), { x: 2, y: 7 });

    const reversed = resolveAlignTransform([pair(0, 0, 4, 3), pair(2, 0, 2, 3)]);
    assert.equal(reversed.valid, true);
    approximately(Math.abs(reversed.angleDegrees), 180);
    pointApproximately(transformAlignPoint({ x: 1, y: 2 }, reversed), { x: 3, y: 1 });
});

test('all three pairs influence the least-squares rigid transform', () => {
    const firstTwo = [pair(-1, 0, -1, 0), pair(1, 0, 1, 0)];
    const allThree = [...firstTwo, pair(0, 2, 1, 2)];
    const twoPairTransform = resolveAlignTransform(firstTwo);
    const threePairTransform = resolveAlignTransform(allThree);
    assert.equal(threePairTransform.valid, true);
    assert.ok(threePairTransform.angleDegrees < -10);
    assert.ok(Math.abs(threePairTransform.destinationCenter.x - 1 / 3) < EPSILON);
    assert.ok(totalSquaredError(allThree, threePairTransform) < totalSquaredError(allThree, twoPairTransform));

    const exact = [
        pair(0, 0, 5, -2),
        pair(2, 0, 5, 2),
        pair(0, 3, -1, -2),
    ];
    const exactTransform = resolveAlignTransform(exact, { scale: true });
    assert.equal(exactTransform.valid, true);
    approximately(exactTransform.scaleFactor, 2);
    approximately(exactTransform.angleDegrees, 90);
    approximately(exactTransform.rmsError, 0);
});

test('invalid, non-finite, and degenerate point sets are rejected without previews', () => {
    assert.equal(resolveAlignTransform([pair(0, 0, 1, 1)]).reason, 'pair-count');
    assert.equal(resolveAlignTransform([
        pair(0, 0, 1, 1),
        { source: { x: Number.NaN, y: 0 }, destination: { x: 2, y: 2 } },
    ]).reason, 'non-finite');
    assert.equal(resolveAlignTransform([
        pair(0, 0, 1, 1),
        pair(0, 0, 2, 2),
    ]).reason, 'source-degenerate');
    assert.equal(resolveAlignTransform([
        pair(0, 0, 1, 1),
        pair(2, 0, 1, 1),
    ]).reason, 'destination-degenerate');

    const content = createDefaultDrawingContent();
    content.entities = [line('line', 0, 0, 1, 0)];
    const invalidPairs = [pair(0, 0, 1, 1)];
    assert.equal(previewAlignDrawingContent(content, ['line'], invalidPairs), content);
    assert.deepEqual(createAlignPreviewEntities(content, ['line'], invalidPairs), []);
});

test('drawing alignment preserves native types and stable entity identities', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        line('line', 0, 0, 2, 0),
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 1, cy: 1, r: 0.5 },
        { id: 'rectangle', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 2, height: 1, rotation: 0 },
        { id: 'arc', type: 'arc', layerId: 'geometry', cx: 2, cy: 1, r: 1, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true },
    ];
    const result = alignDrawingEntities(
        content,
        content.entities.map(entity => entity.id),
        [pair(0, 0, 3, 4), pair(1, 0, 3, 6)],
        { scale: true },
    );
    assert.equal(result.changed, true);
    assert.deepEqual(result.content.entities.map(entity => entity.id), ['line', 'circle', 'rectangle', 'arc']);
    assert.deepEqual(result.content.entities.map(entity => entity.type), ['line', 'circle', 'rectangle', 'arc']);
    pointApproximately(lineStart(result.content.entities[0]), { x: 3, y: 4 });
    pointApproximately(lineEnd(result.content.entities[0]), { x: 3, y: 8 });
    approximately(result.content.entities[1].r, 1);
    assert.deepEqual(content.entities[0], line('line', 0, 0, 2, 0));
});

test('document application skips locked selections and transforms editable dependencies', () => {
    const content = createDefaultDrawingContent();
    content.layers.push({
        id: 'locked-layer', name: 'LOCKED', color: '#172033', lineWeight: 1,
        lineType: 'continuous', transparency: 0, visible: true, locked: true,
    });
    content.entities = [
        line('source', 0, 0, 2, 0),
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'source', offset: 0.6 },
        { ...line('locked', 0, 2, 2, 2), layerId: 'locked-layer' },
    ];
    const result = alignDrawingEntities(
        content,
        ['source', 'locked'],
        [pair(0, 0, 10, 5), pair(2, 0, 10, 9)],
        { scale: true },
    );
    assert.equal(result.changed, true);
    assert.deepEqual(result.selectedIds, ['source']);
    assert.deepEqual(result.content.entities.map(entity => entity.id), ['source', 'dimension', 'locked']);
    const source = result.content.entities.find(entity => entity.id === 'source');
    const dimension = result.content.entities.find(entity => entity.id === 'dimension');
    const locked = result.content.entities.find(entity => entity.id === 'locked');
    pointApproximately(lineStart(source), { x: 10, y: 5 });
    pointApproximately(lineEnd(source), { x: 10, y: 9 });
    assert.equal(dimension.sourceId, 'source');
    approximately(dimension.offset, 1.2);
    assert.deepEqual(locked, content.entities.find(entity => entity.id === 'locked'));

    const previews = createAlignPreviewEntities(
        content,
        ['source'],
        [pair(0, 0, 10, 5), pair(2, 0, 10, 9)],
        { scale: true },
    );
    assert.deepEqual(previews.map(entity => entity.id), ['align-preview-source', 'align-preview-dimension']);
    assert.equal(previews[1].sourceId, 'align-preview-source');
    assert.ok(previews.every(entity => entity.previewMode === 'align'));
});

function pair(sourceX, sourceY, destinationX, destinationY) {
    return {
        source: { x: sourceX, y: sourceY },
        destination: { x: destinationX, y: destinationY },
    };
}

function line(id, x1, y1, x2, y2) {
    return { id, type: 'line', layerId: 'geometry', x1, y1, x2, y2 };
}

function lineStart(entity) {
    return { x: entity.x1, y: entity.y1 };
}

function lineEnd(entity) {
    return { x: entity.x2, y: entity.y2 };
}

function totalSquaredError(pairs, transform) {
    return pairs.reduce((sum, current) => {
        const transformed = transformAlignPoint(current.source, transform);
        return sum + (transformed.x - current.destination.x) ** 2 + (transformed.y - current.destination.y) ** 2;
    }, 0);
}

function pointApproximately(actual, expected, tolerance = EPSILON) {
    approximately(actual.x, expected.x, tolerance);
    approximately(actual.y, expected.y, tolerance);
}

function approximately(actual, expected, tolerance = EPSILON) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}
