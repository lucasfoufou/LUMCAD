import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive } from './lcadArchive.js';
import { createDrawingSheetSet } from './drawingSheetSets.js';
import { loadDrawingSheetSetSources } from './drawingSheetSetSources.js';

function fixture() {
    const document = createLcadDocument();
    const bytes = createLcadArchive(createLcadEnvelope(document));
    const set = createDrawingSheetSet('Project');
    set.sources = [{ id: 'a', path: 'plans/main.lcad', documentId: document.id }, { id: 'alias', path: 'linked.lcad', documentId: document.id }];
    set.sheets = set.sources.map((source, index) => ({ id: `sheet-${index}`, sourceId: source.id, layoutId: document.layouts[0].id, number: String(index + 1), title: 'Plan' }));
    return { document, bytes, set };
}

test('canonical source aliases share one archive read and keep explicit sheet order and identities', async () => {
    const { document, bytes, set } = fixture();
    const before = structuredClone(set); const requests = []; let reads = 0;
    const loaded = await loadDrawingSheetSetSources(set, '/project/index.json', {
        resolvePath: async (path, relativeTo) => { requests.push([path, relativeTo]); return '/project/plans/main.lcad'; },
        readBytes: async (path, limit) => { reads++; assert.ok(limit >= bytes.length); return bytes; },
    });
    assert.equal(reads, 1);
    assert.equal(loaded.totalBytes, bytes.length);
    assert.equal(loaded.sources.get('a'), loaded.sources.get('alias'));
    assert.deepEqual(loaded.pages.map(page => page.documentId), [document.id, document.id]);
    assert.deepEqual(requests, [['plans/main.lcad', '/project/index.json'], ['linked.lcad', '/project/index.json']]);
    assert.deepEqual(set, before);
});

test('missing sources, changed document identity and missing layouts reject the complete publication', async () => {
    const { bytes, set } = fixture();
    const adapters = { resolvePath: async path => path, readBytes: async () => bytes };
    await assert.rejects(loadDrawingSheetSetSources(set, '/project/index.json', { ...adapters, readBytes: async path => {
        if (path === 'linked.lcad') throw new Error('missing file');
        return bytes;
    } }), /missing file/);
    const wrong = structuredClone(set); wrong.sources[1].documentId = 'replaced';
    await assert.rejects(loadDrawingSheetSetSources(wrong, '/project/index.json', adapters), /sheetSetSourceChanged/);
    const missing = structuredClone(set); missing.sheets[1].layoutId = 'removed-layout';
    await assert.rejects(loadDrawingSheetSetSources(missing, '/project/index.json', adapters), /sheetSetLayoutMissing/);
});

test('aggregate compressed and decoded budgets are enforced before a publishable result is returned', async () => {
    const { bytes, set } = fixture();
    const limits = [];
    const adapters = { resolvePath: async path => path, readBytes: async (path, limit) => { limits.push(limit); return bytes; } };
    await assert.rejects(loadDrawingSheetSetSources(set, null, { ...adapters, maxBytes: bytes.length + 10 }), /sheetSetLimit/);
    assert.deepEqual(limits, [bytes.length + 10, 10]);
    await assert.rejects(loadDrawingSheetSetSources(set, null, { ...adapters, maxDocumentCharacters: 10 }), /sheetSetLimit/);
    await assert.rejects(loadDrawingSheetSetSources(set, null, { ...adapters, readBytes: async () => new Uint8Array([1, 2, 3]) }));
});

test('asynchronous reading uses a stable set snapshot and ignores unused sources', async () => {
    const { bytes, set } = fixture();
    set.sources.push({ id: 'unused', path: 'absent.lcad', documentId: 'unused' });
    const loaded = await loadDrawingSheetSetSources(set, '/index.json', {
        resolvePath: async path => { set.sheets[0].number = 'changed-during-load'; assert.notEqual(path, 'absent.lcad'); return '/main.lcad'; },
        readBytes: async () => bytes,
    });
    assert.equal(loaded.pages[0].number, '1');
});
