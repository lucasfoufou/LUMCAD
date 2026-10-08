import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingSheetSetRenderEntries } from './drawingSheetSetPublication.js';

test('multi-drawing render entries retain sheet order, distinct keys, source content and individual paper settings', () => {
    const sources = new Map(['a', 'b'].map((id, index) => [id, { id, content: { entities: [{ id }] }, assets: { [id]: {} },
        layouts: [{ id: 'shared-layout', name: 'Layout', paper: index ? 'a3' : 'a4', plotSettings: { quality: { mode: index ? 'raster' : 'vector' } } }] }]));
    const set = { format: 'lumcad-sheet-set', version: 1, id: 'set', name: 'Project',
        sources: ['a', 'b'].map(id => ({ id, documentId: id, path: `${id}.lcad` })),
        sheets: ['b', 'a', 'b'].map((id, index) => ({ id: `sheet-${index}`, sourceId: id, layoutId: 'shared-layout', number: `${index + 1}`, title: id })) };
    const before = structuredClone({ set, sources });
    const entries = drawingSheetSetRenderEntries(set, sources);
    assert.deepEqual(entries.map(item => item.key), ['sheet-0', 'sheet-1', 'sheet-2']);
    assert.deepEqual(entries.map(item => item.drawing.id), ['b', 'a', 'b']);
    assert.deepEqual(entries.map(item => item.layout.name), ['1 — b', '2 — a', '3 — b']);
    assert.deepEqual(entries.map(item => item.layout.paper), ['a3', 'a4', 'a3']);
    assert.equal(entries[0].drawing, sources.get('b'));
    assert.equal(entries[1].layout.plotSettings.quality.mode, 'vector');
    assert.deepEqual({ set, sources }, before);
    sources.get('a').layouts = [];
    assert.throws(() => drawingSheetSetRenderEntries(set, sources), /sheetSetLayoutMissing/);
});
