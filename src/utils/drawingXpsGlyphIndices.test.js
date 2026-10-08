import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingXpsGlyphIndices } from './drawingXpsGlyphIndices.js';

test('XPS clusters consume UTF-16 units separately from glyph entries without normalizing text', () => {
    const records = parseDrawingXpsGlyphIndices('fiA', '(2)19,50;,60');
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], { fields: ['19','50'], codePoint: null });
    assert.deepEqual(records[1], { fields: ['','60'], codePoint: 65 });
    assert.equal(parseDrawingXpsGlyphIndices('A', '(1:2)1,30;2,0,-10,20').length, 2);
    assert.equal(parseDrawingXpsGlyphIndices('😀A', '(2:1)5').at(-1).codePoint, 65);
    assert.equal(parseDrawingXpsGlyphIndices('e\u0301').length, 2);
    assert.equal(parseDrawingXpsGlyphIndices('{}{A')[0].codePoint, 123);
    assert.equal(parseDrawingXpsGlyphIndices('', '(2:2)1;2').length, 2);
});

test('XPS cluster syntax rejects partial groups, missing indices and split surrogate pairs', () => {
    for (const [text, indices] of [['A','(0:1)1'],['A','(1:0)1'],['A','(1:2)1'],['A','(2)1'],
        ['AA','(2)'],['A','(1:2)1;'],['A','(1:2)1;(1)2'],['😀A','1;2;3'],['😀',''],
        ['',''],['\ud800','1'],['{A',''],['A','(1:2)1;2;3']]) {
        assert.throws(() => parseDrawingXpsGlyphIndices(text, indices), /dwfxGlyphs/);
    }
    assert.throws(() => parseDrawingXpsGlyphIndices('A', '(1:1000000)1'), /dwfxLimit/);
});
