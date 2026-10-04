import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { getDimensionGeometry, getDrawingEntityDependencyIds } from './drawingDimensions.js';
import { disassociateDrawingDimensions, reassociateDrawingDimensions, beginDimensionReassociation, pickDimensionReassociationSource } from './drawingDimensionAssociations.js';
import { translateEntity, rotateEntity, scaleEntity, mirrorEntity } from './drawingPrimitives.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

function fixture() {
    const content = createDefaultDrawingContent();
    const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 6, y2: 0 };
    const arc = { id: 'arc', type: 'arc', layerId: 'geometry', cx: 2, cy: 3, r: 4, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true };
    const dimensions = ['linearDimension', 'radialDimension', 'angularDimension', 'arcLengthDimension', 'ordinateDimension', 'centerMark'].map(type => ({ id: type, type, sourceId: type === 'linearDimension' || type === 'ordinateDimension' ? 'line' : 'arc', layerId: 'dimensions', dimensionStyleId: 'custom', offset: 1 }));
    return { ...content, entities: [line, arc, ...dimensions] };
}

test('dissociation preserves native geometry and identity for every dimension family after sources are removed', () => {
    const content = fixture(); const before = structuredClone(content);
    const ids = content.entities.slice(2).map(entity => entity.id);
    const detached = disassociateDrawingDimensions(content, ids).content;
    const sourceMap = new Map(content.entities.map(entity => [entity.id, entity]));
    for (const original of content.entities.slice(2)) {
        const result = detached.entities.find(entity => entity.id === original.id);
        assert.deepEqual(getDrawingEntityDependencyIds(result), []);
        assert.deepEqual(getDimensionGeometry(result), getDimensionGeometry(original, sourceMap), original.type);
        assert.equal(result.dimensionStyleId, original.dimensionStyleId);
    }
    assert.deepEqual(content, before);
    const isolated = normalizeDrawingContent({ ...detached, entities: detached.entities.slice(2) });
    assert.ok(isolated.entities.every(entity => getDimensionGeometry(entity)));
});

test('standalone radial sources follow translations, rotations, uniform scales and mirrors', () => {
    const content = disassociateDrawingDimensions(fixture(), ['radialDimension']).content;
    const radial = content.entities.find(entity => entity.id === 'radialDimension');
    const moved = getDimensionGeometry(translateEntity(radial, 10, 20));
    assert.deepEqual(moved.center, { x: 12, y: 23 });
    assert.equal(moved.value, 4);
    assert.equal(getDimensionGeometry(scaleEntity(radial, 2)).value, 8);
    assert.ok(getDimensionGeometry(scaleEntity(radial, { scaleX: 2, scaleY: 1 })));
    assert.ok(Math.abs(getDimensionGeometry(rotateEntity(radial, 90, { x: 0, y: 0 })).center.x + 3) < 1e-9);
    assert.equal(getDimensionGeometry(mirrorEntity(radial, { x: 0, y: 0 }, { x: 1, y: 0 })).center.y, -3);
});

test('detached sources survive archive normalization without unrelated source metadata', () => {
    const content = fixture(); content.entities[1].unrelatedMetadata = 'discard';
    const detached = disassociateDrawingDimensions(content, ['radialDimension', 'arcLengthDimension']).content;
    const document = createLcadDocument(); document.content = { ...detached, entities: detached.entities.filter(entity => entity.detachedSource).map(entity => ({ ...entity, dimensionTextOverride: 'Value: <>' })) };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.ok(restored.content.entities.every(entity => getDimensionGeometry(entity)));
    assert.ok(restored.content.entities.every(entity => !entity.detachedSource.id && !entity.detachedSource.unrelatedMetadata));
    assert.ok(restored.content.entities.every(entity => entity.dimensionTextOverride === 'Value: <>'));
});

test('locked and broken selections are rejected before any dimension is changed', () => {
    const content = fixture(); content.entities.at(-1).locked = true;
    assert.equal(disassociateDrawingDimensions(content, ['linearDimension', 'centerMark']).error, 'selection');
    content.entities[2].sourceId = 'missing';
    assert.equal(disassociateDrawingDimensions(content, ['linearDimension', 'radialDimension']).error, 'geometry');
    assert.equal(content.entities[3].sourceId, 'arc');
});

test('reassociation replaces detached snapshots and follows new sources without changing style or ID', () => {
    const content = disassociateDrawingDimensions(fixture(), ['radialDimension']).content;
    content.entities.push({ id: 'new-circle', type: 'circle', layerId: 'geometry', cx: 10, cy: 20, r: 8 });
    const result = reassociateDrawingDimensions(content, ['radialDimension'], ['new-circle']).content;
    const dimension = result.entities.find(entity => entity.id === 'radialDimension');
    assert.equal(dimension.detachedSource, undefined);
    assert.deepEqual(getDrawingEntityDependencyIds(dimension), ['new-circle']);
    assert.equal(getDimensionGeometry(dimension, new Map(result.entities.map(entity => [entity.id, entity]))).value, 8);
    assert.equal(dimension.dimensionStyleId, 'custom');
    assert.equal(reassociateDrawingDimensions(content, ['radialDimension', 'linearDimension'], ['new-circle']).error, 'geometry');
});


test('interactive reassociation waits for two angular sources and commits only a valid complete pair', () => {
    const content = fixture();
    content.entities.push({ id: 'vertical', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 5 });
    const before = structuredClone(content);
    const start = beginDimensionReassociation(content, ['angularDimension']).operation;
    const pending = pickDimensionReassociationSource(content, start, 'line');
    assert.equal(pending.operation.stage, 'second-source');
    assert.equal(pending.content, undefined);
    assert.equal(pickDimensionReassociationSource(content, pending.operation, 'line').error, 'geometry');
    const result = pickDimensionReassociationSource(content, pending.operation, 'vertical').content;
    assert.deepEqual(result.entities.find(entity => entity.id === 'angularDimension').sourceIds, ['line', 'vertical']);
    assert.deepEqual(content, before);
    assert.equal(beginDimensionReassociation(content, ['missing']).error, 'selection');
    assert.equal(pickDimensionReassociationSource(content, start, 'missing').error, 'geometry');
});

test('interactive reassociation can repair missing references and revalidates locks at commit', () => {
    const content = fixture();
    const dimension = content.entities.find(entity => entity.id === 'linearDimension');
    dimension.sourceId = 'missing';
    const operation = beginDimensionReassociation(content, [dimension.id]).operation;
    const result = pickDimensionReassociationSource(content, operation, 'line').content;
    assert.equal(result.entities.find(entity => entity.id === dimension.id).sourceId, 'line');
    dimension.locked = true;
    assert.equal(pickDimensionReassociationSource(content, operation, 'line').error, 'selection');
});


test('detached radial and center dimensions follow nonuniform affine blocks with exact ellipse snapshots', async () => {
    const { transformDrawingEntityAffine, transformAffinePoint } = await import('./drawingBlocks.js');
    const detached = disassociateDrawingDimensions(fixture(), ['radialDimension', 'centerMark']).content;
    const radial = detached.entities.find(entity => entity.id === 'radialDimension');
    const center = detached.entities.find(entity => entity.id === 'centerMark');
    const matrix = { a: 2, b: 0.5, c: 0.3, d: -1, e: 20, f: 30 };
    const before = getDimensionGeometry(radial);
    const transformed = transformDrawingEntityAffine(radial, matrix);
    assert.equal(transformed.detachedSource.type, 'ellipse');
    const geometry = getDimensionGeometry(transformed);
    const expectedEdge = transformAffinePoint(before.edge, matrix);
    assert.ok(Math.hypot(geometry.edge.x - expectedEdge.x, geometry.edge.y - expectedEdge.y) < 1e-8);
    assert.deepEqual(geometry.center, transformAffinePoint(before.center, matrix));
    assert.ok(Math.abs(geometry.value - Math.hypot(expectedEdge.x - geometry.center.x, expectedEdge.y - geometry.center.y)) < 1e-8);
    assert.deepEqual(getDimensionGeometry(transformDrawingEntityAffine(center, matrix)).center, geometry.center);
    const document = createLcadDocument();
    document.content.entities = [transformed, transformDrawingEntityAffine(center, matrix)];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(getDimensionGeometry(restored.content.entities[0]).edge, geometry.edge);
    const scaled = scaleEntity(radial, { scaleX: 2, scaleY: 1, origin: { x: 0, y: 0 } });
    const scaledGeometry = getDimensionGeometry(scaled);
    assert.ok(Math.abs(scaledGeometry.edge.x - before.edge.x * 2) < 1e-8);
    assert.ok(Math.abs(scaledGeometry.edge.y - before.edge.y) < 1e-8);
});

test('exploding an affinely transformed block keeps detached dimensions in world coordinates', async () => {
    const { explodeDrawingEntities } = await import('./drawingCompoundOperations.js');
    const { materializeDrawingBlockReference } = await import('./drawingBlocks.js');
    const content = disassociateDrawingDimensions(fixture(), ['radialDimension', 'centerMark']).content;
    const entities = content.entities.filter(entity => ['radialDimension', 'centerMark'].includes(entity.type));
    const block = { id: 'detached-block', name: 'Detached', entities };
    const reference = { id: 'reference', type: 'blockReference', blockId: block.id, layerId: 'geometry', transform: { a: 2, b: 0, c: 0, d: 1, e: 20, f: 30 } };
    const document = { ...content, blocks: [block], entities: [reference] };
    const materialized = materializeDrawingBlockReference(reference, [block]);
    for (const entity of materialized) assert.deepEqual(getDimensionGeometry(entity).center, { x: 24, y: 33 });
    const result = explodeDrawingEntities(document, [reference.id]);
    const exploded = result.content || result;
    assert.equal(exploded.entities.length, 2);
    for (const entity of exploded.entities) assert.deepEqual(getDimensionGeometry(entity).center, { x: 24, y: 33 });
});

test('disassociation and reassociation remove all series metadata without changing the measured endpoints', () => {
    const content = fixture();
    const entity = content.entities.find(item => item.type === 'linearDimension');
    Object.assign(entity, { seriesId: 'series', seriesMode: 'baseline', seriesIndex: 3, seriesAxis: { x: 1, y: 0 }, baselineEnd: 'last', baselineReference: { sourceId: 'line', pointIndex: 0 } });
    for (const result of [disassociateDrawingDimensions(content, [entity.id]), reassociateDrawingDimensions(content, [entity.id], ['line'])]) {
        const updated = result.content.entities.find(item => item.id === entity.id);
        for (const key of ['seriesId', 'seriesMode', 'seriesIndex', 'seriesAxis', 'baselineEnd', 'baselineReference']) assert.equal(updated[key], undefined, key);
        assert.equal(getDimensionGeometry(updated, new Map(result.content.entities.map(item => [item.id, item]))).value, 6);
    }
});
