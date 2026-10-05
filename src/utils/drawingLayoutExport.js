import { createI18nError } from '../i18n/translator.js';
import { createDrawingId } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive } from './lcadArchive.js';
import { importDrawingBlockLibrary } from './drawingBlockLibrary.js';
import { createAnonymousDrawingBlockReference, refreshDrawingBlockBounds } from './drawingBlocks.js';
import { ANNOTATION_HIDDEN } from './drawingAnnotations.js';
import { normalizeDrawingBlockClip } from './drawingBlockClip.js';
import { applyDrawingViewportDisplaySettings, getDrawingViewportClipPoints, paperPointToViewportModelPoint } from './drawingLayouts.js';
import { drawingViewportSpaceMatrix } from './drawingSpaceTransfer.js';
import { multiplyAffineMatrices, scaleAffineMatrix } from './drawingAffine.js';
import { applyDrawingPlotStyle } from './drawingPlot.js';

// Keep the same block/entity representation as the editor. Each viewport is a
// clipped native insertion with its own layer snapshot, expressed in paper metres.
export function exportDrawingLayout(document, layout) {
    if (!layout) throw createI18nError('layoutExport.selection');
    let result = createLcadDocument({ name: `${document.name} — ${layout.name}` });
    const append = (content, name, matrix, clip = null) => {
        if (!content.entities.length) return;
        const source = { ...document, name, content: snapshotLayers(content, name) };
        const imported = importDrawingBlockLibrary(result, source);
        const block = imported.content.blocks.find(item => item.id === imported.entryBlockIds[0]);
        const reference = { ...createAnonymousDrawingBlockReference(block), transform: matrix,
            ...(clip ? { blockClip: clip } : {}),
        };
        result = { ...result, assets: imported.assets,
            content: { ...imported.content, entities: [...result.content.entities, reference] } };
    };
    for (const viewport of layout.viewports) {
        const displayed = applyDrawingViewportDisplaySettings(document.content, viewport);
        const displayedById = new Map(displayed.entities.map(entity => [entity.id, entity]));
        const visibleIds = new Set(displayed.entities.filter(entity => !entity[ANNOTATION_HIDDEN]
            && entity.externalReference?.loaded !== false && (entity.type !== 'image' || entity.includeInPdf)).map(entity => entity.id));
        const hiddenLayers = new Set(viewport.hiddenLayerIds);
        const hiddenId = createDrawingId('layout-hidden');
        const markHidden = entity => !visibleIds.has(entity.id) ? { ...entity, layerId: hiddenId } : entity;
        const content = { ...displayed,
            settings: { ...displayed.settings, plotStyleMode: 'off' },
            entities: document.content.entities.map(entity => markHidden(displayedById.get(entity.id) || entity)),
            layers: [...displayed.layers.map(layer => hiddenLayers.has(layer.id) ? { ...layer, visible: false } : layer),
                { id: hiddenId, name: hiddenId, visible: false, color: '#000000', lineWeight: 1, lineType: 'continuous' }],
            blocks: displayed.blocks.map(block => ({ ...block, entities: block.entities.map(entity => entity[ANNOTATION_HIDDEN] || entity.externalReference?.loaded === false ? { ...entity, layerId: hiddenId } : entity) })),
        };
        const clip = normalizeDrawingBlockClip({ enabled: true,
            points: getDrawingViewportClipPoints(viewport).map(point => paperPointToViewportModelPoint(viewport, point)),
        });
        if (!clip) throw createI18nError('layoutExport.invalidClip');
        const style = viewport.visualSettings || {};
        const styled = applyDrawingPlotStyle(content, {
            colorMode: style.style === 'grayscale' ? 'grayscale' : style.style === 'monochrome' ? 'monochrome' : 'asDisplayed',
            plotLineweights: style.showLineweights !== false,
        });
        append(styled, viewport.name || layout.name,
            multiplyAffineMatrices(scaleAffineMatrix(0.001), drawingViewportSpaceMatrix(viewport)), clip);
    }
    append({ ...document.content, entities: layout.paperEntities || [] }, `${layout.name} — Paper`, scaleAffineMatrix(0.001));
    result.content = refreshDrawingBlockBounds(result.content);
    // Validate total manifest and resources before opening a save dialog.
    createLcadArchive(createLcadEnvelope(result));
    return result;
}

function snapshotLayers(content, name) {
    const ids = new Map(content.layers.map(layer => [layer.id, createDrawingId('layout-layer')]));
    const prefix = createDrawingId('layout').slice(-12);
    const snapshot = (entity, root = false) => {
        const next = JSON.parse(JSON.stringify(entity));
        delete next.annotation;
        delete next.externalReference;
        if (root || next.layerId !== 'geometry') next.layerId = ids.get(next.layerId) || next.layerId;
        if (Array.isArray(next.parts)) next.parts = next.parts.map(part => snapshot(part, root));
        return next;
    };
    const metadata = { ...content.metadata, basePoint: { x: 0, y: 0 } };
    delete metadata.blockLibrary;
    return JSON.parse(JSON.stringify({ ...content, metadata,
        layers: content.layers.map(layer => ({ ...layer, id: ids.get(layer.id), name: `${prefix}|${name}|${layer.name}`.slice(0, 128) })),
        entities: content.entities.map(entity => snapshot(entity, true)),
        blocks: content.blocks.map(block => ({ ...block, entities: block.entities.map(entity => snapshot(entity)) })),
    }));
}
