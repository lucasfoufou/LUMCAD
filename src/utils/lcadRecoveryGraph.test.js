import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { prepareLcadRecoveryGraph, lcadRecoveryGraphReport } from './lcadRecoveryGraph.js';

function drawing(references = [], extra = {}) {
    const document = createLcadDocument();
    const envelope = createLcadEnvelope(document);
    document.content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 1 },
        ...references.map((file, index) => ({ id: `ref-${index}`, type: 'blockReference', layerId: 'geometry', blockId: 'cached',
            x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
            externalReference: { version: 1, path: file, sourceDocumentId: `source-${index}`, mode: 'overlay', loaded: false } })),
    ];
    document.content.blocks = [{ id: 'cached', name: 'Cached source', entities: [] }];
    Object.assign(document.content, extra);
    return zipSync({ 'manifest.json': strToU8(JSON.stringify({ ...envelope, document })) });
}

function adapters(files) {
    const reads = [];
    return { reads, resolvePath: async (file, parent) => path.posix.resolve(parent ? path.posix.dirname(parent) : '/', file),
        readBytes: async (file, budget) => {
            reads.push(file);
            if (!files[file]) throw new Error('Missing source');
            assert.ok(budget > 0);
            return files[file];
        } };
}

test('RECOVERALL visits shared, relative, overlay and unloaded sources once and preserves source bytes', async () => {
    const files = { '/project/root.lcad': drawing(['child.lcad', './child.lcad']), '/project/child.lcad': drawing() };
    const saved = structuredClone(files); const io = adapters(files);
    const graph = await prepareLcadRecoveryGraph('/project/root.lcad', io);
    assert.equal(graph.complete, true);
    assert.deepEqual(io.reads, ['/project/root.lcad', '/project/child.lcad']);
    assert.equal(graph.entries.length, 2);
    assert.equal(graph.edges[1].status, 'shared');
    assert.deepEqual(files, saved);
    const report = lcadRecoveryGraphReport(graph);
    assert.equal(report.mode, 'recoveryManager');
    assert.equal(report.entries[1].status, 'ready');
    assert.equal(report.entries[1].result, undefined);
    assert.equal(graph.entries[0].result.candidate.document.content.entities[1].externalReference.path, 'child.lcad');
});

test('cycles, missing sources and unresolved graphs report partial results without discarding healthy candidates', async () => {
    const io = adapters({ '/root.lcad': drawing(['child.lcad', 'missing.lcad', 'bad.lcad']),
        '/child.lcad': drawing(['root.lcad']), '/bad.lcad': drawing([], { parameters: [{ name: 'a', type: 'number', expression: 'a' }] }) });
    const graph = await prepareLcadRecoveryGraph('/root.lcad', io);
    assert.equal(graph.complete, false);
    assert.equal(graph.limited, false);
    assert.deepEqual(graph.entries.map(entry => entry.status), ['ready', 'ready', 'failed', 'unresolved']);
    assert.ok(graph.edges.some(edge => edge.status === 'cycle' && edge.to === 'recovery-1'));
    assert.equal(io.reads.filter(file => file === '/root.lcad').length, 1);
});

test('file, reference, byte, expanded-candidate and depth budgets never claim complete recovery', async () => {
    const files = { '/root.lcad': drawing(['child.lcad', 'next.lcad']), '/child.lcad': drawing(), '/next.lcad': drawing() };
    for (const limits of [{ maxFiles: 1 }, { maxDepth: 0 }, { maxReferences: 1 }, { maxBytes: 1 }, { maxCandidateCharacters: 1 }]) {
        const graph = await prepareLcadRecoveryGraph('/root.lcad', { ...adapters(files), ...limits });
        assert.equal(graph.complete, false, JSON.stringify(limits));
        assert.equal(graph.limited, true, JSON.stringify(limits));
        if (limits.maxFiles) assert.equal(graph.entries.length, 1);
    }
    await assert.rejects(prepareLcadRecoveryGraph('/root.lcad', { ...adapters(files), maxFiles: 0 }));
});

test('canonical path identity detects aliases and discarded insertions still contribute their sources', async () => {
    const root = createLcadDocument();
    const envelope = createLcadEnvelope(root);
    root.content.entities = [{ id: 'lost-block', type: 'blockReference', layerId: 'geometry', blockId: 'missing',
        externalReference: { version: 1, path: 'alias.lcad', sourceDocumentId: 'root' } }];
    const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify({ ...envelope, document: root })) });
    let reads = 0;
    const graph = await prepareLcadRecoveryGraph('/root.lcad', { resolvePath: async () => '/root.lcad', readBytes: async () => { reads += 1; return bytes; }, maxFiles: 1 });
    assert.equal(reads, 1);
    assert.equal(graph.entries[0].result.report.quarantine.length, 1);
    assert.equal(graph.edges[0].status, 'cycle');
    assert.equal(graph.complete, false);
});

test('cycles through a shared source are detected even outside the first traversal ancestry', async () => {
    const io = adapters({ '/root.lcad': drawing(['a.lcad', 'b.lcad']), '/a.lcad': drawing(['c.lcad']),
        '/b.lcad': drawing(['c.lcad']), '/c.lcad': drawing(['b.lcad']) });
    const graph = await prepareLcadRecoveryGraph('/root.lcad', io);
    assert.equal(graph.complete, false);
    assert.equal(graph.entries.length, 4);
    assert.ok(graph.edges.some(edge => edge.status === 'cycle' && edge.path === 'b.lcad'));
    assert.equal(new Set(io.reads).size, io.reads.length);
});

test('malformed dependency paths remain reportable and never reach filesystem adapters', async () => {
    const io = adapters({ '/root.lcad': drawing([{ bad: true }]) });
    const graph = await prepareLcadRecoveryGraph('/root.lcad', io);
    assert.equal(graph.complete, false);
    assert.deepEqual(io.reads, ['/root.lcad']);
    assert.equal(graph.entries[1].status, 'failed');
    assert.equal(typeof graph.entries[1].sourcePath, 'string');
    assert.equal(typeof lcadRecoveryGraphReport(graph).edges[0].path, 'string');
});

test('batch traversal also inspects references inside definitions and paper-space entities', async () => {
    const document = createLcadDocument(); const envelope = createLcadEnvelope(document);
    const reference = (id, file) => ({ id, type: 'blockReference', layerId: 'geometry', blockId: 'cached', x: 0, y: 0, scaleX: 1, scaleY: 1,
        externalReference: { version: 1, path: file, sourceDocumentId: id } });
    document.content.blocks = [{ id: 'cached', name: 'Cached', entities: [] }, { id: 'host', name: 'Host', entities: [reference('nested', 'nested.lcad')] }];
    document.layouts[0].paperEntities = [reference('paper', 'paper.lcad')];
    const io = adapters({ '/root.lcad': zipSync({ 'manifest.json': strToU8(JSON.stringify({ ...envelope, document })) }),
        '/nested.lcad': drawing(), '/paper.lcad': drawing() });
    const graph = await prepareLcadRecoveryGraph('/root.lcad', io);
    assert.equal(graph.complete, true);
    assert.deepEqual(io.reads, ['/root.lcad', '/nested.lcad', '/paper.lcad']);
    assert.ok(graph.edges.some(edge => edge.scope === 'content.blocks[1].entities[0]'));
    assert.ok(graph.edges.some(edge => edge.scope === 'layouts[0].paperEntities[0]'));
});

test('saved dependency locations follow recovered sessions and survive parent archive export', async () => {
    const { recordRecoveredCopyPath } = await import('./lcadRecoveryReferences.js');
    const { createLcadRecoveredSession } = await import('./lcadRecovery.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const graph = await prepareLcadRecoveryGraph('/source/root.lcad', adapters({ '/source/root.lcad': drawing(['child.lcad']), '/source/child.lcad': drawing() }));
    const raw = structuredClone(graph);
    const childSession = createLcadRecoveredSession(graph.entries[1].result, 'Child copy', graph);
    const saved = recordRecoveredCopyPath(childSession.recoveryGraph, '/source/child.lcad', '/output/repaired-child.lcad');
    const parentSession = createLcadRecoveredSession(saved.entries[0].result, 'Parent copy', saved);
    const exported = readLcadArchive(createLcadArchive(createLcadEnvelope(parentSession.document))).document;
    assert.equal(exported.content.entities[1].externalReference.path, '/output/repaired-child.lcad');
    assert.equal(exported.content.entities[1].externalReference.loaded, false);
    assert.equal(parentSession.recoveryGraph.entries[1].savedPath, '/output/repaired-child.lcad');
    assert.equal(lcadRecoveryGraphReport(saved).entries[1].savedPath, '/output/repaired-child.lcad');
    assert.deepEqual(graph, raw);
});
