import assert from 'node:assert/strict';
import test from 'node:test';

import { filletDrawingEntities, filletDrawingPath } from './drawingCornerOperations.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { entityIdFromDrawingEvent } from './drawingInteraction.js';
import { resolveDrawingSnap } from './drawingTracking.js';
import {
    createExtendPreviewEntities,
    createTrimPreviewEntities,
    extendDrawingEntity,
    extendDrawingTarget,
    extendDrawingTargets,
    getDrawingTrimFenceHits,
    previewTrimDrawingFence,
    trimDrawingEntity,
    trimDrawingFence,
    trimDrawingTarget,
    trimDrawingTargets,
} from './drawingTrimOperations.js';

const EPSILON = 1e-8;

function line(id, x1, y1, x2, y2, layerId = 'geometry') {
    return { id, type: 'line', layerId, x1, y1, x2, y2 };
}

function contentWith(entities, blocks = []) {
    const content = createDefaultDrawingContent();
    return { ...content, entities, blocks };
}

function near(actual, expected, tolerance = EPSILON) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);
}

function geometry(entity) {
    const { id: _id, layerId: _layerId, ...rest } = entity;
    return rest;
}

function radialLine(id, center, angle, radius = 5) {
    const cx = Number(center.cx ?? center.x);
    const cy = Number(center.cy ?? center.y);
    return line(
        id,
        cx,
        cy,
        cx + Math.cos(angle) * radius,
        cy + Math.sin(angle) * radius,
    );
}

function pointOnCircle(circle, angle) {
    return {
        x: circle.cx + Math.cos(angle) * circle.r,
        y: circle.cy + Math.sin(angle) * circle.r,
    };
}

function filletedCornerContent() {
    const content = contentWith([
        line('horizontal', -10, 0, 10, 0),
        line('vertical', 0, -10, 0, 10),
    ]);
    const result = filletDrawingEntities(
        content,
        'horizontal', { x: 5, y: 0 },
        'vertical', { x: 0, y: 5 },
        2,
    );
    assert.equal(result.changed, true);
    assert.equal(result.connector.type, 'arc');
    assert.equal(result.connector.layerId, 'geometry');
    return result;
}

test('pure trim retains exact line fragments between separate cutter entities', () => {
    const target = line('target', 0, 0, 10, 0);
    const result = trimDrawingEntity(target, { x: 5, y: 0 }, [
        line('left', 3, -2, 3, 2),
        line('right', 7, -2, 7, 2),
    ]);
    assert.equal(result.status, 'trimmed');
    assert.deepEqual(result.fragments.map(geometry), [
        { type: 'line', x1: 0, y1: 0, x2: 3, y2: 0 },
        { type: 'line', x1: 7, y1: 0, x2: 10, y2: 0 },
    ]);
    assert.deepEqual(result.removedSegments, [[{ x: 3, y: 0 }, { x: 7, y: 0 }]]);
});

test('target ids and boundary ids stay independent and dependent dimensions are cleaned', () => {
    const target = line('target', 0, 0, 10, 0);
    const content = contentWith([
        target,
        line('selected-boundary', 3, -2, 3, 2),
        line('ignored-boundary', 7, -2, 7, 2),
        line('other-target', 0, 4, 10, 4),
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'target', offset: 0.5 },
    ]);
    const result = trimDrawingTargets(content, {
        targetIds: ['target'],
        boundaryIds: ['selected-boundary'],
        picks: [{ targetId: 'target', point: { x: 8, y: 0 } }],
    });
    assert.equal(result.changedCount, 1);
    assert.equal(result.replacements.length, 1);
    near(result.replacements[0].x2, 3);
    assert.equal(result.content.entities.some(entity => entity.id === 'other-target'), true);
    assert.equal(result.content.entities.some(entity => entity.id === 'ignored-boundary'), true);
    assert.equal(result.content.entities.some(entity => entity.sourceId === 'target'), false);
});

test('circle trim creates one exact complement arc across the zero-angle wrap', () => {
    const angle = Math.PI / 4;
    const cutters = [angle, -angle].map((direction, index) => line(
        `radial-${index}`,
        0,
        0,
        Math.cos(direction) * 10,
        Math.sin(direction) * 10,
    ));
    const result = trimDrawingEntity(
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: 5 },
        { x: 5, y: 0 },
        cutters,
    );
    assert.equal(result.fragments.length, 1);
    assert.equal(result.fragments[0].type, 'arc');
    near(result.fragments[0].startAngle, angle);
    near(result.fragments[0].endAngle, TAU - angle);
    assert.equal(result.fragments[0].counterClockwise, true);
    assert.equal(result.removedCurves[0].type, 'arc');
    near(result.removedCurves[0].startAngle, TAU - angle);
    near(result.removedCurves[0].endAngle, angle);
});

const TAU = Math.PI * 2;

test('clockwise circles preserve their direction when trimmed', () => {
    const result = trimDrawingEntity(
        { type: 'circle', cx: 0, cy: 0, r: 5, counterClockwise: false },
        { x: 5, y: 0 },
        [line('vertical', 0, -10, 0, 10)],
    );
    assert.equal(result.changed, true);
    assert.equal(result.fragments[0].type, 'arc');
    assert.equal(result.fragments[0].counterClockwise, false);
});

test('arc trim stays an arc and reports a curve-accurate removed interval', () => {
    const arc = {
        id: 'arc', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const result = trimDrawingEntity(arc, { x: 0, y: 5 }, [
        line('first', 4, -2, 4, 4),
        line('second', -4, -2, -4, 4),
    ]);
    assert.equal(result.fragments.every(entity => entity.type === 'arc'), true);
    assert.equal(result.removedCurves.length, 1);
    assert.equal(result.removedCurves[0].type, 'arc');
});

test('a FILLET-created clockwise arc trims from the raw portion pick while a snapped cut pick stays ambiguous', () => {
    const filleted = filletedCornerContent();
    const arc = filleted.connector;
    const firstAngle = 255 * Math.PI / 180;
    const secondAngle = 195 * Math.PI / 180;
    const cutters = [
        radialLine('first-cut', arc, firstAngle),
        radialLine('second-cut', arc, secondAngle),
    ];
    const content = { ...filleted.content, entities: [...filleted.content.entities, ...cutters] };
    const rawPortionPick = pointOnCircle(arc, 249 * Math.PI / 180);
    const boundaryIds = [...filleted.selectedIds, ...cutters.map(entity => entity.id)];

    const preview = createTrimPreviewEntities(content, {
        targetId: arc.id,
        point: rawPortionPick,
        boundaryIds,
    });
    assert.equal(preview.length, 1);
    assert.equal(preview[0].type, 'arc');
    assert.equal(preview[0].counterClockwise, false);

    const trimmed = trimDrawingTarget(content, arc.id, rawPortionPick, {
        boundaryIds,
    });
    assert.equal(trimmed.changed, true);
    assert.equal(trimmed.replacements.length, 2);
    assert.equal(trimmed.replacements.every(entity => (
        entity.type === 'arc'
        && entity.counterClockwise === false
        && entity.layerId === 'geometry'
    )), true);

    const snappedPick = resolveDrawingSnap(rawPortionPick, content, 0.3);
    assert.equal(snappedPick.type, 'intersection');
    const snappedToCut = trimDrawingTarget(content, arc.id, snappedPick, {
        boundaryIds,
    });
    assert.equal(snappedToCut.changed, false);
    assert.equal(snappedToCut.reason, 'no-intersection');
});

test('a FILLET-created arc is a valid explicit trim boundary at crossing and tangent contacts', () => {
    const filleted = filletedCornerContent();
    const arc = filleted.connector;
    const crossing = line('crossing-target', -2, 1, 4, 1);
    const crossingContent = {
        ...filleted.content,
        entities: [...filleted.content.entities, crossing],
    };
    const crossed = trimDrawingTarget(crossingContent, crossing.id, { x: -1, y: 1 }, {
        boundaryIds: [arc.id],
    });
    assert.equal(crossed.changed, true);
    assert.equal(crossed.replacements.length, 1);
    near(crossed.replacements[0].x1, 2 - Math.sqrt(3));
    assert.equal(crossed.content.entities.some(entity => entity.id === arc.id), true);

    const tangent = line('tangent-target', -2, 0, 4, 0);
    const tangentContent = {
        ...filleted.content,
        entities: [...filleted.content.entities, tangent],
    };
    const touched = trimDrawingTarget(tangentContent, tangent.id, { x: 3, y: 0 }, {
        boundaryIds: [arc.id],
    });
    assert.equal(touched.changed, true);
    assert.equal(touched.replacements.length, 1);
    near(touched.replacements[0].x2, arc.cx);
});

test('whole-path FILLET arcs remain native trim targets under their persistent parent id', () => {
    const content = contentWith([{
        id: 'rectangle', type: 'rectangle', layerId: 'geometry',
        x: 0, y: 0, width: 10, height: 6,
    }]);
    const filleted = filletDrawingPath(content, 'rectangle', 1);
    assert.equal(filleted.changed, true);
    const target = filleted.entity;
    const cornerArc = target.parts.find(part => part.type === 'arc');
    assert.ok(cornerArc);
    const pick = curvePointAt(cornerArc, 0.5);
    const result = trimDrawingTarget(filleted.content, target.id, pick, { boundaryIds: [] });
    assert.equal(result.changed, true);
    assert.equal(result.affectedIds[0], 'rectangle');
    assert.equal(result.removedCurves[0].type, 'arc');
    assert.equal(result.replacements.some(entity => (
        entity.type === 'polyline' && entity.parts?.some(part => part.type === 'arc')
    )), true);
});

test('persistent arc hit children resolve an entity id and preview-only children do not impersonate one', () => {
    const persistentGroup = { dataset: { entityId: 'fillet-arc' } };
    assert.equal(entityIdFromDrawingEvent({
        target: { closest: selector => selector === '[data-entity-id]' ? persistentGroup : null },
    }), 'fillet-arc');
    assert.equal(entityIdFromDrawingEvent({
        target: { closest: () => null },
    }), null);
});

test('filleted rectangles retain native arc corners and polygons become open paths', () => {
    const cutters = [line('left', 3, -1, 3, 1), line('right', 7, -1, 7, 1)];
    const rectangle = trimDrawingEntity({
        type: 'rectangle', x: 0, y: 0, width: 10, height: 5,
        cornerStyle: 'fillet', cornerValue: 1,
    }, { x: 5, y: 0 }, cutters);
    assert.equal(rectangle.changed, true);
    assert.equal(rectangle.fragments.length, 1);
    assert.equal(rectangle.fragments[0].type, 'polyline');
    assert.equal(rectangle.fragments[0].closed, false);
    assert.equal(rectangle.fragments[0].parts.filter(part => part.type === 'arc').length, 4);

    const polygon = trimDrawingEntity({ type: 'polygon', cx: 0, cy: 0, r: 5, sides: 4 }, { x: 0, y: -5 }, []);
    assert.equal(polygon.changed, true);
    assert.equal(polygon.fragments[0].type, 'polyline');
    assert.equal(polygon.fragments[0].closed, false);
});

test('point and mixed polylines trim without flattening circular parts', () => {
    const pointPolyline = {
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }],
        closed: false,
    };
    const pointResult = trimDrawingEntity(pointPolyline, { x: 5, y: 0 }, [
        line('left', 3, -1, 3, 1), line('right', 7, -1, 7, 1),
    ]);
    assert.equal(pointResult.changed, true);
    assert.equal(pointResult.fragments.length, 2);

    const mixed = {
        type: 'polyline',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 5, y2: 0 },
            { type: 'arc', cx: 5, cy: 5, r: 5, startAngle: -Math.PI / 2, endAngle: 0, counterClockwise: true },
        ],
        closed: false,
    };
    const mixedResult = trimDrawingEntity(mixed, { x: 8.5, y: 1.5 }, [line('cut', 8, 0, 8, 5)]);
    assert.equal(mixedResult.changed, true);
    assert.equal(mixedResult.fragments[0].type, 'polyline');
    assert.equal(mixedResult.fragments[0].parts.some(part => part.type === 'arc'), true);
});

test('finite and virtually extended cutting edges are distinct', () => {
    const target = line('target', 0, 0, 10, 0);
    const shortBoundary = line('short', 5, 1, 5, 2);
    const finite = trimDrawingEntity(target, { x: 8, y: 0 }, [shortBoundary], { removeUnbounded: false });
    assert.equal(finite.changed, false);
    const extended = trimDrawingEntity(target, { x: 8, y: 0 }, [shortBoundary], {
        removeUnbounded: false,
        extendEdges: true,
    });
    assert.equal(extended.changed, true);
    near(extended.fragments[0].x2, 5);
});

test('projection is explicit and rejects unsupported projection modes', () => {
    const target = line('target', 0, 0, 10, 0);
    const boundary = line('boundary', 5, -1, 5, 1);
    assert.equal(trimDrawingEntity(target, { x: 8, y: 0 }, [boundary], { projection: 'view' }).changed, false);
    assert.equal(trimDrawingEntity(target, { x: 8, y: 0 }, [boundary], { projection: '2d' }).projection, '2d');
    assert.equal(trimDrawingEntity(target, { x: 8, y: 0 }, [boundary], { project: 'none' }).projection, 'none');
});

test('line extension picks the nearest forward endpoint and nearest boundary', () => {
    const target = line('target', 0, 0, 2, 0);
    const result = extendDrawingEntity(target, { x: 2, y: 0 }, [
        line('far', 8, -1, 8, 1),
        line('near', 5, -1, 5, 1),
    ]);
    assert.equal(result.changed, true);
    assert.equal(result.endpoint, 'end');
    assert.equal(result.boundaryId, 'near');
    near(result.entity.x2, 5);
    near(result.distance, 3);
    assert.deepEqual(geometry(result.extensionPath.parts[0]), { type: 'line', x1: 2, y1: 0, x2: 5, y2: 0 });
});

test('line start extension follows the outward ray only', () => {
    const result = extendDrawingEntity(line('target', 0, 0, 2, 0), { x: 0, y: 0 }, [
        line('left', -3, -1, -3, 1),
        line('wrong-way', 5, -1, 5, 1),
    ]);
    assert.equal(result.endpoint, 'start');
    assert.equal(result.boundaryId, 'left');
    near(result.entity.x1, -3);
});

test('arc extension preserves native direction and stops at the next forward hit', () => {
    const arc = {
        type: 'arc', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    };
    const result = extendDrawingEntity(arc, { x: 0, y: 5 }, [line('boundary', -5, -1, -5, 1)]);
    assert.equal(result.changed, true);
    assert.equal(result.entity.type, 'arc');
    near(result.entity.endAngle, Math.PI);
    assert.equal(result.entity.counterClockwise, true);
    assert.equal(result.extensionPath.parts[0].type, 'arc');
    near(result.extensionPath.parts[0].startAngle, Math.PI / 2);
});

test('an open mixed path extends only its selected terminal part', () => {
    const target = {
        type: 'polyline',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 2, y2: 0 },
            { type: 'line', x1: 2, y1: 0, x2: 2, y2: 2 },
        ],
        closed: false,
    };
    const result = extendDrawingEntity(target, { x: 2, y: 2 }, [line('boundary', 0, 5, 4, 5)]);
    assert.equal(result.changed, true);
    assert.equal(result.entity.type, 'polyline');
    assert.equal(result.entity.parts.length, 2);
    near(result.entity.parts[1].y2, 5);
    assert.deepEqual(result.entity.parts[0], target.parts[0]);
});

test('finite versus virtual boundary edges also applies to extend', () => {
    const target = line('target', 0, 0, 2, 0);
    const short = line('short', 5, 1, 5, 2);
    assert.equal(extendDrawingEntity(target, { x: 2, y: 0 }, [short]).changed, false);
    const result = extendDrawingEntity(target, { x: 2, y: 0 }, [short], { extendedEdges: true });
    assert.equal(result.changed, true);
    near(result.entity.x2, 5);
});

test('block references and canonical hatch loops can provide boundaries', () => {
    const block = {
        id: 'block', name: 'CUTTER', basePoint: { x: 0, y: 0 },
        entities: [line('block-line', 0, -1, 0, 1)],
    };
    const reference = {
        id: 'reference', type: 'blockReference', layerId: 'geometry', blockId: 'block',
        transform: { a: 1, b: 0, c: 0, d: 1, e: 3, f: 0 },
    };
    const hatch = {
        id: 'hatch', type: 'hatch', layerId: 'geometry',
        boundaries: [{
            type: 'polyline', closed: true,
            points: [{ x: 7, y: -1 }, { x: 8, y: -1 }, { x: 8, y: 1 }, { x: 7, y: 1 }],
        }],
    };
    const target = line('target', 0, 0, 10, 0);
    const content = contentWith([target, reference, hatch], [block]);
    const result = trimDrawingTarget(content, target, { x: 5, y: 0 }, { boundaryIds: ['reference', 'hatch'] });
    assert.equal(result.changed, true);
    assert.equal(result.replacements.length, 2);
    near(result.replacements[0].x2, 3);
    near(result.replacements[1].x1, 7);
});

test('straight and sampled freehand fences return ordered, deduplicated hits', () => {
    const content = contentWith([
        line('a', 0, 0, 10, 0),
        line('b', 0, 2, 10, 2),
    ]);
    assert.deepEqual(getDrawingTrimFenceHits(content, {
        first: { x: 5, y: -1 }, second: { x: 5, y: 3 },
    }).map(hit => hit.entityId), ['a', 'b']);
    const freehand = getDrawingTrimFenceHits(content, {
        samples: [{ x: 2, y: -1 }, { x: 2, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 3 }],
    });
    assert.deepEqual(freehand.map(hit => hit.entityId), ['a', 'b']);
    near(freehand[0].point.x, 2);
    near(freehand[1].point.x, 8);
});

test('batch fence processing is independent of target id order', () => {
    const content = contentWith([
        line('a', 0, 0, 10, 0),
        line('b', 0, 2, 10, 2),
        line('left', 3, -1, 3, 3),
        line('right', 7, -1, 7, 3),
    ]);
    const options = {
        boundaryIds: ['left', 'right'],
        fence: { first: { x: 5, y: -1 }, second: { x: 5, y: 3 } },
    };
    const first = trimDrawingTargets(content, { ...options, targetIds: ['a', 'b'] });
    const second = trimDrawingTargets(content, { ...options, targetIds: ['b', 'a'] });
    assert.equal(first.changedCount, 2);
    assert.equal(second.changedCount, 2);
    assert.deepEqual(first.results.map(result => result.removedSegments), second.results.map(result => result.removedSegments));
});

test('multiple freehand crossings remove multiple intervals from one target deterministically', () => {
    const content = contentWith([
        line('target', 0, 0, 12, 0),
        line('a', 2, -1, 2, 1), line('b', 4, -1, 4, 1),
        line('c', 8, -1, 8, 1), line('d', 10, -1, 10, 1),
    ]);
    const result = trimDrawingTargets(content, {
        targetIds: ['target'], boundaryIds: ['a', 'b', 'c', 'd'],
        fence: { samples: [{ x: 3, y: -1 }, { x: 3, y: 1 }, { x: 9, y: 1 }, { x: 9, y: -1 }] },
    });
    assert.equal(result.changedCount, 1);
    assert.equal(result.results[0].removedPaths.length, 2);
    assert.equal(result.replacements.length, 3);
});

test('trim and extend previews preserve arc geometry rather than chord-flattening it', () => {
    const arc = {
        id: 'arc', type: 'arc', layerId: 'geometry', cx: 0, cy: 0, r: 5,
        startAngle: 0, endAngle: Math.PI, counterClockwise: true,
    };
    const content = contentWith([arc, line('first', 4, -2, 4, 4), line('second', -4, -2, -4, 4)]);
    const trimPreview = createTrimPreviewEntities(content, {
        targetId: 'arc', point: { x: 0, y: 5 }, boundaryIds: ['first', 'second'],
    });
    assert.equal(trimPreview[0].type, 'arc');
    assert.equal(trimPreview[0].previewMode, 'trim');

    const extendArc = { ...arc, endAngle: Math.PI / 2 };
    const extendContent = contentWith([extendArc, line('end-boundary', -5, -1, -5, 1)]);
    const extendPreview = createExtendPreviewEntities(extendContent, {
        targetId: 'arc', point: { x: -5, y: 0 }, boundaryIds: ['end-boundary'],
    });
    assert.equal(extendPreview[0].type, 'arc');
    assert.equal(extendPreview[0].previewMode, 'extend');
});

test('legacy fence APIs keep their endpoint-chord result and unbounded removal behavior', () => {
    const content = contentWith([line('a', 0, 0, 10, 0), line('b', 0, 2, 10, 2)]);
    const fence = { first: { x: 5, y: -1 }, second: { x: 5, y: 3 } };
    const preview = previewTrimDrawingFence(content, fence);
    assert.deepEqual(preview, [
        [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        [{ x: 0, y: 2 }, { x: 10, y: 2 }],
    ]);
    const result = trimDrawingFence(content, fence);
    assert.equal(result.changedCount, 2);
    assert.equal(result.content.entities.length, 0);
});

test('document extension retains source id and compatible associative dimensions', () => {
    const target = line('target', 0, 0, 2, 0);
    const content = contentWith([
        target,
        line('boundary', 5, -1, 5, 1),
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'target', offset: 0.5 },
    ]);
    const result = extendDrawingTarget(content, target, { x: 2, y: 0 }, { boundaryIds: ['boundary'] });
    assert.equal(result.changed, true);
    assert.equal(result.entity.id, 'target');
    assert.equal(result.content.entities.some(entity => entity.id === 'dimension' && entity.sourceId === 'target'), true);
});

test('batch extension plans against original boundaries and ignores request order', () => {
    const content = contentWith([
        line('a', 0, 0, 2, 0), line('b', 0, 2, 2, 2),
        line('boundary', 5, -1, 5, 3),
    ]);
    const first = extendDrawingTargets(content, {
        targetIds: ['a', 'b'], boundaryIds: ['boundary'],
        picks: { a: { x: 2, y: 0 }, b: { x: 2, y: 2 } },
    });
    const second = extendDrawingTargets(content, {
        targetIds: ['b', 'a'], boundaryIds: ['boundary'],
        picks: { a: { x: 2, y: 0 }, b: { x: 2, y: 2 } },
    });
    assert.equal(first.changedCount, 2);
    assert.equal(second.changedCount, 2);
    near(first.content.entities.find(entity => entity.id === 'a').x2, 5);
    near(second.content.entities.find(entity => entity.id === 'b').x2, 5);
});

test('non-finite, degenerate and pathological fence requests fail closed', () => {
    const content = contentWith([line('target', 0, 0, 10, 0)]);
    assert.equal(trimDrawingEntity(content.entities[0], { x: Infinity, y: 0 }, []).changed, false);
    assert.deepEqual(getDrawingTrimFenceHits(content, { first: { x: 1, y: 1 }, second: { x: 1, y: 1 } }), []);
    const oversized = Array.from({ length: 4_097 }, (_, index) => ({ x: index, y: index % 2 }));
    assert.deepEqual(getDrawingTrimFenceHits(content, { points: oversized }), []);
    assert.equal(extendDrawingEntity(content.entities[0], { x: NaN, y: 0 }, []).changed, false);
});
