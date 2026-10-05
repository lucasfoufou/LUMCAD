import React from 'react';
import { normalizeDrawingUcs, normalizeDrawingLimits, drawingUcsToWorld } from '~utils/drawingCoordinates';

export default function DrawingCoordinateOverlay({ settings, viewBox, worldUnitsPerPixel, t }) {
    const ucs = normalizeDrawingUcs(settings?.ucs);
    const limits = normalizeDrawingLimits(settings?.limits);
    const size = worldUnitsPerPixel * 30;
    const visibleOrigin = ucs.x >= viewBox.x + size && ucs.x <= viewBox.x + viewBox.width - size && ucs.y >= viewBox.y + size && ucs.y <= viewBox.y + viewBox.height - size;
    const origin = visibleOrigin ? ucs : { ...ucs, x: viewBox.x + size * 1.6, y: viewBox.y + viewBox.height - size * 1.6 };
    const x = drawingUcsToWorld({ x: size, y: 0 }, origin); const y = drawingUcsToWorld({ x: 0, y: -size }, origin);
    return <g pointerEvents="none">
        {limits?.enabled && <rect x={limits.minX} y={limits.minY} width={limits.maxX - limits.minX} height={limits.maxY - limits.minY}
            fill="none" stroke="#bc7b13" strokeWidth="1" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />}
        {settings?.ucsIcon !== false && <g aria-label={t('coordinates.icon')} role="img">
            <line x1={origin.x} y1={origin.y} x2={x.x} y2={x.y} stroke="#b04444" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <line x1={origin.x} y1={origin.y} x2={y.x} y2={y.y} stroke="#267c5b" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <text x={x.x} y={x.y} fontSize={size * 0.4} fill="#b04444">X</text>
            <text x={y.x} y={y.y} fontSize={size * 0.4} fill="#267c5b">−Y</text>
        </g>}
    </g>;
}
