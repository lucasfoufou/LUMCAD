import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { drawingExportEntities } from './drawingExportEntities.js';
import { exportDrawingWmf } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { attachDrawingReference } from './drawingReferences.js';
import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const ref = (blockId, transform = identity) => ({ id: `ref-${blockId}`, type: 'blockReference', layerId: 'geometry', blockId, transform });
const edge = { id: 'edge', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0, color: '#cc2211' };

function source() {
    const content = createDefaultDrawingContent();
    content.blocks = [{ id: 'inner', entities: [edge] }, { id: 'outer', entities: [ref('inner', { ...identity, a: 2, d: 3, e: 1 })] }];
    content.entities = [ref('outer', { a: 0, b: 1, c: -1, d: 0, e: 10, f: 20 })];
    return content;
}

test('flat export composes nested nonuniform transforms and retains appearance without mutation', () => {
    const content = source(); const before = structuredClone(content);
    const [entity] = drawingExportEntities(content);
    assert.deepEqual([entity.x1, entity.y1, entity.x2, entity.y2], [10, 21, 10, 25]);
    assert.equal(entity.color, '#cc2211'); assert.deepEqual(content, before);
    const output = exportDrawingWmf(content); const line = readDrawingWmfGraphics(output.bytes).primitives[0];
    assert.equal(line.stroke.color, '#cc2211');
    assert.ok(Math.abs(line.points[1].y - line.points[0].y - 4) < output.report.coordinateStep);
});

test('flat export honors attribute visibility and inherited layer visibility', () => {
    const content = source(); content.blocks[0].entities.push({ id: 'secret', type: 'text', layerId: 'geometry', text: 'hidden',
        attributeDefinition: { tag: 'SECRET', invisible: true } });
    assert.equal(drawingExportEntities(content).length, 1);
    content.settings.attributeDisplay = 'all';
    assert.equal(drawingExportEntities(content).length, 2);
    content.settings.attributeDisplay = 'off';
    assert.equal(drawingExportEntities(content).length, 1);
    content.layers.find(layer => layer.id === 'geometry').visible = false;
    assert.equal(drawingExportEntities(content).length, 0);
});

test('flat export rejects cycles, missing definitions, clipping and excessive nesting', () => {
    const content = source();
    assert.throws(() => drawingExportEntities(content, { maxDepth: 1 }), /wmfLimit/);
    assert.throws(() => drawingExportEntities(content, { maxEntities: 2 }), /wmfLimit/);
    content.blocks[0].entities = [ref('outer')];
    assert.throws(() => drawingExportEntities(content), /wmfExportBlockCycle/);
    content.blocks[0].entities = [ref('missing')];
    assert.throws(() => drawingExportEntities(content), /wmfExportMissingBlock/);
    content.entities[0].blockClip = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
    assert.throws(() => drawingExportEntities(content), /wmfExportUnsupported/);
});

test('flat export evaluates dynamic instance visibility before conversion', () => {
    const content = source();
    content.blocks[0].dynamic = { parameters: [{ name: 'State', type: 'choice', choices: ['On', 'Off'], default: 'On' }],
        actions: [], visibility: { parameter: 'State', states: { On: ['edge'], Off: [] } } };
    content.blocks[1].entities[0].dynamicValues = { State: 'Off' };
    assert.equal(drawingExportEntities(content).length, 0);
    content.blocks[1].entities[0].dynamicValues = { State: 'On' };
    assert.equal(drawingExportEntities(content).length, 1);
});

test('loaded reference export uses cached resources, source visibility and base-point placement through archives', () => {
    const external = createLcadDocument();
    external.content.entities = [edge, { ...edge, id: 'hidden', layerId: 'hidden' }];
    external.content.layers.push({ id: 'hidden', name: 'Hidden', visible: false, color: '#000000', lineType: 'continuous', lineWeight: 1 });
    external.content.metadata = { basePoint: { x: 1, y: 0 } };
    const host = attachDrawingReference(createLcadDocument(), external, {
        path: '/unavailable/export-must-not-read.lcad', insertionPoint: { x: 10, y: 20 },
    });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(host))).document;
    const before = structuredClone(restored);
    const reference = restored.content.entities[0];
    assert.equal(materializeDrawingBlockReference(reference, restored.content.blocks).length, 0);
    const entities = drawingExportEntities(restored.content);
    assert.equal(entities.length, 1);
    assert.deepEqual([entities[0].x1, entities[0].y1, entities[0].x2, entities[0].y2], [9, 20, 11, 20]);
    const result = exportDrawingWmf(restored.content);
    const [primitive] = readDrawingWmfGraphics(result.bytes).primitives;
    assert.equal(primitive.stroke.color, '#cc2211');
    assert.ok(Math.abs(primitive.points[1].x - primitive.points[0].x - 2) <= result.report.coordinateStep);
    assert.deepEqual(restored, before);
    reference.externalReference.loaded = false;
    assert.equal(drawingExportEntities(restored.content).length, 0);
    assert.equal(materializeDrawingBlockReference(reference, restored.content.blocks, { includeLoadedReferences: true }).length, 0);
});

test('loaded references retain missing-definition, cycle and clipping failures instead of partial output', () => {
    const content = source();
    content.entities[0].externalReference = { loaded: true };
    assert.equal(drawingExportEntities(content).length, 1);
    content.blocks[0].entities = [ref('outer')];
    assert.throws(() => drawingExportEntities(content), /wmfExportBlockCycle/);
    content.blocks[0].entities = [ref('missing')];
    assert.throws(() => drawingExportEntities(content), /wmfExportMissingBlock/);
    content.entities[0].blockClip = { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] };
    assert.throws(() => drawingExportEntities(content), /wmfExportUnsupported/);
});
