import React, { useId, useMemo } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import {
    getArcPath,
    getCircleViewportGeometry,
    getDimensionGeometry,
    getDrawingEntityDependencyIds,
    getRectangleOutlinePath,
    getRegularPolygonVertices,
    formatDrawingDimensionLabel,
    isDrawingDimensionEntity,
} from '~utils/drawingGeometry';
import { getEntityGrips } from '~utils/drawingSelection';
import { canEditEntity, getEntityAppearance } from '~utils/drawingDocument';
import { DRAWING_QDIM_GRIP_IDS } from '~utils/drawingDimensions';
import { getDrawingTextLayout } from '~utils/drawingText';
import { affineMatrixToSvg, getDrawingBlockReferenceBounds } from '~utils/drawingBlocks';
import { getDrawingEntityRenderMode } from '~utils/drawingInteraction';

export default function DrawingScene({
    content,
    assets = [],
    selectedIds = [],
    previewSelectedIds = null,
    highlightedIds = [],
    interactive = false,
    dimensionTextSize = 0.35,
    draftEntity = null,
    draftEntities = [],
    showGrips = false,
    gripSize = 0.2,
    hiddenIds = [],
    hitOnlyIds = [],
    hiddenLayerIds = [],
    viewBox = null,
}) {
    const { locale, t } = useI18n();
    const draftList = useMemo(() => [...(draftEntity ? [draftEntity] : []), ...draftEntities], [draftEntities, draftEntity]);
    const layerMap = useMemo(() => new Map(content.layers.map(layer => [layer.id, layer])), [content.layers]);
    const entityMap = useMemo(() => new Map(content.entities.map(entity => [entity.id, entity])), [content.entities]);
    const blockMap = useMemo(() => new Map((content.blocks || []).map(block => [block.id, block])), [content.blocks]);
    const renderEntityMap = useMemo(() => new Map([...entityMap, ...draftList.map(entity => [entity.id, entity])]), [draftList, entityMap]);
    const assetMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const selectedQdimGripSeries = useMemo(() => {
        const seriesIds = new Set(content.entities.flatMap(entity => (
            selected.has(entity.id) && entity.type === 'linearDimension' && entity.seriesId
                ? [entity.seriesId]
                : []
        )));
        return new Set([...seriesIds].filter(seriesId => content.entities
            .filter(entity => entity.type === 'linearDimension' && entity.seriesId === seriesId)
            .every(entity => canEditEntity(content, entity))));
    }, [content, selected]);
    const previewSelected = useMemo(() => previewSelectedIds ? new Set(previewSelectedIds) : null, [previewSelectedIds]);
    const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const hitOnly = useMemo(() => new Set(hitOnlyIds), [hitOnlyIds]);
    const hiddenLayers = useMemo(() => new Set(hiddenLayerIds), [hiddenLayerIds]);
    const circleGeometryCache = useMemo(() => new WeakMap(), [
        content.entities,
        draftList,
        viewBox?.x,
        viewBox?.y,
        viewBox?.width,
        viewBox?.height,
    ]);

    return (
        <g className="drawing-scene">
            {content.entities.map(entity => {
                const renderMode = getDrawingEntityRenderMode(entity.id, hidden, hitOnly);
                if (renderMode === 'hidden') return null;
                const visualHidden = renderMode === 'hit-only';
                const layer = layerMap.get(entity.layerId);
                if (!layer?.visible || hiddenLayers.has(entity.layerId)) return null;
                return (
                    <DrawingEntity
                        key={entity.id}
                        entity={entity}
                        sources={getDrawingEntityDependencyIds(entity).map(id => entityMap.get(id)).filter(Boolean)}
                        asset={entity.assetId ? assetMap.get(entity.assetId) : null}
                        appearance={getEntityAppearance(content, entity)}
                        selected={previewSelected ? previewSelected.has(entity.id) : selected.has(entity.id)}
                        highlighted={highlighted.has(entity.id)}
                        editable={canEditEntity(content, entity)}
                        interactive={interactive}
                        dimensionTextSize={dimensionTextSize}
                        showGrips={showGrips && (
                            selected.has(entity.id)
                            || selectedQdimGripSeries.has(entity.seriesId)
                        )}
                        gripSize={gripSize}
                        locale={locale}
                        t={t}
                        viewBox={viewBox}
                        circleGeometryCache={circleGeometryCache}
                        block={entity.blockId ? blockMap.get(entity.blockId) : null}
                        blockMap={blockMap}
                        assetMap={assetMap}
                        layerMap={layerMap}
                        hiddenLayers={hiddenLayers}
                        visualHidden={visualHidden}
                        textStyles={content.textStyles}
                    />
                );
            })}
            {draftList.map((entity, index) => (
                <DrawingEntity
                    key={entity.id || `draft-${index}`}
                    entity={entity}
                    sources={getDrawingEntityDependencyIds(entity).map(id => renderEntityMap.get(id)).filter(Boolean)}
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
                    hiddenLayers={hiddenLayers}
                    textStyles={content.textStyles}
                />
            ))}
        </g>
    );
}

function DrawingEntity({
    entity,
    sources = [],
    asset = null,
    appearance,
    selected = false,
    highlighted = false,
    editable = false,
    interactive,
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
    textStyles = [],
}) {
    const isTrimPreview = draft && entity.previewMode === 'trim';
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
    if (entity.type === 'line') {
        shape = <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...shapeProps} />;
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
    } else if (entity.type === 'image') {
        const rect = normalizedRect(entity);
        shape = asset?.link ? (
            <image
                href={asset.link}
                {...rect}
                opacity={(entity.opacity ?? 0.55) * appearanceOpacity}
                preserveAspectRatio="none"
                transform={rectTransform(entity)}
            />
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
        shape = <BlockReferenceGeometry
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
        />;
    }

    if (!shape) return null;
    return (
        <g {...groupProps}>
            {!visualHidden && shape}
            {interactive && <HitShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />}
            {!visualHidden && selected && <SelectionShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />}
            {!visualHidden && highlighted && <SelectionShape entity={entity} sources={sources} viewBox={viewBox} circleGeometryCache={circleGeometryCache} preview />}
            {!visualHidden && editable && showGrips && <GripHandles entity={entity} sources={sources} size={gripSize} t={t} />}
        </g>
    );
}

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
}) {
    if (!block || visitedBlockIds.has(block.id)) return null;
    const childMap = new Map(block.entities.map(entity => [entity.id, entity]));
    const nextVisited = new Set(visitedBlockIds);
    nextVisited.add(block.id);
    return (
        <g transform={affineMatrixToSvg(reference.transform)}>
            {block.entities.map(entity => {
                const layer = layerMap.get(entity.layerId);
                if (!layer?.visible || hiddenLayers.has(entity.layerId)) return null;
                return (
                    <DrawingEntity
                        key={entity.id}
                        entity={entity}
                        sources={getDrawingEntityDependencyIds(entity).map(id => childMap.get(id)).filter(Boolean)}
                        asset={entity.assetId ? assetMap.get(entity.assetId) : null}
                        appearance={getEntityAppearance({ layers: [...layerMap.values()] }, entity)}
                        interactive={false}
                        editable={false}
                        dimensionTextSize={dimensionTextSize}
                        gripSize={0}
                        locale={locale}
                        t={t}
                        viewBox={viewBox}
                        circleGeometryCache={circleGeometryCache}
                        block={entity.blockId ? blockMap.get(entity.blockId) : null}
                        blockMap={blockMap}
                        assetMap={assetMap}
                        layerMap={layerMap}
                        hiddenLayers={hiddenLayers}
                        nested
                        visitedBlockIds={nextVisited}
                        textStyles={textStyles}
                    />
                );
            })}
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
    const label = gripName(grip.id, t);
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

function gripName(id, t) {
    const directKey = ({
        start: 'grip.start',
        end: 'grip.end',
        'top-left': 'grip.topLeft',
        'top-right': 'grip.topRight',
        'bottom-right': 'grip.bottomRight',
        'bottom-left': 'grip.bottomLeft',
        center: 'grip.center',
        radius: 'grip.radius',
        'dimension-position': 'grip.dimensionPosition',
        [DRAWING_QDIM_GRIP_IDS.offset]: 'grip.qdimOffset',
        [DRAWING_QDIM_GRIP_IDS.spacing]: 'grip.qdimSpacing',
    })[id];
    if (directKey) return t(directKey);
    const vertex = /^vertex-(\d+)/.exec(id);
    if (vertex) return t('grip.vertex', { number: Number(vertex[1]) + 1 });
    const part = /^part-(\d+)/.exec(id);
    if (part) return t('grip.part', { number: Number(part[1]) + 1 });
    return t('grip.point');
}

function rectTransform(entity) {
    const rotation = Number(entity.rotation) || 0;
    const mirrored = Boolean(entity.mirrored);
    if (!rotation && !mirrored) return undefined;
    const centerX = entity.x + entity.width / 2;
    const centerY = entity.y + entity.height / 2;
    return `translate(${centerX} ${centerY}) rotate(${rotation}) scale(1 ${mirrored ? -1 : 1}) translate(${-centerX} ${-centerY})`;
}

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
            ...(part.lineWeight ? { strokeWidth: partWeight } : {}),
            ...(part.lineType ? lineTypeStrokeProps(part.lineType, partWeight) : {}),
            ...(Object.hasOwn(part, 'transparency') ? { opacity: transparencyToOpacity(part.transparency) } : {}),
        } : shapeProps;
        if (part.type === 'line') return <line key={index} x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} {...partProps} />;
        if (part.type === 'rectangle') return <RectangleGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'circle') return circleViewportShape(part, viewBox, partProps, index, circleGeometryCache);
        if (part.type === 'polygon') return <polygon key={index} points={polygonPoints(part)} {...partProps} />;
        if (part.type === 'arc') return <path key={index} d={getArcPath(part)} {...partProps} />;
        if (part.type === 'ellipse') return <EllipseGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'spline') return <SplineGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'polyline') return <PolylineGeometry key={index} entity={part} shapeProps={partProps} usePartAppearance={usePartAppearance} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />;
        return null;
    });
}

function DrawingTextShape({ entity, color, opacity, textStyles }) {
    const clipId = `drawing-text-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const layout = getDrawingTextLayout(entity, { color, styles: textStyles });
    return (
        <g transform={rectTransform(entity)} opacity={opacity} pointerEvents="none">
            <defs>
                <clipPath id={clipId}>
                    <rect x={layout.x} y={layout.y} width={layout.width} height={layout.height} />
                </clipPath>
            </defs>
            <text
                clipPath={`url(#${clipId})`}
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
                    >
                        {line.spans.length ? line.spans.map((span, spanIndex) => (
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
                        )) : '\u00a0'}
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
    if (entity.type === 'line') return <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...hitProps} />;
    if (entity.type === 'polyline') return <PolylineGeometry entity={entity} shapeProps={hitProps} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />;
    if (entity.type === 'rectangle') return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        ? <path d={getRectangleOutlinePath(entity)} {...hitProps} transform={rectTransform(entity)} />
        : <rect {...normalizedRect(entity)} {...hitProps} transform={rectTransform(entity)} />;
    if (entity.type === 'image' || entity.type === 'text') return <rect {...normalizedRect(entity)} {...hitProps} transform={rectTransform(entity)} pointerEvents="all" />;
    if (entity.type === 'circle') return circleViewportShape(entity, viewBox, hitProps, undefined, circleGeometryCache);
    if (entity.type === 'polygon') return <polygon points={polygonPoints(entity)} {...hitProps} />;
    if (entity.type === 'arc') return <path d={getArcPath(entity)} {...hitProps} />;
    if (entity.type === 'ellipse') return <EllipseGeometry entity={entity} shapeProps={hitProps} />;
    if (entity.type === 'spline') return <SplineGeometry entity={entity} shapeProps={hitProps} />;
    if (entity.type === 'hatch') return <path d={hatchPath(entity)} {...hitProps} pointerEvents="all" />;
    if (entity.type === 'blockReference') {
        const bounds = getDrawingBlockReferenceBounds(entity);
        return bounds ? <rect {...rectFromBounds(bounds)} {...hitProps} pointerEvents="all" /> : null;
    }
    const geometry = getDimensionGeometry(entity, sources);
    if (!geometry) return null;
    return <DimensionPrimitiveGeometry geometry={geometry} lineProps={hitProps} includeTicks={false} />;
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
    if (entity.type === 'line') return <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...props} />;
    if (entity.type === 'polyline') return <PolylineGeometry entity={entity} shapeProps={props} viewBox={viewBox} circleGeometryCache={circleGeometryCache} />;
    if (entity.type === 'rectangle') return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        ? <path d={getRectangleOutlinePath(entity)} {...props} transform={rectTransform(entity)} />
        : <rect {...normalizedRect(entity)} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'image' || entity.type === 'text') return <rect {...normalizedRect(entity)} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'circle') return circleViewportShape(entity, viewBox, props, undefined, circleGeometryCache);
    if (entity.type === 'polygon') return <polygon points={polygonPoints(entity)} {...props} />;
    if (entity.type === 'arc') return <path d={getArcPath(entity)} {...props} />;
    if (entity.type === 'ellipse') return <EllipseGeometry entity={entity} shapeProps={props} />;
    if (entity.type === 'spline') return <SplineGeometry entity={entity} shapeProps={props} />;
    if (entity.type === 'hatch') return <path d={hatchPath(entity)} {...props} />;
    if (entity.type === 'blockReference') {
        const bounds = getDrawingBlockReferenceBounds(entity);
        return bounds ? <rect {...rectFromBounds(bounds)} {...props} /> : null;
    }
    const geometry = getDimensionGeometry(entity, sources);
    if (!geometry) return null;
    return <DimensionPrimitiveGeometry geometry={geometry} lineProps={props} includeTicks={false} />;
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
    const solid = String(pattern.name || 'solid').toLowerCase() === 'solid';
    const spacing = Math.max(0.02, Math.abs(Number(pattern.spacing) || Number(pattern.scale) || 0.25));
    const fill = solid ? shapeProps.stroke : `url(#${patternId})`;
    return (
        <>
            {!solid && (
                <defs>
                    <pattern
                        id={patternId}
                        patternUnits="userSpaceOnUse"
                        width={spacing}
                        height={spacing}
                        patternTransform={`rotate(${Number(pattern.angle) || 0})`}
                    >
                        <line x1="0" y1="0" x2={spacing} y2="0" stroke={shapeProps.stroke} strokeWidth={shapeProps.strokeWidth} vectorEffect="non-scaling-stroke" />
                    </pattern>
                </defs>
            )}
            <path
                d={d}
                {...shapeProps}
                fill={fill}
                fillRule="evenodd"
                fillOpacity={solid ? 0.22 : 0.72}
            />
        </>
    );
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
    if (!Array.isArray(parts) || !parts.length) return '';
    let d = '';
    parts.forEach((part, index) => {
        const start = curveStart(part);
        const end = curveEnd(part);
        if (!start || !end) return;
        if (!d || index === 0) d += `M ${start.x} ${start.y} `;
        if (part.type === 'line') d += `L ${end.x} ${end.y} `;
        else if (part.type === 'arc') {
            const sweep = angularSweep(part);
            d += `A ${Math.abs(part.r)} ${Math.abs(part.r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y} `;
        } else if (part.type === 'ellipse') {
            const sweep = angularSweep(part);
            d += `A ${Math.abs(part.rx)} ${Math.abs(part.ry)} ${Number(part.rotation) || 0} ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end.x} ${end.y} `;
        } else if (part.type === 'spline' && part.controlPoints?.length === 4) {
            const points = part.controlPoints;
            d += `C ${points[1].x} ${points[1].y} ${points[2].x} ${points[2].y} ${points[3].x} ${points[3].y} `;
        }
    });
    return `${d}${closed ? 'Z' : ''}`.trim();
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
    const geometry = getDimensionGeometry(entity, sources);
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
            <DimensionPrimitiveGeometry geometry={geometry} lineProps={lineProps} tickSize={textSize * 0.7} />
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

function DimensionPrimitiveGeometry({ geometry, lineProps, includeTicks = true, tickSize = 0.2 }) {
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
            {includeTicks && (geometry.ticks || []).map((tick, index) => (
                <DimensionTick
                    key={`tick-${index}`}
                    point={tick.point}
                    angle={tick.angle}
                    lineProps={lineProps}
                    size={tickSize}
                />
            ))}
        </>
    );
}

function DimensionTick({ point, angle, lineProps, size }) {
    const tickAngle = angle + Math.PI / 4;
    const dx = Math.cos(tickAngle) * size / 2;
    const dy = Math.sin(tickAngle) * size / 2;
    return (
        <line
            x1={point.x - dx} y1={point.y - dy} x2={point.x + dx} y2={point.y + dy}
            {...lineProps}
        />
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
    return 1 - Math.max(0, Math.min(90, value)) / 100;
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
