import { drawingWmfTextLayout } from './drawingWmfTextLayout.js';
import { prepareDrawingWmfImages } from './drawingWmfImages.js';
import { isDrawingDimensionEntity } from './drawingDimensions.js';
import { drawingDimensionExportEntities } from './drawingDimensionExport.js';
import { createDimensionSourceMap } from './drawingDimensionSources.js';
import { writeDrawingWmfFont, writeDrawingWmfExtTextOut } from './drawingWmfText.js';
import { drawingHatchLines } from './drawingHatchLines.js';
import { normalizeDrawingHatch } from './drawingAdvancedEntities.js';
import { drawingExportItems } from './drawingExportEntities.js';
import { getEntityAppearance } from './drawingDocument.js';
import { extractEntityPaths, getCurveStart, getCurveEnd } from './drawingCurveKernel.js';
import { sampleDrawingBoundaryPath } from './drawingBoundaryDetection.js';
import { createDrawingWmfWriter, drawingWmfWords } from './drawingWmfWriter.js';

/** Build a vector WMF candidate without mutating the drawing or saving a partial file. */
export function exportDrawingWmf(content, options = {}) {
    return exportEntities(content, drawingExportItems(content), options);
}

/** Snapshot model and embedded assets before asynchronous browser image decoding. */
export async function exportDrawingWmfWithAssets(content, assets, options = {}) {
    const snapshot = structuredClone({ content, assets });
    const items = drawingExportItems(snapshot.content);
    const images = await prepareDrawingWmfImages(items.map(item => item.entity), snapshot.assets, options);
    return exportEntities(snapshot.content, items, options, images);
}

function exportEntities(content, items, { maxPoints = 1000000, maxBytes, maxRecords, locale = 'en' } = {}, images = new Map()) {
    if (!Number.isSafeInteger(maxPoints) || maxPoints < 1) throw new Error('wmfLimit');
    const supported = new Set(['line', 'rectangle', 'polygon', 'polyline', 'circle', 'arc', 'ellipse', 'spline', 'hatch', 'text']);
    const outlines = []; const warnings = new Set(); let total = 0; const exported = new Set();
    if (items.some(item => item.pdfUnderlay)) warnings.add('pdfUnderlayPreview');
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const sources = createDimensionSourceMap([...content.entities, ...items.map(item => item.entity)], content.blocks, { layers: content.layers, textStyles: content.textStyles });
    const expanded = [];
    for (const { entity, clips } of items) {
        const rectangles = clips.map(wmfClipRectangle);
        const dimension = isDrawingDimensionEntity(entity);
        const parts = dimension ? drawingDimensionExportEntities(entity, sources, { locale }) : [entity];
        if (dimension && parts.some(part => part.type === 'text')) warnings.add('dimensionTextAppearance');
        if (expanded.length + parts.length > 100000) throw new Error('wmfLimit');
        for (const part of parts) expanded.push({ entity: part, source: entity, clips: rectangles });
    }
    for (const { entity, source, clips } of expanded) {
        const emit = item => outlines.push({ ...item, exportClips: clips });
        for (const clip of clips) {
            bounds.minX = Math.min(bounds.minX, clip.minX); bounds.minY = Math.min(bounds.minY, clip.minY);
            bounds.maxX = Math.max(bounds.maxX, clip.maxX); bounds.maxY = Math.max(bounds.maxY, clip.maxY);
        }
        if (!supported.has(entity.type) && !images.has(entity)) throw new Error('wmfExportUnsupported');
        const appearance = getEntityAppearance(content, entity);
        if (appearance.transparency !== 0) throw new Error('wmfExportTransparency');
        if (entity.type === 'image') {
            const image = images.get(entity);
            for (const point of image.points) {
                bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y);
                bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y);
            }
            if (image.kind === 'rasterPolygons') {
                for (const polygon of image.polygons) {
                    if ((total += polygon.points.length) > maxPoints) throw new Error('wmfLimit');
                    emit({ kind: 'fill', contours: [polygon.points], boundaryStroke: false, fillRule: 'nonzero',
                        appearance: { color: polygon.color, lineType: 'continuous', lineWeight: 1 } });
                }
                warnings.add('rasterPolygons');
            } else {
                if ((total += 4) > maxPoints) throw new Error('wmfLimit');
                emit(image);
            }
            warnings.add('rasterResampling'); exported.add(source); continue;
        }
        if (entity.type === 'text') {
            const layout = drawingWmfTextLayout(entity, content, appearance.color);
            for (const point of layout.points) {
                bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y);
                bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y);
            }
            for (const text of layout.texts) {
                if ((total += text.text.length) > maxPoints) throw new Error('wmfLimit');
                emit(text);
            }
            warnings.add('textFontMetrics'); exported.add(source); continue;
        }
        const fill = entity.type === 'hatch' ? normalizeDrawingHatch(entity) : null;
        if (fill && ['gradient', 'radial'].includes(fill.pattern.name)) throw new Error('wmfExportUnsupported');
        const paths = extractEntityPaths(fill || entity);
        const contours = [];
        if (!paths.length) throw new Error('wmfGeometry');
        for (const path of paths) {
            const native = !fill ? nativeWmfCurve(path) : null;
            const points = native ? native.points : sampleDrawingBoundaryPath(path);
            if (!points?.length) throw new Error('wmfLimit');
            if (!native) {
                points.push(getCurveEnd(path.parts.at(-1)));
                if (path.closed) points.push(points[0]);
            }
            if ((total += points.length) > maxPoints || points.length > 32767) throw new Error('wmfLimit');
            if (!native && path.parts.some(part => part.type !== 'line')) warnings.add('curvesSampled');
            for (const point of points) {
                if (!point || ![point.x, point.y].every(Number.isFinite)) throw new Error('wmfGeometry');
                bounds.minX = Math.min(bounds.minX, point.x); bounds.minY = Math.min(bounds.minY, point.y);
                bounds.maxX = Math.max(bounds.maxX, point.x); bounds.maxY = Math.max(bounds.maxY, point.y);
            }
            if (fill) {
                if (!path.closed) throw new Error('wmfGeometry');
                contours.push(points);
            } else emit({ points, appearance, ...(native || { kind: 'polyline' }) });
        }
        if (fill) {
            if (contours.reduce((sum, points) => sum + points.length, 0) > 32767) throw new Error('wmfLimit');
            if (fill.pattern.name === 'solid') {
                emit({ contours, appearance, kind: 'fill', fillRule: fill.fillRule || 'evenodd', boundaryStroke: fill.boundaryStroke !== false });
            } else {
                const lines = drawingHatchLines(contours, fill.pattern, { fillRule: fill.fillRule || 'evenodd', annotation: Boolean(entity.annotation) });
                if ((total += lines.length * 2) > maxPoints) throw new Error('wmfLimit');
                for (const points of lines) emit({ points, appearance: { ...appearance, lineType: 'continuous' }, kind: 'patternLine' });
                if (fill.boundaryStroke !== false) for (const points of contours) emit({ points, appearance, kind: 'polyline' });
                warnings.add('patternEdgeApproximation');
            }
        }
        exported.add(source);
    }
    if (!outlines.length) throw new Error('wmfEmpty');
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
    const stroke = outlines.reduce((width, item) => Math.max(width,
        item.appearance && item.kind !== 'text' && !(item.kind === 'fill' && !item.boundaryStroke)
            ? item.appearance.lineWeight * .0254 / 96 : 0), 0);
    const unitsPerInch = Math.min(1440, Math.floor(32752 * .0254 / Math.max(span + stroke, 1e-12)));
    if (unitsPerInch < 1) throw new Error('wmfPlacement');
    const unit = .0254 / unitsPerInch;
    // GDI/viewer extents exclude the lower/right boundary. Include complete strokes
    // and two logical units so geometry on any edge is not clipped by the file frame.
    const padding = Math.max(unit * 2, stroke / 2 + unit);
    bounds.minX -= padding; bounds.minY -= padding;
    bounds.maxX += padding; bounds.maxY += padding;
    const quantize = value => {
        const result = Math.round(value / unit);
        if (!Number.isFinite(result) || result < -32768 || result > 32767) throw new Error('wmfPlacement');
        return result;
    };
    const right = Math.max(1, quantize(bounds.maxX - bounds.minX));
    const bottom = Math.max(1, quantize(bounds.maxY - bounds.minY));
    const writer = createDrawingWmfWriter({ objects: 2, maxBytes, maxRecords,
        placeable: { left: 0, top: 0, right, bottom, unitsPerInch } });
    const append = (opcode, ...values) => writer.append(opcode, drawingWmfWords(...values));
    append(0x0103, 8); append(0x020b, 0, 0); append(0x020c, bottom, right);
    append(0x020d, 0, 0); append(0x020e, bottom, right); append(0x0102, 1);
    for (const item of outlines) {
        const { points, contours, appearance, kind, fillRule, boundaryStroke, start, end } = item;
        append(0x001e);
        for (const clip of item.exportClips) append(0x0416, quantize(clip.maxY - bounds.minY), quantize(clip.maxX - bounds.minX),
            quantize(clip.minY - bounds.minY), quantize(clip.minX - bounds.minX));
        if (kind === 'image') {
            if (item.clip) append(0x0416, quantize(item.clip.maxY - bounds.minY), quantize(item.clip.maxX - bounds.minX),
                quantize(item.clip.minY - bounds.minY), quantize(item.clip.minX - bounds.minX));
            const x = quantize(points[0].x - bounds.minX); const y = quantize(points[0].y - bounds.minY);
            const width = quantize(points[1].x - bounds.minX) - x;
            const height = quantize(points[3].y - bounds.minY) - y;
            if (!width || !height) throw new Error('wmfPlacement');
            // MS-WMF META_STRETCHDIB, DIB_RGB_COLORS and SRCCOPY.
            const header = drawingWmfWords(0x0020, 0x00cc, 0, item.height, item.width, 0, 0, height, width, y, x);
            const parameters = new Uint8Array(header.length + item.dib.length);
            parameters.set(header); parameters.set(item.dib, header.length);
            append(0x0107, 3); writer.append(0x0f43, parameters); append(0x0127, -1); continue;
        }
        const color = appearance.color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
        if (!color) throw new Error('wmfGeometry');
        const [r, g, b] = color.slice(1).map(value => parseInt(value, 16));
        if (kind === 'text') {
            writer.append(0x02fb, writeDrawingWmfFont({ ...item, height: -Math.max(1, quantize(item.height)), escapement: Math.round(item.escapement) }));
            append(0x012d, 0); append(0x0209, r | (g << 8), b); append(0x012e, 24);
            if (item.clip) append(0x0416, quantize(item.clip.maxY - bounds.minY), quantize(item.clip.maxX - bounds.minX),
                quantize(item.clip.minY - bounds.minY), quantize(item.clip.minX - bounds.minX));
            let distance = 0; let previous = 0;
            const advances = item.advances.map(advance => {
                // DX entries are signed WORDs individually; their cumulative distance
                // can exceed one WORD, notably for long diagonal text.
                distance += advance; const position = Math.round(distance / unit);
                if (!Number.isSafeInteger(position)) throw new Error('wmfPlacement');
                const result = position - previous; previous = position;
                if (result < -32768 || result > 32767) throw new Error('wmfPlacement');
                return result;
            });
            writer.append(0x0a32, writeDrawingWmfExtTextOut({ text: item.text, charset: item.charset, advances,
                x: quantize(item.point.x - bounds.minX), y: quantize(item.point.y - bounds.minY) }));
            append(0x0127, -1); append(0x01f0, 0); continue;
        }
        const style = { continuous: 0, dashed: 1, dotted: 2 }[appearance.lineType];
        if (style === undefined) throw new Error('wmfExportUnsupported');
        const width = Math.max(1, quantize(appearance.lineWeight * .0254 / 96));
        append(0x02fa, kind === 'fill' && !boundaryStroke ? 5 : kind === 'patternLine' ? 0x200 : style, width, 0, r | (g << 8), b);
        append(0x012d, 0);
        if (kind === 'fill') {
            append(0x02fc, 0, r | (g << 8), b, 0); append(0x012d, 1);
            append(0x0106, fillRule === 'nonzero' ? 2 : 1);
            append(0x0538, contours.length, ...contours.map(contour => contour.length),
                ...contours.flatMap(contour => contour.flatMap(point => [quantize(point.x - bounds.minX), quantize(point.y - bounds.minY)])));
        } else if (kind === 'ellipse' || kind === 'arc') {
            const box = [quantize(points[1].y - bounds.minY), quantize(points[1].x - bounds.minX),
                quantize(points[0].y - bounds.minY), quantize(points[0].x - bounds.minX)];
            if (box[0] === box[2] || box[1] === box[3]) throw new Error('wmfPlacement');
            if (kind === 'ellipse') {
                append(0x02fc, 1, 0, 0, 0); append(0x012d, 1); append(0x0418, ...box);
            } else {
                const a = [quantize(start.x - bounds.minX), quantize(start.y - bounds.minY)];
                const b = [quantize(end.x - bounds.minX), quantize(end.y - bounds.minY)];
                const ax = 2 * a[0] - box[1] - box[3]; const ay = 2 * a[1] - box[0] - box[2];
                const bx = 2 * b[0] - box[1] - box[3]; const by = 2 * b[1] - box[0] - box[2];
                if ((!ax && !ay) || (!bx && !by) || (ax * by === ay * bx && ax * bx + ay * by > 0)) throw new Error('wmfPlacement');
                append(0x0817, b[1], b[0], a[1], a[0], ...box);
            }
        } else append(0x0325, points.length, ...points.flatMap(point => [quantize(point.x - bounds.minX), quantize(point.y - bounds.minY)]));
        append(0x0127, -1); append(0x01f0, 0);
        if (kind === 'ellipse' || kind === 'fill') append(0x01f0, 1);
    }
    warnings.add('coordinateQuantization'); warnings.add('strokeApproximation');
    return { bytes: writer.finish(), report: { exported: exported.size, warnings: [...warnings],
        origin: { x: bounds.minX, y: bounds.minY }, coordinateStep: unit } };
}

/** WMF ellipse records accept axis-aligned ellipses and circular/elliptical arc radial points. */
function nativeWmfCurve(path) {
    if (path.parts.length !== 1) return null;
    const curve = path.parts[0];
    if (!['circle', 'arc', 'ellipse'].includes(curve.type)) return null;
    const quarter = (curve.rotation || 0) / 90;
    if (curve.type === 'ellipse' && Math.abs(quarter - Math.round(quarter)) > 1e-10) return null;
    const swap = Math.abs(Math.round(quarter)) % 2 === 1;
    const rx = curve.type === 'ellipse' ? (swap ? curve.ry : curve.rx) : curve.r;
    const ry = curve.type === 'ellipse' ? (swap ? curve.rx : curve.ry) : curve.r;
    const points = [{ x: curve.cx - rx, y: curve.cy - ry }, { x: curve.cx + rx, y: curve.cy + ry }];
    if (curve.type === 'circle' || curve.fullCircle || curve.fullEllipse) return { kind: 'ellipse', points };
    const start = getCurveStart(curve); const end = getCurveEnd(curve);
    // GDI arcs run counterclockwise on screen, opposite the stored positive-angle direction.
    return { kind: 'arc', points, start: curve.counterClockwise === false ? start : end,
        end: curve.counterClockwise === false ? end : start };
}

/** Reject nonrectangular clips instead of approximating them by their bounding box. */
function wmfClipRectangle(shape) {
    if (shape.paths.length !== 1 || shape.paths[0].parts.length !== 4 || shape.paths[0].parts.some(part => part.type !== 'line')) throw new Error('wmfExportUnsupported');
    const parts = shape.paths[0].parts;
    const points = parts.map(part => ({ x: part.x1, y: part.y1 }));
    const bounds = { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
        maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
    const epsilon = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1e-10;
    if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY) || !parts.every(part =>
        (Math.abs(part.x2 - part.x1) <= epsilon) !== (Math.abs(part.y2 - part.y1) <= epsilon))) throw new Error('wmfExportUnsupported');
    return bounds;
}
