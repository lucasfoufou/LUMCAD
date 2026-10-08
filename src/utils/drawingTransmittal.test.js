import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { attachDrawingReference } from './drawingReferences.js';
import { rebuildDrawingTableEntity } from './drawingTableGeometry.js';
import { createDrawingSheetSet } from './drawingSheetSets.js';
import { createTranslator } from '../i18n/translator.js';
import { createDrawingTransmittal } from './drawingTransmittal.js';

function fixture() {
    let root = createLcadDocument({ name: 'Root' });
    let child = createLcadDocument({ name: 'Child' });
    child.content.entities = [{ id: 'line', type: 'line', layerId: child.content.layers[0].id, x1: 0, y1: 0, x2: 5, y2: 0 }];
    const rootSnapshot = structuredClone(root);
    root = attachDrawingReference(root, child, { path: 'refs/main.lcad' });
    child = attachDrawingReference(child, rootSnapshot, { path: '../main.lcad' });
    root.content.entities.push(rebuildDrawingTableEntity({ id: 'table', type: 'polyline', layerId: root.content.layers[0].id,
        table: { cells: [['Item', 'Amount'], ['Roof', '5']], dataLink: { path: '/project/values.csv', name: 'values.csv', delimiter: ',' } } }));
    const files = new Map([
        ['/project/main.lcad', createLcadArchive(createLcadEnvelope(root))],
        ['/project/refs/main.lcad', createLcadArchive(createLcadEnvelope(child))],
        ['/project/values.csv', strToU8('Item,Amount\nRoof,5\n')],
    ]);
    const set = createDrawingSheetSet('Permit');
    set.sources = [{ id: 'root', path: 'main.lcad', documentId: root.id }, { id: 'alias', path: './main.lcad', documentId: root.id }];
    set.sheets = [{ id: 'sheet', sourceId: 'root', layoutId: root.layouts[0].id, number: 'A1', title: 'Plan' }];
    const reads = [];
    const adapters = {
        resolvePath: async (path, relativeTo) => posix.resolve(posix.dirname(relativeTo), path),
        readBytes: async path => { reads.push(path); if (!files.has(path)) throw new Error('missing source'); return files.get(path); },
    };
    return { root, child, files, set, reads, adapters };
}

test('transmittal relocates recursive drawings and CSV links, deduplicates cycles/aliases and preserves originals', async () => {
    const { files, set, reads, adapters } = fixture();
    const before = structuredClone({ files, set });
    const result = await createDrawingTransmittal(set, '/project/index.json', adapters);
    const zip = unzipSync(result.bytes);
    const index = JSON.parse(strFromU8(zip['sheet-set.json']));
    assert.equal(index.sources[0].path, index.sources[1].path);
    assert.equal(reads.length, 3);
    const root = readLcadArchive(zip[index.sources[0].path]).document;
    const ref = root.content.entities.find(entity => entity.externalReference);
    const child = readLcadArchive(zip[`drawings/${ref.externalReference.path}`]).document;
    assert.equal(child.id, ref.externalReference.sourceDocumentId);
    assert.equal(child.content.entities.find(entity => entity.externalReference).externalReference.path, posix.basename(index.sources[0].path));
    const table = root.content.entities.find(entity => entity.table);
    assert.equal(strFromU8(zip[`drawings/${table.table.dataLink.path}`]), 'Item,Amount\nRoof,5\n');
    assert.deepEqual({ files, set }, before);
    assert.equal(result.report.files.length, 3);
    assert.ok(Object.keys(zip).every(path => !path.startsWith('/') && !path.includes('..')));
});

test('missing dependencies and mismatched source identities refuse the complete transmittal', async () => {
    const { set, files, adapters } = fixture();
    files.delete('/project/values.csv');
    await assert.rejects(createDrawingTransmittal(set, '/project/index.json', adapters), /sheetSetDependencyUnreadable/);
    files.set('/project/values.csv', new Uint8Array());
    const replaced = createLcadDocument();
    files.set('/project/refs/main.lcad', createLcadArchive(createLcadEnvelope(replaced)));
    await assert.rejects(createDrawingTransmittal(set, '/project/index.json', adapters), /sheetSetSourceChanged/);
});

test('transmittal file, edge, compressed and decoded budgets reject before output', async () => {
    const { set, adapters } = fixture();
    for (const limit of [{ maxFiles: 1 }, { maxEdges: 1 }, { maxBytes: 1 }, { maxDecodedCharacters: 1 }]) {
        await assert.rejects(createDrawingTransmittal(set, '/project/index.json', { ...adapters, ...limit }), /sheetSetLimit/);
    }
});


test('inventory reports deduplicated source paths and sizes without leaking absolute paths into the archive', async () => {
    const { set, adapters, files } = fixture();
    const result = await createDrawingTransmittal(set, '/project/index.json', adapters);
    assert.equal(result.inventory.complete, true);
    assert.equal(result.inventory.files.length, 3);
    for (const file of result.inventory.files) {
        assert.equal(file.collected, true);
        assert.equal(file.bytes, files.get(file.sourcePath).byteLength);
    }
    const report = strFromU8(unzipSync(result.bytes)['transmittal.json']);
    assert.ok(!report.includes('/project/'));
    assert.ok(result.report.files.some(file => file.name === 'values.csv' && file.kind === 'csv'));
});

test('failed inventory identifies unreadable, invalid and replaced files and never returns an archive', async () => {
    for (const mode of ['missing', 'invalid', 'replaced']) {
        const { set, adapters, files } = fixture();
        const path = '/project/refs/main.lcad';
        if (mode === 'missing') files.delete(path);
        if (mode === 'invalid') files.set(path, strToU8('not a drawing'));
        if (mode === 'replaced') files.set(path, createLcadArchive(createLcadEnvelope(createLcadDocument())));
        await assert.rejects(createDrawingTransmittal(set, '/project/index.json', adapters), error => {
            const inventory = error.transmittalInventory;
            assert.equal(inventory.complete, false);
            assert.equal(inventory.issue.code, { missing: 'sheetSetDependencyUnreadable', invalid: 'sheetSetDependencyInvalid', replaced: 'sheetSetSourceChanged' }[mode]);
            assert.equal(inventory.issue.path, path);
            assert.equal(inventory.files.find(file => file.sourcePath === path).collected, mode === 'replaced');
            assert.ok(!Object.hasOwn(error, 'bytes'));
            return true;
        });
    }
});


test('portable text report is localized, lists every source and explains extraction without local paths', async () => {
    const { set, adapters } = fixture();
    for (const locale of ['en', 'fr']) {
        const t = createTranslator(locale);
        const result = await createDrawingTransmittal(set, '/project/index.json', { ...adapters, translate: t });
        const text = strFromU8(unzipSync(result.bytes)['transmittal.txt']);
        assert.ok(text.startsWith(t('sheetSet.inventoryTitle')));
        assert.ok(text.includes(t('sheetSet.transmittalInstructions')));
        assert.ok(!text.includes('/project/'));
        for (const file of result.report.files) {
            assert.ok(text.includes(file.path));
            assert.ok(text.includes(file.name));
        }
    }
});


test('report size preflight enforces the native root-file limit before returning a package', async () => {
    const { set, adapters } = fixture();
    await assert.rejects(createDrawingTransmittal(set, '/project/index.json', {
        ...adapters, translate: key => key === 'sheetSet.inventoryTitle' ? 'x'.repeat(4 * 1024 * 1024) : key,
    }), error => error.message === 'sheetSetLimit' && error.transmittalInventory.complete === false);
});
