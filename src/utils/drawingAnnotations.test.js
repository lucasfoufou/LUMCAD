import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { ANNOTATION_HIDDEN, normalizeDrawingAnnotation, normalizeAnnotationScales, resolveDrawingAnnotationContent, restoreDrawingAnnotationContent, rebaseDrawingAnnotation } from './drawingAnnotations.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import { createDrawingViewport, applyDrawingViewportDisplaySettings } from './drawingLayouts.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { isDrawingObjectHidden } from './drawingObjectVisibility.js';
import { translateEntity } from './drawingPrimitives.js';

const annotation = { baseScale: 100, scales: [{ scale: 100, offset: { x: 0, y: 0 } }, { scale: 50, offset: { x: 2, y: 3 } }] };
const text = { id: 'note', type: 'text', layerId: 'geometry', x: 10, y: 20, width: 4, height: 2, fontSize: 0.4, text: 'Test', rotation: 0, annotation };
const fixture = () => ({ ...createDefaultDrawingContent(), entities: [text] });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('annotation normalization bounds catalogs, rejects invalid scales and drops duplicate representations', () => {
    assert.equal(normalizeDrawingAnnotation({ baseScale: Infinity, scales: [100] }), null);
    assert.equal(normalizeDrawingAnnotation({ baseScale: 100, scales: [] }), null);
    assert.equal(normalizeDrawingAnnotation({ baseScale: 100, scales: Array.from({ length: 100 }, (_, i) => i + 1) }).scales.length, 64);
    assert.equal(normalizeDrawingAnnotation({ baseScale: 100, scales: [100, 100, -1] }).scales.length, 1);
    assert.deepEqual(normalizeAnnotationScales([Infinity, 100, -1, 50, 100]), [50, 100]);
});

test('scale contexts preserve canonical text, apply offsets and invert live size/position edits', () => {
    const source = fixture();
    const display = resolveDrawingAnnotationContent(source, 50);
    const shown = display.entities[0];
    close(shown.width, 2); close(shown.fontSize, 0.2); close(shown.x, 12); close(shown.y, 23);
    assert.deepEqual(restoreDrawingAnnotationContent(display).entities[0], text);
    const modified = { ...display, entities: [{ ...translateEntity(shown, 5, 7), fontSize: 0.3 }] };
    const saved = restoreDrawingAnnotationContent(modified).entities[0];
    close(saved.x, 15); close(saved.y, 27); close(saved.fontSize, 0.6); close(saved.width, 4);
    assert.equal(saved.id, text.id); assert.deepEqual(source.entities[0], text);
    const second = resolveDrawingAnnotationContent({ ...source, entities: [saved] }, 100).entities[0];
    close(second.x, 15); close(second.fontSize, 0.6);
});

test('dimensions scale presentation without moving witnesses; hatch pattern scales without changing contour', () => {
    const dimension = { id: 'dim', type: 'linearDimension', layerId: 'dimension', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 }, offset: 2, textSize: 0.35, arrowSize: 0.2,
        annotation: { baseScale: 100, scales: [100, 200] } };
    const hatch = { id: 'hatch', type: 'hatch', layerId: 'geometry', boundaries: [{ type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }], pattern: { name: 'lines', spacing: 0.5 }, annotation: dimension.annotation };
    const display = resolveDrawingAnnotationContent({ ...fixture(), entities: [dimension, hatch] }, 200);
    assert.deepEqual(display.entities[0].p1, dimension.p1); assert.deepEqual(display.entities[0].p2, dimension.p2);
    close(display.entities[0].textSize, 0.7); close(display.entities[0].offset, 2);
    assert.deepEqual(display.entities[1].boundaries, hatch.boundaries); close(display.entities[1].pattern.spacing, 1);
});

test('viewport scale controls visibility, geometry and nested snaps independently of model show-all', () => {
    const source = { ...fixture(), settings: { ...fixture().settings, annotationShowAll: true } };
    const viewport = createDrawingViewport({ rect: { x: 0, y: 0, width: 100, height: 100 }, modelViewBox: { x: 0, y: 0, width: 5, height: 5 } });
    const view = applyDrawingViewportDisplaySettings(source, viewport);
    close(view.entities[0].fontSize, 0.2);
    const hidden = resolveDrawingAnnotationContent(source, 200, { showAll: false });
    assert.equal(isDrawingObjectHidden(hidden, text.id), true);
    assert.equal(drawingSnapEntities(hidden).length, 0);
    const block = createAnonymousDrawingBlock([text]);
    const reference = createAnonymousDrawingBlockReference(block);
    const nested = resolveDrawingAnnotationContent({ ...source, entities: [reference], blocks: [block] }, 200, { showAll: false });
    assert.equal(nested.blocks[0].entities[0][ANNOTATION_HIDDEN], true);
    assert.equal(drawingSnapEntities(nested).length, 0);
});

test('rebase and archive/clipboard round trips retain scale representations without double scaling', () => {
    const source = fixture();
    const rebased = rebaseDrawingAnnotation(text, 50);
    close(rebased.fontSize, 0.2);
    const display = resolveDrawingAnnotationContent({ ...source, entities: [rebased] }, 100);
    close(display.entities[0].fontSize, 0.4);
    const context = resolveDrawingAnnotationContent(source, 50);
    const normalized = normalizeDrawingContent(context);
    close(normalized.entities[0].fontSize, 0.4);
    const document = { ...createLcadDocument(), content: context };
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.entities[0].annotation, annotation);
    close(loaded.content.entities[0].fontSize, 0.4);
    const payload = createDrawingClipboardPayload(context, [text.id]);
    close(payload.entities[0].fontSize, 0.4);
    const pasted = pasteDrawingClipboardPayload(createDefaultDrawingContent(), payload);
    const pastedContent = pasted.content || pasted.document?.content;
    assert.ok(pastedContent);
    close(resolveDrawingAnnotationContent(pastedContent, 50).entities[0].fontSize, 0.2);
});

test('tiny text representations use a native affine frame rather than invalid font metrics', () => {
    const source = { ...fixture(), entities: [{ ...text, annotation: { baseScale: 100, scales: [1, 100] } }] };
    const entity = resolveDrawingAnnotationContent(source, 1).entities[0];
    assert.equal(entity.fontSize, 0.4);
    close(entity.affineFrame.a, 0.01);
    close(entity.affineFrame.e + entity.x * entity.affineFrame.a, text.x);
    assert.deepEqual(restoreDrawingAnnotationContent(resolveDrawingAnnotationContent(source, 1)).entities[0], source.entities[0]);
});

test('dimension and hatch representation offsets preserve their source geometry', () => {
    const dim = { id: 'dim', type: 'linearDimension', layerId: 'dimension', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 }, offset: 2, textSize: 0.35, arrowSize: 0.2, annotation };
    const hatch = { id: 'hatch', type: 'hatch', layerId: 'geometry', boundaries: [{ type: 'rectangle', x: 0, y: 0, width: 5, height: 5 }], pattern: { name: 'lines', spacing: 0.5, origin: { x: 1, y: 2 } }, annotation };
    const display = resolveDrawingAnnotationContent({ ...fixture(), entities: [dim, hatch] }, 50);
    assert.deepEqual(display.entities[0].p1, dim.p1); assert.deepEqual(display.entities[0].p2, dim.p2);
    assert.ok(display.entities[0].dimensionTextPosition);
    assert.deepEqual(display.entities[1].boundaries, hatch.boundaries);
    assert.deepEqual(display.entities[1].pattern.origin, { x: 3, y: 5 });
    const edited = { ...display, entities: display.entities.map(entity => ({ ...entity, color: '#ff0000' })) };
    const saved = restoreDrawingAnnotationContent(edited);
    assert.equal(saved.entities[0].dimensionTextPosition, undefined);
    assert.deepEqual(saved.entities[1].pattern.origin, hatch.pattern.origin);
});

test('leader scale and position representations keep arrow targets fixed and preserve live edits', async () => {
    const { createDrawingLeader, updateDrawingLeader, drawingLeaderGrips } = await import('./drawingLeaders.js');
    const { commitDrawingAnnotationRepresentation } = await import('./drawingAnnotations.js');
    const source = createDrawingLeader(createDefaultDrawingContent(), [[{ x: 0, y: 0 }, { x: 3, y: 2 }]], { x: 5, y: 2 }, { text: 'Note' }).content;
    source.entities[0].annotation = annotation;
    const original = source.entities[0];
    const display = resolveDrawingAnnotationContent(source, 50);
    const shown = display.entities[0];
    const tip = drawingLeaderGrips(shown).find(grip => grip.id === 'leader-0-0');
    close(tip.x, 0); close(tip.y, 0);
    close(shown.transform.e, 7); close(shown.transform.f, 5);
    const def = display.blocks.find(block => block.id === shown.blockId);
    close(def.entities.at(-1).fontSize, 0.175);
    const restored = restoreDrawingAnnotationContent(display);
    assert.deepEqual(restored.entities[0], original);
    assert.equal(restored.blocks.length, source.blocks.length);
    const updated = updateDrawingLeader(display, shown.id, { text: 'Changed', style: { textSize: 0.2 } }).content;
    const saved = restoreDrawingAnnotationContent(updated);
    assert.equal(saved.entities[0].blockId, original.blockId);
    close(saved.entities[0].leader.style.textSize, 0.4);
    assert.equal(saved.blocks.find(block => block.id === original.blockId).entities.at(-1).text, 'Changed');
    close(drawingLeaderGrips(saved.entities[0])[1].x, 0);
    const rebased = commitDrawingAnnotationRepresentation(source, [original.id], 50);
    close(drawingLeaderGrips(resolveDrawingAnnotationContent(rebased, 100).entities[0])[1].x, 0);
    const detached = commitDrawingAnnotationRepresentation(source, [original.id], 50, { detach: true });
    assert.equal(detached.entities[0].annotation, undefined);
    assert.ok(detached.blocks.some(block => block.id === detached.entities[0].blockId));
    close(drawingLeaderGrips(detached.entities[0])[1].x, 0);
});

test('copies and paste into an active context retain canonical sizes and active-scale base points', async () => {
    const { copySelectedEntities } = await import('./drawingDocument.js');
    const source = { ...fixture(), settings: { ...fixture().settings, annotationScale: 50 } };
    const display = resolveDrawingAnnotationContent(source);
    const copied = restoreDrawingAnnotationContent(copySelectedEntities(display, ['note'], { x: 3, y: 0 }).content);
    close(copied.entities[1].fontSize, 0.4); close(copied.entities[1].x, 13);
    const payload = createDrawingClipboardPayload(display, ['note']);
    close(payload.basePoint.x, 12);
    const pasted = restoreDrawingAnnotationContent(pasteDrawingClipboardPayload(display, payload, { point: { x: 20, y: 30 } }).content);
    close(pasted.entities[0].fontSize, 0.4); close(pasted.entities[1].fontSize, 0.4);
});

test('small-scale leader text edits round trip without altering style size or arrow attachments', async () => {
    const { createDrawingLeader, updateDrawingLeader, drawingLeaderGrips } = await import('./drawingLeaders.js');
    const source = createDrawingLeader(createDefaultDrawingContent(), [[{ x: 0, y: 0 }, { x: 3, y: 2 }]], { x: 5, y: 2 }, { text: 'Note' }).content;
    source.entities[0].annotation = { baseScale: 100, scales: [1, 100] };
    const display = resolveDrawingAnnotationContent(source, 1);
    close(display.entities[0].leader.style.textSize, 0.0035);
    const saved = restoreDrawingAnnotationContent(updateDrawingLeader(display, display.entities[0].id, { text: 'Tiny note' }).content);
    close(saved.entities[0].leader.style.textSize, 0.35);
    close(saved.blocks.find(block => block.id === saved.entities[0].blockId).entities.at(-1).fontSize, 0.35);
    close(drawingLeaderGrips(saved.entities[0])[1].x, 0);
    const normalized = normalizeDrawingContent(saved);
    close(normalized.entities[0].leader.style.textSize, 0.35);
});
