import React, { forwardRef, useImperativeHandle, useRef } from 'react';

import DrawingLayoutPage from '~components/drawing/DrawingLayoutPage';
import { getDrawingPaperSize } from '~utils/drawingLayouts';

const DrawingPublishRenderer = forwardRef(function DrawingPublishRenderer({
    drawing,
    layouts,
    plotSettings = null,
}, forwardedRef) {
    const pageRefs = useRef(new Map());
    useImperativeHandle(forwardedRef, () => ({
        getPages() {
            return layouts.map(layout => ({
                layout,
                paper: getDrawingPaperSize(layout),
                plotSettings: plotSettings || layout.plotSettings,
                svg: pageRefs.current.get(layout.id),
            })).filter(page => page.svg);
        },
    }), [layouts, plotSettings]);

    return (
        <div className="drawing-publish-render-pages" aria-hidden="true">
            {layouts.map(layout => (
                <DrawingLayoutPage
                    key={layout.id}
                    ref={node => {
                        if (node) pageRefs.current.set(layout.id, node);
                        else pageRefs.current.delete(layout.id);
                    }}
                    assets={drawing.assets}
                    content={drawing.content}
                    layout={layout}
                    plotSettings={plotSettings || layout.plotSettings}
                />
            ))}
        </div>
    );
});

export default DrawingPublishRenderer;
