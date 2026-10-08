import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { DRAWING_POINT_STYLES, drawingPointPath, normalizeDrawingPointStyle } from './drawingPoints.js';
import { translateEntity, rotateEntity, mirrorEntity, scaleEntity } from './drawingPrimitives.js';
import { getEntityGrips, editEntityGrip, entityMatchesSelectionWindow } from './drawingSelection.js';
import { baseSnapCandidates } from './drawingSnapGeometry.js';
import { getDrawingBounds, snapDrawingPoint } from './drawingGeometry.js';
import { materializeDrawingBlockReference, transformDrawingEntityAffine } from './drawingBlocks.js';
import { defineNamedDrawingBlock, insertNamedDrawingBlock } from './drawingNamedBlocks.js';
import { clipDrawingSnapEntity } from './drawingBlockClip.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { parseDrawingPlacementInput, placeDrawingPoints, setDrawingPointStyle } from './drawingPointCommands.js';

const point = (x = 2, y = 3) => buildDrawingEntity('point', { x, y }, { x, y }, 'geometry', 'point-1');
const near = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-6, `${value} != ${expected}`);
const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 12 };
const content = () => ({ ...createDefaultDrawingContent(), entities: [line] });

test('native points reject unsafe coordinates and normalize bounded styles', () => {
    assert.equal(point(Infinity), null);
    assert.equal(point(1e13), null);
    assert.deepEqual(normalizeDrawingPointStyle({ symbol: '<script>', size: -1 }), { symbol: 'cross', size: 0.2 });
    for (const symbol of DRAWING_POINT_STYLES) {
        const entity = { ...point(), pointStyle: { symbol, size: 0.5 } };
        assert.ok(drawingPointPath(entity).startsWith('M '));
        assert.deepEqual(normalizeDrawingContent({ entities: [entity] }).entities[0], entity);
    }
});

test('points preserve native identity and marker size through every transform path', () => {
    const source = point();
    assert.deepEqual([translateEntity(source, 4, -1).x, translateEntity(source, 4, -1).y], [6, 2]);
    const rotated = rotateEntity(source, 90, { x: 0, y: 0 });
    near(rotated.x, -3); near(rotated.y, 2);
    const mirrored = mirrorEntity(source, { x: 0, y: 0 }, { x: 1, y: 0 });
    near(mirrored.x, 2); near(mirrored.y, -3);
    const scaled = scaleEntity(source, { scaleX: 2, scaleY: 3, origin: { x: 1, y: 1 } });
    near(scaled.x, 3); near(scaled.y, 7);
    const affine = transformDrawingEntityAffine(source, { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
    near(affine.x, 16); near(affine.y, 22);
    for (const entity of [rotated, mirrored, scaled, affine]) {
        assert.equal(entity.id, source.id); assert.equal(entity.type, 'point'); assert.deepEqual(entity.pointStyle, source.pointStyle);
    }
});

test('node snapping, clipping, selection windows and grips use the point location', () => {
    const source = point();
    assert.deepEqual(baseSnapCandidates(source, { node: true }), [{ x: 2, y: 3, type: 'node', entityId: source.id }]);
    assert.deepEqual(baseSnapCandidates(source, { center: true }), []);
    assert.deepEqual(getEntityGrips(source), [{ id: 'node', x: 2, y: 3 }]);
    const moved = editEntityGrip(source, 'node', { x: 4, y: 5 });
    assert.equal(moved.x, 4); assert.equal(moved.y, 5);
    assert.equal(editEntityGrip(source, 'node', { x: Infinity, y: 0 }), source);
    const bounds = { minX: 1.99, minY: 2.99, maxX: 2.01, maxY: 3.01 };
    for (const mode of ['window', 'crossing']) assert.ok(entityMatchesSelectionWindow(source, { ...bounds, mode }));
    const clip = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    assert.deepEqual(clipDrawingSnapEntity(source, clip), [source]);
    assert.deepEqual(clipDrawingSnapEntity(point(5, 5), clip), []);
    const drawing = { ...content(), entities: [source] };
    drawing.settings.snaps = { node: true };
    const snap = snapDrawingPoint({ x: 2.01, y: 3.01 }, drawing, 0.1);
    near(snap.x, 2); near(snap.y, 3);
    assert.ok(getDrawingBounds(drawing).minX < 2);
});

test('point symbols and defaults survive archives and lossless SVG clipboard transfer', () => {
    const document = createLcadDocument();
    document.content.entities = DRAWING_POINT_STYLES.map((symbol, index) => ({ ...point(index, 3), id: `point-${index}`, pointStyle: { symbol, size: 0.4 } }));
    document.content.settings.pointStyle = { symbol: 'dot', size: 0.7 };
    document.content.entities[0] = transformDrawingEntityAffine(document.content.entities[0], { a: 2, b: 0.5, c: 1, d: 3, e: 0, f: 0 });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.entities, document.content.entities);
    assert.deepEqual(loaded.content.settings.pointStyle, document.content.settings.pointStyle);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, document.content.entities.map(entity => entity.id)));
    assert.equal((svg.match(/<path /g) || []).length, DRAWING_POINT_STYLES.length);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    assert.deepEqual(pasted.content.entities.map(({ id, ...rest }) => rest), document.content.entities.map(({ id, ...rest }) => rest));
});

test('points inside reusable blocks retain position, bounds and native type on materialization', () => {
    const source = { ...content(), entities: [point()] };
    const block = defineNamedDrawingBlock(source, ['point-1'], { name: 'Survey', basePoint: { x: 2, y: 3 } });
    assert.ok(block.definition.bounds);
    const inserted = insertNamedDrawingBlock(block.content, 'Survey', { x: 8, y: 9 }, { scale: 2, angle: 90 });
    const materialized = materializeDrawingBlockReference(inserted.reference, inserted.content.blocks);
    assert.equal(materialized[0].type, 'point'); near(materialized[0].x, 8); near(materialized[0].y, 9);
});

test('division is an atomic addition with immutable source, stable IDs and style snapshots', () => {
    const source = content();
    const original = structuredClone(source);
    const result = placeDrawingPoints(source, 'line', parseDrawingPlacementInput('4', 'divide'));
    assert.equal(result.content.entities.length, 4);
    assert.equal(result.content.entities[0], source.entities[0]);
    assert.deepEqual(result.content.entities.slice(1).map(entity => entity.y), [3, 6, 9]);
    assert.equal(new Set(result.selectedIds).size, 3);
    assert.deepEqual(source, original);
    assert.equal(placeDrawingPoints(source, 'line', { mode: 'measure', spacing: 12 }).error, 'empty');
    source.layers[0].locked = true;
    assert.equal(placeDrawingPoints(source, 'line', { mode: 'divide', count: 4 }).error, 'layer');
});

test('placement reuses named block insertion, alignment and attributes without changing the source', () => {
    const drawing = content();
    drawing.blocks = [{ id: 'marker', name: 'Marker One', basePoint: { x: 0, y: 0 }, entities: [{ ...line, id: 'edge', x2: 2, y2: 0 }] }];
    const options = parseDrawingPlacementInput('4 BLOCK "Marker One" ALIGN ON SCALE 2 REVERSE', 'divide');
    const result = placeDrawingPoints(drawing, 'line', options);
    assert.equal(result.selectedIds.length, 3);
    assert.equal(result.content.entities[1].blockId, 'marker');
    near(result.content.entities[1].transform.f, 9);
    near(result.content.entities[1].transform.b, -2);
    const missing = placeDrawingPoints(drawing, 'line', { ...options, block: 'Missing' });
    assert.equal(missing.error, 'block'); assert.equal(drawing.entities.length, 1);
    for (const input of ['0', '2.5', '3 bad', '3 ALIGN ON', '3 BLOCK', '3 BLOCK Marker SCALE 0', '3 REVERSE REVERSE']) {
        assert.equal(parseDrawingPlacementInput(input, 'divide'), null, input);
    }
});

test('style commands change defaults and editable targets without changing locked points', () => {
    const drawing = content();
    drawing.entities = [point(), { ...point(4, 5), id: 'locked', locked: true }];
    const result = setDrawingPointStyle(drawing, [], 'circle-cross 0.5');
    assert.deepEqual(result.content.settings.pointStyle, { symbol: 'circle-cross', size: 0.5 });
    assert.deepEqual(result.content.entities[0].pointStyle, result.content.settings.pointStyle);
    assert.equal(result.content.entities[1], drawing.entities[1]);
    assert.deepEqual(drawing.entities[0].pointStyle, { symbol: 'cross', size: 0.2 });
    assert.equal(setDrawingPointStyle(drawing, [], 'dot Infinity').error, 'styleSyntax');
});
