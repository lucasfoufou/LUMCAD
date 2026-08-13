import { canEditEntity, createDrawingId, replaceEntityWithEntities } from './drawingDocument.js';
import { getTrimFenceHits, removeUnboundedEntityPortion, trimEntityAtPoint } from './drawingGeometry.js';

export function replaceTrimScope(scopeIds, affectedIds, replacementIds) {
    if (!scopeIds) return null;
    const affected = new Set(affectedIds || []);
    return [...scopeIds.filter(id => !affected.has(id)), ...(replacementIds || [])];
}

export function trimDrawingTarget(content, target, point, { boundaryIds = null } = {}) {
    const result = resolveTrimResult(content, target, point, boundaryIds);
    if (!['trimmed', 'removed'].includes(result.status)) return { content, replacements: [], changed: false };
    const replacements = result.fragments.map(fragment => ({
        ...fragment,
        id: createDrawingId(fragment.type || 'line'),
        layerId: fragment.layerId || target.layerId,
    }));
    return {
        content: replaceEntityWithEntities(content, target.id, replacements),
        replacements,
        removedSegments: result.removedSegments,
        changed: true,
    };
}

export function previewTrimDrawingTarget(content, target, point, { boundaryIds = null } = {}) {
    const result = resolveTrimResult(content, target, point, boundaryIds);
    return ['trimmed', 'removed'].includes(result.status) ? result.removedSegments : [];
}

export function trimDrawingFence(content, fence, { scopeIds = null } = {}) {
    const scope = scopeIds?.length ? new Set(scopeIds) : null;
    const editableTargets = content.entities.filter(entity => canEditEntity(content, entity) && (!scope || scope.has(entity.id)));
    const hits = getTrimFenceHits(fence.first, fence.second, editableTargets);
    let nextContent = content;
    let changedCount = 0;
    const replacementIds = [];
    const removedSegments = [];
    hits.forEach(hit => {
        const target = nextContent.entities.find(entity => entity.id === hit.entityId);
        if (!target || !canEditEntity(nextContent, target)) return;
        const result = trimDrawingTarget(nextContent, target, hit.point, { boundaryIds: scopeIds });
        if (!result.changed) return;
        nextContent = result.content;
        replacementIds.push(...result.replacements.map(entity => entity.id));
        removedSegments.push(...(result.removedSegments || []));
        changedCount += 1;
    });
    return { content: nextContent, changedCount, replacementIds, removedSegments, affectedIds: hits.map(hit => hit.entityId) };
}

export function previewTrimDrawingFence(content, fence, { scopeIds = null } = {}) {
    const scope = scopeIds?.length ? new Set(scopeIds) : null;
    const editableTargets = content.entities.filter(entity => canEditEntity(content, entity) && (!scope || scope.has(entity.id)));
    const hits = getTrimFenceHits(fence.first, fence.second, editableTargets);
    let nextContent = content;
    const removedSegments = [];
    hits.forEach(hit => {
        const target = nextContent.entities.find(entity => entity.id === hit.entityId);
        if (!target || !canEditEntity(nextContent, target)) return;
        const result = resolveTrimResult(nextContent, target, hit.point, scopeIds);
        if (!['trimmed', 'removed'].includes(result.status)) return;
        removedSegments.push(...result.removedSegments);
        const replacements = result.fragments.map((fragment, index) => ({
            ...fragment,
            id: `trim-preview-${target.id}-${index}`,
        }));
        nextContent = replaceEntityWithEntities(nextContent, target.id, replacements);
    });
    return removedSegments;
}

export function createTrimPreviewEntities(content, { fence = null, targetId = null, point = null, scopeIds = null } = {}) {
    const target = targetId ? content.entities.find(entity => entity.id === targetId) : null;
    const segments = fence
        ? previewTrimDrawingFence(content, fence, { scopeIds })
        : target && point
            ? previewTrimDrawingTarget(content, target, point, { boundaryIds: scopeIds })
            : [];
    return segments.map(([first, second], index) => ({
        id: `trim-removed-preview-${index}`,
        type: 'line',
        layerId: content.activeLayerId,
        x1: first.x,
        y1: first.y,
        x2: second.x,
        y2: second.y,
        previewMode: 'trim',
    }));
}

function resolveTrimResult(content, target, point, boundaryIds) {
    const trimmed = trimEntityAtPoint(target, point, visibleBoundaries(content, target.id, boundaryIds));
    return trimmed.status === 'trimmed' ? trimmed : removeUnboundedEntityPortion(target, point);
}

function visibleBoundaries(content, targetId, boundaryIds = null) {
    const visibleLayerIds = new Set(content.layers.filter(layer => layer.visible).map(layer => layer.id));
    const allowed = boundaryIds?.length ? new Set(boundaryIds) : null;
    return content.entities.filter(entity => (
        entity.id !== targetId
        && (!allowed || allowed.has(entity.id))
        && visibleLayerIds.has(entity.layerId)
        && ['line', 'rectangle', 'circle', 'arc'].includes(entity.type)
    ));
}
