import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkDrawingEntities } from './drawingSceneChunks.js';

const entities = count => Array.from({ length: count }, (_, index) => ({ id: `entity-${index}` }));

test('scene chunks cover every entity once, in document order', () => {
    const list = entities(5000);
    const chunks = chunkDrawingEntities(list);
    assert.deepEqual(chunks.flatMap(chunk => chunk.positions), list.map((_, index) => index));
    assert.ok(chunks.length > 10 && chunks.length < 200, `${chunks.length} chunks`);
    assert.ok(chunks.every(chunk => chunk.positions.length <= 1024));
    assert.equal(new Set(chunks.map(chunk => chunk.key)).size, chunks.length);
});

test('deleting or inserting one entity changes at most the chunks around it', () => {
    const list = entities(5000);
    const before = chunkDrawingEntities(list);
    const removed = chunkDrawingEntities(list.filter((_, index) => index !== 2500));
    const inserted = chunkDrawingEntities([...list.slice(0, 2500), { id: 'new-entity' }, ...list.slice(2500)]);
    const keysOf = chunks => new Set(chunks.map(chunk => chunk.key));
    for (const after of [removed, inserted]) {
        const unchanged = [...keysOf(before)].filter(key => keysOf(after).has(key));
        assert.ok(unchanged.length >= before.length - 2, `${before.length - unchanged.length} chunk keys changed`);
    }
});
