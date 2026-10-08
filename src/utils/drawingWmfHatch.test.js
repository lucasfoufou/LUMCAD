import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingWmfHatch } from './drawingWmfHatch.js';

const outline = [{ type: 'rectangle', x: -.01, y: -.01, width: .02, height: .02 }];
test('WMF vector hatch orientations and physical widths follow the selected device DPI', () => {
    for (let style = 0; style < 6; style++) {
        const hatch = createDrawingWmfHatch(outline, style, '#112233');
        assert.equal(hatch.color, '#112233'); assert.equal(hatch.boundaryStroke, false);
        const directions = new Set();
        for (const boundary of hatch.boundaries) {
            const edge = boundary.parts[0]; const end = boundary.parts[1];
            const dx = edge.x2 - edge.x1; const dy = edge.y2 - edge.y1;
            directions.add(Math.round(Math.atan2(dy, dx) * 180 / Math.PI));
            assert.ok(Math.abs(Math.hypot(end.x2 - end.x1, end.y2 - end.y1) - .0254 / 96) < 1e-10);
        }
        assert.deepEqual([...directions].sort((a, b) => a - b), [[0], [90], [45], [-45], [0, 90], [-45, 45]][style]);
    }
});

test('WMF vector hatch generation rejects excessive density before expanding geometry', () => {
    assert.throws(() => createDrawingWmfHatch(outline, 4, '#000000', { maxLines: 1 }), /wmfLimit/);
    assert.throws(() => createDrawingWmfHatch(outline, 6, '#000000'), /wmfInvalid/);
    const base = createDrawingWmfHatch(outline, 0, '#000000');
    const dense = createDrawingWmfHatch(outline, 0, '#000000', { dpi: 192 });
    assert.ok(dense.boundaries.length > base.boundaries.length);
});
