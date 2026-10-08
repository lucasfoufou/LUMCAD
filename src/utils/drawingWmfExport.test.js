import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { exportDrawingWmf } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { readDrawingWmfRecords } from './drawingWmfRecords.js';

function drawing(entities) {
    const content = createDefaultDrawingContent();
    content.entities = entities.map((entity, i) => ({ id: `e${i}`, layerId: content.activeLayerId, ...entity }));
    return content;
}

test('WMF export retains physical lengths, layer appearance and detached source coordinates', () => {
    const source = drawing([{ type: 'line', x1: 100, y1: -20, x2: 104, y2: -17, color: '#123456', lineWeight: 2 }]);
    const before = structuredClone(source); const result = exportDrawingWmf(source);
    assert.deepEqual(source, before);
    assert.ok(result.report.origin.x < 100 && result.report.origin.y < -20);
    const decoded = readDrawingWmfGraphics(result.bytes).primitives[0];
    assert.equal(decoded.stroke.color, '#123456');
    assert.ok(Math.abs(decoded.points[0].x + result.report.origin.x - 100) <= result.report.coordinateStep);
    assert.ok(Math.abs(decoded.points[0].y + result.report.origin.y + 20) <= result.report.coordinateStep);
    assert.ok(Math.abs(decoded.points.at(-1).x + result.report.origin.x - 104) <= result.report.coordinateStep);
    assert.ok(Math.abs(decoded.points.at(-1).y + result.report.origin.y + 17) <= result.report.coordinateStep);
    assert.equal(result.report.exported, 1);
});

test('WMF file extents include whole strokes instead of placing endpoint pixels on exclusive edges', () => {
    const result = exportDrawingWmf(drawing([{ type: 'line', x1: 0, y1: 0, x2: 4, y2: 3, lineWidth: 100 }]));
    const { placeable } = readDrawingWmfRecords(result.bytes);
    const [line] = readDrawingWmfGraphics(result.bytes).primitives;
    const unit = result.report.coordinateStep; const halfWidth = line.stroke.width / 2;
    for (const point of line.points) {
        assert.ok(point.x - halfWidth > placeable.left * unit);
        assert.ok(point.y - halfWidth > placeable.top * unit);
        assert.ok(point.x + halfWidth < placeable.right * unit);
        assert.ok(point.y + halfWidth < placeable.bottom * unit);
    }
});

test('WMF export reuses freed pen slots across independent objects and preserves circular curves natively', () => {
    const source = drawing([{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }, { type: 'circle', cx: 2, cy: 2, r: 1, color: '#ff0000' }]);
    const result = exportDrawingWmf(source);
    const file = readDrawingWmfRecords(result.bytes);
    assert.equal(file.header.objects, 2);
    assert.equal(readDrawingWmfGraphics(result.bytes).primitives.length, 2);
    assert.equal(result.report.warnings.includes('curvesSampled'), false);
    assert.equal(readDrawingWmfGraphics(result.bytes).primitives[1].kind, 'ellipse');
});

test('WMF export rejects unsupported visible objects and transparency rather than dropping content', () => {
    assert.throws(() => exportDrawingWmf(drawing([{ type: 'image', assetId: 'not-yet-supported' }])), /wmfExportUnsupported/);
    assert.throws(() => exportDrawingWmf(drawing([{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1, transparency: 50 }])), /wmfExportTransparency/);
    const source = drawing([{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }]);
    assert.throws(() => exportDrawingWmf(source, { maxPoints: 1 }), /wmfLimit/);
    assert.throws(() => exportDrawingWmf(source, { maxBytes: 50 }), /wmfLimit/);
    assert.throws(() => exportDrawingWmf(drawing([])), /wmfEmpty/);
});

test('WMF solid fills preserve compound holes, fill rules and disabled boundary strokes', async () => {
    const { createDrawingHatch } = await import('./drawingHatches.js');
    const { drawingPolygonContainsPoint } = await import('./drawingBoundaryDetection.js');
    const outer = { type: 'rectangle', x: 0, y: 0, width: 10, height: 8 };
    const hole = { type: 'circle', cx: 3, cy: 3, r: 1 };
    const hatch = { ...createDrawingHatch([outer, hole], 'geometry', 'solid', 'hatch'), color: '#008844', boundaryStroke: false };
    const source = drawing([hatch]); const snapshot = structuredClone(source);
    const result = exportDrawingWmf(source);
    const primitive = readDrawingWmfGraphics(result.bytes).primitives[0];
    assert.equal(primitive.kind, 'polypolygon'); assert.equal(primitive.fill, '#008844');
    assert.equal(primitive.stroke, null); assert.equal(primitive.fillRule, 'evenodd');
    assert.equal(primitive.contourLengths.length, 2);
    const split = primitive.contourLengths[0];
    const contours = [primitive.points.slice(0, split), primitive.points.slice(split)];
    const filled = point => contours.filter(contour => drawingPolygonContainsPoint(contour, point)).length % 2 === 1;
    assert.equal(filled({ x: 1, y: 1 }), true); assert.equal(filled({ x: 3, y: 3 }), false);
    assert.equal(filled({ x: 11, y: 1 }), false);
    assert.deepEqual(source, snapshot);
    source.entities[0].fillRule = 'nonzero'; source.entities[0].boundaryStroke = true;
    const winding = readDrawingWmfGraphics(exportDrawingWmf(source).bytes).primitives[0];
    assert.equal(winding.fillRule, 'nonzero'); assert.equal(winding.stroke.color, '#008844');
});

test('WMF gradient hatch exports are refused until gradient rendering is implemented', async () => {
    const { createDrawingHatch } = await import('./drawingHatches.js');
    const entity = createDrawingHatch([{ type: 'rectangle', x: 0, y: 0, width: 2, height: 2 }], 'geometry', { name: 'gradient' }, 'h');
    assert.throws(() => exportDrawingWmf(drawing([entity])), /wmfExportUnsupported/);
});

test('WMF cross-hatch exports retain spacing and exclude hole interiors', async () => {
    const { createDrawingHatch } = await import('./drawingHatches.js');
    const hatch = createDrawingHatch([{ type: 'rectangle', x: 0, y: 0, width: 4, height: 4 },
        { type: 'rectangle', x: 1, y: 1, width: 2, height: 2 }], 'geometry',
    { name: 'cross', spacing: 1, origin: { x: .5, y: .5 } }, 'h');
    hatch.boundaryStroke = false;
    const result = exportDrawingWmf(drawing([hatch]));
    const primitives = readDrawingWmfGraphics(result.bytes).primitives;
    assert.equal(primitives.length, 12);
    for (const primitive of primitives) {
        assert.equal(primitive.stroke.endCap, 'flat');
        const [a, b] = primitive.points;
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        assert.equal(middle.x > 1.01 && middle.x < 2.99 && middle.y > 1.01 && middle.y < 2.99, false);
    }
    assert.ok(result.report.warnings.includes('patternEdgeApproximation'));
});

test('WMF native circular and axis-aligned elliptical arcs preserve both sweep directions', async () => {
    const { curvePointAt } = await import('./drawingCurveKernel.js');
    for (const type of ['arc', 'ellipse']) for (const rotation of [0, 90, 270]) for (const counterClockwise of [true, false]) {
        const entity = { type, cx: 4, cy: -3, r: 2, rx: 3, ry: 1, rotation,
            startAngle: .2, endAngle: 4.3, counterClockwise, fullEllipse: false };
        const result = exportDrawingWmf(drawing([entity]));
        const primitive = readDrawingWmfGraphics(result.bytes).primitives[0];
        assert.equal(primitive.kind, 'ellipseArc'); assert.equal(result.report.warnings.includes('curvesSampled'), false);
        const [a, b] = primitive.points;
        const restored = { type: 'ellipse', cx: (a.x + b.x) / 2 + result.report.origin.x,
            cy: (a.y + b.y) / 2 + result.report.origin.y, rx: (b.x - a.x) / 2, ry: (b.y - a.y) / 2,
            startAngle: primitive.startAngle, endAngle: primitive.endAngle, counterClockwise: primitive.counterClockwise, fullEllipse: false };
        for (const t of [0, .25, .5, .75, 1]) {
            const expected = curvePointAt(entity, t); const actual = curvePointAt(restored, counterClockwise ? 1 - t : t);
            assert.ok(Math.hypot(expected.x - actual.x, expected.y - actual.y) < result.report.coordinateStep * 8, `${type}/${rotation}/${counterClockwise}/${t}`);
        }
    }
});

test('WMF full ellipses retain swapped axes while oblique ellipses report sampling', () => {
    const ellipse = { type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 1, rotation: 90, fullEllipse: true };
    const result = exportDrawingWmf(drawing([ellipse]));
    const primitive = readDrawingWmfGraphics(result.bytes).primitives[0];
    assert.equal(primitive.kind, 'ellipse');
    assert.ok(Math.abs(primitive.points[1].x - primitive.points[0].x - 2) < result.report.coordinateStep);
    assert.ok(Math.abs(primitive.points[1].y - primitive.points[0].y - 6) < result.report.coordinateStep);
    assert.ok(exportDrawingWmf(drawing([{ ...ellipse, rotation: 30 }])).report.warnings.includes('curvesSampled'));
});

test('WMF rejects arcs whose radial points collapse at output precision instead of exporting a full ellipse', () => {
    const tinySweep = { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: 1e-8, counterClockwise: false };
    assert.throws(() => exportDrawingWmf(drawing([tinySweep])), /wmfPlacement/);
});
