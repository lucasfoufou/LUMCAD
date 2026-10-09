import React, { useState } from 'react';

import DrawingCanvas from '~components/drawing/DrawingCanvas';
import DrawingSidebar from '~components/drawing/DrawingSidebar';
import DrawingToolbar from '~components/drawing/DrawingToolbar';

export default function DrawingEditorBody({
    toolbar,
    onToolChange,
    canvasRef,
    canvas,
    optionsTarget,
    sidebar,
}) {
    // Tool and operation options render below the header command line; editing
    // fields for a selected object render in the Properties panel.
    const [propertiesTarget, setPropertiesTarget] = useState(null);
    return (
        <div className="drawing-editor-body">
            <DrawingToolbar {...toolbar} onToolChange={onToolChange} />
            <main className="drawing-editor-stage">
                <DrawingCanvas ref={canvasRef} {...canvas} optionsTarget={optionsTarget} propertiesTarget={propertiesTarget} />
            </main>
            <DrawingSidebar {...sidebar} editEntityId={canvas.editEntity?.id || null} selectedIds={canvas.activeTool === 'select' && !canvas.interactiveOperation ? sidebar.selectedIds : []} onCreationControlsMount={setPropertiesTarget} />
        </div>
    );
}
