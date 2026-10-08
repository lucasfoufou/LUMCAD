import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingFontOutlineReader, drawingFontOutlineBounds } from './drawingFontOutlines.js';
import { curvePointAt } from './drawingCurveKernel.js';

test('CFF FontMatrix converts cubic outlines into font em units before page placement', () => {
    const program = [139, 139, 21, 149, 159, 169, 179, 189, 199, 8, 14];
    const bytes = Uint8Array.from([1,0,4,4,0,1,1,1,2,65,0,1,1,1,3,160,17,0,0,0,0,
        0,1,1,1,program.length+1,...program]);
    const resource = { format: 'cff', tables: new Map([['CFF ', { bytes }]]) };
    const read = createDrawingFontOutlineReader(resource, { glyphCount: 1, unitsPerEm: 2000 });
    const geometry = read.geometry(0, { a: .1, b: 0, c: 0, d: -.1, e: 5, f: 40 });
    const part = geometry.paths[0].parts[0];
    assert.equal(part.type, 'spline');
    assert.deepEqual(curvePointAt(part, 0), { x: 5, y: 40 });
    assert.deepEqual(curvePointAt(part, 1), { x: 23, y: 16 });
    assert.equal(read.yMax(0), 240);
    assert.equal(drawingFontOutlineBounds(geometry).minY, 16);
    assert.throws(() => read.geometry(1, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), /dwfxFont/);
});
