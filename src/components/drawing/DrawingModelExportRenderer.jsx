import React, { useLayoutEffect, useRef } from 'react';
import DrawingScene from './DrawingScene';

/** Render a detached snapshot through the same geometry and appearance as the editor. */
export default function DrawingModelExportRenderer({ request }) {
    const svgRef = useRef(null);
    useLayoutEffect(() => { request?.ready(svgRef.current); }, [request]);
    if (!request) return null;
    const { frame, drawing } = request;
    const box = frame.viewBox;
    return <div className="drawing-publish-render-pages" aria-hidden="true">
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" width={frame.width} height={frame.height}
            viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}>
            <DrawingScene content={drawing.content} assets={drawing.assets} viewBox={box} />
        </svg>
    </div>;
}
