import { canEditEntity, createDrawingId, DRAWING_LINE_WEIGHT_OPTIONS } from './drawingDocument.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { normalizeDrawingHatch } from './drawingAdvancedEntities.js';
import { transformDrawingEntityAffine, createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, getDrawingBlockReferenceBounds } from './drawingBlocks.js';
import { normalizeDrawingBlockClip } from './drawingBlockClip.js';
import { getEntityBounds } from './drawingGeometry.js';
import { curvePointAt, extractEntityPaths } from './drawingCurveKernel.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { createDrawingLinearStrokeFill, createDrawingCircularStrokeFill, createDrawingRoundStrokeFill } from './drawingStrokeGeometry.js';
import { drawingWmfTextEntities } from './drawingWmfTextEntity.js';
import { createDrawingWmfHatch, drawingWmfHatchClipPaths } from './drawingWmfHatch.js';
import { drawingRasterImageDataUrl } from './drawingRasterImage.js';

/** Build a complete native candidate; callers commit it through ordinary document history. */
export function importDrawingWmf(document, bytes, { x = 0, y = 0, scale = 1, dpi = 96, createCanvas, ...limits } = {}) {
    if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9) throw new Error('wmfPlacement');
    const { content } = document; const layerId = content.activeLayerId;
    if (!canEditEntity(content, { layerId })) throw new Error('wmfLayer');
    const decoded = readDrawingWmfGraphics(bytes, { dpi, ...limits });
    const entities = []; const warnings = new Set(); const blocks = [...(content.blocks || [])];
    const assets = [...(document.assets || [])]; let imageBytes = 0;
    let blockEntities = blocks.reduce((sum, block) => sum + block.entities.length, 0);
    let deviceClip = null;
    const matrix = { a: scale, b: 0, c: 0, d: scale, e: x, f: y };
    const add = source => {
        if (deviceClip) {
            const { minX, minY, maxX, maxY } = deviceClip;
            if (minX >= maxX || minY >= maxY) return;
            const blockClip = normalizeDrawingBlockClip({ points: [{ x: minX, y: minY }, { x: maxX, y: minY },
                { x: maxX, y: maxY }, { x: minX, y: maxY }] });
            if (!blockClip) throw new Error('wmfGeometry');
            if (blocks.length >= 1024 || blockEntities >= 100000) throw new Error('wmfLimit');
            const definition = createAnonymousDrawingBlock([{ ...source, id: createDrawingId(source.type), layerId }]);
            const reference = { ...createAnonymousDrawingBlockReference(definition, { layerId }), blockClip };
            if (!getDrawingBlockReferenceBounds(reference, [...blocks, definition])) return;
            blocks.push(definition); blockEntities++; source = reference;
            warnings.add('deviceClipBlock');
        }
        const entity = transformDrawingEntityAffine({ ...source, id: createDrawingId(source.type), layerId }, matrix);
        const bounds = getEntityBounds(entity);
        if (!bounds || !Object.values(bounds).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('wmfPlacement');
        if (content.entities.length + entities.length >= 100000) throw new Error('wmfLimit');
        entities.push(entity);
    };
    for (const primitive of decoded.primitives) {
        deviceClip = primitive.deviceClip || null;
        if (primitive.kind === 'bitmap') {
            const image = drawingRasterImageDataUrl(primitive.bitmap, primitive.crop, createCanvas);
            imageBytes += image.link.length;
            if (imageBytes > 64 * 1024 * 1024) throw new Error('wmfLimit');
            let asset = assets.find(candidate => candidate.link === image.link);
            if (!asset) {
                if (assets.length >= 512) throw new Error('wmfLimit');
                asset = { ...image, id: createDrawingId('asset'), name: `WMF ${assets.length + 1}.png` }; assets.push(asset);
            }
            const [a, b] = primitive.points;
            add({ type: 'image', assetId: asset.id, x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1, includeInPdf: true,
                affineFrame: { a: b.x - a.x, b: 0, c: 0, d: b.y - a.y, e: a.x, f: a.y }, imageRendering: 'pixelated' });
            continue;
        }
        if (primitive.kind === 'text') {
            const texts = drawingWmfTextEntities({ ...primitive, clipped: false },
                { maxEntities: primitive.clipped ? 100000 - blockEntities : 100000 - content.entities.length - entities.length });
            if (primitive.opaque) {
                const { rectangle, mapping } = primitive;
                if (!rectangle) throw new Error('wmfGeometry');
                const points = [{ x: rectangle.left, y: rectangle.top }, { x: rectangle.right, y: rectangle.bottom }]
                    .map(point => ({ x: point.x * mapping.scaleX + mapping.offsetX, y: point.y * mapping.scaleY + mapping.offsetY }));
                if (points[0].x !== points[1].x && points[0].y !== points[1].y) {
                    const background = buildDrawingEntity('rectangle', points[0], points[1], layerId);
                    add(normalizeDrawingHatch({ type: 'hatch', boundaries: extractEntityPaths(background),
                        color: primitive.backgroundColor, pattern: { name: 'solid' }, fillRule: 'nonzero', boundaryStroke: false }));
                }
            }
            if (texts.length) {
                if (primitive.clipped) {
                    const { rectangle, mapping } = primitive;
                    if (!rectangle) throw new Error('wmfGeometry');
                    const { left, right, top, bottom } = rectangle;
                    const points = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
                        .map(point => ({ x: point.x * mapping.scaleX + mapping.offsetX, y: point.y * mapping.scaleY + mapping.offsetY }));
                    if (left === right || top === bottom) continue;
                    const blockClip = normalizeDrawingBlockClip({ points });
                    if (!blockClip) throw new Error('wmfGeometry');
                    if (blocks.length >= 1024 || blockEntities + texts.length > 100000) throw new Error('wmfLimit');
                    const definition = createAnonymousDrawingBlock(texts.map(text => ({ ...text, id: createDrawingId('text'), layerId })));
                    const reference = { ...createAnonymousDrawingBlockReference(definition, { layerId }), blockClip };
                    if (!getDrawingBlockReferenceBounds(reference, [definition])) continue;
                    blocks.push(definition); blockEntities += texts.length; add(reference);
                    warnings.add('textClipBlock');
                } else texts.forEach(add);
                warnings.add('textFontMetrics');
                if (primitive.advances) warnings.add('textCharacters');
            }
            continue;
        }
        const paths = primitiveEntities(primitive, layerId);
        if (primitive.fill) {
            const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries: paths.flatMap(path => extractEntityPaths(path)),
                color: primitive.fill, pattern: { name: 'solid' }, fillRule: primitive.fillRule, boundaryStroke: false });
            if (hatch.boundaries.length !== paths.length) throw new Error('wmfGeometry');
            if (primitive.fillHatch) {
                if (primitive.fillHatch.background) add({ ...hatch, color: primitive.fillHatch.background });
                const pattern = createDrawingWmfHatch(paths, primitive.fillHatch.style, primitive.fill, { dpi });
                if (pattern) {
                    if (blocks.length >= 1024 || blockEntities >= 100000) throw new Error('wmfLimit');
                    const blockClip = normalizeDrawingBlockClip({ paths: drawingWmfHatchClipPaths(paths), rule: primitive.fillRule });
                    if (!blockClip) throw new Error('wmfGeometry');
                    const definition = createAnonymousDrawingBlock([{ ...pattern, id: createDrawingId('hatch'), layerId }]);
                    const reference = { ...createAnonymousDrawingBlockReference(definition, { layerId }), blockClip };
                    blocks.push(definition); blockEntities++; add(reference);
                }
                warnings.add('hatchPattern');
            } else add(hatch);
        }
        if (primitive.stroke) {
            const pen = primitive.stroke;
            if (!pen.cosmetic && pen.style === 0) {
                const outline = createDrawingLinearStrokeFill(paths, pen.width, pen.color,
                    { endCap: pen.endCap || 'round', join: pen.join || 'round' })
                    || createDrawingCircularStrokeFill(paths, pen.width, pen.color, { endCap: pen.endCap || 'round' })
                    || createDrawingRoundStrokeFill(paths, pen.width, pen.color,
                        { endCap: pen.endCap || 'round', join: pen.join || 'round' });
                if (outline) { add(outline); continue; }
            }
            // Reuse native continuous display widths where the document format supports them.
            const pixels = pen.width * dpi / 0.0254;
            const lineWeight = DRAWING_LINE_WEIGHT_OPTIONS.reduce((best, value) => Math.abs(value - pixels) < Math.abs(best - pixels) ? value : best, 1);
            const widthAppearance = pixels > 0 && pixels <= 100 ? { lineWidth: pixels } : { lineWeight };
            if (!Object.hasOwn(widthAppearance, 'lineWidth')) warnings.add('strokeWeight');
            if (!pen.cosmetic) warnings.add('physicalStrokeWidth');
            if (pen.style >= 3) warnings.add('strokeStyle');
            if (pen.endCap || pen.join) warnings.add('strokeCapsAndJoins');
            const lineType = pen.style === 2 ? 'dotted' : pen.style >= 1 && pen.style <= 4 ? 'dashed' : 'continuous';
            for (const path of paths) add({ ...path, color: pen.color, ...widthAppearance, lineType });
        }
    }
    if (!entities.length) throw new Error('wmfEmpty');
    return { ...document, assets, content: { ...content, blocks, entities: [...content.entities, ...entities] },
        selectedIds: entities.map(entity => entity.id), report: { imported: entities.length, warnings: [...warnings] } };
}

function primitiveEntities(primitive, layerId) {
    const points = primitive.points;
    if (primitive.kind === 'rectangle') return [buildDrawingEntity('rectangle', points[0], points[1], layerId)];
    if (primitive.kind === 'roundRectangle') return [roundedRectangle(primitive, layerId)];
    if (['ellipse', 'ellipseArc', 'chord', 'pie'].includes(primitive.kind)) {
        const [a, b] = points;
        if (a.x === b.x || a.y === b.y) throw new Error('wmfGeometry');
        const ellipse = { type: 'ellipse', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
            rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2,
            rotation: 0, startAngle: primitive.startAngle || 0, endAngle: primitive.endAngle || 0,
            counterClockwise: primitive.counterClockwise ?? true, fullEllipse: primitive.kind === 'ellipse' || primitive.fullEllipse };
        if (['ellipse', 'ellipseArc'].includes(primitive.kind) || ellipse.fullEllipse) return [ellipse];
        const start = curvePointAt(ellipse, 0); const end = curvePointAt(ellipse, 1);
        const line = (from, to) => ({ type: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y });
        const center = { x: ellipse.cx, y: ellipse.cy };
        return [{ type: 'polyline', closed: true, parts: [ellipse,
            ...(primitive.kind === 'pie' ? [line(end, center), line(center, start)] : [line(end, start)])] }];
    }
    if (primitive.kind === 'polyline' && points.length === 2) return [buildDrawingEntity('line', points[0], points[1], layerId)];
    const lengths = primitive.contourLengths || [points.length]; let offset = 0;
    return lengths.map(length => {
        const path = { type: 'polyline', points: points.slice(offset, offset + length), closed: primitive.kind !== 'polyline' };
        offset += length; return path;
    });
}

function roundedRectangle(primitive, layerId) {
    const [a, b] = primitive.points;
    const left = Math.min(a.x, b.x); const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y); const bottom = Math.max(a.y, b.y);
    const rx = Math.min(primitive.cornerRadiusX, (right - left) / 2);
    const ry = Math.min(primitive.cornerRadiusY, (bottom - top) / 2);
    if (!rx || !ry) return buildDrawingEntity('rectangle', a, b, layerId);
    const parts = [];
    const line = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) parts.push({ type: 'line', x1, y1, x2, y2 }); };
    const arc = (cx, cy, startAngle, endAngle) => parts.push({ type: 'ellipse', cx, cy, rx, ry,
        rotation: 0, startAngle, endAngle, counterClockwise: true, fullEllipse: false });
    line(left + rx, top, right - rx, top);
    arc(right - rx, top + ry, -Math.PI / 2, 0);
    line(right, top + ry, right, bottom - ry);
    arc(right - rx, bottom - ry, 0, Math.PI / 2);
    line(right - rx, bottom, left + rx, bottom);
    arc(left + rx, bottom - ry, Math.PI / 2, Math.PI);
    line(left, bottom - ry, left, top + ry);
    arc(left + rx, top + ry, Math.PI, Math.PI * 1.5);
    return { type: 'polyline', closed: true, parts };
}
