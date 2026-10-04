import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { defineNamedDrawingBlock, insertNamedDrawingBlock, parseNamedBlockInput } from './drawingNamedBlocks.js';
import { materializeDrawingBlockReference, getDrawingBlockReferenceBounds, transformDrawingEntityAffine, rotationAffineMatrix } from './drawingBlocks.js';
import { createDrawingBlockWorkflow } from './drawingBlockWorkflow.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 10, y1: 20, x2: 14, y2: 20 };
function content() { return { ...createDefaultDrawingContent(), entities: [line] }; }
const options = { name: 'Door A', basePoint: { x: 10, y: 20 } };

test('named definitions convert the selection and insert exact transformed native children', () => {
    const original = content();
    const defined = defineNamedDrawingBlock(original, ['line'], options);
    assert.equal(defined.content.entities.length, 1);
    assert.equal(defined.reference.type, 'blockReference');
    assert.deepEqual(materializeDrawingBlockReference(defined.reference, defined.content.blocks)[0], line);
    assert.equal(original.entities[0], line);
    const inserted = insertNamedDrawingBlock(defined.content, 'door a', { x: 5, y: 6 }, { scale: 2, angle: 90 });
    const child = materializeDrawingBlockReference(inserted.reference, defined.content.blocks)[0];
    assert.ok(Math.abs(child.x1 - 5) < 1e-9 && Math.abs(child.x2 - 5) < 1e-9);
    assert.equal(child.y1, 6); assert.equal(child.y2, 14);
    assert.equal(insertNamedDrawingBlock(defined.content, 'missing', { x: 0, y: 0 }).error, 'missing');
    assert.equal(insertNamedDrawingBlock(defined.content, 'Door A', { x: 0, y: 0 }, { scale: 0 }).error, 'transform');
});

test('definitions include dependencies and reject destructive outside links and cyclic redefinition', () => {
    const source = content();
    source.entities.push({ id: 'dim', type: 'dimension', layerId: 'dimensions', sourceId: 'line', offset: 1 });
    assert.equal(defineNamedDrawingBlock(source, ['line'], options).error, 'dependent');
    const kept = defineNamedDrawingBlock(source, ['line'], { ...options, keepSources: true });
    assert.equal(kept.content.entities.length, 2);
    const defined = defineNamedDrawingBlock(source, ['dim'], options);
    assert.equal(defined.definition.entities.length, 2);
    assert.equal(defined.definition.entities[1].sourceId, 'line');
    assert.equal(defineNamedDrawingBlock(defined.content, [defined.reference.id], { ...options, redefine: true }).error, 'cycle');
    assert.equal(defineNamedDrawingBlock(kept.content, ['line'], options).error, 'duplicate');
});

test('redefinition refreshes nested bounds and normalization rejects stale reference caches', () => {
    const defined = defineNamedDrawingBlock(content(), ['line'], options);
    const nested = defineNamedDrawingBlock(defined.content, [defined.reference.id], { name: 'Nested', basePoint: { x: 0, y: 0 } });
    const edited = { ...nested.content, entities: [...nested.content.entities, { ...line, x2: 30 }] };
    const redefined = defineNamedDrawingBlock(edited, ['line'], { ...options, redefine: true, keepSources: true });
    assert.equal(redefined.definition.id, defined.definition.id);
    const outer = redefined.content.entities.find(entity => entity.id === nested.reference.id);
    assert.equal(outer.definitionBounds.maxX, 30);
    const stale = { ...outer, definitionBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
    assert.equal(getDrawingBlockReferenceBounds(stale, redefined.content.blocks).maxX, 30);
    const normalized = normalizeDrawingContent({ ...redefined.content, entities: [stale] });
    assert.equal(normalized.entities[0].definitionBounds.maxX, 30);
    assert.equal(defineNamedDrawingBlock(redefined.content, [outer.id], { ...options, redefine: true }).error, 'cycle');
});

test('block parser keeps names, explicit redefine/keep and transform parameters unambiguous', () => {
    assert.deepEqual(parseNamedBlockInput('"Door A" 10 20 KEEP REDEFINE', 'define'), { ...options, keepSources: true, redefine: true });
    assert.deepEqual(parseNamedBlockInput('"Door A" 5 6 2 90', 'insert'), { name: 'Door A', point: { x: 5, y: 6 }, scale: 2, angle: 90 });
    for (const value of ['"bad/name"', 'A NaN 2', 'A 2', 'A 1 2 garbage']) assert.equal(parseNamedBlockInput(value, 'define'), null);
});

test('rotated image and text block children retain orientation on materialization', () => {
    for (const type of ['image', 'text']) {
        const entity = { id: type, type, x: 1, y: 2, width: 4, height: 2, rotation: 30 };
        const result = transformDrawingEntityAffine(entity, rotationAffineMatrix(90));
        assert.equal(result.rotation, 120);
        assert.equal(result.width, 4); assert.equal(result.height, 2);
        assert.ok(Math.abs(result.x + 5) < 1e-9 && Math.abs(result.y - 2) < 1e-9);
    }
});

test('named definitions and references survive archive round trips', () => {
    const document = createLcadDocument({ name: 'Blocks' });
    document.content = defineNamedDrawingBlock(content(), ['line'], options).content;
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.equal(restored.content.blocks[0].name, 'Door A');
    assert.equal(restored.content.entities[0].blockId, document.content.blocks[0].id);
    assert.deepEqual(materializeDrawingBlockReference(restored.content.entities[0], restored.content.blocks)[0], line);
});

test('block workflow defers commits until base/insertion points and reports invalid operations', () => {
    let current = content(); let operation; let message; let commits = 0;
    const workflow = () => createDrawingBlockWorkflow({ history: { content: current, commit: next => { current = next; commits++; } }, selectedIds: ['line'],
        setInteractiveOperation: value => { operation = value; }, setActiveTool() {}, setSelectedIds() {}, setMessage: value => { message = value; }, t: value => value });
    workflow().define('"Door A"');
    assert.equal(operation.stage, 'base'); assert.equal(commits, 0);
    workflow().point(operation, options.basePoint); assert.equal(commits, 1); assert.equal(operation, null);
    workflow().insert('"Door A"'); assert.equal(operation.stage, 'insertion');
    workflow().input(operation, 'SCALE 2'); workflow().input(operation, 'ROTATION 90');
    assert.equal(operation.scale, 2); assert.equal(operation.angle, 90); assert.equal(commits, 1);
    workflow().point(operation, { x: 5, y: 6 }); assert.equal(commits, 2);
    workflow().insert('Missing 0 0'); assert.equal(commits, 2); assert.equal(message, 'block.error.missing');
});

test('copying a different named definition with an occupied name allocates an unambiguous name', async () => {
    const { createDrawingClipboardPayload, pasteDrawingClipboardPayload } = await import('./drawingClipboard.js');
    const source = defineNamedDrawingBlock(content(), ['line'], options).content;
    const target = defineNamedDrawingBlock({ ...content(), entities: [{ ...line, x2: 18 }] }, ['line'], options).content;
    const payload = createDrawingClipboardPayload({ content: source, assets: [] }, [source.entities[0].id]);
    const pasted = pasteDrawingClipboardPayload({ content: target, assets: [] }, payload, { mode: 'original' });
    assert.deepEqual(pasted.content.blocks.map(block => block.name), ['Door A', 'Door A (2)']);
    assert.equal(pasted.entities[0].blockId, pasted.content.blocks[1].id);
    assert.equal(target.blocks[0].name, 'Door A');
});

test('moving a spline into block-local coordinates preserves its editable definition', async () => {
    const { buildSplineCreationEntity } = await import('./drawingSplineCreation.js');
    const spline = buildSplineCreationEntity([{ x: 10, y: 20 }, { x: 12, y: 23 }, { x: 14, y: 20 }], 'geometry', 'fit', 'spline');
    const defined = defineNamedDrawingBlock({ ...content(), entities: [spline] }, ['spline'], options);
    const local = defined.definition.entities[0];
    assert.deepEqual(local.splineDefinition.points[0], { x: 0, y: 0 });
    const normalized = normalizeDrawingContent(defined.content);
    assert.deepEqual(normalized.blocks[0].entities[0], local);
    const recovered = materializeDrawingBlockReference(defined.reference, normalized.blocks)[0];
    assert.deepEqual(recovered.splineDefinition, spline.splineDefinition);
});
