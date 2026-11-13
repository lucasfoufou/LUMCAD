import test from 'node:test';
import assert from 'node:assert/strict';
import {
    drawingEntryDirectionToWorld, drawingEntryPointToWorld, drawingEntryVectorToWorld, drawingLimitsFromUser, drawingLimitsToUser,
    drawingPolarMeasure, drawingUcsFromUser, drawingUcsToUser, drawingUcsToWorld, drawingUserDirectionToWorld, drawingUserFrame,
    drawingUserRotationToWorld, drawingUserSettings, drawingUserToWorld, drawingUserVectorToWorld, drawingWorldDirectionForDisplay,
    drawingWorldDirectionToUser, drawingWorldPointForDisplay, drawingWorldRotationToUser, drawingWorldToUcs, drawingWorldToUser,
    drawingWorldVectorForDisplay, drawingWorldVectorToUser, resolveDrawingUcsInput, setDrawingDisplayYAxisUp,
} from './drawingCoordinates.js';
import { formatDrawingCursorPosition } from './drawingCursorPosition.js';
import { describeDrawingLine, resizeDrawingLine, describeDrawingBlockTransform } from './drawingEntityProperties.js';
import { storedDrawingCreationConfig, applyDrawingCreationMode, parseDrawingCreationInput } from './drawingCreation.js';
import { formatDrawingDimensionLabel, getDimensionGeometry } from './drawingDimensions.js';

const near = (actual, expected, message) => {
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-9, `${message || ''} ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
};
const nearValue = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const up = settings => drawingUserSettings(settings, true);
const down = settings => drawingUserSettings(settings, false);
const rotatedUcs = { ucs: { x: 10, y: -20, rotation: 330 } }; // user: origin (10;20), rotated 30° counter-clockwise

test('Y up flips the stored screen-down Y once, around the UCS origin', () => {
    near(drawingWorldToUser({ x: 2, y: -3 }, up({})), { x: 2, y: 3 });
    near(drawingUserToWorld({ x: 2, y: 3 }, up({})), { x: 2, y: -3 });
    assert.ok(Object.is(drawingWorldToUser({ x: 1, y: 0 }, up({})).y, 0), 'Y = 0 never reads as -0');
    assert.ok(Object.is(drawingUserToWorld({ x: 1, y: 0 }, up({})).y, 0));
    near(drawingWorldToUser({ x: 12, y: -25 }, up({ ucs: { x: 10, y: -20, rotation: 0 } })), { x: 2, y: 5 });
    for (const settings of [up({}), up(rotatedUcs), down(rotatedUcs), up({ ucs: { x: -3, y: 4, rotation: 123 } })]) {
        for (const point of [{ x: 0, y: 0 }, { x: 3.5, y: -7 }, { x: -1e3, y: 42 }]) {
            near(drawingUserToWorld(drawingWorldToUser(point, settings), settings), point, 'round trip');
            near(drawingWorldToUser(drawingUserToWorld(point, settings), settings), point, 'inverse round trip');
        }
    }
});

test('a UCS keeps its geometric meaning; its user rotation is counter-clockwise with Y up', () => {
    // Stored rotation 330° turns the X axis 30° counter-clockwise on screen.
    const xAxis = drawingUserVectorToWorld({ x: 1, y: 0 }, up(rotatedUcs));
    near(xAxis, { x: Math.cos(Math.PI / 6), y: -Math.sin(Math.PI / 6) });
    const yAxis = drawingUserVectorToWorld({ x: 0, y: 1 }, up(rotatedUcs));
    near(yAxis, { x: -Math.sin(Math.PI / 6), y: -Math.cos(Math.PI / 6) }, 'user Y points up the screen');
    assert.deepEqual(drawingUcsToUser(rotatedUcs.ucs, true), { x: 10, y: 20, rotation: 30 });
    assert.deepEqual(drawingUcsFromUser({ x: 10, y: 20, rotation: 30 }, true), rotatedUcs.ucs);
    assert.deepEqual(drawingUcsToUser(rotatedUcs.ucs, false), rotatedUcs.ucs);
    assert.deepEqual(drawingUcsFromUser({ x: 1, y: 2, rotation: 0 }, true), { x: 1, y: -2, rotation: 0 });
});

test('preference off: the user frame is exactly the former UCS frame and entry helpers are the identity', () => {
    const settings = down(rotatedUcs);
    const point = { x: 3, y: -7 };
    assert.deepEqual(drawingWorldToUser(point, settings), drawingWorldToUcs(point, rotatedUcs.ucs));
    assert.deepEqual(drawingUserToWorld(point, settings), drawingUcsToWorld(point, rotatedUcs.ucs));
    assert.deepEqual(drawingUserFrame(settings), { ...rotatedUcs.ucs, yUp: false });
    for (const helper of [drawingEntryPointToWorld, drawingWorldPointForDisplay, drawingEntryVectorToWorld, drawingWorldVectorForDisplay]) {
        assert.equal(helper(point, settings), point);
    }
    assert.equal(drawingEntryDirectionToWorld(-30, settings), -30);
    assert.equal(drawingWorldDirectionForDisplay(-30, settings), -30);
    assert.equal(drawingUserRotationToWorld(30, settings), 30);
    assert.deepEqual(drawingLimitsFromUser({ minX: 0, minY: 1, maxX: 2, maxY: 3 }, false), { minX: 0, minY: 1, maxX: 2, maxY: 3 });
    // Typed input through the former UCS path is unchanged.
    const options = { referencePoint: { x: 10, y: 20 }, directionPoint: { x: 10, y: 25 } };
    for (const value of ['2;3', '@2;3', '@2<30', '2']) {
        assert.deepEqual(resolveDrawingUcsInput(value, options, settings), resolveDrawingUcsInput(value, options, rotatedUcs));
    }
});

test('typed absolute, relative, polar and direct-distance points use Y up', () => {
    const settings = up({});
    const options = { referencePoint: { x: 1, y: -1 }, directionPoint: { x: 1, y: -9 } };
    near(resolveDrawingUcsInput('2;3', options, settings).point, { x: 2, y: -3 });
    near(resolveDrawingUcsInput('@0;5', options, settings).point, { x: 1, y: -6 });
    near(resolveDrawingUcsInput('@4<90', options, settings).point, { x: 1, y: -5 });
    near(resolveDrawingUcsInput('@4<0', options, settings).point, { x: 5, y: -1 });
    // Direct distance follows the cursor direction (here up the screen), never inverted.
    near(resolveDrawingUcsInput('3', options, settings).point, { x: 1, y: -4 });
    // Drawing units: clockwise angles and a 90° base stay relative to the user frame.
    near(resolveDrawingUcsInput('@4<90', options, up({ units: { clockwise: true } })).point, { x: 1, y: 3 });
    near(resolveDrawingUcsInput('@4<0', options, up({ units: { angleBase: 90 } })).point, { x: 1, y: -5 });
    // Rotated UCS: @1<0 runs along the UCS X axis, 30° counter-clockwise on screen.
    near(resolveDrawingUcsInput('@2<0', { referencePoint: { x: 10, y: -20 } }, up(rotatedUcs)).point,
        { x: 10 + 2 * Math.cos(Math.PI / 6), y: -20 - 2 * Math.sin(Math.PI / 6) });
    near(resolveDrawingUcsInput('0;0', {}, up(rotatedUcs)).point, { x: 10, y: -20 });
});

test('the value shown while drawing is the value typed', () => {
    const settings = up({});
    const measure = drawingPolarMeasure({ x: 1, y: -1 }, { x: 1, y: -5 }, settings);
    nearValue(measure.distance, 4); nearValue(measure.angle, 90);
    nearValue(drawingPolarMeasure({ x: 0, y: 0 }, { x: 1, y: 1 }, settings).angle, 315);
    nearValue(drawingPolarMeasure({ x: 0, y: 0 }, { x: 1, y: 1 }, down({})).angle, 45);
    for (const typed of ['@3<30', '@2<200']) {
        const point = resolveDrawingUcsInput(typed, { referencePoint: { x: 0, y: 0 } }, up(rotatedUcs)).point;
        nearValue(drawingPolarMeasure({ x: 0, y: 0 }, point, up(rotatedUcs)).angle, Number(typed.split('<')[1]));
    }
});

test('rotations, directions and vectors convert between frames', () => {
    const settings = up({});
    assert.equal(drawingUserRotationToWorld(30, settings), -30);
    assert.equal(drawingWorldRotationToUser(-30, settings), 30);
    assert.equal(drawingUserRotationToWorld(0, settings), 0);
    nearValue(drawingUserDirectionToWorld(30, settings), 330);
    nearValue(drawingWorldDirectionToUser(330, settings), 30);
    nearValue(drawingUserDirectionToWorld(0, up(rotatedUcs)), 330);
    nearValue(drawingWorldDirectionToUser(drawingUserDirectionToWorld(75, up(rotatedUcs)), up(rotatedUcs)), 75);
    near(drawingWorldVectorToUser({ x: 3, y: -3 }, settings), { x: 3, y: 3 });
    near(drawingUserVectorToWorld({ x: 3, y: 3 }, settings), { x: 3, y: -3 });
    assert.deepEqual(drawingLimitsFromUser({ minX: 0, minY: 1, maxX: 2, maxY: 3, enabled: true }, true), { minX: 0, minY: -3, maxX: 2, maxY: -1, enabled: true });
    assert.ok(Object.is(drawingLimitsFromUser({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, true).maxY, 0), 'no negative zero is stored');
    assert.deepEqual(drawingLimitsToUser(drawingLimitsFromUser({ minX: 0, minY: 1, maxX: 2, maxY: 3 }, true), true), { minX: 0, minY: 1, maxX: 2, maxY: 3 });
});

test('cursor coordinates and Properties measures read Y up', () => {
    assert.equal(formatDrawingCursorPosition({ x: 2, y: -3 }, up({}), 'fr'), '2 m ; 3 m');
    assert.equal(formatDrawingCursorPosition({ x: 2, y: -3 }, down({}), 'en'), '2 m, -3 m');
    const line = { type: 'line', x1: 0, y1: 0, x2: 1, y2: -1 };
    nearValue(describeDrawingLine(line, drawingUserFrame(up({}))).angle, 45);
    nearValue(describeDrawingLine(line, drawingUserFrame(down({}))).angle, 315);
    const patch = resizeDrawingLine(line, { angle: 90 }, drawingUserFrame(up({})));
    near({ x: patch.x2, y: patch.y2 }, { x: 0, y: -Math.SQRT2 });
    // A block turned 30° counter-clockwise on screen is stored with b < 0.
    const transform = { a: Math.cos(Math.PI / 6), b: -Math.sin(Math.PI / 6), c: Math.sin(Math.PI / 6), d: Math.cos(Math.PI / 6), e: 0, f: 0 };
    nearValue(describeDrawingBlockTransform(transform, drawingUserFrame(up({}))).rotation, 30);
});

test('typed creation directions are mirrored only when Y is up', () => {
    const current = { mode: 'startCenterEnd', options: {} };
    const parsed = parseDrawingCreationInput('arc', 'CCW');
    const typed = applyDrawingCreationMode('arc', current, 'CCW');
    assert.equal(storedDrawingCreationConfig(typed, parsed, up({})).options.counterClockwise, false);
    assert.equal(storedDrawingCreationConfig(typed, parsed, down({})).options.counterClockwise, true);
    const rotation = applyDrawingCreationMode('rectangle', { mode: 'corners', options: {} }, 'ROTATION 30');
    nearValue(storedDrawingCreationConfig(rotation, parseDrawingCreationInput('rectangle', 'ROTATION 30'), up({})).options.rotation, 330);
    assert.equal(storedDrawingCreationConfig(rotation, parseDrawingCreationInput('rectangle', 'ROTATION 30'), down({})).options.rotation, 30);
});

test('a Y ordinate dimension label reads Y up only when the preference is on', () => {
    const dimension = { id: 'o', type: 'ordinateDimension', axis: 'y', origin: { x: 0, y: 0 }, featurePoint: { x: 2, y: -3 }, unit: 'm', precision: 2 };
    const geometry = getDimensionGeometry(dimension);
    try {
        setDrawingDisplayYAxisUp(false);
        assert.match(formatDrawingDimensionLabel(geometry, dimension).plainText, /^-3/);
        setDrawingDisplayYAxisUp(true);
        assert.match(formatDrawingDimensionLabel(geometry, dimension).plainText, /^3/);
        const xDimension = { ...dimension, axis: 'x' };
        assert.match(formatDrawingDimensionLabel(getDimensionGeometry(xDimension), xDimension).plainText, /^2/);
        assert.equal(geometry.value, -3, 'the measured geometry stays in the stored frame');
    } finally {
        setDrawingDisplayYAxisUp(false);
    }
});
