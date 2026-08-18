import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCircleCreationEntity } from './drawingCreation.js';
import {
    DRAWING_CIRCLE_MAX_RENDER_SEGMENTS,
    getCircleViewportGeometry,
} from './drawingCurves.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { fitViewBox, snapDrawingPoint } from './drawingGeometry.js';
import { editEntityGrip, entityMatchesSelectionWindow } from './drawingSelection.js';

test('oversized circles render as a finite viewport-local path with a hard segment cap', () => {
    const circle = { id: 'large', type: 'circle', cx: 0, cy: 0, r: 1e9 };
    const viewBox = { x: 1e9 - 50, y: -50, width: 100, height: 100 };
    const geometry = getCircleViewportGeometry(circle, viewBox);

    assert.equal(geometry.kind, 'path');
    assert.ok(geometry.segmentCount > 0);
    assert.ok(geometry.segmentCount <= DRAWING_CIRCLE_MAX_RENDER_SEGMENTS);
    assert.ok(geometry.parts.length <= 4);
    geometry.parts.flat().forEach(point => {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(point.x >= viewBox.x - 4 && point.x <= viewBox.x + viewBox.width + 4);
        assert.ok(point.y >= viewBox.y - 4 && point.y <= viewBox.y + viewBox.height + 4);
    });
});

test('circle viewport geometry keeps ordinary circles native and culls invisible or unsafe outlines', () => {
    assert.equal(getCircleViewportGeometry({ type: 'circle', cx: 0, cy: 0, r: 5 }, null), null);
    assert.deepEqual(
        getCircleViewportGeometry(
            { type: 'circle', cx: 0, cy: 0, r: 5 },
            { x: -10, y: -10, width: 20, height: 20 },
        ),
        { kind: 'circle', cx: 0, cy: 0, r: 5 },
    );
    assert.equal(getCircleViewportGeometry(
        { type: 'circle', cx: 0, cy: 0, r: 1e9 },
        { x: -50, y: -50, width: 100, height: 100 },
    ), null);
    assert.equal(getCircleViewportGeometry(
        { type: 'circle', cx: 0, cy: 0, r: 1e9 },
        { x: 5e8, y: -50, width: 100, height: 100 },
    ), null);
    assert.equal(getCircleViewportGeometry(
        { type: 'circle', cx: 0, cy: 0, r: 1e308 },
        { x: -50, y: -50, width: 100, height: 100 },
    ), null);
});

test('circle creation and grip editing reject geometry outside the shared safety envelope', () => {
    const safety = { maxRadius: 1_000, maxCoordinate: 10_000 };
    assert.equal(buildCircleCreationEntity(
        [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        'geometry',
        'centerRadius',
        { radius: 1_001, circleSafety: safety },
    ), null);

    const circle = { id: 'circle', type: 'circle', cx: 0, cy: 0, r: 5 };
    assert.equal(editEntityGrip(circle, 'radius', { x: 1e13, y: 0 }), circle);
    assert.equal(editEntityGrip(circle, 'center', { x: 1e13, y: 0 }), circle);
});

test('unsafe circles cannot poison drawing bounds, snapping, or selection', () => {
    const content = createDefaultDrawingContent();
    content.settings.snaps = {
        grid: false,
        endpoint: false,
        midpoint: false,
        center: false,
        intersection: true,
        nearest: false,
    };
    const unsafe = { id: 'unsafe', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: 1e308 };
    content.entities = [
        unsafe,
        { id: 'horizontal', type: 'line', layerId: 'geometry', x1: -5, y1: 0, x2: 5, y2: 0 },
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 0, y1: -5, x2: 0, y2: 5 },
    ];

    const viewBox = fitViewBox(content);
    assert.ok(Object.values(viewBox).every(Number.isFinite));
    assert.ok(viewBox.width < 100 && viewBox.height < 100);
    assert.equal(snapDrawingPoint({ x: 0.02, y: 0.02 }, content, 0.1).type, 'intersection');
    assert.equal(entityMatchesSelectionWindow(unsafe, {
        minX: -1,
        minY: -1,
        maxX: 1,
        maxY: 1,
        mode: 'crossing',
    }), false);
});

test('intersection snapping does not compare every pair of far-away circles', () => {
    const content = createDefaultDrawingContent();
    content.settings.snaps = {
        grid: false,
        endpoint: false,
        midpoint: false,
        center: false,
        intersection: true,
        nearest: false,
    };
    let geometryReads = 0;
    content.entities = Array.from({ length: 400 }, (_, index) => {
        const cx = 1e6 + index * 10;
        return {
            id: `far-${index}`,
            type: 'circle',
            layerId: 'geometry',
            get cx() { geometryReads += 1; return cx; },
            get cy() { geometryReads += 1; return 1e6; },
            get r() { geometryReads += 1; return 2; },
        };
    });

    const result = snapDrawingPoint({ x: 0, y: 0 }, content, 0.1);
    assert.equal(result.type, null);
    assert.ok(geometryReads < 10_000, `expected aperture filtering, observed ${geometryReads} geometry reads`);
});
