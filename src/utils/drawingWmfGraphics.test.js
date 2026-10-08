import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { importDrawingWmf } from './drawingWmfImport.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getEntityBounds } from './drawingGeometry.js';
import { curvePointAt } from './drawingCurveKernel.js';

// Binary fixtures are authored independently of the production reader/writer.
function wmf(records, objects = 4) {
    const entries = [...records, [0, []]];
    const words = 9 + entries.reduce((sum, [, params]) => sum + 3 + params.length, 0);
    const bytes = new Uint8Array(words * 2); const data = new DataView(bytes.buffer);
    data.setUint16(0, 1, true); data.setUint16(2, 9, true); data.setUint16(4, 0x300, true);
    data.setUint32(6, words, true); data.setUint16(10, objects, true);
    data.setUint32(12, Math.max(...entries.map(([, params]) => 3 + params.length)), true);
    let offset = 18;
    for (const [opcode, params] of entries) {
        data.setUint32(offset, 3 + params.length, true); data.setUint16(offset + 4, opcode, true);
        params.forEach((value, index) => data.setUint16(offset + 6 + index * 2, value, true));
        offset += 6 + params.length * 2;
    }
    return bytes;
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('WMF arcs use radial intersections, preserve reflected direction and do not move the pen', () => {
    const params = [0, 100, 50, 200, 100, 200, 0, 0];
    for (const mirror of [false, true]) {
        const prefix = mirror ? [[0x0103, [8]], [0x020e, [1, -1]]] : [];
        const result = readDrawingWmfGraphics(wmf([...prefix, [0x0817, params], [0x0213, [1, 1]]]));
        assert.equal(result.primitives[0].counterClockwise, mirror);
        assert.equal(result.primitives[0].fill, null);
        assert.deepEqual(result.primitives[1].points[0], { x: 0, y: 0 });
        const document = importDrawingWmf(createLcadDocument({ name: 'Arc' }), wmf([...prefix, [0x0817, params]]));
        const arc = document.content.entities[0];
        assert.equal(arc.type, 'ellipse'); assert.equal(arc.fullEllipse, false);
        const start = curvePointAt(arc, 0); const end = curvePointAt(arc, 1);
        near(start.x, (mirror ? -200 : 200) * .0254 / 96); near(start.y, 50 * .0254 / 96);
        near(end.x, (mirror ? -100 : 100) * .0254 / 96); near(end.y, 0);
    }
});

test('WMF chord and pie import closed elliptical fill boundaries and survive archives', () => {
    for (const [opcode, count] of [[0x0830, 2], [0x081a, 3]]) {
        const bytes = wmf([[opcode, [0, 100, 50, 200, 100, 200, 0, 0]]]);
        const imported = importDrawingWmf(createLcadDocument({ name: 'Sector' }), bytes);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        assert.deepEqual(loaded.content.entities.map(e => e.type), ['hatch', 'polyline']);
        const boundary = loaded.content.entities[0].boundaries[0];
        assert.equal(boundary.closed, true); assert.equal(boundary.parts.length, count);
        assert.equal(boundary.parts[0].type, 'ellipse');
    }
    const full = readDrawingWmfGraphics(wmf([[0x0817, [50, 200, 50, 200, 100, 200, 0, 0]]])).primitives[0];
    assert.equal(full.fullEllipse, true);
    assert.throws(() => readDrawingWmfGraphics(wmf([[0x0817, [50, 100, 50, 200, 100, 200, 0, 0]]])), /wmfInvalid/);
});

test('WMF rounded rectangles keep elliptical corners and clamp oversized radii without broken edges', () => {
    for (const [width, height, expectedParts] of [[40, 20, 8], [400, 200, 4]]) {
        const bytes = wmf([[0x061c, [height, width, 100, 200, 0, 0]]]);
        const imported = importDrawingWmf(createLcadDocument({ name: 'Rounded corners' }), bytes);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        const path = loaded.content.entities[0].boundaries[0];
        assert.equal(path.parts.length, expectedParts);
        const arcs = path.parts.filter(p => p.type === 'ellipse');
        assert.equal(arcs.length, 4);
        near(arcs[0].rx, Math.min(width / 2, 100) * .0254 / 96);
        near(arcs[0].ry, Math.min(height / 2, 50) * .0254 / 96);
        for (let i = 0; i < path.parts.length; i++) {
            const end = curvePointAt(path.parts[i], 1); const start = curvePointAt(path.parts[(i + 1) % path.parts.length], 0);
            near(end.x, start.x); near(end.y, start.y);
        }
    }
});

test('WMF native conversion keeps filled contours together, editable strokes and atomic placement', () => {
    const document = { content: createDefaultDrawingContent(), name: 'Unchanged source' };
    const before = structuredClone(document);
    const bytes = wmf([[0x0538, [2, 4, 4, 0, 0, 100, 0, 100, 100, 0, 100, 25, 25, 25, 75, 75, 75, 75, 25]],
        [0x0418, [20, 30, 0, 0]], [0x0213, [10, 20]]]);
    const result = importDrawingWmf(document, bytes, { x: 2, y: -3, scale: 2 });
    assert.deepEqual(document, before);
    assert.deepEqual(result.content.entities.map(entity => entity.type), ['hatch', 'polyline', 'polyline', 'hatch', 'ellipse', 'line']);
    assert.equal(result.content.entities[0].boundaries.length, 2);
    assert.equal(result.content.entities[0].boundaryStroke, false);
    const line = result.content.entities.at(-1);
    near(line.x1, 2); near(line.y1, -3); near(line.x2, 2 + 40 * 0.0254 / 96);
    assert.equal(new Set(result.selectedIds).size, 6);
    assert.deepEqual(result.report.warnings, []);
    assert.throws(() => importDrawingWmf(document, bytes, { x: 1e12 }), /wmfPlacement/);
    assert.deepEqual(document, before);
    const locked = structuredClone(document);
    locked.content.layers.find(layer => layer.id === locked.content.activeLayerId).locked = true;
    assert.throws(() => importDrawingWmf(locked, bytes), /wmfLayer/);
});

test('WMF converted geometry survives archive normalization and reports unsupported appearance fidelity', () => {
    const document = createLcadDocument({ name: 'WMF archive' });
    const bytes = wmf([[0x02fa, [3, 4, 0, 0x2211, 0x0033]], [0x012d, [0]], [0x041b, [100, 100, 0, 0]]]);
    const converted = importDrawingWmf(document, bytes);
    assert.deepEqual(converted.report.warnings, ['physicalStrokeWidth', 'strokeStyle']);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(converted))).document;
    // The shared affine mapper represents a transformed rectangle as a closed polyline.
    assert.deepEqual(loaded.content.entities.map(e => e.type), ['hatch', 'polyline']);
    assert.deepEqual(loaded.content.entities.map(e => e.id), converted.selectedIds);
    assert.equal(loaded.content.entities[0].boundaryStroke, false);
    assert.equal(loaded.content.entities[1].color, '#112233');
    near(loaded.content.entities[1].lineWidth, 4);
    const bounds = getEntityBounds(loaded.content.entities[1]);
    near(bounds.maxX - bounds.minX, 100 * 0.0254 / 96);
});

test('WMF compound polygons retain contour boundaries, winding and one shared fill operation', () => {
    const contours = [2, 4, 4, 0, 0, 100, 0, 100, 100, 0, 100, 25, 25, 25, 75, 75, 75, 75, 25];
    for (const [mode, fillRule] of [[1, 'evenodd'], [2, 'nonzero']]) {
        const result = readDrawingWmfGraphics(wmf([[0x0106, [mode]], [0x0538, contours]]));
        assert.equal(result.primitives.length, 1);
        const primitive = result.primitives[0];
        assert.equal(primitive.kind, 'polypolygon'); assert.equal(primitive.fillRule, fillRule);
        assert.deepEqual(primitive.contourLengths, [4, 4]); assert.equal(primitive.points.length, 8);
        near(primitive.points[4].x, 25 * 0.0254 / 96); near(primitive.points[7].y, 25 * 0.0254 / 96);
    }
    assert.throws(() => readDrawingWmfGraphics(wmf([[0x0538, contours]]), { maxPoints: 7 }), /wmfLimit/);
    for (const invalid of [[0], [2, 4], [1, 3, 0, 0], [1, 1, 0, 0], [...contours, 0]]) {
        assert.throws(() => readDrawingWmfGraphics(wmf([[0x0538, invalid]])), /wmfInvalid/);
    }
});

test('WMF physical mapping converts signed coordinates and keeps cosmetic pens one pixel wide', () => {
    const { primitives } = readDrawingWmfGraphics(wmf([
        [0x0103, [3]], [0x0214, [-100, 200]], [0x0213, [300, -400]],
        [0x0103, [8]], [0x020c, [10, 10]], [0x020e, [1000, 1000]], [0x0213, [10, 10]],
    ]));
    near(primitives[0].points[0].x, 0.002); near(primitives[0].points[0].y, 0.001);
    near(primitives[0].points[1].x, -0.004); near(primitives[0].points[1].y, -0.003);
    for (const primitive of primitives) near(primitive.stroke.width, 0.0254 / 96);
    near(primitives[1].points[1].x, 1000 * 0.0254 / 96);
});

test('WMF object selection, fill rules and DC restoration preserve independent appearances', () => {
    const { primitives } = readDrawingWmfGraphics(wmf([
        [0x02fa, [0, 2, 0, 0x2211, 0x0033]], [0x012d, [0]],
        [0x02fc, [0, 0x5544, 0x0066, 0]], [0x012d, [1]],
        [0x001e, []], [0x0106, [2]], [0x041b, [20, 30, 0, 0]],
        [0x02fc, [1, 0, 0, 0]], [0x012d, [2]], [0x0418, [20, 30, 0, 0]],
        [0x0127, [-1]], [0x0324, [3, 0, 0, 10, 0, 0, 10]],
    ]));
    assert.deepEqual(primitives.map(p => [p.kind, p.fill, p.fillRule]), [
        ['rectangle', '#445566', 'nonzero'], ['ellipse', null, 'nonzero'], ['polygon', '#445566', 'evenodd'],
    ]);
    for (const primitive of primitives) {
        assert.equal(primitive.stroke.color, '#112233'); near(primitive.stroke.width, 2 * 0.0254 / 96);
    }
});

test('WMF semantic errors and work limits refuse the whole result', () => {
    const line = [0x0213, [10, 20]];
    for (const bad of [[0x0127, [-1]], [0x012d, [9]], [0x0214, [1]], [0x0325, [3, 0, 0]], [0x0103, [9]]]) {
        assert.throws(() => readDrawingWmfGraphics(wmf([line, bad])), /wmfInvalid|wmfObjects/);
    }
    assert.throws(() => readDrawingWmfGraphics(wmf([line, [0x0626, []]])), /wmfUnsupportedRecord/);
    assert.throws(() => readDrawingWmfGraphics(wmf([line, line]), { maxPrimitives: 1 }), /wmfLimit/);
    assert.throws(() => readDrawingWmfGraphics(wmf([line]), { maxPoints: 1 }), /wmfLimit/);
    assert.throws(() => readDrawingWmfGraphics(wmf([[0x02fa, [0, 1, 0, 0, 0]]], 0)), /wmfObjects/);
});

test('WMF window and viewport origins, reflection and isotropic scaling compose correctly', () => {
    const { primitives } = readDrawingWmfGraphics(wmf([
        [0x0103, [8]], [0x020b, [20, 10]], [0x020d, [200, 100]],
        [0x020c, [10, 10]], [0x020e, [-40, 20]],
        [0x0214, [20, 10]], [0x0213, [30, 20]],
        [0x0103, [7]], [0x0213, [40, 30]],
    ]));
    const pixels = primitives.map(p => p.points.map(point => ({ x: point.x * 96 / 0.0254, y: point.y * 96 / 0.0254 })));
    const expected = [[{ x: 100, y: 200 }, { x: 120, y: 160 }], [{ x: 120, y: 180 }, { x: 140, y: 160 }]];
    pixels.forEach((points, i) => points.forEach((point, j) => {
        near(point.x, expected[i][j].x); near(point.y, expected[i][j].y);
    }));
});

test('WMF relative origin shifts restore with the device context without moving the logical pen', () => {
    const result = readDrawingWmfGraphics(wmf([
        [0x0214, [10, 20]], [0x001e, []], [0x020f, [2, -3]], [0x0211, [-4, 5]],
        [0x0213, [30, 40]], [0x0127, [-1]], [0x0213, [30, 40]],
    ]));
    const expected = [[28, 4, 48, 24], [20, 10, 40, 30]];
    result.primitives.forEach((primitive, index) => {
        const values = primitive.points.flatMap(p => [p.x, p.y]);
        values.forEach((value, axis) => near(value, expected[index][axis] * 0.0254 / 96));
    });
});

test('WMF scale records compose signed window/viewport ratios and restore prior extents', () => {
    const setup = [[0x0103, [8]], [0x020c, [20, 10]], [0x020e, [200, 100]]];
    const result = readDrawingWmfGraphics(wmf([...setup, [0x001e, []],
        [0x0410, [2, 1, 1, 2]], [0x0412, [1, -1, 2, 1]], [0x0213, [10, 20]],
        [0x0127, [-1]], [0x0213, [10, 20]],
    ]));
    const first = result.primitives[0].points[1]; const restored = result.primitives[1].points[1];
    near(first.x, 50 * 0.0254 / 96); near(first.y, -200 * 0.0254 / 96);
    near(restored.x, 200 * 0.0254 / 96); near(restored.y, 100 * 0.0254 / 96);
    for (const params of [[0, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1], [1, 1, 1, 0]]) {
        assert.throws(() => readDrawingWmfGraphics(wmf([...setup, [0x0410, params]])), /wmfInvalid/);
    }
    const fixed = readDrawingWmfGraphics(wmf([[0x0410, [0, 0, 0, 0]], [0x0213, [10, 20]]]));
    near(fixed.primitives[0].points[1].x, 20 * 0.0254 / 96);
});

test('WMF pen style bitfields preserve cap and join choices and reject undefined combinations', () => {
    const bytes = wmf([[0x02fa, [0x2202, 0, 999, 0, 0]], [0x012d, [0]], [0x0213, [10, 20]]]);
    const { stroke } = readDrawingWmfGraphics(bytes).primitives[0];
    assert.equal(stroke.style, 2); assert.equal(stroke.endCap, 'flat'); assert.equal(stroke.join, 'miter');
    near(stroke.width, 0.0254 / 96);
    const result = importDrawingWmf(createLcadDocument({ name: 'Caps' }), bytes);
    assert.deepEqual(result.report.warnings, ['strokeCapsAndJoins']);
    for (const flags of [0x300, 0x3000, 0x10, 0xf]) {
        assert.throws(() => readDrawingWmfGraphics(wmf([[0x02fa, [flags, 0, 0, 0, 0]]])), /wmfUnsupportedPen/);
    }
});

test('WMF fractional display widths survive archive storage and oversized widths are explicitly reported', () => {
    const document = createLcadDocument({ name: 'Fractional width' });
    const records = [[0x0103, [8]], [0x020c, [2, 2]], [0x020e, [3, 3]],
        [0x02fa, [1, 3, 0, 0, 0]], [0x012d, [0]], [0x0213, [10, 20]]];
    const converted = importDrawingWmf(document, wmf(records));
    near(converted.content.entities[0].lineWidth, 4.5);
    assert.equal(Object.hasOwn(converted.content.entities[0], 'lineWeight'), false);
    assert.deepEqual(converted.report.warnings, ['physicalStrokeWidth']);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(converted))).document;
    near(loaded.content.entities[0].lineWidth, 4.5);
    const large = importDrawingWmf(document, wmf([[0x02fa, [1, 101, 0, 0, 0]], [0x012d, [0]], [0x0213, [10, 20]]]));
    assert.deepEqual(large.report.warnings, ['strokeWeight', 'physicalStrokeWidth']);
});

test('WMF solid physical strokes become exact curved fill outlines with scaled archive dimensions', () => {
    const document = createLcadDocument({ name: 'Physical stroke' });
    const bytes = wmf([[0x02fa, [0, 4, 0, 0x2211, 0x0033]], [0x012d, [0]], [0x0213, [0, 100]]]);
    const converted = importDrawingWmf(document, bytes, { scale: 3, x: 2, y: 4 });
    assert.deepEqual(converted.report.warnings, []);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(converted))).document;
    const entity = loaded.content.entities[0];
    assert.equal(entity.type, 'hatch'); assert.equal(entity.color, '#112233');
    assert.equal(entity.fillRule, 'nonzero'); assert.equal(entity.boundaryStroke, false);
    const bounds = getEntityBounds(entity);
    near(bounds.maxY - bounds.minY, 4 * 3 * 0.0254 / 96);
    near(bounds.maxX - bounds.minX, 104 * 3 * 0.0254 / 96);
    near((bounds.minY + bounds.maxY) / 2, 4);
});

test('WMF flat and square solid pens preserve their distinct end extents in native archives', () => {
    for (const [flags, expectedLength] of [[0x0200, 100], [0x0100, 104]]) {
        const bytes = wmf([[0x02fa, [flags, 4, 0, 0, 0]], [0x012d, [0]], [0x0213, [0, 100]]]);
        const converted = importDrawingWmf(createLcadDocument({ name: 'WMF caps' }), bytes);
        assert.deepEqual(converted.report.warnings, []);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(converted))).document;
        const entity = loaded.content.entities[0];
        assert.equal(entity.type, 'hatch');
        assert.ok(entity.boundaries[0].parts.every(part => part.type === 'line'));
        const bounds = getEntityBounds(entity);
        near(bounds.maxX - bounds.minX, expectedLength * 0.0254 / 96);
        near(bounds.maxY - bounds.minY, 4 * 0.0254 / 96);
    }
});

test('WMF bevel and miter pen flags import exact joint outlines and survive archive reload', () => {
    for (const [flags, parts] of [[0x1200, 3], [0x2200, 4]]) {
        const bytes = wmf([[0x02fa, [flags, 4, 0, 0, 0]], [0x012d, [0]], [0x0325, [3, 0, 0, 100, 0, 100, 100]]]);
        const converted = importDrawingWmf(createLcadDocument({ name: 'WMF joints' }), bytes);
        assert.deepEqual(converted.report.warnings, []);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(converted))).document;
        const hatch = loaded.content.entities[0];
        assert.equal(hatch.type, 'hatch'); assert.equal(hatch.fillRule, 'nonzero');
        assert.equal(hatch.boundaries.length, 3); assert.equal(hatch.boundaries[1].parts.length, parts);
    }
});

test('WMF text state restores selected fonts and colors without changing the drawing cursor', () => {
    const font = Array(25).fill(0); font[0] = -20; font[4] = 700;
    const text = [2, 0x6948, 20, 10];
    const bytes = wmf([
        [0x02fb, font], [0x012d, [0]], [0x0102, [1]], [0x0209, [0x2211, 0x0033]],
        [0x0214, [3, 4]], [0x001e, []], [0x0209, [0, 0x00ff]], [0x012e, [24]],
        [0x0521, text], [0x0127, [-1]], [0x0521, text], [0x0213, [5, 6]],
    ]);
    const [first, second, line] = readDrawingWmfGraphics(bytes).primitives;
    assert.equal(first.kind, 'text'); assert.equal(first.text, 'Hi');
    assert.equal(first.font.height, -20); assert.equal(first.font.weight, 700);
    assert.equal(first.textColor, '#0000ff'); assert.equal(first.textAlign, 24);
    assert.equal(second.textColor, '#112233'); assert.equal(second.textAlign, 0);
    assert.equal(second.backgroundMode, 1);
    near(first.points[0].x, 10 * .0254 / 96); near(first.points[0].y, 20 * .0254 / 96);
    near(line.points[0].x, 4 * .0254 / 96); near(line.points[0].y, 3 * .0254 / 96);
    assert.throws(() => readDrawingWmfGraphics(bytes, { maxCharacters: 3 }), /wmfLimit/);
    const document = createLcadDocument(); const before = structuredClone(document);
    const imported = importDrawingWmf(document, bytes);
    assert.equal(imported.content.entities.filter(entity => entity.type === 'text').length, 2);
    assert.ok(imported.report.warnings.includes('textFontMetrics'));
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.equal(loaded.content.entities[0].text, 'Hi');
    assert.deepEqual(loaded.content.entities[0].affineFrame, imported.content.entities[0].affineFrame);
    assert.deepEqual(document, before);
    assert.throws(() => readDrawingWmfGraphics(wmf([[0x0521, text]])), /wmfUnsupportedDefaultFont/);
    assert.throws(() => readDrawingWmfGraphics(wmf([[0x02fb, font], [0x012d, [0]], [0x012e, [1]], [0x0521, text]])), /wmfUnsupportedTextAlignment/);
});

test('WMF extended text paints the explicit opaque rectangle before its editable text', () => {
    const font = Array(25).fill(0); font[0] = -20;
    const records = [[0x02fb, font], [0x012d, [0]], [0x0102, [1]], [0x0201, [0x2233, 0x0011]],
        [0x0a32, [20, 10, 2, 2, -10, -20, 100, 80, 0x6948]]];
    const imported = importDrawingWmf(createLcadDocument(), wmf(records));
    const [background, text] = imported.content.entities;
    assert.equal(background.type, 'hatch'); assert.equal(background.color, '#332211');
    assert.equal(background.boundaryStroke, false); assert.equal(text.type, 'text'); assert.equal(text.text, 'Hi');
    const bounds = getEntityBounds(background);
    near(bounds.minX, -10 * .0254 / 96); near(bounds.maxY, 80 * .0254 / 96);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.equal(loaded.content.entities[0].type, 'hatch');
    assert.equal(loaded.content.entities[1].text, 'Hi');
    records.at(-1)[1][3] = 6;
    const clipped = importDrawingWmf(createLcadDocument(), wmf(records));
    assert.equal(clipped.content.entities[1].type, 'blockReference');
    assert.equal(clipped.content.blocks[0].entities[0].text, 'Hi');
    assert.ok(clipped.report.warnings.includes('textClipBlock'));
});

test('WMF spaced text imports in source order and retains positions through archives', () => {
    const font = Array(25).fill(0); font[0] = -20;
    const bytes = wmf([[0x02fb, font], [0x012d, [0]], [0x0102, [1]],
        [0x0a32, [20, 10, 3, 0, 0x4241, 0x0043, 20, -5, 15]]]);
    const result = importDrawingWmf(createLcadDocument(), bytes, { x: 2, y: 3, scale: 10 });
    assert.deepEqual(result.content.entities.map(entity => entity.text), ['A', 'B', 'C']);
    assert.ok(result.report.warnings.includes('textCharacters'));
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    assert.deepEqual(loaded.content.entities.map(entity => entity.affineFrame), result.content.entities.map(entity => entity.affineFrame));
    near(loaded.content.entities[1].affineFrame.e - loaded.content.entities[0].affineFrame.e, 20 * .0254 / 96 * 10);
    near(loaded.content.entities[2].affineFrame.e - loaded.content.entities[1].affineFrame.e, -5 * .0254 / 96 * 10);
});

test('WMF clipped text uses persistent native blocks with bounded visible geometry', () => {
    const font = Array(25).fill(0); font[0] = -40;
    const bytes = wmf([[0x02fb, font], [0x012d, [0]], [0x0102, [1]],
        [0x0a32, [0, 0, 4, 4, 0, 0, 20, 40, 0x4241, 0x4443]]]);
    const source = createLcadDocument(); const before = structuredClone(source);
    const result = importDrawingWmf(source, bytes, { x: 2, y: 3, scale: 10 });
    assert.deepEqual(source, before);
    assert.equal(result.content.blocks.length, 1);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    const reference = loaded.content.entities[0];
    assert.equal(reference.type, 'blockReference');
    assert.equal(loaded.content.blocks[0].entities[0].text, 'ABCD');
    assert.equal(reference.blockClip.points.length, 4);
    const bounds = getEntityBounds(reference);
    near(bounds.minX, 2); near(bounds.maxX, 2 + 20 * .0254 / 96 * 10);
    const full = { ...source, content: { ...source.content, blocks: Array.from({ length: 1024 }, (_, i) => ({ id: `block-${i}`, entities: [] })) } };
    assert.throws(() => importDrawingWmf(full, bytes), /wmfLimit/);
});

test('WMF device clipping stays in device space through mapping changes and restores with the context', () => {
    const bytes = wmf([[0x0416, [100, 100, 0, 0]], [0x001e, []], [0x020b, [10, 20]],
        [0x0220, [5, -10]], [0x041b, [100, 100, 0, 0]], [0x0127, [-1]], [0x041b, [100, 100, 0, 0]]]);
    const [shifted, restored] = readDrawingWmfGraphics(bytes).primitives;
    const unit = .0254 / 96;
    near(shifted.deviceClip.minX, -10 * unit); near(shifted.deviceClip.minY, 5 * unit);
    near(restored.deviceClip.minX, 0); near(restored.deviceClip.maxX, 100 * unit);
    const imported = importDrawingWmf(createLcadDocument(), bytes);
    assert.equal(imported.content.entities.length, 4);
    assert.ok(imported.content.entities.every(entity => entity.type === 'blockReference'));
    assert.ok(imported.report.warnings.includes('deviceClipBlock'));
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.equal(loaded.content.blocks.length, 4);
    near(getEntityBounds(loaded.content.entities[0]).minY, 5 * unit);
});

test('WMF clip intersections retain an empty region until restoring the saved context', () => {
    const bytes = wmf([[0x001e, []], [0x0416, [10, 10, 0, 0]], [0x0416, [30, 30, 20, 20]],
        [0x041b, [100, 100, 0, 0]], [0x0127, [-1]], [0x0213, [10, 10]]]);
    const imported = importDrawingWmf(createLcadDocument(), bytes);
    assert.equal(imported.content.entities.length, 1);
    assert.equal(imported.content.entities[0].type, 'line');
    assert.equal(imported.content.blocks.length, 0);
});

test('WMF nested text and context clipping retain the active layer and both clip boundaries', () => {
    const font = Array(25).fill(0); font[0] = -40;
    const bytes = wmf([[0x02fb, font], [0x012d, [0]], [0x0102, [1]],
        [0x0416, [30, 15, 5, 5]], [0x0a32, [0, 0, 4, 6, 0, 0, 20, 40, 0x4241, 0x4443]]]);
    const document = createLcadDocument();
    const layerId = document.content.layers[1].id;
    document.content.activeLayerId = layerId;
    const result = importDrawingWmf(document, bytes);
    assert.equal(result.content.entities.length, 2);
    assert.ok(result.content.entities.every(entity => entity.layerId === layerId));
    assert.ok(result.content.blocks.flatMap(block => block.entities).every(entity => entity.layerId === layerId));
    const outer = result.content.entities[1];
    const outerDefinition = result.content.blocks.find(block => block.id === outer.blockId);
    const inner = outerDefinition.entities[0];
    assert.equal(inner.type, 'blockReference');
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result))).document;
    const loadedOuter = loaded.content.entities[1];
    assert.deepEqual(loadedOuter.blockClip, outer.blockClip);
    const loadedDefinition = loaded.content.blocks.find(block => block.id === loadedOuter.blockId);
    assert.deepEqual(loadedDefinition.entities[0].blockClip, inner.blockClip);
    const bounds = getEntityBounds(loadedOuter);
    near(bounds.minX, 5 * .0254 / 96); near(bounds.maxX, 15 * .0254 / 96);
});

test('WMF hatch brushes retain all six orientations and contextual background without becoming solid fills', () => {
    for (let hatch = 0; hatch < 6; hatch++) {
        const bytes = wmf([[0x02fc, [2, 0x2211, 0x0033, hatch]], [0x012d, [0]], [0x0201, [0x6655, 0x0077]],
            [0x001e, []], [0x0102, [1]], [0x041b, [100, 100, 0, 0]], [0x0127, [-1]], [0x041b, [100, 100, 0, 0]]]);
        const [transparent, opaque] = readDrawingWmfGraphics(bytes).primitives;
        assert.equal(transparent.fill, '#112233');
        assert.deepEqual(transparent.fillHatch, { style: hatch, background: null });
        assert.deepEqual(opaque.fillHatch, { style: hatch, background: '#556677' });
        const document = createLcadDocument(); const before = structuredClone(document);
        const imported = importDrawingWmf(document, bytes);
        assert.ok(imported.report.warnings.includes('hatchPattern'));
        assert.ok(imported.content.blocks.length >= 2);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        assert.equal(loaded.content.blocks.length, imported.content.blocks.length);
        assert.deepEqual(document, before);
    }
    assert.throws(() => readDrawingWmfGraphics(wmf([[0x02fc, [2, 0, 0, 6]]])), /wmfInvalid/);
});

test('WMF null brushes ignore unused color flags and hatch bytes', () => {
    const bytes = wmf([[0x02fc, [1, 0xffff, 0xffff, 0xffff]], [0x012d, [0]], [0x041b, [100, 100, 0, 0]]]);
    assert.equal(readDrawingWmfGraphics(bytes).primitives[0].fill, null);
    const imported = importDrawingWmf(createLcadDocument(), bytes);
    assert.equal(imported.content.entities.length, 1);
    assert.equal(imported.content.entities[0].type, 'polyline');
});

test('WMF hatch brushes clip curved outlines and survive native archive validation', () => {
    const bytes = wmf([[0x02fc, [2, 0x6622, 0x0099, 5]], [0x012d, [0]], [0x0102, [1]], [0x0418, [80, 100, 0, 0]]]);
    const imported = importDrawingWmf(createLcadDocument(), bytes, { scale: 50 });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
    assert.equal(loaded.content.entities[0].type, 'blockReference');
    assert.ok(loaded.content.entities[0].blockClip.paths[0].parts.length > 8);
    assert.equal(loaded.content.entities[1].type, 'ellipse');
});

test('WMF circular pens retain physical thickness, hole and arc caps through placement and archive reload', () => {
    for (const opcode of [0x0418, 0x0817]) for (const flags of [0, 0x0100, 0x0200]) {
        const params = opcode === 0x0418 ? [100, 100, 0, 0] : [0, 50, 50, 100, 100, 100, 0, 0];
        const bytes = wmf([[0x02fa, [flags, 4, 0, 0x2211, 0x0033]], [0x012d, [0]],
            [0x02fc, [1, 0, 0, 0]], [0x012d, [1]], [opcode, params]]);
        const imported = importDrawingWmf(createLcadDocument({ name: 'Circular pen' }), bytes, { scale: 3, x: 2, y: 4 });
        assert.deepEqual(imported.report.warnings, []);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        const hatch = loaded.content.entities[0]; assert.equal(hatch.type, 'hatch');
        assert.equal(hatch.color, '#112233'); assert.equal(hatch.fillRule, 'nonzero');
        const parts = hatch.boundaries.flatMap(boundary => boundary.parts);
        const radii = parts.filter(p => ['arc', 'circle', 'ellipse'].includes(p.type)).map(p => p.r ?? p.rx);
        assert.ok(radii.some(r => Math.abs(r - 52 * 3 * .0254 / 96) < 1e-12));
        assert.ok(radii.some(r => Math.abs(r - 48 * 3 * .0254 / 96) < 1e-12));
        if (opcode === 0x0418) {
            const bounds = getEntityBounds(hatch); near(bounds.maxX - bounds.minX, 104 * 3 * .0254 / 96);
        }
    }
});


test('WMF circular rounded rectangles, chords and pies retain round physical joins in archives', () => {
    for (const [opcode, params] of [[0x061c, [40, 40, 100, 160, 0, 0]],
        [0x0830, [0, 50, 50, 100, 100, 100, 0, 0]], [0x081a, [0, 50, 50, 100, 100, 100, 0, 0]]]) {
        const bytes = wmf([[0x02fa, [0, 12, 0, 0x2211, 0x0033]], [0x012d, [0]],
            [0x02fc, [1, 0, 0, 0]], [0x012d, [1]], [opcode, params]]);
        const imported = importDrawingWmf(createLcadDocument({ name: 'Round joins' }), bytes, { scale: 2 });
        assert.deepEqual(imported.report.warnings, []);
        const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(imported))).document;
        const hatch = loaded.content.entities[0]; assert.equal(hatch.type, 'hatch');
        assert.equal(hatch.fillRule, 'nonzero'); assert.equal(hatch.boundaryStroke, false);
        assert.ok(hatch.boundaries.length >= 2);
        assert.ok(hatch.boundaries.some(boundary => boundary.parts.some(part => part.type === 'arc')));
    }
});
