const EPSILON = 1e-9;
const isFinitePoint = point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));

export const IDENTITY_AFFINE_MATRIX = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export function normalizeAffineMatrix(value, fallback = IDENTITY_AFFINE_MATRIX) {
    const source = Array.isArray(value)
        ? { a: value[0], b: value[1], c: value[2], d: value[3], e: value[4], f: value[5] }
        : value;
    if (!source || typeof source !== 'object') return { ...fallback };
    const matrix = {
        a: Number(source.a),
        b: Number(source.b),
        c: Number(source.c),
        d: Number(source.d),
        e: Number(source.e),
        f: Number(source.f),
    };
    return Object.values(matrix).every(Number.isFinite) ? matrix : { ...fallback };
}

/** Returns a matrix that applies `right` first and `left` second. */
export function multiplyAffineMatrices(left, right) {
    const first = normalizeAffineMatrix(left);
    const second = normalizeAffineMatrix(right);
    return {
        a: first.a * second.a + first.c * second.b,
        b: first.b * second.a + first.d * second.b,
        c: first.a * second.c + first.c * second.d,
        d: first.b * second.c + first.d * second.d,
        e: first.a * second.e + first.c * second.f + first.e,
        f: first.b * second.e + first.d * second.f + first.f,
    };
}

export function translationAffineMatrix(dx = 0, dy = 0) {
    const x = Number(dx);
    const y = Number(dy);
    return { a: 1, b: 0, c: 0, d: 1, e: Number.isFinite(x) ? x : 0, f: Number.isFinite(y) ? y : 0 };
}

export function rotationAffineMatrix(angleDegrees = 0, origin = { x: 0, y: 0 }) {
    const angle = Number(angleDegrees) * Math.PI / 180;
    if (!Number.isFinite(angle) || !isFinitePoint(origin)) return { ...IDENTITY_AFFINE_MATRIX };
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rotation = { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
    return matrixAroundPoint(rotation, origin);
}

export function scaleAffineMatrix(scaleX = 1, scaleY = scaleX, origin = { x: 0, y: 0 }) {
    const x = Number(scaleX);
    const y = Number(scaleY);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !isFinitePoint(origin)) return { ...IDENTITY_AFFINE_MATRIX };
    return matrixAroundPoint({ a: x, b: 0, c: 0, d: y, e: 0, f: 0 }, origin);
}

export function mirrorAffineMatrix(first, second) {
    if (!isFinitePoint(first) || !isFinitePoint(second)) return { ...IDENTITY_AFFINE_MATRIX };
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return { ...IDENTITY_AFFINE_MATRIX };
    const cosine = dx / length;
    const sine = dy / length;
    return matrixAroundPoint({
        a: cosine * cosine - sine * sine,
        b: 2 * cosine * sine,
        c: 2 * cosine * sine,
        d: sine * sine - cosine * cosine,
        e: 0,
        f: 0,
    }, first);
}

export function transformAffinePoint(point, matrix) {
    if (!isFinitePoint(point)) return point;
    const normalized = normalizeAffineMatrix(matrix);
    return {
        x: normalized.a * Number(point.x) + normalized.c * Number(point.y) + normalized.e,
        y: normalized.b * Number(point.x) + normalized.d * Number(point.y) + normalized.f,
    };
}

export function affineMatrixToSvg(matrix) {
    const normalized = normalizeAffineMatrix(matrix);
    return `matrix(${normalized.a} ${normalized.b} ${normalized.c} ${normalized.d} ${normalized.e} ${normalized.f})`;
}

/** Conservative local viewport for geometry rendered inside an affine group. */
export function inverseAffineViewBox(viewBox, value) {
    if (!viewBox) return null;
    const matrix = normalizeAffineMatrix(value);
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-15) return null;
    const points = [
        [viewBox.x, viewBox.y], [viewBox.x + viewBox.width, viewBox.y],
        [viewBox.x, viewBox.y + viewBox.height], [viewBox.x + viewBox.width, viewBox.y + viewBox.height],
    ].map(([x, y]) => ({
        x: (matrix.d * (x - matrix.e) - matrix.c * (y - matrix.f)) / determinant,
        y: (-matrix.b * (x - matrix.e) + matrix.a * (y - matrix.f)) / determinant,
    }));
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    return {
        x: minX, y: minY,
        width: Math.max(...points.map(point => point.x)) - minX,
        height: Math.max(...points.map(point => point.y)) - minY,
    };
}

function matrixAroundPoint(matrix, point) {
    return multiplyAffineMatrices(
        translationAffineMatrix(point.x, point.y),
        multiplyAffineMatrices(matrix, translationAffineMatrix(-point.x, -point.y)),
    );
}

