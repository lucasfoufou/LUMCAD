import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_DRAWING_TEXT_STYLE_ID,
    addDrawingTextStyle,
    applyDrawingTextMarks,
    drawingTextFontSizeToPixels,
    drawingTextRunsToText,
    getDrawingTextLayout,
    getDrawingTextMarkValue,
    layoutDrawingTextRuns,
    normalizeDrawingTextEntity,
    normalizeDrawingTextSelection,
    normalizeDrawingTextStyles,
    replaceDrawingTextRange,
    removeDrawingTextStyle,
    resolveDrawingTextRunStyle,
    resolveDrawingTextStyle,
    segmentDrawingText,
    toggleDrawingTextMark,
    updateDrawingTextStyle,
    wrapDrawingText,
} from './drawingText.js';

const unitMeasure = text => segmentDrawingText(text).length;

test('legacy text normalizes to a wrapped multiline entity without losing content', () => {
    const normalized = normalizeDrawingTextEntity({
        id: 'legacy',
        type: 'text',
        x: '2',
        y: null,
        width: -4,
        height: 2,
        rotation: -90,
        text: 'First\r\nSecond',
        fontSize: -1,
        horizontalAlign: 'invalid',
    });

    assert.equal(normalized.id, 'legacy');
    assert.equal(normalized.x, 2);
    assert.equal(normalized.y, 0);
    assert.equal(normalized.width, -4);
    assert.equal(normalized.rotation, 270);
    assert.equal(normalized.text, 'First\nSecond');
    assert.deepEqual(normalized.runs, [{ text: 'First\nSecond', marks: {} }]);
    assert.equal(normalized.textMode, 'multiline');
    assert.equal(normalized.wrapMode, 'word');
    assert.equal(normalized.textStyleId, DEFAULT_DRAWING_TEXT_STYLE_ID);
    assert.equal(normalized.fontSize, undefined);
    assert.equal(normalized.horizontalAlign, 'left');
});

test('plain text remains authoritative when compatibility text and rich runs diverge', () => {
    const normalized = normalizeDrawingTextEntity({
        type: 'text',
        text: 'Edited by an older reader',
        runs: [{ text: 'Stale', marks: { bold: true } }],
    });

    assert.deepEqual(normalized.runs, [{ text: 'Edited by an older reader', marks: {} }]);
    assert.equal(normalized.text, 'Edited by an older reader');
});

test('controlled named styles and entity overrides resolve to safe CSS values', () => {
    const styles = normalizeDrawingTextStyles([
        {
            id: 'notes',
            name: 'Notes',
            fontFamily: 'serif',
            fontSize: 0.5,
            fontWeight: 'bold',
            fontStyle: 'italic',
            lineHeight: 1.4,
        },
        { id: 'notes', name: 'Duplicate', fontFamily: 'unknown' },
    ]);
    assert.equal(styles.filter(style => style.id === 'notes').length, 1);
    assert.equal(styles.some(style => style.id === DEFAULT_DRAWING_TEXT_STYLE_ID), true);

    const resolved = resolveDrawingTextStyle({
        textStyleId: 'notes',
        fontFamily: 'monospace',
        fontSize: 0.8,
        underline: true,
    }, styles);
    assert.equal(resolved.fontFamily, 'monospace');
    assert.match(resolved.cssFontFamily, /Menlo/);
    assert.equal(resolved.fontSize, 0.8);
    assert.equal(resolved.fontWeight, 700);
    assert.equal(resolved.fontStyle, 'italic');
    assert.equal(resolved.underline, true);

    const runStyle = resolveDrawingTextRunStyle(resolved, {
        bold: false,
        italic: false,
        underline: false,
        strikethrough: true,
        color: '#AABBCC',
        fontFamily: 'technical',
    });
    assert.equal(runStyle.fontWeight, 400);
    assert.equal(runStyle.fontStyle, 'normal');
    assert.equal(runStyle.textDecoration, 'line-through');
    assert.equal(runStyle.color, '#aabbcc');
    assert.match(runStyle.cssFontFamily, /Arial Narrow/);
});

test('named text style CRUD is immutable, collision-safe, and protects the standard style', () => {
    const original = normalizeDrawingTextStyles([]);
    const withFirst = addDrawingTextStyle(original, {
        name: 'Site Notes',
        fontFamily: 'serif',
        fontSize: 0.5,
    });
    const withSecond = addDrawingTextStyle(withFirst, { name: 'Site Notes' });
    assert.equal(withFirst.at(-1).id, 'text-style-site-notes');
    assert.equal(withSecond.at(-1).id, 'text-style-site-notes-2');
    assert.equal(original.length, 1);

    const updated = updateDrawingTextStyle(withSecond, 'text-style-site-notes', {
        id: 'replacement-id',
        name: 'Annotations',
        fontFamily: 'monospace',
        fontSize: -2,
    });
    const annotations = updated.find(style => style.id === 'text-style-site-notes');
    assert.equal(annotations.name, 'Annotations');
    assert.equal(annotations.fontFamily, 'monospace');
    assert.equal(annotations.fontSize, 0.5);

    const removed = removeDrawingTextStyle(updated, 'text-style-site-notes');
    assert.equal(removed.some(style => style.id === 'text-style-site-notes'), false);
    assert.equal(
        removeDrawingTextStyle(removed, DEFAULT_DRAWING_TEXT_STYLE_ID)
            .some(style => style.id === DEFAULT_DRAWING_TEXT_STYLE_ID),
        true,
    );
});

test('rich range formatting splits and merges runs deterministically', () => {
    const source = [{ text: 'abcdef', marks: {} }];
    const bold = applyDrawingTextMarks(source, { start: 2, end: 4 }, { bold: true });
    assert.deepEqual(bold, [
        { text: 'ab', marks: {} },
        { text: 'cd', marks: { bold: true } },
        { text: 'ef', marks: {} },
    ]);
    assert.equal(getDrawingTextMarkValue(bold, { start: 2, end: 4 }, 'bold', false), true);
    assert.equal(getDrawingTextMarkValue(bold, { start: 1, end: 3 }, 'bold', false), 'mixed');

    const toggled = toggleDrawingTextMark(bold, { start: 2, end: 4 }, 'bold');
    assert.equal(getDrawingTextMarkValue(toggled, { start: 2, end: 4 }, 'bold', false), false);
    assert.equal(drawingTextRunsToText(toggled), 'abcdef');
});

test('rich colours can be replaced over part or all of previously coloured text', () => {
    const red = applyDrawingTextMarks(
        [{ text: 'abcdef', marks: {} }],
        { start: 0, end: 6 },
        { color: '#ff0000' },
    );
    const partialBlue = applyDrawingTextMarks(red, { start: 2, end: 4 }, { color: '#0000ff' });
    assert.deepEqual(partialBlue, [
        { text: 'ab', marks: { color: '#ff0000' } },
        { text: 'cd', marks: { color: '#0000ff' } },
        { text: 'ef', marks: { color: '#ff0000' } },
    ]);

    const allGreen = applyDrawingTextMarks(partialBlue, { start: 0, end: 6 }, { color: '#00ff00' });
    assert.deepEqual(allGreen, [{ text: 'abcdef', marks: { color: '#00ff00' } }]);
    assert.deepEqual(
        normalizeDrawingTextEntity({ type: 'text', text: 'abcdef', runs: allGreen }).runs,
        allGreen,
    );
});

test('editor font pixels retain the exact model-to-screen scale without a visual minimum', () => {
    assert.equal(drawingTextFontSizeToPixels(5, 0.75), 3.75);
    assert.ok(Math.abs(drawingTextFontSizeToPixels(0.35, 0.1) - 0.035) < Number.EPSILON);
    assert.equal(drawingTextFontSizeToPixels(0.35, 50), 17.5);
});

test('range replacement preserves surrounding formatting and applies insertion marks', () => {
    const runs = [
        { text: 'ab', marks: { bold: true } },
        { text: 'cd', marks: { italic: true } },
        { text: 'ef', marks: {} },
    ];
    const replaced = replaceDrawingTextRange(runs, { start: 1, end: 5 }, 'X', { underline: true });
    assert.deepEqual(replaced, [
        { text: 'a', marks: { bold: true } },
        { text: 'X', marks: { underline: true } },
        { text: 'f', marks: {} },
    ]);
});

test('typing after a trailing hard break keeps the rich run and creates the next line', () => {
    const source = [{ text: 'Heading\n', marks: { bold: true, color: '#123456' } }];
    const replaced = replaceDrawingTextRange(source, { start: 8, end: 8 }, 'N');

    assert.deepEqual(replaced, [{
        text: 'Heading\nN',
        marks: { bold: true, color: '#123456' },
    }]);
    assert.equal(drawingTextRunsToText(replaced), 'Heading\nN');

    const layout = layoutDrawingTextRuns(replaced, 20, undefined, {
        measureText: unitMeasure,
        textMode: 'multiline',
        wrapMode: 'word',
    });
    assert.deepEqual(layout.map(line => line.text), ['Heading', 'N']);
    assert.equal(layout[1].spans[0].style.fontWeight, 700);
    assert.equal(layout[1].spans[0].style.color, '#123456');
});

test('selection boundaries never split a Unicode grapheme cluster', () => {
    const family = '👨‍👩‍👧‍👦';
    const text = `A${family}B`;
    const selection = normalizeDrawingTextSelection({ start: 2, end: 3 }, text);
    assert.equal(text.slice(selection.start, selection.end), family);

    const replaced = replaceDrawingTextRange([{ text, marks: {} }], selection, 'X');
    assert.equal(drawingTextRunsToText(replaced), 'AXB');
});

test('word, character, and disabled wrapping preserve all source whitespace', () => {
    assert.deepEqual(wrapDrawingText('one two', 4, 1, {
        measureText: unitMeasure,
        wrapMode: 'word',
    }), ['one ', 'two']);
    assert.deepEqual(wrapDrawingText('one two', 3, 1, {
        measureText: unitMeasure,
        wrapMode: 'character',
    }), ['one', ' tw', 'o']);
    assert.deepEqual(wrapDrawingText('one  two', 2, 1, {
        measureText: unitMeasure,
        wrapMode: 'none',
    }), ['one  two']);
});

test('hard line breaks and single-line display mode have distinct semantics', () => {
    const multiline = layoutDrawingTextRuns([{ text: 'a\n\nb', marks: {} }], 20, undefined, {
        measureText: unitMeasure,
        textMode: 'multiline',
        wrapMode: 'word',
    });
    assert.deepEqual(multiline.map(line => line.text), ['a', '', 'b']);

    const single = layoutDrawingTextRuns([{ text: 'a\nb', marks: {} }], 1, undefined, {
        measureText: unitMeasure,
        textMode: 'singleLine',
        wrapMode: 'character',
    });
    assert.deepEqual(single.map(line => line.text), ['a b']);
    assert.equal(single[0].width, 3);
});

test('rich layout exposes styled spans and variable line metrics', () => {
    const layout = layoutDrawingTextRuns([
        { text: 'AB', marks: { bold: true } },
        { text: 'CD', marks: { italic: true, fontSize: 2 } },
    ], 20, undefined, { measureText: unitMeasure });

    assert.equal(layout.length, 1);
    assert.equal(layout[0].text, 'ABCD');
    assert.equal(layout[0].spans.length, 2);
    assert.equal(layout[0].spans[0].style.fontWeight, 700);
    assert.equal(layout[0].spans[1].style.fontStyle, 'italic');
    assert.equal(layout[0].spans[1].style.fontSize, 2);
    assert.equal(layout[0].baselineOffset, 2);
    assert.equal(layout[0].height, 2.4);
});

test('full text layout retains the legacy fields while exposing positioned rich lines', () => {
    const layout = getDrawingTextLayout({
        type: 'text',
        x: 0,
        y: 10,
        width: 20,
        height: 5,
        text: 'Hello world !',
        fontSize: 0.86,
        horizontalAlign: 'center',
        verticalAlign: 'top',
    });

    assert.deepEqual(layout.lines, ['Hello world !']);
    assert.equal(layout.styledLines.length, 1);
    assert.equal(layout.styledLines[0].x, layout.textX);
    assert.equal(layout.styledLines[0].baseline, layout.firstBaseline);
    assert.equal(layout.textAnchor, 'middle');
    assert.ok(layout.blockTop > layout.y);
});
