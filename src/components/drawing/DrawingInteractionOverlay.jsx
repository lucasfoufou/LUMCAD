import React, { useRef } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { getArrayControlGeometry } from '~utils/drawingCompoundOperations';

export default function DrawingInteractionOverlay({
    selectionWindow,
    hoverSnap,
    trackingGuides = [],
    trackingAnchors = [],
    markerSize,
    viewBox,
    arrayOperation = null,
    alignOperation = null,
    referenceOperation = null,
    referencePoint = null,
    onArrayHandleChange,
}) {
    const { t } = useI18n();
    const guideLines = trackingGuides.map(guide => ({ guide, endpoints: trackingGuideEndpoints(guide, viewBox) }));
    return (
        <>
            {selectionWindow && (
                <rect
                    className={`drawing-selection-window is-${selectionWindow.mode}`}
                    x={selectionWindow.minX}
                    y={selectionWindow.minY}
                    width={selectionWindow.maxX - selectionWindow.minX}
                    height={selectionWindow.maxY - selectionWindow.minY}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
            )}
            {guideLines.map(({ guide, endpoints }, index) => (
                <line
                    key={`${guide.anchor.x}-${guide.anchor.y}-${guide.angle}-${index}`}
                    className="drawing-tracking-guide"
                    x1={endpoints.first.x}
                    y1={endpoints.first.y}
                    x2={endpoints.second.x}
                    y2={endpoints.second.y}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                />
            ))}
            {trackingAnchors.filter(anchor => Number.isFinite(anchor?.x) && Number.isFinite(anchor?.y)).map((anchor, index) => (
                <g
                    key={`${anchor.x}-${anchor.y}-${index}`}
                    className={`drawing-tracking-anchor${anchor.temporary ? ' is-temporary' : ''}`}
                    pointerEvents="none"
                >
                    <line
                        x1={anchor.x - markerSize * 0.28}
                        y1={anchor.y - markerSize * 0.28}
                        x2={anchor.x + markerSize * 0.28}
                        y2={anchor.y + markerSize * 0.28}
                        vectorEffect="non-scaling-stroke"
                    />
                    <line
                        x1={anchor.x - markerSize * 0.28}
                        y1={anchor.y + markerSize * 0.28}
                        x2={anchor.x + markerSize * 0.28}
                        y2={anchor.y - markerSize * 0.28}
                        vectorEffect="non-scaling-stroke"
                    />
                </g>
            ))}
            {hoverSnap && (
                <g className={`drawing-snap-marker is-${hoverSnap.type}`} pointerEvents="none">
                    <circle cx={hoverSnap.x} cy={hoverSnap.y} r={markerSize * 0.35} fill="white" stroke="#f7941d" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    <line x1={hoverSnap.x - markerSize / 2} y1={hoverSnap.y} x2={hoverSnap.x + markerSize / 2} y2={hoverSnap.y} stroke="#f7941d" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <line x1={hoverSnap.x} y1={hoverSnap.y - markerSize / 2} x2={hoverSnap.x} y2={hoverSnap.y + markerSize / 2} stroke="#f7941d" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <text
                        x={hoverSnap.x + markerSize * 0.65}
                        y={hoverSnap.y - markerSize * 0.55}
                        fill="#f7941d"
                        fontSize={markerSize * 0.72}
                        fontFamily="SourceSans3, Arial, sans-serif"
                        paintOrder="stroke"
                        stroke="white"
                        strokeWidth={markerSize * 0.12}
                    >
                        {snapLabel(hoverSnap.type, t)}
                    </text>
                </g>
            )}
            <ArrayControls
                operation={arrayOperation}
                markerSize={markerSize}
                onChange={onArrayHandleChange}
                t={t}
            />
            <DrawingAlignControls operation={alignOperation} currentPoint={referencePoint} markerSize={markerSize} />
            <DrawingReferenceControls operation={referenceOperation} currentPoint={referencePoint} markerSize={markerSize} />
        </>
    );
}

export function DrawingAlignControls({ operation, currentPoint, markerSize }) {
    if (operation?.type !== 'align') return null;
    const pairs = (operation.pairs || []).map(pair => ({
        source: pair.source,
        destination: pair.destination,
    }));
    if (operation.stage?.startsWith('align-destination-') && operation.pendingSource && currentPoint) {
        pairs.push({ source: operation.pendingSource, destination: currentPoint, preview: true });
    }
    const sourcePreview = operation.stage?.startsWith('align-source-') && currentPoint
        ? currentPoint
        : null;
    if (!pairs.length && !sourcePreview) return null;
    return (
        <g className="drawing-reference-controls drawing-align-controls" pointerEvents="none">
            {pairs.map((pair, index) => (
                <g key={index} opacity={pair.preview ? 0.7 : 1}>
                    <line
                        className="drawing-reference-guide"
                        x1={pair.source.x}
                        y1={pair.source.y}
                        x2={pair.destination.x}
                        y2={pair.destination.y}
                        vectorEffect="non-scaling-stroke"
                    />
                    <AlignPoint point={pair.source} label={`S${index + 1}`} markerSize={markerSize} />
                    <AlignPoint point={pair.destination} label={`D${index + 1}`} markerSize={markerSize} />
                </g>
            ))}
            {sourcePreview && <AlignPoint point={sourcePreview} label={`S${pairs.length + 1}`} markerSize={markerSize} />}
        </g>
    );
}

function AlignPoint({ point, label, markerSize }) {
    return (
        <g>
            <circle className="drawing-reference-point" cx={point.x} cy={point.y} r={markerSize * 0.24} vectorEffect="non-scaling-stroke" />
            <text className="drawing-reference-label" x={point.x + markerSize * 0.42} y={point.y - markerSize * 0.36} fontSize={markerSize * 0.62}>
                {label}
            </text>
        </g>
    );
}

export function DrawingReferenceControls({ operation, currentPoint, markerSize }) {
    if (operation?.stage !== 'reference') return null;
    const committed = operation.referencePoints || [];
    const sourceTargetRotation = operation.type === 'rotate' && operation.referenceMode === 'sourceTarget';
    const pointLimit = operation.type === 'scale' || sourceTargetRotation ? 4 : 6;
    const points = currentPoint && committed.length < pointLimit
        ? [...committed, currentPoint]
        : committed;
    const groupSize = operation.type === 'scale' || sourceTargetRotation ? 2 : operation.type === 'rotate' ? 3 : 0;
    if (!groupSize || (!points.length && !operation.basePoint)) return null;
    const groups = [points.slice(0, groupSize), points.slice(groupSize, groupSize * 2)];
    return (
        <g className="drawing-reference-controls" pointerEvents="none">
            {operation.basePoint && (
                <g>
                    <circle className="drawing-reference-point" cx={operation.basePoint.x} cy={operation.basePoint.y} r={markerSize * 0.3} vectorEffect="non-scaling-stroke" />
                    <text className="drawing-reference-label" x={operation.basePoint.x + markerSize * 0.42} y={operation.basePoint.y - markerSize * 0.36} fontSize={markerSize * 0.62}>O</text>
                </g>
            )}
            {groups.flatMap((group, groupIndex) => group.slice(1).map((point, index) => (
                <line
                    key={`${groupIndex}-${index}`}
                    className="drawing-reference-guide"
                    x1={group[index].x}
                    y1={group[index].y}
                    x2={point.x}
                    y2={point.y}
                    vectorEffect="non-scaling-stroke"
                />
            )))}
            {points.map((point, index) => (
                <g key={index}>
                    <circle className="drawing-reference-point" cx={point.x} cy={point.y} r={markerSize * 0.24} vectorEffect="non-scaling-stroke" />
                    <text className="drawing-reference-label" x={point.x + markerSize * 0.42} y={point.y - markerSize * 0.36} fontSize={markerSize * 0.62}>
                        {'ABCDEF'[index]}
                    </text>
                </g>
            ))}
        </g>
    );
}

function ArrayControls({ operation, markerSize, onChange, t }) {
    const activeHandleRef = useRef(null);
    const geometry = getArrayControlGeometry(operation);
    if (!geometry) return null;
    const handleEvents = handle => ({
        onPointerDown: event => {
            event.preventDefault();
            event.stopPropagation();
            activeHandleRef.current = handle;
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: event => {
            if (activeHandleRef.current !== handle) return;
            event.preventDefault();
            event.stopPropagation();
            onChange?.(handle, event);
        },
        onPointerUp: event => {
            event.preventDefault();
            event.stopPropagation();
            activeHandleRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        },
        onPointerCancel: () => { activeHandleRef.current = null; },
    });
    const size = markerSize * 0.72;
    const xQuantityVisual = { x: geometry.xQuantity.x, y: geometry.xQuantity.y - markerSize * 1.25 };
    const yQuantityVisual = { x: geometry.yQuantity.x + markerSize * 1.25, y: geometry.yQuantity.y };
    return (
        <g className="drawing-array-controls">
            <line className="drawing-array-control-guide" x1={geometry.base.x} y1={geometry.base.y} x2={geometry.xQuantity.x} y2={geometry.xQuantity.y} />
            <line className="drawing-array-control-guide" x1={geometry.base.x} y1={geometry.base.y} x2={geometry.yQuantity.x} y2={geometry.yQuantity.y} />
            <line className="drawing-array-control-link" x1={geometry.xQuantity.x} y1={geometry.xQuantity.y} x2={xQuantityVisual.x} y2={xQuantityVisual.y} />
            <line className="drawing-array-control-link" x1={geometry.yQuantity.x} y1={geometry.yQuantity.y} x2={yQuantityVisual.x} y2={yQuantityVisual.y} />
            <ArraySquareHandle point={geometry.base} size={size} label={t('arrayControls.origin')} events={handleEvents('base')} />
            <ArrayCircleHandle point={geometry.xSpacing} size={size} label={t('arrayControls.xSpacing')} events={handleEvents('x-spacing')} />
            <ArrayCircleHandle point={geometry.ySpacing} size={size} label={t('arrayControls.ySpacing')} events={handleEvents('y-spacing')} axis="y" />
            <ArraySquareHandle point={xQuantityVisual} size={size} label={`X × ${geometry.columns}`} events={handleEvents('columns')} quantity />
            <ArraySquareHandle point={yQuantityVisual} size={size} label={`Y × ${geometry.rows}`} events={handleEvents('rows')} quantity axis="y" />
        </g>
    );
}

function ArraySquareHandle({ point, size, label, events, quantity = false, axis = 'x' }) {
    return (
        <g className="drawing-array-control-handle-group">
            <rect
                className={`drawing-array-handle${quantity ? ' is-quantity' : ' is-base'} is-${axis}`}
                x={point.x - size / 2}
                y={point.y - size / 2}
                width={size}
                height={size}
                vectorEffect="non-scaling-stroke"
                aria-label={label}
                {...events}
            />
            <ArrayHandleLabel point={point} size={size} label={label} />
        </g>
    );
}

function ArrayCircleHandle({ point, size, label, events, axis = 'x' }) {
    return (
        <g className="drawing-array-control-handle-group">
            <circle
                className={`drawing-array-handle is-spacing is-${axis}`}
                cx={point.x}
                cy={point.y}
                r={size / 2}
                vectorEffect="non-scaling-stroke"
                aria-label={label}
                {...events}
            />
            <ArrayHandleLabel point={point} size={size} label={label} />
        </g>
    );
}

function ArrayHandleLabel({ point, size, label }) {
    return (
        <text className="drawing-array-control-label" x={point.x + size * 0.8} y={point.y - size * 0.75} fontSize={size * 0.9}>
            {label}
        </text>
    );
}

function trackingGuideEndpoints(guide, viewBox) {
    const span = Math.hypot(viewBox.width, viewBox.height) * 2;
    const direction = { x: Math.cos(guide.angle), y: Math.sin(guide.angle) };
    return {
        first: { x: guide.anchor.x - direction.x * span, y: guide.anchor.y - direction.y * span },
        second: { x: guide.anchor.x + direction.x * span, y: guide.anchor.y + direction.y * span },
    };
}

function snapLabel(type, t) {
    const key = ({
        grid: 'snap.grid',
        endpoint: 'snap.endpoint',
        midpoint: 'snap.midpoint',
        center: 'snap.center',
        intersection: 'snap.intersection',
        nearest: 'snap.onObject',
        orthogonal: 'snap.orthogonal',
        polar: 'snap.polar',
        tracking: 'snap.tracking',
        trackingIntersection: 'snap.trackingIntersection',
        parallelTracking: 'snap.parallelTracking',
        perpendicularTracking: 'snap.perpendicularTracking',
        tangentTracking: 'snap.tangentTracking',
    })[type];
    return key ? t(key) : '';
}
