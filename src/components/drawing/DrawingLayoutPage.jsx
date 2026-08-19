import React, { forwardRef, useId, useMemo } from 'react';

import DrawingScene from '~components/drawing/DrawingScene';
import {
    applyDrawingViewportDisplaySettings,
    getDrawingLayoutDimensionTextSize,
    getDrawingPaperSize,
    getDrawingPrintableArea,
    getDrawingViewportClipPoints,
} from '~utils/drawingLayouts';

const DrawingLayoutPage = forwardRef(function DrawingLayoutPage({
    assets,
    canvasViewBox = null,
    className = '',
    content,
    draftViewport = null,
    editingPaperEntityId = null,
    emptyLabel = '',
    interactive = false,
    layout,
    maximizedViewportId = null,
    overlay = null,
    selectedPaperEntityId = null,
    selectedViewportId = null,
    ...svgProps
}, forwardedRef) {
    const paper = getDrawingPaperSize(layout);
    const printableArea = getDrawingPrintableArea(layout);
    const printableClipId = `layout-printable-${useId().replace(/:/g, '')}`;
    const printableContent = useMemo(() => ({
        ...content,
        entities: content.entities.filter(entity => entity.type !== 'image' || entity.includeInPdf),
    }), [content]);
    const paperContent = useMemo(() => ({
        ...content,
        entities: Array.isArray(layout.paperEntities) ? layout.paperEntities : [],
    }), [content, layout.paperEntities]);
    const handleSize = Math.max(2.5, (canvasViewBox?.width || paper.width) / 150);
    const renderedViewports = maximizedViewportId
        ? layout.viewports.filter(viewport => viewport.id === maximizedViewportId)
        : layout.viewports;

    return (
        <svg
            ref={forwardedRef}
            {...svgProps}
            className={['drawing-layout-page', interactive && 'is-interactive', className].filter(Boolean).join(' ')}
            viewBox={canvasViewBox
                ? `${canvasViewBox.x} ${canvasViewBox.y} ${canvasViewBox.width} ${canvasViewBox.height}`
                : `0 0 ${paper.width} ${paper.height}`}
            preserveAspectRatio="xMidYMid meet"
        >
            <defs>
                <clipPath id={printableClipId} clipPathUnits="userSpaceOnUse">
                    <rect {...printableArea} />
                </clipPath>
            </defs>
            <rect className="drawing-layout-paper" x="0" y="0" width={paper.width} height={paper.height} />
            <g clipPath={interactive ? undefined : `url(#${printableClipId})`}>
                {renderedViewports.map(viewport => (
                    <DrawingLayoutViewport
                        key={viewport.id}
                        assets={assets}
                        content={printableContent}
                        interactive={interactive}
                        selected={!maximizedViewportId && selectedViewportId === viewport.id}
                        viewport={viewport}
                        handleSize={handleSize}
                    />
                ))}
                {!maximizedViewportId && paperContent.entities.length > 0 && (
                    <g className="drawing-layout-paper-annotations">
                        <DrawingScene
                            assets={assets}
                            content={paperContent}
                            dimensionTextSize={3}
                            gripSize={handleSize}
                            hiddenIds={editingPaperEntityId ? [editingPaperEntityId] : []}
                            interactive={interactive}
                            selectedIds={selectedPaperEntityId ? [selectedPaperEntityId] : []}
                            showGrips={interactive}
                            viewBox={{ x: 0, y: 0, width: paper.width, height: paper.height }}
                        />
                    </g>
                )}
            </g>
            {interactive && !maximizedViewportId && (
                <rect
                    className="drawing-layout-printable-area"
                    x={printableArea.x}
                    y={printableArea.y}
                    width={printableArea.width}
                    height={printableArea.height}
                />
            )}
            {interactive && !maximizedViewportId && layout.viewports.length === 0 && emptyLabel && (
                <text
                    className="drawing-layout-empty-label"
                    x={paper.width / 2}
                    y={paper.height / 2}
                    textAnchor="middle"
                    fontSize={Math.max(6, paper.width / 48)}
                >
                    {emptyLabel}
                </text>
            )}
            {interactive && draftViewport && (
                <rect
                    className="drawing-layout-viewport-draft"
                    x={draftViewport.x}
                    y={draftViewport.y}
                    width={draftViewport.width}
                    height={draftViewport.height}
                />
            )}
            {overlay}
        </svg>
    );
});

function DrawingLayoutViewport({ assets, content, handleSize, interactive, selected, viewport }) {
    const viewBox = viewport.modelViewBox;
    const viewportClipId = `layout-viewport-${useId().replace(/:/g, '')}`;
    const clipPoints = getDrawingViewportClipPoints(viewport);
    const clipPointString = clipPoints.map(point => `${point.x},${point.y}`).join(' ');
    const displayContent = useMemo(
        () => applyDrawingViewportDisplaySettings(content, viewport),
        [content, viewport],
    );
    const dimensionTextSize = Math.max(
        0.0001,
        viewBox.width / viewport.width * getDrawingLayoutDimensionTextSize(null, viewport),
    );
    const centerX = viewBox.x + viewBox.width / 2;
    const centerY = viewBox.y + viewBox.height / 2;
    const visualStyle = viewport.visualSettings?.style || 'normal';
    return (
        <g className={['drawing-layout-viewport', selected && 'is-selected', viewport.locked && 'is-locked'].filter(Boolean).join(' ')}>
            <defs>
                <clipPath id={viewportClipId} clipPathUnits="userSpaceOnUse">
                    <polygon points={clipPointString} />
                </clipPath>
            </defs>
            <g clipPath={`url(#${viewportClipId})`}>
                <svg
                    x={viewport.x}
                    y={viewport.y}
                    width={viewport.width}
                    height={viewport.height}
                    viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                    preserveAspectRatio="xMidYMid meet"
                    overflow="hidden"
                >
                    <g
                        className={[
                            'drawing-layout-viewport-scene',
                            `is-visual-${visualStyle}`,
                            viewport.visualSettings?.showLineweights === false && 'is-without-lineweights',
                        ].filter(Boolean).join(' ')}
                        transform={`rotate(${Number(viewport.viewRotation) || 0} ${centerX} ${centerY})`}
                    >
                        <DrawingScene
                            content={displayContent}
                            assets={assets}
                            dimensionTextSize={dimensionTextSize}
                            hiddenLayerIds={viewport.hiddenLayerIds}
                            viewBox={viewBox}
                        />
                    </g>
                </svg>
            </g>
            {interactive && (
                <>
                    <polygon
                        className="drawing-layout-viewport-frame"
                        data-layout-viewport-id={viewport.id}
                        points={clipPointString}
                    />
                    {selected && <ViewportHandles viewport={viewport} size={handleSize} />}
                </>
            )}
        </g>
    );
}

function ViewportHandles({ viewport, size }) {
    const handles = [
        ['top-left', viewport.x, viewport.y],
        ['top-right', viewport.x + viewport.width, viewport.y],
        ['bottom-right', viewport.x + viewport.width, viewport.y + viewport.height],
        ['bottom-left', viewport.x, viewport.y + viewport.height],
    ];
    const clipPoints = viewport.clipBoundary ? getDrawingViewportClipPoints(viewport) : [];
    return (
        <>
            {handles.map(([id, x, y]) => (
                <rect
                    key={id}
                    className="drawing-layout-viewport-handle"
                    data-layout-viewport-id={viewport.id}
                    data-layout-viewport-handle={id}
                    x={x - size / 2}
                    y={y - size / 2}
                    width={size}
                    height={size}
                />
            ))}
            {clipPoints.map((point, index) => (
                <circle
                    key={`clip-${index}`}
                    className="drawing-layout-viewport-clip-handle"
                    data-layout-viewport-id={viewport.id}
                    data-layout-viewport-clip-index={index}
                    cx={point.x}
                    cy={point.y}
                    r={size * 0.62}
                />
            ))}
        </>
    );
}

export default DrawingLayoutPage;
