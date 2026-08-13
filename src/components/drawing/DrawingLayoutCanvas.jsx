import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { DrawingReferenceControls } from '~components/drawing/DrawingInteractionOverlay';
import DrawingLayoutPage from '~components/drawing/DrawingLayoutPage';
import { useI18n } from '~i18n/I18nProvider';
import { clientPointToViewBox, fitViewBox } from '~utils/drawingGeometry';
import {
    MIN_VIEWPORT_SIZE_MM,
    constrainViewportToPaper,
    createDrawingViewport,
    getDrawingPaperSize,
    modelViewBoxFromViewport,
    paperRectFromPoints,
    resizeDrawingViewportKeepingScale,
    scaleDrawingViewport,
    updateDrawingViewport,
} from '~utils/drawingLayouts';
import { operationScaleFactor, previewReferenceTransform } from '~utils/drawingOperations';
import { getOperationOrthogonalOrigin } from '~utils/drawingOperationOptions';

const DrawingLayoutCanvas = forwardRef(function DrawingLayoutCanvas({
    activeTool,
    assets,
    content,
    currentModelViewport,
    layout,
    onChange,
    onOperationPoint,
    onSelectedViewportChange,
    onStatus,
    operation,
    selectedViewportId,
}, forwardedRef) {
    const { t } = useI18n();
    const svgRef = useRef(null);
    const [gesture, setGesture] = useState(null);
    const [operationPoint, setOperationPoint] = useState(null);
    const paper = useMemo(
        () => getDrawingPaperSize(layout.format, layout.orientation),
        [layout.format, layout.orientation],
    );
    const [layoutViewBox, setLayoutViewBox] = useState(() => fitPaperViewBox(paper));

    useEffect(() => {
        setGesture(null);
        setLayoutViewBox(fitPaperViewBox(paper));
    }, [paper]);

    useEffect(() => {
        setOperationPoint(null);
    }, [operation?.stage, operation?.type, operation?.referencePoints?.length]);

    const canvasPoint = event => clientPointToViewBox(
        event,
        svgRef.current.getBoundingClientRect(),
        layoutViewBox,
    );

    const canvasPointForViewBox = (event, viewBox) => clientPointToViewBox(
        event,
        svgRef.current.getBoundingClientRect(),
        viewBox,
    );

    const paperPoint = event => {
        const point = canvasPoint(event);
        return {
            x: clamp(point.x, 0, paper.width),
            y: clamp(point.y, 0, paper.height),
        };
    };

    const operationPaperPoint = (event, { shift = event?.shiftKey } = {}) => {
        let point = paperPoint(event);
        const origin = getOperationOrthogonalOrigin(operation);
        if (shift && origin) point = constrainOrthogonalPoint(point, origin);
        return point;
    };

    const targetDetails = event => {
        const target = event.target.closest?.('[data-layout-viewport-id]');
        return {
            id: target?.dataset?.layoutViewportId || null,
            handle: target?.dataset?.layoutViewportHandle || null,
        };
    };

    const commitCreate = point => {
        const rect = paperRectFromPoints(gesture.first, point);
        if (rect.width < MIN_VIEWPORT_SIZE_MM || rect.height < MIN_VIEWPORT_SIZE_MM) {
            onStatus?.(t('layout.viewportTooSmall'));
            setGesture(null);
            return;
        }
        const aspect = rect.width / rect.height;
        const modelViewBox = currentModelViewport
            ? modelViewBoxFromViewport(currentModelViewport, aspect)
            : fitViewBox(content, aspect);
        const viewport = constrainViewportToPaper(createDrawingViewport({ rect, modelViewBox }), paper);
        onChange({ ...layout, viewports: [...layout.viewports, viewport] });
        onSelectedViewportChange(viewport.id);
        onStatus?.(t('layout.viewportCreated'));
        setGesture(null);
    };

    useImperativeHandle(forwardedRef, () => ({
        cancel() { setGesture(null); setOperationPoint(null); },
        fitPaper() { setLayoutViewBox(fitPaperViewBox(paper)); },
        zoomPaper(factor) {
            setLayoutViewBox(current => zoomPaperViewBox(current, factor, viewBoxCenter(current), paper));
        },
        submitPoint(point, options = {}) {
            if (operation?.scope === 'viewport') {
                if (operation.stage === 'select') {
                    const viewport = layout.viewports.find(item => item.id === options.targetId);
                    if (viewport) onSelectedViewportChange(viewport.id);
                    return Boolean(viewport);
                }
                let next = {
                    x: clamp(Number(point?.x) || 0, 0, paper.width),
                    y: clamp(Number(point?.y) || 0, 0, paper.height),
                };
                const origin = getOperationOrthogonalOrigin(operation);
                if (options.shift && origin) next = constrainOrthogonalPoint(next, origin);
                onOperationPoint?.(next);
                return true;
            }
            if (activeTool !== 'viewport') return false;
            const next = {
                x: clamp(Number(point?.x) || 0, 0, paper.width),
                y: clamp(Number(point?.y) || 0, 0, paper.height),
            };
            if (gesture?.kind === 'create') commitCreate(next);
            else {
                setGesture({ kind: 'create', first: next, current: next });
                onStatus?.(t('layout.viewportSecondPoint'));
            }
            return true;
        },
    }));

    const startPaperPan = (event, resume = null) => {
        const initialViewBox = layoutViewBox;
        event.preventDefault();
        svgRef.current.setPointerCapture(event.pointerId);
        setGesture({
            kind: 'pan-paper',
            initialViewBox,
            resume,
            start: canvasPointForViewBox(event, initialViewBox),
        });
        onStatus?.(t('layout.panPaperPrompt'));
    };

    const startModelPan = (event, viewport, resume = null) => {
        event.preventDefault();
        onSelectedViewportChange(viewport.id);
        svgRef.current.setPointerCapture(event.pointerId);
        setGesture({
            kind: 'pan-model',
            viewportId: viewport.id,
            start: canvasPoint(event),
            initial: viewport,
            resume,
        });
        onStatus?.(t('layout.panViewPrompt'));
    };

    const handlePointerDown = event => {
        const target = targetDetails(event);
        const viewport = layout.viewports.find(item => item.id === target.id);

        if (event.button === 1) {
            const resume = gesture?.kind === 'create' ? gesture : null;
            if (viewport) startModelPan(event, viewport, resume);
            else startPaperPan(event, resume);
            return;
        }
        if (event.button !== 0) return;

        if (activeTool === 'pan-paper') {
            startPaperPan(event);
            return;
        }

        const point = paperPoint(event);

        if (activeTool === 'viewport') {
            event.preventDefault();
            if (gesture?.kind === 'create') commitCreate(point);
            else {
                setGesture({ kind: 'create', first: point, current: point });
                onStatus?.(t('layout.viewportSecondPoint'));
            }
            return;
        }

        if (operation?.scope === 'viewport' && operation.stage !== 'select') {
            event.preventDefault();
            const operationPoint = operationPaperPoint(event);
            setOperationPoint(operationPoint);
            onOperationPoint?.(operationPoint);
            return;
        }

        if (!target.id) {
            onSelectedViewportChange(null);
            setGesture(null);
            return;
        }
        if (!viewport) return;
        if (operation?.scope === 'viewport' && operation.stage === 'select') {
            event.preventDefault();
            onSelectedViewportChange(viewport.id);
            setGesture(null);
            return;
        }
        if (activeTool === 'pan-view') {
            startModelPan(event, viewport);
        } else if (target.handle) {
            event.preventDefault();
            onSelectedViewportChange(viewport.id);
            svgRef.current.setPointerCapture(event.pointerId);
            setGesture({ kind: 'resize', viewportId: viewport.id, handle: target.handle, start: point, initial: viewport, preview: viewport });
        } else {
            event.preventDefault();
            onSelectedViewportChange(viewport.id);
            svgRef.current.setPointerCapture(event.pointerId);
            setGesture({ kind: 'move', viewportId: viewport.id, start: point, initial: viewport, preview: viewport });
        }
    };

    const handlePointerMove = event => {
        if (gesture?.kind === 'pan-paper') {
            const point = canvasPointForViewBox(event, gesture.initialViewBox);
            setLayoutViewBox({
                ...gesture.initialViewBox,
                x: gesture.initialViewBox.x + gesture.start.x - point.x,
                y: gesture.initialViewBox.y + gesture.start.y - point.y,
            });
            return;
        }
        if (!gesture && operation?.scope === 'viewport' && operation.stage !== 'select') {
            setOperationPoint(operationPaperPoint(event));
            return;
        }
        const point = gesture?.kind === 'pan-model' ? canvasPoint(event) : paperPoint(event);
        if (gesture?.kind === 'create') {
            setGesture(current => ({ ...current, current: point }));
            return;
        }
        if (!['move', 'resize', 'pan-model'].includes(gesture?.kind)) return;
        let preview;
        if (gesture.kind === 'move') {
            preview = constrainViewportToPaper({
                ...gesture.initial,
                x: gesture.initial.x + point.x - gesture.start.x,
                y: gesture.initial.y + point.y - gesture.start.y,
            }, paper);
        } else if (gesture.kind === 'resize') {
            preview = resizeViewport(gesture.initial, gesture.handle, point, paper);
        } else {
            const scaleX = gesture.initial.modelViewBox.width / gesture.initial.width;
            const scaleY = gesture.initial.modelViewBox.height / gesture.initial.height;
            preview = {
                ...gesture.initial,
                modelViewBox: {
                    ...gesture.initial.modelViewBox,
                    x: gesture.initial.modelViewBox.x - (point.x - gesture.start.x) * scaleX,
                    y: gesture.initial.modelViewBox.y - (point.y - gesture.start.y) * scaleY,
                },
            };
        }
        setGesture(current => ({ ...current, preview }));
    };

    const handlePointerUp = event => {
        if (gesture?.kind === 'pan-paper') {
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
            setGesture(gesture.resume || null);
            onStatus?.(t('layout.paperPanUpdated'));
            return;
        }
        if (!['move', 'resize', 'pan-model'].includes(gesture?.kind)) return;
        if (gesture.preview) onChange(updateDrawingViewport(layout, gesture.viewportId, gesture.preview));
        if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
        setGesture(gesture.resume || null);
    };

    const handlePointerCancel = event => {
        if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
        setGesture(current => current?.resume || null);
    };

    const handleWheel = event => {
        const { id } = targetDetails(event);
        const viewport = layout.viewports.find(item => item.id === id);
        event.preventDefault();
        if (!viewport) {
            const factor = event.deltaY > 0 ? 1.15 : 0.87;
            const point = canvasPoint(event);
            setLayoutViewBox(current => zoomPaperViewBox(current, factor, point, paper));
            onStatus?.(t('layout.paperZoomUpdated'));
            return;
        }
        onSelectedViewportChange(viewport.id);
        const point = paperPoint(event);
        const ratioX = clamp((point.x - viewport.x) / viewport.width, 0, 1);
        const ratioY = clamp((point.y - viewport.y) / viewport.height, 0, 1);
        const viewBox = viewport.modelViewBox;
        const focalX = viewBox.x + viewBox.width * ratioX;
        const focalY = viewBox.y + viewBox.height * ratioY;
        const factor = event.deltaY > 0 ? 1.12 : 0.88;
        const width = clamp(viewBox.width * factor, 0.000001, 1_000_000);
        const height = width * viewport.height / viewport.width;
        const modelViewBox = {
            x: focalX - width * ratioX,
            y: focalY - height * ratioY,
            width,
            height,
        };
        onChange(updateDrawingViewport(layout, viewport.id, { ...viewport, modelViewBox }));
        onStatus?.(t('layout.zoomUpdated'));
    };

    const previewViewport = gesture?.preview || null;
    let previewLayout = previewViewport ? {
        ...layout,
        viewports: layout.viewports.map(viewport => viewport.id === previewViewport.id ? previewViewport : viewport),
    } : layout;
    if (!previewViewport && operation?.scope === 'viewport' && operationPoint) {
        const reference = previewReferenceTransform(operation, operationPoint);
        const factor = reference?.valid
            ? reference.value
            : operation.stage === 'factor'
                ? operationScaleFactor(operation.basePoint, operationPoint)
                : null;
        const basePoint = reference?.basePoint || operation.basePoint;
        if (Number.isFinite(factor) && factor > 0 && basePoint) {
            previewLayout = scaleDrawingViewport(layout, operation.viewportId, factor, basePoint);
        }
    }
    const draftViewport = gesture?.kind === 'create' ? paperRectFromPoints(gesture.first, gesture.current) : null;
    const canvasWidth = svgRef.current?.getBoundingClientRect().width || 1000;
    const markerSize = Math.max(2.5, layoutViewBox.width / canvasWidth * 18);

    return (
        <div className={`drawing-layout-canvas is-tool-${activeTool} ${['pan-paper', 'pan-model'].includes(gesture?.kind) ? 'is-panning' : ''}`}>
            <DrawingLayoutPage
                ref={svgRef}
                assets={assets}
                canvasViewBox={layoutViewBox}
                content={content}
                draftViewport={draftViewport}
                emptyLabel={t('layout.empty')}
                interactive
                layout={previewLayout}
                overlay={(
                    <DrawingReferenceControls
                        currentPoint={operationPoint}
                        markerSize={markerSize}
                        operation={operation}
                    />
                )}
                selectedViewportId={selectedViewportId}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onPointerLeave={() => { if (!gesture) setOperationPoint(null); }}
                onAuxClick={event => { if (event.button === 1) event.preventDefault(); }}
                onWheel={handleWheel}
                onContextMenu={event => event.preventDefault()}
                role="application"
                aria-label={t('layout.canvas', { name: layout.name })}
            />
        </div>
    );
});

function resizeViewport(viewport, handle, point, paper) {
    const opposite = {
        'top-left': { x: viewport.x + viewport.width, y: viewport.y + viewport.height },
        'top-right': { x: viewport.x, y: viewport.y + viewport.height },
        'bottom-right': { x: viewport.x, y: viewport.y },
        'bottom-left': { x: viewport.x + viewport.width, y: viewport.y },
    }[handle];
    if (!opposite) return viewport;
    return resizeDrawingViewportKeepingScale(viewport, paperRectFromPoints(opposite, point), paper);
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function constrainOrthogonalPoint(point, origin) {
    return Math.abs(point.x - origin.x) >= Math.abs(point.y - origin.y)
        ? { x: point.x, y: origin.y }
        : { x: origin.x, y: point.y };
}

function fitPaperViewBox(paper) {
    const margin = Math.max(paper.width, paper.height) * 0.06;
    return {
        x: -margin,
        y: -margin,
        width: paper.width + margin * 2,
        height: paper.height + margin * 2,
    };
}

function zoomPaperViewBox(viewBox, factor, focalPoint, paper) {
    const ratioX = (focalPoint.x - viewBox.x) / viewBox.width;
    const ratioY = (focalPoint.y - viewBox.y) / viewBox.height;
    const fitted = fitPaperViewBox(paper);
    const minimumWidth = paper.width * 0.25;
    const maximumWidth = fitted.width * 4;
    const width = clamp(viewBox.width * factor, minimumWidth, maximumWidth);
    const height = width * viewBox.height / viewBox.width;
    return {
        x: focalPoint.x - width * ratioX,
        y: focalPoint.y - height * ratioY,
        width,
        height,
    };
}

function viewBoxCenter(viewBox) {
    return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
}

export default DrawingLayoutCanvas;
