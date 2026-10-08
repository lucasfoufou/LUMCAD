import { useEffect, useRef, useState } from 'react';
import { getDrawingBounds } from '~utils/drawingGeometry';
import { drawingRasterExportFrame, drawingRasterStrokePadding } from '~utils/drawingRasterExport';
import { rasterizeDrawingSvg, serializeDrawingModelSvg } from '~utils/drawingPublish';

export default function useDrawingRasterExport() {
    const [request, setRequest] = useState(null);
    const active = useRef(null);
    useEffect(() => () => { active.current?.reject(new Error('wmfContextChanged')); active.current = null; }, []);
    const render = (drawing, options) => new Promise((resolve, reject) => {
        if (active.current) { reject(new Error('wmfLimit')); return; }
        const snapshot = structuredClone(drawing);
        const frame = drawingRasterExportFrame(getDrawingBounds(snapshot.content), options);
        const operation = { reject, started: false }; active.current = operation;
        setRequest({ drawing: snapshot, frame, ready: async svg => {
            if (!svg || active.current !== operation || operation.started) return;
            operation.started = true;
            try {
                await document.fonts?.ready;
                const scene = svg.querySelector('.drawing-scene');
                if (!scene?.childElementCount) throw new Error('wmfEmpty');
                const measured = scene.getBBox();
                const fitted = drawingRasterExportFrame({ minX: measured.x, minY: measured.y,
                    maxX: measured.x + measured.width, maxY: measured.y + measured.height }, { ...options, strokePadding: drawingRasterStrokePadding(svg) });
                svg.setAttribute('viewBox', `${fitted.viewBox.x} ${fitted.viewBox.y} ${fitted.viewBox.width} ${fitted.viewBox.height}`);
                svg.setAttribute('width', fitted.width); svg.setAttribute('height', fitted.height);
                const image = options.format === 'svg'
                    ? { text: await serializeDrawingModelSvg(svg, fitted), width: fitted.width, height: fitted.height, format: 'SVG' }
                    : await rasterizeDrawingSvg(svg, null, { rasterDpi: 300, imageDpi: 1200, jpegQuality: options.quality ?? 1 },
                        { forcePng: options.format !== 'jpg', pixelSize: fitted, background: fitted.background });
                if (active.current === operation) resolve({ ...image, viewBox: fitted.viewBox, background: fitted.background });
            } catch (error) { reject(error); }
            finally {
                if (active.current === operation) { active.current = null; setRequest(null); }
            }
        } });
    });
    return { render, request };
}
