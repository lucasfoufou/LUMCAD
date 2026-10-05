import test from 'node:test';
import assert from 'node:assert/strict';
import { convertDrawingShxText, parseDrawingShxInput } from './drawingShxText.js';
import { parseDrawingShxFont } from './drawingShxFont.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const font = parseDrawingShxFont('*0,4,fixture\n10,2,0,0\n*32,0,space\n2,8,5,0,0\n*72,0,H\n5,8,0,10,6,2,8,6,0,1,8,0,10,2,8,0,-5,1,8,-6,0,2,8,8,-5,0');
function addH(document, prefix, x, layerId = document.content.activeLayerId) {
    const lines = [[0, 0, 0, -10], [6, 0, 6, -10], [0, -5, 6, -5]].map(([x1, y1, x2, y2], index) => ({
        id: `${prefix}${index}`, type: 'line', x1: x + x1, y1, x2: x + x2, y2, layerId, color: '#123456',
    }));
    document.content.entities.push(...lines); return lines.map(entity => entity.id);
}

test('SHX conversion combines adjacent glyphs and spaces, preserving unmatched/locked objects and archive text', () => {
    const document = createLcadDocument();
    document.content.layers.push({ ...document.content.layers[0], id: 'locked', name: 'Locked', locked: true });
    const ids = [...addH(document, 'a', 10), ...addH(document, 'b', 18), ...addH(document, 'c', 31), ...addH(document, 'd', 100, 'locked')];
    document.content.entities.push({ id: 'unmatched', type: 'line', x1: 200, y1: 0, x2: 201, y2: 1, layerId: document.content.activeLayerId });
    ids.push('unmatched');
    const before = structuredClone(document);
    const result = convertDrawingShxText(document.content, ids, font, { height: 10 });
    assert.deepEqual(result.report, { characters: 3, objects: 1, remaining: 4 });
    assert.equal(result.content.entities.length, 5);
    const text = result.content.entities[0];
    assert.equal(text.text, 'HH H'); assert.equal(text.color, '#123456'); assert.equal(text.affineFrame.e, 10);
    assert.equal(text.fitWidth, true); assert.equal(text.fontFamily, 'technical');
    assert.deepEqual(result.content.entities.slice(1), before.content.entities.slice(9));
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope({ ...document, content: result.content }))).document;
    assert.equal(restored.content.entities[0].text, 'HH H'); assert.deepEqual(restored.content.entities[0].affineFrame, text.affineFrame);
    assert.deepEqual(document, before);
});

test('SHX conversion is atomic for invalid input/no match and validates command options', () => {
    assert.deepEqual(parseDrawingShxInput('"/tmp/my font.shx" HEIGHT .35 ANGLE -30 THRESHOLD 98'), { path: '/tmp/my font.shx', height: .35, angle: -30, threshold: 98 });
    assert.deepEqual(parseDrawingShxInput('HEIGHT 2'), { path: null, height: 2, angle: 0, threshold: 95 });
    for (const input of ['', 'HEIGHT', 'HEIGHT 0', 'HEIGHT 1 HEIGHT 2', 'HEIGHT 1 THRESHOLD 50', 'HEIGHT 1 ANGLE NaN', 'HEIGHT 1 FONT a']) assert.throws(() => parseDrawingShxInput(input));
    const document = createLcadDocument(); const ids = addH(document, 'a', 10); const before = structuredClone(document);
    assert.throws(() => convertDrawingShxText(document.content, ids, font, { height: 20 }));
    assert.throws(() => convertDrawingShxText(document.content, [], font, { height: 10 }));
    assert.deepEqual(document, before);
});
