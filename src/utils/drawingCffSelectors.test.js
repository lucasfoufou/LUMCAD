import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingCffSelectors } from './drawingCffSelectors.js';
import { readDrawingCffData } from './drawingCffData.js';
import { createDrawingFontOutlineReader } from './drawingFontOutlines.js';

test('CFF CID selectors cover every glyph with format 0 and format 3 dictionary assignments', () => {
    assert.deepEqual([...readDrawingCffSelectors(Uint8Array.of(0, 0, 1, 1), 0, 3, 2)], [0, 1, 1]);
    assert.deepEqual([...readDrawingCffSelectors(Uint8Array.of(3, 0, 2, 0, 0, 0, 0, 1, 1, 0, 3), 0, 3, 2)], [0, 1, 1]);
    for (const bytes of [[0,0], [0,0,1,2], [3,0,0], [3,0,1,0,1,0,0,3],
        [3,0,2,0,0,0,0,0,1,0,3], [3,0,1,0,0,0,0,2], [3,0,1,0,0,2,0,3]]) {
        assert.throws(() => readDrawingCffSelectors(Uint8Array.from(bytes), 0, 3, 2), /dwfxFont/);
    }
});

function fixture() {
    const integer = n => [29, n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255];
    const index = entries => {
        const offsets = [1]; for (const entry of entries) offsets.push(offsets.at(-1) + entry.length);
        return [entries.length >> 8, entries.length & 255, 1, ...offsets, ...entries.flat()];
    };
    const top = (chars, array, select) => [139,139,139,12,30,...integer(chars),17,...integer(array),12,36,...integer(select),12,37];
    const dictionary = (privateOffset, scale) => [...integer(2),...integer(privateOffset),18,scale+139,139,139,140,139,139,12,7];
    const bytes = [1,0,4,4,...index([[65]]),...index([top(0,0,0)]),0,0,0,0];
    const chars = bytes.length; bytes.push(...index([[139,139,21,32,10,14],[139,139,21,32,10,14]]));
    const select = bytes.length; bytes.push(0,0,1);
    const array = bytes.length; bytes.push(...index([dictionary(0,1),dictionary(0,2)]));
    const p0 = bytes.length; bytes.push(141,19,...index([[149,139,5,11]]));
    const p1 = bytes.length; bytes.push(141,19,...index([[159,139,5,11]]));
    bytes.splice(10,index([top(0,0,0)]).length,...index([top(chars,array,select)]));
    bytes.splice(array,index([dictionary(0,1),dictionary(0,2)]).length,...index([dictionary(p0,1),dictionary(p1,2)]));
    return { format: 'cff', tables: new Map([['CFF ', { bytes: Uint8Array.from(bytes) }]]) };
}

test('CID glyphs select independent local subroutines and concatenate dictionary matrices', () => {
    const resource = fixture(); const data = readDrawingCffData(resource, 2);
    assert.deepEqual([...data.fdSelect], [0,1]);
    assert.equal(data.fontDicts[0].localSubrs[0][0], 149);
    assert.equal(data.fontDicts[1].localSubrs[0][0], 159);
    const read = createDrawingFontOutlineReader(resource, { glyphCount: 2, unitsPerEm: 1000 });
    const identity = { a:1,b:0,c:0,d:1,e:0,f:0 };
    assert.equal(read.geometry(0, identity).paths[0].parts[0].x2, 10);
    assert.equal(read.geometry(1, identity).paths[0].parts[0].x2, 40);
});
