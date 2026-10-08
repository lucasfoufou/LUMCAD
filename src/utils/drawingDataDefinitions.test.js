import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { manageDrawingDataDefinition, prepareDrawingDataReport } from './drawingDataCommands.js';
import { normalizeDrawingDataDefinitions } from './drawingDataDefinitions.js';

test('saved extraction reruns current quantities, preserves its identity and stores no destination', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: 4 }];
    const saved = manageDrawingDataDefinition(content, ['a'], 'SAVE "My quantities" SELECTED GROUP type SUM length').content;
    const id = saved.dataExtractions[0].id;
    assert.deepEqual(saved.dataExtractions[0].selectedIds, ['a']);
    assert.deepEqual(normalizeDrawingContent(saved).dataExtractions, saved.dataExtractions);
    assert.equal(manageDrawingDataDefinition(saved, [], 'SAVE "My quantities" GROUP layer').content.dataExtractions[0].id, id);
    saved.entities[0].x2 = 0;
    const run = manageDrawingDataDefinition(saved, [], 'RUN "my quantities" JSON TO "/tmp/quantities.json"');
    assert.equal(run.options.path, '/tmp/quantities.json');
    assert.equal(prepareDrawingDataReport(saved, run.selectedIds, run.options).rows[0].sums.length, 4);
    assert.ok(!Object.hasOwn(saved.dataExtractions[0], 'path'));
    assert.equal(manageDrawingDataDefinition(saved, [], 'RUN "My quantities" ALL').error, 'syntax');
    saved.entities = [];
    assert.equal(manageDrawingDataDefinition(saved, [], 'RUN "My quantities"').error, 'definitionSelectionMissing');
    assert.deepEqual(manageDrawingDataDefinition(saved, [], 'DELETE "My quantities"').content.dataExtractions, []);
});

test('definition normalization rejects invalid fields/scopes and duplicate identities without changing legacy documents', () => {
    assert.deepEqual(normalizeDrawingContent({}).dataExtractions, []);
    const valid = { id: 'a', name: 'one', groupBy: ['attribute:CODE'], sums: [], nested: false, selectedIds: null };
    assert.equal(normalizeDrawingDataDefinitions([valid, { ...valid, id: 'b', name: 'ONE' }]).length, 1);
    for (const bad of [{ selectedIds: [] }, { sums: ['layer'] }, { groupBy: ['constructor'] }, { nested: 'yes' }, { selectedIds: ['a', 'a'] }]) {
        assert.deepEqual(normalizeDrawingDataDefinitions([{ ...valid, ...bad }]), []);
    }
    const content = createDefaultDrawingContent();
    assert.equal(manageDrawingDataDefinition(content, [], 'SAVE empty SELECTED').error, 'dataExtractionFields');
    assert.equal(manageDrawingDataDefinition(content, [], 'RUN absent').error, 'definitionMissing');
});


test('portable archives preserve selected extraction IDs and query definitions', () => {
    const doc = createLcadDocument();
    doc.content.entities = [{ id: 'source', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 }];
    doc.content = manageDrawingDataDefinition(doc.content, ['source'], 'SAVE quantity SELECTED GROUP attribute:CODE SUM length').content;
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(doc))).document;
    assert.deepEqual(loaded.content.dataExtractions, doc.content.dataExtractions);
    const run = manageDrawingDataDefinition(loaded.content, [], 'RUN quantity');
    const report = prepareDrawingDataReport(loaded.content, run.selectedIds, run.options);
    assert.deepEqual(report.rows[0].values, [null]);
    assert.equal(report.rows[0].sums.length, 1);
});
