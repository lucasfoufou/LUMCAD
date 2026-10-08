/** Clip a regular line/cross hatch to sampled compound contours, retaining winding rules. */
export function drawingHatchLines(contours, pattern, { fillRule = 'evenodd', maxLines = 4096, maxChecks = 1000000, annotation = false } = {}) {
    if (![maxLines, maxChecks].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('wmfLimit');
    const spacing = Math.max(annotation ? 1e-12 : .02, Math.abs(Number(pattern.spacing) || Number(pattern.scale) || .25));
    const origin = { x: Number(pattern.origin?.x) || 0, y: Number(pattern.origin?.y) || 0 };
    const angles = [Number(pattern.angle) || 0];
    if (pattern.name === 'cross') angles.push(angles[0] + 90);
    const result = []; let checks = 0;
    for (const degrees of angles) {
        const angle = degrees * Math.PI / 180; const dx = Math.cos(angle); const dy = Math.sin(angle);
        const project = point => ({ t: (point.x - origin.x) * dx + (point.y - origin.y) * dy,
            n: -(point.x - origin.x) * dy + (point.y - origin.y) * dx });
        const projected = contours.map(contour => contour.map(project));
        let min = Infinity; let max = -Infinity; let edges = 0;
        for (const contour of projected) for (const point of contour) {
            if (![point.t, point.n].every(Number.isFinite)) throw new Error('wmfGeometry');
            min = Math.min(min, point.n); max = Math.max(max, point.n); edges++;
        }
        const first = Math.ceil(min / spacing); const last = Math.floor(max / spacing);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)
            || (last - first + 1) * edges > maxChecks - checks) throw new Error('wmfLimit');
        const unproject = (t, n) => ({ x: origin.x + t * dx - n * dy, y: origin.y + t * dy + n * dx });
        for (let row = first; row <= last; row++) {
            const n = row * spacing; const hits = [];
            for (const contour of projected) for (let i = 0; i < contour.length; i++) {
                checks++;
                const a = contour[i]; const b = contour[(i + 1) % contour.length];
                if ((a.n <= n && b.n > n) || (b.n <= n && a.n > n)) {
                    hits.push({ t: a.t + (n - a.n) * (b.t - a.t) / (b.n - a.n), delta: b.n > a.n ? 1 : -1 });
                }
            }
            hits.sort((a, b) => a.t - b.t);
            let winding = 0;
            for (let i = 0; i < hits.length - 1; i++) {
                winding += hits[i].delta;
                if ((fillRule === 'nonzero' ? winding !== 0 : Math.abs(winding) % 2 === 1) && hits[i + 1].t > hits[i].t) {
                    if (result.length >= maxLines) throw new Error('wmfLimit');
                    result.push([unproject(hits[i].t, n), unproject(hits[i + 1].t, n)]);
                }
            }
        }
    }
    return result;
}
