import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { normalizeNamedDrawingViews, namedDrawingViewBox, runNamedDrawingViewCommand, importNamedDrawingViews } from './drawingNamedViews.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const viewport = { x: 50, y: -10, width: 20, height: 10 };

test('view save, replace, rename, restore and delete preserve identity and undo snapshots', () => {
    const source = createDefaultDrawingContent();
    const saved = runNamedDrawingViewCommand(source, viewport, 'SAVE "Roof detail"').content;
    const replaced = runNamedDrawingViewCommand(saved, { ...viewport, x: 60 }, 'SAVE "Roof detail"').content;
    assert.equal(replaced.namedViews[0].id, saved.namedViews[0].id);
    assert.equal(saved.namedViews[0].x, 50);
    const renamed = runNamedDrawingViewCommand(replaced, viewport, 'RENAME "Roof detail" Detail').content;
    assert.equal(renamed.namedViews[0].id, saved.namedViews[0].id);
    assert.equal(runNamedDrawingViewCommand(renamed, viewport, 'detail', true).view.x, 60);
    assert.deepEqual(runNamedDrawingViewCommand(renamed, viewport, 'DELETE Detail').content.namedViews, []);
    assert.deepEqual(source.namedViews, []);
});

test('restoration preserves centre and includes the full original extent at changed aspect ratios', () => {
    assert.deepEqual(namedDrawingViewBox(viewport, { width: 1000, height: 1000 }), { x: 40, y: -20, width: 20, height: 20 });
    assert.deepEqual(namedDrawingViewBox(viewport, { width: 2000, height: 500 }), { x: 30, y: -15, width: 40, height: 10 });
    assert.equal(namedDrawingViewBox({ ...viewport, width: Infinity }, { width: 100, height: 100 }), null);
});

test('view import remaps IDs and colliding names while malformed extents are rejected', () => {
    const content = runNamedDrawingViewCommand(createDefaultDrawingContent(), viewport, 'SAVE Roof').content;
    const result = importNamedDrawingViews(content, content.namedViews);
    assert.deepEqual(result.content.namedViews.map(view => view.name), ['Roof', 'Roof (2)']);
    assert.notEqual(result.content.namedViews[1].id, content.namedViews[0].id);
    assert.deepEqual(normalizeNamedDrawingViews([null, { ...content.namedViews[0], height: 0 }]), []);
    assert.equal(runNamedDrawingViewCommand(content, viewport, 'SAVE').error, 'syntax');
    assert.equal(runNamedDrawingViewCommand(content, viewport, 'RESTORE absent').error, 'missing');
});

test('view catalog survives browser archive persistence', () => {
    const content = runNamedDrawingViewCommand(createDefaultDrawingContent(), viewport, 'SAVE Roof').content;
    const envelope = createLcadEnvelope({ ...createLcadDocument(), content });
    assert.deepEqual(readLcadArchive(createLcadArchive(envelope)).document.content.namedViews, content.namedViews);
});
