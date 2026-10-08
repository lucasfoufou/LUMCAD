import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { explodeDrawingEntities } from './drawingCompoundOperations.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { runDrawingArcText } from './drawingArcTextCommands.js';
import { rebuildDrawingArcTextEntity, refreshDrawingArcTexts } from './drawingArcText.js';
import { transformEntity, translateEntity, rotateEntity, mirrorEntity } from './drawingPrimitives.js';
import { getEntityBounds } from './drawingGeometry.js';
import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState } from './drawingHistory.js';

function fixture() {
    const document = createLcadDocument();
    const arc = { id: 'arc', layerId: document.content.activeLayerId, type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: Math.PI, endAngle: Math.PI * 2, counterClockwise: true };
    document.content.entities.push(arc);
    return { document, arc, content: document.content };
}

test('arc text lays out editable native graphemes with alignment, direction and bounded input', () => {
    const { content } = fixture(); const before = structuredClone(content);
    const result = runDrawingArcText(content, ['arc'], '"Panneaux été" HEIGHT 0.5 OFFSET 0.2 SPACING 0.05 ALIGN CENTER');
    assert.ok(!result.error, result.error);
    const entity = result.content.entities.at(-1);
    assert.equal(entity.parts.map(part => part.text).join(''), 'Panneaux été');
    assert.ok(entity.parts.every(part => part.type === 'text' && part.affineFrame));
    assert.equal(entity.sourceId, 'arc');
    assert.ok(getEntityBounds(entity));
    const reverse = runDrawingArcText(result.content, [entity.id], 'EDIT "AB" ALIGN START DIRECTION REVERSE');
    assert.ok(!reverse.error);
    assert.notDeepEqual(reverse.content.entities.at(-1).parts[0].affineFrame, entity.parts[0].affineFrame);
    for (const input of ['""', '"AB" HEIGHT -1', '"AB" OFFSET -5', '"AB" HEIGHT 100', '"AB" SPACING -1', '"AB" ALIGN INVALID', '"AB" HEIGHT 1 HEIGHT 2']) {
        assert.ok(runDrawingArcText(content, ['arc'], input).error, input);
    }
    assert.deepEqual(content, before);
});

test('linked arc edits and overflow recovery share exact undo/redo with their source', () => {
    const { content } = fixture();
    const original = runDrawingArcText(content, ['arc'], '"Roof panels" HEIGHT 0.5').content;
    let history = { past: [], present: original, future: [] };
    const next = { ...original, entities: original.entities.map(entity => entity.id === 'arc' ? { ...entity, r: 8 } : entity) };
    history = commitDrawingHistoryState(history, next);
    assert.equal(history.present.entities.at(-1).arcText.arc.r, 8);
    assert.deepEqual(undoDrawingHistoryState(history).present, original);
    assert.deepEqual(redoDrawingHistoryState(undoDrawingHistoryState(history)).present, history.present);
    const tiny = refreshDrawingArcTexts({ ...original, entities: original.entities.map(entity => entity.id === 'arc' ? { ...entity, r: 0.1 } : entity) }, original);
    assert.equal(tiny.entities.at(-1).arcText.status, 'overflow');
    assert.deepEqual(tiny.entities.at(-1).parts, original.entities.at(-1).parts);
    const recovered = refreshDrawingArcTexts({ ...tiny, entities: tiny.entities.map(entity => entity.id === 'arc' ? original.entities[0] : entity) }, tiny);
    assert.equal(recovered.entities.at(-1).arcText.status, 'current');
});

test('paired affine transformations retain linkage and independent label movement detaches without changing its shape', () => {
    const { content } = fixture();
    const original = runDrawingArcText(content, ['arc'], '"Roof"').content;
    for (const transform of [entity => translateEntity(entity, 12, 7), entity => rotateEntity(entity, { x: 2, y: 3 }, 37), entity => transformEntity(entity, { scaleX: 2, scaleY: 2, origin: { x: 0, y: 0 } }),
        entity => mirrorEntity(entity, { x: 0, y: 0 }, { x: 0, y: 1 })]) {
        const next = refreshDrawingArcTexts({ ...original, entities: original.entities.map(transform) }, original);
        assert.equal(next.entities.at(-1).sourceId, 'arc');
        assert.deepEqual(next.entities.at(-1).parts, transform(original.entities.at(-1)).parts);
        const resized = refreshDrawingArcTexts({ ...next, entities: next.entities.map(entity => entity.id === 'arc' ? { ...entity, r: entity.r * 1.2 } : entity) }, next);
        assert.equal(resized.entities.at(-1).arcText.status, 'current');
        assert.notDeepEqual(resized.entities.at(-1).parts, next.entities.at(-1).parts);
    }
    const moved = translateEntity(original.entities.at(-1), 3, 0);
    const next = refreshDrawingArcTexts({ ...original, entities: [original.entities[0], moved] }, original);
    assert.equal(next.entities.at(-1).sourceId, undefined);
    assert.deepEqual(next.entities.at(-1).parts, moved.parts);
});

test('arc text persists editable parameters and affine glyphs through archive normalization', () => {
    const { document, content } = fixture();
    document.content = runDrawingArcText(content, ['arc'], '"Café" HEIGHT 0.3 DIRECTION REVERSE').content;
    const decoded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    const entity = decoded.content.entities.at(-1);
    assert.equal(entity.arcText.text, 'Café');
    assert.equal(entity.sourceId, 'arc');
    assert.deepEqual(rebuildDrawingArcTextEntity(entity).parts, entity.parts);
    const locked = { ...document.content, layers: document.content.layers.map(layer => ({ ...layer, locked: true })) };
    assert.equal(runDrawingArcText(locked, [entity.id], 'EDIT "New"').error, 'selection');
});


test('arc text clipboard remaps its source, SVG centers glyphs and explode creates editable text', () => {
    const { document, content } = fixture();
    document.content = runDrawingArcText(content, ['arc'], '"SOLAR"').content;
    const label = document.content.entities.at(-1);
    const payload = createDrawingClipboardPayload(document, [label.id], { basePoint: { x: 0, y: 0 } });
    assert.equal(payload.entities.length, 2);
    const svg = drawingClipboardPayloadToSvg(payload);
    assert.equal((svg.match(/text-anchor="middle"/g) || []).length, 5);
    assert.ok(svg.includes('matrix('));
    const target = createLcadDocument();
    const pasted = pasteDrawingClipboardPayload(target, payload, { insertionPoint: { x: 20, y: 10 } });
    const refreshed = refreshDrawingArcTexts(pasted.content, target.content);
    const next = refreshed.entities.find(entity => entity.arcText);
    assert.notEqual(next.sourceId, 'arc');
    assert.ok(refreshed.entities.some(entity => entity.id === next.sourceId && entity.type === 'arc'));
    const exploded = explodeDrawingEntities(document.content, [label.id]);
    assert.ok(exploded.changed);
    assert.equal(exploded.content.entities.filter(entity => entity.type === 'text').length, 5);
    assert.ok(!exploded.content.entities.some(entity => entity.arcText));
});
