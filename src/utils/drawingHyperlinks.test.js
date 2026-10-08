import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDrawingHyperlink, parseDrawingHyperlinkInput } from './drawingHyperlinks.js';

test('object hyperlinks preserve web paths, fragments and labels without executable schemes', () => {
    assert.deepEqual(normalizeDrawingHyperlink({ url: ' https://example.com/spec.pdf#page=2 ', label: ' Technical sheet ' }),
        { url: 'https://example.com/spec.pdf#page=2', label: 'Technical sheet' });
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', '/relative', 'https://user:password@example.com', 'https://exa\nmple.com', 'https://' + 'x'.repeat(4096)]) {
        assert.equal(normalizeDrawingHyperlink({ url }), null);
    }
    assert.equal(normalizeDrawingHyperlink({ url: 'https://example.com', label: 'x'.repeat(257) }), null);
});

test('hyperlink command options retain quoted labels and reject ambiguous input', () => {
    assert.deepEqual(parseDrawingHyperlinkInput('SET "https://example.com/a?q=1&b=2" "Panel data sheet"'),
        { action: 'set', link: { url: 'https://example.com/a?q=1&b=2', label: 'Panel data sheet' } });
    assert.deepEqual(parseDrawingHyperlinkInput('OPEN'), { action: 'open' });
    assert.deepEqual(parseDrawingHyperlinkInput('REMOVE'), { action: 'remove' });
    assert.deepEqual(parseDrawingHyperlinkInput(''), { action: 'edit' });
    for (const input of ['OPEN extra', 'REMOVE extra', 'SET', 'SET "javascript:alert(1)"', 'SET https://example.com a b']) {
        assert.throws(() => parseDrawingHyperlinkInput(input));
    }
});

import { createDefaultDrawingContent, normalizeDrawingContent, copySelectedEntities } from './drawingDocument.js';
import { setDrawingHyperlink } from './drawingHyperlinkOperations.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';

test('hyperlinks edit atomically, respect locks and follow archive, copy and clipboard workflows', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 1, y2: 1 }];
    const link = { url: 'https://example.com/spec.pdf#page=2', label: 'Sheet' };
    const linked = setDrawingHyperlink(content, ['line'], link);
    assert.equal(content.entities[0].hyperlink, undefined);
    assert.deepEqual(normalizeDrawingContent(linked).entities[0].hyperlink, link);
    assert.equal(setDrawingHyperlink(linked, ['line'], link), linked);
    const locked = { ...linked, entities: [...linked.entities, { ...linked.entities[0], id: 'locked', locked: true }] };
    assert.throws(() => setDrawingHyperlink(locked, ['line', 'locked'], null));
    assert.throws(() => setDrawingHyperlink(linked, ['missing'], link));
    const state = { past: [], present: content, future: [], coalesceKey: null };
    const edited = commitDrawingHistoryState(state, linked);
    assert.deepEqual(undoDrawingHistoryState(edited).present, content);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(edited)).present, edited.present);
    const drawing = createLcadDocument();
    drawing.content = linked;
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(drawing))).document;
    assert.deepEqual(restored.content.entities[0].hyperlink, link);
    const copied = copySelectedEntities(linked, ['line'], { x: 5, y: 2 });
    assert.deepEqual(copied.content.entities.find(entity => copied.selectedIds.includes(entity.id)).hyperlink, link);
    const payload = createDrawingClipboardPayload({ content: linked, assets: [] }, ['line']);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, payload, { mode: 'original' });
    assert.deepEqual(pasted.content.entities[0].hyperlink, link);
    assert.equal(setDrawingHyperlink(linked, ['line'], null).entities[0].hyperlink, undefined);
    assert.equal(normalizeDrawingContent({ ...content, entities: [{ ...content.entities[0], hyperlink: { url: 'javascript:alert(1)' } }] }).entities[0].hyperlink, undefined);
});
