import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingHatchLines } from './drawingHatchLines.js';
const rectangle = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

test('hatch scanlines retain holes and distinguish even-odd from winding fills', () => {
    const contours = [rectangle(0, 0, 4, 4), rectangle(1, 1, 2, 2)];
    const pattern = { name: 'lines', spacing: 1, origin: { x: 0, y: .5 } };
    const lines = drawingHatchLines(contours, pattern);
    assert.deepEqual(lines.filter(line => line[0].y === 1.5), [[{ x: 0, y: 1.5 }, { x: 1, y: 1.5 }], [{ x: 3, y: 1.5 }, { x: 4, y: 1.5 }]]);
    const winding = drawingHatchLines(contours, pattern, { fillRule: 'nonzero' });
    assert.ok(winding.some(line => line[0].x === 1 && line[1].x === 3 && line[0].y === 1.5));
    const reversed = drawingHatchLines([contours[0], [...contours[1]].reverse()], pattern, { fillRule: 'nonzero' });
    assert.deepEqual(reversed, lines);
});

test('rotated cross hatches retain two perpendicular directions and shifted phase', () => {
    const lines = drawingHatchLines([rectangle(0, 0, 4, 4)], { name: 'cross', angle: 45, spacing: 1, origin: { x: .25, y: .5 } });
    let positive = false; let negative = false;
    for (const [a, b] of lines) {
        assert.ok(Math.abs(Math.abs(b.x - a.x) - Math.abs(b.y - a.y)) < 1e-10);
        positive ||= (b.x - a.x) * (b.y - a.y) > 0; negative ||= (b.x - a.x) * (b.y - a.y) < 0;
        for (const p of [a, b]) assert.ok(p.x >= -1e-10 && p.x <= 4 + 1e-10 && p.y >= -1e-10 && p.y <= 4 + 1e-10);
    }
    assert.ok(positive && negative);
});

test('hatch scanline budgets reject excessive density before iteration', () => {
    assert.throws(() => drawingHatchLines([rectangle(0, 0, 100, 100)], { spacing: 1e-12 }, { annotation: true }), /wmfLimit/);
    assert.throws(() => drawingHatchLines([rectangle(0, 0, 4, 4)], { spacing: 1 }, { maxLines: 1 }), /wmfLimit/);
});
