import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingViewport, createDrawingLayout, viewportModelPointToPaperPoint, translateDrawingPaperAnnotation } from './drawingLayouts.js';
import { transformAffinePoint } from './drawingAffine.js';
import { drawingViewportSpaceMatrix, alignDrawingViewportPoints, transferDrawingSpace } from './drawingSpaceTransfer.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';

test('viewport space matrices invert rotated model/paper coordinates with physical metre/mm scale', () => {
    const viewport = createDrawingViewport({ rect: { x: 30, y: 40, width: 120, height: 80 }, modelViewBox: { x: -5, y: 2, width: 12, height: 8 }, viewRotation: 37 });
    const point = { x: 4, y: -3 };
    const paper = transformAffinePoint(point, drawingViewportSpaceMatrix(viewport));
    const expected = viewportModelPointToPaperPoint(viewport, point);
    assert.ok(Math.hypot(paper.x - expected.x, paper.y - expected.y) < 1e-9);
    const roundTrip = transformAffinePoint(paper, drawingViewportSpaceMatrix(viewport, false));
    assert.ok(Math.hypot(point.x - roundTrip.x, point.y - roundTrip.y) < 1e-9);
});

test('paired-point viewport alignment solves scale rotation and translation without changing its paper frame or overrides', () => {
    const viewport = createDrawingViewport({ rect: { x: 20, y: 30, width: 100, height: 80 }, viewRotation: 15, hiddenLayerIds: ['hidden'] });
    const model = [{ x: 8, y: -3 }, { x: 12, y: 1 }];
    const paper = [{ x: 40, y: 50 }, { x: 40, y: 90 }];
    const aligned = alignDrawingViewportPoints(viewport, model, paper);
    for (let index = 0; index < 2; index++) {
        const point = viewportModelPointToPaperPoint(aligned, model[index]);
        assert.ok(Math.hypot(point.x - paper[index].x, point.y - paper[index].y) < 1e-9);
    }
    for (const key of ['id', 'x', 'y', 'width', 'height', 'hiddenLayerIds']) assert.deepEqual(aligned[key], viewport[key]);
    assert.equal(alignDrawingViewportPoints({ ...viewport, locked: true }, model, paper), null);
    assert.equal(alignDrawingViewportPoints(viewport, [model[0], model[0]], paper), null);
    assert.equal(alignDrawingViewportPoints(viewport, model, [paper[0], paper[0]]), null);
});

test('space transfer preserves native curves through a rotated viewport and archive round trip', () => {
    const document = createLcadDocument();
    const circle = { id: 'circle', type: 'circle', layerId: 'geometry', cx: 2, cy: 3, r: 1 };
    const line = { id: 'line', type: 'line', layerId: 'geometry', x1: -100, y1: 0, x2: 2, y2: 3 };
    document.content.entities = [circle, line];
    const viewport = createDrawingViewport({ rect: { x: 30, y: 40, width: 100, height: 100 }, modelViewBox: { x: 0, y: 0, width: 10, height: 10 }, viewRotation: 37 });
    const layout = createDrawingLayout({ viewports: [viewport] });
    document.layouts = [layout];
    const before = JSON.stringify(document);
    const paper = transferDrawingSpace(document, layout.id, viewport.id, ['circle', 'line']);
    assert.equal(paper.error, undefined);
    assert.equal(JSON.stringify(document), before);
    assert.equal(paper.content.entities.length, 0);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope({ ...document, ...paper }))).document;
    const snaps = drawingSnapEntities({ ...restored.content, entities: restored.layouts[0].paperEntities });
    assert.equal(snaps.length, 2);
    assert.equal(snaps[0].type, 'circle');
    assert.ok(Math.abs(snaps[0].r - 10) < 1e-9);
    const model = transferDrawingSpace(restored, layout.id, viewport.id, [paper.paperSelectionId], false);
    assert.equal(model.layouts[0].paperEntities.length, 0);
    assert.equal(model.content.blocks.length, document.content.blocks.length);
    assert.deepEqual(model.selectedIds, ['circle', 'line']);
    for (const entity of model.content.entities) for (const [key, value] of Object.entries(document.content.entities.find(item => item.id === entity.id))) {
        if (typeof value === 'number') assert.ok(Math.abs(entity[key] - value) < 1e-9, key);
        else assert.deepEqual(entity[key], value);
    }
    const moved = translateDrawingPaperAnnotation(restored.layouts[0], paper.paperSelectionId, 5, -7);
    assert.equal(moved.paperEntities[0].transform.e, restored.layouts[0].paperEntities[0].transform.e + 5);
    assert.equal(moved.paperEntities[0].transform.f, restored.layouts[0].paperEntities[0].transform.f - 7);
});

test('space transfer keeps dimension dependencies together and remaps return collisions without breaking links', () => {
    const document = createLcadDocument();
    document.content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 5, y2: 0 },
        { id: 'dim', type: 'dimension', layerId: 'dimensions', sourceId: 'line', offset: 1 },
    ];
    const viewport = createDrawingViewport({ rect: { x: 0, y: 0, width: 100, height: 100 }, modelViewBox: { x: 0, y: 0, width: 10, height: 10 } });
    const layout = createDrawingLayout({ viewports: [viewport] });
    document.layouts = [layout];
    assert.equal(transferDrawingSpace(document, layout.id, viewport.id, ['line']).error, 'dependent');
    const paper = transferDrawingSpace(document, layout.id, viewport.id, ['dim']);
    assert.equal(paper.content.entities.length, 0);
    const otherLine = { ...document.content.entities[0], x2: 20 };
    paper.content = { ...paper.content, entities: [otherLine] };
    const model = transferDrawingSpace({ ...document, ...paper }, layout.id, viewport.id, [paper.paperSelectionId], false);
    assert.equal(model.content.entities[0], otherLine);
    const returned = model.content.entities.filter(entity => model.selectedIds.includes(entity.id));
    const line = returned.find(entity => entity.type === 'line');
    const dimension = returned.find(entity => entity.type === 'dimension');
    assert.notEqual(line.id, 'line');
    assert.equal(dimension.sourceId, line.id);
    assert.equal(line.x2, 5);
});

test('space transfer refuses locked selections and snapshots annotation size at the viewport scale', () => {
    const document = createLcadDocument();
    document.content.entities = [{ id: 'text', type: 'text', layerId: 'geometry', x: 1, y: 1, width: 3, height: 1, text: 'Note', fontSize: 0.3,
        annotation: { baseScale: 100, scales: [{ scale: 50, offset: { x: 0, y: 0 } }] } }];
    const viewport = createDrawingViewport({ rect: { x: 0, y: 0, width: 100, height: 100 }, modelViewBox: { x: 0, y: 0, width: 5, height: 5 } });
    const layout = createDrawingLayout({ viewports: [viewport] });
    document.layouts = [layout];
    const paper = transferDrawingSpace(document, layout.id, viewport.id, ['text']);
    const block = paper.content.blocks.find(item => item.id === paper.layouts[0].paperEntities[0].blockId);
    assert.equal(block.entities[0].fontSize, 0.15);
    assert.equal(block.entities[0].annotation, undefined);
    document.content.layers[0].locked = true;
    assert.equal(transferDrawingSpace(document, layout.id, viewport.id, ['text']).error, 'selection');
    assert.equal(transferDrawingSpace(document, layout.id, 'missing', ['text']).error, 'viewport');
});
