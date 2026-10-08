import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingPlacementStations, MAX_POINT_PLACEMENTS } from './drawingPointPlacement.js';
import { curveLength, curveLengthAtParameter, closestPointOnCurve } from './drawingCurveKernel.js';

const line = { type: 'line', x1: 0, y1: 0, x2: 12, y2: 0 };
const near = (value, expected, tolerance = 1e-6) => assert.ok(Math.abs(value - expected) < tolerance, `${value} != ${expected}`);

test('divide preserves the source and places only interior points on open curves', () => {
    const original = structuredClone(line);
    assert.deepEqual(drawingPlacementStations(line, { count: 4 }).map(station => station.point),
        [{ x: 3, y: 0 }, { x: 6, y: 0 }, { x: 9, y: 0 }]);
    assert.deepEqual(line, original);
    const reversed = drawingPlacementStations(line, { mode: 'measure', spacing: 5, reverse: true });
    assert.deepEqual(reversed.map(station => station.point), [{ x: 7, y: 0 }, { x: 2, y: 0 }]);
    near(Math.abs(reversed[0].rotation), 180);
});

test('measure excludes exact terminal points and guards tiny floating point remainders', () => {
    assert.equal(drawingPlacementStations(line, { mode: 'measure', spacing: 3 }).length, 3);
    assert.deepEqual(drawingPlacementStations(line, { mode: 'measure', spacing: 20 }), []);
    assert.equal(drawingPlacementStations({ ...line, x2: 0.30000000000000004 }, { mode: 'measure', spacing: 0.1 }).length, 2);
});

test('closed circles have equal intervals and a single seam station', () => {
    const stations = drawingPlacementStations({ type: 'circle', cx: 0, cy: 0, r: 2 }, { count: 4 });
    assert.equal(stations.length, 4);
    for (let index = 0; index < 4; index += 1) {
        near(stations[index].point.x, 2 * Math.cos(index * Math.PI / 2));
        near(stations[index].point.y, 2 * Math.sin(index * Math.PI / 2));
    }
});

test('mixed paths use cumulative length and outgoing tangents at corners', () => {
    const path = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 9 }] };
    const stations = drawingPlacementStations(path, { count: 4 });
    assert.deepEqual(stations.map(station => station.point), [{ x: 3, y: 0 }, { x: 3, y: 3 }, { x: 3, y: 6 }]);
    stations.forEach(station => near(station.rotation, 90));
});

test('nonuniform cubic parameterization is inverted to physical arc length', () => {
    const spline = { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 12, y: 0 }] };
    drawingPlacementStations(spline, { count: 4 }).forEach((station, index) => near(station.point.x, 3 * (index + 1)));
    const ellipse = { type: 'ellipse', cx: 0, cy: 0, rx: 8, ry: 2, rotation: 0 };
    const total = curveLength(ellipse);
    drawingPlacementStations(ellipse, { count: 8 }).slice(1).forEach((station, index) => {
        const hit = closestPointOnCurve(ellipse, station.point);
        near(curveLengthAtParameter(ellipse, hit.t), total * (index + 1) / 8, 1e-4);
    });
});

test('invalid, unbounded, disconnected and excessive placement requests fail atomically', () => {
    for (const count of [0, 1, 2.5, Infinity, MAX_POINT_PLACEMENTS + 1]) assert.equal(drawingPlacementStations(line, { count }), null);
    for (const spacing of [0, -1, NaN, Infinity, 1e-20]) assert.equal(drawingPlacementStations(line, { mode: 'measure', spacing }), null);
    assert.equal(drawingPlacementStations({ ...line, type: 'xline' }, { count: 3 }), null);
    assert.equal(drawingPlacementStations({ type: 'polyline', parts: [line, { ...line, y1: 2, y2: 2 }] }, { count: 3 }), null);
});
