/** Resolve a bounded model export frame, retaining room for screen-space strokes. */
export function drawingRasterExportFrame(bounds, { width = 2048, background = '#ffffff', strokePadding = 0 } = {}) {
    if (!Number.isInteger(width) || width < 64 || width > 4096 || background !== 'transparent' && !/^#[0-9a-f]{6}$/i.test(background)) throw new Error('wmfExportSyntax');
    if (!bounds || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
        || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) throw new Error('wmfGeometry');
    if (!Number.isFinite(strokePadding) || strokePadding < 0) throw new Error('wmfGeometry');
    const padding = Math.ceil(strokePadding);
    if (padding * 2 >= width || padding * 2 >= 4096) throw new Error('wmfLimit');
    const spanX = Math.max(.001, bounds.maxX - bounds.minX);
    const spanY = Math.max(.001, bounds.maxY - bounds.minY);
    const margin = Math.max(spanX, spanY) * .05;
    const innerWidth = spanX + margin * 2; const innerHeight = spanY + margin * 2;
    if (![innerWidth, innerHeight].every(Number.isFinite)) throw new Error('wmfGeometry');
    let unit = Math.max(innerWidth / (width - padding * 2), innerHeight / (4096 - padding * 2));
    // Pixel rounding and stroke margins must also fit the total pixel budget.
    let pixels;
    for (let iteration = 0; iteration < 20; iteration++) {
        pixels = { width: Math.ceil(innerWidth / unit) + padding * 2, height: Math.ceil(innerHeight / unit) + padding * 2 };
        if (pixels.width <= width && pixels.height <= 4096 && pixels.width * pixels.height <= 16000000) break;
        unit *= 1.01;
    }
    if (pixels.width > width || pixels.height > 4096 || pixels.width * pixels.height > 16000000) throw new Error('wmfLimit');
    const viewBox = { x: bounds.minX - margin - padding * unit, y: bounds.minY - margin - padding * unit,
        width: pixels.width * unit, height: pixels.height * unit };
    if (!Object.values(viewBox).every(Number.isFinite)) throw new Error('wmfGeometry');
    return { viewBox, ...pixels, background };
}

/** SVG geometry bounds exclude non-scaling strokes; reserve their cap/join reach. */
export function drawingRasterStrokePadding(svg) {
    let padding = 0;
    for (const element of svg.querySelectorAll('.drawing-scene *')) {
        const style = svg.ownerDocument.defaultView.getComputedStyle(element);
        if (style.getPropertyValue('vector-effect') !== 'non-scaling-stroke' || style.getPropertyValue('stroke') === 'none') continue;
        const width = Number.parseFloat(style.getPropertyValue('stroke-width'));
        const join = style.getPropertyValue('stroke-linejoin');
        const reach = join === 'miter' || join === 'miter-clip' ? Math.max(1, Number.parseFloat(style.getPropertyValue('stroke-miterlimit')) || 4) : 1;
        if (Number.isFinite(width)) padding = Math.max(padding, width * reach / 2 + 1);
    }
    return padding;
}
