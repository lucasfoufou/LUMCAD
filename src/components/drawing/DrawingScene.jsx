import React, { useId, useMemo } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import {
    formatDrawingLength,
    getDimensionGeometry,
    getArcPath,
    getRectangleOutlinePath,
    getRegularPolygonVertices,
} from '~utils/drawingGeometry';
import { getEntityGrips } from '~utils/drawingSelection';
import { canEditEntity, getEntityAppearance } from '~utils/drawingDocument';
import { getDrawingTextLayout } from '~utils/drawingText';

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
    hiddenLayerIds = [],
}) {
    const { locale, t } = useI18n();
    const draftList = useMemo(() => [...(draftEntity ? [draftEntity] : []), ...draftEntities], [draftEntities, draftEntity]);
    const layerMap = useMemo(() => new Map(content.layers.map(layer => [layer.id, layer])), [content.layers]);
    const entityMap = useMemo(() => new Map(content.entities.map(entity => [entity.id, entity])), [content.entities]);
    const renderEntityMap = useMemo(() => new Map([...entityMap, ...draftList.map(entity => [entity.id, entity])]), [draftList, entityMap]);
    const assetMap = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
    const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
    const previewSelected = useMemo(() => previewSelectedIds ? new Set(previewSelectedIds) : null, [previewSelectedIds]);
    const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
    const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);
    const hiddenLayers = useMemo(() => new Set(hiddenLayerIds), [hiddenLayerIds]);

    return (
        <g className="drawing-scene">
            {content.entities.map(entity => {
                if (hidden.has(entity.id)) return null;
                const layer = layerMap.get(entity.layerId);
                if (!layer?.visible || hiddenLayers.has(entity.layerId)) return null;
                return (
                    <DrawingEntity
                        key={entity.id}
                        entity={entity}
                        source={entity.sourceId ? entityMap.get(entity.sourceId) : null}
                        asset={entity.assetId ? assetMap.get(entity.assetId) : null}
                        appearance={getEntityAppearance(content, entity)}
                        selected={previewSelected ? previewSelected.has(entity.id) : selected.has(entity.id)}
                        highlighted={highlighted.has(entity.id)}
                        editable={canEditEntity(content, entity)}
                        interactive={interactive}
                        dimensionTextSize={dimensionTextSize}
                        showGrips={showGrips && selected.has(entity.id)}
                        gripSize={gripSize}
                        locale={locale}
                        t={t}
                    />
                );
            })}
            {draftList.map((entity, index) => (
                <DrawingEntity
                    key={entity.id || `draft-${index}`}
                    entity={entity}
                    source={entity.sourceId ? renderEntityMap.get(entity.sourceId) : null}
                    asset={entity.assetId ? assetMap.get(entity.assetId) : null}
                    appearance={getEntityAppearance(content, entity)}
                    interactive={false}
                    draft
                    selected={entity.previewMode === 'copy'}
                    dimensionTextSize={dimensionTextSize}
                    locale={locale}
                    t={t}
                />
            ))}
        </g>
    );
}

function DrawingEntity({
    entity,
    source = null,
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
}) {
    const isTrimPreview = draft && entity.previewMode === 'trim';
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
        opacity: isTrimPreview ? 0.92 : undefined,
    };
    const groupProps = {
        'data-entity-id': draft ? undefined : entity.id,
        className: ['drawing-entity', entity.locked && 'is-locked', editable && 'is-editable', selected && 'is-selected', highlighted && 'is-highlighted', draft && 'is-draft'].filter(Boolean).join(' '),
    };

    let shape = null;
    if (entity.type === 'line') {
        shape = <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...shapeProps} />;
    } else if (entity.type === 'polyline') {
        shape = <PolylineGeometry
            entity={entity}
            shapeProps={shapeProps}
            usePartAppearance={!draft && !entity.color && !entity.lineWeight && !entity.lineWidth && !entity.lineType}
        />;
    } else if (entity.type === 'rectangle') {
        shape = <RectangleGeometry entity={entity} shapeProps={shapeProps} />;
    } else if (entity.type === 'circle') {
        shape = <circle cx={entity.cx} cy={entity.cy} r={Math.abs(entity.r)} {...shapeProps} />;
    } else if (entity.type === 'polygon') {
        shape = <polygon points={polygonPoints(entity)} {...shapeProps} />;
    } else if (entity.type === 'arc') {
        shape = <path d={getArcPath(entity)} {...shapeProps} />;
    } else if (entity.type === 'image') {
        const rect = normalizedRect(entity);
        shape = asset?.link ? (
            <image
                href={asset.link}
                {...rect}
                opacity={entity.opacity ?? 0.55}
                preserveAspectRatio="none"
                transform={rectTransform(entity)}
            />
        ) : <rect {...rect} {...shapeProps} strokeDasharray="4 4" transform={rectTransform(entity)} />;
    } else if (entity.type === 'text') {
        const rect = normalizedRect(entity);
        shape = draft && entity.previewMode !== 'copy' ? (
            <rect {...rect} {...shapeProps} transform={rectTransform(entity)} />
        ) : <DrawingTextShape entity={entity} color={appearance.color} opacity={entity.previewMode === 'copy' ? 0.72 : undefined} />;
    } else if (entity.type === 'linearDimension' || entity.type === 'radialDimension') {
        shape = <DimensionShape entity={entity} source={source} appearance={appearance} textSize={dimensionTextSize} locale={locale} />;
    }

    if (!shape) return null;
    return (
        <g {...groupProps}>
            {shape}
            {interactive && <HitShape entity={entity} source={source} />}
            {selected && <SelectionShape entity={entity} source={source} />}
            {highlighted && <SelectionShape entity={entity} source={source} preview />}
            {selected && editable && showGrips && <GripHandles entity={entity} source={source} size={gripSize} t={t} />}
        </g>
    );
}

function GripHandles({ entity, source, size, t }) {
    const grips = getEntityGrips(entity, source);
    if (!grips.length) return null;
    return (
        <g className="drawing-grips">
            {grips.map(grip => (
                <rect
                    key={grip.id}
                    className="drawing-grip"
                    data-entity-id={entity.id}
                    data-grip-id={grip.id}
                    x={grip.x - size / 2}
                    y={grip.y - size / 2}
                    width={size}
                    height={size}
                    vectorEffect="non-scaling-stroke"
                    aria-label={t('canvas.grip', { name: gripName(grip.id, t) })}
                />
            ))}
        </g>
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

function polygonPoints(entity) {
    return getRegularPolygonVertices(entity).map(point => `${point.x},${point.y}`).join(' ');
}

function polylinePoints(entity) {
    return (entity.points || []).map(point => `${point.x},${point.y}`).join(' ');
}

function PolylineGeometry({ entity, shapeProps, usePartAppearance = false }) {
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
        } : shapeProps;
        if (part.type === 'line') return <line key={index} x1={part.x1} y1={part.y1} x2={part.x2} y2={part.y2} {...partProps} />;
        if (part.type === 'rectangle') return <RectangleGeometry key={index} entity={part} shapeProps={partProps} />;
        if (part.type === 'circle') return <circle key={index} cx={part.cx} cy={part.cy} r={Math.abs(part.r)} {...partProps} />;
        if (part.type === 'polygon') return <polygon key={index} points={polygonPoints(part)} {...partProps} />;
        if (part.type === 'arc') return <path key={index} d={getArcPath(part)} {...partProps} />;
        if (part.type === 'polyline') return <PolylineGeometry key={index} entity={part} shapeProps={partProps} usePartAppearance={usePartAppearance} />;
        return null;
    });
}

function DrawingTextShape({ entity, color, opacity }) {
    const clipId = `drawing-text-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const layout = getDrawingTextLayout(entity);
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
                fontFamily="SourceSans3, Arial, sans-serif"
                fontSize={layout.fontSize}
                textAnchor={layout.textAnchor}
            >
                {layout.lines.map((line, index) => (
                    <tspan
                        key={`${index}-${line}`}
                        x={layout.textX}
                        y={layout.firstBaseline + index * layout.lineHeight}
                    >
                        {line || '\u00a0'}
                    </tspan>
                ))}
            </text>
        </g>
    );
}

function HitShape({ entity, source }) {
    const hitProps = {
        stroke: 'transparent',
        strokeWidth: 12,
        vectorEffect: 'non-scaling-stroke',
        fill: 'none',
        pointerEvents: 'stroke',
    };
    if (entity.type === 'line') return <line x1={entity.x1} y1={entity.y1} x2={entity.x2} y2={entity.y2} {...hitProps} />;
    if (entity.type === 'polyline') return <PolylineGeometry entity={entity} shapeProps={hitProps} />;
    if (entity.type === 'rectangle') return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        ? <path d={getRectangleOutlinePath(entity)} {...hitProps} transform={rectTransform(entity)} />
        : <rect {...normalizedRect(entity)} {...hitProps} transform={rectTransform(entity)} />;
    if (entity.type === 'image' || entity.type === 'text') return <rect {...normalizedRect(entity)} {...hitProps} transform={rectTransform(entity)} pointerEvents="all" />;
    if (entity.type === 'circle') return <circle cx={entity.cx} cy={entity.cy} r={Math.abs(entity.r)} {...hitProps} />;
    if (entity.type === 'polygon') return <polygon points={polygonPoints(entity)} {...hitProps} />;
    if (entity.type === 'arc') return <path d={getArcPath(entity)} {...hitProps} />;
    const geometry = getDimensionGeometry(entity, source);
    if (!geometry) return null;
    if (geometry.kind === 'linear') return <line x1={geometry.first.x} y1={geometry.first.y} x2={geometry.second.x} y2={geometry.second.y} {...hitProps} />;
    return <line x1={geometry.center.x} y1={geometry.center.y} x2={geometry.text.x} y2={geometry.text.y} {...hitProps} />;
}

function SelectionShape({ entity, source, preview = false }) {
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
    if (entity.type === 'polyline') return <PolylineGeometry entity={entity} shapeProps={props} />;
    if (entity.type === 'rectangle') return entity.cornerStyle === 'chamfer' || entity.cornerStyle === 'fillet'
        ? <path d={getRectangleOutlinePath(entity)} {...props} transform={rectTransform(entity)} />
        : <rect {...normalizedRect(entity)} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'image' || entity.type === 'text') return <rect {...normalizedRect(entity)} {...props} transform={rectTransform(entity)} />;
    if (entity.type === 'circle') return <circle cx={entity.cx} cy={entity.cy} r={Math.abs(entity.r)} {...props} />;
    if (entity.type === 'polygon') return <polygon points={polygonPoints(entity)} {...props} />;
    if (entity.type === 'arc') return <path d={getArcPath(entity)} {...props} />;
    const geometry = getDimensionGeometry(entity, source);
    if (!geometry) return null;
    const points = geometry.points.map(point => `${point.x},${point.y}`).join(' ');
    return <polyline points={points} {...props} />;
}

function DimensionShape({ entity, source, appearance, textSize, locale }) {
    const geometry = getDimensionGeometry(entity, source);
    if (!geometry) return null;
    const color = appearance.color;
    const lineProps = {
        stroke: color,
        strokeWidth: appearance.lineWeight,
        vectorEffect: 'non-scaling-stroke',
        fill: 'none',
        ...lineTypeStrokeProps(appearance.lineType, appearance.lineWeight),
    };

    if (geometry.kind === 'linear') {
        const rawDegrees = geometry.angle * 180 / Math.PI;
        const degrees = rawDegrees > 90 || rawDegrees < -90 ? rawDegrees + 180 : rawDegrees;
        return (
            <g className="drawing-dimension">
                <line x1={geometry.sourceFirst.x} y1={geometry.sourceFirst.y} x2={geometry.first.x} y2={geometry.first.y} {...lineProps} />
                <line x1={geometry.sourceSecond.x} y1={geometry.sourceSecond.y} x2={geometry.second.x} y2={geometry.second.y} {...lineProps} />
                <line x1={geometry.first.x} y1={geometry.first.y} x2={geometry.second.x} y2={geometry.second.y} {...lineProps} />
                <DimensionTick point={geometry.first} angle={geometry.angle} lineProps={lineProps} size={textSize * 0.7} />
                <DimensionTick point={geometry.second} angle={geometry.angle} lineProps={lineProps} size={textSize * 0.7} />
                <DimensionText point={geometry.text} angle={degrees} color={color} textSize={textSize}>
                    {formatDrawingLength(geometry.value, 4, locale)}
                </DimensionText>
            </g>
        );
    }

    return (
        <g className="drawing-dimension">
            <line x1={geometry.center.x} y1={geometry.center.y} x2={geometry.text.x} y2={geometry.text.y} {...lineProps} />
            <DimensionTick point={geometry.edge} angle={geometry.angle} lineProps={lineProps} size={textSize * 0.7} />
            <DimensionText point={geometry.text} angle={0} color={color} textSize={textSize} anchor="start">
                {geometry.mode === 'diameter' ? 'Ø ' : 'R '}{formatDrawingLength(geometry.value, 4, locale)}
            </DimensionText>
        </g>
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

function DimensionText({ point, angle, color, textSize, anchor = 'middle', children }) {
    return (
        <text
            x={point.x}
            y={point.y}
            dy="-0.35em"
            textAnchor={anchor}
            transform={`rotate(${angle} ${point.x} ${point.y})`}
            fill={color}
            fontSize={textSize}
            fontFamily="SourceSans3, Arial, sans-serif"
            paintOrder="stroke"
            stroke="white"
            strokeWidth={textSize * 0.3}
            strokeLinejoin="round"
        >
            {children}
        </text>
    );
}
