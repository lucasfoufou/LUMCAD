import React from 'react';

import DrawingCommandBar from '~components/drawing/DrawingCommandBar';
import DrawingLayoutCanvas from '~components/drawing/DrawingLayoutCanvas';
import DrawingLayoutSidebar from '~components/drawing/DrawingLayoutSidebar';
import DrawingLayoutToolbar from '~components/drawing/DrawingLayoutToolbar';

export default function DrawingLayoutEditor({
    activeTool,
    assets,
    canvasRef,
    command,
    commandBarRef,
    content,
    currentModelViewport,
    isExporting,
    layout,
    layoutCount,
    message,
    onChange,
    onDeleteLayout,
    onDeleteViewport,
    onExportAll,
    onExportCurrent,
    onOperationPoint,
    onScaleViewport,
    onSelectedViewportChange,
    onStatus,
    onToolChange,
    operation,
    selectedViewportId,
}) {
    return (
        <div className="drawing-layout-editor">
            <DrawingLayoutToolbar
                activeTool={activeTool}
                hasSelection={Boolean(selectedViewportId)}
                onDelete={onDeleteViewport}
                onFitPaper={() => canvasRef.current?.fitPaper()}
                onScale={onScaleViewport}
                onToolChange={onToolChange}
                onZoomIn={() => canvasRef.current?.zoomPaper(0.82)}
                onZoomOut={() => canvasRef.current?.zoomPaper(1.22)}
            />
            <main className="drawing-layout-stage">
                <DrawingLayoutCanvas
                    ref={canvasRef}
                    activeTool={activeTool}
                    assets={assets}
                    content={content}
                    currentModelViewport={currentModelViewport}
                    layout={layout}
                    onChange={onChange}
                    onOperationPoint={onOperationPoint}
                    onSelectedViewportChange={onSelectedViewportChange}
                    onStatus={onStatus}
                    operation={operation}
                    selectedViewportId={selectedViewportId}
                />
                <DrawingCommandBar ref={commandBarRef} {...command} message={message} />
            </main>
            <DrawingLayoutSidebar
                content={content}
                currentModelViewport={currentModelViewport}
                isExporting={isExporting}
                layout={layout}
                layoutCount={layoutCount}
                onChange={onChange}
                onDeleteLayout={onDeleteLayout}
                onExportAll={onExportAll}
                onExportCurrent={onExportCurrent}
                onSelectViewport={onSelectedViewportChange}
                onToolChange={onToolChange}
                selectedViewportId={selectedViewportId}
            />
        </div>
    );
}
