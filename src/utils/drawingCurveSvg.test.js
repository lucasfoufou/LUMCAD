import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingCurvePathToSvgData } from './drawingCurveSvg.js';

test('complete rotated ellipse boundaries emit two arcs with retained winding and nonzero start angle', () => {
    for (const counterClockwise of [true, false]) {
        const d = drawingCurvePathToSvgData({ closed: true, parts: [{ type: 'ellipse', cx: 0, cy: 0, rx: 3, ry: 2,
            rotation: 30, startAngle: Math.PI / 2, endAngle: Math.PI / 2, fullEllipse: true, counterClockwise }] });
        assert.equal((d.match(/ A /g) || []).length, 2);
        assert.equal((d.match(new RegExp(`A 3 2 30 0 ${counterClockwise ? 1 : 0}`, 'g')) || []).length, 2);
        const arcs = d.split(' A ');
        assert.notEqual(arcs[1].split(' ').slice(-2).join(' '), arcs[2].replace(/ Z$/, '').split(' ').slice(-2).join(' '));
        assert.ok(d.endsWith(' Z'));
    }
});

test('full circles and full arcs use two SVG arcs while disconnected lines restart the path', () => {
    for (const part of [{ type: 'circle', cx: 2, cy: 3, r: 4 },
        { type: 'arc', cx: 2, cy: 3, r: 4, startAngle: 0, endAngle: 0, fullCircle: true }]) {
        assert.equal((drawingCurvePathToSvgData({ parts: [part] }).match(/ A /g) || []).length, 2);
    }
    assert.equal(drawingCurvePathToSvgData({ parts: [{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 },
        { type: 'line', x1: 2, y1: 2, x2: 3, y2: 3 }] }), 'M 0 0 L 1 1 M 2 2 L 3 3');
});
