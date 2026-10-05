import React, { useEffect, useState } from 'react';

import DrawingCommandBar from '~components/drawing/DrawingCommandBar';
import DrawingLayoutCanvas from '~components/drawing/DrawingLayoutCanvas';
import DrawingLayoutSidebar from '~components/drawing/DrawingLayoutSidebar';
import DrawingLayoutToolbar from '~components/drawing/DrawingLayoutToolbar';
import {
    createDrawingViewportClipPreset,
    updateDrawingViewport,
} from '~utils/drawingLayouts';

export default function DrawingLayoutEditor({
    activeTool,
    assets,
    canvasRef,
    command,
    commandBarRef,
    content,
    currentModelViewport,
    layout,
    layoutCount,
    maximizedViewportId = null,
    message,
    onChange,
    onClipViewport,
    onCreatePageSetup,
    onDeleteLayout,
    onDeletePageSetup,
    onDeleteViewport,
    onExportPageSetups,
    onImportPageSetups,
    onMaximizeViewport,
    onMinimizeViewport,
    onOperationPoint,
    onScaleViewport,
    onSelectedViewportChange,
    onStatus,
    onToggleViewportLock,
    onToolChange,
    operation,
    pageSetups = [],
    selectedViewportId,
    viewportMaximized = false,
}) {
    const [selectedPaperEntityId, setSelectedPaperEntityId] = useState(null);
    const selectedViewport = layout.viewports.find(viewport => viewport.id === selectedViewportId) || null;
    useEffect(() => {
        setSelectedPaperEntityId(current => (
            layout.paperEntities?.some(entity => entity.id === current) ? current : null
        ));
    }, [layout.id, layout.paperEntities]);
    const selectViewport = viewportId => {
        if (viewportId) setSelectedPaperEntityId(null);
        onSelectedViewportChange(viewportId);
    };
    const selectPaperEntity = entityId => {
        if (entityId) onSelectedViewportChange(null);
        setSelectedPaperEntityId(entityId);
    };
    const clipSelectedViewport = selectedViewport ? () => {
        const clipBoundary = selectedViewport.clipBoundary
            ? null
            : createDrawingViewportClipPreset('hexagon');
        if (onClipViewport) onClipViewport(selectedViewport.id, clipBoundary);
        else onChange(updateDrawingViewport(layout, selectedViewport.id, { clipBoundary }));
    } : null;
    const toggleSelectedViewportLock = selectedViewport ? () => {
        const locked = !selectedViewport.locked;
        if (onToggleViewportLock) onToggleViewportLock(selectedViewport.id, locked);
        else onChange(updateDrawingViewport(layout, selectedViewport.id, { locked }));
    } : null;

    return (
        <div className="drawing-layout-editor">
            <DrawingLayoutToolbar
                activeTool={activeTool}
                hasSelection={Boolean(selectedViewportId)}
                hasPaperSelection={Boolean(selectedPaperEntityId)}
                onPaperCreate={type => { onToolChange('select'); canvasRef.current?.beginPaperCreation(type, { fontSize: 3, textMode: 'multiline' }); }}
                onDelete={onDeleteViewport}
                onFitPaper={() => canvasRef.current?.fitPaper()}
                onMaximize={onMaximizeViewport && selectedViewport
                    ? () => onMaximizeViewport(selectedViewport.id)
                    : null}
                onMinimize={onMinimizeViewport && selectedViewport
                    ? () => onMinimizeViewport(selectedViewport.id)
                    : null}
                onClip={clipSelectedViewport}
                onScale={onScaleViewport}
                onToggleLock={toggleSelectedViewportLock}
                onToolChange={onToolChange}
                onZoomIn={() => canvasRef.current?.zoomPaper(0.82)}
                onZoomOut={() => canvasRef.current?.zoomPaper(1.22)}
                viewportLocked={Boolean(selectedViewport?.locked)}
                viewportMaximized={viewportMaximized}
            />
            <main className="drawing-layout-stage">
                <DrawingLayoutCanvas
                    ref={canvasRef}
                    activeTool={activeTool}
                    assets={assets}
                    content={content}
                    currentModelViewport={currentModelViewport}
                    layout={layout}
                    maximizedViewportId={maximizedViewportId}
                    onChange={onChange}
                    onOperationPoint={onOperationPoint}
                    onSelectedPaperEntityChange={selectPaperEntity}
                    onSelectedViewportChange={selectViewport}
                    onStatus={onStatus}
                    onToolChange={onToolChange}
                    operation={operation}
                    selectedPaperEntityId={selectedPaperEntityId}
                    selectedViewportId={selectedViewportId}
                />
                <DrawingCommandBar ref={commandBarRef} {...command} message={message} />
            </main>
            <DrawingLayoutSidebar
                content={content}
                currentModelViewport={currentModelViewport}
                layout={layout}
                layoutCount={layoutCount}
                onChange={onChange}
                onCreatePageSetup={onCreatePageSetup}
                onDeleteLayout={onDeleteLayout}
                onDeletePageSetup={onDeletePageSetup}
                onExportPageSetups={onExportPageSetups}
                onImportPageSetups={onImportPageSetups}
                onSelectedPaperEntityChange={selectPaperEntity}
                onSelectViewport={selectViewport}
                onToolChange={onToolChange}
                pageSetups={pageSetups}
                selectedPaperEntityId={selectedPaperEntityId}
                selectedViewportId={selectedViewportId}
            />
        </div>
    );
}
