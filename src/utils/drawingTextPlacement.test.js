import assert from 'node:assert/strict';
import test from 'node:test';
import { commitPendingDrawingText, createPendingDrawingText, singleClickTextFrame } from './drawingTextPlacement.js';

const content = { entities: [], layers: [{ id: 'l', name: '0' }], activeLayerId: 'l' };
const entity = { id: 't', type: 'text', layerId: 'l', x: 1, y: 2, width: 3, height: 0.5, text: 'Texte', runs: [{ text: 'Texte' }], textMode: 'singleLine' };

test('one click gives a single-line frame at the style height', () => {
    const corner = singleClickTextFrame({ x: 1, y: 2 }, { fontSize: 0.5 });
    assert.ok(Math.abs(corner.x - 4.5) < 1e-9 && Math.abs(corner.y - 2.7) < 1e-9);
});

test('a placed text starts empty and is only added once something is typed', () => {
    const pending = createPendingDrawingText(entity);
    assert.equal(pending.text, '');
    assert.deepEqual(pending.runs, []);
    assert.equal(commitPendingDrawingText(content, pending), null);
    assert.equal(commitPendingDrawingText(content, { ...pending, text: '   ' }), null);
    const next = commitPendingDrawingText(content, { ...pending, text: 'Toiture Sud' });
    assert.equal(next.entities.length, 1);
    assert.equal(next.entities[0].text, 'Toiture Sud');
});
