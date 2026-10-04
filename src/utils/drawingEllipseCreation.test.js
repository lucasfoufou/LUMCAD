import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEllipseCreationEntity, buildEllipseCreationPreview, ellipseCreationPointCount } from './drawingEllipseCreation.js';
import { applyDrawingCreationMode, createDefaultDrawingCreationConfig } from './drawingCreation.js';
import { trimDrawingEntity } from './drawingTrimOperations.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { editEntityGrip, getEntityGrips } from './drawingSelection.js';
import { baseSnapCandidates } from './drawingSnapGeometry.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const axis = [{ x: -4, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 2 }];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('axis and centre construction preserve orientation and perpendicular radii', () => {
    const ellipse = buildEllipseCreationEntity(axis, 'geometry');
    assert.equal(ellipse.cx, 0);
    assert.equal(ellipse.rx, 4);
    assert.equal(ellipse.ry, 2);
    assert.equal(ellipse.fullEllipse, true);
    const centered = buildEllipseCreationEntity([{ x: 1, y: 2 }, { x: 1, y: 6 }, { x: 4, y: 3 }], 'geometry', 'center');
    near(centered.rx, 4);
    near(centered.ry, 3);
    near(centered.rotation, 90);
    assert.equal(buildEllipseCreationEntity([axis[0], axis[0], axis[2]], 'geometry'), null);
    assert.equal(buildEllipseCreationEntity([axis[0], axis[1], { x: 1, y: 0 }], 'geometry'), null);
    assert.equal(buildEllipseCreationEntity([axis[0], axis[1], { x: Infinity, y: 0 }], 'geometry'), null);
});

test('elliptical arcs project start/end directions on the ellipse and retain sweep direction', () => {
    const points = [...axis, { x: 4, y: 0 }, { x: 0, y: 10 }];
    const arc = buildEllipseCreationEntity(points, 'geometry', 'axisArc');
    assert.equal(arc.fullEllipse, false);
    near(curvePointAt(arc, 0).x, 4);
    near(curvePointAt(arc, 1).y, 2);
    const clockwise = buildEllipseCreationEntity(points, 'geometry', 'axisArc', { counterClockwise: false });
    assert.equal(clockwise.counterClockwise, false);
    assert.ok(curvePointAt(clockwise, 0.5).y < 0);
    assert.equal(buildEllipseCreationEntity([...axis, { x: 0, y: 0 }, points[4]], 'geometry', 'axisArc'), null);
    assert.equal(buildEllipseCreationEntity([...axis, points[3], points[3]], 'geometry', 'axisArc'), null);
});

test('incomplete construction previews cannot commit prematurely', () => {
    assert.equal(ellipseCreationPointCount('centerArc'), 5);
    assert.equal(buildEllipseCreationEntity(axis, 'geometry', 'centerArc'), null);
    assert.equal(buildEllipseCreationPreview(axis.slice(0, 2), 'geometry').type, 'line');
    assert.equal(buildEllipseCreationPreview(axis, 'geometry', 'axisArc').fullEllipse, true);
    let config = createDefaultDrawingCreationConfig('ellipse');
    config = applyDrawingCreationMode('ellipse', config, 'ELLIPSE CENTERARC');
    assert.equal(config.mode, 'centerArc');
    config = applyDrawingCreationMode('ellipse', config, 'CW');
    assert.equal(config.mode, 'centerArc');
    assert.equal(config.options.counterClockwise, false);
});

test('ellipses and elliptical arcs expose working axis grips without fake endpoints', () => {
    const ellipse = buildEllipseCreationEntity(axis, 'geometry');
    assert.deepEqual(getEntityGrips(ellipse).map(grip => grip.id), ['center', 'radius-x', 'radius-y']);
    const rotated = editEntityGrip(ellipse, 'radius-x', { x: 0, y: 6 });
    near(rotated.rx, 6);
    near(rotated.rotation, 90);
    assert.equal(editEntityGrip(ellipse, 'radius-x', { x: 0, y: 0 }), ellipse);
    const arc = buildEllipseCreationEntity([...axis, { x: 4, y: 0 }, { x: 0, y: 2 }], 'geometry', 'axisArc');
    assert.deepEqual(getEntityGrips(arc).map(grip => grip.id), ['center', 'radius-x', 'radius-y', 'start', 'end']);
    assert.equal(editEntityGrip(arc, 'end', { x: 4, y: 0 }), arc);
    const candidates = baseSnapCandidates(ellipse, { endpoint: true, midpoint: true, quadrant: true, center: true });
    assert.equal(candidates.filter(candidate => candidate.type === 'quadrant').length, 4);
    assert.equal(candidates.filter(candidate => candidate.type === 'endpoint' || candidate.type === 'midpoint').length, 0);
});

test('created ellipses and arcs survive archive reload as native curves', () => {
    const document = createLcadDocument({ name: 'Ellipses' });
    document.content.entities = [buildEllipseCreationEntity(axis, 'geometry', 'axis', {}, 'ellipse'), buildEllipseCreationEntity([...axis, { x: 4, y: 0 }, { x: 0, y: 2 }], 'geometry', 'axisArc', {}, 'arc')];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities, document.content.entities);
});

test('newly created full ellipses trim to exact native elliptical arcs', () => {
    const ellipse = buildEllipseCreationEntity(axis, 'geometry', 'axis', {}, 'ellipse');
    const boundary = { type: 'line', x1: 0, y1: -4, x2: 0, y2: 4 };
    const result = trimDrawingEntity(ellipse, { x: 4, y: 0 }, [boundary]);
    assert.equal(result.status, 'trimmed');
    assert.equal(result.fragments.length, 1);
    const arc = result.fragments[0];
    assert.equal(arc.type, 'ellipse');
    assert.equal(arc.fullEllipse, false);
    assert.equal(arc.rx, 4);
    assert.equal(arc.ry, 2);
    assert.ok(curvePointAt(arc, 0.5).x < -3.9);
});
