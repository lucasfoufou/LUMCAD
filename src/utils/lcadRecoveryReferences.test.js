import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecoveredReferencePath, prepareRecoveredReferencePaths } from './lcadRecoveryReferences.js';

const reference = (id, path) => ({ id, type: 'blockReference', blockId: 'cache', x: 2, y: 3, externalReference: { path, loaded: false, mode: 'overlay', revision: 'kept' } });

test('portable CSV links anchor at load time across model/block/paper and stay stable after Save As', () => {
    const table = (id, path) => ({ id, table: { cells: [['cached']], dataLink: { path, name: 'data.csv', delimiter: ',' } } });
    const document = { content: { entities: [table('model', 'data.csv')], blocks: [{ entities: [table('block', '../shared.csv')] }] },
        layouts: [{ paperEntities: [table('paper', '/fixed/data.csv')] }] };
    const before = structuredClone(document);
    const loaded = prepareRecoveredReferencePaths(document, '/unpacked/drawings/main.lcad');
    assert.equal(loaded.changes.length, 2);
    assert.equal(loaded.document.content.entities[0].table.dataLink.path, '/unpacked/drawings/data.csv');
    assert.equal(loaded.document.content.blocks[0].entities[0].table.dataLink.path, '/unpacked/drawings/../shared.csv');
    assert.deepEqual(prepareRecoveredReferencePaths(loaded.document, '/elsewhere/copy.lcad').document, loaded.document);
    assert.deepEqual(document, before);
    assert.equal(prepareRecoveredReferencePaths(document, null).unresolved.length, 3);
});

test('recovered reference paths preserve native path semantics, including symlink-sensitive parents', () => {
    assert.equal(resolveRecoveredReferencePath('../sibling.lcad', '/project/link/root.lcad'), '/project/link/../sibling.lcad');
    assert.equal(resolveRecoveredReferencePath('child.lcad', '/project/root.lcad'), '/project/child.lcad');
    assert.equal(resolveRecoveredReferencePath('/other/child.lcad', '/project/root.lcad'), '/other/child.lcad');
    assert.equal(resolveRecoveredReferencePath('child.lcad', 'C:\\project\\root.lcad'), 'C:\\project\\child.lcad');
    assert.equal(resolveRecoveredReferencePath('child.lcad', '\\\\server\\share\\root.lcad'), '\\\\server\\share\\child.lcad');
    assert.equal(resolveRecoveredReferencePath('C:child.lcad', 'D:\\project\\root.lcad'), null);
    assert.equal(resolveRecoveredReferencePath('child.lcad', null), null);
    assert.equal(resolveRecoveredReferencePath('bad\npath', '/project/root.lcad'), null);
});

test('recovered copies pin model, block and paper references while preserving caches and raw candidates', () => {
    const document = { content: { entities: [reference('model', 'child.lcad')], blocks: [{ id: 'cache', entities: [reference('nested', '../other.lcad')] }] },
        layouts: [{ paperEntities: [reference('paper', 'missing.lcad')] }] };
    const original = structuredClone(document);
    const graph = { entries: [{ id: 'root', sourcePath: '/project/root.lcad' }, { id: 'child', sourcePath: '/canonical/child.lcad' }],
        edges: [{ from: 'root', to: 'child', path: 'child.lcad', status: 'visited' }] };
    const result = prepareRecoveredReferencePaths(document, '/project/root.lcad', graph);
    assert.equal(result.changes.length, 3);
    assert.deepEqual(result.unresolved, []);
    assert.equal(result.document.content.entities[0].externalReference.path, '/canonical/child.lcad');
    assert.equal(result.document.content.blocks[0].entities[0].externalReference.path, '/project/../other.lcad');
    assert.equal(result.document.layouts[0].paperEntities[0].externalReference.path, '/project/missing.lcad');
    assert.equal(result.document.content.entities[0].externalReference.loaded, false);
    assert.deepEqual(document, original);
    const reverted = structuredClone(result.document);
    reverted.content.entities[0].externalReference.path = 'child.lcad';
    reverted.content.blocks[0].entities[0].externalReference.path = '../other.lcad';
    reverted.layouts[0].paperEntities[0].externalReference.path = 'missing.lcad';
    assert.deepEqual(reverted, original);
});

test('browser recovery reports unresolved relative paths rather than inventing a source directory', () => {
    const document = { content: { entities: [reference('portable', 'child.lcad')] } };
    const result = prepareRecoveredReferencePaths(document, null);
    assert.deepEqual(result.document, document);
    assert.equal(result.changes.length, 0);
    assert.equal(result.unresolved.length, 1);
});

test('successful saved-copy paths relink subsequent recovered copies without changing raw graph evidence', async () => {
    const { recordRecoveredCopyPath } = await import('./lcadRecoveryReferences.js');
    const graph = { entries: [{ id: 'root', sourcePath: '/source/root.lcad', result: { ready: true } }, { id: 'child', sourcePath: '/source/child.lcad', result: { ready: true } }],
        edges: [{ from: 'root', to: 'child', path: 'child.lcad', status: 'visited' }] };
    const before = structuredClone(graph);
    const saved = recordRecoveredCopyPath(graph, '/source/child.lcad', '/copies/child-fixed.lcad');
    assert.deepEqual(graph, before);
    const document = { content: { entities: [reference('relative', 'child.lcad'), reference('absolute', '/source/child.lcad')] } };
    const result = prepareRecoveredReferencePaths(document, '/source/root.lcad', saved);
    assert.ok(result.document.content.entities.every(entity => entity.externalReference.path === '/copies/child-fixed.lcad'));
    assert.equal(result.changes.length, 2);
    const renamed = recordRecoveredCopyPath(saved, '/source/child.lcad', '/copies/child-renamed.lcad');
    assert.equal(prepareRecoveredReferencePaths(document, '/source/root.lcad', renamed).document.content.entities[0].externalReference.path, '/copies/child-renamed.lcad');
    for (const path of [null, '', 'relative.lcad', '/source/root.lcad', '/source/child.lcad']) assert.equal(recordRecoveredCopyPath(graph, '/source/child.lcad', path), graph);
    assert.equal(recordRecoveredCopyPath(graph, '/source/unknown.lcad', '/copy.lcad'), graph);
});


test('reusing a destination for another recovered source invalidates the previous mapping', async () => {
    const { recordRecoveredCopyPath } = await import('./lcadRecoveryReferences.js');
    const graph = { entries: ['a', 'b'].map(id => ({ id, sourcePath: `/source/${id}.lcad`, result: { ready: true } })) };
    const first = recordRecoveredCopyPath(graph, '/source/a.lcad', '/output/copy.lcad');
    const second = recordRecoveredCopyPath(first, '/source/b.lcad', '/output/copy.lcad');
    assert.equal(second.entries[0].savedPath, undefined);
    assert.equal(second.entries[1].savedPath, '/output/copy.lcad');
    assert.equal(first.entries[0].savedPath, '/output/copy.lcad');
});

test('explicit relink follows a renamed copy with exact undo/redo and no geometry changes', async () => {
    const { recordRecoveredCopyPath } = await import('./lcadRecoveryReferences.js');
    const { createLcadDocument } = await import('./lcadDocument.js');
    const { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } = await import('./drawingHistory.js');
    const document = createLcadDocument();
    document.content.blocks = [{ id: 'cache', name: 'Cache', entities: [] }];
    document.content.entities = [reference('host', '/copies/child-v1.lcad')];
    const graph = { entries: [{ id: 'root', sourcePath: '/source/root.lcad', result: { ready: true } }, { id: 'child', sourcePath: '/source/child.lcad', savedPath: '/copies/child-v1.lcad', result: { ready: true } }] };
    const renamed = recordRecoveredCopyPath(graph, '/source/child.lcad', '/copies/child-v2.lcad');
    const result = prepareRecoveredReferencePaths(document, '/source/root.lcad', renamed);
    assert.equal(result.changes.length, 1);
    assert.equal(result.document.content.entities[0].externalReference.path, '/copies/child-v2.lcad');
    const state = { present: document, past: [], future: [], coalesceKey: null };
    const committed = commitDrawingHistoryState(state, result.document);
    assert.equal(committed.past.length, 1);
    assert.deepEqual(undoDrawingHistoryState(committed).present, document);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(committed)).present, committed.present);
    assert.equal(prepareRecoveredReferencePaths(result.document, '/source/root.lcad', renamed).changes.length, 0);
    assert.equal(result.document.content.entities[0].x, document.content.entities[0].x);
});
