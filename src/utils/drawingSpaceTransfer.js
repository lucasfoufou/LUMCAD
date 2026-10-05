import { viewportModelPointToPaperPoint, paperPointToViewportModelPoint, getDrawingViewportScale } from './drawingLayouts.js';
import { canEditEntity, createDrawingId } from './drawingDocument.js';
import { defineNamedDrawingBlock } from './drawingNamedBlocks.js';
import { ANNOTATION_HIDDEN, resolveDrawingAnnotationContent } from './drawingAnnotations.js';
import {
    collectDrawingBlockDependencies, materializeDrawingBlockReference, remapDrawingBlockEntity,
    transformDrawingEntityAffine, refreshDrawingBlockBounds,
} from './drawingBlocks.js';

const validPoint = point => [point?.x, point?.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9);

// Paper geometry uses a native block container so curves, associations, nested
// insertions and entities outside the sheet are not flattened or clamped.
export function transferDrawingSpace(document, layoutId, viewportId, ids, toPaper = true) {
    const layout = document.layouts.find(item => item.id === layoutId);
    const viewport = layout?.viewports.find(item => item.id === viewportId);
    const matrix = viewport && drawingViewportSpaceMatrix(viewport, toPaper);
    if (!matrix) return { error: 'viewport' };
    const requested = new Set(ids);
    if (!requested.size) return { error: 'selection' };
    const content = document.content;
    let nextContent; let paperEntities; let selectedIds; let paperSelectionId = null;
    if (toPaper) {
        const grouped = defineNamedDrawingBlock(content, [...requested], {
            name: createDrawingId('paper-transfer'), basePoint: { x: 0, y: 0 },
        });
        if (grouped.error) return grouped;
        const movedIds = new Set(grouped.definition.entities.map(entity => entity.id));
        const display = resolveDrawingAnnotationContent(content, getDrawingViewportScale(viewport), { showAll: true });
        const moved = display.entities.filter(entity => movedIds.has(entity.id));
        if (moved.some(entity => entity[ANNOTATION_HIDDEN])) return { error: 'limit' };
        const reachable = collectDrawingBlockDependencies(display.blocks, moved.filter(entity => entity.type === 'blockReference').map(entity => entity.blockId));
        if (reachable.some(block => block.entities.some(entity => entity[ANNOTATION_HIDDEN]))) return { error: 'limit' };
        const dependencies = reachable.some(block => block.entities.some(entity => entity.annotation))
            || reachable.some(block => !content.blocks.some(original => original.id === block.id)) ? reachable : [];
        if (content.blocks.length + dependencies.length + 1 > 1024
            || [...content.blocks, ...dependencies].reduce((sum, block) => sum + block.entities.length, moved.length) > 100000) return { error: 'limit' };
        const blockIdMap = new Map(dependencies.map(block => [block.id, createDrawingId('block')]));
        const snapshot = entity => {
            const next = remapDrawingBlockEntity(entity, { blockIdMap });
            delete next.annotation;
            return next;
        };
        const definition = { ...grouped.definition, entities: moved.map(snapshot) };
        const blocks = [...content.blocks, ...dependencies.map(block => ({ ...block, id: blockIdMap.get(block.id), entities: block.entities.map(snapshot) })), definition];
        // Insertion on layer 0 preserves every child's original explicit layer.
        const layerId = moved.some(entity => entity.layerId === 'geometry') ? 'geometry' : grouped.reference.layerId;
        if (!canEditEntity(content, { layerId })) return { error: 'layer' };
        const reference = { ...grouped.reference, layerId, transform: matrix, spaceTransfer: true };
        nextContent = refreshDrawingBlockBounds({ ...content, blocks, entities: content.entities.filter(entity => !movedIds.has(entity.id)) });
        const refreshed = refreshDrawingBlockBounds({ ...nextContent, entities: [reference] }).entities[0];
        paperEntities = [...(layout.paperEntities || []), refreshed];
        paperSelectionId = refreshed.id;
        selectedIds = [];
    } else {
        const selected = (layout.paperEntities || []).filter(entity => requested.has(entity.id));
        if (selected.length !== requested.size || selected.some(entity => !canEditEntity(content, entity))) return { error: 'selection' };
        const used = new Set(content.entities.map(entity => entity.id));
        const moved = [];
        for (const entity of selected) {
            const transformed = transformDrawingEntityAffine(entity, matrix, { textStyles: content.textStyles });
            const batch = entity.type === 'blockReference' && entity.spaceTransfer === true && !entity.blockClip?.enabled && !entity.externalReference
                ? materializeDrawingBlockReference(transformed, content.blocks, { textStyles: content.textStyles })
                : [transformed];
            if (!batch.length) return { error: 'selection' };
            const entityIdMap = new Map();
            for (const child of batch) {
                if (used.has(child.id)) entityIdMap.set(child.id, createDrawingId(child.type));
                used.add(entityIdMap.get(child.id) || child.id);
            }
            moved.push(...batch.map(child => remapDrawingBlockEntity(child, { entityIdMap })));
        }
        nextContent = refreshDrawingBlockBounds({ ...content, entities: [...content.entities, ...moved] });
        selectedIds = moved.map(entity => entity.id);
        paperEntities = layout.paperEntities.filter(entity => !requested.has(entity.id));
        const candidates = new Set(selected.filter(entity => entity.spaceTransfer === true).map(entity => entity.blockId));
        const roots = [...nextContent.entities, ...document.layouts.flatMap(item => item.id === layout.id ? paperEntities : item.paperEntities || []),
            ...content.blocks.filter(block => !candidates.has(block.id)).flatMap(block => block.entities)];
        const retained = new Set(collectDrawingBlockDependencies(content.blocks, roots.filter(entity => entity.type === 'blockReference').map(entity => entity.blockId)).map(block => block.id));
        nextContent = { ...nextContent, blocks: nextContent.blocks.filter(block => !candidates.has(block.id) || retained.has(block.id)) };
    }
    return { content: nextContent, layouts: document.layouts.map(item => item.id === layout.id ? { ...item, paperEntities } : item), selectedIds, paperSelectionId };
}

export function drawingViewportSpaceMatrix(viewport, toPaper = true) {
    const convert = toPaper ? viewportModelPointToPaperPoint : paperPointToViewportModelPoint;
    const origin = convert(viewport, { x: 0, y: 0 });
    const x = convert(viewport, { x: 1, y: 0 });
    const y = convert(viewport, { x: 0, y: 1 });
    if (![origin, x, y].every(validPoint)) return null;
    return { a: x.x - origin.x, b: x.y - origin.y, c: y.x - origin.x, d: y.y - origin.y, e: origin.x, f: origin.y };
}

export function alignDrawingViewportPoints(viewport, modelPoints, paperPoints) {
    if (!viewport || viewport.locked || modelPoints?.length !== 2 || paperPoints?.length !== 2
        || ![...modelPoints, ...paperPoints].every(validPoint)) return null;
    const [first, second] = modelPoints; const [target, end] = paperPoints;
    const modelLength = Math.hypot(second.x - first.x, second.y - first.y);
    const paperLength = Math.hypot(end.x - target.x, end.y - target.y);
    if (modelLength < 1e-9 || paperLength < 1e-6) return null;
    const scale = paperLength / modelLength;
    if (scale < 1e-6 || scale > 1e9) return null;
    const angle = Math.atan2(end.y - target.y, end.x - target.x) - Math.atan2(second.y - first.y, second.x - first.x);
    const dx = (target.x - viewport.x - viewport.width / 2) / scale;
    const dy = (target.y - viewport.y - viewport.height / 2) / scale;
    const center = { x: first.x - Math.cos(angle) * dx - Math.sin(angle) * dy,
        y: first.y + Math.sin(angle) * dx - Math.cos(angle) * dy };
    const width = viewport.width / scale; const height = viewport.height / scale;
    const modelViewBox = { x: center.x - width / 2, y: center.y - height / 2, width, height };
    if (!Object.values(modelViewBox).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) return null;
    return { ...viewport, viewRotation: ((angle * 180 / Math.PI) % 360 + 360) % 360, modelViewBox };
}
