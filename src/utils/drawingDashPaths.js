import { curveLength, curveParameterAtLength, curveSubcurve, getCurveStart, getCurveEnd, curvePointAt } from './drawingCurveKernel.js';

/** Expand dash patterns into native curve fragments, retaining joins across phase resets. */
export function drawingDashPaths(paths, pattern, offset = 0, { maxSteps = 10000 } = {}) {
    if (!pattern.length || pattern.some(value => !Number.isFinite(value) || value < 0) || !Number.isFinite(offset)) throw new Error('dashPattern');
    const dashes = pattern.length % 2 ? [...pattern, ...pattern] : pattern;
    const period = dashes.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(period) || period <= 0) throw new Error('dashPattern');
    const result = []; let steps = 0;
    for (const path of paths) {
        const firstResult = result.length;
        let index; let remaining; let run = null;
        const reset = () => {
            let phase = ((offset % period) + period) % period;
            index = 0;
            while (phase > 0 && phase >= dashes[index]) { phase -= dashes[index]; index++; }
            remaining = dashes[index] - phase;
        };
        reset();
        for (let partIndex = 0; partIndex < path.parts.length; partIndex++) {
            if (partIndex === path.dashRestartAfter) reset();
            const part = path.parts[partIndex]; const length = curveLength(part);
            if (!Number.isFinite(length)) throw new Error('dashGeometry');
            let position = 0;
            while (position < length || remaining === 0) {
                if (++steps > maxSteps) throw new Error('dashLimit');
                if (remaining === 0) {
                    if (index % 2 === 0) result.push({ parts: [], closed: false, dot: curvePointAt(part, curveParameterAtLength(part, position)) });
                    index = (index + 1) % dashes.length; remaining = dashes[index];
                    if (index % 2 && remaining > 0) run = null;
                    continue;
                }
                const size = Math.min(remaining, length - position); const end = position + size;
                if (!(end > position)) throw new Error('dashLimit');
                if (index % 2 === 0) {
                    const fragment = curveSubcurve(part, curveParameterAtLength(part, position), curveParameterAtLength(part, end));
                    if (!fragment) throw new Error('dashGeometry');
                    if (!run) { run = { parts: [], closed: false }; result.push(run); }
                    run.parts.push(fragment);
                } else run = null;
                position = end; remaining -= size;
                if (remaining <= 0) {
                    index = (index + 1) % dashes.length;
                    remaining = dashes[index];
                    if (index % 2 && remaining > 0) run = null;
                }
            }
        }
        if (path.closed && result.length > firstResult) {
            const first = result[firstResult]; const last = result[result.length - 1];
            const start = first.dot || getCurveStart(first.parts[0]); const end = last.dot || getCurveEnd(last.parts[last.parts.length - 1]);
            if (!first.dot && !last.dot && Math.hypot(start.x - end.x, start.y - end.y) < 1e-9) {
                if (first === last) first.closed = true;
                else { last.parts.push(...first.parts); result.splice(firstResult, 1); }
            }
        }
    }
    return result;
}
