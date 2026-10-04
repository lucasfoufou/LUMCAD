import test from 'node:test';
import assert from 'node:assert/strict';
import { getDimensionGeometry } from './drawingDimensions.js';
import { centerLineGeometry } from './drawingCenterLines.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { maintainDrawingCenters } from './drawingCenterMaintenance.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', layerId: 'geometry', x1, y1, x2, y2 });
const annotation = { id: 'center', type: 'centerLine', layerId: 'dimensions', sourceIds: ['a', 'b'], extension: 0.5 };
const sources = [line('a', 0, 0, 10, 0), line('b', 8, 4, 2, 4)];

test('centre lines bisect parallel sources with unequal extents and follow source edits', () => {
    const geometry = centerLineGeometry(annotation, sources);
    assert.deepEqual(geometry.first, { x: -0.5, y: 2 });
    assert.deepEqual(geometry.second, { x: 10.5, y: 2 });
    const edited = sources.map(source => source.id === 'b' ? { ...source, y1: 8, y2: 8 } : source);
    assert.equal(centerLineGeometry(annotation, edited).first.y, 4);
    assert.equal(centerLineGeometry(annotation, [sources[0]]), null);
    assert.equal(centerLineGeometry(annotation, [sources[0], line('b', 0, 0, 0, 0)]), null);
});

test('intersecting source lines produce stable angle bisectors, including endpoint reversal', () => {
    const crossing = [line('a', -4, 0, 4, 0), line('b', 0, -4, 0, 4)];
    const geometry = centerLineGeometry(annotation, crossing);
    assert.ok(Math.abs(geometry.first.x - geometry.first.y) < 1e-8);
    const reversed = crossing.map(source => ({ ...source, x1: source.x2, y1: source.y2, x2: source.x1, y2: source.y1 }));
    assert.deepEqual(centerLineGeometry(annotation, reversed), geometry);
    const alternate = centerLineGeometry({ ...annotation, alternateBisector: true }, crossing);
    assert.ok(Math.abs(alternate.first.x + alternate.first.y) < 1e-8);
});

test('centre line snapshots survive detachment, reset, archive round trip and reassociation', () => {
    const content = { ...createDefaultDrawingContent(), entities: [...sources, annotation] };
    const geometry = getDimensionGeometry(annotation, content.entities);
    const detached = maintainDrawingCenters(content, ['center'], 'centerDisassociate').content;
    assert.deepEqual(getDimensionGeometry(detached.entities[2]), geometry);
    const reset = maintainDrawingCenters(detached, ['center'], 'centerReset').content;
    assert.equal(reset.entities[2].extension, 0.25);
    const document = createLcadDocument(); document.content = detached;
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(getDimensionGeometry(restored.content.entities[2]), geometry);
    const associated = maintainDrawingCenters(restored.content, ['center'], 'centerReassociate', 'a b').content;
    assert.deepEqual(associated.entities[2].sourceIds, ['a', 'b']);
    assert.deepEqual(getDimensionGeometry(associated.entities[2], associated.entities), geometry);
});

test('creation validates sources and target layer, waits for the second pick and commits once', async () => {
    const { beginCenterLine, pickCenterLineSource } = await import('./drawingCenterLineCommands.js');
    const content = { ...createDefaultDrawingContent(), entities: sources };
    const before = structuredClone(content);
    const operation = beginCenterLine(content).operation;
    const first = pickCenterLineSource(content, operation, 'a');
    assert.equal(first.content, undefined);
    assert.equal(pickCenterLineSource(content, first.operation, 'a').error, 'geometry');
    const completed = pickCenterLineSource(content, first.operation, 'b');
    assert.equal(completed.content.entities.length, 3);
    assert.equal(getDimensionGeometry(completed.content.entities[2], completed.content.entities).first.y, 2);
    assert.deepEqual(content, before);
    assert.equal(beginCenterLine(content, ['a', 'b'], 'ALTERNATE').content.entities[2].alternateBisector, true);
    content.layers.find(layer => layer.id === 'dimensions').locked = true;
    assert.equal(pickCenterLineSource(content, first.operation, 'b').error, 'selection');
});

test('centre-line extension grip changes the shared overrun without moving sources', async () => {
    const { getEntityGrips, editEntityGrip } = await import('./drawingSelection.js');
    const grips = getEntityGrips(annotation, sources);
    assert.deepEqual(grips, [{ id: 'center-line-extension', x: 10.5, y: 2 }]);
    const updated = editEntityGrip(annotation, 'center-line-extension', { x: 12, y: 8 }, sources);
    assert.equal(updated.extension, 2);
    assert.deepEqual(getDimensionGeometry(updated, sources).first, { x: -2, y: 2 });
    assert.deepEqual(updated.sourceIds, annotation.sourceIds);
});

test('centre lines survive clipboard remapping, affine block materialization and SVG output', async () => {
    const { createDrawingClipboardPayload, pasteDrawingClipboardPayload, drawingClipboardPayloadToSvg } = await import('./drawingClipboard.js');
    const { materializeDrawingBlockReference } = await import('./drawingBlocks.js');
    const { translateEntity, rotateEntity } = await import('./drawingPrimitives.js');
    const content = { ...createDefaultDrawingContent(), entities: [...sources, annotation] };
    const payload = createDrawingClipboardPayload(content, ['center']);
    assert.equal(payload.entities.length, 3);
    const pasted = pasteDrawingClipboardPayload(createDefaultDrawingContent(), payload, { mode: 'original' });
    const center = pasted.entities.find(entity => entity.type === 'centerLine');
    assert.ok(center.sourceIds.every(id => pasted.entities.some(entity => entity.id === id)));
    assert.ok(!center.sourceIds.includes('a'));
    assert.equal(getDimensionGeometry(center, pasted.entities).first.y, 2);
    const svg = drawingClipboardPayloadToSvg(payload);
    assert.ok(svg.includes('<line'));
    assert.ok(!svg.includes('<text'));
    const block = { id: 'block', name: 'Centre', entities: content.entities };
    const reference = { id: 'reference', type: 'blockReference', blockId: block.id, transform: { a: 2, b: 0, c: 0, d: 3, e: 20, f: 30 } };
    const materialized = materializeDrawingBlockReference(reference, [block]);
    assert.equal(getDimensionGeometry(materialized[2], materialized).first.y, 36);
    const detached = maintainDrawingCenters(content, ['center'], 'centerDisassociate').content.entities[2];
    assert.equal(getDimensionGeometry(translateEntity(detached, 10, 20)).first.y, 22);
    const rotated = getDimensionGeometry(rotateEntity(detached, 90, { x: 0, y: 0 }));
    assert.ok(Math.abs(rotated.first.x + 2) < 1e-8);
});
