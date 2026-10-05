import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { attachDrawingReference, reloadDrawingReference, detachDrawingReference, bindDrawingReference, compareDrawingReference, drawingReferenceEditContext, loadDrawingReferenceTree } from './drawingReferences.js';
import { transformAffinePoint, multiplyAffineMatrices, translationAffineMatrix, rotationAffineMatrix } from './drawingAffine.js';
import { normalizeDrawingReference } from './drawingReferenceMetadata.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { getDrawingBlockReferenceBounds } from './drawingBlocks.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload } from './drawingClipboard.js';

function source() {
    const document = createLcadDocument({ name: 'Source' });
    document.content.entities = [{ id: 'source-line', type: 'line', layerId: 'geometry', x1: 10, y1: 20, x2: 15, y2: 20 }];
    document.content.metadata.basePoint = { x: 10, y: 20 };
    return document;
}

test('native reference snapshots preserve source identifiers, insertion, clipping and archive metadata on reload', () => {
    const document = source();
    const host = createLcadDocument({ name: 'Host' });
    const initial = JSON.stringify(document);
    const attached = attachDrawingReference(host, document, { path: '/tmp/source.lcad', revision: 'a'.repeat(64), insertionPoint: { x: 30, y: 40 } });
    const reference = attached.content.entities[0];
    reference.blockClip = { enabled: true, points: [{ x: 0, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 1 }, { x: 0, y: 1 }] };
    assert.equal(attached.content.blocks.find(block => block.id === reference.blockId).entities[0].id, 'source-line');
    assert.equal(JSON.stringify(document), initial);
    assert.equal(host.content.entities.length, 0);
    document.content.entities[0].x2 = 16;
    const reloaded = reloadDrawingReference(attached, reference.id, document, { revision: 'b'.repeat(64) });
    assert.equal(reloaded.content.blocks.length, attached.content.blocks.length);
    assert.equal(reloaded.content.entities[0].id, reference.id);
    assert.deepEqual(reloaded.content.entities[0].transform, reference.transform);
    assert.deepEqual(reloaded.content.entities[0].blockClip, reference.blockClip);
    assert.equal(reloaded.content.entities[0].externalReference.revision, 'b'.repeat(64));
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(reloaded))).document;
    assert.deepEqual(restored.content.entities[0].externalReference, reloaded.content.entities[0].externalReference);
    const bound = bindDrawingReference(restored.content, reference.id);
    assert.equal(bound.entities[0].externalReference, undefined);
    assert.deepEqual(bound.entities[0].blockClip, reference.blockClip);
    const detached = detachDrawingReference(restored, reference.id);
    assert.equal(detached.content.entities.length, 0);
    assert.equal(detached.content.blocks.length, 0);
});

test('overlay nesting is omitted, attachment nesting retained, cycles refused and unloaded references have no snaps/bounds', () => {
    const document = source();
    const nested = source();
    nested.id = 'nested';
    const overlaid = attachDrawingReference(document, nested, { mode: 'overlay' });
    const host = createLcadDocument({ name: 'Host' });
    const attached = attachDrawingReference(host, overlaid);
    const root = attached.content.blocks.find(block => block.id === attached.content.entities[0].blockId);
    assert.equal(root.entities.length, 1);
    assert.throws(() => attachDrawingReference(document, document));
    assert.throws(() => attachDrawingReference(nested, attachDrawingReference(document, nested)));
    const reference = attached.content.entities[0];
    assert.ok(drawingSnapEntities(attached.content).length > 0);
    reference.externalReference.loaded = false;
    assert.deepEqual(drawingSnapEntities(attached.content), []);
    assert.equal(getDrawingBlockReferenceBounds(reference, attached.content.blocks), null);
    assert.equal(normalizeDrawingReference({ version: 7, sourceDocumentId: 'x' }), null);
});

test('detaching retains cached blocks still used by a bound copy', () => {
    const attached = attachDrawingReference(createLcadDocument(), source());
    const reference = attached.content.entities[0];
    attached.content.entities.push({ ...reference, id: 'bound-copy', externalReference: undefined });
    const detached = detachDrawingReference(attached, reference.id);
    assert.equal(detached.content.entities.length, 1);
    assert.equal(detached.content.blocks.length, attached.content.blocks.length);
    assert.ok(drawingSnapEntities(detached.content).length > 0);
});

test('repeated reload reclaims orphaned source layers while retaining viewport/state assignments', () => {
    const document = source();
    document.content.layers.push({ ...document.content.layers[0], id: 'custom', name: 'Source layer' });
    document.content.entities[0].layerId = 'custom';
    let attached = attachDrawingReference(createLcadDocument(), document);
    const layerCount = attached.content.layers.length;
    for (let index = 0; index < 4; index++) {
        attached = reloadDrawingReference(attached, attached.referenceId, document);
        assert.equal(attached.content.layers.length, layerCount);
    }
    const sourceLayerId = attached.content.entities[0].externalReference.sourceMaps.layers.custom;
    attached.content.layerStates = [{ id: 'saved', name: 'State', activeLayerId: sourceLayerId, layers: [] }];
    const detached = detachDrawingReference(attached, attached.referenceId);
    assert.ok(detached.content.layers.some(layer => layer.id === sourceLayerId));
});

test('comparison reports source entity edits/additions/removals without mutating the cache or treating layer namespaces as changes', () => {
    const document = source();
    document.content.layers.push({ ...document.content.layers[0], id: 'custom', name: 'Source layer' });
    document.content.entities[0].layerId = 'custom';
    const attached = attachDrawingReference(createLcadDocument(), document);
    const before = JSON.stringify(attached);
    let report = compareDrawingReference(attached, attached.referenceId, document);
    for (const item of Object.values(report.differences)) assert.deepEqual(item, { added: [], removed: [], changed: [] });
    document.content.entities[0].x2 += 2;
    document.content.entities.push({ ...document.content.entities[0], id: 'added' });
    report = compareDrawingReference(attached, attached.referenceId, document);
    assert.deepEqual(report.differences.entities, { added: ['added'], removed: [], changed: ['source-line'] });
    document.content.entities.shift();
    report = compareDrawingReference(attached, attached.referenceId, document);
    assert.deepEqual(report.differences.entities.removed, ['source-line']);
    assert.equal(JSON.stringify(attached), before);
});

test('reference edit context maps the host back to source coordinates through rotated insertion and BASE', () => {
    const document = source();
    const host = createLcadDocument();
    host.content.entities = [{ id: 'host', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 1 }];
    const attached = attachDrawingReference(host, document);
    const reference = attached.content.entities.find(entity => entity.id === attached.referenceId);
    reference.transform = multiplyAffineMatrices(translationAffineMatrix(30, 40), rotationAffineMatrix(90));
    const context = drawingReferenceEditContext(attached, reference, document);
    assert.deepEqual(context.content.entities.map(entity => entity.id), ['host']);
    const point = transformAffinePoint(transformAffinePoint({ x: 3, y: 4 }, reference.transform), context.transform);
    assert.ok(Math.abs(point.x - 13) < 1e-9 && Math.abs(point.y - 24) < 1e-9);
});

test('an emptied source retains its reference identity and can be repopulated on reload', () => {
    const document = source();
    const attached = attachDrawingReference(createLcadDocument(), document);
    const emptied = reloadDrawingReference(attached, attached.referenceId, { ...document, content: { ...document.content, entities: [] } });
    assert.equal(emptied.referenceId, attached.referenceId);
    assert.deepEqual(drawingSnapEntities(emptied.content), []);
    const restored = reloadDrawingReference(emptied, emptied.referenceId, document);
    assert.equal(drawingSnapEntities(restored.content).length, 1);
});

test('recursive reload follows attached sources, retains missing snapshots and refuses cycles/depth overflow', async () => {
    const child = source(); child.id = 'child';
    const parent = attachDrawingReference(source(), child, { path: '/child.lcad' });
    const loaded = { path: '/parent.lcad', envelope: createLcadEnvelope(parent) };
    child.content.entities[0].x2 = 99;
    const fresh = await loadDrawingReferenceTree(loaded, async path => {
        assert.equal(path, '/child.lcad');
        return { path, envelope: createLcadEnvelope(child), revision: 'c'.repeat(64) };
    });
    const reference = fresh.envelope.document.content.entities.find(entity => entity.externalReference);
    const definition = fresh.envelope.document.content.blocks.find(block => block.id === reference.blockId);
    assert.equal(definition.entities[0].x2, 89);
    const missing = await loadDrawingReferenceTree(loaded, async () => { throw new Error('missing'); });
    assert.equal(missing.referenceWarnings.length, 1);
    assert.deepEqual(missing.envelope.document.content, loaded.envelope.document.content);
    await assert.rejects(loadDrawingReferenceTree(loaded, async () => loaded), error => error.translationKey === 'reference.error.cycle');
    await assert.rejects(loadDrawingReferenceTree(loaded, async () => { throw new Error('should not read'); }, { maxDepth: 0 }), error => error.translationKey === 'reference.treeLimit');
});

test('clipboard preserves reference source IDs and remaps ownership without deleting pre-existing destination definitions', () => {
    const document = source();
    const attached = attachDrawingReference(createLcadDocument(), document);
    const reference = attached.content.entities[0];
    const payload = createDrawingClipboardPayload(attached, [reference.id]);
    const target = createLcadDocument();
    target.content.blocks = attached.content.blocks.map(block => ({ ...block }));
    const pasted = pasteDrawingClipboardPayload(target, payload, { mode: 'original' });
    const copy = pasted.entities[0];
    const definition = pasted.content.blocks.find(block => block.id === copy.blockId);
    assert.equal(definition.entities[0].id, 'source-line');
    assert.deepEqual(copy.externalReference.owned.blocks, []);
    const detached = detachDrawingReference({ ...target, ...pasted }, copy.id);
    assert.deepEqual(detached.content.blocks.map(block => block.id), target.content.blocks.map(block => block.id));
    const conflicting = createLcadDocument();
    conflicting.content.blocks = attached.content.blocks.map(block => ({ ...block, entities: [{ ...block.entities[0], x2: 42 }] }));
    const moved = pasteDrawingClipboardPayload(conflicting, payload, { mode: 'original' });
    const movedReference = moved.entities[0];
    assert.notEqual(movedReference.blockId, reference.blockId);
    assert.ok(movedReference.externalReference.owned.blocks.includes(movedReference.blockId));
    assert.ok(Object.values(movedReference.externalReference.sourceMaps.blocks).includes(movedReference.blockId));
    const report = compareDrawingReference({ ...conflicting, ...moved }, movedReference.id, document);
    assert.equal(report.changed, 0);
});
