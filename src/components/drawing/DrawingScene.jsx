import { drawingCurvePathToSvgData } from '~utils/drawingCurveSvg';
import { drawingGripLabel as gripName } from '~utils/drawingGripLabels';
import { drawingPointPath, drawingPointSvgTransform, normalizeDrawingPointStyle } from '~utils/drawingPoints';
import { drawingBlockInstanceEntities } from '~utils/drawingDynamicBlocks';
import { drawingBlockClipShape } from '~utils/drawingBlockClip';
import { ANNOTATION_HIDDEN } from '~utils/drawingAnnotations';
import { DRAWING_PLOT_PRESENTATION, resolveDrawingPlotEntityDetails } from '~utils/drawingPlotStyles';
import { isDrawingLayerVisible } from '~utils/drawingLayers';
import { isDrawingObjectHidden } from '~utils/drawingObjectVisibility';
import { createDimensionSourceMap, getDrawingDimensionSourceMap } from '~utils/drawingDimensionSources';
import { applyCurrentStyleToNewDimensions } from '~utils/drawingDimensionStyles';
import { presentDrawingDimension } from '~utils/drawingDimensionPresentation';
import { drawingRectTransform } from '~utils/drawingAffineFrame';
import { hasImageAdjustments, imageAdjustmentTransfer, imageTransparencyKey } from '~utils/drawingImageAdjustments';
import { getImageClipPoints } from '~utils/drawingImageClip';
import { isDrawingWipeout } from '~utils/drawingWipeout';
import { isConstructionLine, constructionLineViewportSegment } from '~utils/drawingConstructionLines';
import React, { useId, useMemo } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import {
    getArcPath,
    getCircleViewportGeometry,
    getDimensionGeometry,
    getRectangleOutlinePath,
    getRegularPolygonVertices,
    formatDrawingDimensionLabel,
    isDrawingDimensionEntity,
} from '~utils/drawingGeometry';
import { DRAWING_GRIP_OBJECT_LIMIT, getEntityGrips } from '~utils/drawingSelection';
import { canEditEntity, getEntityAppearance } from '~utils/drawingDocument';
import { DRAWING_QDIM_GRIP_IDS, drawingEntitySourcesChanged, drawingEntityUsesSources } from '~utils/drawingDimensions';
import { getDrawingTextLayout } from '~utils/drawingText';
import { affineMatrixToSvg, getDrawingBlockReferenceBounds, inverseAffineViewBox, resolveDrawingBlockChild } from '~utils/drawingBlocks';
import { drawingLineworkBlockChildren, drawingLineworkDependsOnViewport, drawingLineworkPath } from '~utils/drawingLineworkBatch';
import { getDrawingEntityRenderMode } from '~utils/drawingInteraction';
import { drawingEntityRenderBounds, drawingEntityViewportChanged, drawingEntityUsesDefaultDimensionSize } from '~utils/drawingViewportDependence';
import { createDrawingIndexCache, createDrawingSpatialIndex } from '~utils/drawingSpatialIndex';
import { chunkDrawingEntities } from '~utils/drawingSceneChunks';
import { createDrawingBlockSymbols } from '~utils/drawingBlockSymbols';
import useStableArray from '~hooks/useStableArray';

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_SET = new Set();

function DrawingScene({
    content,
    assets = EMPTY_ARRAY,
    selectedIds = EMPTY_ARRAY,
    previewSelectedIds = null,
    highlightedIds = EMPTY_ARRAY,
    interactive = false,
    // Interactive scenes render 12 px transparent hit shapes for DOM picking.
    // The model canvas disables them and picks through pickDrawingEntity; its
    // plain entities then also drop their wrapper group, halving the DOM.
    hitShapes = true,
    dimensionTextSize = 0.35,
    showGrips = false,
    gripSize = 0.2,
    hiddenIds = EMPTY_ARRAY,
    hitOnlyIds = EMPTY_ARRAY,
    hiddenLayerIds = EMPTY_ARRAY,
    viewBox = null,
    cullArea = null,
    // World units per screen pixel of the model canvas. Entities smaller than a
    // pixel are then drawn as dots grouped by appearance (level of detail).
    pixelSize = null,
}) {
    const { locale, t } = useI18n();
    const layerMap = useMemo(() => new Map(content.layers.map(layer => [layer.id, layer])), [content.layers]);
    const entityMap = useMemo(() => getDrawingDimensionSourceMap(content), [content.entities, content.blocks, content.layers, content.textStyles]);
    const blockMap = useMemo(() => new Map((content.blocks || []).map(block => [block.id, block])), [content.blocks]);
    const symbolPrefix = `block-symbol-${useId().replace(/:/g, '')}`;
    const symbols = useMemo(() => interactive
        ? createDrawingBlockSymbols(content.entities, blockMap, symbolPrefix)
        : { definitions: [], references: new Map() }, [interactive, content.entities, blockMap, symbolPrefix]);
    const assetMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const gripsEnabled = showGrips && selected.size <= DRAWING_GRIP_OBJECT_LIMIT;
    const selectedQdimGripSeries = useMemo(() => {
        if (!gripsEnabled) return new Set();
        const series = new Map();
        for (const entity of content.entities) {
            if (entity.type !== 'linearDimension' || !entity.seriesId) continue;
            const entry = series.get(entity.seriesId) || { selected: false, editable: true, count: 0 };
            entry.selected ||= selected.has(entity.id);
            entry.editable &&= canEditEntity(content, entity);
            entry.count += 1;
            series.set(entity.seriesId, entry);
        }
        return new Set([...series].filter(([, entry]) => entry.selected && entry.editable
            && entry.count <= DRAWING_GRIP_OBJECT_LIMIT).map(([id]) => id));
    }, [content, selected, gripsEnabled]);
    const previewSelected = useMemo(() => previewSelectedIds ? new Set(previewSelectedIds) : null, [previewSelectedIds]);
    const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const hitOnly = useMemo(() => new Set(hitOnlyIds), [hitOnlyIds]);
    const hiddenLayers = useMemo(() => new Set(hiddenLayerIds), [hiddenLayerIds]);
    const lineworkViewportCache = useMemo(() => new WeakMap(), [viewBox?.x, viewBox?.y, viewBox?.width, viewBox?.height]);
    const circleGeometryCache = useMemo(() => new WeakMap(), [
        content.entities,
        viewBox?.x,
        viewBox?.y,
        viewBox?.width,
        viewBox?.height,
    ]);

    const visiblePositions = useMemo(() => {
        if (!cullArea) return null;
        const index = cullIndexCache([content.entities], previous => createDrawingSpatialIndex(content.entities, drawingEntityRenderBounds, { previous }));
        const marginX = cullArea.width * CULL_MARGIN_RATIO;
        const marginY = cullArea.height * CULL_MARGIN_RATIO;
        const area = { minX: cullArea.x - marginX, minY: cullArea.y - marginY, maxX: cullArea.x + cullArea.width + marginX, maxY: cullArea.y + cullArea.height + marginY };
        // An overview shows everything: skip building a set of every position.
        if (index.covers(area)) return null;
        return new Set(index.query(area));
    }, [cullArea, content.entities]);

    // Model canvas: shapes never change with selection; outlines and grips live
    // in a decoration layer drawn above the scene (see EntityDecoration).
    const bare = interactive && !hitShapes;
    const isSelected = id => (previewSelected ? previewSelected.has(id) : selected.has(id));
    const gripsFor = entity => gripsEnabled && (selected.has(entity.id) || selectedQdimGripSeries.has(entity.seriesId));
    const chunks = useMemo(() => chunkDrawingEntities(content.entities), [content.entities]);
    const selection = useMemo(() => (bare ? null : { selected, previewSelected, highlighted, gripsEnabled, selectedQdimGripSeries }),
        [bare, selected, previewSelected, highlighted, gripsEnabled, selectedQdimGripSeries]);
    const decorated = [];
    let renderedEntities = 0;
    const visibleChunks = [];
    const dotLimit = pixelSize > 0 ? pixelSize * LOD_DOT_PIXELS : 0;
    for (const chunk of chunks) {
        const entities = [];
        const dots = [];
        for (const position of chunk.positions) {
            if (visiblePositions && !visiblePositions.has(position)) continue;
            const entity = content.entities[position];
            const renderMode = getDrawingEntityRenderMode(entity.id, hidden, hitOnly);
            if (renderMode === 'hidden' || isDrawingObjectHidden(content, entity.id)) continue;
            const layer = layerMap.get(entity.layerId);
            if (!isDrawingLayerVisible(layer) || hiddenLayers.has(entity.layerId)) continue;
            if (dotLimit && renderMode !== 'hit-only' && drawingEntityBelowSize(entity, dotLimit)) dots.push(entity);
            else entities.push(entity);
            if (bare && renderMode !== 'hit-only' && (isSelected(entity.id) || highlighted.has(entity.id) || gripsFor(entity))) {
                const editable = canEditEntity(content, entity);
                if (isSelected(entity.id) || highlighted.has(entity.id) || editable) decorated.push({ entity, editable });
            }
        }
        renderedEntities += entities.length + dots.length;
        if (entities.length || dots.length) visibleChunks.push({ key: chunk.key, entities, dots });
    }
    // Everything a chunk draws with besides its entities. Chunks compare it field
    // by field (sameSceneChunkProps), so an edit re-renders only the chunks it touches.
    const scene = {
        content, sources: entityMap, assetMap, blockMap, layerMap, hiddenLayers, hitOnly, symbolReferences: symbols.references,
        interactive, hitShapes, bare, dimensionTextSize, gripSize, locale, t, viewBox, circleGeometryCache, pixelSize, lineworkViewportCache,
        selection,
    };

    return (
        <>
        {symbols.definitions.length > 0 && <defs>{symbols.definitions.map(({ id, reference, block }) => (
            <g id={id} key={id}><BlockReferenceGeometry reference={reference} block={block} blockMap={blockMap}
                assetMap={assetMap} layerMap={layerMap} hiddenLayers={hiddenLayers} dimensionTextSize={dimensionTextSize}
                locale={locale} t={t} viewBox={null} visitedBlockIds={new Set()} textStyles={content.textStyles}
                attributeDisplay={content.settings?.attributeDisplay} /></g>
        ))}</defs>}
        <g className="drawing-scene" data-rendered-entities={renderedEntities}>
            {visibleChunks.map(chunk => <SceneChunk key={chunk.key} entities={chunk.entities} dots={chunk.dots} scene={scene} />)}
        </g>
        {decorated.length > 0 && (
            <g className="drawing-scene-decorations">
                {decorated.map(({ entity, editable }) => (
                    <EntityDecoration
                        key={entity.id}
                        entity={entity}
                        sources={entityMap}
                        selected={isSelected(entity.id)}
                        highlighted={highlighted.has(entity.id)}
                        grips={editable && gripsFor(entity)}
                        gripSize={gripSize}
                        t={t}
                        viewBox={viewBox}
                        blockMap={blockMap}
                        circleGeometryCache={circleGeometryCache}
                    />
                ))}
            </g>
        )}
        </>
    );
}

function DrawingEntity({
    entity,
    sources = EMPTY_ARRAY,
    asset = null,
    appearance,
    selected = false,
    highlighted = false,
    editable = false,
    interactive,
    hitShape = false,
    bare = false,
    symbolId,
    draft = false,
    dimensionTextSize,
    showGrips = false,
    gripSize,
    locale,
    t,
    viewBox,
    circleGeometryCache,
    block = null,
    blockMap = new Map(),
    assetMap = new Map(),
    layerMap = new Map(),
    hiddenLayers = new Set(),
    nested = false,
    visitedBlockIds = new Set(),
    visualHidden = false,
    textStyles = EMPTY_ARRAY,
    attributeDisplay = 'normal',
}) {
    if (entity[ANNOTATION_HIDDEN]) return null;
    const isTrimPreview = draft && entity.previewMode === 'trim';
    entity = resolveDrawingPlotEntityDetails(entity, layerMap.get(entity.layerId));
    const appearanceOpacity = draft ? 1 : transparencyToOpacity(appearance.transparency);
    const strokeWidth = isTrimPreview ? 4 : draft ? 1.5 : appearance.lineWeight;
    const lineTypeProps = draft && !isTrimPreview
        ? { strokeDasharray: '6 4' }
        : lineTypeStrokeProps(appearance.lineType, strokeWidth);
    const shapeProps = {
        stroke: draft ? '#f7941d' : appearance.color,
        strokeWidth,
        vectorEffect: 'non-scaling-stroke',
        fill: 'none',
        ...lineTypeProps,
        opacity: isTrimPreview ? 0.92 : appearanceOpacity,
    };
    const groupProps = {
        'data-entity-id': draft || nested ? undefined : entity.id,
        className: ['drawing-entity', entity.locked && 'is-locked', editable && 'is-editable', selected && 'is-selected', highlighted && 'is-highlighted', draft && 'is-draft'].filter(Boolean).join(' '),
    };

    let shape = null;
    if (entity.type === 'point') {
        shape = <path d={drawingPointPath(entity)} transform={drawingPointSvgTransform(entity)} {...shapeProps} fill={normalizeDrawingPointStyle(entity.pointStyle).symbol === 'dot' ? shapeProps.stroke : 'none'} />;
    } else if (isConstructionLine(entity)) {
        shape = <ConstructionLineGeometry entity={entity} viewBox={viewBox} shapeProps={shapeProps} />;
    } else if (entity.type === 'line') {
        shape = <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...shapeProps} />;
    } else if (isDrawingWipeout(entity)) {
        shape = <polygon points={polylinePoints(entity)} {...shapeProps} fill="#ffffff" stroke={entity.wipeout.frame === false ? 'none' : shapeProps.stroke} />;
    } else if (entity.type === 'polyline') {
        shape = <PolylineGeometry
            entity={entity}
            shapeProps={shapeProps}
            usePartAppearance={!draft && !entity.color && !entity.lineWeight && !entity.lineWidth && !entity.lineType && !Object.hasOwn(entity, 'transparency')}
            viewBox={viewBox}
            circleGeometryCache={circleGeometryCache}
        />;
    } else if (entity.type === 'rectangle') {
        shape = <RectangleGeometry entity={entity} shapeProps={shapeProps} />;
    } else if (entity.type === 'circle') {
        shape = circleViewportShape(entity, viewBox, shapeProps, undefined, circleGeometryCache);
    } else if (entity.type === 'polygon') {
        shape = <polygon points={polygonPoints(entity)} {...shapeProps} />;
    } else if (entity.type === 'arc') {
        shape = <path d={getArcPath(entity)} {...shapeProps} />;
    } else if (entity.type === 'ellipse') {
        shape = <EllipseGeometry entity={entity} shapeProps={shapeProps} />;
    } else if (entity.type === 'spline') {
        shape = <SplineGeometry entity={entity} shapeProps={shapeProps} />;
    } else if (entity.type === 'hatch') {
        shape = <HatchGeometry entity={entity} shapeProps={shapeProps} />;
    } else if (entity.type === 'region') {
        shape = <path d={hatchPath(entity)} {...shapeProps} fill="none" />;
    } else if (entity.type === 'image') {
        const rect = normalizedRect(entity);
        shape = asset?.link ? (
            <ReferenceImage entity={entity} href={asset.link} rect={rect} opacity={(entity.opacity ?? 0.55) * appearanceOpacity} />
        ) : <rect {...rect} {...shapeProps} strokeDasharray="4 4" transform={rectTransform(entity)} />;
    } else if (entity.type === 'text') {
        const rect = normalizedRect(entity);
        shape = draft && entity.previewMode !== 'copy' ? (
            <rect {...rect} {...shapeProps} transform={rectTransform(entity)} />
        ) : <DrawingTextShape entity={entity} color={appearance.color} opacity={entity.previewMode === 'copy' ? 0.72 : appearanceOpacity} textStyles={textStyles} />;
    } else if (isDrawingDimensionEntity(entity)) {
        shape = (
            <DimensionShape
                entity={entity}
                sources={sources}
                appearance={appearance}
                opacity={appearanceOpacity}
                textSize={Number.isFinite(Number(entity.textSize)) && Number(entity.textSize) > 0
                    ? Number(entity.textSize)
                    : dimensionTextSize}
                locale={locale}
            />
        );
    } else if (entity.type === 'blockReference') {
        shape = symbolId ? <use href={`#${symbolId}`} transform={affineMatrixToSvg(entity.transform)} /> : <BlockReferenceGeometry
            reference={entity}
            block={block}
            blockMap={blockMap}
            assetMap={assetMap}
            layerMap={layerMap}
            hiddenLayers={hiddenLayers}
            dimensionTextSize={dimensionTextSize}
            locale={locale}
            t={t}
            viewBox={viewBox}
            circleGeometryCache={circleGeometryCache}
            visitedBlockIds={visitedBlockIds}
            textStyles={textStyles}
            attributeDisplay={attributeDisplay}
        />;
    }

    if (!shape) return null;
    if (bare) return visualHidden ? null : shape;
    return (
        <g {...groupProps}>
            {!visualHidden && shape}
            {hitShape && <HitShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />}
            {!visualHidden && selected && <SelectionShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />}
            {!visualHidden && highlighted && <SelectionShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} preview />}
            {!visualHidden && editable && showGrips && <GripHandles entity={entity} sources={sources} size={gripSize} t={t} />}
        </g>
    );
}

export default React.memo(DrawingScene);

// Interactive scenes skip entities outside the visible area (plus a margin).
const CULL_MARGIN_RATIO = 0.1;
const cullIndexCache = createDrawingIndexCache();

/**
 * In-progress geometry (rubber bands, previews of moves, copies and inserts).
 * The model canvas draws it in its pointer overlay, so a pointer move redraws
 * these few shapes instead of repainting the whole drawing.
 */
export const DrawingDraftLayer = React.memo(function DrawingDraftLayer({
    content, assets = EMPTY_ARRAY, draftEntities = EMPTY_ARRAY, dimensionTextSize = 0.35, viewBox = null,
}) {
    const { locale, t } = useI18n();
    const drafts = useStableArray(draftEntities);
    const draftList = useMemo(() => (drafts.length
        ? applyCurrentStyleToNewDimensions({ ...content, entities: drafts }, content).entities
        : EMPTY_ARRAY), [content, drafts]);
    const entityMap = useMemo(() => getDrawingDimensionSourceMap(content), [content.entities, content.blocks, content.layers, content.textStyles]);
    // Most previews draw from their own geometry; only those reading sources
    // (dimension previews) need drafts merged into the drawing's source map.
    const sources = useMemo(() => (draftList.some(drawingEntityUsesSources)
        ? createDimensionSourceMap([...new Map([...entityMap, ...draftList.map(entity => [entity.id, entity])]).values()], content.blocks, content)
        : entityMap), [draftList, entityMap, content.blocks, content.layers, content.textStyles]);
    const layerMap = useMemo(() => new Map(content.layers.map(layer => [layer.id, layer])), [content.layers]);
    const blockMap = useMemo(() => new Map((content.blocks || []).map(block => [block.id, block])), [content.blocks]);
    const assetMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
    if (!draftList.length) return null;
    const circleGeometryCache = new WeakMap();
    return (
        <g className="drawing-draft-layer" pointerEvents="none">
            {draftList.map((entity, index) => (
                <DrawingEntity
                    key={entity.id || `draft-${index}`}
                    entity={entity}
                    sources={sources}
                    asset={entity.assetId ? assetMap.get(entity.assetId) : null}
                    appearance={getEntityAppearance(content, entity)}
                    interactive={false}
                    draft
                    selected={entity.previewMode === 'copy'}
                    dimensionTextSize={dimensionTextSize}
                    locale={locale}
                    t={t}
                    viewBox={viewBox}
                    circleGeometryCache={circleGeometryCache}
                    block={entity.blockId ? blockMap.get(entity.blockId) : null}
                    blockMap={blockMap}
                    assetMap={assetMap}
                    layerMap={layerMap}
                    hiddenLayers={EMPTY_SET}
                    textStyles={content.textStyles}
                    attributeDisplay={content.settings?.attributeDisplay}
                />
            ))}
        </g>
    );
});

/** Pointer-hover outline drawn above the scene, independent of its memoized entities. */
export const DrawingHighlightLayer = React.memo(function DrawingHighlightLayer({ content, entityId, viewBox }) {
    const entityMap = useMemo(() => getDrawingDimensionSourceMap(content), [content.entities, content.blocks, content.layers, content.textStyles]);
    const entity = entityId ? content.entities.find(item => item.id === entityId) : null;
    if (!entity) return null;
    return (
        <g className="drawing-highlight-layer" pointerEvents="none">
            <SelectionShape entity={resolveDrawingPlotEntityDetails(entity, content.layers.find(layer => layer.id === entity.layerId))}
                sources={entityMap} viewBox={viewBox} preview />
        </g>
    );
});

/** One contiguous group of model entities (see drawingSceneChunks.js). */
const SceneChunk = React.memo(function SceneChunk({ entities, dots, scene }) {
    const { content, selection } = scene;
    const isSelected = id => (selection?.previewSelected ? selection.previewSelected.has(id) : selection?.selected.has(id) || false);
    const gripsFor = entity => Boolean(selection?.gripsEnabled
        && (selection.selected.has(entity.id) || selection.selectedQdimGripSeries.has(entity.seriesId)));
    const renderEntity = entity => {
                const editable = canEditEntity(content, entity);
                return (
                    <MemoDrawingEntity
                        key={entity.id}
                        entity={entity}
                        sources={scene.sources}
                        asset={entity.assetId ? scene.assetMap.get(entity.assetId) : null}
                        appearance={getEntityAppearance(content, entity)}
                        selected={!scene.bare && isSelected(entity.id)}
                        highlighted={!scene.bare && Boolean(selection?.highlighted.has(entity.id))}
                        editable={editable}
                        interactive={scene.interactive}
                        hitShape={scene.interactive && scene.hitShapes}
                        bare={scene.bare}
                        symbolId={scene.symbolReferences.get(entity.id)}
                        dimensionTextSize={scene.dimensionTextSize}
                        showGrips={!scene.bare && gripsFor(entity)}
                        gripSize={scene.gripSize}
                        locale={scene.locale}
                        t={scene.t}
                        viewBox={scene.viewBox}
                        circleGeometryCache={scene.circleGeometryCache}
                        block={entity.blockId ? scene.blockMap.get(entity.blockId) : null}
                        blockMap={scene.blockMap}
                        assetMap={scene.assetMap}
                        layerMap={scene.layerMap}
                        hiddenLayers={scene.hiddenLayers}
                        visualHidden={scene.hitOnly.has(entity.id)}
                        textStyles={content.textStyles}
                        attributeDisplay={content.settings?.attributeDisplay}
                    />
                );
    };
    // Consecutive plain linework is merged into one path per appearance; any
    // other entity ends the run, so painter order between runs is preserved.
    const items = [];
    let run = null;
    for (const entity of entities) {
        const parts = scene.bare && !scene.hitOnly.has(entity.id) ? batchedLinework(entity, scene) : null;
        if (!parts) {
            run = null;
            items.push(renderEntity(entity));
            continue;
        }
        if (!run) {
            run = new Map();
            items.push(run);
        }
        for (const part of parts) {
            const group = run.get(part.key);
            if (group) group.paths.push(part.d);
            else run.set(part.key, { appearance: part.appearance, paths: [part.d] });
        }
    }
    return (
        <g>
            {items.map((item, index) => (item instanceof Map ? [...item.values()].map(({ appearance, paths }, groupIndex) => (
                <path key={`run-${index}-${groupIndex}`} className="drawing-linework" d={paths.join(' ')} fill="none"
                    stroke={appearance.color} strokeWidth={appearance.lineWeight} vectorEffect="non-scaling-stroke"
                    {...lineTypeStrokeProps(appearance.lineType, appearance.lineWeight)} />
            )) : item))}
            {dots.length > 0 && <EntityDots entities={dots} content={content} pixelSize={scene.pixelSize} />}
        </g>
    );
}, sameSceneChunkProps);

const SCENE_KEYS = ['assetMap', 'blockMap', 'layerMap', 'hiddenLayers', 'hitOnly', 'interactive', 'hitShapes', 'bare',
    'gripSize', 'locale', 't', 'selection'];

/**
 * A chunk re-renders when one of its entities changed, when shared drawing
 * context changed, or when a zoom-, source- or dimension-size-dependent value
 * changed for an entity that uses it (the same rules as sameDrawingEntityProps).
 */
function sameSceneChunkProps(previous, next) {
    if (!sameItems(previous.dots, next.dots)) return false;
    const before = previous.entities;
    const after = next.entities;
    if (!sameItems(before, after)) return false;
    const old = previous.scene;
    const scene = next.scene;
    if (old === scene) return true;
    if (SCENE_KEYS.some(key => old[key] !== scene[key])) return false;
    if (!sameContentContext(old.content, scene.content)) return false;
    // Block symbols are rebuilt with the entity list; compare this chunk's references only.
    if (old.symbolReferences !== scene.symbolReferences
        && after.some(entity => old.symbolReferences.get(entity.id) !== scene.symbolReferences.get(entity.id))) return false;
    if (old.sources !== scene.sources && after.some(entity => drawingEntitySourcesChanged(entity, old.sources, scene.sources))) return false;
    if (old.dimensionTextSize !== scene.dimensionTextSize && after.some(entity => drawingEntityUsesDefaultDimensionSize(entity, scene.blockMap))) return false;
    return !after.some(entity => drawingEntityViewportChanged(entity, old.viewBox, scene.viewBox, scene.blockMap));
}

// Plain opaque linework is merged into one path per appearance and chunk run
// (drawingLineworkBatch.js): a plan holds far fewer elements to lay out and
// paint, while each subpath draws exactly what the entity's element drew.
const lineworkCache = new WeakMap();

function lineworkKey(appearance) {
    return `${appearance.color}|${appearance.lineWeight}|${appearance.lineType}`;
}

/** Subpaths and appearance of an entity drawable as shared opaque linework, or null. */
function batchedLinework(entity, scene) {
    const { content } = scene;
    const viewportDependent = scene.lineworkViewportCache;
    const cached = lineworkCache.get(entity) || viewportDependent.get(entity);
    if (cached && cached.blocks === content.blocks && cached.layers === content.layers) return cached.parts;
    const opaque = appearance => transparencyToOpacity(appearance.transparency) === 1;
    const plain = item => !scene.layerMap.get(item.layerId)?.[DRAWING_PLOT_PRESENTATION];
    let parts = null;
    let dependsOnViewport = drawingLineworkDependsOnViewport(entity);
    if (entity.type === 'blockReference') {
        const block = scene.blockMap.get(entity.blockId);
        const children = plain(entity) && drawingLineworkBlockChildren(entity, block, {
            layerVisible: layerId => isDrawingLayerVisible(scene.layerMap.get(layerId)) && !scene.hiddenLayers.has(layerId),
            viewBox: scene.viewBox, textStyles: content.textStyles, attributeDisplay: content.settings?.attributeDisplay,
        });
        if (children) {
            dependsOnViewport = children.some(child => drawingLineworkDependsOnViewport(child.entity));
            const layers = { layers: content.layers };
            parts = children.map(child => ({ d: child.d, appearance: getEntityAppearance(layers, child.entity) }));
            if (!parts.every(part => opaque(part.appearance))) parts = null;
        }
    } else if (plain(entity)) {
        const d = drawingLineworkPath(entity, scene.viewBox);
        const appearance = d === null ? null : getEntityAppearance(content, entity);
        if (appearance && opaque(appearance)) parts = [{ d, appearance }];
    }
    parts = parts?.filter(part => part.d).map(part => ({ ...part, key: lineworkKey(part.appearance) })) || null;
    (dependsOnViewport ? viewportDependent : lineworkCache).set(entity, { blocks: content.blocks, layers: content.layers, parts });
    return parts;
}

function sameItems(before, after) {
    return before.length === after.length && before.every((item, index) => item === after[index]);
}

// Level of detail: below this screen size an entity is indistinguishable from
// a dot. Dots of one chunk are merged into one path per appearance, so a
// zoomed-out plan holds far fewer elements to lay out and paint.
const LOD_DOT_PIXELS = 1;

function drawingEntityBelowSize(entity, size) {
    const bounds = drawingEntityRenderBounds(entity);
    return Boolean(bounds) && bounds.maxX - bounds.minX < size && bounds.maxY - bounds.minY < size;
}

function EntityDots({ entities, content, pixelSize }) {
    const groups = new Map();
    for (const entity of entities) {
        const bounds = drawingEntityRenderBounds(entity);
        const appearance = getEntityAppearance(content, entity);
        const key = `${appearance.color}|${appearance.transparency}|${appearance.lineWeight}`;
        let group = groups.get(key);
        if (!group) {
            group = { appearance, segments: [] };
            groups.set(key, group);
        }
        // A short segment with round caps draws a dot of the stroke width.
        const x = (bounds.minX + bounds.maxX) / 2;
        const y = (bounds.minY + bounds.maxY) / 2;
        group.segments.push(`M${x} ${y}h${(pixelSize || 1e-6) * 0.01}`);
    }
    return [...groups.values()].map(({ appearance, segments }, index) => (
        <path key={index} className="drawing-entity-dots" d={segments.join('')} fill="none" stroke={appearance.color}
            strokeWidth={Math.max(1, appearance.lineWeight) + 0.5} strokeLinecap="round" vectorEffect="non-scaling-stroke"
            opacity={transparencyToOpacity(appearance.transparency)} />
    ));
}

// Layers, styles, settings and hidden-object marks are read through the
// content; only its entity list may differ for a chunk to be reused.
function sameContentContext(previous, next) {
    if (previous === next) return true;
    const keys = Reflect.ownKeys(next);
    if (keys.length !== Reflect.ownKeys(previous).length) return false;
    return keys.every(key => key === 'entities' || previous[key] === next[key]);
}

const VISUAL_PROPS = ['entity', 'asset', 'selected', 'highlighted', 'editable', 'interactive', 'hitShape', 'bare', 'draft', 'showGrips', 'visualHidden',
    'symbolId', 'nested', 'block', 'blockMap', 'assetMap', 'layerMap', 'hiddenLayers', 'textStyles', 'attributeDisplay', 'locale', 't', 'visitedBlockIds'];
const APPEARANCE_FIELDS = ['color', 'lineWeight', 'lineType', 'transparency'];

/**
 * Model entities re-render only when something they draw changes. Viewport,
 * source-map and zoom-dependent props are compared only for the entities whose
 * output depends on them, so hover, pan and zoom touch a small subset.
 */
function sameDrawingEntityProps(previous, next) {
    if (VISUAL_PROPS.some(key => previous[key] !== next[key])) return false;
    if (APPEARANCE_FIELDS.some(key => previous.appearance?.[key] !== next.appearance?.[key])) return false;
    if (next.showGrips && previous.gripSize !== next.gripSize) return false;
    const { entity } = next;
    if (drawingEntitySourcesChanged(entity, previous.sources, next.sources)) return false;
    if (previous.dimensionTextSize !== next.dimensionTextSize && drawingEntityUsesDefaultDimensionSize(entity, next.blockMap)) return false;
    return !drawingEntityViewportChanged(entity, previous.viewBox, next.viewBox, next.blockMap);
}

const MemoDrawingEntity = React.memo(DrawingEntity, sameDrawingEntityProps);


/** Selection outline, hover preview and grips of one model entity, drawn above every shape. */
const EntityDecoration = React.memo(function EntityDecoration({ entity, sources, selected, highlighted, grips, gripSize, t, viewBox, circleGeometryCache }) {
    return (
        <g data-entity-id={entity.id} className={['drawing-entity-decoration', selected && 'is-selected', highlighted && 'is-highlighted'].filter(Boolean).join(' ')}>
            {selected && <SelectionShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />}
            {highlighted && <SelectionShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} preview />}
            {grips && <GripHandles entity={entity} sources={sources} size={gripSize} t={t} />}
        </g>
    );
}, (previous, next) => ['entity', 'selected', 'highlighted', 'grips', 't'].every(key => previous[key] === next[key])
    && (!next.grips || previous.gripSize === next.gripSize)
    && !drawingEntitySourcesChanged(next.entity, previous.sources, next.sources)
    && !drawingEntityViewportChanged(next.entity, previous.viewBox, next.viewBox, next.blockMap));

function BlockReferenceGeometry({
    reference,
    block,
    blockMap,
    assetMap,
    layerMap,
    hiddenLayers,
    dimensionTextSize,
    locale,
    t,
    viewBox,
    circleGeometryCache,
    visitedBlockIds,
    textStyles,
    attributeDisplay,
}) {
    const clipId = `block-clip-${useId().replace(/:/g, '')}`;
    const clip = drawingBlockClipShape(reference);
    if (!block || reference.externalReference?.loaded === false || visitedBlockIds.has(block.id)) return null;
    const children = drawingBlockInstanceEntities(block, reference);
    const childMap = createDimensionSourceMap(children, blockMap, { layers: [...layerMap.values()], textStyles });
    const localViewBox = inverseAffineViewBox(viewBox, reference.transform);
    const nextVisited = new Set(visitedBlockIds);
    nextVisited.add(block.id);
    return (
        <g transform={affineMatrixToSvg(reference.transform)}>
            {clip && <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><path d={clip.paths.map(path => curvePartsPath(path.parts, true)).join(' ')} clipRule={clip.rule} /></clipPath></defs>}
            <g clipPath={clip ? `url(#${clipId})` : undefined}>
            {children.map(child => {
                const entity = resolveDrawingBlockChild(child, reference, attributeDisplay);
                if (!entity) return null;
                const layer = layerMap.get(entity.layerId);
                if (!isDrawingLayerVisible(layer) || hiddenLayers.has(entity.layerId)) return null;
                return (
                    <DrawingEntity
                        key={entity.id}
                        entity={entity}
                        sources={childMap}
                        asset={entity.assetId ? assetMap.get(entity.assetId) : null}
                        appearance={getEntityAppearance({ layers: [...layerMap.values()] }, entity)}
                        interactive={false}
                        editable={false}
                        dimensionTextSize={dimensionTextSize}
                        gripSize={0}
                        locale={locale}
                        t={t}
                        viewBox={localViewBox}
                        circleGeometryCache={circleGeometryCache}
                        block={entity.blockId ? blockMap.get(entity.blockId) : null}
                        blockMap={blockMap}
                        assetMap={assetMap}
                        layerMap={layerMap}
                        hiddenLayers={hiddenLayers}
                        nested
                        visitedBlockIds={nextVisited}
                        textStyles={textStyles}
                        attributeDisplay={attributeDisplay}
                    />
                );
            })}
            </g>
        </g>
    );
}

function GripHandles({ entity, sources, size, t }) {
    const grips = getEntityGrips(entity, sources);
    if (!grips.length) return null;
    return (
        <g className="drawing-grips">
            {grips.map(grip => <GripHandle key={grip.id} entity={entity} grip={grip} size={size} t={t} />)}
        </g>
    );
}

function GripHandle({ entity, grip, size, t }) {
    const label = isConstructionLine(entity)
        ? t(grip.id === 'start' ? 'grip.constructionOrigin' : 'grip.constructionDirection')
        : gripName(grip.id, t);
    const shared = {
        'data-entity-id': entity.id,
        'data-grip-id': grip.id,
        'vectorEffect': 'non-scaling-stroke',
        'aria-label': t('canvas.grip', { name: label }),
    };
    if (grip.id === DRAWING_QDIM_GRIP_IDS.spacing) return (
        <g className="drawing-array-control-handle-group">
            <circle
                {...shared}
                className="drawing-array-handle is-spacing"
                cx={grip.x}
                cy={grip.y}
                r={size / 2}
            />
            <GripHandleLabel grip={grip} label={label} size={size} />
        </g>
    );
    if (grip.id === DRAWING_QDIM_GRIP_IDS.offset) return (
        <g className="drawing-array-control-handle-group">
            <rect
                {...shared}
                className="drawing-array-handle is-base"
                x={grip.x - size / 2}
                y={grip.y - size / 2}
                width={size}
                height={size}
            />
            <GripHandleLabel grip={grip} label={label} size={size} />
        </g>
    );
    return (
        <rect
            {...shared}
            className="drawing-grip"
            x={grip.x - size / 2}
            y={grip.y - size / 2}
            width={size}
            height={size}
        />
    );
}

function GripHandleLabel({ grip, label, size }) {
    return (
        <text
            className="drawing-array-control-label"
            x={grip.x + size * 0.8}
            y={grip.y - size * 0.75}
            fontSize={size * 0.9}
        >
            {label}
        </text>
    );
}

function normalizedRect(entity) {
    return {
        x: Math.min(entity.x, entity.x + entity.width),
        y: Math.min(entity.y, entity.y + entity.height),
        width: Math.abs(entity.width),
        height: Math.abs(entity.height),
    };
}


const rectTransform = drawingRectTransform;

function RectangleGeometry({ entity, shapeProps }) {
    if (entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet') {
        return <path d={getRectangleOutlinePath(entity)} {...shapeProps} transform={rectTransform(entity)} />;
    }
    return <rect {...normalizedRect(entity)} {...shapeProps} transform={rectTransform(entity)} />;
}

function circleViewportShape(entity, viewBox, shapeProps, key = undefined, geometryCache = null) {
    let geometry;
    if (geometryCache?.has(entity)) geometry = geometryCache.get(entity);
    else {
        geometry = getCircleViewportGeometry(entity, viewBox);
        geometryCache?.set(entity, geometry);
    }
    if (!geometry) return null;
    if (geometry.kind === 'circle') {
        return <circle key={key} cx={geometry.cx} cy={geometry.cy} r={geometry.r} {...shapeProps} />;
    }
    return <path key={key} d={geometry.d} {...shapeProps} />;
}

function polygonPoints(entity) {
    return getRegularPolygonVertices(entity).map(point => `${point.x},${point.y}`).join(' ');
}

function polylinePoints(entity) {
    return (entity.points || []).map(point => `${point.x},${point.y}`).join(' ');
}

function PolylineGeometry({
    entity,
    shapeProps,
    usePartAppearance = false,
    renderText = true,
    viewBox = null,
    circleGeometryCache = null,
}) {
    if (!Array.isArray(entity.parts)) {
        const Element = entity.closed ? 'polygon' : 'polyline';
        return <Element points={polylinePoints(entity)} {...shapeProps} />;
    }
    return entity.parts.map((part, index) => {
        const partWeight = Number(part.lineWeight) || Number(part.lineWidth) || shapeProps.strokeWidth;
        const partProps = usePartAppearance ? {
            ...shapeProps,
            ...(part.color ? { stroke: part.color } : {}),
            ...(part.lineWeight || part.lineWidth ? { strokeWidth: partWeight } : {}),
            ...(part.lineType ? lineTypeStrokeProps(part.lineType, partWeight) : {}),
            ...(Object.hasOwn(part, 'transparency') ? { opacity: transparencyToOpacity(part.transparency) } : {}),
        } : shapeProps;
        if (part.type === 'text') return renderText ? <DrawingTextShape key={index} entity={part} color={partProps.stroke} opacity={partProps.opacity} />
            : <rect key={index} {...normalizedRect(part)} {...partProps} transform={rectTransform(part)} />;
        if (part.type === 'line') return <line key={index} x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} {...partProps} />;
        if (part.type === 'rectangle') return <RectangleGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'circle') return circleViewportShape(part, viewBox, partProps, index, circleGeometryCache);
        if (part.type === 'polygon') return <polygon key={index} points={polygonPoints(part)} {...partProps} />;
        if (part.type === 'arc') return <path key={index} d={getArcPath(part)} {...partProps} />;
        if (part.type === 'ellipse') return <EllipseGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'hatch') return <HatchGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'spline') return <SplineGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'polyline') return <PolylineGeometry key={index} entity={part} shapeProps={partProps} usePartAppearance={usePartAppearance} renderText={renderText} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />;
        return null;
    });
}

function DrawingTextShape({ entity, color, opacity, textStyles }) {
    const clipId = `drawing-text-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const layout = getDrawingTextLayout(entity, { color, styles: textStyles });
    // Single-line text is never clipped, so it needs no clip path elements.
    const clipped = layout.textMode !== 'singleLine';
    // A run styled exactly like the text element inherits everything: no nested tspan needed.
    const inheritsBase = span => (span.style.color || color) === color
        && span.style.cssFontFamily === layout.baseStyle.cssFontFamily && span.style.fontSize === layout.fontSize
        && span.style.fontWeight === layout.baseStyle.fontWeight && span.style.fontStyle === layout.baseStyle.fontStyle
        && (!span.style.textDecoration || span.style.textDecoration === 'none');
    const lineContent = line => {
        if (!line.spans.length) return '\u00a0';
        if (line.spans.length === 1 && inheritsBase(line.spans[0])) return line.spans[0].text || '\u00a0';
        return line.spans.map((span, spanIndex) => (
            <tspan
                key={`${spanIndex}-${span.text}`}
                fill={span.style.color || color}
                fontFamily={span.style.cssFontFamily}
                fontSize={span.style.fontSize}
                fontWeight={span.style.fontWeight}
                fontStyle={span.style.fontStyle}
                textDecoration={span.style.textDecoration}
            >
                {span.text || '\u00a0'}
            </tspan>
        ));
    };
    return (
        <g transform={rectTransform(entity)} opacity={opacity} pointerEvents="none">
            {clipped && <defs>
                <clipPath id={clipId}>
                    <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} />
                </clipPath>
            </defs>}
            <text
                clipPath={clipped ? `url(#${clipId})` : undefined}
                x={layout.textX}
                fill={color}
                fontFamily={layout.baseStyle.cssFontFamily}
                fontSize={layout.fontSize}
                fontWeight={layout.baseStyle.fontWeight}
                fontStyle={layout.baseStyle.fontStyle}
                textAnchor={layout.textAnchor}
            >
                {layout.styledLines.map((line, index) => (
                    <tspan
                        key={`${index}-${line.text}`}
                        x={layout.textX}
                        y={line.baseline}
                        textLength={layout.fitWidth ? layout.availableWidth : undefined}
                        lengthAdjust={layout.fitWidth ? 'spacingAndGlyphs' : undefined}
                    >
                        {lineContent(line)}
                    </tspan>
                ))}
            </text>
        </g>
    );
}

function HitShape({ entity, sources, viewBox, circleGeometryCache }) {
    const hitProps = {
        stroke: 'transparent',
        strokeWidth: 12,
        vectorEffect: 'non-scaling-stroke',
        fill: 'none',
        pointerEvents: 'stroke',
    };
    if (entity.type === 'point') return <circle cx={entity.x} cy={entity.y} r={normalizeDrawingPointStyle(entity.pointStyle).size / 2} transform={drawingPointSvgTransform(entity)} {...hitProps} pointerEvents="all" />;
    if (isConstructionLine(entity)) return <ConstructionLineGeometry entity={entity} viewBox={viewBox} shapeProps={hitProps} />;
    if (entity.type === 'line') return <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...hitProps} />;
    if (isDrawingWipeout(entity)) return <polygon points={polylinePoints(entity)} {...hitProps} pointerEvents="all" />;
    if (entity.type === 'polyline') return <PolylineGeometry entity={entity} shapeProps={hitProps} renderText={false} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />;
    if (entity.type === 'rectangle') return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        ? <path d={getRectangleOutlinePath(entity)} {...hitProps} transform={rectTransform(entity)} />
        : <rect {...normalizedRect(entity)} {...hitProps} transform={rectTransform(entity)} />;
    if (entity.type === 'image' && getImageClipPoints(entity)) return <polygon points={getImageClipPoints(entity).map(point => `${point.x},${point.y}`).join(' ')} {...hitProps} transform={rectTransform(entity)} pointerEvents="all" />;
    if (entity.type === 'image' || entity.type === 'text') return <rect {...normalizedRect(entity)} {...hitProps} transform={rectTransform(entity)} pointerEvents="all" />;
    if (entity.type === 'circle') return circleViewportShape(entity, viewBox, hitProps, undefined, circleGeometryCache);
    if (entity.type === 'polygon') return <polygon points={polygonPoints(entity)} {...hitProps} />;
    if (entity.type === 'arc') return <path d={getArcPath(entity)} {...hitProps} />;
    if (entity.type === 'ellipse') return <EllipseGeometry entity={entity} shapeProps={hitProps} />;
    if (entity.type === 'spline') return <SplineGeometry entity={entity} shapeProps={hitProps} />;
    if (['hatch', 'region'].includes(entity.type)) return <path d={hatchPath(entity)} {...hitProps} fillRule={entity.fillRule === 'nonzero' ? 'nonzero' : 'evenodd'} pointerEvents="all" />;
    if (entity.type === 'blockReference') {
        const bounds = getDrawingBlockReferenceBounds(entity);
        const clip = drawingBlockClipShape(entity, { world: true });
        if (!bounds) return null;
        return clip ? <path d={clip.paths.map(path => curvePartsPath(path.parts, true)).join(' ')} {...hitProps} fillRule={clip.rule} pointerEvents="all" />
            : <rect {...rectFromBounds(bounds)} {...hitProps} pointerEvents="all" />;
    }
    const geometry = presentDrawingDimension(getDimensionGeometry(entity, sources), entity, entity.textSize);
    if (!geometry) return null;
    return <DimensionPrimitiveGeometry geometry={geometry} lineProps={hitProps} />;
}

function SelectionShape({ entity, sources, preview = false, viewBox, circleGeometryCache }) {
    const props = {
        stroke: '#f7941d',
        strokeWidth: preview ? 4 : 3,
        vectorEffect: 'non-scaling-stroke',
        fill: 'none',
        strokeDasharray: preview ? undefined : '5 4',
        opacity: preview ? 0.9 : undefined,
        pointerEvents: 'none',
    };
    if (entity.type === 'point') return <path d={drawingPointPath(entity)} transform={drawingPointSvgTransform(entity)} {...props} />;
    if (isConstructionLine(entity)) return <ConstructionLineGeometry entity={entity} viewBox={viewBox} shapeProps={props} />;
    if (entity.type === 'line') return <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...props} />;
    if (entity.type === 'polyline') return <PolylineGeometry entity={entity} shapeProps={props} renderText={false} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />;
    if (entity.type === 'rectangle') return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        ? <path d={getRectangleOutlinePath(entity)} {...props} transform={rectTransform(entity)} />
        : <rect {...normalizedRect(entity)} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'image' && getImageClipPoints(entity)) return <polygon points={getImageClipPoints(entity).map(point => `${point.x},${point.y}`).join(' ')} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'image' || entity.type === 'text') return <rect {...normalizedRect(entity)} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'circle') return circleViewportShape(entity, viewBox, props, undefined, circleGeometryCache);
    if (entity.type === 'polygon') return <polygon points={polygonPoints(entity)} {...props} />;
    if (entity.type === 'arc') return <path d={getArcPath(entity)} {...props} />;
    if (entity.type === 'ellipse') return <EllipseGeometry entity={entity} shapeProps={props} />;
    if (entity.type === 'spline') return <SplineGeometry entity={entity} shapeProps={props} />;
    if (['hatch', 'region'].includes(entity.type)) return <path d={hatchPath(entity)} {...props} />;
    if (entity.type === 'blockReference') {
        const bounds = getDrawingBlockReferenceBounds(entity);
        return bounds ? <rect {...rectFromBounds(bounds)} {...props} /> : null;
    }
    const geometry = presentDrawingDimension(getDimensionGeometry(entity, sources), entity, entity.textSize);
    if (!geometry) return null;
    return <DimensionPrimitiveGeometry geometry={geometry} lineProps={props} />;
}

function ConstructionLineGeometry({ entity, viewBox, shapeProps }) {
    const segment = constructionLineViewportSegment(entity, viewBox);
    return segment ? <line x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} {...shapeProps} /> : null;
}

function rectFromBounds(bounds) {
    return {
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
    };
}

function EllipseGeometry({ entity, shapeProps }) {
    if (entity.fullEllipse !== false) {
        return (
            <ellipse
                cx={entity.cx}
                cy={entity.cy}
                rx={Math.abs(Number(entity.rx) || 0)}
                ry={Math.abs(Number(entity.ry) || 0)}
                transform={Number(entity.rotation) ? `rotate(${entity.rotation} ${entity.cx} ${entity.cy})` : undefined}
                {...shapeProps}
            />
        );
    }
    return <path d={ellipseArcPath(entity)} {...shapeProps} />;
}

function SplineGeometry({ entity, shapeProps }) {
    const points = Array.isArray(entity.controlPoints) ? entity.controlPoints : [];
    if (points.length !== 4) return null;
    return (
        <path
            d={`M ${points[0].x} ${points[0].y} C ${points[1].x} ${points[1].y} ${points[2].x} ${points[2].y} ${points[3].x} ${points[3].y}`}
            {...shapeProps}
        />
    );
}

function HatchGeometry({ entity, shapeProps }) {
    const patternId = `drawing-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const d = hatchPath(entity);
    if (!d) return null;
    const pattern = entity.pattern || {};
    const gradient = ['gradient', 'radial'].includes(pattern.name);
    const solid = String(pattern.name || 'solid').toLowerCase() === 'solid';
    const spacing = Math.max(entity.annotation ? 1e-12 : 0.02, Math.abs(Number(pattern.spacing) || Number(pattern.scale) || 0.25));
    const fill = solid ? shapeProps.stroke : `url(#${patternId})`;
    return (
        <>
            {!solid && !gradient && (
                <defs>
                    <pattern
                        id={patternId}
                        patternUnits="userSpaceOnUse"
                        width={spacing}
                        height={spacing}
                        x={Number(pattern.origin?.x) || 0}
                        y={Number(pattern.origin?.y) || 0}
                        patternTransform={`rotate(${Number(pattern.angle) || 0} ${Number(pattern.origin?.x) || 0} ${Number(pattern.origin?.y) || 0})`}
                    >
                        <line x1="0" y1="0" x2={spacing} y2="0" stroke={shapeProps.stroke} strokeWidth={shapeProps.strokeWidth} vectorEffect="non-scaling-stroke" />
                        {pattern.name === 'cross' && <line x1="0" y1="0" x2="0" y2={spacing} stroke={shapeProps.stroke} strokeWidth={shapeProps.strokeWidth} vectorEffect="non-scaling-stroke" />}
                    </pattern>
                </defs>
            )}
            {gradient && <defs>
                {pattern.name === 'radial' ? <radialGradient id={patternId}>
                    <stop offset="0%" stopColor={shapeProps.stroke} /><stop offset="100%" stopColor={pattern.endColor || '#ffffff'} />
                </radialGradient> : <linearGradient id={patternId} x1="0" y1="0.5" x2="1" y2="0.5" gradientTransform={`rotate(${Number(pattern.angle) || 0} 0.5 0.5)`}>
                    <stop offset="0%" stopColor={shapeProps.stroke} /><stop offset="100%" stopColor={pattern.endColor || '#ffffff'} />
                </linearGradient>}
            </defs>}
            <path
                d={d}
                {...shapeProps}
                fill={fill}
                fillRule={entity.fillRule === 'nonzero' ? 'nonzero' : 'evenodd'}
                stroke={entity.boundaryStroke === false ? 'none' : shapeProps.stroke}
                fillOpacity={1}
            />
        </>
    );
}

function ReferenceImage({ entity, href, rect, opacity }) {
    const id = `image-adjust-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const settings = imageAdjustmentTransfer(entity.imageAdjustments);
    const adjusted = hasImageAdjustments(settings);
    const key = imageTransparencyKey(settings);
    const clip = getImageClipPoints(entity);
    return <>
        {clip && <defs><clipPath id={`${id}-clip`} clipPathUnits="userSpaceOnUse"><polygon points={clip.map(point => `${point.x},${point.y}`).join(' ')} /></clipPath></defs>}
        {adjusted && <defs><filter id={id} colorInterpolationFilters="sRGB">
            {key && <>
                <feComponentTransfer in="SourceGraphic">
                    <feFuncR type="discrete" tableValues={key.tables[0]} />
                    <feFuncG type="discrete" tableValues={key.tables[1]} />
                    <feFuncB type="discrete" tableValues={key.tables[2]} />
                    <feFuncA type="linear" slope="0" intercept="1" />
                </feComponentTransfer>
                <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 -2" />
                <feComponentTransfer result="keyMask"><feFuncA type="table" tableValues="1 0" /></feComponentTransfer>
                <feComposite in="SourceGraphic" in2="keyMask" operator="in" />
            </>}
            <feComponentTransfer>
                <feFuncR type="linear" slope={settings.slope} intercept={settings.intercept} />
                <feFuncG type="linear" slope={settings.slope} intercept={settings.intercept} />
                <feFuncB type="linear" slope={settings.slope} intercept={settings.intercept} />
            </feComponentTransfer>
            {settings.monochrome && <feColorMatrix type="saturate" values="0" />}
        </filter></defs>}
        <image href={href} {...rect} opacity={opacity} style={entity.imageRendering === 'pixelated' ? { imageRendering: 'pixelated' } : undefined} preserveAspectRatio="none" transform={rectTransform(entity)}
            clipPath={clip ? `url(#${id}-clip)` : undefined}
            filter={adjusted ? `url(#${id})` : undefined}
            data-image-key={settings.transparentColor} data-image-key-tolerance={settings.colorTolerance}
            data-image-brightness={settings.brightness} data-image-contrast={settings.contrast} data-image-monochrome={settings.monochrome ? 'true' : 'false'} />
    </>;
}

function hatchPath(entity) {
    return (Array.isArray(entity?.boundaries) ? entity.boundaries : [])
        .map(boundary => entityPath(boundary))
        .filter(Boolean)
        .join(' ');
}

function entityPath(entity) {
    if (!entity) return '';
    if (entity.type === 'polyline' && Array.isArray(entity.parts)) {
        return curvePartsPath(entity.parts, entity.closed !== false);
    }
    if (entity.type === 'polyline' && Array.isArray(entity.points) && entity.points.length) {
        return `${entity.points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')}${entity.closed === false ? '' : ' Z'}`;
    }
    if (entity.type === 'rectangle') return getRectangleOutlinePath(entity);
    if (entity.type === 'circle') {
        const radius = Math.abs(Number(entity.r) || 0);
        return `M ${entity.cx + radius} ${entity.cy} A ${radius} ${radius} 0 1 1 ${entity.cx - radius} ${entity.cy} A ${radius} ${radius} 0 1 1 ${entity.cx + radius} ${entity.cy} Z`;
    }
    if (entity.type === 'ellipse') {
        if (entity.fullEllipse !== false) {
            const start = ellipsePoint(entity, 0);
            const opposite = ellipsePoint(entity, Math.PI);
            return `M ${start.x} ${start.y} A ${entity.rx} ${entity.ry} ${Number(entity.rotation) || 0} 1 1 ${opposite.x} ${opposite.y} A ${entity.rx} ${entity.ry} ${Number(entity.rotation) || 0} 1 1 ${start.x} ${start.y} Z`;
        }
        return ellipseArcPath(entity);
    }
    if (entity.type === 'polygon') return `${getRegularPolygonVertices(entity).map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')} Z`;
    if (['line', 'arc', 'spline'].includes(entity.type)) return curvePartsPath([entity], false);
    return '';
}

function curvePartsPath(parts, closed) {
    return drawingCurvePathToSvgData({ parts, closed });
}

function curveStart(curve) {
    if (curve?.type === 'line') return { x: curve.x1, y: curve.y1 };
    if (curve?.type === 'spline') return curve.controlPoints?.[0] || null;
    if (curve?.type === 'arc') return {
        x: curve.cx + Math.cos(curve.startAngle) * curve.r,
        y: curve.cy + Math.sin(curve.startAngle) * curve.r,
    };
    if (curve?.type === 'ellipse') return ellipsePoint(curve, curve.startAngle || 0);
    return null;
}

function curveEnd(curve) {
    if (curve?.type === 'line') return { x: curve.x2, y: curve.y2 };
    if (curve?.type === 'spline') return curve.controlPoints?.[3] || null;
    if (curve?.type === 'arc') return {
        x: curve.cx + Math.cos(curve.endAngle) * curve.r,
        y: curve.cy + Math.sin(curve.endAngle) * curve.r,
    };
    if (curve?.type === 'ellipse') return ellipsePoint(curve, curve.endAngle || 0);
    return null;
}

function ellipseArcPath(entity) {
    const start = curveStart(entity);
    const end = curveEnd(entity);
    if (!start || !end) return '';
    const sweep = angularSweep(entity);
    return `M ${start.x} ${start.y} A ${Math.abs(Number(entity.rx) || 0)} ${Math.abs(Number(entity.ry) || 0)} ${Number(entity.rotation) || 0} ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y}`;
}

function ellipsePoint(entity, angle) {
    const rotation = (Number(entity.rotation) || 0) * Math.PI / 180;
    const x = Math.cos(angle) * Math.abs(Number(entity.rx) || 0);
    const y = Math.sin(angle) * Math.abs(Number(entity.ry) || 0);
    return {
        x: Number(entity.cx) + x * Math.cos(rotation) - y * Math.sin(rotation),
        y: Number(entity.cy) + x * Math.sin(rotation) + y * Math.cos(rotation),
    };
}

function angularSweep(entity) {
    if (entity.fullCircle || entity.fullEllipse) return entity.counterClockwise === false ? -Math.PI * 2 : Math.PI * 2;
    const start = Number(entity.startAngle) || 0;
    const end = Number(entity.endAngle) || 0;
    const positive = ((end - start) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    return entity.counterClockwise === false ? positive - Math.PI * 2 : positive;
}

function DimensionShape({ entity, sources, appearance, opacity, textSize, locale }) {
    const geometry = presentDrawingDimension(getDimensionGeometry(entity, sources), entity, textSize);
    if (!geometry) return null;
    const color = appearance.color;
    const lineProps = {
        stroke: color,
        strokeWidth: appearance.lineWeight,
        vectorEffect: 'non-scaling-stroke',
        fill: 'none',
        ...lineTypeStrokeProps(appearance.lineType, appearance.lineWeight),
    };

    const formatted = formatDrawingDimensionLabel(geometry, entity, locale);
    const labelLines = formatted.lines;
    return (
        <g className="drawing-dimension" opacity={opacity}>
            <DimensionPrimitiveGeometry geometry={geometry} lineProps={lineProps} />
            {geometry.label && labelLines.length > 0 && (
                <DimensionText
                    point={geometry.label.point}
                    angle={readableDimensionAngle(geometry.label.angle)}
                    color={color}
                    textSize={textSize}
                    anchor={geometry.kind === 'radial' || geometry.kind === 'ordinate' ? 'start' : 'middle'}
                    inspection={Boolean(formatted.inspection)}
                    lines={labelLines}
                />
            )}
        </g>
    );
}

function DimensionPrimitiveGeometry({ geometry, lineProps, includeTicks = true }) {
    return (
        <>
            {(geometry.lines || []).map((line, index) => (
                <line
                    key={`line-${index}`}
                    x1={line.start.x}
                    y1={line.start.y}
                    x2={line.end.x}
                    y2={line.end.y}
                    {...lineProps}
                />
            ))}
            {(geometry.arcs || []).map((arc, index) => (
                <path
                    key={`arc-${index}`}
                    d={getArcPath({
                        type: 'arc',
                        cx: arc.center.x,
                        cy: arc.center.y,
                        r: arc.radius,
                        startAngle: arc.startAngle,
                        endAngle: arc.endAngle,
                        counterClockwise: arc.counterClockwise,
                    })}
                    {...lineProps}
                />
            ))}
            {includeTicks && geometry.markers?.map((marker, index) => {
                const points = marker.points.map(point => `${point.x},${point.y}`).join(' ');
                return marker.type === 'polygon'
                    ? <polygon key={`marker-${index}`} points={points} {...lineProps} fill={lineProps.stroke} />
                    : <polyline key={`marker-${index}`} points={points} {...lineProps} />;
            })}

        </>
    );
}

function lineTypeStrokeProps(lineType, lineWeight) {
    const weight = Math.max(0.1, Number(lineWeight) || 1);
    if (lineType === 'dotted') {
        return { strokeDasharray: `0 ${weight * 3.2}`, strokeLinecap: 'round' };
    }
    if (lineType === 'dashed') {
        return { strokeDasharray: `${weight * 6} ${weight * 3}`, strokeLinecap: 'butt' };
    }
    return { strokeDasharray: undefined, strokeLinecap: 'butt' };
}

function transparencyToOpacity(transparency) {
    const value = Number(transparency);
    if (!Number.isFinite(value)) return 1;
    return 1 - Math.max(0, Math.min(100, value)) / 100;
}

function DimensionText({ point, angle, color, textSize, anchor = 'middle', inspection = false, lines = [] }) {
    const lineHeight = textSize * 1.08;
    const width = Math.max(...lines.map(line => String(line).length), 1) * textSize * 0.58 + textSize * 0.8;
    const height = Math.max(1, lines.length) * lineHeight + textSize * 0.45;
    const left = anchor === 'start' ? -textSize * 0.22 : -width / 2;
    const top = -height - textSize * 0.12;
    return (
        <g transform={`translate(${point.x} ${point.y}) rotate(${angle})`}>
            {inspection && (
                <rect
                    x={left}
                    y={top}
                    width={width}
                    height={height}
                    rx={textSize * 0.08}
                    fill="white"
                    fillOpacity="0.9"
                    stroke={color}
                    strokeWidth={Math.max(textSize * 0.08, 0.02)}
                    vectorEffect="non-scaling-stroke"
                />
            )}
            <text
                x="0"
                y={-textSize * 0.35 - (lines.length - 1) * lineHeight}
                textAnchor={anchor}
                fill={color}
                fontSize={textSize}
                fontFamily="SourceSans3, Arial, sans-serif"
                paintOrder="stroke"
                stroke="white"
                strokeWidth={textSize * 0.3}
                strokeLinejoin="round"
            >
                {lines.map((line, index) => (
                    <tspan key={`${index}-${line}`} x="0" dy={index ? lineHeight : 0}>{line}</tspan>
                ))}
            </text>
        </g>
    );
}

function readableDimensionAngle(radians) {
    let degrees = (Number(radians) || 0) * 180 / Math.PI;
    degrees = ((degrees + 180) % 360 + 360) % 360 - 180;
    if (degrees > 90) degrees -= 180;
    if (degrees < -90) degrees += 180;
    return degrees;
}
