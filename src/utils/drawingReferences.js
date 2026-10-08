import { drawingComparisonValue } from './drawingComparison.js';
import { createI18nError } from '../i18n/translator.js';
import { createDrawingId } from './drawingDocument.js';
import { normalizeLcadDocument } from './lcadDocument.js';
import { normalizeDrawingBasePoint } from './drawingBasePoint.js';
import { importDrawingBlockLibrary } from './drawingBlockLibrary.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, refreshDrawingBlockBounds } from './drawingBlocks.js';
import { normalizeDrawingReference, remapDrawingReferenceResources } from './drawingReferenceMetadata.js';
import { inverseArrayTransform } from './drawingArrayGeometry.js';
import { multiplyAffineMatrices, translationAffineMatrix } from './drawingAffine.js';

const RESOURCE_KEYS = ['blocks', 'layers', 'assets', 'textStyles', 'dimensionStyles'];

export function drawingReferenceEditContext(host, reference, source) {
    const inverse = inverseArrayTransform(reference.transform);
    if (!inverse) return null;
    const base = normalizeDrawingBasePoint(source.content.metadata?.basePoint);
    return { content: { ...host.content, entities: host.content.entities.filter(entity => entity.id !== reference.id) },
        assets: host.assets,
        transform: multiplyAffineMatrices(translationAffineMatrix(base.x, base.y), inverse),
    };
}

// References retain their own layers. Ordinary clipboard imports intentionally
// reuse destination layers; source reloads must not change host layer appearance.
function prepareReferenceSource(document) {
    const source = normalizeLcadDocument(document);
    const layerMap = new Map(source.content.layers.filter(layer => layer.id !== 'geometry')
        .map(layer => [layer.id, createDrawingId('reference-layer')]));
    const remap = entity => ({ ...entity, layerId: layerMap.get(entity.layerId) || entity.layerId,
        ...(entity.externalReference ? { externalReference: remapDrawingReferenceResources(entity.externalReference, { layers: layerMap }) } : {}),
        ...(Array.isArray(entity.parts) ? { parts: entity.parts.map(remap) } : {}),
    });
    const include = entity => entity.externalReference?.mode !== 'overlay';
    const prefix = createDrawingId('xref').slice(-12);
    const metadata = { ...source.content.metadata };
    delete metadata.blockLibrary;
    return { source: { ...source, content: { ...source.content, metadata,
        entities: source.content.entities.filter(include).map(remap),
        blocks: source.content.blocks.map(block => ({ ...block, entities: block.entities.filter(include).map(remap) })),
        layers: source.content.layers.map(layer => layerMap.has(layer.id)
            ? { ...layer, id: layerMap.get(layer.id), name: `${prefix}|${layer.name}`.slice(0, 128) } : layer),
    } }, layerMap };
}

function resources(document, key) {
    return key === 'assets' ? document.assets || [] : document.content[key] || [];
}

export function attachDrawingReference(target, document, {
    path = null, revision = null, mode = 'attach', insertionPoint = { x: 0, y: 0 }, layerId = null,
} = {}) {
    if (target.id === document?.id) throw createI18nError('reference.error.cycle');
    const { source, layerMap } = prepareReferenceSource(document);
    if (!source.content.entities.length) {
        const empty = createAnonymousDrawingBlock([], { name: '*REFERENCE' });
        source.content = { ...source.content, blocks: [...source.content.blocks, empty],
            metadata: { ...source.content.metadata, blockLibrary: { version: 1, entryBlockIds: [empty.id] } } };
    }
    if (source.content.entities.some(entity => entity.externalReference?.sourceDocumentId === target.id)
        || source.content.blocks.some(block => block.entities.some(entity => entity.externalReference?.sourceDocumentId === target.id))) {
        throw createI18nError('reference.error.cycle');
    }
    const imported = importDrawingBlockLibrary(target, source, { preserveBlockEntityIds: true });
    const definition = imported.content.blocks.find(block => block.id === imported.entryBlockIds[0]);
    const owned = Object.fromEntries(RESOURCE_KEYS.map(key => {
        const previous = new Set(resources(target, key).map(value => value.id));
        return [key, resources(imported, key).filter(value => !previous.has(value.id)).map(value => value.id)];
    }));
    const sourceMaps = { ...imported.sourceMaps, layers: Object.fromEntries(document.content.layers.map(layer => [
        layer.id, imported.sourceMaps.layers[layerMap.get(layer.id) || layer.id],
    ]).filter(([, value]) => value)) };
    const reference = { ...createAnonymousDrawingBlockReference(definition, {
        insertionPoint, layerId: layerId || target.content.activeLayerId || 'geometry',
    }), externalReference: normalizeDrawingReference({
        version: 1, path, revision, mode, loaded: true, name: source.name, sourceDocumentId: source.id,
        basePoint: normalizeDrawingBasePoint(document.content.metadata?.basePoint), sourceMaps, owned,
    }) };
    return { ...target, assets: imported.assets,
        content: refreshDrawingBlockBounds({ ...imported.content, entities: [...target.content.entities, reference] }),
        referenceId: reference.id,
    };
}

// Only resources owned by this insertion are candidates for deletion. Keep any
// definition reachable from another model/layout object or an unowned definition.
export function detachDrawingReference(document, referenceId) {
    const reference = document.content.entities.find(entity => entity.id === referenceId && entity.externalReference);
    if (!reference) throw createI18nError('reference.error.selection');
    const owned = reference.externalReference.owned;
    const entities = document.content.entities.filter(entity => entity.id !== referenceId);
    const blocks = document.content.blocks || [];
    const blockMap = new Map(blocks.map(block => [block.id, block]));
    const retained = new Set(blocks.filter(block => !owned.blocks.includes(block.id)).map(block => block.id));
    const used = Object.fromEntries(RESOURCE_KEYS.map(key => [key, new Set()]));
    const catalogReferences = new Set();
    const collectStrings = value => {
        if (typeof value === 'string') catalogReferences.add(value);
        else if (value && typeof value === 'object') Object.values(value).forEach(collectStrings);
    };
    const visit = entity => {
        if (!entity) return;
        collectStrings(entity);
        if (entity.layerId) used.layers.add(entity.layerId);
        if (entity.assetId) used.assets.add(entity.assetId);
        for (const key of ['pdfUnderlay', 'dwfUnderlay', 'dgnUnderlay']) {
            if (entity[key]?.assetId) used.assets.add(entity[key].assetId);
        }
        if (entity.textStyleId) used.textStyles.add(entity.textStyleId);
        if (entity.dimensionStyleId) used.dimensionStyles.add(entity.dimensionStyleId);
        for (const part of entity.parts || []) visit(part);
        if (entity.blockId && !used.blocks.has(entity.blockId)) {
            used.blocks.add(entity.blockId);
            retained.add(entity.blockId);
            for (const child of blockMap.get(entity.blockId)?.entities || []) visit(child);
        }
    };
    entities.forEach(visit);
    for (const layout of document.layouts || []) (layout.paperEntities || []).forEach(visit);
    for (const id of retained) (blockMap.get(id)?.entities || []).forEach(visit);
    for (const [key, value] of Object.entries(document.content)) {
        if (key !== 'entities' && !RESOURCE_KEYS.includes(key)) collectStrings(value);
    }
    collectStrings(document.layouts);
    collectStrings(document.pageSetups);
    for (const key of ['layers', 'textStyles', 'dimensionStyles']) {
        resources(document, key).filter(value => !owned[key].includes(value.id)).forEach(collectStrings);
    }
    // A layer/style can have state, viewport or preset assignments even when no
    // visible entity uses it. Keep those resources, reclaim only orphaned imports.
    const catalogs = Object.fromEntries(['layers', 'textStyles', 'dimensionStyles'].map(key => [key,
        resources(document, key).filter(value => !owned[key].includes(value.id) || used[key].has(value.id) || catalogReferences.has(value.id)),
    ]));
    const assets = resources(document, 'assets').filter(asset => !owned.assets.includes(asset.id) || used.assets.has(asset.id));
    return { ...document, assets, content: refreshDrawingBlockBounds({ ...document.content, ...catalogs, entities,
        blocks: blocks.filter(block => retained.has(block.id)),
    }) };
}

export function reloadDrawingReference(target, referenceId, document, options = {}) {
    const current = target.content.entities.find(entity => entity.id === referenceId && entity.externalReference);
    if (!current) throw createI18nError('reference.error.selection');
    const position = target.content.entities.indexOf(current);
    const detached = detachDrawingReference(target, referenceId);
    const attached = attachDrawingReference(detached, document, {
        path: current.externalReference.path, mode: current.externalReference.mode, ...options,
        layerId: current.layerId,
    });
    const next = attached.content.entities.find(entity => entity.id === attached.referenceId);
    const replacement = { ...current, blockId: next.blockId, definitionBounds: next.definitionBounds,
        externalReference: next.externalReference,
    };
    const entities = attached.content.entities.filter(entity => entity.id !== attached.referenceId);
    entities.splice(position, 0, replacement);
    return { ...attached, referenceId, content: refreshDrawingBlockBounds({ ...attached.content, entities }) };
}

export function bindDrawingReference(content, referenceId) {
    return { ...content, entities: content.entities.map(entity => {
        if (entity.id !== referenceId || !entity.externalReference) return entity;
        const { externalReference, ...bound } = entity;
        return bound;
    }) };
}

export function compareDrawingReference(host, referenceId, source) {
    const reference = host.content.entities.find(entity => entity.id === referenceId && entity.externalReference);
    if (!reference) throw createI18nError('reference.error.selection');
    const refreshed = reloadDrawingReference(host, referenceId, source);
    const next = refreshed.content.entities.find(entity => entity.id === referenceId);
    const snapshot = (document, insertion) => {
        const maps = insertion.externalReference.sourceMaps;
        const reverse = Object.fromEntries(RESOURCE_KEYS.map(key => [key, new Map(Object.entries(maps[key]).map(([from, to]) => [to, from]))]));
        const resourceForField = { layerId: 'layers', assetId: 'assets', blockId: 'blocks', textStyleId: 'textStyles', dimensionStyleId: 'dimensionStyles' };
        const canonical = value => drawingComparisonValue(value, { mapField: (key, fieldValue) => resourceForField[key]
            ? reverse[resourceForField[key]].get(fieldValue) || fieldValue : fieldValue });
        const root = document.content.blocks.find(block => block.id === insertion.blockId);
        const result = { entities: new Map((root?.entities || []).map(entity => [entity.id, JSON.stringify(canonical(entity))])) };
        for (const key of RESOURCE_KEYS) {
            result[key] = new Map(resources(document, key).filter(value => reverse[key].has(value.id) && value.id !== insertion.blockId)
                .map(value => [reverse[key].get(value.id), JSON.stringify(canonical({ ...value, id: reverse[key].get(value.id),
                    ...(key === 'layers' && value.id !== 'geometry' ? { name: value.name.replace(/^[^|]+\|/, '') } : {}),
                }))]));
        }
        return result;
    };
    const before = snapshot(host, reference); const after = snapshot(refreshed, next);
    const differences = Object.fromEntries(Object.keys(before).map(key => [key, {
        added: [...after[key].keys()].filter(id => !before[key].has(id)),
        removed: [...before[key].keys()].filter(id => !after[key].has(id)),
        changed: [...before[key].keys()].filter(id => after[key].has(id) && after[key].get(id) !== before[key].get(id)),
    }]));
    return { mode: 'referenceCompare', id: reference.id, name: reference.externalReference.name,
        sourceDocumentChanged: source.id !== reference.externalReference.sourceDocumentId,
        added: differences.entities.added.length, removed: differences.entities.removed.length, changed: differences.entities.changed.length,
        differences,
    };
}

export async function loadDrawingReferenceTree(loaded, read, { ancestorIds = [], maxFiles = 32, maxDepth = 8 } = {}) {
    const warnings = [];
    const budget = { files: 0, characters: 0 };
    const visit = async (current, ids, paths, depth) => {
        let document = current.envelope.document;
        if (ids.has(document.id) || current.path && paths.has(current.path)) throw createI18nError('reference.error.cycle');
        if (++budget.files > maxFiles || depth > maxDepth) throw createI18nError('reference.treeLimit');
        budget.characters += JSON.stringify(current.envelope).length;
        if (budget.characters > 300 * 1024 * 1024) throw createI18nError('reference.treeLimit');
        const nextIds = new Set(ids).add(document.id);
        const nextPaths = new Set(paths);
        if (current.path) nextPaths.add(current.path);
        for (const entity of document.content.entities) {
            const reference = entity.externalReference;
            if (!reference?.path || reference.mode === 'overlay' || !reference.loaded) continue;
            if (nextIds.has(reference.sourceDocumentId) || nextPaths.has(reference.path)) throw createI18nError('reference.error.cycle');
            if (budget.files >= maxFiles || depth >= maxDepth) throw createI18nError('reference.treeLimit');
            let nested;
            try { nested = await read(reference.path); }
            catch { budget.files++; warnings.push({ id: entity.id, path: reference.path }); continue; }
            const resolved = await visit(nested, nextIds, nextPaths, depth + 1);
            document = reloadDrawingReference(document, entity.id, resolved.envelope.document, { path: resolved.path, revision: resolved.revision });
        }
        return { ...current, envelope: { ...current.envelope, document } };
    };
    const result = await visit(loaded, new Set(ancestorIds), new Set(), 0);
    return { ...result, referenceWarnings: warnings };
}
