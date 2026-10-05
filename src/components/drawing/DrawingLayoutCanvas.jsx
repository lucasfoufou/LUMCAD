import DrawingInteractionOverlay from '~components/drawing/DrawingInteractionOverlay';
import { alignDrawingViewportPoints } from '~utils/drawingSpaceTransfer';
import { createDrawingPaperEntityFromPoints, commitDrawingPaperEntity, resolveDrawingPaperSnap } from '~utils/drawingPaperOperations';
import { createTrackingAnchor, addTrackingAnchor, constrainOrthogonalPoint } from '~utils/drawingTracking';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { DrawingReferenceControls } from '~components/drawing/DrawingInteractionOverlay';
import DrawingLayoutPage from '~components/drawing/DrawingLayoutPage';
import { DrawingTextEditor } from '~components/drawing/DrawingTextEditor';
import { useI18n } from '~i18n/I18nProvider';
import { canEditEntity, getEntityColor } from '~utils/drawingDocument';
import { clientPointToViewBox, fitViewBox } from '~utils/drawingGeometry';
import {
    MIN_VIEWPORT_SIZE_MM,
    constrainViewportToPaper,
    createDrawingViewport,
    editDrawingPaperAnnotationGrip,
    getDrawingPaperSize,
    modelViewBoxFromViewport,
    paperPointToViewportModelPoint,
    paperRectFromPoints,
    resizeDrawingViewportKeepingScale,
    scaleDrawingViewport,
    setDrawingViewportClipPoint,
    translateDrawingPaperAnnotation,
    updateDrawingPaperAnnotation,
    removeDrawingPaperAnnotation,
    updateDrawingViewport,
} from '~utils/drawingLayouts';
import { operationScaleFactor, previewReferenceTransform } from '~utils/drawingOperations';
import { getOperationOrthogonalOrigin } from '~utils/drawingOperationOptions';
import { drawingTextFontSizeToPixels, resolveDrawingTextStyle } from '~utils/drawingText';

const DrawingLayoutCanvas = forwardRef(function DrawingLayoutCanvas({
    activeTool,
    assets,
    content,
    currentModelViewport,
    layout,
    maximizedViewportId = null,
    onChange,
    onOperationPoint,
    onSelectedPaperEntityChange,
    onSelectedViewportChange,
    onStatus,
    onToolChange,
    operation,
    selectedPaperEntityId,
    selectedViewportId,
}, forwardedRef) {
    const { t } = useI18n();
    const svgRef = useRef(null);
    const [gesture, setGesture] = useState(null);
    const [paperCreation, setPaperCreation] = useState(null);
    const [paperSnap, setPaperSnap] = useState(null);
    const [trackingAnchors, setTrackingAnchors] = useState([]);
    const [operationPoint, setOperationPoint] = useState(null);
    const [editingPaperEntityId, setEditingPaperEntityId] = useState(null);
    const paperSize = getDrawingPaperSize(layout);
    const paper = useMemo(() => paperSize, [paperSize.height, paperSize.width]);
    const [layoutViewBox, setLayoutViewBox] = useState(() => fitPaperViewBox(paper));
    const maximizedViewport = layout.viewports.find(viewport => viewport.id === maximizedViewportId) || null;
    const displayViewBox = maximizedViewport
        ? {
            x: maximizedViewport.x,
            y: maximizedViewport.y,
            width: maximizedViewport.width,
            height: maximizedViewport.height,
        }
        : layoutViewBox;

    useEffect(() => {
        setGesture(null);
        setLayoutViewBox(fitPaperViewBox(paper));
    }, [paper]);

    useEffect(() => {
        setOperationPoint(null);
    }, [operation?.stage, operation?.type, operation?.referencePoints?.length]);

    useEffect(() => {
        if (maximizedViewportId || !layout.paperEntities?.some(entity => entity.id === editingPaperEntityId)) {
            setEditingPaperEntityId(null);
        }
    }, [editingPaperEntityId, layout.id, layout.paperEntities, maximizedViewportId]);

    const canvasPoint = event => clientPointToViewBox(
        event,
        svgRef.current.getBoundingClientRect(),
        displayViewBox,
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
        if (shift && origin) point = constrainOrthogonalPoint(origin, point);
        return point;
    };

    const targetDetails = event => {
        const target = event.target.closest?.('[data-layout-viewport-id]');
        const paperRoot = event.target.closest?.('.drawing-layout-paper-annotations');
        const paperTarget = paperRoot ? event.target.closest?.('[data-entity-id]') : null;
        const gripTarget = paperRoot ? event.target.closest?.('[data-grip-id]') : null;
        return {
            id: target?.dataset?.layoutViewportId || null,
            handle: target?.dataset?.layoutViewportHandle || null,
            clipIndex: target?.dataset?.layoutViewportClipIndex === undefined
                ? null
                : Number(target.dataset.layoutViewportClipIndex),
            paperEntityId: paperTarget?.dataset?.entityId || null,
            paperGripId: gripTarget?.dataset?.gripId || null,
        };
    };

    const snapPaperPoint = (point, shift = false, excludeIds = []) => {
        const threshold = displayViewBox.width / (svgRef.current?.getBoundingClientRect().width || 1000) * 12;
        const snapped = resolveDrawingPaperSnap(point, content, layout, threshold, {
            trackingAnchors, excludeIds, temporaryOrtho: shift,
            orthogonalOrigin: gesture?.kind === 'paper-create' ? gesture.first : gesture?.start || null,
        });
        setPaperSnap(snapped);
        const anchor = content.settings?.tracking ? createTrackingAnchor(snapped, { ...content.settings, ucs: null }) : null;
        if (anchor) setTrackingAnchors(current => addTrackingAnchor(current, anchor));
        return { ...snapped, x: clamp(snapped.x, 0, paper.width), y: clamp(snapped.y, 0, paper.height) };
    };
    const acceptPaperPoint = point => {
        if (!paperCreation) return false;
        if (paperCreation.type === 'alignSpace') {
            const viewport = layout.viewports.find(item => item.id === paperCreation.viewportId);
            if (!viewport || viewport.locked) { onStatus?.(t('spaceTransfer.alignmentInvalid')); return true; }
            const points = [...paperCreation.points, point];
            if (points.length === 2 && Math.hypot(points[0].x - point.x, points[0].y - point.y) < 1e-6) {
                onStatus?.(t('spaceTransfer.alignmentInvalid')); return true;
            }
            if (points.length < 4) {
                setPaperCreation({ ...paperCreation, points });
                onStatus?.(t(`spaceTransfer.alignPoint${points.length + 1}`)); return true;
            }
            const aligned = alignDrawingViewportPoints(viewport, points.slice(0, 2).map(value => paperPointToViewportModelPoint(viewport, value)), points.slice(2));
            if (!aligned) { onStatus?.(t('spaceTransfer.alignmentInvalid')); return true; }
            onChange({ ...layout, viewports: layout.viewports.map(item => item.id === viewport.id ? aligned : item) });
            setGesture(null); setPaperCreation(null); setPaperSnap(null); setTrackingAnchors([]);
            onStatus?.(t('spaceTransfer.aligned')); return true;
        }
        if (gesture?.kind !== 'paper-create') {
            setGesture({ kind: 'paper-create', first: point, current: point }); onStatus?.(t('paperWorkflow.secondPoint')); return true;
        }
        if (paperCreation.type === 'move') {
            const next = translateDrawingPaperAnnotation(layout, paperCreation.entityId, point.x - gesture.first.x, point.y - gesture.first.y);
            onChange(next); setGesture(null); setPaperCreation(null); setPaperSnap(null); setTrackingAnchors([]);
            onStatus?.(t('paperWorkflow.created')); return true;
        }
        const result = commitDrawingPaperEntity(content, layout, paperCreation.type, gesture.first, point, paperCreation.options);
        if (!result) { onStatus?.(t('paperWorkflow.invalid')); return true; }
        onChange(result.layout); onSelectedPaperEntityChange?.(result.entity.id); onSelectedViewportChange(null);
        setGesture(null); setPaperCreation(null); setPaperSnap(null); setTrackingAnchors([]); onToolChange?.('select');
        if (result.entity.type === 'text' && !result.entity.text) setEditingPaperEntityId(result.entity.id);
        onStatus?.(t('paperWorkflow.created')); return true;
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
        const viewport = constrainViewportToPaper(createDrawingViewport({ rect, modelViewBox, hiddenLayerIds: content.layers.filter(layer => layer.newViewportFrozen).map(layer => layer.id) }), paper);
        onChange({ ...layout, viewports: [...layout.viewports, viewport] });
        onSelectedViewportChange(viewport.id);
        onStatus?.(t('layout.viewportCreated'));
        setGesture(null);
    };

    useImperativeHandle(forwardedRef, () => ({
        cancel() { setGesture(null); setOperationPoint(null); setPaperCreation(null); setPaperSnap(null); setTrackingAnchors([]); },
        beginPaperCreation(type, options = {}) {
            setGesture(null); setEditingPaperEntityId(null); setPaperCreation({ type, options }); setPaperSnap(null); setTrackingAnchors([]);
            onStatus?.(t('paperWorkflow.firstPoint')); return true;
        },
        beginSpaceAlignment(viewportId) {
            const viewport = layout.viewports.find(item => item.id === viewportId);
            if (!viewport || viewport.locked) return false;
            setGesture(null); setEditingPaperEntityId(null); setPaperSnap(null); setTrackingAnchors([]);
            setPaperCreation({ type: 'alignSpace', viewportId, points: [] });
            onStatus?.(t('spaceTransfer.alignPoint1')); return true;
        },
        getPaperSelection() { return selectedPaperEntityId; },
        movePaperSelection() {
            const entity = layout.paperEntities?.find(entity => entity.id === selectedPaperEntityId);
            if (!entity || !canEditEntity(content, entity)) return false;
            setGesture(null); setPaperCreation({ type: 'move', entityId: entity.id }); onStatus?.(t('paperWorkflow.firstPoint')); return true;
        },
        removePaperSelection() {
            const entity = layout.paperEntities?.find(entity => entity.id === selectedPaperEntityId);
            if (!entity || !canEditEntity(content, entity)) return false;
            onChange(removeDrawingPaperAnnotation(layout, entity.id)); onSelectedPaperEntityChange?.(null); return true;
        },
        editPaperSelection() {
            const entity = layout.paperEntities?.find(entity => entity.id === selectedPaperEntityId);
            if (entity?.type !== 'text' || !canEditEntity(content, entity)) return false;
            setEditingPaperEntityId(entity.id); return true;
        },
        selectPaperEntity(id) {
            if (id && !layout.paperEntities?.some(entity => entity.id === id && canEditEntity(content, entity))) return false;
            onSelectedPaperEntityChange?.(id); return true;
        },
        isPaperCreating() { return Boolean(paperCreation); },
        fitPaper() { setLayoutViewBox(fitPaperViewBox(paper)); },
        zoomPaper(factor) {
            setLayoutViewBox(current => zoomPaperViewBox(current, factor, viewBoxCenter(current), paper));
        },
        getPrecisionInputContext() {
            return {
                referencePoint: ['create', 'paper-create'].includes(gesture?.kind)
                    ? gesture.first
                    : getOperationOrthogonalOrigin(operation),
                directionPoint: ['create', 'paper-create'].includes(gesture?.kind) ? gesture.current : operationPoint,
            };
        },
        submitPoint(point, options = {}) {
            if (paperCreation) {
                const bounded = { x: clamp(point.x, 0, paper.width), y: clamp(point.y, 0, paper.height) };
                return acceptPaperPoint(options.snap ? snapPaperPoint(bounded, options.shift) : bounded);
            }
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
                if (options.shift && origin) next = constrainOrthogonalPoint(origin, next);
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
        if (viewport.locked) {
            onStatus?.(t('layout.viewportLocked'));
            return;
        }
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
        if (paperCreation) { event.preventDefault(); acceptPaperPoint(snapPaperPoint(point, event.shiftKey)); return; }

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

        const paperEntity = layout.paperEntities?.find(entity => entity.id === target.paperEntityId);
        if (paperEntity && activeTool === 'select') {
            event.preventDefault();
            onSelectedViewportChange(null);
            onSelectedPaperEntityChange?.(paperEntity.id);
            setEditingPaperEntityId(null);
            if (!canEditEntity(content, paperEntity)) {
                setGesture(null);
                return;
            }
            svgRef.current.setPointerCapture(event.pointerId);
            setGesture({
                kind: target.paperGripId ? 'paper-grip' : 'paper-move',
                entityId: paperEntity.id,
                gripId: target.paperGripId,
                start: point,
                initialLayout: layout,
                previewLayout: layout,
            });
            return;
        }

        if (!target.id) {
            onSelectedViewportChange(null);
            onSelectedPaperEntityChange?.(null);
            setEditingPaperEntityId(null);
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
        } else if (target.clipIndex !== null) {
            event.preventDefault();
            onSelectedViewportChange(viewport.id);
            svgRef.current.setPointerCapture(event.pointerId);
            setGesture({
                kind: 'clip-resize',
                viewportId: viewport.id,
                clipIndex: target.clipIndex,
                initial: viewport,
                preview: viewport,
            });
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
        let point = gesture?.kind === 'pan-model' ? canvasPoint(event) : paperPoint(event);
        if (paperCreation || ['paper-move', 'paper-grip'].includes(gesture?.kind)) point = snapPaperPoint(point, event.shiftKey, gesture?.entityId ? [gesture.entityId] : []);
        if (gesture?.kind === 'paper-create') { setGesture(current => ({ ...current, current: point })); return; }
        if (gesture?.kind === 'create') {
            setGesture(current => ({ ...current, current: point }));
            return;
        }
        if (gesture?.kind === 'paper-move') {
            setGesture(current => ({
                ...current,
                previewLayout: translateDrawingPaperAnnotation(
                    current.initialLayout,
                    current.entityId,
                    point.x - current.start.x,
                    point.y - current.start.y,
                ),
            }));
            return;
        }
        if (gesture?.kind === 'paper-grip') {
            setGesture(current => ({
                ...current,
                previewLayout: editDrawingPaperAnnotationGrip(
                    current.initialLayout,
                    current.entityId,
                    current.gripId,
                    point,
                ),
            }));
            return;
        }
        if (!['move', 'resize', 'clip-resize', 'pan-model'].includes(gesture?.kind)) return;
        let preview;
        if (gesture.kind === 'move') {
            preview = constrainViewportToPaper({
                ...gesture.initial,
                x: gesture.initial.x + point.x - gesture.start.x,
                y: gesture.initial.y + point.y - gesture.start.y,
            }, paper);
        } else if (gesture.kind === 'resize') {
            preview = resizeViewport(gesture.initial, gesture.handle, point, paper);
        } else if (gesture.kind === 'clip-resize') {
            preview = setDrawingViewportClipPoint(gesture.initial, gesture.clipIndex, point);
        } else {
            const start = paperPointToViewportModelPoint(gesture.initial, gesture.start);
            const current = paperPointToViewportModelPoint(gesture.initial, point);
            preview = {
                ...gesture.initial,
                modelViewBox: {
                    ...gesture.initial.modelViewBox,
                    x: gesture.initial.modelViewBox.x + start.x - current.x,
                    y: gesture.initial.modelViewBox.y + start.y - current.y,
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
        if (['paper-move', 'paper-grip'].includes(gesture?.kind)) {
            if (gesture.previewLayout && gesture.previewLayout !== gesture.initialLayout) onChange(gesture.previewLayout);
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
            setGesture(null);
            return;
        }
        if (!['move', 'resize', 'clip-resize', 'pan-model'].includes(gesture?.kind)) return;
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
        if (viewport.locked) {
            onStatus?.(t('layout.viewportLocked'));
            return;
        }
        const point = paperPoint(event);
        const viewBox = viewport.modelViewBox;
        const focal = paperPointToViewportModelPoint(viewport, point);
        const ratioX = clamp((focal.x - viewBox.x) / viewBox.width, 0, 1);
        const ratioY = clamp((focal.y - viewBox.y) / viewBox.height, 0, 1);
        const focalX = focal.x;
        const focalY = focal.y;
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

    const handleDoubleClick = event => {
        if (activeTool !== 'select' || maximizedViewportId) return;
        const { paperEntityId } = targetDetails(event);
        const entity = layout.paperEntities?.find(candidate => candidate.id === paperEntityId);
        if (entity?.type !== 'text' || !canEditEntity(content, entity)) return;
        event.preventDefault();
        event.stopPropagation();
        setGesture(null);
        onSelectedViewportChange(null);
        onSelectedPaperEntityChange?.(entity.id);
        setEditingPaperEntityId(entity.id);
        onStatus?.(t('textEditor.opened'));
    };

    const previewViewport = gesture?.preview || null;
    let previewLayout = gesture?.previewLayout || (previewViewport ? {
        ...layout,
        viewports: layout.viewports.map(viewport => viewport.id === previewViewport.id ? previewViewport : viewport),
    } : layout);
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
    if (gesture?.kind === 'paper-create' && paperCreation) {
        if (paperCreation.type === 'move') previewLayout = translateDrawingPaperAnnotation(layout, paperCreation.entityId, gesture.current.x - gesture.first.x, gesture.current.y - gesture.first.y);
        const draft = createDrawingPaperEntityFromPoints(content, layout, paperCreation.type, gesture.first, gesture.current, paperCreation.options);
        if (draft) previewLayout = { ...previewLayout, paperEntities: [...previewLayout.paperEntities, draft] };
    }
    const draftViewport = gesture?.kind === 'create' ? paperRectFromPoints(gesture.first, gesture.current) : null;
    const canvasWidth = svgRef.current?.getBoundingClientRect().width || 1000;
    const canvasRect = svgRef.current?.getBoundingClientRect();
    const markerSize = Math.max(2.5, displayViewBox.width / canvasWidth * 18);
    const editingPaperEntity = layout.paperEntities?.find(entity => entity.id === editingPaperEntityId) || null;
    const textEditorStyle = editingPaperEntity && canvasRect
        ? getPaperTextEditorOverlayStyle(editingPaperEntity, displayViewBox, canvasRect, content.textStyles)
        : null;

    return (
        <div className={`drawing-layout-canvas is-tool-${activeTool} ${['pan-paper', 'pan-model'].includes(gesture?.kind) ? 'is-panning' : ''}`}>
            <DrawingLayoutPage
                ref={svgRef}
                assets={assets}
                canvasViewBox={displayViewBox}
                content={content}
                draftViewport={draftViewport}
                emptyLabel={t('layout.empty')}
                editingPaperEntityId={editingPaperEntityId}
                interactive
                layout={previewLayout}
                maximizedViewportId={maximizedViewportId}
                overlay={(<>
                    <DrawingInteractionOverlay hoverSnap={paperSnap} trackingGuides={paperSnap?.guides || []} trackingAnchors={trackingAnchors} markerSize={markerSize} viewBox={displayViewBox} />
                    <DrawingReferenceControls
                        currentPoint={operationPoint}
                        markerSize={markerSize}
                        operation={operation}
                    />
                </>)}
                selectedViewportId={selectedViewportId}
                selectedPaperEntityId={selectedPaperEntityId}
                onDoubleClick={handleDoubleClick}
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
            {editingPaperEntity && textEditorStyle && (
                <DrawingTextEditor
                    entity={editingPaperEntity}
                    textStyles={content.textStyles}
                    labels={drawingTextEditorLabels(t)}
                    fallbackColor={getEntityColor(content, editingPaperEntity)}
                    toolbarPlacement={textEditorStyle.toolbarPlacement}
                    style={textEditorStyle.root}
                    contentStyle={textEditorStyle.content}
                    onCommit={entity => {
                        if (JSON.stringify(entity) !== JSON.stringify(editingPaperEntity)) {
                            onChange(updateDrawingPaperAnnotation(layout, editingPaperEntity.id, entity));
                        }
                        setEditingPaperEntityId(null);
                        onStatus?.(t('textEditor.committed'));
                    }}
                    onCancel={() => {
                        setEditingPaperEntityId(null);
                        onStatus?.(t('textEditor.cancelled'));
                    }}
                />
            )}
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

function getPaperTextEditorOverlayStyle(entity, viewBox, canvasRect, textStyles) {
    if (!canvasRect.width || !canvasRect.height || !viewBox.width || !viewBox.height) return null;
    const scale = Math.min(canvasRect.width / viewBox.width, canvasRect.height / viewBox.height);
    const offsetX = (canvasRect.width - viewBox.width * scale) / 2;
    const offsetY = (canvasRect.height - viewBox.height * scale) / 2;
    const left = offsetX + (entity.x - viewBox.x) * scale;
    const top = offsetY + (entity.y - viewBox.y) * scale;
    const textStyle = resolveDrawingTextStyle(entity, textStyles);
    return {
        toolbarPlacement: top < 110 ? 'below' : 'above',
        root: {
            left: `${left}px`,
            top: `${top}px`,
            width: `${Math.max(48, Math.abs(entity.width) * scale)}px`,
            height: `${Math.max(30, Math.abs(entity.height) * scale)}px`,
        },
        content: {
            fontFamily: textStyle.cssFontFamily,
            fontSize: `${drawingTextFontSizeToPixels(textStyle.fontSize, scale)}px`,
            lineHeight: textStyle.lineHeight,
            transform: Number(entity.rotation) ? `rotate(${Number(entity.rotation)}deg)` : undefined,
            transformOrigin: 'center',
        },
    };
}

function drawingTextEditorLabels(t) {
    return {
        editor: t('textEditor.editor'),
        toolbar: t('textEditor.toolbar'),
        content: t('textEditor.content'),
        textStyle: t('textEditor.textStyle'),
        font: t('textEditor.font'),
        fontSize: t('textEditor.fontSize'),
        mixed: t('textEditor.mixed'),
        bold: t('textEditor.bold'),
        italic: t('textEditor.italic'),
        underline: t('textEditor.underline'),
        strikethrough: t('textEditor.strikethrough'),
        color: t('textEditor.color'),
        textMode: t('textEditor.textMode'),
        wrapMode: t('textEditor.wrapMode'),
        alignment: t('textEditor.alignment'),
        commit: t('textEditor.commit'),
        cancel: t('textEditor.cancel'),
        fonts: {
            sans: t('textEditor.fonts.sans'),
            serif: t('textEditor.fonts.serif'),
            monospace: t('textEditor.fonts.monospace'),
            technical: t('textEditor.fonts.technical'),
        },
        textModes: {
            singleLine: t('textEditor.textModes.singleLine'),
            multiline: t('textEditor.textModes.multiline'),
        },
        wrapModes: {
            word: t('textEditor.wrapModes.word'),
            character: t('textEditor.wrapModes.character'),
            none: t('textEditor.wrapModes.none'),
        },
        alignments: {
            left: t('textEditor.alignments.left'),
            center: t('textEditor.alignments.center'),
            right: t('textEditor.alignments.right'),
        },
    };
}

export default DrawingLayoutCanvas;
