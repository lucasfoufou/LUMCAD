import React, { forwardRef, useMemo } from 'react';

import DrawingScene from '~components/drawing/DrawingScene';
import { getDrawingLayoutDimensionTextSize, getDrawingPaperSize } from '~utils/drawingLayouts';

const DrawingLayoutPage = forwardRef(function DrawingLayoutPage({
    assets,
    canvasViewBox = null,
    className = '',
    content,
    draftViewport = null,
    emptyLabel = '',
    interactive = false,
    layout,
    overlay = null,
    selectedViewportId = null,
    ...svgProps
}, forwardedRef) {
    const paper = getDrawingPaperSize(layout.format, layout.orientation);
    const printableContent = useMemo(() => ({
        ...content,
        entities: content.entities.filter(entity => entity.type !== 'image' || entity.includeInPdf),
    }), [content]);
    const handleSize = Math.max(2.5, (canvasViewBox?.width || paper.width) / 150);
    const dimensionPaperTextSize = getDrawingLayoutDimensionTextSize(paper);

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
            <rect className="drawing-layout-paper" x="0" y="0" width={paper.width} height={paper.height} />
            {layout.viewports.map(viewport => (
                <DrawingLayoutViewport
                    key={viewport.id}
                    assets={assets}
                    content={printableContent}
                    interactive={interactive}
                    selected={selectedViewportId === viewport.id}
                    viewport={viewport}
                    handleSize={handleSize}
                    dimensionPaperTextSize={dimensionPaperTextSize}
                />
            ))}
            {interactive && layout.viewports.length === 0 && emptyLabel && (
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

function DrawingLayoutViewport({ assets, content, dimensionPaperTextSize, handleSize, interactive, selected, viewport }) {
    const viewBox = viewport.modelViewBox;
    const dimensionTextSize = Math.max(0.0001, viewBox.width / viewport.width * dimensionPaperTextSize);
    return (
        <g className={['drawing-layout-viewport', selected && 'is-selected'].filter(Boolean).join(' ')}>
            <svg
                x={viewport.x}
                y={viewport.y}
                width={viewport.width}
                height={viewport.height}
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                preserveAspectRatio="xMidYMid meet"
                overflow="hidden"
            >
                <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="white" />
                <DrawingScene
                    content={content}
                    assets={assets}
                    dimensionTextSize={dimensionTextSize}
                    hiddenLayerIds={viewport.hiddenLayerIds}
                    viewBox={viewBox}
                />
            </svg>
            {interactive && (
                <>
                    <rect
                        className="drawing-layout-viewport-frame"
                        data-layout-viewport-id={viewport.id}
                        x={viewport.x}
                        y={viewport.y}
                        width={viewport.width}
                        height={viewport.height}
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
    return handles.map(([id, x, y]) => (
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
    ));
}

export default DrawingLayoutPage;
