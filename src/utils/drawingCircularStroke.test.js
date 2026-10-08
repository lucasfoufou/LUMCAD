import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { createDrawingCircularStrokeFill, createDrawingRoundStrokeFill } from './drawingStrokeGeometry.js';
import { drawingCurvePathToSvgData } from './drawingCurveSvg.js';
import { extractEntityPaths } from './drawingCurveKernel.js';
import { getEntityBounds } from './drawingGeometry.js';

const render = body => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="-90 -90 180 180">${body}</svg>`, { font: { loadSystemFonts: false } }).render().pixels;
const outlineSvg = hatch => `<path d="${hatch.boundaries.map(drawingCurvePathToSvgData).join(' ')}" fill="black" fill-rule="nonzero"/>`;

test('circular stroke outlines match independent SVG strokes for both directions and each cap', () => {
    for (const endCap of ['round', 'flat', 'square']) for (const counterClockwise of [true, false]) {
        for (const endAngle of [Math.PI / 2, Math.PI * 1.8]) {
            const curve = { type: 'ellipse', cx: 0, cy: 0, rx: 40, ry: 40, rotation: 27,
                startAngle: 0.1, endAngle, counterClockwise, fullEllipse: false };
            const before = structuredClone(curve);
            const hatch = createDrawingCircularStrokeFill([curve], 12, '#000000', { endCap });
            assert.deepEqual(curve, before); assert.equal(hatch.boundaries.length, 1);
            const reference = render(`<path d="${drawingCurvePathToSvgData(extractEntityPaths(curve)[0])}" fill="none" stroke="black" stroke-width="12" stroke-linecap="${endCap === 'flat' ? 'butt' : endCap}"/>`);
            const actual = render(outlineSvg(hatch));
            let delta = 0; let mismatches = 0;
            for (let i = 3; i < actual.length; i += 4) {
                delta += Math.abs(actual[i] - reference[i]);
                if (Math.abs(actual[i] - reference[i]) > 128) mismatches++;
            }
            assert.ok(delta / (180 * 180) < 1, `${endCap}/${counterClockwise}: ${delta}`);
            assert.equal(mismatches, 0);
        }
    }
});

test('full circular strokes preserve holes, close wide strokes into disks and retain exact bounds', () => {
    for (const width of [2, 20, 30]) {
        const circle = { type: 'circle', cx: 0, cy: 0, r: 10 };
        const hatch = createDrawingCircularStrokeFill([circle], width, '#000000');
        assert.equal(hatch.boundaries.length, width < 20 ? 2 : 1);
        const bounds = getEntityBounds(hatch);
        assert.deepEqual(bounds, { minX: -10 - width / 2, minY: -10 - width / 2, maxX: 10 + width / 2, maxY: 10 + width / 2 });
        const pixels = render(outlineSvg(hatch));
        assert.equal(pixels[(90 * 180 + 90) * 4 + 3], width < 20 ? 0 : 255);
    }
});

test('unsupported noncircular and mixed paths retain the caller fallback without partial contours', () => {
    const arc = { type: 'arc', cx: 0, cy: 0, r: 1, startAngle: 0, endAngle: 1 };
    assert.equal(createDrawingCircularStrokeFill([arc], 2, '#000000', { endCap: 'flat' }), null);
    assert.ok(createDrawingCircularStrokeFill([{ type: 'ellipse', cx: 2, cy: 3, rx: 1, ry: 1 + Number.EPSILON }], 1, '#000000'));
    assert.equal(createDrawingCircularStrokeFill([{ type: 'ellipse', cx: 2, cy: 3, rx: 1, ry: 1.00000001 }], 1, '#000000'), null);
    assert.equal(createDrawingCircularStrokeFill([{ type: 'ellipse', cx: 0, cy: 0, rx: 2, ry: 1 }], 1, '#000000'), null);
    assert.throws(() => createDrawingCircularStrokeFill([arc], 0, '#000000'), /strokeGeometryInvalid/);
    assert.throws(() => createDrawingCircularStrokeFill([{ type: 'circle', cx: 0, cy: 0, r: 2 }], 1, '#000000', { maxSegments: 1 }), /strokeGeometryLimit/);
});


test('round segment unions match SVG strokes across joins, reversed arcs and centre-crossing widths', () => {
    const arc = { type: 'arc', cx: 0, cy: 0, r: 20, startAngle: 0, endAngle: Math.PI * 1.7, counterClockwise: true };
    const path = { type: 'polyline', closed: true, parts: [
        { type: 'line', x1: -30, y1: -20, x2: 30, y2: -20 },
        { type: 'arc', cx: 30, cy: 0, r: 20, startAngle: -Math.PI / 2, endAngle: Math.PI / 2, counterClockwise: true },
        { type: 'line', x1: 30, y1: 20, x2: -30, y2: 20 },
        { type: 'arc', cx: -30, cy: 0, r: 20, startAngle: Math.PI / 2, endAngle: Math.PI * 1.5, counterClockwise: true },
    ] };
    for (const source of [arc, { ...arc, counterClockwise: false }, path]) for (const width of [8, 40, 50]) {
        const before = structuredClone(source);
        const hatch = createDrawingRoundStrokeFill([source], width, '#000000');
        assert.deepEqual(source, before); assert.ok(hatch);
        const actual = render(outlineSvg(hatch));
        const reference = render(`<path d="${extractEntityPaths(source).map(drawingCurvePathToSvgData).join(' ')}" fill="none" stroke="black" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
        let delta = 0; let mismatches = 0;
        for (let i = 3; i < actual.length; i += 4) {
            delta += Math.abs(actual[i] - reference[i]);
            if (Math.abs(actual[i] - reference[i]) > 128) mismatches++;
        }
        assert.ok(delta / (180 * 180) < 1, `${source.type}/${width}: ${delta}`);
        assert.equal(mismatches, 0);
    }
    assert.throws(() => createDrawingRoundStrokeFill([path], 8, '#000000', { maxSegments: 2 }), /strokeGeometryLimit/);
    assert.equal(createDrawingRoundStrokeFill([path], 8, '#000000', { join: 'bevel' }), null);
    assert.equal(createDrawingRoundStrokeFill([arc], 8, '#000000', { endCap: 'flat' }), null);
    assert.ok(createDrawingRoundStrokeFill([path], 8, '#000000', { endCap: 'flat' }));
});
