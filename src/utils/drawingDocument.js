import {
    arcContainsAngle,
    arcMidpoint,
    getDimensionGeometry,
    getEntitySegments,
    pointToSegmentDistance,
    translateEntity,
} from './drawingGeometry.js';
import {
    drawingBlocksUseLayer,
    normalizeDrawingBlockReference,
    normalizeDrawingBlocks,
} from './drawingBlocks.js';
import { normalizeAdvancedDrawingEntity } from './drawingAdvancedEntities.js';
import { normalizeDrawingDraftingSettings } from './drawingDraftingSettings.js';

const DEFAULT_LAYER_IDS = {
    geometry: 'geometry',
    dimensions: 'dimensions',
    references: 'references',
};

const PROTECTED_LAYER_NAMES = {
    [DEFAULT_LAYER_IDS.geometry]: '0',
    [DEFAULT_LAYER_IDS.dimensions]: 'DIM',
    [DEFAULT_LAYER_IDS.references]: 'REF',
};

export const DRAWING_LINE_WEIGHT_OPTIONS = Object.freeze([1, 1.5, 2, 3, 5, 10]);
export const DRAWING_LINE_TYPE_OPTIONS = Object.freeze(['continuous', 'dotted', 'dashed']);
export const DEFAULT_DRAWING_COLOR = '#172033';
export const DEFAULT_DRAWING_LINE_WEIGHT = 1;
export const DEFAULT_DRAWING_LINE_TYPE = 'continuous';
export const DEFAULT_DRAWING_TRANSPARENCY = 0;
export const MAX_DRAWING_TRANSPARENCY = 90;

export function createDefaultDrawingContent({
    gridSpacing = 0.5,
    tracking = false,
    today = new Date(),
} = {}) {
    const draftingSettings = normalizeDrawingDraftingSettings({ tracking });
    return {
        version: 1,
        unit: 'm',
        activeLayerId: DEFAULT_LAYER_IDS.geometry,
        layers: [
            createDefaultLayer(DEFAULT_LAYER_IDS.geometry, PROTECTED_LAYER_NAMES.geometry, '#172033'),
            createDefaultLayer(DEFAULT_LAYER_IDS.dimensions, PROTECTED_LAYER_NAMES.dimensions, '#d97706'),
            createDefaultLayer(DEFAULT_LAYER_IDS.references, PROTECTED_LAYER_NAMES.references, '#64748b'),
        ],
        blocks: [],
        entities: [],
        settings: {
            gridSpacing: Math.max(0.0001, Number(gridSpacing) || 0.5),
            snaps: { grid: true, endpoint: true, midpoint: true, center: true, intersection: true, nearest: false },
            dynamicInput: true,
            ...draftingSettings,
        },
        metadata: {
            projectName: '',
            address: '',
            drawingTitle: '',
            date: today.toISOString().slice(0, 10),
            page: '1/1',
            index: 'A',
            reference: '',
            designer: '',
            quantities: [],
            northAngle: 0,
        },
    };
}

export function normalizeDrawingContent(content) {
    const defaults = createDefaultDrawingContent();
    if (!content || typeof content !== 'object') return defaults;
    const sourceLayers = Array.isArray(content.layers) && content.layers.length > 0 ? content.layers : defaults.layers;
    const layers = (sourceLayers.some(layer => layer.id === DEFAULT_LAYER_IDS.geometry)
        ? sourceLayers
        : [defaults.layers[0], ...sourceLayers])
        .map(layer => normalizeDrawingLayer(layer));
    const sourceSettings = content.settings || {};
    const draftingSettings = normalizeDrawingDraftingSettings({ ...defaults.settings, ...sourceSettings });
    const blocks = normalizeDrawingBlocks(content.blocks, { normalizeEntity: normalizeDrawingEntityAppearance });
    const blockIds = new Set(blocks.map(block => block.id));
    const entities = Array.isArray(content.entities)
        ? content.entities
            .map(normalizeDrawingEntityAppearance)
            .filter(entity => entity?.type !== 'blockReference' || blockIds.has(entity.blockId))
        : [];
    return {
        ...defaults,
        ...content,
        version: 1,
        unit: 'm',
        layers,
        blocks,
        entities,
        activeLayerId: layers.some(layer => layer.id === content.activeLayerId) ? content.activeLayerId : layers[0].id,
        settings: {
            ...defaults.settings,
            ...sourceSettings,
            ...draftingSettings,
            dynamicInput: sourceSettings.dynamicInput !== false,
            snaps: { ...defaults.settings.snaps, ...(sourceSettings.snaps || {}) },
        },
        metadata: { ...defaults.metadata, ...(content.metadata || {}) },
    };
}

export function createDrawingId(prefix = 'entity') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getLayer(content, layerId) {
    return content.layers.find(layer => layer.id === layerId) || null;
}

export function getLayerColor(content, entity) {
    return getEntityColor(content, entity);
}

export function getEntityColor(content, entity) {
    return normalizeDrawingColor(entity?.color)
        || normalizeDrawingColor(getLayer(content, entity?.layerId)?.color)
        || DEFAULT_DRAWING_COLOR;
}

export function getEntityLineWeight(content, entity) {
    return normalizeDrawingLineWeight(entity?.lineWeight)
        || normalizeDrawingLineWidth(entity?.lineWidth)
        || normalizeDrawingLineWeight(getLayer(content, entity?.layerId)?.lineWeight)
        || DEFAULT_DRAWING_LINE_WEIGHT;
}

export function getEntityLineType(content, entity) {
    return normalizeDrawingLineType(entity?.lineType)
        || normalizeDrawingLineType(getLayer(content, entity?.layerId)?.lineType)
        || DEFAULT_DRAWING_LINE_TYPE;
}

export function getEntityTransparency(content, entity) {
    return normalizeDrawingTransparency(entity?.transparency)
        ?? normalizeDrawingTransparency(getLayer(content, entity?.layerId)?.transparency)
        ?? DEFAULT_DRAWING_TRANSPARENCY;
}

export function getEntityAppearance(content, entity) {
    return {
        color: getEntityColor(content, entity),
        lineWeight: getEntityLineWeight(content, entity),
        lineType: getEntityLineType(content, entity),
        transparency: getEntityTransparency(content, entity),
    };
}

export function normalizeDrawingColor(value) {
    const color = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

export function normalizeDrawingLineWeight(value) {
    const weight = Number(value);
    return DRAWING_LINE_WEIGHT_OPTIONS.includes(weight) ? weight : null;
}

export function normalizeDrawingLineType(value) {
    const lineType = String(value || '').trim().toLowerCase();
    return DRAWING_LINE_TYPE_OPTIONS.includes(lineType) ? lineType : null;
}

export function normalizeDrawingTransparency(value) {
    if (value === null || value === undefined || value === '') return null;
    const transparency = Number(value);
    if (!Number.isFinite(transparency) || transparency < 0 || transparency > MAX_DRAWING_TRANSPARENCY) return null;
    return Math.round(transparency);
}

export function clampDrawingTransparency(value) {
    const transparency = Number(value);
    if (!Number.isFinite(transparency)) return DEFAULT_DRAWING_TRANSPARENCY;
    return Math.round(Math.max(0, Math.min(MAX_DRAWING_TRANSPARENCY, transparency)));
}

export function getDimensionLayerId(content) {
    return content.layers.find(layer => layer.id === DEFAULT_LAYER_IDS.dimensions)?.id
        || content.layers.find(layer => /cotation|dimension/i.test(layer.name))?.id
        || content.activeLayerId;
}

export function getReferenceLayerId(content) {
    return content.layers.find(layer => layer.id === DEFAULT_LAYER_IDS.references)?.id
        || content.layers.find(layer => /référence|reference/i.test(layer.name))?.id
        || content.activeLayerId;
}

export function canEditEntity(content, entity) {
    const layer = getLayer(content, entity.layerId);
    return Boolean(layer?.visible && !layer.locked && !entity?.locked);
}

export function canSelectEntity(content, entity) {
    return Boolean(getLayer(content, entity.layerId)?.visible);
}

export function applySelectionOperation(selectedIds, candidateIds, operation = 'add') {
    const candidates = new Set(candidateIds);
    if (operation === 'remove') return selectedIds.filter(id => !candidates.has(id));
    const result = [...selectedIds];
    const seen = new Set(result);
    candidateIds.forEach(id => {
        if (!seen.has(id)) {
            seen.add(id);
            result.push(id);
        }
    });
    return result;
}

export function addEntity(content, entity) {
    return { ...content, entities: [...content.entities, entity] };
}

export function updateSelectedEntities(content, selectedIds, updater) {
    const selected = new Set(selectedIds);
    return {
        ...content,
        entities: content.entities.map(entity => (
            selected.has(entity.id) && canEditEntity(content, entity) ? updater(entity) : entity
        )),
    };
}

export function transformSelectedEntities(content, selectedIds, updater, { copy = false } = {}) {
    const sources = getTransformSelectionEntities(content, selectedIds);
    const editableSourceIds = new Set(sources
        .filter(entity => (selectedIds || []).includes(entity.id))
        .map(entity => entity.id));
    if (!sources.length) return { changed: false, content, selectedIds: selectedIds || [], entities: [] };
    const originalById = new Map(sources.map(entity => [entity.id, entity]));
    const initialTransforms = new Map(sources.map(entity => [entity.id, normalizeTransformedEntity(updater(entity), entity)]));
    const transformedSources = sources.map(entity => {
        if (!entity.sourceId || !originalById.has(entity.sourceId)) return initialTransforms.get(entity.id);
        const prepared = detachDimensionForIncompatibleSource(
            entity,
            originalById.get(entity.sourceId),
            initialTransforms.get(entity.sourceId),
        );
        return prepared === entity
            ? initialTransforms.get(entity.id)
            : normalizeTransformedEntity(updater(prepared), prepared);
    });

    if (!copy) {
        const transformedIds = new Set(sources.map(entity => entity.id));
        const transformedById = new Map(sources.map((entity, index) => [entity.id, transformedSources[index]]));
        const entities = content.entities.map(entity => {
            if (!transformedIds.has(entity.id)) return entity;
            return { ...transformedById.get(entity.id), id: entity.id };
        });
        return {
            changed: true,
            content: { ...content, entities },
            selectedIds: [...editableSourceIds],
            entities: entities.filter(entity => transformedIds.has(entity.id)),
        };
    }

    const idMap = new Map(sources.map((entity, index) => [
        entity.id,
        createDrawingId(transformedSources[index].type || entity.type),
    ]));
    const copies = transformedSources.map((entity, index) => ({
        ...entity,
        id: idMap.get(sources[index].id),
        ...(entity.sourceId && idMap.has(entity.sourceId) ? { sourceId: idMap.get(entity.sourceId) } : {}),
    }));
    return {
        changed: true,
        content: { ...content, entities: [...content.entities, ...copies] },
        selectedIds: sources
            .filter(entity => editableSourceIds.has(entity.id))
            .map(entity => idMap.get(entity.id)),
        entities: copies,
    };
}

export function getTransformSelectionEntities(content, selectedIds) {
    const requested = new Set(selectedIds || []);
    const editableSourceIds = new Set(content.entities
        .filter(entity => requested.has(entity.id) && canEditEntity(content, entity))
        .map(entity => entity.id));
    return content.entities.filter(entity => (
        (editableSourceIds.has(entity.id) || editableSourceIds.has(entity.sourceId))
        && canEditEntity(content, entity)
    ));
}

function normalizeTransformedEntity(transformed, fallback) {
    return transformed && typeof transformed === 'object' ? transformed : fallback;
}

function detachDimensionForIncompatibleSource(dimension, originalSource, transformedSource) {
    if (dimension.type === 'linearDimension'
        && ['line', 'rectangle', 'polygon'].includes(transformedSource?.type)) return dimension;
    if (dimension.type === 'radialDimension'
        && ['circle', 'arc'].includes(transformedSource?.type)) return dimension;
    const geometry = getDimensionGeometry(dimension, originalSource);
    if (!geometry) return dimension;
    if (dimension.type === 'linearDimension' && geometry.sourceFirst && geometry.sourceSecond) {
        const { sourceId: _sourceId, edgeIndex: _edgeIndex, ...properties } = dimension;
        return {
            ...properties,
            p1: geometry.sourceFirst,
            p2: geometry.sourceSecond,
        };
    }
    if (dimension.type === 'radialDimension' && geometry.center && geometry.edge) {
        const { sourceId: _sourceId, mode: _mode, angle: _angle, leaderScale: _leaderScale, ...properties } = dimension;
        const opposite = {
            x: geometry.center.x * 2 - geometry.edge.x,
            y: geometry.center.y * 2 - geometry.edge.y,
        };
        return {
            ...properties,
            type: 'linearDimension',
            p1: dimension.mode === 'diameter' ? opposite : geometry.center,
            p2: geometry.edge,
            offset: Number.isFinite(dimension.offset) ? dimension.offset : 0.6,
        };
    }
    return dimension;
}

export function deleteSelectedEntities(content, selectedIds) {
    const selected = new Set(selectedIds);
    const removedSourceIds = new Set(content.entities
        .filter(entity => selected.has(entity.id) && canEditEntity(content, entity))
        .map(entity => entity.id));
    return {
        ...content,
        entities: content.entities.filter(entity => (
            !removedSourceIds.has(entity.id) && !removedSourceIds.has(entity.sourceId)
        )),
    };
}

export function replaceEntityWithEntities(content, entityId, replacements) {
    const replacementList = Array.isArray(replacements) ? replacements : [];
    if (!content.entities.some(entity => entity.id === entityId)) return content;
    return {
        ...content,
        entities: content.entities.flatMap(entity => {
            if (entity.id === entityId) return replacementList;
            if (entity.sourceId === entityId) return [];
            return [entity];
        }),
    };
}

export function copySelectedEntities(content, selectedIds, offset = { x: 0.5, y: 0.5 }) {
    const selected = new Set(selectedIds);
    const originals = content.entities.filter(entity => selected.has(entity.id) && canEditEntity(content, entity));
    return pasteDrawingEntities(content, originals, offset);
}

export function pasteDrawingEntities(content, originals, offset = { x: 0.5, y: 0.5 }) {
    const idMap = new Map(originals.map(entity => [entity.id, createDrawingId(entity.type)]));
    const copies = originals.map(entity => {
        const next = { ...entity, id: idMap.get(entity.id) };
        if (next.sourceId && idMap.has(next.sourceId)) next.sourceId = idMap.get(next.sourceId);
        return translateEntity(next, offset.x, offset.y);
    });
    return {
        content: { ...content, entities: [...content.entities, ...copies] },
        selectedIds: copies.map(entity => entity.id),
        entities: copies,
    };
}

export function createDimensionForEntity(content, source, mode = 'auto', hitPoint = null) {
    if (!source) return null;
    if (source.type === 'line') {
        return {
            id: createDrawingId('dimension'),
            type: 'linearDimension',
            layerId: getDimensionLayerId(content),
            sourceId: source.id,
            offset: 0.6,
        };
    }
    if (['rectangle', 'polygon'].includes(source.type)) {
        const segments = getEntitySegments(source);
        const edgeIndex = hitPoint ? segments.reduce((best, segment, index) => (
            pointToSegmentDistance(hitPoint, segment[0], segment[1])
                < pointToSegmentDistance(hitPoint, segments[best][0], segments[best][1]) ? index : best
        ), 0) : 0;
        return {
            id: createDrawingId('dimension'),
            type: 'linearDimension',
            layerId: getDimensionLayerId(content),
            sourceId: source.id,
            edgeIndex,
            offset: 0.6,
        };
    }
    if (source.type === 'circle' || source.type === 'arc') {
        const center = { x: source.cx, y: source.cy };
        const hitAngle = hitPoint && Math.hypot(hitPoint.x - source.cx, hitPoint.y - source.cy) > Number.EPSILON
            ? Math.atan2(hitPoint.y - source.cy, hitPoint.x - source.cx)
            : null;
        const midpoint = source.type === 'arc' ? arcMidpoint(source) : null;
        const angle = Number.isFinite(hitAngle) && (source.type !== 'arc' || arcContainsAngle(source, hitAngle))
            ? hitAngle
            : midpoint ? Math.atan2(midpoint.y - center.y, midpoint.x - center.x) : -Math.PI / 4;
        return {
            id: createDrawingId('dimension'),
            type: 'radialDimension',
            layerId: getDimensionLayerId(content),
            sourceId: source.id,
            mode: mode === 'diameter' ? 'diameter' : 'radius',
            angle,
        };
    }
    return null;
}

export function createFreeDimension(content, first, second) {
    if (!first || !second || Math.hypot(second.x - first.x, second.y - first.y) < 1e-9) return null;
    return {
        id: createDrawingId('dimension'),
        type: 'linearDimension',
        layerId: getDimensionLayerId(content),
        p1: { x: first.x, y: first.y },
        p2: { x: second.x, y: second.y },
        offset: 0.6,
    };
}

export function addLayer(content, name = null) {
    const id = createDrawingId('layer');
    const layer = {
        id,
        name: name || `LAYER ${content.layers.length + 1}`,
        color: '#376176',
        lineWeight: DEFAULT_DRAWING_LINE_WEIGHT,
        lineType: DEFAULT_DRAWING_LINE_TYPE,
        transparency: DEFAULT_DRAWING_TRANSPARENCY,
        visible: true,
        locked: false,
    };
    return { ...content, layers: [...content.layers, layer], activeLayerId: id };
}

export function updateLayer(content, layerId, updates) {
    const safeUpdates = PROTECTED_LAYER_NAMES[layerId] && Object.hasOwn(updates, 'name')
        ? { ...updates, name: PROTECTED_LAYER_NAMES[layerId] }
        : updates;
    return {
        ...content,
        layers: content.layers.map(layer => layer.id === layerId ? { ...layer, ...safeUpdates } : layer),
    };
}

export function isProtectedDrawingLayer(layerId) {
    return Object.values(DEFAULT_LAYER_IDS).includes(layerId);
}

export function removeEmptyLayer(content, layerId) {
    if (isProtectedDrawingLayer(layerId)
        || content.entities.some(entity => entity.layerId === layerId)
        || drawingBlocksUseLayer(content.blocks, layerId)) return content;
    const layers = content.layers.filter(layer => layer.id !== layerId);
    return {
        ...content,
        layers,
        activeLayerId: content.activeLayerId === layerId ? layers[0]?.id : content.activeLayerId,
    };
}

function createDefaultLayer(id, name, color) {
    return {
        id,
        name,
        color,
        lineWeight: DEFAULT_DRAWING_LINE_WEIGHT,
        lineType: DEFAULT_DRAWING_LINE_TYPE,
        transparency: DEFAULT_DRAWING_TRANSPARENCY,
        visible: true,
        locked: false,
    };
}

function normalizeDrawingLayer(layer) {
    const id = typeof layer?.id === 'string' && layer.id ? layer.id : createDrawingId('layer');
    return {
        ...layer,
        id,
        name: PROTECTED_LAYER_NAMES[id] || String(layer?.name || '').trim() || 'LAYER',
        color: normalizeDrawingColor(layer?.color) || DEFAULT_DRAWING_COLOR,
        lineWeight: normalizeDrawingLineWeight(layer?.lineWeight) || DEFAULT_DRAWING_LINE_WEIGHT,
        lineType: normalizeDrawingLineType(layer?.lineType) || DEFAULT_DRAWING_LINE_TYPE,
        transparency: normalizeDrawingTransparency(layer?.transparency) ?? DEFAULT_DRAWING_TRANSPARENCY,
        visible: layer?.visible !== false,
        locked: Boolean(layer?.locked),
    };
}

function normalizeDrawingEntityAppearance(entity) {
    if (!entity || typeof entity !== 'object') return entity;
    const normalized = normalizeDrawingEntityGeometry(entity);
    const color = normalizeDrawingColor(entity.color);
    const lineWeight = normalizeDrawingLineWeight(entity.lineWeight);
    const lineType = normalizeDrawingLineType(entity.lineType);
    const transparency = normalizeDrawingTransparency(entity.transparency);
    if (color) normalized.color = color;
    else delete normalized.color;
    if (lineWeight) normalized.lineWeight = lineWeight;
    else delete normalized.lineWeight;
    if (lineType) normalized.lineType = lineType;
    else delete normalized.lineType;
    if (transparency !== null) normalized.transparency = transparency;
    else delete normalized.transparency;
    const lineWidth = normalizeDrawingLineWidth(entity.lineWidth);
    if (lineWidth) normalized.lineWidth = lineWidth;
    else delete normalized.lineWidth;
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        normalized.parts = entity.parts.map(normalizeDrawingPolylinePartTransparency);
    }
    return normalized;
}

function normalizeDrawingPolylinePartTransparency(part) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) return part;
    const normalized = { ...part };
    const transparency = normalizeDrawingTransparency(part.transparency);
    if (transparency !== null) normalized.transparency = transparency;
    else delete normalized.transparency;
    if (part.type === 'polyline' && Array.isArray(part.parts)) {
        normalized.parts = part.parts.map(normalizeDrawingPolylinePartTransparency);
    }
    return normalized;
}

function normalizeDrawingEntityGeometry(entity) {
    const normalized = { ...entity };
    if (entity.type === 'blockReference') return normalizeDrawingBlockReference(normalized);
    if (['ellipse', 'ellipseArc', 'spline', 'cubicSpline', 'cubicBezier', 'bezier', 'hatch'].includes(entity.type)) {
        return normalizeAdvancedDrawingEntity(normalized);
    }
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        normalized.parts = entity.parts.map(normalizeDrawingEntityGeometry);
        normalized.closed = Boolean(entity.closed);
    }
    if (['circle', 'polygon', 'arc'].includes(entity.type)) {
        normalized.cx = finiteOr(entity.cx, 0);
        normalized.cy = finiteOr(entity.cy, 0);
        normalized.r = Math.abs(finiteOr(entity.r, 0));
    }
    if (entity.type === 'polygon') {
        normalized.sides = Math.max(3, Math.min(1_000, Math.round(finiteOr(entity.sides, 6))));
        normalized.mode = entity.mode === 'circumscribed' ? 'circumscribed' : 'inscribed';
        normalized.rotation = normalizeDegrees(entity.rotation);
    }
    if (entity.type === 'arc') {
        normalized.startAngle = finiteOr(entity.startAngle, 0);
        normalized.endAngle = finiteOr(entity.endAngle, 0);
        normalized.counterClockwise = entity.counterClockwise !== false;
    }
    if (entity.type === 'rectangle') {
        normalized.x = finiteOr(entity.x, 0);
        normalized.y = finiteOr(entity.y, 0);
        normalized.width = finiteOr(entity.width, 0);
        normalized.height = finiteOr(entity.height, 0);
        normalized.rotation = normalizeDegrees(entity.rotation);
        const style = ['chamfer', 'fillet'].includes(entity.cornerStyle)
            ? entity.cornerStyle
            : Number(entity.fillet) > 0 ? 'fillet' : Number(entity.chamfer) > 0 ? 'chamfer' : 'square';
        normalized.cornerStyle = style;
        normalized.cornerValue = Math.max(0, finiteOr(entity.cornerValue ?? entity.chamfer ?? entity.fillet, 0));
    }
    if (entity.type === 'line') {
        normalized.x1 = finiteOr(entity.x1, 0);
        normalized.y1 = finiteOr(entity.y1, 0);
        normalized.x2 = finiteOr(entity.x2, 0);
        normalized.y2 = finiteOr(entity.y2, 0);
    }
    return normalized;
}

function normalizeDrawingLineWidth(value) {
    const width = Number(value);
    return Number.isFinite(width) && width > 0 && width <= 100 ? width : null;
}

function normalizeDegrees(value) {
    const normalized = finiteOr(value, 0) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function finiteOr(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
