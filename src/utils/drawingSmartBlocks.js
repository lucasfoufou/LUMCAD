import { remapDrawingGeometricConstraints, transformDrawingGeometricConstraints, transformDrawingConstraintAxes } from './drawingConstraintDefinition.js';
import { collectDrawingDimensionalCatalog, mergeDrawingDimensionalCatalog, transformedDrawingDimensionalCatalog } from './drawingDimensionalTransfer.js';
import { matchDrawingDimensionalCatalogs } from './drawingDimensionalMatching.js';
import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { getEntityBounds } from './drawingGeometry.js';
import { getDrawingEntityDependencyIds } from './drawingDimensions.js';
import { drawingFieldDependencyIds } from './drawingFieldDefinition.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, transformDrawingEntityAffine, refreshDrawingBlockBounds } from './drawingBlocks.js';
import { translationAffineMatrix, multiplyAffineMatrices, IDENTITY_AFFINE_MATRIX } from './drawingAffine.js';
import { normalizeDrawingBlockName } from './drawingNamedBlocks.js';
import { drawingAttributeValues } from './drawingBlockAttributes.js';
import { normalizeDrawingDynamicBlock, evaluateDrawingDynamicBlock } from './drawingDynamicBlocks.js';
import { resolveDrawingBlockParameterValues } from './drawingBlockParameters.js';

const IGNORED_KEYS = new Set(['id', 'definitionBounds', 'bounds', 'previewMode']);
const dependencies = entity => [...getDrawingEntityDependencyIds(entity), ...drawingFieldDependencyIds(entity.field)];
const matchable = (content, entity) => canEditEntity(content, entity) && !dependencies(entity).length
    && !entity.externalReference && !entity.pdfUnderlay && !entity.dwfUnderlay && !entity.dgnUnderlay && !entity.attributeDefinition && !entity.annotation;

function sameNativeValue(first, second, tolerance, budget) {
    if (--budget.remaining < 0) throw new Error('limit');
    if (typeof first === 'number' && typeof second === 'number') return Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) <= tolerance;
    if (first === second) return true;
    if (!first || !second || typeof first !== 'object' || typeof second !== 'object' || Array.isArray(first) !== Array.isArray(second)) return false;
    if (first.type === 'line' && second.type === 'line') {
        const ordered = entity => entity.x1 > entity.x2 || entity.x1 === entity.x2 && entity.y1 > entity.y2
            ? { ...entity, x1: entity.x2, y1: entity.y2, x2: entity.x1, y2: entity.y1 } : entity;
        first = ordered(first); second = ordered(second);
    }
    if (Array.isArray(first)) return first.length === second.length && first.every((item, i) => sameNativeValue(item, second[i], tolerance, budget));
    const keys = object => Object.keys(object).filter(key => !IGNORED_KEYS.has(key) && object[key] !== undefined).sort();
    const a = keys(first); const b = keys(second);
    return a.length === b.length && a.every((key, i) => key === b[i] && sameNativeValue(first[key], second[key], tolerance, budget));
}

function motifFrame(entity, tolerance) {
    if (entity.type === 'line') return [{ x: entity.x1, y: entity.y1 }, { x: entity.x2, y: entity.y2 }];
    if (entity.type === 'circle' || entity.type === 'arc') {
        const angle = entity.type === 'arc' ? entity.startAngle : 0;
        return [{ x: entity.cx, y: entity.cy }, { x: entity.cx + entity.r * Math.cos(angle), y: entity.cy + entity.r * Math.sin(angle) }];
    }
    if (entity.type === 'polyline' && entity.points?.length > 1) {
        const first = entity.points[0];
        const second = entity.points.find(point => Math.hypot(point.x - first.x, point.y - first.y) > tolerance);
        if (second) return [first, second];
    }
    return null;
}

function candidateTransforms(source, target, tolerance) {
    if (source.type !== target.type) return [];
    const sourceFrame = motifFrame(source, tolerance); const targetFrame = motifFrame(target, tolerance);
    if (sourceFrame && targetFrame) {
        const [first, second] = sourceFrame;
        const sx = second.x - first.x; const sy = second.y - first.y; const lengthSquared = sx * sx + sy * sy;
        if (lengthSquared <= tolerance * tolerance) return [];
        const frames = source.type === 'line' ? [targetFrame, [...targetFrame].reverse()] : [targetFrame];
        return frames.map(([start, end]) => {
            const dx = end.x - start.x; const dy = end.y - start.y;
            const a = (dx * sx + dy * sy) / lengthSquared; const b = (dy * sx - dx * sy) / lengthSquared;
            return { a, b, c: -b, d: a, e: start.x - a * first.x + b * first.y, f: start.y - b * first.x - a * first.y };
        }).filter(matrix => Object.values(matrix).every(Number.isFinite)
            && Math.hypot(matrix.a, matrix.b) > 1e-9 && Math.hypot(matrix.a, matrix.b) <= 1e9);
    }
    const a = getEntityBounds(source); const b = getEntityBounds(target);
    return a && b ? [translationAffineMatrix(b.minX - a.minX, b.minY - a.minY)] : [];
}

/** Detect disjoint native motifs. Exact metadata/appearance comparison follows each geometric transform. */
export function detectDrawingSmartBlocks(content, selectedIds, { tolerance = 1e-7, maxChecks = 2000000 } = {}) {
    if (!Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 0.001 || !Number.isInteger(maxChecks) || maxChecks < 1) return { error: 'invalid' };
    const selected = new Set(selectedIds);
    const sources = content.entities.filter(entity => selected.has(entity.id));
    if (!sources.length || sources.length !== selected.size || sources.length > 128 || sources.some(entity => !matchable(content, entity))) return { error: 'selection' };
    if (content.entities.length > 10000) return { error: 'limit' };
    // Use the shared affine representation on both sides: rectangles/polygons
    // become native polylines even under the identity transform.
    const canonical = entity => transformDrawingEntityAffine(entity, IDENTITY_AFFINE_MATRIX, { textStyles: content.textStyles });
    const candidates = content.entities.filter(entity => matchable(content, entity)).map(canonical);
    const anchor = sources.find(entity => entity.type === 'line' && Math.hypot(entity.x2 - entity.x1, entity.y2 - entity.y1) > tolerance) || sources[0];
    const used = new Set(selected);
    const occurrences = [{ ids: sources.map(entity => entity.id), transform: { ...IDENTITY_AFFINE_MATRIX } }];
    const budget = { remaining: maxChecks };
    try {
        for (const candidate of candidates) {
            if (used.has(candidate.id)) continue;
            for (const transform of candidateTransforms(canonical(anchor), candidate, tolerance)) {
                if (--budget.remaining < 0) return { error: 'limit' };
                const expected = sources.map(entity => transformDrawingEntityAffine(entity, transform, { textStyles: content.textStyles }));
                const ids = []; const local = new Set(used);
                for (const source of expected) {
                    const target = candidates.find(entity => !local.has(entity.id) && sameNativeValue(source, entity, tolerance, budget));
                    if (!target) break;
                    ids.push(target.id); local.add(target.id);
                }
                if (ids.length !== sources.length) continue;
                ids.forEach(id => used.add(id)); occurrences.push({ ids, transform });
                break;
            }
        }
    } catch (error) {
        if (error.message === 'limit') return { error: 'limit' };
        throw error;
    }
    return { sources: sources.map(entity => entity.id), occurrences };
}

/** Recompute the detection at commit time, preserving objects outside accepted occurrences. */
export function replaceDrawingSmartBlocks(content, selectedIds, name, options) {
    const normalizedName = normalizeDrawingBlockName(name);
    if (!normalizedName || content.blocks.some(block => block.name.toLowerCase() === normalizedName.toLowerCase())) return { error: 'name' };
    const detection = detectDrawingSmartBlocks(content, selectedIds, options);
    if (detection.error) return detection;
    if (detection.occurrences.length < 2) return { error: 'noMatches' };
    const removed = new Set(detection.occurrences.flatMap(occurrence => occurrence.ids));
    const allEntities = [...content.entities, ...content.blocks.flatMap(block => block.entities)];
    if (allEntities.some(entity => dependencies(entity).some(id => removed.has(id)))) return { error: 'dependency' };
    // Keep painter order exact: a compound cannot straddle unrelated entities.
    const positions = new Map(content.entities.map((entity, index) => [entity.id, index]));
    if (detection.occurrences.some(({ ids }) => ids.some((id, index) => index && positions.get(id) !== positions.get(ids[index - 1]) + 1))) return { error: 'order' };
    if (content.groups.some(group => detection.occurrences.some(({ ids }) => {
        const count = ids.filter(id => group.entityIds.includes(id)).length;
        return count > 0 && count < ids.length;
    }))) return { error: 'group' };
    const sourceMap = new Map(content.entities.map(entity => [entity.id, entity]));
    const sources = detection.sources.map(id => sourceMap.get(id));
    const constraints = content.geometricConstraints || [];
    const sourceIds = new Set(detection.sources);
    const sourceConstraints = constraints.filter(item => item.refs.every(ref => sourceIds.has(ref.entityId)));
    const dimensional = collectDrawingDimensionalCatalog(content, sourceIds);
    if (dimensional.error) return { error: 'constraints' };
    // A shared definition must preserve every occurrence's relationships.
    for (const occurrence of detection.occurrences) {
        const ids = new Set(occurrence.ids);
        if ([...constraints, ...(content.dimensionalConstraints || [])].some(item => item.refs.some(ref => ids.has(ref.entityId))
            && item.refs.some(ref => !ids.has(ref.entityId)))) return { error: 'constraints' };
        const actual = constraints.filter(item => item.refs.every(ref => ids.has(ref.entityId)));
        const map = new Map(detection.sources.map((id, index) => [id, occurrence.ids[index]]));
        const occurrenceEntities = occurrence.ids.map(id => sourceMap.get(id));
        const dimensionalCopy = transformedDrawingDimensionalCatalog({ entities: [] }, { ...dimensional, entities: sources }, map, occurrenceEntities,
            entity => transformDrawingEntityAffine(entity, occurrence.transform, { preserveNativeTranslation: true }), () => createDrawingId('constraint'));
        const actualDimensions = collectDrawingDimensionalCatalog(content, ids);
        if (dimensionalCopy.error || actualDimensions.error) return { error: 'constraints' };
        const matched = matchDrawingDimensionalCatalogs({ ...dimensionalCopy, entities: occurrenceEntities }, { ...actualDimensions, entities: occurrenceEntities });
        if (matched.error || !matched.matches) return { error: matched.error === 'limit' ? 'limit' : 'constraints' };
        const transformed = transformDrawingGeometricConstraints(sourceConstraints, sources, map,
            entity => transformDrawingEntityAffine(entity, occurrence.transform, { preserveNativeTranslation: true }), id => id);
        if (transformed.error || actual.length !== transformed.constraints.length) return { error: 'constraints' };
        const unmatched = [...actual]; const budget = { remaining: 2000000 };
        try {
            const oriented = transformDrawingConstraintAxes(transformed.constraints, occurrence.transform);
            if (!oriented) return { error: 'constraints' };
            for (const expected of oriented) {
                const index = unmatched.findIndex(item => sameNativeValue(expected, item, 1e-7, budget));
                if (index < 0) return { error: 'constraints' };
                unmatched.splice(index, 1);
            }
        } catch (error) {
            if (error.message === 'limit') return { error: 'limit' };
            throw error;
        }
    }

    if (content.blocks.length >= 1024 || content.blocks.reduce((sum, block) => sum + block.entities.length, sources.length) > 100000) return { error: 'limit' };
    const bounds = sources.map(entity => getEntityBounds(entity));
    if (bounds.some(bounds => !bounds)) return { error: 'selection' };
    const origin = { x: Math.min(...bounds.map(bounds => bounds.minX)), y: Math.min(...bounds.map(bounds => bounds.minY)) };
    const localDimensions = mergeDrawingDimensionalCatalog({ entities: [] }, { ...dimensional, entities: sources },
        new Map(sources.map(entity => [entity.id, entity.id])), sources, () => createDrawingId('constraint'));
    if (localDimensions.error) return { error: localDimensions.error === 'limit' ? 'limit' : 'constraints' };
    const definition = createAnonymousDrawingBlock(sources, { id: createDrawingId('block'), name: normalizedName, basePoint: origin,
        ...(localDimensions.dimensionalConstraints.length ? { dimensionalConstraints: localDimensions.dimensionalConstraints, parameters: localDimensions.parameters } : {}),
        geometricConstraints: remapDrawingGeometricConstraints(sourceConstraints,
            new Map(sources.map(entity => [entity.id, entity.id])), () => createDrawingId('constraint')) });
    const replacements = new Map(); const idMap = new Map();
    for (const occurrence of detection.occurrences) {
        const firstId = [...occurrence.ids].sort((a, b) => positions.get(a) - positions.get(b))[0];
        const reference = createAnonymousDrawingBlockReference(definition, { id: firstId, layerId: sources[0].layerId });
        reference.transform = multiplyAffineMatrices(occurrence.transform, translationAffineMatrix(origin.x, origin.y));
        replacements.set(firstId, reference); occurrence.ids.forEach(id => idMap.set(id, firstId));
    }
    const entities = content.entities.flatMap(entity => replacements.has(entity.id) ? [replacements.get(entity.id)] : removed.has(entity.id) ? [] : [entity]);
    const groups = content.groups.map(group => ({ ...group, entityIds: [...new Set(group.entityIds.map(id => idMap.get(id) || id))] }));
    const retained = collectDrawingDimensionalCatalog(content, content.entities.filter(entity => !removed.has(entity.id)).map(entity => entity.id),
        { parameterNames: (content.parameters || []).map(item => item.name) });
    if (retained.error) return { error: 'constraints' };
    return { content: refreshDrawingBlockBounds({ ...content, entities, groups, blocks: [...content.blocks, definition],
        ...(content.dimensionalConstraints !== undefined ? retained : {}),
        ...(content.geometricConstraints !== undefined ? { geometricConstraints: constraints.filter(item => !item.refs.some(ref => removed.has(ref.entityId))) } : {}) }),
        selectedIds: [...replacements.keys()], count: replacements.size, definition };
}

export function replaceDrawingBlockInstances(content, selectedIds, name) {
    const definition = content.blocks.find(block => block.id === name || block.name.toLowerCase() === String(name).toLowerCase());
    if (!definition) return { error: 'name' };
    const ids = new Set(selectedIds);
    const sources = content.entities.filter(entity => ids.has(entity.id));
    if (!sources.length || sources.length !== ids.size || sources.some(entity => entity.type !== 'blockReference' || !canEditEntity(content, entity)
        || entity.externalReference || entity.pdfUnderlay || entity.dwfUnderlay || entity.dgnUnderlay || entity.leader || entity.spaceTransfer)) return { error: 'selection' };
    const replacements = new Map();
    for (const source of sources) {
        const { dynamicValues, attributeValues, ...rest } = source;
        const replacement = { ...rest, blockId: definition.id, attributeValues: drawingAttributeValues(definition, source) };
        if (definition.dynamic) {
            const dynamic = normalizeDrawingDynamicBlock(definition.dynamic, definition.entities);
            if (!dynamic) return { error: 'invalid' };
            const values = resolveDrawingBlockParameterValues(dynamic.parameters, dynamicValues || {}, { recover: true });
            const evaluated = evaluateDrawingDynamicBlock(definition, values || {});
            if (evaluated.error) return { error: 'invalid' };
            replacement.dynamicValues = evaluated.values;
        }
        replacements.set(source.id, replacement);
    }
    return { content: refreshDrawingBlockBounds({ ...content, entities: content.entities.map(entity => replacements.get(entity.id) || entity) }),
        selectedIds: [...ids], count: sources.length };
}
