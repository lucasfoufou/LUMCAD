import { isDrawingLayerVisible } from './drawingLayers.js';
import { createDimensionSourceMap } from './drawingDimensionSources.js';
import { normalizeDimensionBreaks, pickDimensionBreak } from './drawingDimensionBreaks.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';
import { canEditEntity, getLayer } from './drawingDocument.js';
import { getDimensionGeometry, getDimensionBreakSourceCurves, isDrawingDimensionEntity, normalizeDrawingDimensionFormat } from './drawingDimensions.js';
import { applyDimensionStyle, findDimensionStyle, retainDimensionStyleOverrides } from './drawingDimensionStyles.js';
import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function maintainDrawingDimensions(content, selectedIds, operation, input = '') {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'syntax' };
    const ids = new Set(selectedIds);
    const all = operation === 'regenerate' && ids.size === 0;
    const selected = content.entities.filter(entity => all ? isDrawingDimensionEntity(entity) && canEditEntity(content, entity) : ids.has(entity.id));
    if (!selected.length || (!all && selected.length !== ids.size) || selected.some(entity => !isDrawingDimensionEntity(entity) || !canEditEntity(content, entity))) return { error: 'selection' };
    const style = operation === 'update' ? findDimensionStyle(content, tokens[0] || content.activeDimensionStyleId) : null;
    if (operation === 'update' && (tokens.length > 1 || !style)) return { error: 'style' };
    if (operation === 'regenerate' && tokens.length) return { error: 'syntax' };
    const mode = tokens[0]?.toUpperCase();
    if (operation === 'inspect' && (!['ON', 'OFF'].includes(mode) || tokens.length > (mode === 'OFF' ? 1 : 3) || tokens.some(token => token.length > 256))) return { error: 'syntax' };
    if (operation === 'editText' && !(mode === 'HOME' && tokens.length === 1 || mode === 'NEW' && tokens.length === 2 && tokens[1].length <= 16384
        || ['OBLIQUE', 'ROTATE'].includes(mode) && tokens.length === 2 && (mode === 'OBLIQUE' && tokens[1].toUpperCase() === 'AUTO' || tokens[1].trim() && Number.isFinite(Number(tokens[1]))))) return { error: 'syntax' };
    const coordinates = mode === 'POSITION' ? tokens.slice(1).map(Number) : [];
    if (operation === 'placeText' && !(mode === 'HOME' && tokens.length === 1
        || mode === 'ANGLE' && tokens.length === 2 && tokens[1].trim() && Number.isFinite(Number(tokens[1]))
        || mode === 'POSITION' && coordinates.length === 2 && tokens.slice(1).every(token => token.trim()) && coordinates.every(Number.isFinite))) return { error: 'syntax' };
    if (operation === 'break' && !(mode === 'REMOVE' && tokens.length === 1 || mode === 'AUTO' && tokens.length >= 1 && (tokens.length === 1 || Number.isFinite(Number(tokens[1])) && Number(tokens[1]) > 0 && Number(tokens[1]) <= 1e6) || tokens.length === 4 && tokens.every(token => token.trim() && Number.isFinite(Number(token))))) return { error: 'breakSyntax' };
    if (!['update', 'regenerate', 'inspect', 'editText', 'placeText', 'break'].includes(operation)) return { error: 'syntax' };
    const sources = createDimensionSourceMap(content.entities, content.blocks, content);
    if (selected.some(entity => {
        const geometry = getDimensionGeometry(entity, sources);
        return !geometry || ['inspect', 'editText', 'placeText'].includes(operation) && !geometry.label;
    })) return { error: 'geometry' };
    if (operation === 'editText' && mode === 'OBLIQUE' && selected.some(entity => entity.type !== 'linearDimension'
        || !getDimensionGeometry({ ...entity, dimensionExtensionAngle: tokens[1].toUpperCase() === 'AUTO' ? undefined : (Number(tokens[1]) % 360) * Math.PI / 180 }, sources))) return { error: 'obliqueGeometry' };
    if (operation === 'break' && mode === 'AUTO') {
        const supported = entity => {
            const curves = getDimensionBreakSourceCurves(entity, sources);
            return curves.length > 0 || curves.truncated;
        };
        const candidates = tokens.length > 2 ? tokens.slice(2) : content.entities.filter(entity => !ids.has(entity.id) && isDrawingLayerVisible(getLayer(content, entity.layerId)) && supported(entity)).map(entity => entity.id);
        const sourceIds = [...new Set(candidates)];
        if (!sourceIds.length || sourceIds.length > 1000 || sourceIds.some(id => !sources.has(id) || ids.has(id) || !supported(sources.get(id)))) return { error: 'breakSources' };
        const replacements = new Map();
        for (const entity of selected) {
            const next = { ...entity, dimensionAutoBreak: { gap: tokens.length > 1 ? Number(tokens[1]) : Math.max(0.01, Number(entity.textSize) || 0.35), sourceIds } };
            const geometry = getDimensionGeometry(next, sources);
            if (geometry.automaticBreakCurves.length > 10000 || presentDrawingDimension(geometry, next, next.textSize).automaticBreakTruncated) return { error: 'breakLimit' };
            replacements.set(entity.id, next);
        }
        return { content: refreshDrawingBlockBounds({ ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) }) };
    }
    const breaks = new Map();
    if (operation === 'break' && mode !== 'REMOVE') {
        for (const entity of selected) {
            const existing = normalizeDimensionBreaks(entity.dimensionBreaks);
            if (existing.length >= 128) return { error: 'breakLimit' };
            const geometry = presentDrawingDimension(getDimensionGeometry(entity, sources), { ...entity, dimensionBreaks: [] }, entity.textSize);
            const gap = pickDimensionBreak(geometry, { x: Number(tokens[0]), y: Number(tokens[1]) }, { x: Number(tokens[2]), y: Number(tokens[3]) });
            if (!gap) return { error: 'geometry' };
            breaks.set(entity.id, [...existing, gap]);
        }
    }
    const targets = new Set(selected.map(entity => entity.id));
    const entities = content.entities.map(entity => {
        if (!targets.has(entity.id)) return entity;
        if (operation === 'update') return applyDimensionStyle(entity, style);
        if (operation === 'regenerate') {
            const linked = findDimensionStyle(content, entity.dimensionStyleId);
            return linked ? applyDimensionStyle(entity, linked, { keepOverrides: true }) : entity;
        }
        if (operation === 'break') {
            const next = { ...entity };
            if (mode === 'REMOVE') { delete next.dimensionBreaks; delete next.dimensionAutoBreak; }
            else next.dimensionBreaks = breaks.get(entity.id);
            return next;
        }
        if (operation === 'placeText') {
            const next = { ...entity };
            if (mode === 'HOME') {
                delete next.dimensionTextPosition;
                delete next.dimensionTextAngle;
            } else if (mode === 'ANGLE') next.dimensionTextAngle = (Number(tokens[1]) % 360) * Math.PI / 180;
            else next.dimensionTextPosition = { x: coordinates[0], y: coordinates[1] };
            return next;
        }
        if (operation === 'editText') {
            const next = { ...entity };
            if (mode === 'HOME') delete next.dimensionTextOverride;
            else if (mode === 'OBLIQUE') {
                if (tokens[1].toUpperCase() === 'AUTO') delete next.dimensionExtensionAngle;
                else next.dimensionExtensionAngle = (Number(tokens[1]) % 360) * Math.PI / 180;
            } else if (mode === 'ROTATE') next.dimensionTextAngle = (Number(tokens[1]) % 360) * Math.PI / 180;
            else next.dimensionTextOverride = tokens[1];
            return next;
        }
        const format = normalizeDrawingDimensionFormat(entity.dimensionFormat);
        const dimensionFormat = { ...format, inspection: { ...format.inspection, enabled: mode === 'ON',
            ...(tokens[1] !== undefined ? { label: tokens[1] } : {}), ...(tokens[2] !== undefined ? { rate: tokens[2] } : {}) } };
        return retainDimensionStyleOverrides({ ...entity, dimensionFormat }, { dimensionFormat });
    });
    return { content: refreshDrawingBlockBounds({ ...content, entities }) };
}

export function beginDimensionTextPlacement(content, selectedIds) {
    const validated = maintainDrawingDimensions(content, selectedIds, 'placeText', 'POSITION 0 0');
    if (validated.error) return { error: validated.error };
    const first = content.entities.find(entity => entity.id === selectedIds[0]);
    const sources = createDimensionSourceMap(content.entities, content.blocks, content);
    const basePoint = first.dimensionTextPosition || getDimensionGeometry(first, sources).label.point;
    return { operation: { type: 'dimensionTextPlacement', stage: 'position', entityIds: [...selectedIds], basePoint: { ...basePoint } } };
}

export function placeDimensionTextAtPoint(content, operation, point) {
    if (operation?.type !== 'dimensionTextPlacement' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return { error: 'geometry' };
    return maintainDrawingDimensions(content, operation.entityIds, 'placeText', `POSITION ${point.x} ${point.y}`);
}

export function beginDimensionBreak(content, selectedIds) {
    const validated = maintainDrawingDimensions(content, selectedIds, 'break', 'REMOVE');
    if (validated.error) return { error: validated.error };
    return { operation: { type: 'dimensionBreak', stage: 'first-point', entityIds: [...selectedIds] } };
}

export function advanceDimensionBreak(content, operation, point) {
    if (operation?.type !== 'dimensionBreak' || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return { error: 'geometry' };
    const valid = beginDimensionBreak(content, operation.entityIds);
    if (valid.error) return valid;
    if (operation.stage === 'first-point') return { operation: { ...operation, stage: 'second-point', basePoint: { x: point.x, y: point.y } } };
    if (!operation.basePoint) return { error: 'geometry' };
    return maintainDrawingDimensions(content, operation.entityIds, 'break', `${operation.basePoint.x} ${operation.basePoint.y} ${point.x} ${point.y}`);
}
