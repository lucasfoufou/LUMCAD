import test from 'node:test';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import assert from 'node:assert/strict';
import { detectDrawingSmartBlocks, replaceDrawingSmartBlocks, replaceDrawingBlockInstances } from './drawingSmartBlocks.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { transformDrawingEntityAffine, materializeDrawingBlockReference } from './drawingBlocks.js';
import { multiplyAffineMatrices, rotationAffineMatrix, translationAffineMatrix, scaleAffineMatrix } from './drawingAffine.js';

function fixture() {
    const content = createDefaultDrawingContent(); const layerId = content.activeLayerId;
    const sources = [{ id: 'a', type: 'line', layerId, x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'b', type: 'line', layerId, x1: 2, y1: 0, x2: 2, y2: 1 }];
    const matrix = multiplyAffineMatrices(translationAffineMatrix(10, 20), multiplyAffineMatrices(rotationAffineMatrix(90), scaleAffineMatrix(2)));
    content.entities = [...sources, ...sources.map(entity => ({ ...transformDrawingEntityAffine(entity, matrix), id: `${entity.id}-copy` }))];
    return normalizeDrawingContent(content);
}

test('native motif detection recognizes translated, rotated and uniformly scaled line-anchored occurrences', () => {
    const content = fixture();
    const original = JSON.stringify(content);
    const result = detectDrawingSmartBlocks(content, ['a', 'b']);
    assert.equal(result.occurrences.length, 2);
    assert.deepEqual(result.occurrences[1].ids, ['a-copy', 'b-copy']);
    assert.equal(JSON.stringify(content), original);
    const reversed = { ...content, entities: content.entities.map(entity => entity.id === 'a-copy' ? { ...entity, x1: entity.x2, y1: entity.y2, x2: entity.x1, y2: entity.y1 } : entity) };
    assert.equal(detectDrawingSmartBlocks(reversed, ['a', 'b']).occurrences.length, 2);
});

test('appearance changes and locked candidates do not produce false matches; limits return no partial result', () => {
    const content = fixture();
    for (const change of [{ color: '#ff0000' }, { lineWeight: 50 }, { locked: true }, { x2: 40 }]) {
        const changed = { ...content, entities: content.entities.map(entity => entity.id === 'b-copy' ? { ...entity, ...change } : entity) };
        assert.equal(detectDrawingSmartBlocks(changed, ['a', 'b']).occurrences.length, 1);
    }
    assert.deepEqual(detectDrawingSmartBlocks(content, ['a', 'b'], { maxChecks: 1 }), { error: 'limit' });
});

test('replacement creates one definition and transformed instances without changing native geometry', () => {
    const content = fixture();
    content.groups = [{ id: 'group', name: 'Group', selectable: true, entityIds: ['a', 'b'] }];
    const result = replaceDrawingSmartBlocks(content, ['a', 'b'], 'Motif');
    assert.equal(result.count, 2);
    assert.equal(result.content.blocks.length, 1);
    assert.deepEqual(result.selectedIds, ['a', 'a-copy']);
    assert.deepEqual(result.content.groups[0].entityIds, ['a']);
    const expanded = result.content.entities.flatMap(reference => materializeDrawingBlockReference(reference, result.content.blocks));
    for (let i = 0; i < expanded.length; i += 1) for (const key of ['x1', 'y1', 'x2', 'y2']) {
        assert.ok(Math.abs(expanded[i][key] - content.entities[i][key]) < 1e-8);
    }
    assert.equal(content.entities.length, 4);
});

test('replacement refuses outside dependencies, partial groups and interleaved painter order', () => {
    const content = fixture();
    const linked = { ...content, entities: [...content.entities, { id: 'field', type: 'text', field: { kind: 'object', entityId: 'b', property: 'length' } }] };
    assert.equal(replaceDrawingSmartBlocks(linked, ['a', 'b'], 'Motif').error, 'dependency');
    const partial = { ...content, groups: [{ id: 'partial', name: 'Partial', entityIds: ['a'] }] };
    assert.equal(replaceDrawingSmartBlocks(partial, ['a', 'b'], 'Motif').error, 'group');
    const interleaved = { ...content, entities: [content.entities[0], { id: 'other', type: 'circle', layerId: content.activeLayerId, cx: 8, cy: 8, r: 1 }, ...content.entities.slice(1)] };
    assert.equal(replaceDrawingSmartBlocks(interleaved, ['a', 'b'], 'Motif').error, 'order');
});

test('definition replacement preserves instance identity/placement and validates the whole selection', () => {
    const converted = replaceDrawingSmartBlocks(fixture(), ['a', 'b'], 'Motif').content;
    const replacement = { ...converted.blocks[0], id: 'new-block', name: 'Replacement', entities: [{ ...converted.blocks[0].entities[0], x2: 7 }] };
    const content = { ...converted, blocks: [...converted.blocks, replacement] };
    const result = replaceDrawingBlockInstances(content, ['a', 'a-copy'], 'Replacement');
    assert.equal(result.count, 2);
    for (let i = 0; i < 2; i += 1) {
        assert.equal(result.content.entities[i].id, content.entities[i].id);
        assert.deepEqual(result.content.entities[i].transform, content.entities[i].transform);
        assert.equal(result.content.entities[i].blockId, 'new-block');
    }
    const locked = { ...content, entities: content.entities.map((entity, i) => i ? { ...entity, locked: true } : entity) };
    assert.equal(replaceDrawingBlockInstances(locked, ['a', 'a-copy'], 'Replacement').error, 'selection');
    assert.equal(content.entities[0].blockId, converted.blocks[0].id);
});


test('rectangle and polygon motifs compare the same affine representation on both sides', () => {
    const content = createDefaultDrawingContent();
    for (const source of [
        { id: 'shape', type: 'rectangle', x: 0, y: 0, width: 3, height: 2, rotation: 0 },
        { id: 'shape', type: 'polygon', cx: 0, cy: 0, r: 2, sides: 5, rotation: 0 },
        { id: 'shape', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 2 }], closed: true },
        { id: 'shape', type: 'arc', cx: 0, cy: 0, r: 2, startAngle: 0, endAngle: 1, counterClockwise: true },
        { id: 'shape', type: 'circle', cx: 0, cy: 0, r: 2 },
    ]) {
        source.layerId = content.activeLayerId;
        const matrix = multiplyAffineMatrices(translationAffineMatrix(10, 20), multiplyAffineMatrices(rotationAffineMatrix(35), scaleAffineMatrix(2)));
        const normalized = normalizeDrawingContent({ ...content, entities: [source] }).entities[0];
        const target = { ...transformDrawingEntityAffine(normalized, matrix), id: 'copy' };
        const drawing = normalizeDrawingContent({ ...content, entities: [normalized, target] });
        const result = detectDrawingSmartBlocks(drawing, ['shape']);
        assert.equal(result.occurrences?.length, 2, source.type);
        assert.equal(replaceDrawingSmartBlocks(drawing, ['shape'], 'Motif').count, 2, source.type);
    }
    const rectangle = { id: 'rect', type: 'rectangle', layerId: content.activeLayerId, x: 0, y: 0, width: 3, height: 2 };
    const translated = normalizeDrawingContent({ ...content, entities: [rectangle, { ...rectangle, id: 'rect-copy', x: 5 }] });
    assert.equal(detectDrawingSmartBlocks(translated, ['rect']).occurrences.length, 2);
});


test('converted motifs retain transformed geometry through archive and clipboard round trips', () => {
    const original = fixture();
    const converted = replaceDrawingSmartBlocks(original, ['a', 'b'], 'Repeated motif');
    const document = { ...createLcadDocument(), content: converted.content };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(loaded, converted.selectedIds));
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    for (const content of [loaded.content, pasted.content]) {
        assert.equal(content.blocks.length, 1);
        const geometry = content.entities.flatMap(entity => materializeDrawingBlockReference(entity, content.blocks));
        assert.equal(geometry.length, original.entities.length);
        for (let i = 0; i < geometry.length; i += 1) for (const key of ['x1', 'y1', 'x2', 'y2']) {
            assert.ok(Math.abs(geometry[i][key] - original.entities[i][key]) < 1e-8, `${i}.${key}`);
        }
    }
});

test('replacement retains compatible attributes and dynamic values and recovers incompatible values', () => {
    const content = replaceDrawingSmartBlocks(fixture(), ['a', 'b'], 'Original').content;
    const target = { ...content.blocks[0], id: 'dynamic-target', name: 'Dynamic replacement',
        dynamic: { parameters: [{ name: 'Width', type: 'distance', default: 2, min: 1, max: 5 }],
            actions: [{ id: 'move', type: 'move', parameter: 'Width', direction: { x: 1, y: 0 }, targets: [content.blocks[0].entities[0].id] }] } };
    target.entities = [...target.entities, { id: 'tag', type: 'text', text: 'default', attributeDefinition: { tag: 'CODE', constant: false } },
        { id: 'new-tag', type: 'text', text: 'new default', attributeDefinition: { tag: 'NEW', constant: false } }];
    content.blocks.push(target);
    content.entities[0] = { ...content.entities[0], attributeValues: { CODE: 'user value', REMOVED: 'obsolete' }, dynamicValues: { Width: 4, Unknown: 3 } };
    content.entities[1] = { ...content.entities[1], dynamicValues: { Width: 100 } };
    const saved = structuredClone(content);
    const result = replaceDrawingBlockInstances(content, content.entities.map(entity => entity.id), target.name);
    assert.deepEqual(result.content.entities[0].attributeValues, { CODE: 'user value', NEW: 'new default' });
    assert.deepEqual(result.content.entities[0].dynamicValues, { Width: 4 });
    assert.deepEqual(result.content.entities[1].dynamicValues, { Width: 2 });
    assert.deepEqual(content, saved);
    const staticResult = replaceDrawingBlockInstances(result.content, result.selectedIds, 'Original');
    assert.ok(staticResult.content.entities.every(entity => !entity.dynamicValues));
});

test('smart conversion preserves matching rotated fixation and coincidence catalogs in the shared definition', () => {
    const content = fixture();
    content.geometricConstraints = [
        { id: 'joint', type: 'coincident', refs: [{ entityId: 'a', point: 'end' }, { entityId: 'b', point: 'start' }] },
        { id: 'fixed', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] },
        { id: 'copy-joint', type: 'coincident', refs: [{ entityId: 'a-copy', point: 'end' }, { entityId: 'b-copy', point: 'start' }] },
        { id: 'copy-fixed', type: 'fix', refs: [{ entityId: 'a-copy', point: 'start' }], values: [10, 20] },
        { id: 'axis', type: 'horizontal', refs: [{ entityId: 'a' }] },
        { id: 'copy-axis', type: 'vertical', refs: [{ entityId: 'a-copy' }] },
    ];
    const saved = structuredClone(content);
    const result = replaceDrawingSmartBlocks(content, ['a', 'b'], 'Constrained motif');
    assert.ok(!result.error, JSON.stringify(result));
    assert.deepEqual(result.content.geometricConstraints, []);
    assert.equal(result.definition.geometricConstraints.length, 3);
    assert.deepEqual(result.definition.geometricConstraints[1].values, [0, 0]);
    assert.notEqual(result.definition.geometricConstraints[0].id, 'joint');
    const normalized = normalizeDrawingContent(result.content);
    assert.deepEqual(normalized.blocks[0].geometricConstraints, result.definition.geometricConstraints);
    assert.deepEqual(content, saved);
});

test('smart conversion refuses differing catalogs and cross-occurrence constraints atomically', () => {
    const content = fixture();
    for (const constraints of [
        [{ id: 'fixed', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] }],
        [{ id: 'cross', type: 'equal', refs: [{ entityId: 'a' }, { entityId: 'a-copy' }] }],
        [{ id: 'fixed', type: 'fix', refs: [{ entityId: 'a', point: 'start' }], values: [0, 0] },
            { id: 'copy-fixed', type: 'fix', refs: [{ entityId: 'a-copy', point: 'start' }], values: [11, 20] }],
    ]) {
        content.geometricConstraints = constraints;
        const saved = structuredClone(content);
        assert.deepEqual(replaceDrawingSmartBlocks(content, ['a', 'b'], 'Constrained motif'), { error: 'constraints' });
        assert.deepEqual(content, saved);
    }
});

test('smart conversion preserves renamed dimensional graphs across quarter-turn occurrences', () => {
    const content = fixture();
    const matrix = multiplyAffineMatrices(translationAffineMatrix(10, 20), rotationAffineMatrix(90));
    content.entities = [...content.entities.slice(0, 2), ...content.entities.slice(0, 2).map(entity => ({ ...transformDrawingEntityAffine(entity, matrix), id: `${entity.id}-copy` }))];
    content.parameters = [{ name: 'width', type: 'distance', expression: '2m' }, { name: 'width_copy', type: 'distance', expression: '2m' },
        { name: 'report', type: 'distance', expression: 'length_copy * 2' }];
    content.dimensionalConstraints = [
        { id: 'first', name: 'length', type: 'linear', axis: 'x', direction: 1, expression: 'width', refs: [{ entityId: 'a' }] },
        { id: 'second', name: 'length_copy', type: 'linear', axis: 'y', direction: 1, expression: 'width_copy', refs: [{ entityId: 'a-copy' }] },
    ];
    const saved = structuredClone(content);
    const result = replaceDrawingSmartBlocks(content, ['a', 'b'], 'Driven motif');
    assert.ok(!result.error, result.error);
    assert.equal(result.definition.dimensionalConstraints.length, 1);
    assert.equal(result.definition.parameters[0].name, 'width');
    assert.deepEqual(result.content.dimensionalConstraints, []);
    assert.equal(result.content.parameters.find(item => item.name === 'length_copy').expression, 'width_copy');
    assert.doesNotThrow(() => normalizeDrawingContent(result.content));
    assert.deepEqual(content, saved);
    const mismatch = structuredClone(content); mismatch.parameters[1].expression = '1m + 1m';
    assert.deepEqual(replaceDrawingSmartBlocks(mismatch, ['a', 'b'], 'Mismatch'), { error: 'constraints' });
    const missing = structuredClone(content); missing.dimensionalConstraints.pop(); missing.parameters.pop();
    assert.deepEqual(replaceDrawingSmartBlocks(missing, ['a', 'b'], 'Missing driver'), { error: 'constraints' });
});
