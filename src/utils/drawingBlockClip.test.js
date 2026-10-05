import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingBlockClip, parseDrawingBlockClipInput, clipDrawingSnapEntity, drawingClipContainsPoint } from './drawingBlockClip.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, getDrawingBlockReferenceBounds, materializeDrawingBlockReference } from './drawingBlocks.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const clip = parseDrawingBlockClipInput('RECT -2 -2 2 2').blockClip;
const line = { id: 'line', type: 'line', layerId: 'geometry', x1: -10, y1: 0, x2: 10, y2: 0 };
function fixture() {
    const block = createAnonymousDrawingBlock([line], { basePoint: { x: 0, y: 0 } });
    const reference = { ...createAnonymousDrawingBlockReference(block), blockClip: clip };
    return { ...createDefaultDrawingContent(), entities: [reference], blocks: [block] };
}

test('block clip accepts bounded local coordinates and rejects crossed or degenerate polygons', () => {
    assert.equal(clip.points[0].x, -2);
    assert.equal(parseDrawingBlockClipInput('POLYGON 0 0 2 2 0 2 2 0'), null);
    assert.equal(parseDrawingBlockClipInput('RECT 0 0 0 5'), null);
    assert.equal(normalizeDrawingBlockClip({ points: Array.from({ length: 129 }, () => ({ x: 0, y: 0 })) }), null);
    assert.equal(parseDrawingBlockClipInput('OFF', clip).blockClip.enabled, false);
    assert.deepEqual(parseDrawingBlockClipInput('DELETE', clip), { blockClip: undefined });
});

test('native line/circle/construction intervals clip to the visible polygon for snapping', () => {
    const parts = clipDrawingSnapEntity(line, clip.points);
    assert.equal(parts.length, 1); assert.equal(parts[0].x1, -2); assert.equal(parts[0].x2, 2);
    const circles = clipDrawingSnapEntity({ id: 'circle', type: 'circle', cx: 0, cy: 0, r: 3 }, parseDrawingBlockClipInput('RECT 0 -4 4 4').blockClip.points);
    assert.ok(circles.length); assert.ok(circles.every(part => part.type === 'arc'));
    assert.equal(clipDrawingSnapEntity({ ...line, type: 'xline' }, clip.points)[0].x1, -2);
    assert.equal(clipDrawingSnapEntity(line, clip.points, { checks: 0 }).length, 0);
    assert.equal(drawingClipContainsPoint(clip.points, { x: 2, y: 0 }), true);
});

test('nested affine references share clipped snaps, bounds, archive and SVG output', () => {
    const content = fixture();
    content.entities[0].transform = { a: 0, b: 2, c: -2, d: 0, e: 10, f: 20 };
    const normalized = normalizeDrawingContent(content);
    const snap = drawingSnapEntities(normalized)[0];
    assert.equal(snap.x1, 10); assert.equal(snap.y1, 16); assert.equal(snap.y2, 24);
    const bounds = getDrawingBlockReferenceBounds(normalized.entities[0], normalized.blocks);
    assert.equal(bounds.minY, 16); assert.equal(bounds.maxY, 24);
    assert.equal(materializeDrawingBlockReference(normalized.entities[0], normalized.blocks).length, 0);
    const payload = createDrawingClipboardPayload(normalized, [normalized.entities[0].id]);
    assert.match(drawingClipboardPayloadToSvg(payload), /clip-path="url\(#block-clip-/);
    const document = { ...createLcadDocument(), content: normalized };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.entities[0].blockClip, clip);
    assert.equal(materializeDrawingBlockReference({ ...normalized.entities[0], blockClip: undefined }, normalized.blocks).length, 1);
});
