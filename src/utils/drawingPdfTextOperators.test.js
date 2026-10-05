import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { advanceDrawingPdfText, initialDrawingPdfTextState } from './drawingPdfTextOperators.js';
import { extractDrawingPdfPaths } from './drawingPdfOperators.js';
import { readDrawingPdfPage } from './drawingPdfReader.js';
import { PDF_POINT_METRES } from './drawingPdfGeometry.js';

const ops = { beginText: 1, endText: 2, setFont: 3, setCharSpacing: 4, setWordSpacing: 5, setHScale: 6,
    setLeading: 7, setTextRise: 8, setTextRenderingMode: 9, moveText: 10, setLeadingMoveText: 11,
    nextLine: 12, setTextMatrix: 13, showText: 14, showSpacedText: 15, nextLineShowText: 16,
    nextLineSetSpacingShowText: 17, save: 20, restore: 21, beginMarkedContentProps: 22,
    endMarkedContent: 23, setFillRGBColor: 24, constructPath: 25, stroke: 26 };
const font = { fontMatrix: [0.001, 0, 0, 0.001, 0, 0], fallbackName: 'serif', bold: true };
const glyph = (unicode, width = 500) => ({ unicode, width, isSpace: unicode === ' ' });

test('PDF text advances preserve character/word spacing, TJ adjustments, rise, scale and line moves', () => {
    let state = initialDrawingPdfTextState();
    const apply = (name, args) => { const result = advanceDrawingPdfText(state, ops[name], args, ops, () => font); state = result.state; return result.run; };
    apply('setFont', ['font', 10]); apply('setCharSpacing', [1]); apply('setWordSpacing', [2]); apply('setHScale', [50]);
    apply('setTextRise', [3]); apply('setTextMatrix', [[1, 0, 0, 1, 20, 30]]);
    const first = apply('showText', [[glyph('A'), -200, glyph(' '), glyph('B')]]);
    assert.equal(first.text, 'A B'); assert.deepEqual(first.positions.map(item => item.x), [0, 8, 16]);
    assert.equal(first.advance, 22); assert.equal(state.x, 11);
    assert.deepEqual(first.matrix, { a: 5, b: 0, c: 0, d: -10, e: 20, f: 33 });
    const next = apply('showText', [[glyph('C')]]);
    assert.equal(next.matrix.e, 31);
    apply('setLeading', [12]); const newline = apply('nextLineShowText', [[glyph('D')]]);
    assert.equal(newline.matrix.e, 20); assert.equal(newline.matrix.f, 21);
    assert.throws(() => apply('setTextMatrix', [[1, 0, 0, 1, NaN, 0]]));
});

test('PDF text records retain graphics colour, optional visibility and saved text state', () => {
    const list = { fnArray: [], argsArray: [] };
    const add = (name, ...args) => { list.fnArray.push(ops[name]); list.argsArray.push(args); };
    add('setFont', 'font', 10); add('setFillRGBColor', '#ff0000'); add('save');
    add('setTextMatrix', [1, 0, 0, 1, 10, 20]); add('beginMarkedContentProps', 'OC', { id: 'hidden' });
    add('showText', [glyph('H')]); add('endMarkedContent'); add('setTextRenderingMode', 3); add('showText', [glyph('I')]);
    add('restore'); add('showText', [glyph('V')]);
    const result = extractDrawingPdfPaths(list, ops, { transform: [1, 0, 0, 1, 0, 0] }, { getFont: () => font, isVisible: () => false });
    assert.deepEqual(result.texts.map(run => run.visible), [false, false, true]);
    assert.equal(result.texts[2].matrix.e, 0); assert.equal(result.texts[2].fill, '#ff0000');
    assert.equal(result.texts[2].font.bold, true);
});

test('unrepresented glyph clipping suppresses unsafe vector snaps until graphics-state restoration', () => {
    const list = { fnArray: [20, 3, 9, 14, 2, 25, 21, 25], argsArray: [[], ['font', 10], [7], [[glyph('A')]], [],
        [26, [[0, 0, 0, 1, 10, 10]]], [], [26, [[0, 0, 0, 1, 10, 10]]]] };
    const result = extractDrawingPdfPaths(list, ops, { transform: [1, 0, 0, 1, 0, 0] }, { getFont: () => font });
    assert.ok(result.unsupported.includes('text-clip'));
    assert.deepEqual(result.records.map(record => record.visible), [false, true]);
});

test('real PDF text extraction retains physical baselines, rotation and colour without exposing invisible text', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    const pdf = new jsPDF({ unit: 'mm', format: [100, 100] });
    pdf.setFontSize(12); pdf.setTextColor(255, 0, 0); pdf.text('AB C', 10, 20);
    pdf.text('Rotated', 30, 40, { angle: 30 }); pdf.text('Hidden', 50, 60, { renderingMode: 'invisible' });
    const page = await readDrawingPdfPage(new Uint8Array(pdf.output('arraybuffer')), { pdfjs, createCanvas });
    const [first, rotated, hidden] = page.paths.texts;
    assert.equal(first.text, 'AB C'); assert.equal(first.fill, '#ff0000');
    assert.ok(Math.abs(first.matrix.e - 0.01) < 1e-8); assert.ok(Math.abs(first.matrix.f - 0.02) < 1e-8);
    assert.ok(Math.abs(first.matrix.a - 12 * PDF_POINT_METRES) < 1e-10);
    assert.ok(Math.abs(Math.atan2(rotated.matrix.b, rotated.matrix.a) + Math.PI / 6) < 1e-8);
    assert.equal(hidden.visible, false); assert.equal(first.clips.length, 1);
});
