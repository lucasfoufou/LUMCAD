import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { drawingConstraintCoordinates, rebuildDrawingConstraintEntity, resolveDrawingConstraintReference } from './drawingConstraintEntities.js';
import { drawingGeometricConstraintResiduals, solveDrawingGeometricConstraints } from './drawingGeometricConstraints.js';

const ref = (entityId, point) => ({ entityId, ...(point ? { point } : {}) });
const relation = (id, type, refs, extra = {}) => ({ id, type, refs, ...extra });
const contentWith = entities => {
    const content = createDefaultDrawingContent();
    return { ...content, entities: entities.map(entity => ({ layerId: content.activeLayerId, ...entity })) };
};
const line = (id, x1, y1, x2, y2, extra = {}) => ({ id, type: 'line', x1, y1, x2, y2, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
function solved(content, constraints, options) {
    const result = solveDrawingGeometricConstraints(content, constraints, options);
    assert.ok(!result.error, JSON.stringify(result));
    const entities = new Map(result.content.entities.map(entity => [entity.id, entity]));
    for (const constraint of constraints) assert.ok(drawingGeometricConstraintResiduals(constraint, entities).every(value => Math.abs(value) < 1e-6));
    return result.content;
}

test('native line constraints preserve identity/appearance and propagate from pinned objects', () => {
    const content = contentWith([line('base', 0, 0, 4, 0), line('next', 4.2, 0.5, 4.5, 3, { color: '#123456' }),
        { id: 'other', type: 'point', x: 20, y: 30 }]);
    const saved = structuredClone(content);
    const constraints = [relation('join', 'coincident', [ref('base', 'end'), ref('next', 'start')]),
        relation('right-angle', 'perpendicular', [ref('base'), ref('next')])];
    const result = solved(content, constraints, { fixedIds: ['base'] });
    near(result.entities[1].x1, 4); near(result.entities[1].y1, 0); near(result.entities[1].x2, 4);
    assert.deepEqual(result.entities[0], content.entities[0]);
    assert.equal(result.entities[1].color, '#123456'); assert.equal(result.entities[1].id, 'next');
    assert.equal(result.entities[2], content.entities[2]); assert.deepEqual(content, saved);
});

test('line relations cover horizontal, vertical, equal, parallel and collinear', () => {
    const base = line('base', 0, 0, 4, 0);
    for (const type of ['horizontal', 'vertical']) {
        const result = solved(contentWith([line('moving', 1, 2, 4, 5)]), [relation(type, type, [ref('moving')])]);
        assert.equal(result.entities.length, 1);
    }
    for (const type of ['parallel', 'collinear', 'equal']) solved(contentWith([base, line('moving', 1, 2, 4, 5)]),
        [relation(type, type, [ref('base'), ref('moving')])], { fixedIds: ['base'] });
});

test('concentric, equal and tangent circles solve without moving a locked source', () => {
    const base = { id: 'base', type: 'circle', cx: 0, cy: 0, r: 2, locked: true };
    const moving = { id: 'moving', type: 'circle', cx: 4.2, cy: 0.4, r: 1.5 };
    const concentric = solved(contentWith([base, moving]), [relation('center', 'concentric', [ref('base'), ref('moving')]),
        relation('radius', 'equal', [ref('base'), ref('moving')])]);
    near(concentric.entities[1].cx, 0); near(concentric.entities[1].cy, 0); near(concentric.entities[1].r, 2);
    for (const internal of [false, true]) solved(contentWith([base, moving]), [relation('touch', 'tangent', [ref('base'), ref('moving')], { internal })]);
    solved(contentWith([base, line('moving', -3, 3, 3, 2.5)]), [relation('touch', 'tangent', [ref('base'), ref('moving')])]);
});

test('symmetry uses a shared axis while point and whole-object fixes retain their stored values', () => {
    const content = contentWith([line('axis', 0, -5, 0, 5, { locked: true }),
        { id: 'a', type: 'point', x: -3, y: 2 }, { id: 'b', type: 'point', x: 2, y: 1 }]);
    const constraints = [relation('symmetric', 'symmetric', [ref('a', 'node'), ref('b', 'node'), ref('axis')]),
        relation('fixed', 'fix', [ref('a', 'node')], { values: [-3, 2] })];
    const result = solved(content, constraints);
    near(result.entities[2].x, 3); near(result.entities[2].y, 2);
    const fixed = solved(contentWith([line('edge', 0.2, 0.1, 4, 1)]), [relation('fix', 'fix', [ref('edge')], { values: [0, 0, 4, 0] })]);
    near(fixed.entities[0].x1, 0); near(fixed.entities[0].y2, 0);
});

test('G2 native spline relation enforces endpoint, tangent and curvature together', () => {
    const content = contentWith([line('base', -2, 0, 0, 0, { locked: true }),
        { id: 'spline', type: 'spline', controlPoints: [{ x: 0.1, y: 0.2 }, { x: 1, y: 0.4 }, { x: 2, y: 0.8 }, { x: 3, y: 2 }] }]);
    solved(content, [relation('smooth', 'smooth', [ref('base', 'end'), ref('spline', 'start')])]);
});

test('rectangle path references and polyline vertices use stable native selectors', () => {
    const rectangle = { id: 'rectangle', type: 'rectangle', x: 0, y: 0, width: 4, height: 3, rotation: 0 };
    const content = contentWith([rectangle, { id: 'path', type: 'polyline', points: [{ x: 0.2, y: 0.2 }, { x: 2, y: 1 }], closed: false }]);
    const constraints = [relation('join', 'coincident', [{ entityId: 'rectangle', part: 0, point: 'start' }, ref('path', 'vertex-0')])];
    const result = solved(content, constraints, { fixedIds: ['rectangle'] });
    near(result.entities[1].points[0].x, 0); near(result.entities[1].points[0].y, 0);
    assert.equal(resolveDrawingConstraintReference(new Map([['rectangle', rectangle]]), { entityId: 'rectangle', part: 99 }), null);
});

test('invalid references, incompatible types and impossible locked relations return no partial content', () => {
    const content = contentWith([line('a', 0, 0, 2, 0, { locked: true }), line('b', 0, 1, 2, 1, { locked: true })]);
    const impossible = solveDrawingGeometricConstraints(content, [relation('join', 'coincident', [ref('a', 'start'), ref('b', 'start')])]);
    assert.equal(impossible.error, 'conflict'); assert.equal(impossible.content, undefined);
    for (const constraint of [relation('bad', 'equal', [ref('a'), ref('missing')]), relation('bad', 'smooth', [ref('a'), ref('b')])]) {
        assert.equal(solveDrawingGeometricConstraints(content, [constraint]).error, 'definition');
    }
    const unsupported = { id: 'array', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], array: { kind: 'rectangular' } };
    assert.equal(drawingConstraintCoordinates(unsupported), null);
    assert.equal(rebuildDrawingConstraintEntity({ type: 'circle', cx: 0, cy: 0, r: 1 }, [0, 0, -1]), null);
    assert.equal(rebuildDrawingConstraintEntity(line('a', 0, 0, 1, 1), [0, 0, 0, 0]), null);
});

test('disconnected components avoid a whole-drawing variable limit and retain atomic failure', () => {
    const entities = Array.from({ length: 40 }, (_, index) => line(`line-${index}`, index * 4, 0, index * 4 + 2, 0.2));
    const content = contentWith(entities);
    const constraints = entities.map(entity => relation(`horizontal-${entity.id}`, 'horizontal', [ref(entity.id)]));
    solved(content, constraints);
    const saved = structuredClone(content);
    const impossible = { ...content, entities: content.entities.map((entity, index) => index === 39 ? { ...entity, locked: true } : entity) };
    const result = solveDrawingGeometricConstraints(impossible, constraints);
    assert.equal(result.error, 'conflict'); assert.equal(result.content, undefined);
    assert.deepEqual(result.constraintIds, ['horizontal-line-39']);
    assert.deepEqual(content, saved);
});
