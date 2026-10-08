import { closeDrawingPdfPath } from './drawingPdfGeometry.js';
import { attachDrawingRasterUnderlay } from './drawingRasterUnderlay.js';
import { curvePointAt, curveSubcurve, intersectCurves } from './drawingCurveKernel.js';
import { sampleDrawingBoundaryPath } from './drawingBoundaryDetection.js';
import { normalizeDrawingPdfUnderlay } from './drawingPdfMetadata.js';
import { createI18nError } from '../i18n/translator.js';

export function drawingPdfSnapEntities(records, { maxChecks = 1000000, budget = { remaining: maxChecks } } = {}) {
    const clips = new WeakMap();
    const prepare = clip => {
        if (clips.has(clip)) return clips.get(clip);
        const paths = clip.paths.map(closeDrawingPdfPath);
        const polygons = paths.map(sampleDrawingBoundaryPath);
        if (polygons.some(points => !points) || polygons.reduce((sum, points) => sum + points.length, 0) > 100000) throw createI18nError('pdf.limit');
        const result = { edges: paths.flatMap(path => path.parts), polygons, rule: clip.rule };
        clips.set(clip, result); return result;
    };
    const result = [];
    for (const record of records) {
        const paint = record.paint.toLowerCase();
        if (!record.visible || !(paint.includes('stroke') && record.strokeAlpha > 0 || paint.includes('fill') && record.fillAlpha > 0)) continue;
        let parts = record.paths.flatMap(path => (record.paint.toLowerCase().includes('fill') ? closeDrawingPdfPath(path) : path).parts);
        for (const source of record.clips) {
            const clip = prepare(source);
            parts = parts.flatMap(curve => {
                const cuts = [0, 1];
                for (const edge of clip.edges) {
                    if (--budget.remaining < 0) throw createI18nError('pdf.limit');
                    const hits = intersectCurves(curve, edge, { maxIntersectionChecks: Math.min(4096, Math.max(1, budget.remaining)), maxNumericSegments: 256 });
                    budget.remaining -= hits.checks || 0;
                    if (hits.truncated || budget.remaining < 0) throw createI18nError('pdf.limit');
                    cuts.push(...hits.points.map(hit => hit.leftT));
                }
                const sorted = [...new Set(cuts.map(value => Math.max(0, Math.min(1, value))))].sort((a, b) => a - b);
                const kept = [];
                for (let index = 1; index < sorted.length; index++) {
                    const a = sorted[index - 1]; const b = sorted[index];
                    if (b - a < 1e-10) continue;
                    const point = curvePointAt(curve, (a + b) / 2);
                    let winding = 0; let boundary = false;
                    for (const polygon of clip.polygons) {
                        for (let i = 0; i < polygon.length; i++) {
                            if (--budget.remaining < 0) throw createI18nError('pdf.limit');
                            const p = polygon[i]; const q = polygon[(i + 1) % polygon.length];
                            const cross = (q.x - p.x) * (point.y - p.y) - (point.x - p.x) * (q.y - p.y);
                            if (Math.abs(cross) <= 1e-10 * Math.max(1e-9, Math.hypot(q.x - p.x, q.y - p.y))
                                && point.x >= Math.min(p.x, q.x) - 1e-10 && point.x <= Math.max(p.x, q.x) + 1e-10
                                && point.y >= Math.min(p.y, q.y) - 1e-10 && point.y <= Math.max(p.y, q.y) + 1e-10) boundary = true;
                            if (p.y <= point.y && q.y > point.y && cross > 0) winding++;
                            else if (p.y > point.y && q.y <= point.y && cross < 0) winding--;
                        }
                    }
                    if (boundary || (clip.rule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0)) {
                        const part = curveSubcurve(curve, a, b); if (part) kept.push(part);
                    }
                }
                return kept;
            });
        }
        result.push(...parts);
        if (result.length > 100000) throw createI18nError('pdf.limit');
    }
    return result;
}

export function attachDrawingPdfUnderlay(document, page, sourceAsset, placement = {}) {
    const metadata = normalizeDrawingPdfUnderlay({ version: 1, assetId: sourceAsset.id, name: sourceAsset.name,
        pageNumber: page.pageNumber, pageCount: page.pageCount, width: page.width, height: page.height, layers: page.layers,
        snapEntities: drawingPdfSnapEntities(page.paths.records) });
    if (!metadata) throw createI18nError('pdf.invalid');
    return attachDrawingRasterUnderlay(document, page, sourceAsset, 'pdfUnderlay', metadata, placement,
        key => createI18nError(`pdf.${key}`));
}
