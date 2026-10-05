import { drawingPdfTextClipPaths } from './drawingPdfTextClip.js';
import { multiplyAffineMatrices } from './drawingAffine.js';
import { decodeDrawingPdfPath, drawingPdfPageMatrix, MAX_PDF_PATH_SEGMENTS } from './drawingPdfGeometry.js';
import { advanceDrawingPdfText, initialDrawingPdfTextState } from './drawingPdfTextOperators.js';

// Interpret the graphics-state portion of PDF.js' operator list. Keep clipping
// and optional-content membership with each path instead of losing either when
// producing editable geometry. The importer decides how to materialize records.
export function extractDrawingPdfPaths(list, ops, viewport, { placement, isVisible = () => true, getFont, getGlyphPath, limit = MAX_PDF_PATH_SEGMENTS } = {}) {
    if (!Array.isArray(list?.fnArray) || !Array.isArray(list?.argsArray) || list.fnArray.length !== list.argsArray.length
        || list.fnArray.length > 1000000) throw new RangeError('PDF operator limit exceeded.');
    let state = { matrix: drawingPdfPageMatrix(viewport, placement), stroke: '#000000', fill: '#000000',
        width: 1, strokeAlpha: 1, fillAlpha: 1, dash: [], clips: [], text: initialDrawingPdfTextState() };
    const stack = []; const marked = []; const records = []; const texts = []; const images = []; const unsupported = new Set();
    let textCharacters = 0; let paintOrder = 0;
    let pendingClip = null; let remaining = limit;
    let textClipPaths = null; let textClipInvalid = false;
    const save = () => { if (stack.length >= 128) throw new RangeError('PDF graphics stack limit exceeded.'); stack.push(state); state = { ...state }; };
    const restore = () => { if (stack.length) state = stack.pop(); };
    const transform = values => {
        if (!values || values.length !== 6 || !Array.from(values).every(Number.isFinite)) throw new TypeError('Invalid PDF graphics transform.');
        const [a, b, c, d, e, f] = values;
        state.matrix = multiplyAffineMatrices(state.matrix, { a, b, c, d, e, f });
    };
    const decode = data => {
        const paths = decodeDrawingPdfPath(data, state.matrix, remaining);
        remaining -= paths.reduce((sum, path) => sum + path.parts.length, 0);
        return paths;
    };
    const addImage = (source, localMatrix = null, crop = null, mask = false) => {
        if (mask && state.fillUnsupported) { unsupported.add('pattern-image-mask'); return; }
        if (images.length >= 10000) throw new RangeError('PDF image limit exceeded.');
        const matrix = localMatrix ? multiplyAffineMatrices(state.matrix, localMatrix) : state.matrix;
        images.push({ order: paintOrder++, source, crop, matrix: multiplyAffineMatrices(matrix, { a: 1, b: 0, c: 0, d: -1, e: 0, f: 1 }),
            maskColor: mask ? state.fill : null, alpha: mask && state.fillTransparent ? 0 : state.fillAlpha, clips: state.clips, optionalContent: marked.filter(Boolean),
            visible: !state.unknownClip && marked.every(item => !item || isVisible(item)) });
    };
    const paintNames = new Map(['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke', 'endPath'].map(name => [ops[name], name]));
    const ignored = new Set(['dependency', 'beginText', 'endText', 'setCharSpacing', 'setWordSpacing', 'setHScale', 'setLeading', 'setFont',
        'setTextRenderingMode', 'setTextRise', 'moveText', 'setLeadingMoveText', 'setTextMatrix', 'nextLine', 'showText', 'showSpacedText',
        'nextLineShowText', 'nextLineSetSpacingShowText', 'setCharWidth', 'setCharWidthAndBounds', 'setLineCap', 'setLineJoin', 'setMiterLimit',
        'setRenderingIntent', 'setFlatness', 'beginCompat', 'endCompat', 'markPoint', 'markPointProps'].map(name => ops[name]));
    for (let index = 0; index < list.fnArray.length; index++) {
        const operation = list.fnArray[index]; const args = list.argsArray[index] || [];
        if (operation === ops.save) save();
        else if (operation === ops.restore) restore();
        else if (operation === ops.transform) transform(args);
        else if (operation === ops.setStrokeRGBColor) { state.stroke = args[0]; state.strokeTransparent = false; state.strokeUnsupported = false; }
        else if (operation === ops.setFillRGBColor) { state.fill = args[0]; state.fillTransparent = false; state.fillUnsupported = false; }
        else if (operation === ops.setStrokeColorN) { state.strokeUnsupported = true; unsupported.add('pattern-stroke'); }
        else if (operation === ops.setFillColorN) { state.fillUnsupported = true; unsupported.add('pattern-fill'); }
        else if (operation === ops.setStrokeTransparent) state.strokeTransparent = true;
        else if (operation === ops.setFillTransparent) state.fillTransparent = true;
        else if (operation === ops.setLineWidth) state.width = args[0];
        else if (operation === ops.setDash) state.dash = args[0] || [];
        else if (operation === ops.setGState) {
            for (const [key, value] of args[0] || []) {
                if (key === 'CA') state.strokeAlpha = value;
                else if (key === 'ca') state.fillAlpha = value;
                else if (key === 'LW') state.width = value;
                else if (key === 'D') state.dash = value[0] || [];
                else if (key === 'SMask' && !value) { /* Explicitly disable a soft mask. */ }
                else if (key === 'Font') state.text = advanceDrawingPdfText(state.text, ops.setFont, value, ops, getFont).state;
                else if (!['LC', 'LJ', 'ML', 'RI', 'FL'].includes(key)) unsupported.add(`gstate:${key}`);
            }
        } else if (operation === ops.clip || operation === ops.eoClip) pendingClip = operation === ops.eoClip ? 'evenodd' : 'nonzero';
        else if (operation === ops.beginMarkedContent || operation === ops.beginMarkedContentProps) {
            if (marked.length >= 128) throw new RangeError('PDF marked-content limit exceeded.');
            marked.push(args[0] === 'OC' ? args[1] : null);
        } else if (operation === ops.endMarkedContent) marked.pop();
        else if (operation === ops.paintFormXObjectBegin) {
            save();
            if (args[0]) transform(args[0]);
            if (args[1]) {
                const [x0, y0, x1, y1] = args[1];
                const paths = decode([0, x0, y0, 1, x1, y0, 1, x1, y1, 1, x0, y1, 4]);
                state.clips = [...state.clips, { paths, rule: 'nonzero' }];
            }
        } else if (operation === ops.paintFormXObjectEnd) restore();
        else if (operation === ops.paintImageXObject || operation === ops.paintInlineImageXObject) addImage(args[0]);
        else if (operation === ops.paintImageMaskXObject) addImage(typeof args[0].data === 'string' ? args[0].data : args[0], null, null, true);
        else if (operation === ops.paintSolidColorImageMask) addImage({ width: 1, height: 1, data: new Uint8Array([0]) }, null, null, true);
        else if (operation === ops.paintImageMaskXObjectRepeat) {
            const [image, a, b, c, d, positions] = args;
            if (!positions || positions.length % 2 || positions.length > 20000) throw new RangeError('PDF image limit exceeded.');
            for (let i = 0; i < positions.length; i += 2) addImage(typeof image.data === 'string' ? image.data : image,
                { a, b, c, d, e: positions[i], f: positions[i + 1] }, null, true);
        } else if (operation === ops.paintImageMaskXObjectGroup) {
            if (!Array.isArray(args[0]) || args[0].length > 10000) throw new RangeError('PDF image limit exceeded.');
            for (const item of args[0]) {
                const [a, b, c, d, e, f] = item.transform;
                addImage(typeof item.data === 'string' ? item.data : item, { a, b, c, d, e, f }, null, true);
            }
        } else if (operation === ops.paintImageXObjectRepeat) {
            const [source, a, d, positions] = args;
            if (!positions || positions.length % 2 || positions.length > 20000) throw new RangeError('PDF image limit exceeded.');
            for (let i = 0; i < positions.length; i += 2) addImage(source, { a, b: 0, c: 0, d, e: positions[i], f: positions[i + 1] });
        } else if (operation === ops.paintInlineImageXObjectGroup) {
            if (!Array.isArray(args[1]) || args[1].length > 10000) throw new RangeError('PDF image limit exceeded.');
            for (const item of args[1]) {
                const [a, b, c, d, e, f] = item.transform;
                addImage(args[0], { a, b, c, d, e, f }, { x: item.x, y: item.y, width: item.w, height: item.h });
            }
        } else if (operation === ops.constructPath) {
            const paint = paintNames.get(args[0]);
            if (!paint) { unsupported.add(`paint:${args[0]}`); continue; }
            const paths = decode(args[1]?.[0] || []);
            if (paint !== 'endPath' && paths.length) records.push({ order: paintOrder++, paths, paint,
                stroke: state.stroke, fill: state.fill, strokeAlpha: state.strokeTransparent ? 0 : state.strokeAlpha,
                fillSupported: !state.fillUnsupported, strokeSupported: !state.strokeUnsupported,
                fillAlpha: state.fillTransparent ? 0 : state.fillAlpha,
                width: state.width, dash: [...state.dash], matrix: { ...state.matrix }, clips: state.clips,
                optionalContent: marked.filter(Boolean), visible: !state.unknownClip && marked.every(item => !item || isVisible(item)),
            });
            if (pendingClip) {
                state.clips = [...state.clips, { paths, rule: pendingClip }];
                pendingClip = null;
            }
        } else {
            const text = advanceDrawingPdfText(state.text, operation, args, ops, getFont);
            if (text) {
                state.text = text.state;
                if (text.unsupported) unsupported.add(text.unsupported);
                const contentVisible = marked.every(item => !item || isVisible(item));
                if (operation === ops.beginText) { textClipPaths = null; textClipInvalid = false; }
                if (text.unsupported && state.text.mode >= 4 && contentVisible && state.text.size) {
                    unsupported.add('text-clip'); textClipInvalid = true;
                }
                if (operation === ops.endText) {
                    if (textClipInvalid) state.unknownClip = true;
                    else if (textClipPaths) state.clips = [...state.clips, { paths: textClipPaths, rule: 'nonzero' }];
                    textClipPaths = null; textClipInvalid = false;
                }
                if (text.run) {
                    if (text.run.mode >= 4 && contentVisible && text.run.fontSize) {
                        const paths = drawingPdfTextClipPaths(text.run, state.matrix, getGlyphPath, remaining);
                        if (!paths) { unsupported.add('text-clip'); textClipInvalid = true; }
                        else {
                            remaining -= paths.reduce((sum,path) => sum + path.parts.length,0);
                            textClipPaths = [...(textClipPaths || []), ...paths];
                        }
                    }
                    textCharacters += text.run.text.length;
                    if (textCharacters > 100000) throw new RangeError('PDF text limit exceeded.');
                    texts.push({ order: paintOrder++, ...text.run, matrix: multiplyAffineMatrices(state.matrix, text.run.matrix),
                        fill: state.fill, stroke: state.stroke, fillAlpha: state.fillTransparent ? 0 : state.fillAlpha,
                        fillSupported: !state.fillUnsupported, strokeSupported: !state.strokeUnsupported,
                        strokeAlpha: state.strokeTransparent ? 0 : state.strokeAlpha, clips: state.clips,
                        optionalContent: marked.filter(Boolean), visible: !state.unknownClip && text.run.mode % 4 !== 3
                            && marked.every(item => !item || isVisible(item)) });
                }
            } else if (!ignored.has(operation)) unsupported.add(Object.keys(ops).find(key => ops[key] === operation) || String(operation));
        }
    }
    return { records, texts, images, unsupported: [...unsupported], segmentCount: limit - remaining };
}
