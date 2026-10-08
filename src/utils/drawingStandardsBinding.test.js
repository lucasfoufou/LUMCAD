import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { normalizeDrawingContent } from './drawingDocument.js';
import { createDrawingStandards } from './drawingStandards.js';
import { normalizeDrawingStandardsBinding } from './drawingStandardsBinding.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';

test('embedded standards survive archive reopening independently of the source and undo/redo', () => {
    const before = createLcadDocument();
    const standard = createDrawingStandards(before.content, 'Office');
    const after = structuredClone(before);
    after.content.standards = { version: 1, path: '/missing/source/office.json', standard };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(after))).document;
    assert.deepEqual(loaded.content.standards, after.content.standards);
    const state = commitDrawingHistoryState({ past: [], present: before, future: [] }, after);
    assert.equal(undoDrawingHistoryState(state).present.content.standards, null);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(state)).present.content.standards, after.content.standards);
    const detached = commitDrawingHistoryState(state, { ...after, content: { ...after.content, standards: null } });
    assert.deepEqual(undoDrawingHistoryState(detached).present.content.standards, after.content.standards);
    assert.deepEqual(before.content.standards, null);
});

test('old drawings have no binding; malformed embedded rules refuse instead of silently losing them', () => {
    const content = createLcadDocument().content;
    delete content.standards;
    assert.equal(normalizeDrawingContent(content).standards, null);
    const binding = { version: 1, path: null, standard: createDrawingStandards(content) };
    assert.deepEqual(normalizeDrawingStandardsBinding(binding), binding);
    for (const bad of [{ ...binding, version: 2 }, { ...binding, path: 'relative.json' }, { ...binding, path: '/bad\0.json' },
        { ...binding, standard: { ...binding.standard, version: 2 } }]) {
        assert.throws(() => normalizeDrawingContent({ ...content, standards: bad }));
    }
    const normalized = normalizeDrawingStandardsBinding(binding);
    normalized.standard.catalogs.layers[0].values.color = '#ff0000';
    assert.notDeepEqual(normalized, binding);
});
