import React, { forwardRef, useId, useMemo } from 'react';

import { inverseAffineViewBox, rotationAffineMatrix } from '~utils/drawingBlocks';
import DrawingScene from '~components/drawing/DrawingScene';
import {
    applyDrawingViewportDisplaySettings,
    getDrawingLayoutDimensionTextSize,
    getDrawingPaperSize,
    getDrawingPrintableArea,
    getDrawingViewportClipPoints,
} from '~utils/drawingLayouts';
import { getDrawingBounds } from '~utils/drawingGeometry';
import {
    applyDrawingPlotStyle,
    normalizeDrawingPlotSettings,
    resolveDrawingPlotTransform,
} from '~utils/drawingPlot';

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
    plotSettings = null,
    selectedPaperEntityId = null,
    selectedViewportId = null,
    ...svgProps
}, forwardedRef) {
    const paper = getDrawingPaperSize(layout);
    const printableArea = getDrawingPrintableArea(layout);
    const normalizedPlotSettings = plotSettings ? normalizeDrawingPlotSettings(plotSettings) : null;
    const plotTransform = useMemo(
        () => resolveLayoutPlotTransform(layout, paper, printableArea, normalizedPlotSettings, content),
        [content, layout, normalizedPlotSettings, paper, printableArea],
    );
    const printableClipId = `layout-printable-${useId().replace(/:/g, '')}`;
    const printableContent = useMemo(() => ({
        ...content,
        entities: content.entities.filter(entity => entity.type !== 'image' || entity.includeInPdf),
    }), [content]);
    const paperContent = useMemo(() => ({
        ...content,
        entities: Array.isArray(layout.paperEntities) ? layout.paperEntities : [],
    }), [content, layout.paperEntities]);
    const plottedPaperContent = useMemo(
        () => applyDrawingPlotStyle(paperContent, normalizedPlotSettings?.style),
        [normalizedPlotSettings?.style, paperContent],
    );
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
                <g
                transform={plotTransform
                    ? `matrix(${plotTransform.matrix.a} ${plotTransform.matrix.b} ${plotTransform.matrix.c} ${plotTransform.matrix.d} ${plotTransform.matrix.e} ${plotTransform.matrix.f})`
                    : undefined}
                >
                {renderedViewports.map(viewport => (
                    <DrawingLayoutViewport
                        key={viewport.id}
                        assets={assets}
                        content={printableContent}
                        interactive={interactive}
                        plotStyle={normalizedPlotSettings?.style}
                        selected={!maximizedViewportId && selectedViewportId === viewport.id}
                        viewport={viewport}
                        handleSize={handleSize}
                    />
                ))}
                {!maximizedViewportId && plottedPaperContent.entities.length > 0 && (
                    <g className="drawing-layout-paper-annotations">
                        <DrawingScene
                            assets={assets}
                            content={plottedPaperContent}
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

function DrawingLayoutViewport({ assets, content, handleSize, interactive, plotStyle, selected, viewport }) {
    const viewBox = viewport.modelViewBox;
    const viewportClipId = `layout-viewport-${useId().replace(/:/g, '')}`;
    const clipPoints = getDrawingViewportClipPoints(viewport);
    const clipPointString = clipPoints.map(point => `${point.x},${point.y}`).join(' ');
    const displayContent = useMemo(
        () => applyDrawingPlotStyle(applyDrawingViewportDisplaySettings(content, viewport), plotStyle),
        [content, plotStyle, viewport],
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
                            viewBox={inverseAffineViewBox(viewBox, rotationAffineMatrix(Number(viewport.viewRotation) || 0, { x: centerX, y: centerY }))}
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

function resolveLayoutPlotTransform(layout, paper, printableArea, settings, content) {
    if (!settings || settings.area.mode === 'layout') return null;
    const source = settings.area.mode === 'window'
        ? settings.area.window
        : getLayoutContentBounds(layout, content, paper);
    return resolveDrawingPlotTransform(source, printableArea, settings.scale, { sourceUnit: 'mm' });
}

function getLayoutContentBounds(layout, content, paper) {
    const rectangles = (layout.viewports || []).map(viewport => ({
        minX: viewport.x,
        minY: viewport.y,
        maxX: viewport.x + viewport.width,
        maxY: viewport.y + viewport.height,
    }));
    if (layout.paperEntities?.length) {
        const bounds = getDrawingBounds({
            ...content,
            entities: layout.paperEntities,
        }, { printableOnly: true });
        if ([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) rectangles.push(bounds);
    }
    if (!rectangles.length) return { x: 0, y: 0, width: paper.width, height: paper.height };
    const minX = Math.min(...rectangles.map(bounds => bounds.minX));
    const minY = Math.min(...rectangles.map(bounds => bounds.minY));
    const maxX = Math.max(...rectangles.map(bounds => bounds.maxX));
    const maxY = Math.max(...rectangles.map(bounds => bounds.maxY));
    return {
        x: Math.max(0, minX),
        y: Math.max(0, minY),
        width: Math.max(1e-9, Math.min(paper.width, maxX) - Math.max(0, minX)),
        height: Math.max(1e-9, Math.min(paper.height, maxY) - Math.max(0, minY)),
    };
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
