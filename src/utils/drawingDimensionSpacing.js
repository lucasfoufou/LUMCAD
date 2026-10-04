import { canEditEntity } from './drawingDocument.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

const EPSILON = 1e-7;

/** Space parallel linear or concentric angular dimensions without changing their sources. */
export function spaceDrawingDimensions(content, selectedIds, input = '') {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || tokens.length > 3) return { error: 'spacingSyntax' };
    const automatic = !tokens.length || tokens[0].toUpperCase() === 'AUTO';
    const spacing = automatic ? null : Number(tokens[0]);
    if (!automatic && (!tokens[0].trim() || !Number.isFinite(spacing) || spacing < 0 || spacing > 1e6)) return { error: 'spacingSyntax' };
    if (tokens.length > 1 && (tokens.length !== 3 || tokens[1].toUpperCase() !== 'BASE')) return { error: 'spacingSyntax' };
    const ids = [...new Set(selectedIds)];
    const sources = new Map(content.entities.map(entity => [entity.id, entity]));
    const baseId = tokens[2] ?? ids[0];
    if (ids.length < 2 || !ids.includes(baseId)) return { error: 'selection' };
    const entries = ids.map(id => ({ entity: sources.get(id), geometry: getDimensionGeometry(sources.get(id), sources) }));
    if (entries.some(({ entity }) => !entity || !canEditEntity(content, entity))) return { error: 'selection' };
    const base = entries.find(entry => entry.entity.id === baseId);
    const kind = base.geometry?.kind;
    if (!['linear', 'angular'].includes(kind) || entries.some(entry => entry.geometry?.kind !== kind)) return { error: 'spacingGeometry' };
    const gap = automatic ? 2 * Math.max(...entries.map(({ entity }) => Number.isFinite(entity.textSize) ? Math.max(0.01, entity.textSize) : 0.35)) : spacing;
    let scalar;
    let apply;
    if (kind === 'linear') {
        const axis = { x: Math.cos(base.geometry.angle), y: Math.sin(base.geometry.angle) };
        const normal = { x: -axis.y, y: axis.x };
        if (entries.some(({ geometry }) => Math.abs(Math.sin(geometry.angle - base.geometry.angle)) > EPSILON)) return { error: 'spacingGeometry' };
        scalar = geometry => geometry.first.x * normal.x + geometry.first.y * normal.y;
        apply = (entity, geometry, value) => {
            const delta = value - scalar(geometry);
            return { ...entity, linePoint: { x: geometry.first.x + normal.x * delta, y: geometry.first.y + normal.y * delta } };
        };
    } else {
        if (entries.some(({ geometry }) => Math.hypot(geometry.vertex.x - base.geometry.vertex.x, geometry.vertex.y - base.geometry.vertex.y) > EPSILON)) return { error: 'spacingGeometry' };
        scalar = geometry => geometry.radius;
        apply = (entity, geometry, value) => ({ ...entity, radius: value });
    }
    const baseScalar = scalar(base.geometry);
    const others = entries.filter(entry => entry !== base).map((entry, index) => ({ ...entry, index, delta: scalar(entry.geometry) - baseScalar }));
    const replacements = new Map();
    for (const sign of [-1, 1]) {
        const side = others.filter(entry => entry.delta < -EPSILON ? sign === -1 : sign === 1)
            .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta) || a.index - b.index);
        for (const [index, entry] of side.entries()) {
            const value = baseScalar + sign * gap * (index + 1);
            if (!Number.isFinite(value) || kind === 'angular' && value <= EPSILON) return { error: 'spacingGeometry' };
            const next = apply(entry.entity, entry.geometry, value);
            if (!getDimensionGeometry(next, sources)) return { error: 'spacingGeometry' };
            replacements.set(next.id, next);
        }
    }
    return { content: refreshDrawingBlockBounds({ ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) }) };
}

/** POINT measures the gap perpendicular to the base line, or radially from its arc. */
export function beginDimensionSpacing(content, selectedIds, input = 'POINT') {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens || tokens[0]?.toUpperCase() !== 'POINT'
        || tokens.length !== 1 && (tokens.length !== 3 || tokens[1].toUpperCase() !== 'BASE')) return { error: 'spacingSyntax' };
    const baseId = tokens[2] ?? selectedIds[0];
    const validation = spaceDrawingDimensions(content, selectedIds, `0 BASE "${baseId}"`);
    if (validation.error) return validation;
    const sources = new Map(content.entities.map(entity => [entity.id, entity]));
    const geometry = getDimensionGeometry(sources.get(baseId), sources);
    return { operation: { type: 'dimensionSpacing', stage: 'position', entityIds: [...new Set(selectedIds)], baseId,
        basePoint: { ...(geometry.kind === 'linear' ? geometry.first : geometry.vertex) } } };
}

export function spaceDimensionsAtPoint(content, operation, point) {
    if (operation?.type !== 'dimensionSpacing' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return { error: 'spacingGeometry' };
    const sources = new Map(content.entities.map(entity => [entity.id, entity]));
    const geometry = getDimensionGeometry(sources.get(operation.baseId), sources);
    if (!geometry) return { error: 'spacingGeometry' };
    const gap = geometry.kind === 'linear'
        ? Math.abs(-(point.x - geometry.first.x) * Math.sin(geometry.angle) + (point.y - geometry.first.y) * Math.cos(geometry.angle))
        : Math.abs(Math.hypot(point.x - geometry.vertex.x, point.y - geometry.vertex.y) - geometry.radius);
    return spaceDrawingDimensions(content, operation.entityIds, `${gap} BASE "${operation.baseId}"`);
}
