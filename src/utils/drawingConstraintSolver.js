const MAX_VARIABLES = 128;
const MAX_RESIDUALS = 512;
const MAX_EVALUATIONS = 20000;

const squaredNorm = values => values.reduce((sum, value) => sum + value * value, 0);
const maximum = values => values.reduce((result, value) => Math.max(result, Math.abs(value)), 0);
const finiteVector = values => Array.isArray(values) && values.every(Number.isFinite);

/** Partial-pivot elimination. The caller supplies a positive damped normal matrix. */
function solveLinearSystem(matrix, right) {
    const rows = matrix.map((row, index) => [...row, right[index]]);
    const size = right.length;
    for (let column = 0; column < size; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < size; row += 1) {
            if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
        }
        if (!Number.isFinite(rows[pivot][column]) || Math.abs(rows[pivot][column]) < 1e-20) return null;
        [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
        for (let row = column + 1; row < size; row += 1) {
            const factor = rows[row][column] / rows[column][column];
            for (let cell = column + 1; cell <= size; cell += 1) rows[row][cell] -= factor * rows[column][cell];
            rows[row][column] = 0;
        }
    }
    const result = Array(size).fill(0);
    for (let row = size - 1; row >= 0; row -= 1) {
        let value = rows[row][size];
        for (let cell = row + 1; cell < size; cell += 1) value -= rows[row][cell] * result[cell];
        result[row] = value / rows[row][row];
    }
    return result.every(Number.isFinite) ? result : null;
}

/**
 * Bounded damped least-squares solve for one connected CAD constraint component.
 * residuals(values) returns signed equations in consistent drawing units.
 * Fixed variables never participate in a step. Failure never exposes partial values.
 * Callers keep entity/constraint identity and commit only a converged result.
 */
export function solveDrawingConstraintSystem(initial, residuals, {
    fixed = [], tolerance = 1e-7, maxIterations = 100, maxEvaluations = MAX_EVALUATIONS,
    valid = () => true,
} = {}) {
    if (!finiteVector(initial) || initial.length > MAX_VARIABLES || typeof residuals !== 'function' || typeof valid !== 'function'
        || !Array.isArray(fixed) || fixed.some(index => !Number.isInteger(index) || index < 0 || index >= initial.length)
        || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.001
        || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 200
        || !Number.isInteger(maxEvaluations) || maxEvaluations < 1 || maxEvaluations > MAX_EVALUATIONS) return { error: 'invalid' };
    const locked = new Set(fixed);
    const free = initial.map((_, index) => index).filter(index => !locked.has(index));
    let evaluations = 0;
    let equationCount = null;
    let limit = false;
    const evaluate = values => {
        if (++evaluations > maxEvaluations) { limit = true; return null; }
        const result = residuals([...values]);
        if (!finiteVector(result) || result.length > MAX_RESIDUALS || equationCount !== null && result.length !== equationCount) return null;
        equationCount = result.length;
        return result;
    };
    let values = [...initial];
    let errors = evaluate(values);
    if (!errors || !valid([...values])) return { error: limit ? 'limit' : 'invalid' };
    let damping = 1e-4;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (maximum(errors) <= tolerance) return { values, residual: maximum(errors), iterations: iteration, evaluations };
        if (!free.length) return { error: 'conflict', residual: maximum(errors), iterations: iteration };
        const columns = [];
        for (const index of free) {
            const step = 1e-6 * Math.max(1, Math.abs(values[index]));
            const plus = [...values]; plus[index] += step;
            const minus = [...values]; minus[index] -= step;
            const upper = evaluate(plus); const lower = evaluate(minus);
            if (!upper || !lower) return { error: limit ? 'limit' : 'invalid' };
            columns.push(upper.map((value, row) => (value - lower[row]) / (2 * step)));
        }
        const normal = columns.map(first => columns.map(second => first.reduce((sum, value, row) => sum + value * second[row], 0)));
        const gradient = columns.map(column => column.reduce((sum, value, row) => sum + value * errors[row], 0));
        const previousCost = squaredNorm(errors);
        let accepted = false;
        for (let attempt = 0; attempt < 16; attempt += 1) {
            const damped = normal.map((row, index) => row.map((value, column) => value + (index === column ? damping * Math.max(1, value) : 0)));
            const step = solveLinearSystem(damped, gradient.map(value => -value));
            if (!step) return { error: 'singular', residual: maximum(errors) };
            const candidate = [...values];
            free.forEach((index, column) => { candidate[index] += step[column]; });
            const next = candidate.every(Number.isFinite) && valid([...candidate]) ? evaluate(candidate) : null;
            if (limit) return { error: 'limit' };
            if (next && squaredNorm(next) < previousCost) {
                values = candidate; errors = next; damping = Math.max(1e-12, damping / 4); accepted = true; break;
            }
            damping = Math.min(1e16, damping * 10);
        }
        if (!accepted) return { error: 'conflict', residual: maximum(errors), iterations: iteration + 1 };
    }
    if (maximum(errors) <= tolerance) return { values, residual: maximum(errors), iterations: maxIterations, evaluations };
    return { error: 'limit', residual: maximum(errors), iterations: maxIterations };
}
