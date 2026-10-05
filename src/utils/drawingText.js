const DEFAULT_FONT_SIZE = 0.35;
const MIN_FONT_SIZE = 0.01;
const MAX_FONT_SIZE = 1_000_000;
const DEFAULT_LINE_HEIGHT = 1.2;
const TEXT_MARK_KEYS = Object.freeze([
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'color',
    'fontFamily',
    'fontSize',
]);

export const DRAWING_TEXT_MODES = Object.freeze(['singleLine', 'multiline']);
export const DRAWING_TEXT_WRAP_MODES = Object.freeze(['word', 'character', 'none']);
export const DRAWING_TEXT_FONTS = Object.freeze([
    Object.freeze({ id: 'sans', cssFamily: 'SourceSans3, Arial, sans-serif' }),
    Object.freeze({ id: 'serif', cssFamily: 'Georgia, "Times New Roman", serif' }),
    Object.freeze({ id: 'monospace', cssFamily: 'Menlo, Monaco, Consolas, monospace' }),
    Object.freeze({ id: 'technical', cssFamily: '"Arial Narrow", Arial, sans-serif' }),
]);
export const DEFAULT_DRAWING_TEXT_STYLE_ID = 'text-style-standard';
export const DEFAULT_DRAWING_TEXT_STYLE = Object.freeze({
    id: DEFAULT_DRAWING_TEXT_STYLE_ID,
    name: 'Standard',
    fontFamily: 'sans',
    fontSize: DEFAULT_FONT_SIZE,
    fontWeight: 400,
    fontStyle: 'normal',
    underline: false,
    strikethrough: false,
    lineHeight: DEFAULT_LINE_HEIGHT,
});

const FONT_BY_ID = new Map(DRAWING_TEXT_FONTS.map(font => [font.id, font]));

export function normalizeDrawingTextStyle(style, fallback = DEFAULT_DRAWING_TEXT_STYLE) {
    const source = style && typeof style === 'object' && !Array.isArray(style) ? style : {};
    const safeFallback = fallback && typeof fallback === 'object' ? fallback : DEFAULT_DRAWING_TEXT_STYLE;
    return {
        ...source,
        id: nonEmptyString(source.id) || nonEmptyString(safeFallback.id) || DEFAULT_DRAWING_TEXT_STYLE_ID,
        name: nonEmptyString(source.name) || nonEmptyString(safeFallback.name) || DEFAULT_DRAWING_TEXT_STYLE.name,
        fontFamily: normalizeDrawingTextFont(source.fontFamily)
            || normalizeDrawingTextFont(safeFallback.fontFamily)
            || DEFAULT_DRAWING_TEXT_STYLE.fontFamily,
        fontSize: normalizeFontSize(source.fontSize)
            || normalizeFontSize(safeFallback.fontSize)
            || DEFAULT_FONT_SIZE,
        fontWeight: normalizeFontWeight(source.fontWeight)
            || normalizeFontWeight(safeFallback.fontWeight)
            || DEFAULT_DRAWING_TEXT_STYLE.fontWeight,
        fontStyle: normalizeFontStyle(source.fontStyle)
            || normalizeFontStyle(safeFallback.fontStyle)
            || DEFAULT_DRAWING_TEXT_STYLE.fontStyle,
        underline: typeof source.underline === 'boolean' ? source.underline : Boolean(safeFallback.underline),
        strikethrough: typeof source.strikethrough === 'boolean' ? source.strikethrough : Boolean(safeFallback.strikethrough),
        lineHeight: normalizeLineHeight(source.lineHeight)
            || normalizeLineHeight(safeFallback.lineHeight)
            || DEFAULT_LINE_HEIGHT,
    };
}

export function normalizeDrawingTextStyles(styles) {
    const normalized = [];
    const ids = new Set();
    const source = Array.isArray(styles) ? styles : [];
    source.forEach(style => {
        const next = normalizeDrawingTextStyle(style);
        if (!ids.has(next.id)) {
            ids.add(next.id);
            normalized.push(next);
        }
    });
    if (!ids.has(DEFAULT_DRAWING_TEXT_STYLE_ID)) normalized.unshift({ ...DEFAULT_DRAWING_TEXT_STYLE });
    return normalized;
}

export function addDrawingTextStyle(styles, style = {}) {
    const normalized = normalizeDrawingTextStyles(styles);
    const ids = new Set(normalized.map(candidate => candidate.id));
    const requestedId = nonEmptyString(style?.id);
    const id = requestedId && requestedId !== DEFAULT_DRAWING_TEXT_STYLE_ID && !ids.has(requestedId)
        ? requestedId
        : uniqueDrawingTextStyleId(style?.name, ids);
    const name = nonEmptyString(style?.name) || id;
    return [
        ...normalized,
        normalizeDrawingTextStyle({ ...DEFAULT_DRAWING_TEXT_STYLE, ...style, id, name }),
    ];
}

export function updateDrawingTextStyle(styles, styleId, patch) {
    const normalized = normalizeDrawingTextStyles(styles);
    const id = nonEmptyString(styleId);
    const sourcePatch = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    return normalized.map(style => style.id === id
        ? normalizeDrawingTextStyle({ ...style, ...sourcePatch, id: style.id }, style)
        : style);
}

export function removeDrawingTextStyle(styles, styleId) {
    const id = nonEmptyString(styleId);
    if (!id || id === DEFAULT_DRAWING_TEXT_STYLE_ID) return normalizeDrawingTextStyles(styles);
    return normalizeDrawingTextStyles(normalizeDrawingTextStyles(styles).filter(style => style.id !== id));
}

export function normalizeDrawingTextEntity(entity, {
    styles = null,
    defaultStyleId = DEFAULT_DRAWING_TEXT_STYLE_ID,
} = {}) {
    const source = entity && typeof entity === 'object' && !Array.isArray(entity) ? entity : {};
    const sourceHasText = typeof source.text === 'string';
    const sourceText = normalizeLineEndings(sourceHasText ? source.text : drawingTextRunsToText(source.runs));
    const runs = normalizeDrawingTextRuns(source.runs, sourceHasText ? sourceText : null);
    const text = drawingTextRunsToText(runs);
    const knownStyleIds = Array.isArray(styles)
        ? new Set(normalizeDrawingTextStyles(styles).map(style => style.id))
        : null;
    const requestedStyleId = nonEmptyString(source.textStyleId);
    const textStyleId = requestedStyleId && (!knownStyleIds || knownStyleIds.has(requestedStyleId))
        ? requestedStyleId
        : knownStyleIds?.has(defaultStyleId) ? defaultStyleId : DEFAULT_DRAWING_TEXT_STYLE_ID;
    const textMode = DRAWING_TEXT_MODES.includes(source.textMode) ? source.textMode : 'multiline';
    const normalized = {
        ...source,
        type: 'text',
        x: finiteOr(source.x, 0),
        y: finiteOr(source.y, 0),
        width: finiteOr(source.width, 0),
        height: finiteOr(source.height, 0),
        rotation: normalizeDegrees(source.rotation),
        mirrored: Boolean(source.mirrored),
        text,
        runs,
        textMode,
        textStyleId,
        wrapMode: textMode === 'singleLine'
            ? 'none'
            : DRAWING_TEXT_WRAP_MODES.includes(source.wrapMode) ? source.wrapMode : 'word',
        autoHeight: Boolean(source.autoHeight),
        horizontalAlign: ['left', 'center', 'right'].includes(source.horizontalAlign)
            ? source.horizontalAlign : 'left',
        verticalAlign: ['top', 'middle', 'bottom'].includes(source.verticalAlign)
            ? source.verticalAlign : 'top',
    };
    assignOrDelete(normalized, 'fontFamily', normalizeDrawingTextFont(source.fontFamily));
    assignOrDelete(normalized, 'fontSize', normalizeFontSize(source.fontSize));
    assignOrDelete(normalized, 'fontWeight', normalizeFontWeight(source.fontWeight));
    assignOrDelete(normalized, 'fontStyle', normalizeFontStyle(source.fontStyle));
    assignOrDelete(normalized, 'lineHeight', normalizeLineHeight(source.lineHeight));
    if (source.fitWidth === true && textMode === 'singleLine') normalized.fitWidth = true;
    else delete normalized.fitWidth;
    if (typeof source.underline === 'boolean') normalized.underline = source.underline;
    else delete normalized.underline;
    if (typeof source.strikethrough === 'boolean') normalized.strikethrough = source.strikethrough;
    else delete normalized.strikethrough;
    return normalized;
}

export function normalizeDrawingTextRuns(runs, fallbackText = null) {
    const hasRuns = Array.isArray(runs) && runs.every(run => (
        run && typeof run === 'object' && !Array.isArray(run) && typeof run.text === 'string'
    ));
    let normalized = hasRuns ? runs.map(run => ({
        text: normalizeLineEndings(run.text),
        marks: normalizeDrawingTextMarks(run.marks),
    })) : [];
    const requiredText = typeof fallbackText === 'string' ? normalizeLineEndings(fallbackText) : null;
    if (!hasRuns || (requiredText !== null && drawingTextRunsToText(normalized) !== requiredText)) {
        normalized = requiredText ? [{ text: requiredText, marks: {} }] : [];
    }
    return mergeDrawingTextRuns(normalized.filter(run => run.text.length > 0));
}

export function normalizeDrawingTextMarks(marks) {
    const source = marks && typeof marks === 'object' && !Array.isArray(marks) ? marks : {};
    const normalized = {};
    ['bold', 'italic', 'underline', 'strikethrough'].forEach(key => {
        if (typeof source[key] === 'boolean') normalized[key] = source[key];
    });
    const color = normalizeColor(source.color);
    const fontFamily = normalizeDrawingTextFont(source.fontFamily);
    const fontSize = normalizeFontSize(source.fontSize);
    if (color) normalized.color = color;
    if (fontFamily) normalized.fontFamily = fontFamily;
    if (fontSize) normalized.fontSize = fontSize;
    return normalized;
}

export function drawingTextRunsToText(runs) {
    return Array.isArray(runs) ? runs.map(run => typeof run?.text === 'string' ? run.text : '').join('') : '';
}

export function replaceDrawingTextRange(runs, selection, value, marks = null) {
    const normalized = normalizeDrawingTextRuns(runs);
    const text = drawingTextRunsToText(normalized);
    const range = normalizeDrawingTextSelection(selection, text);
    const replacement = normalizeLineEndings(String(value ?? ''));
    const inheritedMarks = marks === null ? drawingTextMarksAt(normalized, range.start) : normalizeDrawingTextMarks(marks);
    const pieces = [];
    let offset = 0;
    normalized.forEach(run => {
        const start = offset;
        const end = start + run.text.length;
        if (start < range.start) pieces.push({ text: run.text.slice(0, Math.min(run.text.length, range.start - start)), marks: run.marks });
        if (end > range.end) pieces.push({ text: run.text.slice(Math.max(0, range.end - start)), marks: run.marks, afterReplacement: true });
        offset = end;
    });
    const before = pieces.filter(piece => !piece.afterReplacement);
    const after = pieces.filter(piece => piece.afterReplacement).map(({ afterReplacement: _afterReplacement, ...piece }) => piece);
    return mergeDrawingTextRuns([
        ...before,
        ...(replacement ? [{ text: replacement, marks: inheritedMarks }] : []),
        ...after,
    ]);
}

export function applyDrawingTextMarks(runs, selection, patch) {
    const normalized = normalizeDrawingTextRuns(runs);
    const text = drawingTextRunsToText(normalized);
    const range = normalizeDrawingTextSelection(selection, text);
    if (range.start === range.end) return normalized;
    const markPatch = normalizeDrawingTextMarkPatch(patch);
    const result = [];
    let offset = 0;
    normalized.forEach(run => {
        const start = offset;
        const end = start + run.text.length;
        const overlapStart = Math.max(start, range.start);
        const overlapEnd = Math.min(end, range.end);
        if (overlapStart >= overlapEnd) result.push(run);
        else {
            if (overlapStart > start) result.push({ text: run.text.slice(0, overlapStart - start), marks: run.marks });
            result.push({
                text: run.text.slice(overlapStart - start, overlapEnd - start),
                marks: applyDrawingTextMarkPatch(run.marks, markPatch),
            });
            if (overlapEnd < end) result.push({ text: run.text.slice(overlapEnd - start), marks: run.marks });
        }
        offset = end;
    });
    return mergeDrawingTextRuns(result);
}

export function toggleDrawingTextMark(runs, selection, mark, fallbackValue = false) {
    if (!['bold', 'italic', 'underline', 'strikethrough'].includes(mark)) return normalizeDrawingTextRuns(runs);
    const state = getDrawingTextMarkValue(runs, selection, mark, fallbackValue);
    return applyDrawingTextMarks(runs, selection, { [mark]: state === true ? false : true });
}

export function getDrawingTextMarkValue(runs, selection, mark, fallbackValue = undefined) {
    if (!TEXT_MARK_KEYS.includes(mark)) return fallbackValue;
    const normalized = normalizeDrawingTextRuns(runs);
    const text = drawingTextRunsToText(normalized);
    const range = normalizeDrawingTextSelection(selection, text);
    if (range.start === range.end) return drawingTextMarksAt(normalized, range.start)?.[mark] ?? fallbackValue;
    const values = [];
    let offset = 0;
    normalized.forEach(run => {
        const end = offset + run.text.length;
        if (offset < range.end && end > range.start) values.push(run.marks?.[mark] ?? fallbackValue);
        offset = end;
    });
    if (!values.length) return fallbackValue;
    return values.every(value => value === values[0]) ? values[0] : 'mixed';
}

export function normalizeDrawingTextSelection(selection, textOrLength) {
    const text = typeof textOrLength === 'string' ? textOrLength : ''.padEnd(Math.max(0, Number(textOrLength) || 0), ' ');
    const length = text.length;
    const rawStart = clamp(Math.trunc(Number(selection?.start) || 0), 0, length);
    const rawEnd = clamp(Math.trunc(Number(selection?.end) || 0), 0, length);
    const start = graphemeBoundary(text, Math.min(rawStart, rawEnd), 'floor');
    const end = graphemeBoundary(text, Math.max(rawStart, rawEnd), 'ceil');
    return { start, end };
}

export function resolveDrawingTextStyle(entity, styles = []) {
    const normalizedStyles = normalizeDrawingTextStyles(styles);
    const source = entity && typeof entity === 'object' ? entity : {};
    const named = normalizedStyles.find(style => style.id === source.textStyleId)
        || normalizedStyles.find(style => style.id === DEFAULT_DRAWING_TEXT_STYLE_ID)
        || DEFAULT_DRAWING_TEXT_STYLE;
    const style = normalizeDrawingTextStyle({
        ...named,
        ...(normalizeDrawingTextFont(source.fontFamily) ? { fontFamily: source.fontFamily } : {}),
        ...(normalizeFontSize(source.fontSize) ? { fontSize: source.fontSize } : {}),
        ...(normalizeFontWeight(source.fontWeight) ? { fontWeight: source.fontWeight } : {}),
        ...(normalizeFontStyle(source.fontStyle) ? { fontStyle: source.fontStyle } : {}),
        ...(normalizeLineHeight(source.lineHeight) ? { lineHeight: source.lineHeight } : {}),
        ...(typeof source.underline === 'boolean' ? { underline: source.underline } : {}),
        ...(typeof source.strikethrough === 'boolean' ? { strikethrough: source.strikethrough } : {}),
    });
    return { ...style, cssFontFamily: getDrawingTextFontFamily(style.fontFamily) };
}

export function resolveDrawingTextRunStyle(baseStyle, marks = {}, fallbackColor = null) {
    const source = normalizeDrawingTextMarks(marks);
    const fontFamily = source.fontFamily || baseStyle.fontFamily || DEFAULT_DRAWING_TEXT_STYLE.fontFamily;
    const underline = Object.hasOwn(source, 'underline') ? source.underline : Boolean(baseStyle.underline);
    const strikethrough = Object.hasOwn(source, 'strikethrough') ? source.strikethrough : Boolean(baseStyle.strikethrough);
    return {
        fontFamily,
        cssFontFamily: getDrawingTextFontFamily(fontFamily),
        fontSize: source.fontSize || baseStyle.fontSize || DEFAULT_FONT_SIZE,
        fontWeight: Object.hasOwn(source, 'bold')
            ? source.bold ? 700 : 400
            : baseStyle.fontWeight || 400,
        fontStyle: Object.hasOwn(source, 'italic')
            ? source.italic ? 'italic' : 'normal'
            : baseStyle.fontStyle || 'normal',
        underline,
        strikethrough,
        textDecoration: [underline && 'underline', strikethrough && 'line-through'].filter(Boolean).join(' ') || 'none',
        lineHeight: baseStyle.lineHeight || DEFAULT_LINE_HEIGHT,
        color: source.color || fallbackColor || null,
    };
}

export function getDrawingTextFontFamily(fontFamily) {
    return FONT_BY_ID.get(normalizeDrawingTextFont(fontFamily))?.cssFamily
        || FONT_BY_ID.get(DEFAULT_DRAWING_TEXT_STYLE.fontFamily).cssFamily;
}

export function drawingTextFontSizeToPixels(fontSize, modelToScreenScale) {
    const normalizedFontSize = normalizeFontSize(fontSize) || DEFAULT_FONT_SIZE;
    const scale = Number(modelToScreenScale);
    return normalizedFontSize * (Number.isFinite(scale) && scale > 0 ? scale : 1);
}

export function getDrawingTextLayout(entity, options = {}) {
    const normalized = normalizeDrawingTextEntity(entity);
    const x = Math.min(normalized.x, normalized.x + normalized.width);
    const y = Math.min(normalized.y, normalized.y + normalized.height);
    const width = Math.abs(normalized.width);
    const height = Math.abs(normalized.height);
    const baseStyle = resolveDrawingTextStyle(normalized, options.styles);
    const padding = Math.min(baseStyle.fontSize * 0.16, width / 2, height / 2);
    const availableWidth = Math.max(0, width - padding * 2);
    const styledLines = layoutDrawingTextRuns(normalized.runs, availableWidth, baseStyle, {
        measureText: options.measureText,
        textMode: normalized.textMode,
        wrapMode: normalized.wrapMode,
        fallbackColor: options.color,
    });
    const blockHeight = styledLines.reduce((sum, line) => sum + line.height, 0);
    const horizontalAlign = normalized.horizontalAlign;
    const verticalAlign = normalized.verticalAlign;
    const textX = horizontalAlign === 'center' ? x + width / 2 : horizontalAlign === 'right' ? x + width - padding : x + padding;
    const textAnchor = horizontalAlign === 'center' ? 'middle' : horizontalAlign === 'right' ? 'end' : 'start';
    const blockTop = verticalAlign === 'middle'
        ? y + (height - blockHeight) / 2
        : verticalAlign === 'bottom'
            ? y + height - padding - blockHeight
            : y + padding;
    let lineTop = blockTop;
    const positionedLines = styledLines.map(line => {
        const positioned = {
            ...line,
            x: textX,
            top: lineTop,
            baseline: lineTop + line.baselineOffset,
            textAnchor,
        };
        lineTop += line.height;
        return positioned;
    });
    const lineHeight = baseStyle.fontSize * baseStyle.lineHeight;
    const firstBaseline = positionedLines[0]?.baseline ?? blockTop + baseStyle.fontSize;
    return {
        x,
        y,
        width,
        height,
        fontSize: baseStyle.fontSize,
        lineHeight,
        lines: positionedLines.map(line => line.text),
        styledLines: positionedLines,
        baseStyle,
        textX,
        textAnchor,
        blockTop,
        blockHeight,
        firstBaseline,
        availableWidth,
        fitWidth: normalized.fitWidth === true,
        textMode: normalized.textMode,
        wrapMode: normalized.wrapMode,
        autoHeight: normalized.autoHeight,
    };
}

export function wrapDrawingText(text, availableWidth, fontSize, options = {}) {
    const baseStyle = normalizeDrawingTextStyle({
        ...DEFAULT_DRAWING_TEXT_STYLE,
        fontSize: normalizeFontSize(fontSize) || DEFAULT_FONT_SIZE,
        ...(options.fontFamily ? { fontFamily: options.fontFamily } : {}),
    });
    return layoutDrawingTextRuns([{ text: normalizeLineEndings(String(text ?? '')), marks: {} }], availableWidth, baseStyle, {
        measureText: options.measureText,
        textMode: options.textMode || 'multiline',
        wrapMode: options.wrapMode || 'word',
    }).map(line => line.text);
}

export function layoutDrawingTextRuns(runs, availableWidth, baseStyle = DEFAULT_DRAWING_TEXT_STYLE, {
    measureText = null,
    textMode = 'multiline',
    wrapMode = 'word',
    fallbackColor = null,
} = {}) {
    const normalizedRuns = normalizeDrawingTextRuns(runs);
    const mode = DRAWING_TEXT_MODES.includes(textMode) ? textMode : 'multiline';
    const wrapping = mode === 'singleLine'
        ? 'none'
        : DRAWING_TEXT_WRAP_MODES.includes(wrapMode) ? wrapMode : 'word';
    const width = Number.isFinite(Number(availableWidth)) ? Math.max(0, Number(availableWidth)) : Infinity;
    const units = normalizedRuns.flatMap(run => segmentDrawingText(run.text).map(text => {
        const style = resolveDrawingTextRunStyle(baseStyle, run.marks, fallbackColor);
        const displayText = mode === 'singleLine' && text === '\n' ? ' ' : text;
        return {
            text: displayText,
            hardBreak: mode !== 'singleLine' && text === '\n',
            style,
            width: mode !== 'singleLine' && text === '\n'
                ? 0
                : measureDrawingText(displayText, style, measureText),
        };
    }));
    const paragraphs = [[]];
    units.forEach(unit => {
        if (unit.hardBreak) paragraphs.push([]);
        else paragraphs[paragraphs.length - 1].push(unit);
    });
    const lines = paragraphs.flatMap(paragraph => wrapDrawingTextParagraph(paragraph, width, wrapping));
    if (!lines.length) lines.push([]);
    return lines.map(unitsForLine => drawingTextLineFromUnits(unitsForLine, baseStyle));
}

export function segmentDrawingText(value) {
    const text = normalizeLineEndings(String(value ?? ''));
    if (!text) return [];
    if (typeof Intl?.Segmenter === 'function') {
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        return [...segmenter.segment(text)].map(segment => segment.segment);
    }
    return Array.from(text);
}

function wrapDrawingTextParagraph(units, availableWidth, wrapMode) {
    if (wrapMode === 'none' || !Number.isFinite(availableWidth)) return [units];
    if (!units.length) return [[]];
    const tokens = wrapMode === 'character' ? units.map(unit => [unit]) : drawingTextWordTokens(units);
    const lines = [];
    let current = [];
    let currentWidth = 0;
    const pushCurrent = () => {
        lines.push(current);
        current = [];
        currentWidth = 0;
    };
    const appendUnit = unit => {
        if (current.length && currentWidth + unit.width > availableWidth) pushCurrent();
        current.push(unit);
        currentWidth += unit.width;
    };
    tokens.forEach(token => {
        const tokenWidth = token.reduce((sum, unit) => sum + unit.width, 0);
        if (!current.length && tokenWidth <= availableWidth) {
            current.push(...token);
            currentWidth = tokenWidth;
        } else if (current.length && currentWidth + tokenWidth <= availableWidth) {
            current.push(...token);
            currentWidth += tokenWidth;
        } else {
            if (current.length) pushCurrent();
            if (tokenWidth <= availableWidth) {
                current.push(...token);
                currentWidth = tokenWidth;
            } else token.forEach(appendUnit);
        }
    });
    if (current.length || !lines.length) lines.push(current);
    return lines;
}

function drawingTextWordTokens(units) {
    const tokens = [];
    units.forEach(unit => {
        const whitespace = /^\s$/u.test(unit.text);
        const previous = tokens.at(-1);
        if (previous && /^\s$/u.test(previous[0].text) === whitespace) previous.push(unit);
        else tokens.push([unit]);
    });
    return tokens;
}

function drawingTextLineFromUnits(units, baseStyle) {
    const spans = [];
    units.forEach(unit => {
        const previous = spans.at(-1);
        if (previous && equalDrawingTextResolvedStyle(previous.style, unit.style)) {
            previous.text += unit.text;
            previous.width += unit.width;
        } else spans.push({ text: unit.text, width: unit.width, style: unit.style });
    });
    const maximumFontSize = spans.reduce((maximum, span) => Math.max(maximum, span.style.fontSize), baseStyle.fontSize);
    const height = spans.reduce((maximum, span) => (
        Math.max(maximum, span.style.fontSize * span.style.lineHeight)
    ), baseStyle.fontSize * baseStyle.lineHeight);
    return {
        text: spans.map(span => span.text).join(''),
        spans,
        width: spans.reduce((sum, span) => sum + span.width, 0),
        height,
        baselineOffset: maximumFontSize,
    };
}

function measureDrawingText(text, style, measureText) {
    if (typeof measureText === 'function') {
        const measured = Number(measureText(text, style));
        if (Number.isFinite(measured) && measured >= 0) return measured;
    }
    const familyFactor = style.fontFamily === 'monospace' ? 0.62 : 0.56;
    const weightFactor = style.fontWeight >= 700 ? 1.04 : 1;
    return segmentDrawingText(text).reduce((width, grapheme) => {
        if (/^\s$/u.test(grapheme)) return width + style.fontSize * 0.33;
        if (/[^\u0000-\u024f]/u.test(grapheme)) return width + style.fontSize;
        return width + style.fontSize * familyFactor * weightFactor;
    }, 0);
}

function mergeDrawingTextRuns(runs) {
    const merged = [];
    runs.forEach(run => {
        if (!run?.text) return;
        const marks = normalizeDrawingTextMarks(run.marks);
        const previous = merged.at(-1);
        if (previous && equalDrawingTextMarks(previous.marks, marks)) previous.text += run.text;
        else merged.push({ text: run.text, marks });
    });
    return merged;
}

function drawingTextMarksAt(runs, requestedOffset) {
    if (!runs.length) return {};
    const total = drawingTextRunsToText(runs).length;
    const offset = clamp(Number(requestedOffset) || 0, 0, total);
    let cursor = 0;
    for (const run of runs) {
        const end = cursor + run.text.length;
        if (offset < end || (offset === end && end === total)) return { ...run.marks };
        cursor = end;
    }
    return { ...runs.at(-1).marks };
}

function normalizeDrawingTextMarkPatch(patch) {
    const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    const normalized = {};
    TEXT_MARK_KEYS.forEach(key => {
        if (!Object.hasOwn(source, key)) return;
        const value = source[key];
        if (value === null || value === undefined) normalized[key] = null;
        else if (['bold', 'italic', 'underline', 'strikethrough'].includes(key) && typeof value === 'boolean') normalized[key] = value;
        else if (key === 'color' && normalizeColor(value)) normalized[key] = normalizeColor(value);
        else if (key === 'fontFamily' && normalizeDrawingTextFont(value)) normalized[key] = normalizeDrawingTextFont(value);
        else if (key === 'fontSize' && normalizeFontSize(value)) normalized[key] = normalizeFontSize(value);
    });
    return normalized;
}

function applyDrawingTextMarkPatch(marks, patch) {
    const next = { ...normalizeDrawingTextMarks(marks) };
    Object.entries(patch).forEach(([key, value]) => {
        if (value === null) delete next[key];
        else next[key] = value;
    });
    return next;
}

function equalDrawingTextMarks(left, right) {
    return TEXT_MARK_KEYS.every(key => left?.[key] === right?.[key]);
}

function equalDrawingTextResolvedStyle(left, right) {
    return ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'strikethrough', 'color']
        .every(key => left?.[key] === right?.[key]);
}

function graphemeBoundary(text, requestedOffset, direction) {
    const offset = clamp(requestedOffset, 0, text.length);
    if (offset === 0 || offset === text.length) return offset;
    const boundaries = [0];
    let cursor = 0;
    segmentDrawingText(text).forEach(grapheme => {
        cursor += grapheme.length;
        boundaries.push(cursor);
    });
    if (boundaries.includes(offset)) return offset;
    if (direction === 'ceil') return boundaries.find(boundary => boundary > offset) ?? text.length;
    return [...boundaries].reverse().find(boundary => boundary < offset) ?? 0;
}

function normalizeDrawingTextFont(value) {
    const font = String(value || '').trim();
    return FONT_BY_ID.has(font) ? font : null;
}

function uniqueDrawingTextStyleId(name, ids) {
    const slug = String(name || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'custom';
    const prefix = `text-style-${slug}`;
    let id = prefix;
    let suffix = 2;
    while (ids.has(id) || id === DEFAULT_DRAWING_TEXT_STYLE_ID) {
        id = `${prefix}-${suffix}`;
        suffix += 1;
    }
    return id;
}

function normalizeFontSize(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= MIN_FONT_SIZE && number <= MAX_FONT_SIZE ? number : null;
}

function normalizeFontWeight(value) {
    if (value === 'normal') return 400;
    if (value === 'bold') return 700;
    const number = Number(value);
    return [400, 700].includes(number) ? number : null;
}

function normalizeFontStyle(value) {
    return ['normal', 'italic'].includes(value) ? value : null;
}

function normalizeLineHeight(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0.8 && number <= 4 ? number : null;
}

function normalizeColor(value) {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : null;
}

function normalizeLineEndings(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
}

function normalizeDegrees(value) {
    const degrees = finiteOr(value, 0) % 360;
    return degrees < 0 ? degrees + 360 : degrees;
}

function assignOrDelete(target, key, value) {
    if (value !== null && value !== undefined) target[key] = value;
    else delete target[key];
}

function nonEmptyString(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || null;
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}
