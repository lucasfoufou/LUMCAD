import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent, copySelectedEntities, transformSelectedEntities } from './drawingDocument.js';
import { rotateEntity, scaleEntity } from './drawingPrimitives.js';
import { mirrorDrawingEntities } from './drawingCompoundOperations.js';
import { copyDrawingSelectionToLayer } from './drawingPropertyCommands.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload, validateDrawingClipboardPayload, createDrawingClipboardInterchange, parseDrawingClipboardText } from './drawingClipboard.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from './drawingBlockEditing.js';
import { commitDrawingHistoryState } from './drawingHistory.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { defineNamedDrawingBlock } from './drawingNamedBlocks.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'a', type: 'line', layerId: content.activeLayerId, x1: 10, y1: 20, x2: 14, y2: 20 },
        { id: 'b', type: 'line', layerId: content.activeLayerId, x1: 14, y1: 20, x2: 14, y2: 23 }];
    content.geometricConstraints = [
        { id: 'join', type: 'coincident', refs: [{ entityId: 'a', point: 'end' }, { entityId: 'b', point: 'start' }] },
        { id: 'pin', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [10, 20] },
        { id: 'fixed', type: 'fix', refs: [{ entityId: 'b' }], values: [14, 20, 14, 23] },
    ];
    return content;
}

test('clipboard carries only complete relationships and never drags in unselected neighbours', () => {
    const content = fixture();
    const payload = createDrawingClipboardPayload(content, ['a']);
    assert.deepEqual(payload.entities.map(entity => entity.id), ['a']);
    assert.deepEqual(payload.geometricConstraints.map(item => item.id), ['pin']);
    const all = createDrawingClipboardPayload(content, ['a', 'b']);
    const interchange = createDrawingClipboardInterchange(all);
    assert.deepEqual(parseDrawingClipboardText(interchange['text/plain']).geometricConstraints, content.geometricConstraints);
    assert.throws(() => validateDrawingClipboardPayload({ ...payload, geometricConstraints: content.geometricConstraints }));
});

test('translated and original-coordinate paste remap IDs, snapshots and history without touching originals', () => {
    for (const mode of ['insert', 'original']) {
        const content = fixture(); const saved = structuredClone(content);
        const payload = createDrawingClipboardPayload(content, ['a', 'b'], { basePoint: { x: 10, y: 20 } });
        const result = pasteDrawingClipboardPayload(content, payload, { mode, insertionPoint: { x: 100, y: -20 } });
        assert.deepEqual(content, saved);
        assert.equal(result.content.geometricConstraints.length, 6);
        const added = result.content.geometricConstraints.slice(3);
        assert.ok(added.every(item => !saved.geometricConstraints.some(original => original.id === item.id)));
        assert.ok(added.every(item => item.refs.every(ref => result.entities.some(entity => entity.id === ref.entityId))));
        const map = new Map(result.entities.map(entity => [entity.id, entity]));
        assert.ok(added.every(item => drawingGeometricConstraintResiduals(item, map).every(value => Math.abs(value) < 1e-10)));
        assert.deepEqual(added[1].values, mode === 'original' ? [10, 20] : [100, -20]);
        const committed = commitDrawingHistoryState({ past: [], present: content, future: [] }, result.content);
        assert.equal(committed.rejection, null);
        assert.equal(committed.past.length, 1);
        assert.deepEqual(committed.present.entities.slice(0, 2), saved.entities);
    }
});

test('copy preserves an unsatisfied fixation snapshot rather than replacing it by current geometry', () => {
    const content = fixture(); content.geometricConstraints[1].values = [9, 19];
    content.geometricConstraints[2].values = [12, 18, 12, 21];
    const payload = createDrawingClipboardPayload(content, ['a', 'b'], { basePoint: { x: 10, y: 20 } });
    const result = pasteDrawingClipboardPayload(createDefaultDrawingContent(), payload, { insertionPoint: { x: 100, y: 200 } });
    assert.deepEqual(result.content.geometricConstraints[1].values, [99, 199]);
    assert.deepEqual(result.content.geometricConstraints[2].values, [102, 198, 102, 201]);
    assert.equal(result.entities[0].x1, 100);
});

test('paste as block retains local constraints through normalization, definition remapping and BEDIT save', () => {
    const content = fixture();
    const payload = createDrawingClipboardPayload(content, ['a', 'b'], { basePoint: { x: 10, y: 20 } });
    const pasted = pasteDrawingClipboardPayload(createDefaultDrawingContent(), payload, { mode: 'block', insertionPoint: { x: 100, y: 200 } });
    const normalized = normalizeDrawingContent(pasted.content);
    const block = normalized.blocks.find(item => item.id === pasted.entities[0].blockId);
    assert.deepEqual(block.geometricConstraints[1].values, [0, 0]);
    assert.deepEqual(block.geometricConstraints[2].values, [4, 0, 4, 3]);
    const map = new Map(block.entities.map(entity => [entity.id, entity]));
    assert.ok(block.geometricConstraints.every(item => drawingGeometricConstraintResiduals(item, map).every(value => Math.abs(value) < 1e-10)));
    const draft = createDrawingBlockEditDraft(normalized, block.id);
    assert.deepEqual(draft.content.geometricConstraints, block.geometricConstraints);
    const saved = saveDrawingBlockEdit(normalized, block.id, draft.content);
    assert.ok(!saved.error);
    assert.deepEqual(saved.content.blocks.find(item => item.id === block.id).geometricConstraints, block.geometricConstraints);
    const copied = createDrawingClipboardPayload(normalized, [pasted.entities[0].id]);
    const transferred = pasteDrawingClipboardPayload(createDefaultDrawingContent(), copied, { mode: 'original' });
    const definition = transferred.content.blocks[0];
    const ids = new Set(definition.entities.map(entity => entity.id));
    assert.ok(definition.geometricConstraints.every(item => item.refs.every(ref => ids.has(ref.entityId))));
    assert.ok(definition.geometricConstraints.every(item => !block.geometricConstraints.some(original => original.id === item.id)));
    assert.doesNotThrow(() => normalizeDrawingContent(transferred.content));
    const document = createLcadDocument(); document.content = transferred.content;
    const reopened = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(reopened.content.blocks[0].geometricConstraints, definition.geometricConstraints);
    assert.deepEqual(reopened.content.blocks[0].entities, definition.entities);
});

test('invalid nested constraints and combined catalog overflow refuse a complete transfer', () => {
    const content = fixture();
    const payload = createDrawingClipboardPayload(content, ['a', 'b']);
    const target = fixture();
    target.geometricConstraints = Array.from({ length: 256 }, (_, index) => ({ ...target.geometricConstraints[1], id: `pin-${index}` }));
    const before = structuredClone(target);
    assert.throws(() => pasteDrawingClipboardPayload(target, payload));
    assert.deepEqual(target, before);
    assert.throws(() => normalizeDrawingContent({ ...content, blocks: [{ id: 'broken', entities: content.entities,
        geometricConstraints: [{ id: 'missing', type: 'fix', refs: [{ entityId: 'missing' }], values: [0, 0] }] }] }));
});

test('BLOCK transfers internal constraints and fixation targets into local coordinates with one undo entry', () => {
    const content = fixture();
    const result = defineNamedDrawingBlock(content, ['a', 'b'], { name: 'Constrained corner', basePoint: { x: 10, y: 20 } });
    assert.ok(!result.error, JSON.stringify(result));
    assert.deepEqual(result.content.geometricConstraints, []);
    assert.equal(result.definition.geometricConstraints.length, 3);
    assert.deepEqual(result.definition.geometricConstraints[1].values, [0, 0]);
    assert.deepEqual(result.definition.geometricConstraints[2].values, [4, 0, 4, 3]);
    assert.ok(result.definition.geometricConstraints.every(item => !content.geometricConstraints.some(original => original.id === item.id)));
    const state = commitDrawingHistoryState({ past: [], present: content, future: [] }, result.content);
    assert.equal(state.rejection, null);
    assert.equal(state.past[0], content);
    assert.equal(state.present.entities.length, 1);
    assert.doesNotThrow(() => normalizeDrawingContent(state.present));
});

test('BLOCK refuses cross-boundary constraints while KEEP preserves sources and copies complete relations', () => {
    const content = fixture(); const saved = structuredClone(content);
    assert.deepEqual(defineNamedDrawingBlock(content, ['a'], { name: 'Partial', basePoint: { x: 10, y: 20 } }), { error: 'dependent' });
    assert.deepEqual(content, saved);
    const kept = defineNamedDrawingBlock(content, ['a'], { name: 'Partial', basePoint: { x: 10, y: 20 }, keepSources: true });
    assert.ok(!kept.error, JSON.stringify(kept));
    assert.deepEqual(kept.content.entities, content.entities);
    assert.equal(kept.content.geometricConstraints, content.geometricConstraints);
    assert.equal(kept.definition.geometricConstraints.length, 1);
    assert.equal(kept.definition.geometricConstraints[0].type, 'fix');
    assert.deepEqual(kept.definition.geometricConstraints[0].values, [0, 0]);
});

test('COPY duplicates internal relations and translated fixation targets independently of originals', () => {
    const content = fixture(); const before = structuredClone(content);
    const copied = copySelectedEntities(content, ['a', 'b'], { x: 10, y: -5 });
    assert.ok(!copied.error);
    const additions = copied.content.geometricConstraints.slice(3);
    assert.equal(additions.length, 3);
    assert.deepEqual(additions[1].values, [20, 15]);
    assert.deepEqual(additions[2].values, [24, 15, 24, 18]);
    assert.ok(additions.every(item => item.refs.every(ref => copied.selectedIds.includes(ref.entityId))));
    const committed = commitDrawingHistoryState({ past: [], present: content, future: [] }, copied.content);
    assert.equal(committed.rejection, null);
    assert.deepEqual(committed.present.entities.slice(0, 2), content.entities);
    assert.deepEqual(content, before);
    const partial = copySelectedEntities(content, ['a'], { x: 0, y: 5 });
    assert.equal(partial.content.geometricConstraints.length, 4);
    assert.equal(partial.content.geometricConstraints.at(-1).type, 'fix');
});

test('COPYTOLAYER shares constraint copying and catalog overflow is atomic', () => {
    const content = fixture();
    const result = copyDrawingSelectionToLayer(content, ['a', 'b'], 'geometry');
    assert.ok(!result.error);
    assert.equal(result.content.geometricConstraints.length, 6);
    assert.deepEqual(result.content.geometricConstraints.at(-1).values, content.geometricConstraints.at(-1).values);
    content.geometricConstraints = Array.from({ length: 256 }, (_, index) => ({ ...content.geometricConstraints[1], id: `fix-${index}` }));
    const copy = copySelectedEntities(content, ['a']);
    assert.equal(copy.error, 'limit'); assert.equal(copy.content, content);
    assert.deepEqual(copy.entities, []);
    assert.deepEqual(copyDrawingSelectionToLayer(content, ['a'], 'geometry'), { error: 'constraints' });
});

test('rotation, scale and mirror copies preserve compatible relations and transform fixation snapshots', () => {
    for (const operation of ['rotate', 'scale', 'mirror']) {
        const content = fixture(); const before = structuredClone(content);
        const result = operation === 'mirror' ? mirrorDrawingEntities(content, ['a', 'b'], { x: 0, y: 0 }, { x: 0, y: 1 })
            : transformSelectedEntities(content, ['a', 'b'], entity => operation === 'rotate'
                ? rotateEntity(entity, 90, { x: 0, y: 0 }) : scaleEntity(entity, 2, { x: 0, y: 0 }), { copy: true });
        assert.ok(!result.error, JSON.stringify(result));
        assert.equal(result.content.geometricConstraints.length, 6);
        const map = new Map(result.entities.map(entity => [entity.id, entity]));
        assert.ok(result.content.geometricConstraints.slice(3).every(item => drawingGeometricConstraintResiduals(item, map).every(value => Math.abs(value) < 1e-7)));
        const expected = operation === 'rotate' ? [-20, 10] : operation === 'scale' ? [20, 40] : [-10, 20];
        assert.ok(result.content.geometricConstraints[4].values.every((value, index) => Math.abs(value - expected[index]) < 1e-7));
        const state = commitDrawingHistoryState({ past: [], present: content, future: [] }, result.content);
        assert.equal(state.rejection, null);
        assert.deepEqual(state.present.entities.slice(0, 2), before.entities);
        assert.deepEqual(content, before);
    }
});

test('a copied global axis relation refuses incompatible rotation without straightening the copy', () => {
    const content = fixture();
    content.geometricConstraints.push({ id: 'axis', type: 'horizontal', refs: [{ entityId: 'a' }] });
    const result = transformSelectedEntities(content, ['a', 'b'], entity => rotateEntity(entity, 30, { x: 0, y: 0 }), { copy: true });
    assert.equal(result.error, 'conflict');
    assert.equal(result.changed, false); assert.equal(result.content, content); assert.deepEqual(result.entities, []);
    const scale = transformSelectedEntities(content, ['a', 'b'], entity => scaleEntity(entity, 2, { x: 0, y: 0 }), { copy: true });
    assert.ok(!scale.error);
    assert.equal(scale.content.geometricConstraints.length, 8);
});
