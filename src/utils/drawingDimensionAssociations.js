import { canEditEntity } from './drawingDocument.js';
import { getDimensionGeometry, getDrawingEntityDependencyIds, isDrawingDimensionEntity, normalizeDimensionDetachedSource } from './drawingDimensions.js';

export function disassociateDrawingDimensions(content, selectedIds) {
    const ids = new Set(selectedIds);
    const selected = content.entities.filter(entity => ids.has(entity.id));
    if (!selected.length || selected.length !== ids.size || selected.some(entity => !isDrawingDimensionEntity(entity) || !canEditEntity(content, entity))) return { error: 'selection' };
    const sources = new Map(content.entities.map(entity => [entity.id, entity]));
    const replacements = new Map();
    for (const entity of selected) {
        if (!getDrawingEntityDependencyIds(entity).length) continue;
        const geometry = getDimensionGeometry(entity, sources);
        if (!geometry) return { error: 'geometry' };
        const next = { ...entity };
        for (const key of ['sourceId', 'sourceIds', 'sourcePointReferences', 'sourcePickPoints', 'baselineReference', 'seriesId', 'seriesMode', 'seriesOrder', 'seriesIndex', 'seriesAxis', 'baselineEnd']) delete next[key];
        if (['linearDimension', 'centerLine'].includes(entity.type)) {
            next.p1 = geometry.sourceFirst; next.p2 = geometry.sourceSecond;
        } else if (entity.type === 'angularDimension') {
            next.vertex = geometry.vertex; next.ray1Point = geometry.first; next.ray2Point = geometry.second;
        } else if (entity.type === 'ordinateDimension') {
            next.featurePoint = geometry.feature; next.leaderPoint = geometry.text;
        } else {
            const source = getDrawingEntityDependencyIds(entity).map(id => sources.get(id)).find(source => ['circle', 'arc', 'ellipse'].includes(source?.type));
            const detached = normalizeDimensionDetachedSource(source);
            if (!detached) return { error: 'geometry' };
            next.detachedSource = detached;
        }
        if (!getDimensionGeometry(next)) return { error: 'geometry' };
        replacements.set(entity.id, next);
    }
    return { content: replacements.size ? { ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) } : content };
}

export function reassociateDrawingDimensions(content, selectedIds, sourceIds) {
    const ids = new Set(selectedIds);
    const selected = content.entities.filter(entity => ids.has(entity.id));
    if (!selected.length || selected.length !== ids.size || selected.some(entity => !isDrawingDimensionEntity(entity) || !canEditEntity(content, entity))) return { error: 'selection' };
    const map = new Map(content.entities.map(entity => [entity.id, entity]));
    const sources = sourceIds.map(id => map.get(id));
    if (!sources.length || sources.length > 2 || new Set(sourceIds).size !== sourceIds.length || sources.some(source => !source || isDrawingDimensionEntity(source))) return { error: 'geometry' };
    const replacements = new Map();
    for (const entity of selected) {
        const type = sources[0].type;
        const compatible = entity.type === 'centerLine' ? sources.length === 2 && sources.every(source => source.type === 'line')
            : entity.type === 'angularDimension' ? sources.length === 1 && type === 'arc' || sources.length === 2 && sources.every(source => source.type === 'line')
            : sources.length === 1 && (entity.type === 'linearDimension' ? ['line', 'rectangle', 'polygon', 'ellipse'].includes(type)
                : entity.type === 'arcLengthDimension' ? ['arc', 'ellipse'].includes(type)
                    : entity.type === 'ordinateDimension' ? ['line', 'rectangle', 'polygon', 'circle', 'arc', 'ellipse'].includes(type)
                        : ['circle', 'arc'].includes(type));
        if (!compatible) return { error: 'geometry' };
        const next = { ...entity };
        for (const key of ['sourceId', 'sourceIds', 'sourcePointReferences', 'sourcePickPoints', 'baselineReference', 'detachedSource', 'seriesId', 'seriesMode', 'seriesOrder', 'seriesIndex', 'seriesAxis', 'baselineEnd']) delete next[key];
        if (entity.type === 'ordinateDimension') delete next.featurePoint;
        if (sources.length === 1) next.sourceId = sources[0].id;
        else next.sourceIds = sourceIds;
        if (!getDimensionGeometry(next, map)) return { error: 'geometry' };
        replacements.set(entity.id, next);
    }
    return { content: { ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) } };
}

export function beginDimensionReassociation(content, selectedIds) {
    const ids = new Set(selectedIds);
    const selected = content.entities.filter(entity => ids.has(entity.id));
    if (!selected.length || selected.length !== ids.size || selected.some(entity => !isDrawingDimensionEntity(entity) || !canEditEntity(content, entity))) return { error: 'selection' };
    return { operation: { type: 'dimensionReassociation', stage: 'source', entityIds: [...ids], sourceIds: [] } };
}

export function pickDimensionReassociationSource(content, operation, targetId) {
    if (operation?.type !== 'dimensionReassociation') return { error: 'geometry' };
    const validated = beginDimensionReassociation(content, operation.entityIds);
    if (validated.error) return validated;
    const target = content.entities.find(entity => entity.id === targetId);
    if (!target || isDrawingDimensionEntity(target) || operation.sourceIds.includes(targetId)) return { error: 'geometry' };
    const sources = [...operation.sourceIds, targetId];
    const angular = operation.entityIds.every(id => ['angularDimension', 'centerLine'].includes(content.entities.find(entity => entity.id === id)?.type));
    if (angular && !operation.sourceIds.length && target.type === 'line') {
        return { operation: { ...operation, stage: 'second-source', sourceIds: sources } };
    }
    return reassociateDrawingDimensions(content, operation.entityIds, sources);
}
