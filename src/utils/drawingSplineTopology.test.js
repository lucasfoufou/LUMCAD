import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSplineCreationEntity } from './drawingSplineCreation.js';
import { applySplineEditInput } from './drawingSplineEditing.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const points = [{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: -2 }, { x: 9, y: 1 }, { x: 10, y: 6 }];
const near = (a, b, tolerance = 1e-8) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < tolerance);
const at = (entity, t) => {
    const parts = entity.type === 'spline' ? [entity] : entity.parts;
    const knots = [...new Set(entity.splineDefinition.knots)];
    const index = t === 1 ? parts.length - 1 : knots.findIndex(value => value > t) - 1;
    return curvePointAt(parts[index], (t - knots[index]) / (knots[index + 1] - knots[index]));
};

test('definition point insertion/removal retains identity, appearance and validates minimum counts', () => {
    for (const mode of ['fit', 'control']) {
        const source = { ...buildSplineCreationEntity(points, 'geometry', mode, 'curve'), color: '#aabbcc' };
        const added = applySplineEditInput(source, 'INSERT 3 4 3');
        assert.equal(added.splineDefinition.points.length, 6);
        assert.deepEqual(added.splineDefinition.points[2], { x: 4, y: 3 });
        assert.equal(added.id, source.id);
        assert.equal(added.color, source.color);
        const removed = applySplineEditInput(added, 'REMOVE 3');
        assert.deepEqual(removed.splineDefinition.points, points);
        assert.equal(applySplineEditInput(source, 'INSERT 99 1 2'), source);
        assert.equal(applySplineEditInput(source, 'REMOVE 0'), source);
        const short = buildSplineCreationEntity(points.slice(0, mode === 'fit' ? 2 : 4), 'geometry', mode);
        assert.equal(applySplineEditInput(short, 'REMOVE 1'), short);
    }
});

test('inserting new or repeated control knots preserves the entire parameterized curve', () => {
    const source = buildSplineCreationEntity(points, 'geometry', 'control');
    let refined = source;
    for (const knot of [0.2, 0.5, 0.5]) {
        refined = applySplineEditInput(refined, `INSERTKNOT ${knot}`);
        for (let sample = 0; sample <= 100; sample += 1) near(at(refined, sample / 100), at(source, sample / 100));
    }
    assert.equal(refined.splineDefinition.points.length, points.length + 3);
    assert.equal(applySplineEditInput(refined, 'INSERTKNOT 0.5'), refined);
    assert.equal(applySplineEditInput(refined, 'INSERTKNOT 0'), refined);
    assert.equal(applySplineEditInput(refined, 'INSERTKNOT 1'), refined);
});

test('exact control conversion preserves each native span; FIT refits endpoint positions', () => {
    const source = buildSplineCreationEntity(points, 'geometry');
    const converted = applySplineEditInput(source, 'CONTROL');
    assert.equal(converted.splineDefinition.mode, 'control');
    converted.parts.forEach((part, index) => part.controlPoints.forEach((point, control) => near(point, source.parts[index].controlPoints[control])));
    const refitted = applySplineEditInput(converted, 'FIT');
    assert.equal(refitted.splineDefinition.mode, 'fit');
    assert.deepEqual(refitted.splineDefinition.points, points);
    const polyline = { id: 'vertices', type: 'polyline', layerId: 'geometry', points, closed: false };
    const fromPolyline = applySplineEditInput(polyline, 'FIT');
    assert.equal(fromPolyline.id, polyline.id);
    assert.equal(fromPolyline.points, undefined);
    assert.deepEqual(fromPolyline.splineDefinition.points, points);
});

test('polyline conversion respects tolerance, keeps endpoints and fails atomically at work limits', () => {
    const source = buildSplineCreationEntity(points, 'geometry');
    const tolerance = 0.001;
    const converted = applySplineEditInput(source, `POLYLINE ${tolerance}`);
    assert.equal(converted.parts, undefined);
    assert.equal(converted.splineDefinition, undefined);
    assert.deepEqual(converted.points[0], points[0]);
    assert.deepEqual(converted.points.at(-1), points.at(-1));
    const distanceToSegment = (point, a, b) => {
        const dx = b.x - a.x; const dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
    };
    for (const part of source.parts) {
        for (let sample = 0; sample <= 100; sample += 1) {
            const point = curvePointAt(part, sample / 100);
            const distance = Math.min(...converted.points.slice(1).map((end, index) => distanceToSegment(point, converted.points[index], end)));
            assert.ok(distance <= tolerance, `${distance} > ${tolerance}`);
        }
    }
    assert.equal(applySplineEditInput(source, 'POLYLINE 0'), source);
    assert.equal(applySplineEditInput(source, 'POLYLINE 1e-8'), source);
    const document = createLcadDocument({ name: 'Converted' });
    document.content.entities = [converted];
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content.entities, [converted]);
});
