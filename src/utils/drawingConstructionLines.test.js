import test from 'node:test';
import assert from 'node:assert/strict';
import { clipConstructionLine, closestPointOnConstructionLine, constructionLineGeometry, constructionLineViewportSegment, intersectConstructionLine } from './drawingConstructionLines.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { getDrawingBounds, offsetEntityTowardPoint, snapDrawingPoint } from './drawingGeometry.js';
import { getEntitySegments, mirrorEntity, rotateEntity, transformEntity, translateEntity } from './drawingPrimitives.js';
import { editEntityGrip, entityMatchesSelectionWindow, getEntityGrips } from './drawingSelection.js';
import { baseSnapCandidates } from './drawingSnapGeometry.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { inverseAffineViewBox, rotationAffineMatrix, transformAffinePoint } from './drawingBlocks.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } from './drawingClipboard.js';

const line = (type = 'xline', values = {}) => ({ id: 'construction', type, layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0, ...values });
const bounds = { minX: -10, minY: -5, maxX: 10, maxY: 5 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('construction creation rejects coincident and non-finite direction points', () => {
    for (const type of ['xline', 'ray']) {
        assert.equal(buildDrawingEntity(type, { x: 1, y: 2 }, { x: 1, y: 2 }, 'geometry'), null);
        assert.equal(buildDrawingEntity(type, { x: 1, y: 2 }, { x: Infinity, y: 2 }, 'geometry'), null);
        const entity = buildDrawingEntity(type, { x: 1, y: 2 }, { x: 2, y: 3 }, 'geometry', 'stable');
        assert.equal(entity.type, type);
        assert.equal(entity.id, 'stable');
        assert.ok(constructionLineGeometry(entity));
        assert.deepEqual(getEntitySegments(entity), [], 'never expose finite direction handles as segments');
    }
});

test('viewport clipping covers both directions for xlines and only forward rays', () => {
    assert.deepEqual(clipConstructionLine(line(), bounds), { start: { x: -10, y: 0 }, end: { x: 10, y: 0 } });
    assert.deepEqual(clipConstructionLine(line('ray'), bounds), { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
    assert.equal(clipConstructionLine(line('ray', { x1: 20, x2: 21 }), bounds), null);
    assert.deepEqual(clipConstructionLine(line('ray', { x1: 20, x2: 19 }), bounds), { start: { x: 10, y: 0 }, end: { x: -10, y: 0 } });
    assert.deepEqual(clipConstructionLine(line('xline', { x2: 0, y2: 1 }), bounds), { start: { x: 0, y: -5 }, end: { x: 0, y: 5 } });
    assert.equal(clipConstructionLine(line('xline', { y1: 6, y2: 6 }), bounds), null);
    assert.equal(constructionLineViewportSegment(line(), null), null);
    const far = constructionLineViewportSegment(line(), { x: 1e9, y: -1, width: 100, height: 2 });
    assert.equal(far.start.x, 1e9);
    assert.equal(far.end.x, 1e9 + 100);
});

test('near-horizontal directions remain geometrically unbounded and malformed inputs stay finite', () => {
    const entity = line('xline', { y2: 1e-12 });
    const clipped = clipConstructionLine(entity, { minX: 1e12, maxX: 1e12 + 100, minY: 0.5, maxY: 1.5 });
    assert.ok(clipped);
    near(clipped.start.y, 1);
    assert.equal(clipConstructionLine(line('ray', { x2: 0 }), bounds), null);
    assert.equal(clipConstructionLine(line(), { ...bounds, maxX: Infinity }), null);
});

test('nearest projections and snaps never invent a midpoint or direction-point endpoint', () => {
    assert.deepEqual(closestPointOnConstructionLine(line(), { x: -100, y: 3 }).point, { x: -100, y: 0 });
    assert.deepEqual(closestPointOnConstructionLine(line('ray'), { x: -100, y: 3 }).point, { x: 0, y: 0 });
    assert.deepEqual(baseSnapCandidates(line(), { endpoint: true, midpoint: true }), []);
    const candidates = baseSnapCandidates(line('ray'), { endpoint: true, midpoint: true });
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].x, 0);
    assert.equal(candidates[0].type, 'endpoint');
});

test('crossing selection uses the infinite geometry while containment cannot contain it', () => {
    const entity = line('xline', { x1: 100, x2: 101 });
    assert.equal(entityMatchesSelectionWindow(entity, { ...bounds, mode: 'crossing' }), true);
    assert.equal(entityMatchesSelectionWindow(entity, { ...bounds, mode: 'window' }), false);
    assert.equal(entityMatchesSelectionWindow({ ...entity, type: 'ray' }, { ...bounds, mode: 'crossing' }), false);
});

test('intersections with unbounded entities respect ray orientation', () => {
    const vertical = line('xline', { x1: -100, x2: -100, y2: 1 });
    assert.deepEqual(intersectConstructionLine(line(), vertical), [{ x: -100, y: 0 }]);
    assert.deepEqual(intersectConstructionLine(line('ray'), vertical), []);
    assert.deepEqual(intersectConstructionLine(line(), line()), []);
});

test('intersections use the bounded native curve kernel for lines, circles, ellipses and splines', () => {
    const horizontal = line();
    const vertical = { type: 'line', x1: 1000, y1: -1, x2: 1000, y2: 1 };
    near(intersectConstructionLine(horizontal, vertical)[0].x, 1000);
    assert.equal(intersectConstructionLine(horizontal, { ...vertical, y1: 1, y2: 2 }).length, 0);
    const circle = { type: 'circle', cx: 10, cy: 0, r: 2 };
    assert.deepEqual(intersectConstructionLine(horizontal, circle).map(point => Math.round(point.x)).sort((a, b) => a - b), [8, 12]);
    const ellipse = { type: 'ellipse', cx: 10, cy: 0, rx: 3, ry: 1, rotation: 0, fullEllipse: true };
    assert.deepEqual(intersectConstructionLine(horizontal, ellipse).map(point => Math.round(point.x)).sort((a, b) => a - b), [7, 13]);
    const spline = { type: 'spline', degree: 3, controlPoints: [{ x: 100, y: -3 }, { x: 101, y: -1 }, { x: 102, y: 1 }, { x: 103, y: 3 }] };
    near(intersectConstructionLine(horizontal, spline)[0].x, 101.5);
    const content = createDefaultDrawingContent();
    content.entities = [horizontal, { ...vertical, id: 'vertical', layerId: 'geometry' }];
    content.settings.snaps = { intersection: true };
    assert.equal(snapDrawingPoint({ x: 1000.01, y: 0.01 }, content, 0.1).type, 'intersection');
});

test('grips, transforms and offset preserve the entity type and its forward direction', () => {
    const ray = line('ray');
    assert.equal(getEntityGrips(ray).length, 2);
    assert.deepEqual(editEntityGrip(ray, 'start', { x: 5, y: 6 }), translateEntity(ray, 5, 6));
    assert.equal(editEntityGrip(ray, 'end', { x: 0, y: 0 }), ray);
    const rotated = rotateEntity(ray, 90, { x: 0, y: 0 });
    near(rotated.x2, 0);
    near(rotated.y2, 1);
    const mirrored = mirrorEntity(ray, { x: 0, y: -1 }, { x: 0, y: 1 });
    near(mirrored.x2, -1);
    assert.equal(mirrored.type, 'ray');
    assert.equal(transformEntity(ray, { scaleX: 2, scaleY: 3 }).x2, 2);
    const offset = offsetEntityTowardPoint(ray, 3, { x: 100, y: -5 });
    assert.equal(offset.type, 'ray');
    assert.equal(offset.y1, -3);
    assert.equal(offset.y2, -3);
});

test('archives retain persistent definitions and finite navigation bounds', () => {
    const document = createLcadDocument({ name: 'Construction geometry' });
    document.content.entities = [line(), line('ray', { id: 'ray', x1: 2, y1: 3, x2: 4, y2: 5 })];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities, document.content.entities);
    assert.deepEqual(getDrawingBounds(restored.content), { minX: 0, minY: 0, maxX: 4, maxY: 5 });
});

test('rotated layout and block view bounds cover all visible corners in local coordinates', () => {
    const viewBox = { x: -10, y: -5, width: 20, height: 10 };
    const rotation = rotationAffineMatrix(45);
    const local = inverseAffineViewBox(viewBox, rotation);
    assert.ok(local.width > viewBox.width);
    assert.ok(local.height > viewBox.height);
    const segment = constructionLineViewportSegment(line(), local);
    const start = transformAffinePoint(segment.start, rotation);
    const end = transformAffinePoint(segment.end, rotation);
    assert.ok(start.y < viewBox.y);
    assert.ok(end.y > viewBox.y + viewBox.height);
    assert.equal(inverseAffineViewBox(viewBox, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }), null);
});

test('clipboard SVG displays clipped geometry and embeds lossless unbounded definitions', () => {
    const source = createDefaultDrawingContent();
    source.entities = [line(), line('ray', { id: 'ray', x1: 2, y1: 3, x2: 4, y2: 5 })];
    const payload = createDrawingClipboardPayload(source, ['construction', 'ray']);
    const svg = drawingClipboardPayloadToSvg(payload);
    assert.equal((svg.match(/<line /g) || []).length, 2);
    const parsed = parseDrawingClipboardText(svg);
    assert.deepEqual(parsed.entities, source.entities);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, parsed, {
        mode: 'original',
    });
    assert.deepEqual(pasted.content.entities.map(entity => entity.type), ['xline', 'ray']);
    assert.equal(pasted.content.entities[1].x2, 4);
});
