import React, { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';

import DrawingLayoutPage from '~components/drawing/DrawingLayoutPage';
import { getDrawingPaperSize } from '~utils/drawingLayouts';

const DrawingPublishRenderer = forwardRef(function DrawingPublishRenderer({
    drawing,
    layouts,
    plotSettings = null,
    entries = null,
    onReady = null,
}, forwardedRef) {
    const pageRefs = useRef(new Map());
    const items = useMemo(() => entries || layouts.map(layout => ({ key: layout.id, drawing, layout })), [entries, layouts, drawing]);
    const getPages = () => items.map(({ key, layout }) => ({
                layout,
                paper: getDrawingPaperSize(layout),
                plotSettings: plotSettings || layout.plotSettings,
                svg: pageRefs.current.get(key),
            })).filter(page => page.svg);
    useImperativeHandle(forwardedRef, () => ({ getPages }), [items, plotSettings]);
    useLayoutEffect(() => { onReady?.(getPages()); }, [items, plotSettings, onReady]);

    return (
        <div className="drawing-publish-render-pages" aria-hidden="true">
            {items.map(({ key, drawing: source, layout }) => (
                <DrawingLayoutPage
                    key={key}
                    ref={node => {
                        if (node) pageRefs.current.set(key, node);
                        else pageRefs.current.delete(key);
                    }}
                    assets={source.assets}
                    content={source.content}
                    layout={layout}
                    plotSettings={plotSettings || layout.plotSettings}
                />
            ))}
        </div>
    );
});

export default DrawingPublishRenderer;
