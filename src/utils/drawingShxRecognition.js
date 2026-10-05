import { curveLength, curvePointAt, extractEntityPaths } from './drawingCurveKernel.js';
import { pointToSegmentDistance } from './drawingGeometry.js';
import { drawingShxGlyph } from './drawingShxFont.js';

const LIMIT = 20000000;
const failure = () => { throw new Error('SHX recognition limit exceeded'); };
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const bounds = points => points.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), minY: Math.min(box.minY, point.y),
    maxX: Math.max(box.maxX, point.x), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
const boxSize = box => ({ x: box.maxX - box.minX, y: box.maxY - box.minY });

function sampledPart(part, project, scale, budget) {
    const length = curveLength(part);
    if (!Number.isFinite(length) || length <= 0) return null;
    const count = Math.max(part.type === 'line' ? 1 : 16, Math.ceil(length / scale * 32));
    if (count > 512 || (budget.points -= count + 1) < 0) failure();
    const points = Array.from({ length: count + 1 }, (_, index) => project(curvePointAt(part, index / count)));
    if (!points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) failure();
    return { points, bounds: bounds(points), length: length / scale };
}

function nearest(point, segments, budget) {
    let best = Infinity;
    for (const [a, b] of segments) {
        if (--budget.checks < 0) failure();
        best = Math.min(best, pointToSegmentDistance(point, a, b));
        if (best < 1e-10) break;
    }
    return best;
}

const segmentsOf = paths => paths.flatMap(path => path.points.slice(1).map((point, index) => [path.points[index], point]));

/** Recognize complete, individually editable stroke entities. Height is the known cap height in metres. */
export function recognizeDrawingShxGeometry(entities, font, { height, angle = 0, threshold = 95 } = {}, workBudget = null) {
    if (!Number.isFinite(height) || height <= 1e-8 || height > 1e6 || !Number.isFinite(angle)
        || !Number.isFinite(threshold) || threshold < 80 || threshold > 100 || entities.length > 5000) failure();
    const budget = workBudget || { checks: LIMIT, points: 200000 };
    const radians = angle * Math.PI / 180; const cos = Math.cos(radians); const sin = Math.sin(radians);
    // World coordinates have a downward Y axis; font coordinates have an upward Y axis.
    const project = point => ({ x: (point.x * cos + point.y * sin) / height, y: (point.x * sin - point.y * cos) / height });
    const unproject = point => ({ x: height * (point.x * cos + point.y * sin), y: height * (point.x * sin - point.y * cos) });
    const source = entities.filter(entity => ['line', 'arc', 'circle', 'ellipse', 'spline', 'polyline'].includes(entity.type)).map(entity => {
        const paths = extractEntityPaths(entity).flatMap(path => path.parts).map(part => sampledPart(part, project, height, budget)).filter(Boolean);
        return { entity, paths, points: paths.flatMap(path => path.points), segments: segmentsOf(paths) };
    }).filter(record => record.points.length);
    const tolerance = Math.max(1e-6, (100 - threshold) / 1000);
    const templates = [];
    for (const code of font.glyphs.keys()) {
        if (code < 33 || (code >= 127 && code < 160) || (code >= 0xd800 && code <= 0xdfff)) continue;
        let glyph;
        try { glyph = drawingShxGlyph(font, code); } catch { continue; }
        const paths = glyph.parts.map(part => sampledPart(part, point => ({ x: point.x / font.above, y: point.y / font.above }), font.above, budget)).filter(Boolean);
        if (!paths.length) continue;
        const points = paths.flatMap(path => path.points);
        templates.push({ code, paths, points, segments: segmentsOf(paths), bounds: bounds(points), advance: glyph.advance.x / font.above,
            length: paths.reduce((sum, path) => sum + path.length, 0) });
    }
    // Connected source contours also provide anchors when PDF cubic spans subdivide a font arc.
    const contours = [];
    const allPaths = source.flatMap(record => record.paths);
    const endpointIndex = new Map(); const parents = allPaths.map((_, index) => index);
    const root = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
    const cellSize = .002;
    for (const [index, path] of allPaths.entries()) {
        for (const point of [path.points[0], path.points.at(-1)]) {
            const ix = Math.floor(point.x / cellSize); const iy = Math.floor(point.y / cellSize);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                for (const entry of endpointIndex.get(`${ix + dx},${iy + dy}`) || []) {
                    if (--budget.checks < 0) failure();
                    if (distance(entry.point, point) <= cellSize) parents[root(index)] = root(entry.index);
                }
            }
            const key = `${ix},${iy}`; const entries = endpointIndex.get(key) || [];
            entries.push({ index, point }); endpointIndex.set(key, entries);
        }
    }
    const groups = new Map();
    allPaths.forEach((path, index) => { const key = root(index); const points = groups.get(key) || []; points.push(...path.points); groups.set(key, points); });
    for (const points of groups.values()) contours.push({ bounds: bounds(points) });
    const anchors = [...allPaths, ...contours];
    const candidates = []; const seen = new Set();
    for (const template of templates) {
        for (const pattern of [...template.paths, { bounds: template.bounds }]) {
            const size = boxSize(pattern.bounds);
            for (const anchor of anchors) {
                if (--budget.checks < 0) failure();
                const targetSize = boxSize(anchor.bounds);
                if (Math.abs(size.x - targetSize.x) > 2 * tolerance || Math.abs(size.y - targetSize.y) > 2 * tolerance) continue;
                const origin = { x: anchor.bounds.minX - pattern.bounds.minX, y: anchor.bounds.minY - pattern.bounds.minY };
                const key = `${template.code}:${Math.round(origin.x * 1e6)}:${Math.round(origin.y * 1e6)}`;
                if (seen.has(key)) continue;
                seen.add(key); if (seen.size > 100000) failure();
                const matched = []; const localSegments = []; let error = 0;
                for (const record of source) {
                    if (--budget.checks < 0) failure();
                    if ((budget.checks -= record.points.length) < 0) failure();
                    const local = record.points.map(point => ({ x: point.x - origin.x, y: point.y - origin.y }));
                    if (local.some(point => point.x < template.bounds.minX - tolerance || point.x > template.bounds.maxX + tolerance
                        || point.y < template.bounds.minY - tolerance || point.y > template.bounds.maxY + tolerance)) continue;
                    let recordError = 0;
                    for (const point of local) {
                        recordError = Math.max(recordError, nearest(point, template.segments, budget));
                        if (recordError > tolerance) break;
                    }
                    if (recordError > tolerance) continue;
                    error = Math.max(error, recordError); matched.push(record.entity.id);
                    localSegments.push(...record.segments.map(segment => segment.map(point => ({ x: point.x - origin.x, y: point.y - origin.y }))));
                }
                if (!matched.length) continue;
                for (const point of template.points) { error = Math.max(error, nearest(point, localSegments, budget)); if (error > tolerance) break; }
                if (error > tolerance) continue;
                candidates.push({ text: String.fromCodePoint(template.code), ids: matched, origin, confidence: Math.max(0, 100 - error * 1000),
                    advance: template.advance, length: template.length });
            }
        }
    }
    candidates.sort((a, b) => b.length - a.length || b.confidence - a.confidence);
    const alternatives = new Map();
    for (const candidate of candidates) {
        const key = [...candidate.ids].sort().join('\0');
        const entries = alternatives.get(key) || []; entries.push(candidate); alternatives.set(key, entries);
    }
    const used = new Set(); const matches = [];
    for (const candidate of candidates) {
        if (candidate.ids.some(id => used.has(id))) continue;
        // Identical outlines (for example O/0 in some fonts) are not guessed.
        const ambiguous = alternatives.get([...candidate.ids].sort().join('\0')).some(other => other.text !== candidate.text
            && Math.abs(other.confidence - candidate.confidence) < .1);
        if (ambiguous) continue;
        candidate.ids.forEach(id => used.add(id));
        matches.push({ ...candidate, position: unproject(candidate.origin), height, angle });
    }
    matches.sort((a, b) => Math.abs(a.origin.y - b.origin.y) > .1 ? b.origin.y - a.origin.y : a.origin.x - b.origin.x);
    return { matches, unmatchedIds: entities.filter(entity => !used.has(entity.id)).map(entity => entity.id) };
}
