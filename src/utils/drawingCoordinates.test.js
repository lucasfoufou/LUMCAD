import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingUcsToWorld, drawingWorldToUcs, resolveDrawingUcsInput, normalizeDrawingUnits, formatDrawingDistance, formatDrawingAngle, drawingPointWithinLimits } from './drawingCoordinates.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { resolveDrawingSnap, constrainOrthogonalPoint } from './drawingTracking.js';
import { snapDrawingPoint } from './drawingGeometry.js';

const ucs = { x: 10, y: 20, rotation: 90 };
const near = (actual, expected) => { assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8, JSON.stringify(actual)); };

test('UCS point entry converts absolute, relative, polar and direct-distance inputs exactly once', () => {
    near(drawingWorldToUcs(drawingUcsToWorld({ x: 3, y: 4 }, ucs), ucs), { x: 3, y: 4 });
    near(resolveDrawingUcsInput('2,3', {}, { ucs }).point, { x: 7, y: 22 });
    const options = { referencePoint: { x: 10, y: 20 }, directionPoint: { x: 10, y: 25 } };
    near(resolveDrawingUcsInput('@2,3', options, { ucs }).point, { x: 7, y: 22 });
    near(resolveDrawingUcsInput('@2<0', options, { ucs }).point, { x: 10, y: 22 });
    near(resolveDrawingUcsInput('2', options, { ucs }).point, { x: 10, y: 22 });
    near(resolveDrawingUcsInput('@2<90', options, { ucs, units: { clockwise: true } }).point, { x: 12, y: 20 });
    near(resolveDrawingUcsInput('@2<0', options, { ucs, units: { angleBase: 90 } }).point, { x: 8, y: 20 });
    near(resolveDrawingUcsInput('200cm,3m', {}, { ucs }).point, { x: 7, y: 22 });
});

test('rotated UCS drives grid, orthogonal axes and polar tracking without moving source geometry', () => {
    const content = createDefaultDrawingContent();
    content.settings.ucs = { x: 10, y: 20, rotation: 45 };
    content.settings.gridSpacing = 1;
    const gridPoint = drawingUcsToWorld({ x: 2, y: 3 }, content.settings.ucs);
    near(snapDrawingPoint({ x: gridPoint.x + 0.01, y: gridPoint.y }, content, 0.1), gridPoint);
    near(constrainOrthogonalPoint({ x: 0, y: 0 }, { x: 3, y: 4 }, 45), { x: 3.5, y: 3.5 });
    content.settings.ortho = true;
    const snapped = resolveDrawingSnap({ x: 3, y: 4 }, content, 0.05, { orthogonalOrigin: { x: 0, y: 0 }, forceOrthogonal: true });
    near(snapped, { x: 3.5, y: 3.5 });
    const polar = resolveDrawingSnap({ x: 3, y: 3.01 }, content, 0.05, { orthogonalOrigin: { x: 0, y: 0 } });
    near(polar, { x: 3.005, y: 3.005 });
});

test('display settings format lengths, alternate units and measured angles without rescaling geometry', () => {
    const settings = { units: { display: 'mm', alternate: 'm', precision: 2, angle: 'gradians', anglePrecision: 2, angleBase: 45 } };
    assert.equal(formatDrawingDistance(1.234, settings), '1,234 mm [1.23 m]');
    assert.equal(formatDrawingAngle(90, settings), '100 gon');
    assert.equal(normalizeDrawingUnits({ precision: 100 }).precision, 3);
    assert.equal(drawingPointWithinLimits({ x: 5, y: 5 }, { limits: { minX: 0, minY: 0, maxX: 4, maxY: 4, enabled: true } }), false);
    const content = createDefaultDrawingContent();
    content.settings = { ...content.settings, ...settings, ucs };
    content.namedUcs = [{ name: 'Roof', ...ucs }, { name: 'roof' }];
    const normalized = normalizeDrawingContent(content);
    assert.equal(normalized.unit, 'm');
    assert.equal(normalized.namedUcs.length, 1);
    assert.deepEqual(normalized.settings.ucs, ucs);
});

test('units, named UCS and limits round-trip through the portable archive', async () => {
    const { createLcadDocument, createLcadEnvelope } = await import('./lcadDocument.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const document = createLcadDocument();
    document.content.settings = { ...document.content.settings, units: normalizeDrawingUnits({ display: 'ft', insertion: 'mm' }), ucs, limits: { minX: 0, minY: 0, maxX: 100, maxY: 100, enabled: true } };
    document.content.namedUcs = [{ name: 'Roof', ...ucs }];
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.settings.units, document.content.settings.units);
    assert.deepEqual(loaded.content.settings.ucs, ucs);
    assert.deepEqual(loaded.content.settings.limits, document.content.settings.limits);
    assert.deepEqual(loaded.content.namedUcs, document.content.namedUcs);
});
