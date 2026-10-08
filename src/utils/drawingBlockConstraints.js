import { createDrawingId } from './drawingDocument.js';
import { getDrawingBlockDefinition, resolveDrawingBlockChild, transformDrawingEntityAffine } from './drawingBlocks.js';
import { drawingBlockClipShape } from './drawingBlockClip.js';
import { drawingBlockInstanceEvaluation } from './drawingDynamicBlocks.js';
import { remapDrawingEntityDependencies } from './drawingDimensions.js';
import { normalizeDrawingGeometricConstraints, transformDrawingGeometricConstraints, transformDrawingConstraintAxes } from './drawingConstraintDefinition.js';
import { drawingGeometricConstraintResiduals } from './drawingGeometricConstraints.js';
import { mergeDrawingDimensionalCatalog, transformedDrawingDimensionalCatalog } from './drawingDimensionalTransfer.js';

/** Materialize independent instance IDs and their local catalogs, including nested instances. */
export function materializeConstrainedDrawingBlock(reference, blocks, {
    recursive = false, maxDepth = 16, textStyles = [],
} = {}) {
    const definition = getDrawingBlockDefinition(blocks, reference.blockId);
    if (!definition || drawingBlockClipShape(reference) || reference.externalReference || reference.pdfUnderlay || reference.dwfUnderlay || reference.dgnUnderlay) {
        return { entities: [], constraints: [] };
    }
    const evaluated = drawingBlockInstanceEvaluation(definition, reference);
    const ids = new Map(evaluated.entities.map(entity => [entity.id, createDrawingId(entity.type)]));
    const transform = entity => transformDrawingEntityAffine(entity, reference.transform, { textStyles, preserveNativeTranslation: true });
    const transferred = transformDrawingGeometricConstraints(evaluated.geometricConstraints || [], evaluated.entities,
        ids, transform, () => createDrawingId('constraint'));
    if (transferred.error) return transferred;
    let constraints = transformDrawingConstraintAxes(transferred.constraints, reference.transform);
    if (!constraints) return { error: 'topology' };
    const entities = [];
    const nestedCatalogs = [];
    for (const entity of evaluated.entities) {
        const child = transform(resolveDrawingBlockChild(entity, reference, 'all'));
        const remapped = { ...remapDrawingEntityDependencies(child, ids, { preserveAppearance: true }), id: ids.get(entity.id) };
        if (recursive && child.type === 'blockReference' && maxDepth > 0) {
            const nested = materializeConstrainedDrawingBlock(remapped, blocks, { recursive, maxDepth: maxDepth - 1, textStyles });
            if (nested.error) return nested;
            entities.push(...nested.entities); constraints.push(...nested.constraints);
            nestedCatalogs.push(nested);
        } else entities.push(remapped);
    }
    if (constraints.length > 256) return { error: 'limit' };
    if (!normalizeDrawingGeometricConstraints(constraints, entities)) return { error: 'topology' };
    const map = new Map(entities.map(entity => [entity.id, entity]));
    if (constraints.some(item => drawingGeometricConstraintResiduals(item, map).some(value => Math.abs(value) > 1e-7))) {
        return { error: 'conflict' };
    }
    let dimensional = transformedDrawingDimensionalCatalog({ entities: [], geometricConstraints: constraints }, evaluated, ids,
        entities, transform, () => createDrawingId('constraint'));
    if (dimensional.error) return dimensional;
    for (const nested of nestedCatalogs) {
        dimensional = mergeDrawingDimensionalCatalog({ entities, geometricConstraints: constraints, ...dimensional }, nested,
            new Map(nested.entities.map(entity => [entity.id, entity.id])), entities, () => createDrawingId('constraint'));
        if (dimensional.error) return dimensional;
    }
    return { entities, constraints, dimensionalConstraints: dimensional.dimensionalConstraints, parameters: dimensional.parameters };
}
