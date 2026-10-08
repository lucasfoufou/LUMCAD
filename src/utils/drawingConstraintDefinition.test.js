import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingGeometricConstraints, remapDrawingGeometricConstraints } from './drawingConstraintDefinition.js';
import { normalizeDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const entities = [{ id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0.2 },
    { id: 'b', type: 'line', layerId: 'geometry', x1: 4, y1: 0.2, x2: 4.2, y2: 3 }];
const constraints = [
    { id: 'horizontal', type: 'horizontal', refs: [{ entityId: 'a' }] },
    { id: 'joint', type: 'coincident', refs: [{ entityId: 'a', point: 'end' }, { entityId: 'b', point: 'start' }] },
    { id: 'fix', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] },
];

test('constraint catalog validates stable references without solving imperfect geometry', () => {
    const original = structuredClone(entities);
    const normalized = normalizeDrawingGeometricConstraints(constraints, entities);
    assert.deepEqual(normalized, constraints);
    assert.deepEqual(entities, original);
    assert.notEqual(normalized[2].values, constraints[2].values);
    assert.deepEqual(normalizeDrawingGeometricConstraints(undefined, entities), []);
});

test('invalid catalogs are rejected as a whole instead of silently losing relations', () => {
    for (const source of [null, {}, Array(257).fill(constraints[0]), [...constraints, constraints[0]],
        [{ ...constraints[0], type: 'future-relation' }],
        [{ ...constraints[0], refs: [{ entityId: 'missing' }] }],
        [{ ...constraints[1], refs: [{ entityId: 'a', point: 'missing' }, { entityId: 'b', point: 'start' }] }],
        [{ ...constraints[1], refs: [{ entityId: 'a', part: -1 }, { entityId: 'b' }] }],
        [{ ...constraints[2], values: [Infinity, 0] }],
        [{ ...constraints[2], values: [0] }],
        [{ ...constraints[0], internal: true }],
        [{ id: 'invalid-pair', type: 'parallel', refs: [{ entityId: 'a' }] }],
    ]) assert.equal(normalizeDrawingGeometricConstraints(source, entities), null);
    assert.throws(() => normalizeDrawingContent({ entities, geometricConstraints: [{ ...constraints[0], type: 'future-relation' }] }),
        error => error.key === 'errors.invalidGeometricConstraints' || error.message.includes('constraints'));
});

test('archive reopening preserves constraints and original coordinates exactly', () => {
    const document = createLcadDocument();
    document.content = normalizeDrawingContent({ ...document.content, entities, geometricConstraints: constraints });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.geometricConstraints, constraints);
    assert.deepEqual(loaded.content.entities, document.content.entities);
    assert.equal(loaded.content.entities[0].y2, 0.2);
    assert.equal(createLcadDocument().content.geometricConstraints, undefined);
});

test('definition copies remap only complete relationships and retain point selectors', () => {
    const partial = remapDrawingGeometricConstraints(constraints, new Map([['a', 'copy-a']]), id => `copy-${id}`);
    assert.deepEqual(partial.map(item => item.id), ['copy-horizontal', 'copy-fix']);
    assert.deepEqual(partial[1].refs, [{ entityId: 'copy-a', point: 'start' }]);
    const complete = remapDrawingGeometricConstraints(constraints, new Map([['a', 'copy-a'], ['b', 'copy-b']]), id => `copy-${id}`);
    assert.deepEqual(complete[1].refs, [{ entityId: 'copy-a', point: 'end' }, { entityId: 'copy-b', point: 'start' }]);
    complete[2].values[0] = 10;
    assert.equal(constraints[2].values[0], 0);
});
