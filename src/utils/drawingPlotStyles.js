export const DRAWING_PLOT_PRESENTATION = Symbol('drawingPlotPresentation');
const WEIGHTS = [1, 1.5, 2, 3, 5, 10];
const color = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;

export function normalizeDrawingPlotStyles(value) {
    const names = new Set();
    return (Array.isArray(value) ? value : []).slice(0, 256).flatMap(style => {
        const name = typeof style?.name === 'string' ? style.name.trim() : '';
        if (!name || name.length > 128 || names.has(name.toLowerCase())) return [];
        names.add(name.toLowerCase());
        return [{ name, sourceColor: color(style.sourceColor), color: color(style.color),
            lineWeight: WEIGHTS.includes(style.lineWeight) ? style.lineWeight : null,
            lineType: ['continuous', 'dashed', 'dotted'].includes(style.lineType) ? style.lineType : null,
            screening: typeof style.screening === 'number' && Number.isFinite(style.screening) ? Math.max(0, Math.min(100, style.screening)) : 100 }];
    });
}

export function drawingPlotColor(value, mode) {
    if (mode === 'monochrome') return '#000000';
    if (mode !== 'grayscale') return value;
    const red = Number.parseInt(value.slice(1, 3), 16);
    const green = Number.parseInt(value.slice(3, 5), 16);
    const blue = Number.parseInt(value.slice(5, 7), 16);
    const channel = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722).toString(16).padStart(2, '0');
    return `#${channel}${channel}${channel}`;
}

export function resolveDrawingPlotAppearance(appearance, entity, layer) {
    const context = layer?.[DRAWING_PLOT_PRESENTATION];
    if (!context) return appearance;
    const name = entity?.plotStyleName || layer.plotStyleName;
    const rule = context.mode === 'named' ? context.styles.find(style => style.name.toLowerCase() === name?.toLowerCase())
        : context.mode === 'color' ? context.styles.find(style => style.sourceColor === appearance.color.toLowerCase()) : null;
    const result = { ...appearance };
    if (rule) {
        for (const field of ['color', 'lineWeight', 'lineType']) if (rule[field] !== null) result[field] = rule[field];
        result.transparency = 100 - (100 - result.transparency) * rule.screening / 100;
    }
    result.color = drawingPlotColor(result.color, context.colorMode);
    if (!context.plotLineweights) result.lineWeight = 1;
    return result;
}

export function convertDrawingPlotStyles(content, mode) {
    if (!['named', 'color', 'off'].includes(mode)) return { error: 'invalid' };
    const styles = normalizeDrawingPlotStyles(content.plotStyles);
    const assign = entity => {
        const layer = content.layers.find(layer => layer.id === entity.layerId);
        const rule = styles.find(style => style.sourceColor === color(entity.color || layer?.color));
        return { ...entity, ...(mode === 'named' && rule ? { plotStyleName: rule.name } : {}),
            ...(Array.isArray(entity.parts) ? { parts: entity.parts.map(assign) } : {}) };
    };
    return { content: { ...content, settings: { ...content.settings, plotStyleMode: mode },
        layers: content.layers.map(assign), entities: content.entities.map(assign),
        blocks: content.blocks.map(block => ({ ...block, entities: block.entities.map(assign) })) } };
}

/** Resolve explicit sub-geometry colours after block layer inheritance, without changing stored entities. */
export function resolveDrawingPlotEntityDetails(entity, layer) {
    if (!layer?.[DRAWING_PLOT_PRESENTATION]) return entity;
    const appearance = item => resolveDrawingPlotAppearance({
        color: color(item.color) || color(entity.color) || color(layer.color) || '#172033',
        lineWeight: item.lineWeight || item.lineWidth || entity.lineWeight || layer.lineWeight || 1,
        lineType: item.lineType || entity.lineType || layer.lineType || 'continuous',
        transparency: item.transparency ?? entity.transparency ?? layer.transparency ?? 0,
    }, { ...item, plotStyleName: item.plotStyleName || entity.plotStyleName }, layer);
    return { ...entity,
        ...(Array.isArray(entity.parts) ? { parts: entity.parts.map(part => ({
            ...resolveDrawingPlotEntityDetails({ ...part, plotStyleName: part.plotStyleName || entity.plotStyleName }, layer), ...appearance(part),
        })) } : {}),
        ...(Array.isArray(entity.runs) ? { runs: entity.runs.map(run => run.marks?.color ? {
            ...run, marks: { ...run.marks, color: appearance(run.marks).color },
        } : run) } : {}),
        ...(entity.pattern?.endColor ? { pattern: { ...entity.pattern, endColor: appearance({ color: entity.pattern.endColor }).color } } : {}),
    };
}
