import {
    collectDrawingBlockDependencies,
    createAnonymousDrawingBlock,
    createAnonymousDrawingBlockReference,
    getDrawingBlockReferenceBounds,
    multiplyAffineMatrices,
    rotationAffineMatrix,
    remapDrawingBlockDefinition,
    remapDrawingBlockEntity,
    scaleAffineMatrix,
    transformAffinePoint,
    translationAffineMatrix,
} from './drawingBlocks.js';
import { createDrawingId } from './drawingDocument.js';
import {
    arcSweep,
    getArcPath,
    getRectangleOutlinePath,
    getRegularPolygonVertices,
} from './drawingCurves.js';
import {
    formatDrawingLength,
    getDimensionGeometry,
    getEntityBounds,
    pointDistance,
} from './drawingGeometry.js';
import { extractEntityPaths } from './drawingCurveKernel.js';
import { translateEntity } from './drawingPrimitives.js';

export const DRAWING_CLIPBOARD_FORMAT = 'lumcad-clipboard';
export const DRAWING_CLIPBOARD_VERSION = 1;
export const DRAWING_CLIPBOARD_MIME_TYPE = 'application/x-lumcad-clipboard+json';

const SVG_MAX_COORDINATE = 1e12;
const SVG_MAX_PATH_PARTS = 50_000;
const SVG_MAX_TRANSFORM_DEPTH = 32;
const SVG_EPSILON = 1e-9;

export const DRAWING_CLIPBOARD_LIMITS = Object.freeze({
    bytes: 8 * 1024 * 1024,
    entities: 10_000,
    blockDefinitions: 1_024,
    blockEntities: 50_000,
    layers: 2_048,
    assets: 256,
    depth: 32,
    stringLength: 4 * 1024 * 1024,
});

export function createDrawingClipboardPayload(source, selectedIds, {
    basePoint = null,
    sourceDocumentId = source?.id || null,
} = {}) {
    const content = source?.content || source;
    const assets = Array.isArray(source?.assets) ? source.assets : [];
    if (!content || !Array.isArray(content.entities)) throw clipboardError('invalid-source');
    const knownIds = new Set(content.entities.map(entity => entity.id));
    const requestedIds = [...new Set(selectedIds || [])].filter(id => knownIds.has(id));
    if (!requestedIds.length) throw clipboardError('empty-selection');

    const entities = collectEntityDependencyClosure(content.entities, requestedIds).map(cloneJson);
    const referencedBlockIds = entities
        .filter(entity => entity.type === 'blockReference' && entity.blockId)
        .map(entity => entity.blockId);
    const blocks = collectDrawingBlockDependencies(content.blocks || [], referencedBlockIds).map(cloneJson);
    const dependencyEntities = [...entities, ...blocks.flatMap(block => block.entities || [])];
    const layerIds = collectPropertyValues(dependencyEntities, 'layerId');
    const assetIds = collectPropertyValues(dependencyEntities, 'assetId');
    const layers = (content.layers || []).filter(layer => layerIds.has(layer.id)).map(cloneJson);
    const selectedAssets = assets.filter(asset => assetIds.has(asset.id)).map(cloneJson);
    const bounds = clipboardEntitiesBounds(entities, blocks);
    const resolvedBasePoint = normalizePoint(basePoint)
        || (bounds ? { x: bounds.minX, y: bounds.minY } : { x: 0, y: 0 });
    const payload = {
        format: DRAWING_CLIPBOARD_FORMAT,
        version: DRAWING_CLIPBOARD_VERSION,
        unit: 'm',
        basePoint: resolvedBasePoint,
        originalBounds: bounds,
        selectionIds: requestedIds,
        entities,
        layers,
        assets: selectedAssets,
        blocks,
        ...(typeof sourceDocumentId === 'string' && sourceDocumentId ? { sourceDocumentId } : {}),
    };
    return validateDrawingClipboardPayload(payload);
}

export function validateDrawingClipboardPayload(candidate, limits = DRAWING_CLIPBOARD_LIMITS) {
    assertBoundedJson(candidate, limits);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw clipboardError('invalid-payload');
    if (candidate.format !== DRAWING_CLIPBOARD_FORMAT) throw clipboardError('unsupported-format');
    if (candidate.version !== DRAWING_CLIPBOARD_VERSION) throw clipboardError('unsupported-version');
    if (candidate.unit !== 'm') throw clipboardError('unsupported-unit');
    if (!normalizePoint(candidate.basePoint)) throw clipboardError('invalid-base-point');

    const entities = requireObjectArray(candidate.entities, 'entities', limits.entities);
    const layers = requireObjectArray(candidate.layers, 'layers', limits.layers);
    const assets = requireObjectArray(candidate.assets, 'assets', limits.assets);
    const blocks = requireObjectArray(candidate.blocks, 'blocks', limits.blockDefinitions);
    const blockEntityCount = blocks.reduce((count, block) => count + (Array.isArray(block.entities) ? block.entities.length : 0), 0);
    if (blockEntityCount > limits.blockEntities) throw clipboardError('too-many-block-entities');

    assertUniqueStringIds(entities, 'entity');
    assertUniqueStringIds(layers, 'layer');
    assertUniqueStringIds(assets, 'asset');
    assertUniqueStringIds(blocks, 'block');
    blocks.forEach(block => {
        if (!Array.isArray(block.entities)) throw clipboardError('invalid-block');
        assertUniqueStringIds(block.entities, 'block-entity');
    });

    const entityIds = new Set(entities.map(entity => entity.id));
    const layerIds = new Set(layers.map(layer => layer.id));
    const assetIds = new Set(assets.map(asset => asset.id));
    const blockIds = new Set(blocks.map(block => block.id));
    const allEntities = [...entities, ...blocks.flatMap(block => block.entities)];
    allEntities.forEach(entity => {
        if (typeof entity.type !== 'string' || !entity.type) throw clipboardError('invalid-entity');
        if (entity.layerId && !layerIds.has(entity.layerId)) throw clipboardError('missing-layer');
        if (entity.assetId && !assetIds.has(entity.assetId)) throw clipboardError('missing-asset');
        if (entity.type === 'blockReference' && (!entity.blockId || !blockIds.has(entity.blockId))) {
            throw clipboardError('missing-block');
        }
    });
    entities.forEach(entity => {
        if (entity.sourceId && !entityIds.has(entity.sourceId)) throw clipboardError('missing-source');
    });
    blocks.forEach(block => {
        const localIds = new Set(block.entities.map(entity => entity.id));
        block.entities.forEach(entity => {
            if (entity.sourceId && !localIds.has(entity.sourceId)) throw clipboardError('missing-block-source');
        });
    });
    const selectionIds = Array.isArray(candidate.selectionIds) ? [...new Set(candidate.selectionIds)] : [];
    if (!selectionIds.length || selectionIds.some(id => !entityIds.has(id))) throw clipboardError('invalid-selection');

    const cloned = cloneJson({
        ...candidate,
        version: DRAWING_CLIPBOARD_VERSION,
        unit: 'm',
        basePoint: normalizePoint(candidate.basePoint),
        originalBounds: normalizeBounds(candidate.originalBounds),
        selectionIds,
        entities,
        layers,
        assets,
        blocks,
    });
    assertSerializedSize(cloned, limits.bytes);
    return cloned;
}

export function serializeDrawingClipboardPayload(payload) {
    const normalized = validateDrawingClipboardPayload(payload);
    const serialized = JSON.stringify(normalized);
    assertByteLength(serialized, DRAWING_CLIPBOARD_LIMITS.bytes);
    return serialized;
}

export function parseDrawingClipboardText(value) {
    const text = String(value || '').replace(/^\uFEFF/, '').trim();
    if (!text) throw clipboardError('empty-clipboard');
    assertByteLength(text, DRAWING_CLIPBOARD_LIMITS.bytes);
    if (text.startsWith('{')) {
        try {
            return validateDrawingClipboardPayload(JSON.parse(text));
        } catch (error) {
            if (error?.drawingClipboardCode) throw error;
            throw clipboardError('invalid-json');
        }
    }
    const svg = normalizeSvgClipboardText(text);
    if (svg) {
        const embedded = extractEmbeddedClipboardJson(svg);
        if (embedded) return parseDrawingClipboardText(embedded);
        return parseSimpleSvgClipboard(svg);
    }
    throw clipboardError('unsupported-text');
}

export function parseDrawingClipboardInterchange(formats) {
    const entries = formats instanceof Map ? formats : new Map(Object.entries(formats || {}));
    const value = entries.get(DRAWING_CLIPBOARD_MIME_TYPE)
        || entries.get('image/svg+xml')
        || entries.get('text/plain');
    if (typeof value !== 'string') throw clipboardError('empty-clipboard');
    return parseDrawingClipboardText(value);
}

export function createDrawingClipboardInterchange(payload) {
    const normalized = validateDrawingClipboardPayload(payload);
    const json = serializeDrawingClipboardPayload(normalized);
    const svg = drawingClipboardPayloadToSvg(normalized, json);
    return {
        [DRAWING_CLIPBOARD_MIME_TYPE]: json,
        'image/svg+xml': svg,
        'text/plain': svg,
    };
}

export function pasteDrawingClipboardPayload(target, payload, {
    mode = 'insert',
    insertionPoint = null,
    blockLayerId = null,
} = {}) {
    const normalized = validateDrawingClipboardPayload(payload);
    const content = target?.content || target;
    const targetAssets = Array.isArray(target?.assets) ? target.assets : [];
    if (!content || !Array.isArray(content.entities) || !Array.isArray(content.layers)) throw clipboardError('invalid-target');
    if (!['insert', 'original', 'block'].includes(mode)) throw clipboardError('invalid-paste-mode');

    const layerMerge = mergeClipboardLayers(content.layers, normalized.layers);
    const assetMerge = mergeClipboardAssets(targetAssets, normalized.assets);
    const blockMerge = mergeClipboardBlocks(content.blocks || [], normalized.blocks, {
        layerIdMap: layerMerge.idMap,
        assetIdMap: assetMerge.idMap,
    });
    const entityIdMap = new Map(normalized.entities.map(entity => [entity.id, createDrawingId(entity.type || 'entity')]));
    const remappedEntities = normalized.entities.map(entity => remapDrawingBlockEntity(entity, {
        blockIdMap: blockMerge.idMap,
        entityIdMap,
        layerIdMap: layerMerge.idMap,
        assetIdMap: assetMerge.idMap,
    }));
    const basePoint = normalized.basePoint;
    const defaultInsertion = { x: basePoint.x + 0.5, y: basePoint.y + 0.5 };
    const insertion = normalizePoint(insertionPoint) || defaultInsertion;

    if (mode === 'block') {
        const definition = createAnonymousDrawingBlock(remappedEntities, { basePoint });
        const referenceLayerId = resolveBlockLayerId(content, layerMerge.layers, blockLayerId);
        const reference = createAnonymousDrawingBlockReference(definition, {
            insertionPoint: insertion,
            layerId: referenceLayerId,
        });
        return {
            content: {
                ...content,
                layers: layerMerge.layers,
                blocks: [...blockMerge.blocks, definition],
                entities: [...content.entities, reference],
            },
            assets: assetMerge.assets,
            entities: [reference],
            selectedIds: [reference.id],
            mode,
            delta: { x: insertion.x - basePoint.x, y: insertion.y - basePoint.y },
            layerIdMap: layerMerge.idMap,
            assetIdMap: assetMerge.idMap,
            blockIdMap: new Map([...blockMerge.idMap, [definition.id, definition.id]]),
        };
    }

    const delta = mode === 'original'
        ? { x: 0, y: 0 }
        : { x: insertion.x - basePoint.x, y: insertion.y - basePoint.y };
    const pasted = remappedEntities.map(entity => translateEntity(entity, delta.x, delta.y));
    return {
        content: {
            ...content,
            layers: layerMerge.layers,
            blocks: blockMerge.blocks,
            entities: [...content.entities, ...pasted],
        },
        assets: assetMerge.assets,
        entities: pasted,
        selectedIds: normalized.selectionIds.map(id => entityIdMap.get(id)).filter(Boolean),
        mode,
        delta,
        layerIdMap: layerMerge.idMap,
        assetIdMap: assetMerge.idMap,
        blockIdMap: blockMerge.idMap,
    };
}

export function drawingClipboardPayloadToSvg(payload, serialized = null) {
    const normalized = validateDrawingClipboardPayload(payload);
    const json = serialized || serializeDrawingClipboardPayload(normalized);
    const bounds = normalizeBounds(normalized.originalBounds) || clipboardEntitiesBounds(normalized.entities, normalized.blocks)
        || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const width = Math.max(1e-9, bounds.maxX - bounds.minX);
    const height = Math.max(1e-9, bounds.maxY - bounds.minY);
    const blockMap = new Map(normalized.blocks.map(block => [block.id, block]));
    const layerMap = new Map(normalized.layers.map(layer => [layer.id, layer]));
    const assetMap = new Map(normalized.assets.map(asset => [asset.id, asset]));
    const entityMap = new Map(normalized.entities.map(entity => [entity.id, entity]));
    const body = normalized.entities.map(entity => entityToSvg(entity, {
        assetMap,
        blockMap,
        entityMap,
        layerMap,
        visited: new Set(),
    })).join('');
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="${bounds.minX} ${bounds.minY} ${width} ${height}">`,
        `<metadata id="lumcad-clipboard">${escapeXml(json)}</metadata>`,
        body,
        '</svg>',
    ].join('');
}

function normalizeSvgClipboardText(value) {
    const svgStart = value.search(/<svg\b/i);
    if (svgStart < 0) return null;
    const prefix = value.slice(0, svgStart)
        .replace(/<\?xml\s[\s\S]*?\?>/gi, '')
        .replace(/<!--([\s\S]*?)-->/g, '')
        .replace(/<!doctype\s+svg(?:\s+[^>[\]]+)?\s*>/gi, '')
        .trim();
    if (prefix) return null;
    const closing = /<\/svg\s*>/ig;
    let match = null;
    let last = null;
    while ((match = closing.exec(value))) last = match;
    if (!last) return null;
    const suffix = value.slice(last.index + last[0].length)
        .replace(/<!--([\s\S]*?)-->/g, '')
        .trim();
    if (suffix) return null;
    return value.slice(svgStart, last.index + last[0].length);
}

function collectEntityDependencyClosure(allEntities, selectedIds) {
    const byId = new Map(allEntities.map(entity => [entity.id, entity]));
    const included = new Set(selectedIds);
    let changed = true;
    while (changed) {
        changed = false;
        [...included].forEach(id => {
            const sourceId = byId.get(id)?.sourceId;
            if (sourceId && byId.has(sourceId) && !included.has(sourceId)) {
                included.add(sourceId);
                changed = true;
            }
        });
        allEntities.forEach(entity => {
            if (entity.sourceId && included.has(entity.sourceId) && !included.has(entity.id)) {
                included.add(entity.id);
                changed = true;
            }
        });
    }
    return allEntities.filter(entity => included.has(entity.id));
}

function mergeClipboardLayers(existingLayers, incomingLayers) {
    const layers = existingLayers.map(cloneJson);
    const idMap = new Map();
    incomingLayers.forEach(layer => {
        const sameId = layers.find(candidate => candidate.id === layer.id);
        const sameName = layers.find(candidate => String(candidate.name).toLowerCase() === String(layer.name).toLowerCase());
        const reusable = sameId || sameName;
        if (reusable) {
            idMap.set(layer.id, reusable.id);
            return;
        }
        const id = uniqueId(layer.id || 'layer', new Set(layers.map(candidate => candidate.id)));
        layers.push({ ...cloneJson(layer), id });
        idMap.set(layer.id, id);
    });
    return { layers, idMap };
}

function mergeClipboardAssets(existingAssets, incomingAssets) {
    const assets = existingAssets.map(cloneJson);
    const idMap = new Map();
    incomingAssets.forEach(asset => {
        const fingerprint = assetFingerprint(asset);
        const equivalent = assets.find(candidate => assetFingerprint(candidate) === fingerprint);
        if (equivalent) {
            idMap.set(asset.id, equivalent.id);
            return;
        }
        const existingId = assets.some(candidate => candidate.id === asset.id);
        const id = existingId ? createDrawingId('asset') : asset.id;
        assets.push({ ...cloneJson(asset), id });
        idMap.set(asset.id, id);
    });
    return { assets, idMap };
}

function mergeClipboardBlocks(existingBlocks, incomingBlocks, mappings) {
    const blocks = existingBlocks.map(cloneJson);
    const idMap = new Map();
    const usedIds = new Set(blocks.map(block => block.id));
    incomingBlocks.forEach(block => {
        const existing = blocks.find(candidate => candidate.id === block.id && equivalentJson(candidate, block));
        if (existing) idMap.set(block.id, existing.id);
        else {
            const id = uniqueId(block.id || 'block', usedIds);
            usedIds.add(id);
            idMap.set(block.id, id);
        }
    });
    incomingBlocks.forEach(block => {
        const id = idMap.get(block.id);
        if (blocks.some(candidate => candidate.id === id)) return;
        blocks.push(remapDrawingBlockDefinition(block, { ...mappings, blockIdMap: idMap }));
    });
    return { blocks, idMap };
}

function resolveBlockLayerId(content, mergedLayers, requested) {
    if (requested && mergedLayers.some(layer => layer.id === requested)) return requested;
    if (mergedLayers.some(layer => layer.id === content.activeLayerId)) return content.activeLayerId;
    return mergedLayers[0]?.id || 'geometry';
}

function parseSimpleSvgClipboard(svg) {
    const entities = [];
    const layerId = 'geometry';
    const stack = [{ name: null, matrix: identitySvgMatrix(), suppressed: false }];
    const tags = svg.match(/<!--[\s\S]*?-->|<[^>]+>/g) || [];
    tags.forEach(tag => {
        if (/^<!--|^<\?|^<!/i.test(tag)) return;
        const closing = /^<\s*\//.test(tag);
        const name = /^<\s*\/?\s*([a-z][\w:-]*)/i.exec(tag)?.[1]?.toLowerCase();
        if (!name) throw clipboardError('invalid-svg');
        if (closing) {
            if (stack.at(-1).name === name) stack.pop();
            return;
        }
        const attributes = parseSvgAttributes(tag);
        const parent = stack.at(-1);
        const ownTransform = parseSvgTransform(attributes.transform);
        const matrix = multiplyAffineMatrices(parent.matrix, ownTransform);
        const suppressed = parent.suppressed || ['defs', 'metadata', 'clippath', 'mask', 'symbol'].includes(name);
        const selfClosing = /\/\s*>$/.test(tag);
        if (['svg', 'g', 'a', 'switch', 'defs', 'metadata', 'clippath', 'mask', 'symbol'].includes(name) && !selfClosing) {
            if (stack.length >= SVG_MAX_TRANSFORM_DEPTH) throw clipboardError('svg-too-deep');
            stack.push({ name, matrix, suppressed });
        }
        if (suppressed) return;
        const parsed = parseSvgGeometryElement(name, attributes, matrix, layerId);
        parsed.forEach(entity => {
            if (entities.length >= DRAWING_CLIPBOARD_LIMITS.entities) throw clipboardError('too-many-entities');
            entities.push({ ...entity, id: createDrawingId(entity.type || 'entity'), layerId });
        });
    });
    if (!entities.length) throw clipboardError('unsupported-svg');
    const bounds = clipboardEntitiesBounds(entities, []);
    if (!bounds) throw clipboardError('invalid-svg-bounds');
    return validateDrawingClipboardPayload({
        format: DRAWING_CLIPBOARD_FORMAT,
        version: DRAWING_CLIPBOARD_VERSION,
        unit: 'm',
        basePoint: bounds ? { x: bounds.minX, y: bounds.minY } : { x: 0, y: 0 },
        originalBounds: bounds,
        selectionIds: entities.map(entity => entity.id),
        entities,
        layers: [{
            id: layerId, name: '0', color: '#172033', lineWeight: 1,
            lineType: 'continuous', transparency: 0, visible: true, locked: false,
        }],
        assets: [],
        blocks: [],
    });
}

function parseSvgGeometryElement(name, attributes, matrix, layerId) {
    if (name === 'line') {
        const [x1, y1, x2, y2] = requiredSvgAttributes(attributes, ['x1', 'y1', 'x2', 'y2']);
        return [transformSvgEntity({ type: 'line', layerId, x1, y1, x2, y2 }, matrix)];
    }
    if (name === 'rect') {
        const x = finiteAttribute(attributes, 'x', 0);
        const y = finiteAttribute(attributes, 'y', 0);
        const width = finiteAttribute(attributes, 'width');
        const height = finiteAttribute(attributes, 'height');
        assertSvgNumbers([x, y, width, height], 'invalid-svg-geometry');
        if (width <= 0 || height <= 0) throw clipboardError('invalid-svg-geometry');
        return [transformSvgEntity({ type: 'rectangle', layerId, x, y, width, height, rotation: 0 }, matrix)];
    }
    if (name === 'circle') {
        const [cx, cy, r] = requiredSvgAttributes(attributes, ['cx', 'cy', 'r']);
        if (r <= 0) throw clipboardError('invalid-svg-geometry');
        return [transformSvgEntity({ type: 'circle', layerId, cx, cy, r }, matrix)];
    }
    if (name === 'ellipse') {
        const [cx, cy, rx, ry] = requiredSvgAttributes(attributes, ['cx', 'cy', 'rx', 'ry']);
        if (rx <= 0 || ry <= 0) throw clipboardError('invalid-svg-geometry');
        return [transformSvgEntity({
            type: 'ellipse', layerId, cx, cy, rx, ry, rotation: 0,
            startAngle: 0, endAngle: 0, counterClockwise: true, fullEllipse: true,
        }, matrix)];
    }
    if (name === 'polyline' || name === 'polygon') {
        const points = parseSvgPoints(attributes.points);
        if (points.length < (name === 'polygon' ? 3 : 2)) throw clipboardError('invalid-svg-geometry');
        return [transformSvgEntity({ type: 'polyline', layerId, points, closed: name === 'polygon' }, matrix)];
    }
    if (name === 'path') {
        if (typeof attributes.d !== 'string' || !attributes.d.trim()) throw clipboardError('invalid-svg-path');
        return parseSvgPath(attributes.d).map(path => transformSvgEntity({ ...path, layerId }, matrix));
    }
    return [];
}

function parseSvgPath(data) {
    const tokens = tokenizeSvgPath(data);
    const paths = [];
    let index = 0;
    let command = null;
    let current = { x: 0, y: 0 };
    let start = null;
    let active = null;
    let partCount = 0;

    const finishActive = () => {
        if (active?.parts.length) paths.push(active);
        active = null;
        start = null;
    };
    const ensureActive = () => {
        if (!active) {
            active = { type: 'polyline', parts: [], closed: false };
            start = { ...current };
        }
    };
    const append = part => {
        if (!part) return;
        ensureActive();
        partCount += 1;
        if (partCount > SVG_MAX_PATH_PARTS) throw clipboardError('svg-path-too-complex');
        active.parts.push(part);
    };

    while (index < tokens.length) {
        if (typeof tokens[index] === 'string') {
            command = tokens[index];
            index += 1;
            const upper = command.toUpperCase();
            if (upper === 'Z') {
                if (!active || !start) throw clipboardError('invalid-svg-path');
                if (pointDistance(current, start) > SVG_EPSILON) append(lineCurve(current, start));
                active.closed = true;
                current = { ...start };
                command = null;
                continue;
            }
            if (index >= tokens.length || typeof tokens[index] === 'string') throw clipboardError('invalid-svg-path');
        }
        if (!command) throw clipboardError('invalid-svg-path');
        const relative = command === command.toLowerCase();
        const upper = command.toUpperCase();
        if (active?.closed && upper !== 'M') throw clipboardError('invalid-svg-path');
        const parameterCount = ({ M: 2, L: 2, H: 1, V: 1, C: 6, A: 7 })[upper];
        if (!parameterCount || index + parameterCount > tokens.length
            || tokens.slice(index, index + parameterCount).some(token => typeof token === 'string')) {
            throw clipboardError('invalid-svg-path');
        }
        const values = tokens.slice(index, index + parameterCount);
        index += parameterCount;
        assertSvgNumbers(values);

        if (upper === 'M') {
            const point = svgCommandPoint(values[0], values[1], current, relative);
            finishActive();
            current = point;
            start = { ...point };
            active = { type: 'polyline', parts: [], closed: false };
            command = relative ? 'l' : 'L';
            continue;
        }
        ensureActive();
        if (upper === 'L') {
            const point = svgCommandPoint(values[0], values[1], current, relative);
            append(lineCurve(current, point));
            current = point;
        } else if (upper === 'H') {
            const point = { x: relative ? current.x + values[0] : values[0], y: current.y };
            append(lineCurve(current, point));
            current = point;
        } else if (upper === 'V') {
            const point = { x: current.x, y: relative ? current.y + values[0] : values[0] };
            append(lineCurve(current, point));
            current = point;
        } else if (upper === 'C') {
            const firstControl = svgCommandPoint(values[0], values[1], current, relative);
            const secondControl = svgCommandPoint(values[2], values[3], current, relative);
            const point = svgCommandPoint(values[4], values[5], current, relative);
            append({
                type: 'spline',
                degree: 3,
                controlPoints: [{ ...current }, firstControl, secondControl, point],
            });
            current = point;
        } else if (upper === 'A') {
            const point = svgCommandPoint(values[5], values[6], current, relative);
            const largeArc = svgFlag(values[3]);
            const sweep = svgFlag(values[4]);
            append(svgEndpointArc(current, point, values[0], values[1], values[2], largeArc, sweep));
            current = point;
        }
    }
    finishActive();
    if (!paths.length) throw clipboardError('invalid-svg-path');
    return paths.map(path => path.parts.length === 1 && !path.closed ? path.parts[0] : path);
}

function tokenizeSvgPath(data) {
    if (byteLength(data) > DRAWING_CLIPBOARD_LIMITS.stringLength) throw clipboardError('string-too-large');
    const tokens = [];
    const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;
    let index = 0;
    while (index < data.length) {
        const separators = /^[\s,]+/.exec(data.slice(index));
        if (separators) {
            index += separators[0].length;
            continue;
        }
        const character = data[index];
        if (/[a-z]/i.test(character)) {
            if (!/[AaCcHhLlMmVvZz]/.test(character)) throw clipboardError('unsupported-svg-path');
            tokens.push(character);
            index += 1;
            continue;
        }
        const number = numberPattern.exec(data.slice(index));
        if (!number) throw clipboardError('invalid-svg-path');
        const value = Number(number[0]);
        if (!Number.isFinite(value)) throw clipboardError('invalid-svg-path');
        tokens.push(value);
        index += number[0].length;
        if (tokens.length > SVG_MAX_PATH_PARTS * 8) throw clipboardError('svg-path-too-complex');
    }
    return tokens;
}

function svgEndpointArc(first, second, radiusX, radiusY, rotationDegrees, largeArc, sweep) {
    let rx = Math.abs(Number(radiusX));
    let ry = Math.abs(Number(radiusY));
    const rotation = Number(rotationDegrees);
    assertSvgNumbers([first.x, first.y, second.x, second.y, rx, ry, rotation]);
    if (pointDistance(first, second) <= SVG_EPSILON) return null;
    if (rx <= SVG_EPSILON || ry <= SVG_EPSILON) return lineCurve(first, second);
    const phi = rotation * Math.PI / 180;
    const cosine = Math.cos(phi);
    const sine = Math.sin(phi);
    const half = { x: (first.x - second.x) / 2, y: (first.y - second.y) / 2 };
    const prime = {
        x: cosine * half.x + sine * half.y,
        y: -sine * half.x + cosine * half.y,
    };
    const scale = prime.x ** 2 / rx ** 2 + prime.y ** 2 / ry ** 2;
    if (scale > 1) {
        const multiplier = Math.sqrt(scale);
        rx *= multiplier;
        ry *= multiplier;
    }
    const numerator = Math.max(0, rx ** 2 * ry ** 2 - rx ** 2 * prime.y ** 2 - ry ** 2 * prime.x ** 2);
    const denominator = rx ** 2 * prime.y ** 2 + ry ** 2 * prime.x ** 2;
    const sign = largeArc === sweep ? -1 : 1;
    const coefficient = denominator <= SVG_EPSILON ? 0 : sign * Math.sqrt(numerator / denominator);
    const centerPrime = {
        x: coefficient * rx * prime.y / ry,
        y: coefficient * -ry * prime.x / rx,
    };
    const center = {
        x: cosine * centerPrime.x - sine * centerPrime.y + (first.x + second.x) / 2,
        y: sine * centerPrime.x + cosine * centerPrime.y + (first.y + second.y) / 2,
    };
    const startAngle = vectorAngle(
        { x: 1, y: 0 },
        { x: (prime.x - centerPrime.x) / rx, y: (prime.y - centerPrime.y) / ry },
    );
    let delta = vectorAngle(
        { x: (prime.x - centerPrime.x) / rx, y: (prime.y - centerPrime.y) / ry },
        { x: (-prime.x - centerPrime.x) / rx, y: (-prime.y - centerPrime.y) / ry },
    );
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    if (sweep && delta < 0) delta += Math.PI * 2;
    const endAngle = startAngle + delta;
    if (Math.abs(rx - ry) <= SVG_EPSILON * Math.max(1, rx, ry)) {
        return {
            type: 'arc', cx: center.x, cy: center.y, r: (rx + ry) / 2,
            startAngle: startAngle + phi, endAngle: endAngle + phi, counterClockwise: Boolean(sweep),
        };
    }
    return {
        type: 'ellipse', cx: center.x, cy: center.y, rx, ry, rotation,
        startAngle, endAngle, counterClockwise: Boolean(sweep), fullEllipse: false,
    };
}

function parseSvgTransform(value) {
    if (value === undefined || !String(value).trim()) return identitySvgMatrix();
    const source = String(value);
    const pattern = /([a-z]+)\s*\(([^)]*)\)/ig;
    let matrix = identitySvgMatrix();
    let consumed = '';
    for (const match of source.matchAll(pattern)) {
        consumed += match[0];
        const name = match[1].toLowerCase();
        const numbers = parseSvgNumberList(match[2]);
        let next;
        if (name === 'matrix' && numbers.length === 6) {
            next = { a: numbers[0], b: numbers[1], c: numbers[2], d: numbers[3], e: numbers[4], f: numbers[5] };
        } else if (name === 'translate' && [1, 2].includes(numbers.length)) {
            next = translationAffineMatrix(numbers[0], numbers[1] || 0);
        } else if (name === 'scale' && [1, 2].includes(numbers.length)) {
            next = scaleAffineMatrix(numbers[0], numbers[1] ?? numbers[0]);
        } else if (name === 'rotate' && [1, 3].includes(numbers.length)) {
            next = rotationAffineMatrix(numbers[0], numbers.length === 3 ? { x: numbers[1], y: numbers[2] } : { x: 0, y: 0 });
        } else throw clipboardError('unsupported-svg-transform');
        matrix = multiplyAffineMatrices(matrix, next);
    }
    const residue = source.replace(pattern, '').replace(/[\s,]+/g, '');
    if (!consumed || residue) throw clipboardError('invalid-svg-transform');
    assertSvgNumbers(Object.values(matrix));
    return matrix;
}

function transformSvgEntity(entity, matrix) {
    if (entity.type === 'line') {
        const first = checkedSvgPoint(transformAffinePoint({ x: entity.x1, y: entity.y1 }, matrix));
        const second = checkedSvgPoint(transformAffinePoint({ x: entity.x2, y: entity.y2 }, matrix));
        return { ...entity, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
    }
    if (entity.type === 'spline') return {
        ...entity,
        controlPoints: entity.controlPoints.map(point => checkedSvgPoint(transformAffinePoint(point, matrix))),
    };
    if (['circle', 'arc', 'ellipse'].includes(entity.type)) return transformSvgEllipse(entity, matrix);
    if (entity.type === 'rectangle') {
        if (isIdentitySvgMatrix(matrix)) return entity;
        const points = [
            { x: entity.x, y: entity.y },
            { x: entity.x + entity.width, y: entity.y },
            { x: entity.x + entity.width, y: entity.y + entity.height },
            { x: entity.x, y: entity.y + entity.height },
        ].map(point => checkedSvgPoint(transformAffinePoint(point, matrix)));
        return {
            type: 'polyline', layerId: entity.layerId, closed: true,
            parts: points.map((point, index) => lineCurve(point, points[(index + 1) % points.length])),
        };
    }
    if (entity.type === 'polyline') return {
        ...entity,
        ...(Array.isArray(entity.parts)
            ? { parts: entity.parts.map(part => transformSvgEntity(part, matrix)) }
            : { points: entity.points.map(point => checkedSvgPoint(transformAffinePoint(point, matrix))) }),
    };
    return entity;
}

function transformSvgEllipse(entity, matrix) {
    const rx = entity.type === 'ellipse' ? Number(entity.rx) : Math.abs(Number(entity.r));
    const ry = entity.type === 'ellipse' ? Number(entity.ry) : Math.abs(Number(entity.r));
    const rotation = entity.type === 'ellipse' ? Number(entity.rotation) || 0 : 0;
    const phi = rotation * Math.PI / 180;
    const firstAxis = transformSvgVector({ x: Math.cos(phi) * rx, y: Math.sin(phi) * rx }, matrix);
    const secondAxis = transformSvgVector({ x: -Math.sin(phi) * ry, y: Math.cos(phi) * ry }, matrix);
    const decomposition = ellipseAxes(firstAxis, secondAxis);
    if (!decomposition) throw clipboardError('invalid-svg-transform');
    const center = checkedSvgPoint(transformAffinePoint({ x: entity.cx, y: entity.cy }, matrix));
    if (Math.max(Math.abs(center.x), Math.abs(center.y)) + Math.max(decomposition.rx, decomposition.ry) > SVG_MAX_COORDINATE) {
        throw clipboardError('unbounded-svg');
    }
    const full = entity.type === 'circle' || Boolean(entity.fullEllipse);
    const start = full ? 0 : Number(entity.startAngle) || 0;
    const end = full ? 0 : Number(entity.endAngle) || 0;
    const transformedStart = transformedEllipseAngle(entity, start, matrix, center, decomposition);
    const transformedEnd = full ? 0 : transformedEllipseAngle(entity, end, matrix, center, decomposition);
    const reflected = firstAxis.x * secondAxis.y - firstAxis.y * secondAxis.x < 0;
    const counterClockwise = reflected ? entity.counterClockwise === false : entity.counterClockwise !== false;
    if (Math.abs(decomposition.rx - decomposition.ry) <= SVG_EPSILON * Math.max(1, decomposition.rx, decomposition.ry)) {
        if (full) return { ...entity, type: 'circle', cx: center.x, cy: center.y, r: (decomposition.rx + decomposition.ry) / 2 };
        return {
            ...entity, type: 'arc', cx: center.x, cy: center.y, r: (decomposition.rx + decomposition.ry) / 2,
            startAngle: transformedStart + decomposition.rotationRadians,
            endAngle: transformedEnd + decomposition.rotationRadians,
            counterClockwise,
        };
    }
    return {
        ...entity,
        type: 'ellipse',
        cx: center.x,
        cy: center.y,
        rx: decomposition.rx,
        ry: decomposition.ry,
        rotation: decomposition.rotationRadians * 180 / Math.PI,
        startAngle: transformedStart,
        endAngle: transformedEnd,
        counterClockwise,
        fullEllipse: full,
    };
}

function transformedEllipseAngle(entity, parameter, matrix, center, decomposition) {
    const point = transformAffinePoint(ellipsePoint(entity, parameter), matrix);
    const vector = { x: point.x - center.x, y: point.y - center.y };
    return Math.atan2(
        (vector.x * decomposition.second.x + vector.y * decomposition.second.y) / decomposition.ry,
        (vector.x * decomposition.first.x + vector.y * decomposition.first.y) / decomposition.rx,
    );
}

function ellipseAxes(firstAxis, secondAxis) {
    const xx = firstAxis.x ** 2 + secondAxis.x ** 2;
    const xy = firstAxis.x * firstAxis.y + secondAxis.x * secondAxis.y;
    const yy = firstAxis.y ** 2 + secondAxis.y ** 2;
    const root = Math.hypot(xx - yy, 2 * xy);
    const firstValue = Math.max(0, (xx + yy + root) / 2);
    const secondValue = Math.max(0, (xx + yy - root) / 2);
    const rx = Math.sqrt(firstValue);
    const ry = Math.sqrt(secondValue);
    if (rx <= SVG_EPSILON || ry <= SVG_EPSILON || Math.max(rx, ry) > SVG_MAX_COORDINATE) return null;
    let first;
    if (Math.abs(xy) > SVG_EPSILON) first = normalizeSvgVector({ x: firstValue - yy, y: xy });
    else first = xx >= yy ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const second = { x: -first.y, y: first.x };
    return { first, second, rx, ry, rotationRadians: Math.atan2(first.y, first.x) };
}

function ellipsePoint(entity, angle) {
    const rx = entity.type === 'ellipse' ? Number(entity.rx) : Math.abs(Number(entity.r));
    const ry = entity.type === 'ellipse' ? Number(entity.ry) : Math.abs(Number(entity.r));
    const rotation = (entity.type === 'ellipse' ? Number(entity.rotation) || 0 : 0) * Math.PI / 180;
    const local = { x: Math.cos(angle) * rx, y: Math.sin(angle) * ry };
    return {
        x: Number(entity.cx) + local.x * Math.cos(rotation) - local.y * Math.sin(rotation),
        y: Number(entity.cy) + local.x * Math.sin(rotation) + local.y * Math.cos(rotation),
    };
}

function transformSvgVector(vector, matrix) {
    return {
        x: matrix.a * vector.x + matrix.c * vector.y,
        y: matrix.b * vector.x + matrix.d * vector.y,
    };
}

function normalizeSvgVector(vector) {
    const length = Math.hypot(vector.x, vector.y);
    return length > SVG_EPSILON ? { x: vector.x / length, y: vector.y / length } : { x: 1, y: 0 };
}

function vectorAngle(first, second) {
    return Math.atan2(first.x * second.y - first.y * second.x, first.x * second.x + first.y * second.y);
}

function svgCommandPoint(x, y, current, relative) {
    return checkedSvgPoint({ x: relative ? current.x + x : x, y: relative ? current.y + y : y });
}

function lineCurve(first, second) {
    return { type: 'line', x1: first.x, y1: first.y, x2: second.x, y2: second.y };
}

function svgFlag(value) {
    if (value !== 0 && value !== 1) throw clipboardError('invalid-svg-path');
    return value === 1;
}

function parseSvgNumberList(value) {
    const source = String(value || '').trim();
    if (!source) return [];
    const parts = source.split(/[\s,]+/);
    if (parts.some(part => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(part))) {
        throw clipboardError('invalid-svg-transform');
    }
    const numbers = parts.map(Number);
    assertSvgNumbers(numbers);
    return numbers;
}

function requiredSvgAttributes(attributes, names) {
    const values = names.map(name => finiteAttribute(attributes, name));
    assertSvgNumbers(values, 'invalid-svg-geometry');
    return values;
}

function assertSvgNumbers(values, invalidCode = 'unbounded-svg') {
    if (values.some(value => !Number.isFinite(Number(value)))) throw clipboardError(invalidCode);
    if (values.some(value => Math.abs(Number(value)) > SVG_MAX_COORDINATE)) throw clipboardError('unbounded-svg');
}

function checkedSvgPoint(point) {
    assertSvgNumbers([point?.x, point?.y]);
    return { x: Number(point.x), y: Number(point.y) };
}

function identitySvgMatrix() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function isIdentitySvgMatrix(matrix) {
    const identity = identitySvgMatrix();
    return Object.keys(identity).every(key => Math.abs(matrix[key] - identity[key]) <= SVG_EPSILON);
}

function entityToSvg(entity, context) {
    const appearance = entityAppearance(entity, context.layerMap.get(entity.layerId));
    const common = ` fill="none" stroke="${escapeXml(appearance.color)}" stroke-width="${appearance.lineWeight}" opacity="${appearance.opacity}"`;
    if (entity.type === 'line') return `<line x1="${entity.x1}" y1="${entity.y1}" x2="${entity.x2}" y2="${entity.y2}"${common}/>`;
    if (entity.type === 'rectangle') {
        const centerX = Number(entity.x) + Number(entity.width) / 2;
        const centerY = Number(entity.y) + Number(entity.height) / 2;
        const transform = Number(entity.rotation) ? ` transform="rotate(${entity.rotation} ${centerX} ${centerY})"` : '';
        return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
            ? `<path d="${escapeXml(getRectangleOutlinePath(entity))}"${transform}${common}/>`
            : `<rect x="${entity.x}" y="${entity.y}" width="${entity.width}" height="${entity.height}"${transform}${common}/>`;
    }
    if (entity.type === 'circle') return `<circle cx="${entity.cx}" cy="${entity.cy}" r="${Math.abs(entity.r)}"${common}/>`;
    if (entity.type === 'ellipse') {
        if (entity.fullEllipse || (entity.startAngle === undefined && entity.endAngle === undefined)) {
            const transform = Number(entity.rotation) ? ` transform="rotate(${entity.rotation} ${entity.cx} ${entity.cy})"` : '';
            return `<ellipse cx="${entity.cx}" cy="${entity.cy}" rx="${Math.abs(entity.rx)}" ry="${Math.abs(entity.ry)}"${transform}${common}/>`;
        }
        return `<path d="${escapeXml(ellipseArcPath(entity))}"${common}/>`;
    }
    if (entity.type === 'polygon') return `<polygon points="${svgPoints(getRegularPolygonVertices(entity))}"${common}/>`;
    if (entity.type === 'arc') return `<path d="${escapeXml(getArcPath(entity))}"${common}/>`;
    if (entity.type === 'spline' && Array.isArray(entity.controlPoints) && entity.controlPoints.length === 4) {
        const [first, firstControl, secondControl, last] = entity.controlPoints;
        return `<path d="M ${first.x} ${first.y} C ${firstControl.x} ${firstControl.y} ${secondControl.x} ${secondControl.y} ${last.x} ${last.y}"${common}/>`;
    }
    if (entity.type === 'path' && Array.isArray(entity.parts)) {
        return `<path d="${escapeXml(curvePathToSvgData(entity))}"${common}/>`;
    }
    if (entity.type === 'polyline') {
        if (Array.isArray(entity.parts)) return `<g>${entity.parts.map(part => entityToSvg({ ...part, layerId: entity.layerId }, context)).join('')}</g>`;
        const tag = entity.closed ? 'polygon' : 'polyline';
        return `<${tag} points="${svgPoints(entity.points || [])}"${common}/>`;
    }
    if (entity.type === 'text') return `<text x="${entity.x}" y="${Number(entity.y) + (Number(entity.fontSize) || 0.35)}" fill="${escapeXml(appearance.color)}">${escapeXml(entity.text || '')}</text>`;
    if (entity.type === 'hatch' || entity.type === 'block') {
        const paths = extractEntityPaths(entity, {
            boundaryExtractor: candidate => candidate?.boundaries || candidate?.loops,
        });
        return `<g>${paths.map(path => `<path d="${escapeXml(curvePathToSvgData(path))}"${common}/>`).join('')}</g>`;
    }
    if (entity.type === 'linearDimension' || entity.type === 'radialDimension') {
        return dimensionToSvg(entity, context.entityMap.get(entity.sourceId), common, appearance.color);
    }
    if (entity.type === 'image') {
        const link = entity.link || context.assetMap.get(entity.assetId)?.link;
        if (typeof link === 'string') {
            return `<image x="${entity.x}" y="${entity.y}" width="${entity.width}" height="${entity.height}" href="${escapeXml(link)}"/>`;
        }
    }
    if (entity.type === 'blockReference') {
        if (context.visited.has(entity.blockId)) return '';
        const definition = context.blockMap.get(entity.blockId);
        if (!definition) return '';
        const next = {
            ...context,
            entityMap: new Map(definition.entities.map(child => [child.id, child])),
            visited: new Set(context.visited).add(entity.blockId),
        };
        const matrix = entity.transform || { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        return `<g transform="matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})">${definition.entities.map(child => entityToSvg(child, next)).join('')}</g>`;
    }
    return '';
}

function ellipseArcPath(entity) {
    const start = ellipsePoint(entity, Number(entity.startAngle) || 0);
    const end = ellipsePoint(entity, Number(entity.endAngle) || 0);
    const sweep = curveSweepValue(entity);
    return `M ${start.x} ${start.y} A ${Math.abs(entity.rx)} ${Math.abs(entity.ry)} ${Number(entity.rotation) || 0} ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}`;
}

function curvePathToSvgData(path) {
    const parts = Array.isArray(path?.parts) ? path.parts : [];
    const commands = [];
    let previous = null;
    parts.forEach(part => {
        const start = curveSvgStart(part);
        if (!start) return;
        if (!previous || pointDistance(previous, start) > SVG_EPSILON) commands.push(`M ${start.x} ${start.y}`);
        if (part.type === 'line') {
            commands.push(`L ${part.x2} ${part.y2}`);
            previous = { x: part.x2, y: part.y2 };
        } else if (part.type === 'arc') {
            const end = ellipsePoint(part, Number(part.endAngle) || 0);
            const sweep = arcSweep(part);
            commands.push(`A ${Math.abs(part.r)} ${Math.abs(part.r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}`);
            previous = end;
        } else if (part.type === 'ellipse') {
            if (part.fullEllipse) {
                const opposite = ellipsePoint(part, Math.PI);
                commands.push(`A ${Math.abs(part.rx)} ${Math.abs(part.ry)} ${Number(part.rotation) || 0} 0 1 ${opposite.x} ${opposite.y}`);
                commands.push(`A ${Math.abs(part.rx)} ${Math.abs(part.ry)} ${Number(part.rotation) || 0} 0 1 ${start.x} ${start.y}`);
                previous = start;
            } else {
                const end = ellipsePoint(part, Number(part.endAngle) || 0);
                const sweep = curveSweepValue(part);
                commands.push(`A ${Math.abs(part.rx)} ${Math.abs(part.ry)} ${Number(part.rotation) || 0} ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}`);
                previous = end;
            }
        } else if (part.type === 'circle') {
            const opposite = { x: part.cx - Math.abs(part.r), y: part.cy };
            commands.push(`A ${Math.abs(part.r)} ${Math.abs(part.r)} 0 0 1 ${opposite.x} ${opposite.y}`);
            commands.push(`A ${Math.abs(part.r)} ${Math.abs(part.r)} 0 0 1 ${start.x} ${start.y}`);
            previous = start;
        } else if (part.type === 'spline' && part.controlPoints?.length === 4) {
            const [, firstControl, secondControl, end] = part.controlPoints;
            commands.push(`C ${firstControl.x} ${firstControl.y} ${secondControl.x} ${secondControl.y} ${end.x} ${end.y}`);
            previous = end;
        }
    });
    if (path?.closed && commands.length) commands.push('Z');
    return commands.join(' ');
}

function curveSvgStart(part) {
    if (part?.type === 'line') return { x: part.x1, y: part.y1 };
    if (part?.type === 'spline') return part.controlPoints?.[0] || null;
    if (part?.type === 'circle') return { x: part.cx + Math.abs(part.r), y: part.cy };
    if (part?.type === 'arc' || part?.type === 'ellipse') {
        return ellipsePoint(part, Number(part.startAngle) || 0);
    }
    return null;
}

function curveSweepValue(entity) {
    if (entity.fullEllipse) return entity.counterClockwise === false ? -Math.PI * 2 : Math.PI * 2;
    const start = Number(entity.startAngle) || 0;
    const end = Number(entity.endAngle) || 0;
    let delta = (end - start) % (Math.PI * 2);
    if (entity.counterClockwise !== false && delta < 0) delta += Math.PI * 2;
    if (entity.counterClockwise === false && delta > 0) delta -= Math.PI * 2;
    return delta;
}

function dimensionToSvg(entity, source, common, color) {
    const geometry = getDimensionGeometry(entity, source);
    if (!geometry) return '';
    const textSize = Math.max(0.01, Number(entity.textSize) || 0.35);
    const line = (first, second) => `<line x1="${first.x}" y1="${first.y}" x2="${second.x}" y2="${second.y}"${common}/>`;
    const tick = (point, angle) => {
        const tickAngle = angle + Math.PI / 4;
        const dx = Math.cos(tickAngle) * textSize * 0.35;
        const dy = Math.sin(tickAngle) * textSize * 0.35;
        return line({ x: point.x - dx, y: point.y - dy }, { x: point.x + dx, y: point.y + dy });
    };
    if (geometry.kind === 'linear') {
        const angle = geometry.angle * 180 / Math.PI;
        const readable = angle > 90 || angle < -90 ? angle + 180 : angle;
        return `<g>${line(geometry.sourceFirst, geometry.first)}${line(geometry.sourceSecond, geometry.second)}${line(geometry.first, geometry.second)}${tick(geometry.first, geometry.angle)}${tick(geometry.second, geometry.angle)}<text x="${geometry.text.x}" y="${geometry.text.y}" text-anchor="middle" transform="rotate(${readable} ${geometry.text.x} ${geometry.text.y})" fill="${escapeXml(color)}">${escapeXml(formatDrawingLength(geometry.value, 4, 'en'))}</text></g>`;
    }
    const label = `${geometry.mode === 'diameter' ? 'Ø ' : 'R '}${formatDrawingLength(geometry.value, 4, 'en')}`;
    return `<g>${line(geometry.center, geometry.text)}${tick(geometry.edge, geometry.angle)}<text x="${geometry.text.x}" y="${geometry.text.y}" fill="${escapeXml(color)}">${escapeXml(label)}</text></g>`;
}

function clipboardEntitiesBounds(entities, blocks) {
    const entityMap = new Map((entities || []).map(entity => [entity.id, entity]));
    return (entities || []).reduce((combined, entity) => {
        const bounds = entity.type === 'blockReference'
            ? getDrawingBlockReferenceBounds(entity, blocks)
            : clipboardEntityBounds(entity, entityMap);
        return combineBounds(combined, bounds);
    }, null);
}

function clipboardEntityBounds(entity, entityMap = new Map()) {
    const direct = getEntityBounds(entity, entityMap);
    if (normalizeBounds(direct)) return direct;
    if (entity?.type === 'ellipse') return boundsFromSvgPoints(sampleEllipsePoints(entity));
    if (entity?.type === 'spline') return boundsFromSvgPoints(entity.controlPoints || []);
    if (entity?.type === 'path' || (entity?.type === 'polyline' && Array.isArray(entity.parts))) {
        return (entity.parts || []).reduce((combined, part) => combineBounds(combined, clipboardEntityBounds(part, entityMap)), null);
    }
    if (entity?.type === 'hatch' || entity?.type === 'block') {
        const paths = extractEntityPaths(entity, {
            boundaryExtractor: candidate => candidate?.boundaries || candidate?.loops,
        });
        return paths.reduce((combined, path) => combineBounds(combined, clipboardEntityBounds(path, entityMap)), null);
    }
    return null;
}

function sampleEllipsePoints(entity) {
    const sweep = curveSweepValue(entity);
    const count = entity.fullEllipse ? 128 : Math.max(8, Math.ceil(Math.abs(sweep) / (Math.PI * 2) * 128));
    const start = entity.fullEllipse ? 0 : Number(entity.startAngle) || 0;
    return Array.from({ length: count + 1 }, (_, index) => ellipsePoint(entity, start + sweep * index / count));
}

function boundsFromSvgPoints(points) {
    const safe = (points || []).filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
    if (!safe.length) return null;
    return safe.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxX: Math.max(bounds.maxX, point.x),
        maxY: Math.max(bounds.maxY, point.y),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function collectPropertyValues(entities, property) {
    const values = new Set();
    const visit = entity => {
        if (entity?.[property]) values.add(entity[property]);
        if (entity?.type === 'polyline' && Array.isArray(entity.parts)) entity.parts.forEach(visit);
    };
    entities.forEach(visit);
    return values;
}

function requireObjectArray(value, name, maximum) {
    if (!Array.isArray(value)) throw clipboardError(`invalid-${name}`);
    if (value.length > maximum) throw clipboardError(`too-many-${name}`);
    if (value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) throw clipboardError(`invalid-${name}`);
    return value;
}

function assertUniqueStringIds(items, kind) {
    const ids = new Set();
    items.forEach(item => {
        if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw clipboardError(`invalid-${kind}-id`);
        ids.add(item.id);
    });
}

function assertBoundedJson(value, limits) {
    const visited = new WeakSet();
    const visit = (candidate, depth) => {
        if (depth > limits.depth) throw clipboardError('payload-too-deep');
        if (typeof candidate === 'number' && !Number.isFinite(candidate)) throw clipboardError('non-finite-number');
        if (typeof candidate === 'string' && byteLength(candidate) > limits.stringLength) throw clipboardError('string-too-large');
        if (['bigint', 'function', 'symbol', 'undefined'].includes(typeof candidate)) {
            throw clipboardError('invalid-json-value');
        }
        if (!candidate || typeof candidate !== 'object') return;
        if (visited.has(candidate)) throw clipboardError('cyclic-payload');
        visited.add(candidate);
        if (Array.isArray(candidate)) candidate.forEach(item => visit(item, depth + 1));
        else Object.entries(candidate).forEach(([key, item]) => {
            if (byteLength(key) > 1_024) throw clipboardError('key-too-large');
            visit(item, depth + 1);
        });
        visited.delete(candidate);
    };
    visit(value, 0);
}

function assertSerializedSize(value, maximum) {
    let serialized;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw clipboardError('invalid-payload');
    }
    assertByteLength(serialized, maximum);
}

function assertByteLength(value, maximum) {
    if (byteLength(value) > maximum) throw clipboardError('payload-too-large');
}

function byteLength(value) {
    return new TextEncoder().encode(String(value)).byteLength;
}

function extractEmbeddedClipboardJson(svg) {
    const match = /<metadata\b[^>]*\bid=["']lumcad-clipboard["'][^>]*>([\s\S]*?)<\/metadata>/i.exec(svg);
    return match ? unescapeXml(match[1]).trim() : null;
}

function parseSvgAttributes(tag) {
    return Object.fromEntries([...tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1].toLowerCase(), match[3]]));
}

function finiteAttribute(attributes, name, fallback = NaN) {
    const value = attributes[name];
    if (value === undefined) return fallback;
    const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:px)?\s*$/i.exec(String(value));
    const parsed = match ? Number(match[1]) : NaN;
    return Number.isFinite(parsed) ? parsed : NaN;
}

function parseSvgPoints(value) {
    const source = String(value || '').trim();
    if (!source) throw clipboardError('invalid-svg-geometry');
    const parts = source.split(/[\s,]+/);
    if (parts.length % 2 || parts.length > SVG_MAX_PATH_PARTS * 2
        || parts.some(part => !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(part))) {
        throw clipboardError('invalid-svg-geometry');
    }
    const numbers = parts.map(Number);
    assertSvgNumbers(numbers);
    const points = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
    return points;
}

function entityAppearance(entity, layer) {
    const transparency = Number(entity.transparency ?? layer?.transparency ?? 0);
    return {
        color: entity.color || layer?.color || '#172033',
        lineWeight: Number(entity.lineWeight || entity.lineWidth || layer?.lineWeight || 1),
        opacity: 1 - Math.max(0, Math.min(90, Number.isFinite(transparency) ? transparency : 0)) / 100,
    };
}

function assetFingerprint(asset) {
    return JSON.stringify([asset.mimeType, asset.width, asset.height, asset.link]);
}

function equivalentJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueId(preferred, usedIds) {
    if (!usedIds.has(preferred)) return preferred;
    let candidate = createDrawingId(preferred.replace(/[^a-zA-Z0-9_-]/g, '') || 'entity');
    while (usedIds.has(candidate)) candidate = createDrawingId('entity');
    return candidate;
}

function normalizePoint(point) {
    return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
        ? { x: Number(point.x), y: Number(point.y) }
        : null;
}

function normalizeBounds(bounds) {
    if (!bounds || !['minX', 'minY', 'maxX', 'maxY'].every(key => Number.isFinite(Number(bounds[key])))) return null;
    return {
        minX: Math.min(Number(bounds.minX), Number(bounds.maxX)),
        minY: Math.min(Number(bounds.minY), Number(bounds.maxY)),
        maxX: Math.max(Number(bounds.minX), Number(bounds.maxX)),
        maxY: Math.max(Number(bounds.minY), Number(bounds.maxY)),
    };
}

function combineBounds(left, right) {
    if (!left) return right ? { ...right } : null;
    if (!right) return left;
    return {
        minX: Math.min(left.minX, right.minX),
        minY: Math.min(left.minY, right.minY),
        maxX: Math.max(left.maxX, right.maxX),
        maxY: Math.max(left.maxY, right.maxY),
    };
}

function svgPoints(points) {
    return points.map(point => `${point.x},${point.y}`).join(' ');
}

function escapeXml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function unescapeXml(value) {
    return String(value).replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function clipboardError(code) {
    const error = new Error(`Drawing clipboard error: ${code}`);
    error.drawingClipboardCode = code;
    return error;
}
