import React, { useMemo } from 'react';
import DrawingScene from './DrawingScene';
import { fitViewBox } from '~utils/drawingGeometry';

export default function DrawingContentPreview({ content, assets = [], label, viewBox: suppliedViewBox = null, highlightedIds = [] }) {
    const fittedViewBox = useMemo(() => fitViewBox(content, 1.6, 0.15), [content]);
    const viewBox = suppliedViewBox || fittedViewBox;
    return <svg className="drawing-content-preview" role="img" aria-label={label}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}>
        <DrawingScene content={content} assets={assets} viewBox={viewBox} highlightedIds={highlightedIds} />
    </svg>;
}
