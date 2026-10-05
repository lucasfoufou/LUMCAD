import { getCurveStart, getCurveEnd } from './drawingCurveKernel.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, transformAffinePoint } from './drawingAffine.js';

export const PDF_POINT_METRES = 0.0254 / 72;
export const MAX_PDF_PATH_SEGMENTS = 100000;

// PDF.js DrawOPS contain exact cubic controls, not a tessellated display path.
// Decode them independently of the renderer so snaps and imports share geometry.
export function decodeDrawingPdfPath(data, matrix = IDENTITY_AFFINE_MATRIX, limit = MAX_PDF_PATH_SEGMENTS) {
    if (!data || !Number.isSafeInteger(data.length) || data.length > limit * 7) throw new RangeError('PDF path limit exceeded.');
    const paths = [];
    let path = null; let current = null; let start = null; let offset = 0; let count = 0;
    const point = () => {
        const x = data[offset++]; const y = data[offset++];
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Invalid PDF path coordinate.');
        const result = transformAffinePoint({ x, y }, matrix);
        if (![result.x, result.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new RangeError('PDF coordinate limit exceeded.');
        return result;
    };
    const add = part => {
        if (!path || !current) throw new TypeError('PDF path has no initial point.');
        if (++count > limit) throw new RangeError('PDF path limit exceeded.');
        path.parts.push(part);
    };
    const line = end => { add({ type: 'line', x1: current.x, y1: current.y, x2: end.x, y2: end.y }); current = end; };
    while (offset < data.length) {
        const operation = data[offset++];
        if (operation === 0) {
            current = point(); start = current;
            path = { type: 'polyline', parts: [], closed: false };
            paths.push(path);
        } else if (operation === 1) {
            if (!current) throw new TypeError('PDF path has no initial point.');
            line(point());
        } else if (operation === 2) {
            const first = point(); const second = point(); const end = point();
            add({ type: 'spline', degree: 3, controlPoints: [current, first, second, end] });
            current = end;
        } else if (operation === 3) {
            const control = point(); const end = point();
            if (!current) throw new TypeError('PDF path has no initial point.');
            add({ type: 'spline', degree: 3, controlPoints: [current,
                { x: current.x + (control.x - current.x) * 2 / 3, y: current.y + (control.y - current.y) * 2 / 3 },
                { x: end.x + (control.x - end.x) * 2 / 3, y: end.y + (control.y - end.y) * 2 / 3 }, end] });
            current = end;
        } else if (operation === 4) {
            if (!current || !path) throw new TypeError('PDF path has no initial point.');
            if (Math.hypot(current.x - start.x, current.y - start.y) > 1e-12) line(start);
            path.closed = true;
            current = start;
        } else throw new TypeError('Unsupported PDF path operator.');
    }
    return paths.filter(item => item.parts.length);
}

export function drawingPdfPageMatrix(viewport, { x = 0, y = 0, scale = 1 } = {}) {
    if (!Array.isArray(viewport?.transform) || viewport.transform.length !== 6
        || !viewport.transform.every(Number.isFinite) || ![x, y, scale].every(Number.isFinite)
        || scale <= 0 || scale > 1e9) throw new TypeError('Invalid PDF page transform.');
    const [a, b, c, d, e, f] = viewport.transform;
    const metres = PDF_POINT_METRES * scale;
    return multiplyAffineMatrices({ a: metres, b: 0, c: 0, d: metres, e: x, f: y }, { a, b, c, d, e, f });
}

export function closeDrawingPdfPath(path) {
    const parts = path.parts.filter(part => part.type !== 'line' || Math.hypot(part.x2 - part.x1, part.y2 - part.y1) > 1e-12);
    if (!parts.length) return { ...path, parts, closed: true };
    const first = getCurveStart(parts[0], { epsilon: 1e-12 }); const last = getCurveEnd(parts.at(-1), { epsilon: 1e-12 });
    if (!first || !last) throw new TypeError('Invalid PDF path endpoint.');
    return { ...path, closed: true, parts: Math.hypot(first.x - last.x, first.y - last.y) < 1e-12 ? parts
        : [...parts, { type: 'line', x1: last.x, y1: last.y, x2: first.x, y2: first.y }] };
}
