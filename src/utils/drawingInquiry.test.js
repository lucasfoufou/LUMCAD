import assert from 'node:assert/strict';
import test from 'node:test';
import { measureDrawingPoints, measureDrawingEntity } from './drawingInquiry.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-7 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test('distance, coordinate and angle inquiries are non-persistent and reject degenerate angles', () => {
    assert.deepEqual(measureDrawingPoints('id', [{ x: 2, y: -4 }]), { x: 2, y: -4 });
    close(measureDrawingPoints('distance', [{ x: 0, y: 0 }, { x: 3, y: 4 }]).distance, 5);
    close(measureDrawingPoints('angle', [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }]).angle, 90);
    assert.equal(measureDrawingPoints('angle', [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }]), null);
});

test('area, perimeter, centroid and planar moments integrate native circles and rectangles', () => {
    const circle = measureDrawingEntity({ type: 'circle', cx: 1000, cy: -2000, r: 3 });
    close(circle.area, 9 * Math.PI); close(circle.perimeter, 6 * Math.PI);
    close(circle.centroidX, 1000); close(circle.centroidY, -2000); close(circle.inertiaX, Math.PI * 81 / 4);
    const rectangle = measureDrawingEntity({ type: 'rectangle', x: 2, y: 4, width: 6, height: 2 });
    close(rectangle.area, 12); close(rectangle.perimeter, 16); close(rectangle.centroidX, 5); close(rectangle.centroidY, 5);
    close(rectangle.inertiaX, 4); close(rectangle.inertiaY, 36);
});

test('ellipses retain native area and regions subtract islands independently of winding', () => {
    const ellipse = measureDrawingEntity({ type: 'ellipse', cx: 0, cy: 0, rx: 5, ry: 2, rotation: 35, fullEllipse: true });
    close(ellipse.area, 10 * Math.PI);
    const region = measureDrawingEntity({ type: 'region', boundaries: [
        { type: 'circle', cx: 0, cy: 0, r: 5 }, { type: 'circle', cx: 0, cy: 0, r: 2 },
    ] });
    close(region.area, 21 * Math.PI); close(region.perimeter, 14 * Math.PI);
    close(region.inertiaX, Math.PI * (625 - 16) / 4);
});

test('open paths expose length only and intersecting boundaries fail atomically', () => {
    const path = measureDrawingEntity({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }] });
    assert.deepEqual(path, { perimeter: 7 });
    assert.equal(measureDrawingEntity({ type: 'region', boundaries: [
        { type: 'circle', cx: 0, cy: 0, r: 5 }, { type: 'circle', cx: 4, cy: 0, r: 2 },
    ] }), null);
});

test('cubic area is integrated on the exact curve, independent of boundary display sampling', () => {
    const entity = { type: 'polyline', closed: true, parts: [
        { type: 'spline', controlPoints: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }] },
        { type: 'line', x1: 1, y1: 0, x2: 0, y2: 0 },
    ] };
    close(measureDrawingEntity(entity).area, 0.6);
});
