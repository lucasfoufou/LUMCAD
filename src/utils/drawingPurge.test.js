import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { parseDrawingPurgeInput, purgeDrawingDefinitions } from './drawingPurge.js';
const fixture = () => {
    const content = createDefaultDrawingContent();
    content.layers.push({ id: 'used-layer', name: 'Used' }, { id: 'unused-layer', name: 'Unused' });
    content.blocks = [
        { id: 'parent', name: 'Parent', entities: [{ type: 'blockReference', blockId: 'child' }] },
        { id: 'child', name: 'Child', entities: [{ type: 'text', layerId: 'used-layer', textStyleId: 'used-style' }] },
        { id: 'dead-a', name: 'Dead A', entities: [{ type: 'blockReference', blockId: 'dead-b' }] },
        { id: 'dead-b', name: 'Dead B', entities: [{ type: 'blockReference', blockId: 'dead-a', layerId: 'unused-layer' }] },
    ];
    content.textStyles.push({ id: 'used-style', name: 'Label' }, { id: 'unused-style', name: 'Unused style' });
    return { content, layouts: [{ paperEntities: [{ type: 'blockReference', blockId: 'parent' }] }] };
};

test('purge traces paper-space nested blocks and styles, removing unreachable cycles and unused resources atomically', () => {
    const document = fixture(); const original = structuredClone(document);
    const result = purgeDrawingDefinitions(document);
    assert.deepEqual(result.content.blocks.map(block => block.id), ['parent', 'child']);
    assert.ok(result.content.layers.some(layer => layer.id === 'used-layer'));
    assert.ok(!result.content.layers.some(layer => layer.id === 'unused-layer'));
    assert.ok(result.content.textStyles.some(style => style.id === 'used-style'));
    assert.ok(!result.content.textStyles.some(style => style.id === 'unused-style'));
    assert.equal(result.report.removed, 4); assert.deepEqual(document, original);
    assert.equal(purgeDrawingDefinitions({ ...document, content: result.content }).changed, false);
});

test('purge respects current defaults, indirect map references and unpurged catalog dependencies', () => {
    const document = fixture();
    document.content.activeTextStyleId = 'unused-style';
    document.content.layerStates = [{ layers: { 'unused-layer': { visible: false } } }];
    const result = purgeDrawingDefinitions(document, { scope: 'STYLES' });
    assert.equal(result.changed, false);
    const layers = purgeDrawingDefinitions(fixture(), { scope: 'LAYERS' });
    assert.equal(layers.changed, false); // The unpurged dead block still owns the layer.
    const all = purgeDrawingDefinitions(document);
    assert.ok(all.content.textStyles.some(style => style.id === 'unused-style'));
    assert.ok(all.content.layers.some(layer => layer.id === 'unused-layer'));
    assert.ok(all.content.layers.some(layer => layer.id === 'geometry'));
});

test('purge scope parsing and work limits reject malformed or partial proposals', () => {
    assert.deepEqual(parseDrawingPurgeInput('STYLES PREVIEW'), { scope: 'STYLES', preview: true });
    for (const input of ['ALL BLOCKS', 'PREVIEW PREVIEW', 'ANYTHING']) assert.equal(parseDrawingPurgeInput(input), null);
    assert.deepEqual(purgeDrawingDefinitions(fixture(), { maxVisits: 2 }), { error: 'limit' });
});
