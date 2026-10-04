import test from 'node:test';
import assert from 'node:assert/strict';

import {
    applySelectionOperation,
    canEditEntity,
    canSelectEntity,
    createDimensionForEntity,
    createDefaultDrawingContent,
    createFreeDimension,
    deleteSelectedEntities,
    getEntityAppearance,
    normalizeDrawingContent,
    removeEmptyLayer,
    replaceEntityWithEntities,
    updateLayer,
    updateSelectedEntities,
} from './drawingDocument.js';
import {
    clientPointToViewBox,
    formatDrawingLength,
    getAdaptiveGridSpacing,
    getDimensionGeometry,
    getEntityBounds,
    getOffsetThroughParameters,
    getRectEntityCorners,
    getScreenScaleRatio,
    getWorldUnitsPerPixelForScaleRatio,
    getTrimFenceHits,
    offsetEntity,
    offsetEntityTowardPoint,
    resizeViewBoxForCanvas,
    rotateEntity,
    scaleEntity,
    snapDrawingPoint,
    translateEntity,
    trimEntityAtPoint,
    removeUnboundedEntityPortion,
} from './drawingGeometry.js';
import {
    angleToRadians,
    createAngleConfig,
    convertAngle,
    directedAngleBetween,
    directionalDelta,
    operationAngle,
    operationScaleFactor,
    createOffsetPreviewEntities,
} from './drawingOperations.js';
import {
    mirrorEntity,
    scaleEntity as scalePrimitiveEntity,
    symmetricConstructionTransform,
    transformEntity,
    transformPoint,
} from './drawingPrimitives.js';
import { previewTrimDrawingFence, trimDrawingFence, trimDrawingTarget } from './drawingTrimOperations.js';
import { constrainLineGripPoint, createSelectionWindow, editEntityGrip, entityMatchesSelectionWindow, getEntityGrips } from './drawingSelection.js';
import { getDrawingCommandInput, getDrawingCommandSuggestions, isNumericDrawingInput, parseDrawingCommand, resolveDrawingAutocompleteSubmission } from './drawingCommands.js';
import { getDrawingTextLayout } from './drawingText.js';
import { addTrackingAnchor, constrainOrthogonalPoint, createTrackingAnchor, resolveDrawingSnap } from './drawingTracking.js';

test('CAD aliases and numeric inputs are recognized', () => {
    assert.deepEqual(parseDrawingCommand('SC 0,1'), { command: 'scale', alias: 'SC', args: [0.1] });
    assert.equal(parseDrawingCommand('rec').command, 'rectangle');
    assert.equal(parseDrawingCommand('T').command, 'text');
    assert.equal(parseDrawingCommand('RO').command, 'rotate');
    assert.equal(parseDrawingCommand('CP').command, 'copy');
    assert.equal(parseDrawingCommand('DDI').command, 'diameterDimension');
    assert.equal(parseDrawingCommand('CENTERMARK').command, 'centerMark');
    assert.equal(parseDrawingCommand('CENTERREASSOCIATE').command, 'centerReassociate');
    assert.equal(parseDrawingCommand('CENTERDISASSOCIATE').command, 'centerDisassociate');
    assert.equal(parseDrawingCommand('CENTERRESET').command, 'centerReset');
    assert.equal(parseDrawingCommand('SA').command, 'saveAs');
    assert.equal(parseDrawingCommand('mirror').command, 'mirror');
    assert.equal(parseDrawingCommand('J').command, 'join');
    assert.equal(parseDrawingCommand('explode').command, 'explode');
    assert.equal(parseDrawingCommand('AR').command, 'array');
    assert.equal(parseDrawingCommand('array').command, 'array');
    assert.equal(parseDrawingCommand('VP').command, 'viewport');
    assert.equal(parseDrawingCommand('VIEWPORT').command, 'viewport');
    assert.equal(parseDrawingCommand('VIEWPOINT').command, 'viewport');
    assert.equal(parseDrawingCommand('PDFA').command, 'pdfAll');
    assert.equal(parseDrawingCommand('PDFALL').command, 'pdfAll');
    assert.equal(parseDrawingCommand('-PLOT').command, 'plot');
    assert.equal(parseDrawingCommand('PUBLISH').command, 'publish');
    assert.equal(parseDrawingCommand('AUTOPUBLISH').command, 'autoPublish');
    assert.equal(parseDrawingCommand('EXPORTDWFX').command, 'dwfx');
    assert.equal(parseDrawingCommand('SAVE').command, 'unknown');
    ['TR', 'TRIM', 'CUT', 'COUPER', 'AJUSTER'].forEach(alias => assert.equal(parseDrawingCommand(alias).command, 'trim'));
    assert.equal(isNumericDrawingInput('12,5'), true);
    assert.equal(isNumericDrawingInput('5 3'), true);
    assert.equal(isNumericDrawingInput('5m'), true);
    assert.equal(isNumericDrawingInput('5 m'), true);
    assert.equal(getDrawingCommandInput('CAL span = 2,5 + 1,25'), 'span = 2,5 + 1,25');
    assert.equal(getDrawingCommandInput('CAL'), '');
    assert.deepEqual(getDrawingCommandSuggestions('sav').map(item => item.name), ['SAVEAS']);
    assert.deepEqual(getDrawingCommandSuggestions('c').slice(0, 2).map(item => [item.name, item.alias]), [
        ['CIRCLE', 'C'],
        ['CENTERDISASSOCIATE', 'CENTERDISASSOCIATE'],
    ]);
    assert.equal(resolveDrawingAutocompleteSubmission('sca', getDrawingCommandSuggestions('sca')), 'SCALE');
    assert.equal(resolveDrawingAutocompleteSubmission('SC', getDrawingCommandSuggestions('SC')), 'SC');
    assert.ok(getDrawingCommandSuggestions('r').length <= 5);
});

test('line, rectangle and circle offsets preserve their geometry rules', () => {
    assert.deepEqual(offsetEntity({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, 2), {
        type: 'line', x1: 0, y1: 2, x2: 10, y2: 2,
    });
    assert.deepEqual(offsetEntity({ type: 'rectangle', x: 1, y: 2, width: 4, height: 3 }, 0.5), {
        type: 'rectangle', x: 0.5, y: 1.5, width: 5, height: 4,
    });
    assert.equal(offsetEntity({ type: 'circle', cx: 0, cy: 0, r: 1 }, -2), null);
});

test('offset side is designated by a point for lines, rectangles and circles', () => {
    const line = { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    assert.equal(offsetEntityTowardPoint(line, 2, { x: 5, y: 4 }).y1, 2);
    assert.equal(offsetEntityTowardPoint(line, 2, { x: 5, y: -4 }).y1, -2);

    const rectangle = { type: 'rectangle', x: 0, y: 0, width: 10, height: 8 };
    assert.deepEqual(offsetEntityTowardPoint(rectangle, 1, { x: 5, y: 4 }), {
        type: 'rectangle', x: 1, y: 1, width: 8, height: 6,
    });
    assert.deepEqual(offsetEntityTowardPoint(rectangle, 1, { x: 12, y: 4 }), {
        type: 'rectangle', x: -1, y: -1, width: 12, height: 10,
    });
    assert.deepEqual(offsetEntityTowardPoint({ ...rectangle, x: 10, y: 8, width: -10, height: -8 }, 1, { x: 5, y: 4 }), {
        type: 'rectangle', x: 1, y: 1, width: 8, height: 6,
    });

    const circle = { type: 'circle', cx: 0, cy: 0, r: 5 };
    assert.equal(offsetEntityTowardPoint(circle, 1, { x: 0, y: 0 }).r, 4);
    assert.equal(offsetEntityTowardPoint(circle, 1, { x: 8, y: 0 }).r, 6);
    assert.equal(offsetEntityTowardPoint(circle, 5, { x: 0, y: 0 }), null);
});

test('open polyline offsets join corners and preserve appearance and layer fields', () => {
    const open = {
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }],
        closed: false,
        layerId: 'geometry',
        color: '#f97316',
        lineWidth: 2,
    };
    assert.deepEqual(offsetEntity(open, 1), {
        ...open,
        points: [{ x: 0, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 5 }],
    });
    assert.deepEqual(offsetEntityTowardPoint(open, 1, { x: 2, y: -3 }), {
        ...open,
        points: [{ x: 0, y: -1 }, { x: 6, y: -1 }, { x: 6, y: 5 }],
    });
});

test('closed polyline offsets form joined inward and outward boundaries', () => {
    const square = {
        type: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        closed: true,
        layerId: 'geometry',
        lineType: 'dashed',
    };
    assert.deepEqual(offsetEntity(square, 1), {
        ...square,
        points: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }],
    });
    assert.deepEqual(offsetEntity(square, -1), {
        ...square,
        points: [{ x: -1, y: -1 }, { x: 11, y: -1 }, { x: 11, y: 11 }, { x: -1, y: 11 }],
    });
    assert.deepEqual(offsetEntityTowardPoint(square, 1, { x: 5, y: 5 }), offsetEntity(square, 1));
});

test('THROUGH parameters derive distance and signed side for every supported offset entity', () => {
    assert.deepEqual(
        getOffsetThroughParameters({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { x: 5, y: 3 }),
        { distance: 3, side: 1 },
    );
    assert.deepEqual(
        getOffsetThroughParameters({ type: 'rectangle', x: 0, y: 0, width: 10, height: 8 }, { x: 5, y: -3 }),
        { distance: 3, side: 1 },
    );
    const polygonPoint = -5 - 2 / Math.sqrt(2);
    const polygonThrough = getOffsetThroughParameters(
        { type: 'polygon', cx: 0, cy: 0, r: 10, sides: 4, rotation: 0 },
        { x: polygonPoint, y: polygonPoint },
    );
    assert.ok(polygonThrough);
    assert.ok(Math.abs(polygonThrough.distance - 2) < 1e-9);
    assert.equal(polygonThrough.side, 1);
    assert.deepEqual(
        getOffsetThroughParameters({ type: 'circle', cx: 0, cy: 0, r: 5 }, { x: 0, y: 8 }),
        { distance: 3, side: 1 },
    );
    assert.deepEqual(
        getOffsetThroughParameters({
            type: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI, counterClockwise: true,
        }, { x: 0, y: 8 }),
        { distance: 3, side: 1 },
    );
    assert.deepEqual(
        getOffsetThroughParameters({
            type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], closed: false,
        }, { x: 5, y: -3 }),
        { distance: 3, side: -1 },
    );
});

test('offset rejects ambiguous, self-collapsing, non-finite, and oversized polylines', () => {
    const square = {
        type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], closed: true,
    };
    assert.equal(offsetEntity(square, 5), null);
    assert.equal(getOffsetThroughParameters(square, { x: 5, y: 5 }), null);
    assert.equal(offsetEntity({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }] }, 1), null);
    assert.equal(offsetEntity({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, 1), null);
    assert.equal(offsetEntity({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, Infinity), null);
    assert.equal(getOffsetThroughParameters({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }, { x: 5, y: 0 }), null);
    assert.equal(getOffsetThroughParameters({ type: 'circle', cx: 0, cy: 0, r: 5 }, { x: 0, y: 0 }), null);
    assert.equal(getOffsetThroughParameters({
        type: 'arc', cx: 0, cy: 0, r: 5, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
    }, { x: -8, y: 0 }), null);
    const oversized = Array.from({ length: 4097 }, (_, index) => ({ x: index, y: 0 }));
    assert.equal(offsetEntity({ type: 'polyline', points: oversized }, 1), null);
});

test('trim removes the clicked line portion between visible cutting boundaries', () => {
    const target = { id: 'target', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 };
    const boundaries = [
        { type: 'line', x1: 3, y1: -2, x2: 3, y2: 2 },
        { type: 'rectangle', x: 7, y: -1, width: 1, height: 2 },
    ];
    const result = trimEntityAtPoint(target, { x: 5, y: 0 }, boundaries);
    assert.equal(result.status, 'trimmed');
    assert.deepEqual(result.fragments, [
        { type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: 0 },
        { type: 'line', layerId: 'geometry', x1: 7, y1: 0, x2: 10, y2: 0 },
    ]);
    assert.deepEqual(result.removedSegments, [[{ x: 3, y: 0 }, { x: 7, y: 0 }]]);
});

test('trim converts a rectangle perimeter to line fragments and circles remain safe boundaries only', () => {
    const rectangle = { id: 'roof', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 10, height: 5 };
    const boundaries = [
        { type: 'line', x1: 3, y1: -1, x2: 3, y2: 1 },
        { type: 'circle', cx: 7, cy: 0, r: 0.5 },
    ];
    const result = trimEntityAtPoint(rectangle, { x: 7, y: 0.2 }, boundaries);
    assert.equal(result.status, 'trimmed');
    assert.equal(result.fragments.length, 5);
    assert.deepEqual(result.fragments[0], { type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 6.5, y2: 0 });
    assert.deepEqual(result.fragments[1], { type: 'line', layerId: 'geometry', x1: 7.5, y1: 0, x2: 10, y2: 0 });
    assert.equal(trimEntityAtPoint({ type: 'circle', cx: 0, cy: 0, r: 2 }, { x: 2, y: 0 }, boundaries).status, 'circle-unsupported');
    assert.equal(trimEntityAtPoint(rectangle, { x: 5, y: 0 }, []).status, 'no-intersection');
});

test('trim handles negatively drawn rectangles and entity replacement removes associative dimensions', () => {
    const rectangle = { id: 'roof', type: 'rectangle', layerId: 'geometry', x: 10, y: 5, width: -10, height: -5 };
    const result = trimEntityAtPoint(rectangle, { x: 5, y: 0 }, [
        { type: 'line', x1: 3, y1: -1, x2: 3, y2: 1 },
        { type: 'line', x1: 7, y1: -1, x2: 7, y2: 1 },
    ]);
    assert.equal(result.status, 'trimmed');
    assert.equal(result.fragments.length, 5);

    const content = createDefaultDrawingContent();
    content.entities = [
        rectangle,
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'roof', offset: 0.5 },
        { id: 'other', type: 'line', layerId: 'geometry', x1: 0, y1: 8, x2: 2, y2: 8 },
    ];
    const replacements = result.fragments.map((fragment, index) => ({ ...fragment, id: `fragment-${index}` }));
    const replaced = replaceEntityWithEntities(content, 'roof', replacements);
    assert.equal(replaced.entities.some(entity => entity.id === 'roof'), false);
    assert.equal(replaced.entities.some(entity => entity.sourceId === 'roof'), false);
    assert.equal(replaced.entities.some(entity => entity.id === 'other'), true);
    assert.equal(replaced.entities.filter(entity => entity.id.startsWith('fragment-')).length, 5);
});

test('scale uses a shared origin and keeps metre precision', () => {
    const scaled = scaleEntity({ type: 'line', x1: 1, y1: 1, x2: 2, y2: 2 }, 0.1, { x: 1, y: 1 });
    assert.equal(scaled.x2, 1.1);
    assert.equal(scaled.y2, 1.1);
    assert.equal(formatDrawingLength(0.0125), '0.0125 m');
    assert.equal(formatDrawingLength(0.0125, 4, 'fr'), '0,0125 m');
});

test('angle configuration converts units and keeps clockwise direction explicit', () => {
    assert.equal(angleToRadians(200, 'gradians'), Math.PI);
    assert.equal(convertAngle(Math.PI / 2, 'radians', 'gradians'), 100);
    assert.deepEqual(createAngleConfig(90, { unit: 'degrees', direction: 'clockwise' }), {
        value: 90, unit: 'degrees', direction: 'clockwise', radians: -Math.PI / 2,
    });
    assert.equal(directedAngleBetween({ x: 0, y: 0 }, { x: 0, y: 1 }, { direction: 'clockwise' }), -90);
    assert.equal(operationAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { unit: 'gradians' }), 100);
});

test('safe non-uniform transforms preserve representable types and bound curve approximations', () => {
    assert.deepEqual(transformPoint({ x: 2, y: 3 }, { origin: { x: 1, y: 1 }, scaleX: 2, scaleY: 4 }), { x: 3, y: 9 });

    const line = transformEntity({ type: 'line', x1: 1, y1: 2, x2: 3, y2: 4 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3,
    });
    assert.deepEqual({ x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }, { x1: 2, y1: 6, x2: 6, y2: 12 });

    const nativeCircle = transformEntity({ type: 'circle', cx: 1, cy: 2, r: 3 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 2,
    });
    assert.equal(nativeCircle.type, 'circle');
    assert.deepEqual({ cx: nativeCircle.cx, cy: nativeCircle.cy, r: nativeCircle.r }, { cx: 2, cy: 4, r: 6 });

    const ellipse = transformEntity({ id: 'circle', type: 'circle', cx: 0, cy: 0, r: 10 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3, maxCurvePoints: 13,
    });
    assert.equal(ellipse.type, 'polyline');
    assert.equal(ellipse.closed, true);
    assert.ok(ellipse.points.length <= 13);
    assert.ok(ellipse.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    assert.equal(ellipse.id, 'circle');

    const arc = transformEntity({ type: 'arc', cx: 0, cy: 0, r: 10, startAngle: 0, endAngle: Math.PI, counterClockwise: true }, {
        origin: { x: 0, y: 0 }, scaleX: 4, scaleY: 2, maxCurvePoints: 11,
    });
    assert.equal(arc.type, 'polyline');
    assert.equal(arc.closed, false);
    assert.ok(arc.points.length <= 12);
    assert.deepEqual(arc.points[0], { x: 40, y: 0 });
    assert.ok(Math.abs(arc.points.at(-1).x + 40) < 1e-9);

    const polygon = transformEntity({ type: 'polygon', cx: 0, cy: 0, r: 2, sides: 5, rotation: 0 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 1,
    });
    assert.equal(polygon.type, 'polyline');
    assert.equal(polygon.closed, true);
    assert.equal(polygon.points.length, 5);

    const rectangle = transformEntity({ type: 'rectangle', x: 1, y: 2, width: 3, height: 4, rotation: 0 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3,
    });
    assert.equal(rectangle.type, 'rectangle');
    assert.deepEqual({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }, { x: 2, y: 6, width: 6, height: 12 });

    const rotatedRectangle = transformEntity({ type: 'rectangle', x: 0, y: 0, width: 3, height: 2, rotation: 30 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 1,
    });
    assert.equal(rotatedRectangle.type, 'polyline');
    assert.equal(rotatedRectangle.closed, true);
    assert.equal(rotatedRectangle.points.length, 4);
});

test('non-uniform text and dimensions remain coherent after transformation', () => {
    const text = transformEntity({ type: 'text', x: 1, y: 2, width: 4, height: 2, fontSize: 0.5, rotation: 0, text: 'A' }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3,
    });
    assert.equal(text.type, 'text');
    assert.deepEqual({ x: text.x, y: text.y, width: text.width, height: text.height }, { x: 2, y: 6, width: 8, height: 6 });
    assert.equal(text.fontSize, 1.5);
    assert.equal(Number.isFinite(text.fontSize), true);

    const dimension = transformEntity({ type: 'linearDimension', p1: { x: 0, y: 0 }, p2: { x: 4, y: 0 }, offset: 1 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 3,
    });
    assert.deepEqual(dimension.p1, { x: 0, y: 0 });
    assert.deepEqual(dimension.p2, { x: 8, y: 0 });
    assert.equal(dimension.offset, 3);

    const radial = transformEntity({ type: 'radialDimension', angle: Math.PI / 4, leaderScale: 2 }, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 1,
    });
    assert.ok(radial.angle > 0 && radial.angle < Math.PI / 4);
    assert.ok(Number.isFinite(radial.leaderScale));
    assert.equal(scalePrimitiveEntity({ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, { scaleX: 2, scaleY: 3 }, { x: 0, y: 0 }).x2, 2);
});

test('mirror keeps geometry reflected while text glyph mirroring is configurable', () => {
    const text = { type: 'text', x: 1, y: 2, width: 4, height: 2, rotation: 15, mirrored: false };
    const defaultMirror = mirrorEntity(text, { x: 0, y: 0 }, { x: 0, y: 1 });
    const geometryOnly = mirrorEntity(text, { x: 0, y: 0 }, { x: 0, y: 1 }, { mirrorTextGlyphs: false });
    assert.equal(defaultMirror.mirrored, true);
    assert.equal(geometryOnly.mirrored, false);
    assert.equal(defaultMirror.x, geometryOnly.x);
    assert.equal(defaultMirror.rotation, geometryOnly.rotation);

    const pair = symmetricConstructionTransform({ type: 'line', x1: 1, y1: 2, x2: 3, y2: 2 }, { x: 0, y: 0 }, { x: 0, y: 1 });
    assert.deepEqual(pair.pair[0], pair.source);
    assert.deepEqual(pair.pair[1], pair.mirrored);
    assert.deepEqual(pair.mirrored, { type: 'line', x1: -1, y1: 2, x2: -3, y2: 2 });
});

test('associative dimensions read the current source geometry', () => {
    const source = { type: 'line', x1: 0, y1: 0, x2: 3, y2: 4 };
    const first = getDimensionGeometry({ type: 'linearDimension', offset: 0.5 }, source);
    const second = getDimensionGeometry({ type: 'linearDimension', offset: 0.5 }, { ...source, x2: 6, y2: 8 });
    assert.equal(first.value, 5);
    assert.equal(second.value, 10);
    const movedSource = translateEntity(source, 8, -3);
    const moved = getDimensionGeometry({ type: 'linearDimension', offset: 0.5 }, movedSource);
    assert.ok(Math.abs(moved.text.x - first.text.x - 8) < 1e-12);
    assert.ok(Math.abs(moved.text.y - first.text.y + 3) < 1e-12);
});

test('the unified dimension command adapts to lines, rectangle edges, circles and free points', () => {
    const content = createDefaultDrawingContent();
    const line = { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 3, y2: 4 };
    const rectangle = { id: 'rectangle', type: 'rectangle', layerId: 'geometry', x: 10, y: 10, width: 4, height: 2 };
    const circle = { id: 'circle', type: 'circle', layerId: 'geometry', cx: 20, cy: 20, r: 3 };
    assert.equal(createDimensionForEntity(content, line).type, 'linearDimension');
    assert.equal(createDimensionForEntity(content, rectangle, 'auto', { x: 14, y: 11 }).edgeIndex, 1);
    assert.equal(createDimensionForEntity(content, circle).mode, 'radius');
    const arc = { id: 'arc', type: 'arc', layerId: 'geometry', cx: 30, cy: 20, r: 4, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true };
    const arcDiameter = createDimensionForEntity(content, arc, 'diameter', { x: 34, y: 20 });
    assert.equal(arcDiameter.mode, 'diameter');
    assert.equal(arcDiameter.angle, 0);
    assert.ok(Math.abs(createDimensionForEntity(content, arc).angle - Math.PI / 4) < 1e-12);
    const free = createFreeDimension(content, { x: 1, y: 2 }, { x: 4, y: 6 });
    assert.equal(getDimensionGeometry(free).value, 5);
});

test('rotation applies around a shared base point and preserves rotated text bounds', () => {
    const line = rotateEntity({ type: 'line', x1: 1, y1: 0, x2: 3, y2: 0 }, 90, { x: 0, y: 0 });
    assert.ok(Math.abs(line.x1) < 1e-12);
    assert.ok(Math.abs(line.y2 - 3) < 1e-12);
    const text = rotateEntity({ type: 'text', x: 0, y: 0, width: 4, height: 2, rotation: 0 }, 90, { x: 2, y: 1 });
    assert.equal(text.rotation, 90);
    const bounds = getEntityBounds(text);
    assert.ok(Math.abs(bounds.maxX - bounds.minX - 2) < 1e-12);
    assert.ok(Math.abs(bounds.maxY - bounds.minY - 4) < 1e-12);
    const corners = getRectEntityCorners(text);
    assert.equal(corners.length, 4);
});

test('operation values derive direction, angle and scale from the live pointer', () => {
    assert.deepEqual(directionalDelta({ x: 0, y: 0 }, { x: 3, y: 4 }, 10), { x: 6, y: 8 });
    assert.equal(operationAngle({ x: 0, y: 0 }, { x: 0, y: 2 }), 90);
    assert.equal(operationScaleFactor({ x: 1, y: 1 }, { x: 4, y: 5 }), 5);
});

test('offset preview applies the designated side to every compatible selected object', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'first', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'second', type: 'circle', layerId: 'geometry', cx: 20, cy: 0, r: 2 },
    ];
    const previews = createOffsetPreviewEntities(content, ['first', 'second'], 1, { x: 10, y: 4 });
    assert.equal(previews.length, 2);
    assert.equal(previews[0].y1, 1);
    assert.equal(previews[1].r, 3);
});

test('trim removes an unbounded segment entirely and a fence finds every crossed segment', () => {
    const first = { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 };
    const second = { id: 'b', type: 'line', layerId: 'geometry', x1: 0, y1: 2, x2: 10, y2: 2 };
    assert.deepEqual(removeUnboundedEntityPortion(first, { x: 5, y: 0 }), {
        status: 'removed',
        fragments: [],
        removedSegments: [[{ x: 0, y: 0 }, { x: 10, y: 0 }]],
    });
    assert.deepEqual(getTrimFenceHits({ x: 5, y: -1 }, { x: 5, y: 3 }, [first, second]).map(hit => hit.entityId), ['a', 'b']);
    const content = createDefaultDrawingContent();
    content.entities = [first, second];
    const result = trimDrawingFence(content, { first: { x: 5, y: -1 }, second: { x: 5, y: 3 } });
    assert.equal(result.changedCount, 2);
    assert.equal(result.content.entities.length, 0);
});

test('trim fence preview contains only the portion that the click will remove', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'target', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'left', type: 'line', layerId: 'geometry', x1: 3, y1: -2, x2: 3, y2: 2 },
        { id: 'right', type: 'line', layerId: 'geometry', x1: 7, y1: -2, x2: 7, y2: 2 },
    ];
    const preview = previewTrimDrawingFence(content, {
        first: { x: 5, y: -1 },
        second: { x: 5, y: 1 },
    });
    assert.deepEqual(preview, [[{ x: 3, y: 0 }, { x: 7, y: 0 }]]);
});

test('snapping covers grid, endpoints and intersections', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 10 },
        { id: 'b', type: 'line', layerId: 'geometry', x1: 0, y1: 10, x2: 10, y2: 0 },
    ];
    assert.equal(snapDrawingPoint({ x: 5.02, y: 4.98 }, content, 0.1).type, 'intersection');
    assert.equal(snapDrawingPoint({ x: 0.02, y: 0.01 }, content, 0.1).type, 'endpoint');
});

test('object snaps win over a much finer active grid inside the snap aperture', () => {
    const content = createDefaultDrawingContent();
    content.settings.gridSpacing = 0.001;
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0.0045, y1: 0.0045, x2: 2.0045, y2: 0.0045 },
        { id: 'rectangle', type: 'rectangle', layerId: 'geometry', x: 4.0045, y: 1.0045, width: 2, height: 2 },
    ];
    const midpoint = snapDrawingPoint({ x: 1.004, y: 0.004 }, content, 0.02);
    const corner = snapDrawingPoint({ x: 4.004, y: 1.004 }, content, 0.02);
    assert.equal(midpoint.type, 'midpoint');
    assert.ok(Math.abs(midpoint.x - 1.0045) < 1e-12);
    assert.ok(Math.abs(midpoint.y - 0.0045) < 1e-12);
    assert.equal(corner.type, 'endpoint');
    assert.deepEqual({ x: corner.x, y: corner.y }, { x: 4.0045, y: 1.0045 });
});

test('nearest object snap follows any point of a segment or circle', () => {
    const content = createDefaultDrawingContent();
    Object.keys(content.settings.snaps).forEach(key => { content.settings.snaps[key] = false; });
    content.settings.snaps.nearest = true;
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 20, cy: 0, r: 2 },
    ];
    const line = snapDrawingPoint({ x: 4.25, y: 0.04 }, content, 0.1);
    const circle = snapDrawingPoint({ x: 21.45, y: 1.45 }, content, 0.2);
    assert.equal(line.type, 'nearest');
    assert.deepEqual({ x: line.x, y: line.y, entityId: line.entityId }, { x: 4.25, y: 0, entityId: 'line' });
    assert.equal(circle.type, 'nearest');
    assert.ok(Math.abs(Math.hypot(circle.x - 20, circle.y) - 2) < 1e-12);
});

test('tracking guides combine acquired points, orthogonal axes and source angles with object intersections', () => {
    const content = createDefaultDrawingContent();
    content.settings.tracking = true;
    Object.keys(content.settings.snaps).forEach(key => { content.settings.snaps[key] = false; });
    content.settings.snaps.nearest = true;
    content.entities = [
        { id: 'top', type: 'line', layerId: 'geometry', x1: -2, y1: 5, x2: 8, y2: 5 },
        { id: 'vertical', type: 'line', layerId: 'geometry', x1: 10, y1: -2, x2: 10, y2: 12 },
    ];
    const middleAnchor = createTrackingAnchor({ x: 2, y: 0, type: 'midpoint', guideAngles: [0] });
    const orthogonal = resolveDrawingSnap({ x: 2.03, y: 5.02 }, content, 0.1, { trackingAnchor: middleAnchor });
    assert.equal(orthogonal.type, 'trackingIntersection');
    assert.ok(Math.abs(orthogonal.x - 2) < 1e-12 && Math.abs(orthogonal.y - 5) < 1e-12);

    const angledAnchor = createTrackingAnchor({ x: 0, y: 0, type: 'endpoint', guideAngles: [Math.PI / 4] });
    const angled = resolveDrawingSnap({ x: 10.02, y: 9.98 }, content, 0.1, { trackingAnchor: angledAnchor });
    assert.equal(angled.type, 'trackingIntersection');
    assert.ok(Math.abs(angled.x - 10) < 1e-12 && Math.abs(angled.y - 10) < 1e-12);
    assert.deepEqual(constrainOrthogonalPoint({ x: 1, y: 1 }, { x: 4, y: 2 }), { x: 4, y: 1, type: 'orthogonal' });
});

test('multiple helper guides intersect and remain compatible with Shift orthogonality', () => {
    const content = createDefaultDrawingContent();
    content.settings.tracking = true;
    Object.keys(content.settings.snaps).forEach(key => { content.settings.snaps[key] = false; });
    const verticalAnchor = createTrackingAnchor({ x: 2, y: 0, type: 'midpoint' });
    const horizontalAnchor = createTrackingAnchor({ x: 0, y: 5, type: 'endpoint' });
    const anchors = addTrackingAnchor(addTrackingAnchor([], verticalAnchor), horizontalAnchor);
    const intersection = resolveDrawingSnap({ x: 2.02, y: 5.01 }, content, 0.1, { trackingAnchors: anchors });
    assert.equal(intersection.type, 'trackingIntersection');
    assert.ok(Math.abs(intersection.x - 2) < 1e-12 && Math.abs(intersection.y - 5) < 1e-12);
    assert.equal(intersection.guides.length, 2);

    const diagonalAnchor = createTrackingAnchor({ x: 5, y: 5, type: 'endpoint', guideAngles: [Math.PI / 4] });
    const shifted = resolveDrawingSnap({ x: 2.02, y: 2.01 }, content, 0.1, {
        trackingAnchors: [diagonalAnchor],
        orthogonalOrigin: { x: 0, y: 2 },
        forceOrthogonal: true,
    });
    assert.equal(shifted.type, 'trackingIntersection');
    assert.ok(Math.abs(shifted.x - 2) < 1e-12 && Math.abs(shifted.y - 2) < 1e-12);
});

test('native SVG text layout keeps top-aligned text inside its clipping rectangle', () => {
    const layout = getDrawingTextLayout({
        type: 'text', x: 0, y: 10, width: 20, height: 5, text: 'Hello world !',
        fontSize: 0.86, horizontalAlign: 'left', verticalAlign: 'top',
    });
    assert.ok(layout.blockTop > layout.y);
    assert.equal(layout.firstBaseline, layout.blockTop + layout.fontSize);
    assert.ok(layout.blockTop + layout.lineHeight < layout.y + layout.height);
    assert.deepEqual(layout.lines, ['Hello world !']);
});

test('trim scope ignores every unselected target and cutting boundary', () => {
    const content = createDefaultDrawingContent();
    const target = { id: 'target', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 10, y2: 0 };
    const selectedBoundary = { id: 'selected-boundary', type: 'line', layerId: 'geometry', x1: 3, y1: -1, x2: 3, y2: 1 };
    const ignoredBoundary = { id: 'ignored-boundary', type: 'line', layerId: 'geometry', x1: 7, y1: -1, x2: 7, y2: 1 };
    const ignoredTarget = { id: 'ignored-target', type: 'line', layerId: 'geometry', x1: 0, y1: 2, x2: 10, y2: 2 };
    content.entities = [target, selectedBoundary, ignoredBoundary, ignoredTarget];
    const clickResult = trimDrawingTarget(content, target, { x: 5, y: 0 }, { boundaryIds: ['target', 'selected-boundary'] });
    assert.equal(clickResult.replacements.length, 1);
    assert.equal(clickResult.replacements[0].x2, 3);
    const fenceResult = trimDrawingFence(content, { first: { x: 5, y: -1 }, second: { x: 5, y: 3 } }, { scopeIds: ['target'] });
    assert.deepEqual(fenceResult.affectedIds, ['target']);
    assert.equal(fenceResult.content.entities.some(entity => entity.id === 'ignored-target'), true);
});

test('snap fallback preserves coordinates inherited from a DOM-like point', () => {
    const content = createDefaultDrawingContent();
    Object.keys(content.settings.snaps).forEach(key => {
        content.settings.snaps[key] = false;
    });
    const point = Object.create({ x: 1.25, y: 2.5 });
    assert.deepEqual(snapDrawingPoint(point, content, 0.1), {
        x: 1.25,
        y: 2.5,
        type: null,
        distance: Infinity,
    });
});

test('adaptive grid keeps nice multiples aligned with a fine base step', () => {
    const zoomedOut = getAdaptiveGridSpacing(0.001, 0.001, 20);
    const zoomedIn = getAdaptiveGridSpacing(0.001, 0.00008, 20);
    assert.equal(zoomedOut.multiplier, 20);
    assert.equal(zoomedOut.minorSpacing, 0.02);
    assert.equal(zoomedOut.majorSpacing, 0.1);
    assert.equal(zoomedIn.multiplier, 2);
    assert.equal(zoomedIn.minorSpacing / zoomedIn.baseSpacing, 2);
});

test('screen scale reports the exact CSS ratio and converts an entered ratio back to world units', () => {
    assert.equal(getScreenScaleRatio(0.026458333333333334), 100);
    assert.equal(getScreenScaleRatio(getWorldUnitsPerPixelForScaleRatio(50)), 50);
    assert.ok(Math.abs(getScreenScaleRatio(0.02576) - 97.36062992125984) < 1e-12);
    assert.equal(getScreenScaleRatio(null), null);
});

test('client coordinates account for SVG meet letterboxing', () => {
    const point = clientPointToViewBox(
        { clientX: 600, clientY: 300 },
        { left: 100, top: 50, width: 1000, height: 500 },
        { x: 0, y: 0, width: 100, height: 100 },
    );
    assert.deepEqual(point, { x: 50, y: 50 });
});

test('canvas resize preserves scale and matches the SVG aspect ratio', () => {
    const resized = resizeViewBoxForCanvas(
        { x: 0, y: 0, width: 100, height: 50 },
        { width: 1000, height: 500 },
        { width: 800, height: 800 },
    );
    assert.deepEqual(resized, { x: 10, y: -15, width: 80, height: 80 });
});

test('locked reference images stay selectable but cannot be transformed or deleted', () => {
    const content = createDefaultDrawingContent();
    const image = {
        id: 'reference', type: 'image', layerId: 'references', x: 1, y: 2, width: 3, height: 4, locked: true,
    };
    content.entities = [image];
    assert.equal(canSelectEntity(content, image), true);
    assert.equal(canEditEntity(content, image), false);
    assert.deepEqual(updateSelectedEntities(content, ['reference'], entity => ({ ...entity, x: 9 })).entities, [image]);
    assert.deepEqual(deleteSelectedEntities(content, ['reference']).entities, [image]);
});

test('selection windows use crossing left-to-right and containment right-to-left', () => {
    const crossing = createSelectionWindow({ x: -1, y: -1 }, { x: 11, y: 6 });
    const containment = createSelectionWindow({ x: 1, y: 1 }, { x: 0, y: 0 });
    assert.equal(containment.mode, 'window');
    assert.equal(crossing.mode, 'crossing');

    assert.equal(entityMatchesSelectionWindow(
        { type: 'rectangle', x: 10, y: 5, width: -10, height: -5 },
        crossing,
    ), true);
    assert.equal(entityMatchesSelectionWindow(
        { type: 'line', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 },
        containment,
    ), true);

    const diagonalWithOverlappingBounds = { type: 'line', x1: 0, y1: 3, x2: 3, y2: 0 };
    const smallCrossing = createSelectionWindow({ x: 0, y: 0 }, { x: 1, y: 1 });
    assert.equal(entityMatchesSelectionWindow(diagonalWithOverlappingBounds, smallCrossing), false);
    assert.equal(entityMatchesSelectionWindow(
        { type: 'line', x1: -1, y1: 0.5, x2: 2, y2: 0.5 },
        smallCrossing,
    ), true);
});

test('crossing selection handles circle tangency and rectangular image overlap precisely', () => {
    const tangentWindow = createSelectionWindow({ x: 5, y: -1 }, { x: 7, y: 1 });
    const insideCircleWindow = createSelectionWindow({ x: -1, y: -1 }, { x: 1, y: 1 });
    const circle = { type: 'circle', cx: 0, cy: 0, r: 5 };
    assert.equal(entityMatchesSelectionWindow(circle, tangentWindow), true);
    assert.equal(entityMatchesSelectionWindow(circle, insideCircleWindow), false);

    const image = { type: 'image', x: 4, y: 4, width: -3, height: -3 };
    assert.equal(entityMatchesSelectionWindow(image, createSelectionWindow({ x: 2, y: 2 }, { x: 3, y: 3 })), true);
    assert.equal(entityMatchesSelectionWindow(image, createSelectionWindow({ x: 7, y: 7 }, { x: 8, y: 8 })), false);
});

test('selection operations add uniquely and Shift-style removal only removes candidates', () => {
    assert.deepEqual(applySelectionOperation(['a', 'b'], ['b', 'c', 'c'], 'add'), ['a', 'b', 'c']);
    assert.deepEqual(applySelectionOperation(['a', 'b', 'c'], ['b', 'missing'], 'remove'), ['a', 'c']);
});

test('entity grips edit line ends, rectangle corners, and circle centers or radii', () => {
    const line = { id: 'line', type: 'line', x1: 1, y1: 2, x2: 3, y2: 4 };
    assert.deepEqual(getEntityGrips(line), [
        { id: 'start', x: 1, y: 2 },
        { id: 'end', x: 3, y: 4 },
    ]);
    assert.deepEqual(editEntityGrip(line, 'end', { x: 8, y: 9 }), { ...line, x2: 8, y2: 9 });

    const negativeRectangle = { id: 'rectangle', type: 'rectangle', x: 10, y: 5, width: -10, height: -5 };
    assert.deepEqual(getEntityGrips(negativeRectangle), [
        { id: 'top-left', x: 0, y: 0 },
        { id: 'top-right', x: 10, y: 0 },
        { id: 'bottom-right', x: 10, y: 5 },
        { id: 'bottom-left', x: 0, y: 5 },
    ]);
    assert.deepEqual(editEntityGrip(negativeRectangle, 'top-left', { x: -2, y: -3 }), {
        ...negativeRectangle, x: -2, y: -3, width: 12, height: 8,
    });
    assert.deepEqual(editEntityGrip(negativeRectangle, 'bottom-right', { x: -2, y: -3 }), {
        ...negativeRectangle, x: -2, y: -3, width: 2, height: 3,
    });

    const circle = { id: 'circle', type: 'circle', cx: 1, cy: 2, r: 3 };
    assert.deepEqual(getEntityGrips(circle), [
        { id: 'center', x: 1, y: 2 },
        { id: 'radius', x: 4, y: 2 },
    ]);
    assert.deepEqual(editEntityGrip(circle, 'center', { x: 4, y: 5 }), { ...circle, cx: 4, cy: 5 });
    assert.deepEqual(editEntityGrip(circle, 'radius', { x: 1, y: 6 }), { ...circle, r: 4 });

    const rotated = { id: 'text', type: 'text', x: 0, y: 0, width: 4, height: 2, rotation: 90 };
    const rotatedGrips = getEntityGrips(rotated);
    assert.equal(rotatedGrips.length, 4);
    const edited = editEntityGrip(rotated, 'top-left', { x: 3, y: -1 });
    assert.equal(edited.rotation, 90);
    assert.ok(edited.width > 0 && edited.height > 0);
});

test('dimension grip changes its distance while keeping the measured source associative', () => {
    const source = { id: 'source', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 };
    const dimension = { id: 'dimension', type: 'linearDimension', sourceId: 'source', offset: 1 };
    assert.deepEqual(getEntityGrips(dimension, source), [{ id: 'dimension-position', x: 5, y: 1 }]);
    const moved = editEntityGrip(dimension, 'dimension-position', { x: 5, y: 3 }, source);
    assert.equal(moved.offset, 3);
    assert.equal(getDimensionGeometry(moved, source).value, 10);

    const circle = { type: 'circle', cx: 0, cy: 0, r: 2 };
    const radial = editEntityGrip(
        { type: 'radialDimension', angle: 0, leaderScale: 1.45 },
        'dimension-position',
        { x: 0, y: 4 },
        circle,
    );
    assert.ok(Math.abs(radial.angle - Math.PI / 2) < 1e-12);
    assert.equal(radial.leaderScale, 2);
});

test('Shift constrains a line grip to its original angle while allowing extension and reduction', () => {
    const line = { type: 'line', x1: 1, y1: 1, x2: 4, y2: 5 };
    const extended = constrainLineGripPoint(line, 'end', { x: 10, y: 8 });
    const cross = (line.x2 - line.x1) * (extended.y - line.y1) - (line.y2 - line.y1) * (extended.x - line.x1);
    assert.ok(Math.abs(cross) < 1e-12);
    const reduced = constrainLineGripPoint(line, 'end', { x: 2.2, y: 2.4 });
    assert.ok(pointDistanceForTest(reduced, { x: 1, y: 1 }) < pointDistanceForTest({ x: 4, y: 5 }, { x: 1, y: 1 }));
});

test('system layers are restored to short immutable names and cannot be removed', () => {
    const legacy = createDefaultDrawingContent();
    legacy.layers[0] = { ...legacy.layers[0], name: 'DESSIN' };
    legacy.layers[1] = { ...legacy.layers[1], name: 'COTATIONS' };
    legacy.layers[2] = { ...legacy.layers[2], name: 'RÉFÉRENCES' };
    const normalized = normalizeDrawingContent(legacy);
    assert.deepEqual(normalized.layers.map(layer => layer.name), ['0', 'DIM', 'REF']);
    assert.equal(updateLayer(normalized, 'geometry', { name: 'TOITURE' }).layers[0].name, '0');
    assert.equal(updateLayer(normalized, 'dimensions', { name: 'MESURES' }).layers[1].name, 'DIM');
    assert.equal(updateLayer(normalized, 'references', { name: 'FONDS' }).layers[2].name, 'REF');
    assert.deepEqual(removeEmptyLayer(normalized, 'geometry').layers, normalized.layers);
    assert.deepEqual(removeEmptyLayer(normalized, 'dimensions').layers, normalized.layers);
    assert.deepEqual(removeEmptyLayer(normalized, 'references').layers, normalized.layers);
});

test('entity appearance inherits layer properties unless an object overrides them', () => {
    const content = createDefaultDrawingContent();
    content.layers[0] = {
        ...content.layers[0],
        color: '#123456',
        lineWeight: 5,
        lineType: 'dashed',
        transparency: 35,
    };
    const inherited = { id: 'by-layer', type: 'line', layerId: 'geometry' };
    assert.deepEqual(getEntityAppearance(content, inherited), {
        color: '#123456',
        lineWeight: 5,
        lineType: 'dashed',
        transparency: 35,
    });
    assert.deepEqual(getEntityAppearance(content, {
        ...inherited,
        color: '#abcdef',
        lineWeight: 1.5,
        lineType: 'dotted',
        transparency: 0,
    }), {
        color: '#abcdef',
        lineWeight: 1.5,
        lineType: 'dotted',
        transparency: 0,
    });
});

test('invalid custom appearance values normalize back to ByLayer', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{
        id: 'line',
        type: 'line',
        layerId: 'geometry',
        color: 'orange',
        lineWeight: 4,
        lineType: 'zigzag',
        transparency: 100,
    }];
    const [entity] = normalizeDrawingContent(content).entities;
    assert.equal(Object.hasOwn(entity, 'color'), false);
    assert.equal(Object.hasOwn(entity, 'lineWeight'), false);
    assert.equal(Object.hasOwn(entity, 'lineType'), false);
    assert.equal(Object.hasOwn(entity, 'transparency'), false);
});

test('valid zero and maximum transparency overrides survive document normalization', () => {
    const content = createDefaultDrawingContent();
    content.layers[0] = { ...content.layers[0], transparency: 90 };
    content.entities = [
        { id: 'opaque', type: 'line', layerId: 'geometry', transparency: 0 },
        { id: 'transparent', type: 'circle', layerId: 'geometry', transparency: 90 },
    ];
    const normalized = normalizeDrawingContent(content);
    assert.equal(normalized.layers[0].transparency, 90);
    assert.equal(normalized.entities[0].transparency, 0);
    assert.equal(normalized.entities[1].transparency, 90);
});

function pointDistanceForTest(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}
