import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getPolarTrackingAngles,
    isOrthoTrackingEnabled,
    normalizeDrawingDraftingSettings,
    normalizePolarAngles,
    parsePolarAnglesInput,
} from './drawingDraftingSettings.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { parseDrawingCommand } from './drawingCommands.js';
import { baseSnapCandidates, nearestSnapCandidate } from './drawingSnapGeometry.js';
import {
    MAX_ACTIVE_TRACKING_GUIDES,
    MAX_GUIDE_ENTITY_CHECKS,
    MAX_GUIDE_ENTITY_SEGMENT_CHECKS,
    MAX_TRACKING_INTERSECTION_CANDIDATES,
    MAX_TRACKING_ANCHORS,
    addTrackingAnchor,
    createTemporaryTrackingAnchor,
    createTrackingAnchor,
    resolveDrawingSnap,
    resolveTrackingPoint,
    selectTrackingGuidesNearPoint,
} from './drawingTracking.js';

function disableSnaps(content) {
    Object.keys(content.settings.snaps).forEach(key => { content.settings.snaps[key] = false; });
}

test('drafting commands and aliases remain shared with command-bar and MCP parsing', () => {
    assert.equal(parseDrawingCommand('ORTHO').command, 'ortho');
    assert.equal(parseDrawingCommand('PTA 30 15 75').command, 'polar');
    assert.deepEqual(parseDrawingCommand('PTA 30 15 75').args, [30, 15, 75]);
    assert.equal(parseDrawingCommand('OT').command, 'objectTracking');
    assert.equal(parseDrawingCommand('DS').command, 'draftingSettings');
    assert.equal(parseDrawingCommand('TT').command, 'temporaryTrackingPoint');
});

test('drafting settings normalize polar angles, increments, relations, and temporary Ortho overrides', () => {
    const normalized = normalizeDrawingDraftingSettings({
        ortho: 1,
        polarTracking: 'yes',
        polarIncrement: 30,
        polarAngles: [-15, 195, '15', 'bad', 270],
        tracking: true,
        trackingRelations: { parallel: false, perpendicular: true, tangent: false },
    });
    assert.deepEqual(normalized, {
        ortho: true,
        polarTracking: false,
        polarIncrement: 30,
        polarAngles: [165, 15, 90],
        tracking: true,
        trackingRelations: { parallel: false, perpendicular: true, tangent: false },
    });
    assert.deepEqual(normalizePolarAngles('15; 45, 195 -45'), [15, 45, 135]);
    assert.deepEqual(getPolarTrackingAngles(normalized).map(angle => Math.round(angle * 180 / Math.PI)), [0, 30, 60, 90, 120, 150, 165, 15]);
    assert.equal(isOrthoTrackingEnabled(normalized), true);
    assert.equal(isOrthoTrackingEnabled(normalized, true), false);
    assert.equal(isOrthoTrackingEnabled({ ortho: false }, true), true);
});

test('polar-angle input round-trips localized decimal separators without splitting French decimals', () => {
    assert.deepEqual(parsePolarAnglesInput('22,5; 67,5', 'fr'), [22.5, 67.5]);
    assert.deepEqual(parsePolarAnglesInput('22.5, 67.5', 'en'), [22.5, 67.5]);
});

test('drawing normalization persists valid drafting modes and repairs unsafe values', () => {
    const content = createDefaultDrawingContent();
    const normalized = normalizeDrawingContent({
        ...content,
        settings: {
            ...content.settings,
            ortho: true,
            polarTracking: true,
            polarIncrement: 30,
            polarAngles: [15, 195],
            tracking: true,
            trackingRelations: { parallel: false, perpendicular: true, tangent: false },
        },
    });
    assert.equal(normalized.settings.ortho, true);
    assert.equal(normalized.settings.polarTracking, false);
    assert.equal(normalized.settings.polarIncrement, 30);
    assert.deepEqual(normalized.settings.polarAngles, [15]);
    assert.deepEqual(normalized.settings.trackingRelations, { parallel: false, perpendicular: true, tangent: false });

    const repaired = normalizeDrawingContent({
        ...content,
        settings: { ...content.settings, polarIncrement: 0.01, polarAngles: Array(50).fill(12) },
    });
    assert.equal(repaired.settings.polarIncrement, 45);
    assert.deepEqual(repaired.settings.polarAngles, [12]);
});

test('tracking acquisition keeps the seven most recent unique points', () => {
    const anchors = Array.from({ length: MAX_TRACKING_ANCHORS + 2 }, (_, index) => (
        createTrackingAnchor({ x: index, y: 0, type: 'endpoint' })
    )).reduce((current, anchor) => addTrackingAnchor(current, anchor), []);
    assert.equal(anchors.length, 7);
    assert.deepEqual(anchors.map(anchor => anchor.x), [2, 3, 4, 5, 6, 7, 8]);
    assert.equal(addTrackingAnchor(anchors, createTrackingAnchor({ x: 8, y: 0, type: 'midpoint' })), anchors);
});

test('dense polar configurations stay behind deterministic per-frame guide caps', () => {
    const angles = getPolarTrackingAngles({ polarTracking: true, polarIncrement: 1 });
    assert.equal(angles.length, 180);
    const guides = Array.from({ length: 2_000 }, (_, index) => ({
        anchor: { x: 0, y: 0 },
        angle: index * Math.PI / 2_000,
        anchorIndex: index % MAX_TRACKING_ANCHORS,
        kind: 'tracking',
    }));
    const active = selectTrackingGuidesNearPoint(guides, { x: 0, y: 0 }, 0.1, Number.MAX_SAFE_INTEGER);
    assert.equal(active.length, MAX_ACTIVE_TRACKING_GUIDES);
    assert.deepEqual(active, guides.slice(0, MAX_ACTIVE_TRACKING_GUIDES));
    assert.deepEqual(selectTrackingGuidesNearPoint([
        { anchor: { x: 0, y: 100 }, angle: 0 },
    ], { x: 0, y: 0 }, 0.1), []);
    assert.ok(MAX_GUIDE_ENTITY_CHECKS <= 20_000);
    assert.ok(MAX_GUIDE_ENTITY_SEGMENT_CHECKS <= 128);
    assert.ok(MAX_TRACKING_INTERSECTION_CANDIDATES <= 512);
});

test('guide/entity tracking stops scanning a pathological polyline at its segment budget', () => {
    const parts = Array.from({ length: MAX_GUIDE_ENTITY_SEGMENT_CHECKS + 2 }, (_, index) => ({
        type: 'line',
        x1: index,
        y1: 1,
        x2: index + 0.5,
        y2: 1,
    }));
    Object.defineProperty(parts, MAX_GUIDE_ENTITY_SEGMENT_CHECKS, {
        configurable: true,
        get() {
            throw new Error('segment budget exceeded');
        },
    });
    const content = createDefaultDrawingContent();
    content.settings.snaps.nearest = true;
    content.entities = [{ id: 'pathological', type: 'polyline', layerId: content.activeLayerId, parts }];
    const anchor = createTrackingAnchor({ x: 0, y: 0, type: 'endpoint' });
    assert.doesNotThrow(() => resolveTrackingPoint({ x: 0, y: 0 }, content, 0.1, [anchor]));
});

test('flat-point polyline tracking is lazy, budgeted, and includes a closed segment', () => {
    const points = Array.from({ length: MAX_GUIDE_ENTITY_SEGMENT_CHECKS + 3 }, (_, index) => ({
        x: index,
        y: 1,
    }));
    Object.defineProperty(points, MAX_GUIDE_ENTITY_SEGMENT_CHECKS + 1, {
        configurable: true,
        get() {
            throw new Error('flat-point segment budget exceeded');
        },
    });
    const content = createDefaultDrawingContent();
    content.settings.snaps.nearest = true;
    content.entities = [{
        id: 'flat-pathological',
        type: 'polyline',
        layerId: content.activeLayerId,
        points,
        closed: true,
    }];
    const anchor = createTrackingAnchor({ x: 0, y: 0, type: 'endpoint' });
    assert.doesNotThrow(() => resolveTrackingPoint({ x: 0, y: 0 }, content, 0.1, [anchor]));

    content.entities = [{
        id: 'closed',
        type: 'polyline',
        layerId: content.activeLayerId,
        points: [{ x: 1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }],
        closed: true,
    }];
    const closure = resolveTrackingPoint({ x: 1.5, y: 0.01 }, content, 0.1, [anchor]);
    assert.equal(closure.type, 'trackingIntersection');
    assert.equal(closure.entityId, 'closed');
    assert.ok(Math.abs(closure.x - 1.5) < 1e-9);
    assert.ok(Math.abs(closure.y) < 1e-9);
});

test('persistent Ortho constrains every referenced point and Shift temporarily inverts it', () => {
    const content = createDefaultDrawingContent();
    disableSnaps(content);
    content.settings.ortho = true;
    const origin = { x: 1, y: 2 };
    assert.deepEqual(resolveDrawingSnap({ x: 6, y: 3 }, content, 0.1, { orthogonalOrigin: origin }), {
        x: 6,
        y: 2,
        type: 'orthogonal',
    });
    assert.equal(resolveDrawingSnap({ x: 6, y: 3 }, content, 0.1, {
        orthogonalOrigin: origin,
        temporaryOrtho: true,
    }).type, null);
    content.settings.ortho = false;
    assert.equal(resolveDrawingSnap({ x: 6, y: 3 }, content, 0.1, {
        orthogonalOrigin: origin,
        temporaryOrtho: true,
    }).type, 'orthogonal');
});

test('polar tracking projects onto configured increments and additional angles inside the aperture', () => {
    const content = createDefaultDrawingContent();
    disableSnaps(content);
    content.settings.polarTracking = true;
    content.settings.polarIncrement = 45;
    content.settings.polarAngles = [30];
    const origin = { x: 0, y: 0 };
    const tracked = resolveDrawingSnap({ x: 10, y: 5.72 }, content, 0.2, { orthogonalOrigin: origin });
    assert.equal(tracked.type, 'polar');
    assert.ok(Math.abs(tracked.y - tracked.x * Math.tan(Math.PI / 6)) < 1e-9);
    const outside = resolveDrawingSnap({ x: 10, y: 4 }, content, 0.01, { orthogonalOrigin: origin });
    assert.equal(outside.type, null);
});

test('object tracking identifies parallel, perpendicular, and tangent guides explicitly', () => {
    const content = createDefaultDrawingContent();
    disableSnaps(content);
    content.settings.tracking = true;
    const lineAnchor = createTrackingAnchor({
        x: 0,
        y: 0,
        type: 'endpoint',
        trackingDirections: [
            { angle: Math.PI / 4, relation: 'parallel' },
            { angle: Math.PI * 3 / 4, relation: 'perpendicular' },
        ],
    });
    assert.equal(resolveDrawingSnap({ x: 5, y: 5.05 }, content, 0.1, { trackingAnchors: [lineAnchor] }).type, 'parallelTracking');
    assert.equal(resolveDrawingSnap({ x: -5, y: 5.05 }, content, 0.1, { trackingAnchors: [lineAnchor] }).type, 'perpendicularTracking');

    const curveAnchor = createTrackingAnchor({
        x: 0,
        y: 0,
        type: 'midpoint',
        trackingDirections: [
            { angle: Math.PI * 2 / 3, relation: 'tangent' },
            { angle: Math.PI / 6, relation: 'perpendicular' },
        ],
    });
    const nearTangent = { x: -2.55, y: 4.37 };
    assert.equal(resolveDrawingSnap(nearTangent, content, 0.1, { trackingAnchors: [curveAnchor] }).type, 'tangentTracking');
});

test('disabled object-tracking relations are omitted without disabling alignment paths', () => {
    const settings = {
        trackingRelations: { parallel: false, perpendicular: true, tangent: false },
    };
    const anchor = createTrackingAnchor({
        x: 0,
        y: 0,
        type: 'endpoint',
        trackingDirections: [
            { angle: Math.PI / 6, relation: 'parallel' },
            { angle: Math.PI * 2 / 3, relation: 'perpendicular' },
            { angle: Math.PI / 3, relation: 'tangent' },
        ],
    }, settings);
    assert.deepEqual(anchor.directions.map(direction => direction.relation), ['perpendicular', null, null]);
});

test('temporary tracking points can use raw positions or an acquired nearest tangent', () => {
    const raw = createTemporaryTrackingAnchor({ x: 3, y: 4 }, { polarTracking: true, polarIncrement: 30 });
    assert.equal(raw.temporary, true);
    assert.equal(raw.sourceType, 'temporary');
    assert.equal(raw.directions.length, 6);

    const nearest = nearestSnapCandidate({ x: 5, y: 0 }, { id: 'circle', type: 'circle', cx: 0, cy: 0, r: 2 });
    const acquired = createTemporaryTrackingAnchor(nearest);
    assert.equal(acquired.sourceEntityId, 'circle');
    assert.equal(acquired.sourceType, 'nearest');
    assert.equal(acquired.directions.some(direction => direction.relation === 'tangent'), true);
});

test('snap candidates expose source-relative tracking directions for lines and curves', () => {
    const line = { id: 'line', type: 'line', x1: 0, y1: 0, x2: 2, y2: 2 };
    const lineCandidate = baseSnapCandidates(line, { endpoint: true })[0];
    assert.deepEqual(lineCandidate.trackingDirections.map(direction => direction.relation), ['parallel', 'perpendicular']);

    const arc = { id: 'arc', type: 'arc', cx: 0, cy: 0, r: 2, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true };
    const arcCandidate = baseSnapCandidates(arc, { endpoint: true })[0];
    assert.deepEqual(arcCandidate.trackingDirections.map(direction => direction.relation), ['tangent', 'perpendicular']);
    assert.ok(Math.abs(arcCandidate.trackingDirections[0].angle - Math.PI / 2) < 1e-12);
});

test('polar and acquired object guides can form a precise tracking intersection', () => {
    const content = createDefaultDrawingContent();
    disableSnaps(content);
    content.settings.tracking = true;
    content.settings.polarTracking = true;
    content.settings.polarIncrement = 45;
    const anchor = createTrackingAnchor({ x: 0, y: 5, type: 'endpoint' }, content.settings);
    const intersection = resolveDrawingSnap({ x: 5.01, y: 5.02 }, content, 0.1, {
        trackingAnchors: [anchor],
        orthogonalOrigin: { x: 0, y: 0 },
    });
    assert.equal(intersection.type, 'trackingIntersection');
    assert.ok(Math.abs(intersection.x - 5) < 1e-9);
    assert.ok(Math.abs(intersection.y - 5) < 1e-9);
});
