import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingBlockSymbols, drawingBlockSymbolKey } from './drawingBlockSymbols.js';

const block = { id: 'panel', entities: [{ id: 'edge', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 1 }] };
const reference = { id: 'one', type: 'blockReference', blockId: 'panel', layerId: 'pv', transform: { a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 } };

test('repeated static blocks share geometry without sharing transforms or appearance variants', () => {
    const other = { ...reference, id: 'two', transform: { ...reference.transform, e: 30 } };
    const symbols = createDrawingBlockSymbols([reference, other, { ...reference, id: 'three', layerId: 'roof' },
        { ...reference, id: 'four', plotStyleName: 'gray' }], new Map([[block.id, block]]), 'scene');
    assert.equal(symbols.definitions.length, 3);
    assert.equal(symbols.references.get('one'), symbols.references.get('two'));
    assert.notEqual(symbols.references.get('one'), symbols.references.get('three'));
    assert.deepEqual(symbols.definitions[0].reference.transform, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    assert.equal(reference.transform.e, 10);
});

test('complex blocks and instance-specific clipping retain the full renderer', () => {
    for (const type of ['text', 'blockReference', 'circle', 'linearDimension', 'image', 'hatch', 'xline']) {
        assert.equal(drawingBlockSymbolKey(reference, { ...block, entities: [{ type }] }), null);
    }
    assert.equal(drawingBlockSymbolKey(reference, { ...block, dynamic: {} }), null);
    assert.equal(drawingBlockSymbolKey({ ...reference, blockClip: { enabled: true } }, block), null);
    assert.equal(drawingBlockSymbolKey({ ...reference, externalReference: { loaded: false } }, block), null);
    assert.equal(drawingBlockSymbolKey(reference, undefined), null);
});
