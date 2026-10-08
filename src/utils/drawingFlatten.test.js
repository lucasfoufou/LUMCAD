import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { flattenDrawingEntities, parseDrawingFlattenInput } from './drawingFlatten.js';

const contentOf = entities => ({ ...createDefaultDrawingContent(), entities });
test('FLATTEN projects elevation onto XY without altering identity, appearance, relationships or semantic data', () => {
    const entity = { id: 'path', layerId: 'geometry', type: 'polyline', elevation: 12, thickness: 2,
        points: [{ x: 1, y: 2, z: 3 }, { x: 5, y: 6, z: -2 }], metadata: { z: 42 }, color: '#abcdef' };
    const content = contentOf([entity]); content.geometricConstraints = [{ id: 'c', type: 'horizontal', refs: [{ entityId: 'path' }] }];
    const saved = structuredClone(content);
    const result = flattenDrawingEntities(content, ['path']);
    assert.deepEqual(result.content.entities[0], { ...entity, elevation: 0, thickness: 0, points: entity.points.map(point => ({ ...point, z: 0 })) });
    assert.deepEqual(result.content.geometricConstraints, content.geometricConstraints);
    assert.equal(result.report.flattened, 1); assert.deepEqual(content, saved);
    assert.equal(flattenDrawingEntities(result.content, ['path']).changed, false);
});

test('FLATTEN traverses native compound/source geometry and protects shared blocks and locked objects', () => {
    const compound = { id: 'mixed', type: 'polyline', layerId: 'geometry', parts: [
        { type: 'line', x1: 1, y1: 2, z1: 3, x2: 4, y2: 5, z2: -1 },
        { type: 'arc', cx: 4, cy: 6, cz: 9, r: 1, startAngle: 0, endAngle: 1 },
    ] };
    const content = contentOf([compound, { ...compound, id: 'locked', locked: true }, { id: 'ref', type: 'blockReference', layerId: 'geometry', blockId: 'shared', elevation: 9 }]);
    const result = flattenDrawingEntities(content, ['mixed', 'locked', 'ref']);
    assert.equal(result.report.protected, 2);
    assert.equal(result.content.entities[0].parts[0].z1, 0);
    assert.equal(result.content.entities[0].parts[1].cz, 0);
    assert.deepEqual(result.content.entities.slice(1), content.entities.slice(1));
});

test('FLATTEN refuses unsupported OCS orientation, invalid elevation and traversal overflow atomically', () => {
    const line = { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0, z1: 3 };
    assert.deepEqual(flattenDrawingEntities(contentOf([line, { ...line, id: 'b', normal: { x: 0, y: 1, z: 0 } }]), ['a', 'b']), { error: 'orientation' });
    assert.deepEqual(flattenDrawingEntities(contentOf([{ ...line, z1: NaN }]), ['a']), { error: 'invalid' });
    assert.deepEqual(flattenDrawingEntities(contentOf([line, { ...line, id: 'b' }]), ['a', 'b'], { maxVisits: 1 }), { error: 'limit' });
    assert.deepEqual(parseDrawingFlattenInput('PREVIEW ALL'), { all: true, preview: true });
    assert.equal(parseDrawingFlattenInput('ALL ALL'), null);
});
