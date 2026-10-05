import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingShxFont } from './drawingShxFont.js';
import { recognizeDrawingShxGeometry } from './drawingShxRecognition.js';

const font = parseDrawingShxFont(`*0,4,Recognition fixture
10,2,0,0
*72,0,H
5,8,0,10,6,2,8,6,0,1,8,0,10,2,8,0,-5,1,8,-6,0,2,8,8,-5,0
*105,0,i
2,8,1,0,1,8,0,6,2,8,0,2,1,8,0,1,2,8,3,-9,0
*79,0,O
2,8,5,0,1,10,5,060,2,8,7,0,0`);
const line = (id, x1, y1, x2, y2) => ({ id, type: 'line', x1, y1, x2, y2 });
const h = [line('left', 0, 0, 0, -10), line('right', 6, 0, 6, -10), line('bar', 0, -5, 6, -5)];

test('SHX recognition identifies whole letters, disconnected dots and preserves unrelated geometry', () => {
    const entities = [...h, line('stem', 21, 0, 21, -6), line('dot', 21, -8, 21, -9), line('other', 40, 0, 50, 0)];
    const original = structuredClone(entities);
    const result = recognizeDrawingShxGeometry(entities, font, { height: 10 });
    assert.deepEqual(result.matches.map(match => match.text), ['H', 'i']);
    assert.deepEqual(result.matches[0].position, { x: 0, y: 0 });
    assert.deepEqual(result.matches[1].position, { x: 20, y: 0 });
    assert.deepEqual(result.matches[0].ids.sort(), ['bar', 'left', 'right']);
    assert.deepEqual(result.unmatchedIds, ['other']);
    assert.deepEqual(entities, original);
});

test('SHX recognition handles moved, scaled and rotated PDF stroke coordinates', () => {
    const angle = 37 * Math.PI / 180; const cos = Math.cos(angle); const sin = Math.sin(angle);
    const point = (x, y) => ({ x: 12 + .023 * (cos * x - sin * y), y: -9 + .023 * (sin * x + cos * y) });
    const entities = h.map(entity => {
        const a = point(entity.x1, entity.y1); const b = point(entity.x2, entity.y2);
        return line(entity.id, a.x, a.y, b.x, b.y);
    });
    const { matches } = recognizeDrawingShxGeometry(entities, font, { height: .23, angle: 37 });
    assert.equal(matches.length, 1); assert.equal(matches[0].text, 'H');
    assert.ok(Math.abs(matches[0].position.x - 12) < 1e-10); assert.ok(Math.abs(matches[0].position.y + 9) < 1e-10);
    assert.ok(matches[0].confidence > 99.99);
    assert.equal(recognizeDrawingShxGeometry(entities, font, { height: .23, angle: 0 }).matches.length, 0);
});

test('SHX circular contours match PDF cubic approximations split into separate entities', () => {
    const k = 5 * 0.5522847498307936;
    const controls = [
        [[5, 0], [5 + k, 0], [10, -5 + k], [10, -5]],
        [[10, -5], [10, -5 - k], [5 + k, -10], [5, -10]],
        [[5, -10], [5 - k, -10], [0, -5 - k], [0, -5]],
        [[0, -5], [0, -5 + k], [5 - k, 0], [5, 0]],
    ];
    const entities = controls.map((points, index) => ({ id: `curve-${index}`, type: 'spline', controlPoints: points.map(([x, y]) => ({ x, y })) }));
    const { matches } = recognizeDrawingShxGeometry(entities, font, { height: 10 });
    assert.equal(matches.length, 1); assert.equal(matches[0].text, 'O'); assert.equal(matches[0].ids.length, 4);
    assert.ok(matches[0].confidence > 98);
});

test('SHX recognition refuses incomplete, ambiguous or mismatched-height glyphs', () => {
    assert.equal(recognizeDrawingShxGeometry(h.slice(0, 2), font, { height: 10 }).matches.length, 0);
    assert.equal(recognizeDrawingShxGeometry(h, font, { height: 12 }).matches.length, 0);
    const ambiguous = parseDrawingShxFont('*0,4,ambiguous\n10,2,0,0\n*73,0,I\n8,0,10,0\n*108,0,l\n8,0,10,0');
    const result = recognizeDrawingShxGeometry([h[0]], ambiguous, { height: 10 });
    assert.equal(result.matches.length, 0); assert.deepEqual(result.unmatchedIds, ['left']);
    for (const options of [{}, { height: 0 }, { height: 10, threshold: 101 }, { height: 10, angle: Infinity }]) {
        assert.throws(() => recognizeDrawingShxGeometry(h, font, options));
    }
});
