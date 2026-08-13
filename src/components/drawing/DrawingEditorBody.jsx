import React from 'react';

import DrawingCanvas from '~components/drawing/DrawingCanvas';
import DrawingCommandBar from '~components/drawing/DrawingCommandBar';
import DrawingSidebar from '~components/drawing/DrawingSidebar';
import DrawingSnapControls from '~components/drawing/DrawingSnapControls';
import DrawingToolbar from '~components/drawing/DrawingToolbar';

export default function DrawingEditorBody({
    toolbar,
    onToolChange,
    canvasRef,
    canvas,
    snap,
    commandBarRef,
    command,
    sidebar,
}) {
    return (
        <div className="drawing-editor-body">
            <DrawingToolbar {...toolbar} onToolChange={onToolChange} />
            <main className="drawing-editor-stage">
                <DrawingCanvas ref={canvasRef} {...canvas} />
                <DrawingSnapControls {...snap} />
                <DrawingCommandBar ref={commandBarRef} {...command} />
            </main>
            <DrawingSidebar {...sidebar} />
        </div>
    );
}
