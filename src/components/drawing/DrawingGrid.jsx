import { normalizeDrawingUcs } from '~utils/drawingCoordinates';
import React from 'react';

import { getAdaptiveGridSpacing } from '~utils/drawingGeometry';

export default function DrawingGrid({ content, viewBox, worldUnitsPerPixel }) {
    const ucs = normalizeDrawingUcs(content.settings?.ucs);
    const { minorSpacing, majorSpacing } = getAdaptiveGridSpacing(content.settings?.gridSpacing, worldUnitsPerPixel);
    return (
        <>
            <defs>
                <pattern id="drawing-minor-grid" width={minorSpacing} height={minorSpacing} patternUnits="userSpaceOnUse">
                    <path d={`M ${minorSpacing} 0 L 0 0 0 ${minorSpacing}`} fill="none" stroke="#d8e0e7" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                </pattern>
                <pattern patternTransform={`translate(${ucs.x} ${ucs.y}) rotate(${ucs.rotation})`} id="drawing-major-grid" width={majorSpacing} height={majorSpacing} patternUnits="userSpaceOnUse">
                    <rect width={majorSpacing} height={majorSpacing} fill="url(#drawing-minor-grid)" />
                    <path d={`M ${majorSpacing} 0 L 0 0 0 ${majorSpacing}`} fill="none" stroke="#b7c5d0" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
                </pattern>
            </defs>
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="#fdfefe" />
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#drawing-major-grid)" pointerEvents="none" />
        </>
    );
}
