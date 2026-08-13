import React from 'react';

import DrawingLayoutPage from '~components/drawing/DrawingLayoutPage';
import {
    createDrawingPrintPageStyle,
    getDrawingPrintContentSize,
    getDrawingPrintPageName,
} from '~utils/drawingPrint';

export default function DrawingPrintPage({ drawing, layouts }) {
    const pageStyle = createDrawingPrintPageStyle(layouts);
    return (
        <div className="drawing-print-document">
            {pageStyle && <style media="print">{pageStyle}</style>}
            {layouts.map(layout => {
                const contentSize = getDrawingPrintContentSize(layout);
                return (
                    <article
                        key={layout.id}
                        className="drawing-layout-print-page"
                        data-print-page={getDrawingPrintPageName(layout)}
                        style={{
                            width: `${contentSize.width}px`,
                            height: `${contentSize.height}px`,
                        }}
                        aria-label={layout.name}
                    >
                        <DrawingLayoutPage
                            assets={drawing.assets}
                            content={drawing.content}
                            layout={layout}
                            role="img"
                            aria-label={layout.name}
                        />
                    </article>
                );
            })}
        </div>
    );
}
