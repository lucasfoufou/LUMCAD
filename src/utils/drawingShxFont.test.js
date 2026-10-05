import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingShxGlyph, parseDrawingShxFont } from './drawingShxFont.js';

// These small font programs are authored fixtures, not redistributed commercial fonts.
const shp = (glyphs, unicode = false) => `${unicode ? '*UNIFONT,6,Fixture\n10,2,2,0,0,0' : '*0,4,Fixture\n10,2,2,0'}\n${glyphs}`;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const word = value => [value & 255, value >> 8];
function binaryFont(unicode = false, version = '1.0') {
    const definition = [...new TextEncoder().encode('Fixture'), 0, 10, 2, 2, ...(unicode ? [0, 0] : []), 0];
    const a = [0, 2, 7, ...(unicode ? word(66) : [66]), 1, 8, 255, 0, 0];
    const b = [0, 8, 5, 0, 0];
    const records = [[0, definition], [65, a], [66, b]];
    const header = new TextEncoder().encode(`AutoCAD-86 ${unicode ? 'unifont 1.0' : `shapes ${version}`}\r\n`);
    return new Uint8Array([...header, 26, ...(unicode
        ? [...word(3), 0, 0, ...word(definition.length), ...definition, ...records.slice(1).flatMap(([code, data]) => [...word(code), ...word(data.length), ...data])]
        : [...word(0), ...word(66), ...word(3), ...records.flatMap(([code, data]) => [...word(code), ...word(data.length)]), ...records.flatMap(([, data]) => data), 69, 79, 70])]);
}

test('SHP fonts decode wrapped decimal/hex programs, shared subshape state and horizontal conditions', () => {
    const font = parseDrawingShxFont(shp(`; the pen remains up inside the subshape
*65,0,A
2,7,66,1,5,8,(0,10),6,
14,9,(10,0),(0,10),(0,0),8,(5,0),0
*00042,0,B
050,0`));
    assert.equal(font.above, 10);
    assert.equal(font.glyphs.size, 2);
    const glyph = drawingShxGlyph(font, 65);
    assert.deepEqual(glyph.parts, [
        { type: 'line', x1: 5, y1: 0, x2: 5, y2: 10 },
        { type: 'line', x1: 5, y1: 0, x2: 10, y2: 0 },
    ]);
    assert.deepEqual(glyph.advance, { x: 10, y: 0 });
    assert.deepEqual(drawingShxGlyph(font, 65, { vertical: true }).advance, { x: 20, y: 10 });
});

test('classic SHX versions and Unicode records decode signed vectors and subshape identifiers', () => {
    for (const [unicode, version] of [[false, '1.0'], [false, '1.1'], [true, '1.0']]) {
        const font = parseDrawingShxFont(binaryFont(unicode, version));
        assert.equal(font.name, 'Fixture');
        assert.equal(font.unicode, unicode);
        assert.deepEqual(drawingShxGlyph(font, 65), {
            parts: [{ type: 'line', x1: 5, y1: 0, x2: 4, y2: 0 }], advance: { x: 4, y: 0 },
        });
    }
    const font = parseDrawingShxFont(shp('*65,0,A\n7,02501,0\n*02501,0,line\n8,10,0,0', true));
    assert.equal(drawingShxGlyph(font, 65).parts[0].x2, 10);
});

test('SHX vectors preserve cumulative scale, while stack restoration moves without drawing', () => {
    const font = parseDrawingShxFont(shp('*65,0,A\n4,2,012,5,3,4,020,6,2,8,3,-4,0'));
    assert.deepEqual(drawingShxGlyph(font, 65), { parts: [
        { type: 'line', x1: 0, y1: 0, x2: 2, y2: 2 },
        { type: 'line', x1: 2, y1: 2, x2: 3, y2: 2 },
    ], advance: { x: 3.5, y: 0 } });
});

test('SHX octant, fractional and bulge arcs retain exact native circular geometry', () => {
    const font = parseDrawingShxFont(shp(`*65,0,circle
10,5,0,0
*66,0,clockwise
10,5,-002,0
*67,0,fractional
11,56,28,0,3,012,0
*68,0,bulge
12,10,0,127,13,10,0,-127,0,0,0`));
    const circle = drawingShxGlyph(font, 65).parts[0];
    assert.equal(circle.fullCircle, true); assert.equal(circle.cx, -5); assert.equal(circle.r, 5);
    const clockwise = drawingShxGlyph(font, 66); close(clockwise.advance.x, -5); close(clockwise.advance.y, -5);
    assert.equal(clockwise.parts[0].counterClockwise, false);
    const fractional = drawingShxGlyph(font, 67).parts[0];
    close(fractional.startAngle * 180 / Math.PI, 54.84375); close(fractional.endAngle * 180 / Math.PI, 94.921875);
    const bulge = drawingShxGlyph(font, 68); close(bulge.advance.x, 20); close(bulge.advance.y, 0);
    assert.equal(bulge.parts.length, 2); assert.equal(bulge.parts[0].counterClockwise, true); assert.equal(bulge.parts[1].counterClockwise, false);
    close(bulge.parts[0].cx, 5); close(bulge.parts[0].r, 5); close(bulge.parts[1].cx, 15);
});

test('SHX input rejects malformed records, recursion, unsafe scale and unbounded expansions', () => {
    for (const input of ['', '*65,1,A\n0', shp('*65,0,A\n8,10,0'), shp('*65,0,A\n15,0'), shp('*65,0,A\n3,0,0'),
        shp('*65,0,A\n0\n*65,0,duplicate\n0'), shp('*65,0,A\n10,0,0,0'), shp('*65,0,A\n12,1,1,-128,0'),
        shp('*65,0,A\n0,1'), shp('*65,0,A\n10,5,0177,0')]) assert.throws(() => parseDrawingShxFont(input));
    const binary = binaryFont();
    for (const end of [10, 24, 30, binary.length - 1]) assert.throws(() => parseDrawingShxFont(binary.subarray(0, end)));
    for (const codes of ['7,65', '6', '5,5,5,5,5', '5', '14', '7,66', '4,255,4,255,4,255']) {
        assert.throws(() => drawingShxGlyph(parseDrawingShxFont(shp(`*65,0,A\n${codes},0`)), 65));
    }
    const explosion = Array.from({ length: 15 }, (_, index) => `*${65 + index},0,g\n${index === 14 ? '010' : `7,${66 + index},7,${66 + index}`},0`).join('\n');
    assert.throws(() => drawingShxGlyph(parseDrawingShxFont(shp(explosion)), 65));
});
