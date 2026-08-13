import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import DrawingInteractionOverlay from '~components/drawing/DrawingInteractionOverlay';
import DrawingCreationControls from '~components/drawing/DrawingCreationControls';
import DrawingGrid from '~components/drawing/DrawingGrid';
import DrawingScene from '~components/drawing/DrawingScene';
import { useI18n } from '~i18n/I18nProvider';
import { createArrayDraftEntities, createMirrorDraftEntities } from '~utils/drawingCompoundOperations';
import { parseDrawingNumbers } from '~utils/drawingCommands';
import {
    addEntity,
    applySelectionOperation,
    canEditEntity,
    canSelectEntity,
    createDrawingId,
    createDimensionForEntity,
    createFreeDimension,
    getLayer,
    updateSelectedEntities,
} from '~utils/drawingDocument';
import {
    clientPointToViewBox,
    createTangentCircle,
    findThreeEntityTangentCircles,
    fitViewBox,
    getViewBoxWorldUnitsPerPixel,
    pointDistance,
    resizeViewBoxForCanvas,
    tangentRadiusAtPoint,
} from '~utils/drawingGeometry';
import {
    drawingSelectionCandidates,
    entityIdFromDrawingEvent,
    isDimensionableDrawingEntity,
    isDimensionPointSnap,
    isDrawingTextInput,
} from '~utils/drawingInteraction';
import { buildDrawingEntity } from '~utils/drawingEntityFactory';
import {
    applyDrawingCreationMode,
    buildArcCreationEntity,
    buildCircleCreationEntity,
    buildRectangleCreationEntity,
    buildRegularPolygonCreationEntity,
    createDefaultDrawingCreationConfig,
    parseDrawingCreationInput,
} from '~utils/drawingCreation';
import {
    createCopyPreviewEntities,
    createOffsetPreviewEntities,
    createTransformCopyPreviewEntities,
    operationDelta,
    operationUsesCopy,
    previewTransformContent,
} from '~utils/drawingOperations';
import { constrainLineGripPoint, createSelectionWindow, editEntityGrip, getEntityGrips } from '~utils/drawingSelection';
import { addTrackingAnchor, createTrackingAnchor, resolveDrawingSnap } from '~utils/drawingTracking';
import { createTrimPreviewEntities } from '~utils/drawingTrimOperations';
import { getOperationOrthogonalOrigin } from '~utils/drawingOperationOptions';
import { scaleDrawingViewBox, zoomDrawingViewBox } from '~utils/drawingViewport';

const drawingTools = new Set(['line', 'rectangle', 'circle', 'polygon', 'arc', 'text']);
const DrawingCanvas = forwardRef(function DrawingCanvas({
    content,
    assets,
    activeTool,
    selectedIds,
    onSelectionChange,
    onCommit,
    onViewportChange,
    onStatus,
    interactiveOperation = null,
    onInteractiveOperation,
    dimensionMode = 'auto',
    editEntity = null,
    onEditEntityChange = null,
    onEntityCreated = null,
}, forwardedRef) {
    const { t } = useI18n();
    const svgRef = useRef(null);
    const wrapperRef = useRef(null);
    const [viewBox, setViewBox] = useState(() => fitViewBox(content));
    const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
    const previousCanvasSizeRef = useRef({ width: 0, height: 0 });
    const [gesture, setGesture] = useState(null);
    const [hoverSnap, setHoverSnap] = useState(null);
    const [hoveredEntityId, setHoveredEntityId] = useState(null);
    const [trackingAnchors, setTrackingAnchors] = useState([]);
    const [operationPoint, setOperationPoint] = useState(null);
    const [spacePressed, setSpacePressed] = useState(false);
    const initialCreationConfigRef = useRef(createDefaultDrawingCreationConfig(activeTool));
    const [creationMode, setCreationMode] = useState(initialCreationConfigRef.current.mode);
    const [creationOptions, setCreationOptions] = useState(initialCreationConfigRef.current.options);
    const rememberedCreationConfigsRef = useRef(new Map());
    const pendingCreationRef = useRef(null);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

    useEffect(() => {
        const canvas = svgRef.current;
        if (!canvas || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) setCanvasSize({ width, height });
        });
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!canvasSize.width || !canvasSize.height) return;
        setViewBox(current => resizeViewBoxForCanvas(current, previousCanvasSizeRef.current, canvasSize));
        previousCanvasSizeRef.current = canvasSize;
    }, [canvasSize]);

    useEffect(() => {
        const onKeyDown = event => {
            if (event.code === 'Space' && !isDrawingTextInput(event.target)) {
                event.preventDefault();
                setSpacePressed(true);
            }
            if (event.key === 'Escape') setGesture(null);
        };
        const onKeyUp = event => {
            if (event.code === 'Space') setSpacePressed(false);
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    useEffect(() => {
        onViewportChange?.({
            x: viewBox.x + viewBox.width / 2,
            y: viewBox.y + viewBox.height / 2,
            width: viewBox.width,
            height: viewBox.height,
            worldUnitsPerPixel: getViewBoxWorldUnitsPerPixel(viewBox, canvasSize),
        });
    }, [canvasSize, onViewportChange, viewBox]);

    useEffect(() => {
        if (!drawingTools.has(activeTool) && gesture?.kind === 'draw') setGesture(null);
        if (activeTool !== 'dimension' && gesture?.kind === 'dimension') setGesture(null);
        if (interactiveOperation?.type !== 'trim' && gesture?.kind === 'trim-fence') setGesture(null);
    }, [activeTool, gesture?.kind, interactiveOperation?.type]);

    useEffect(() => {
        const pending = pendingCreationRef.current?.tool === activeTool
            ? pendingCreationRef.current
            : null;
        pendingCreationRef.current = null;
        const remembered = rememberedCreationConfigsRef.current.get(activeTool);
        const next = pending || remembered || createDefaultDrawingCreationConfig(activeTool);
        setCreationMode(next.mode);
        setCreationOptions(next.options);
        setGesture(current => current?.kind === 'draw' ? null : current);
    }, [activeTool]);

    useEffect(() => {
        setOperationPoint(null);
        setHoverSnap(null);
        setHoveredEntityId(null);
    }, [activeTool, interactiveOperation?.stage, interactiveOperation?.type]);

    useEffect(() => { setTrackingAnchors([]); }, [activeTool, interactiveOperation?.type]);

    useEffect(() => {
        if (!content.settings?.tracking) setTrackingAnchors([]);
    }, [content.settings?.tracking]);

    const commitDraft = (tool, first, current, { continueLine = false, options = {} } = {}) => {
        const entity = buildDrawingEntity(tool, first, current, content.activeLayerId, null, { defaultText: t('document.defaultText'), options });
        if (!entity) return false;
        onCommit(addEntity(content, entity));
        onSelectionChange([entity.id]);
        onEntityCreated?.(entity);
        setGesture(continueLine ? { kind: 'draw', tool: 'line', first: current, current } : null);
        if (continueLine) onStatus?.(t('canvas.segmentAdded'));
        return true;
    };

    const buildCreationEntity = (drawGesture, current = drawGesture?.current, id = 'draft') => {
        if (!drawGesture || !current) return null;
        const points = [...(drawGesture.points || [])];
        if (!points.length || pointDistance(points[points.length - 1], current) > 1e-9) points.push(current);
        const options = {
            ...(drawGesture.options || {}),
            ...(creationOptions || {}),
            circleSafety: drawingCircleSafety(viewBox),
        };
        if (drawGesture.tool === 'rectangle') return buildRectangleCreationEntity(points[0], current, content.activeLayerId, options, id);
        if (drawGesture.tool === 'polygon') return buildRegularPolygonCreationEntity(points[0], current, content.activeLayerId, options, id);
        if (drawGesture.tool === 'circle') {
            if (drawGesture.mode === 'tangentTangentRadius') {
                const targets = drawGesture.targetIds.map(targetId => content.entities.find(entity => entity.id === targetId)).filter(Boolean);
                const radius = Number.isFinite(options.radius) ? options.radius : tangentRadiusAtPoint(targets, current);
                const tangent = radius ? createTangentCircle(targets, radius, current, options.circleSafety) : null;
                return tangent ? { ...tangent, id, layerId: content.activeLayerId } : null;
            }
            if (drawGesture.mode === 'tangentTangentTangent') {
                const targets = drawGesture.targetIds.map(targetId => content.entities.find(entity => entity.id === targetId)).filter(Boolean);
                const candidates = targets.length >= 3
                    ? findThreeEntityTangentCircles(targets, options.circleSafety)
                    : [];
                const tangent = candidates.sort((left, right) => pointDistance(left, current) - pointDistance(right, current))[0];
                return tangent ? { ...tangent, id, layerId: content.activeLayerId } : null;
            }
            return buildCircleCreationEntity(points, content.activeLayerId, drawGesture.mode, options, id);
        }
        if (drawGesture.tool === 'arc') return buildArcCreationEntity(points, content.activeLayerId, drawGesture.mode, options, id);
        return buildDrawingEntity(drawGesture.tool, points[0], current, content.activeLayerId, id, {
            defaultText: t('document.defaultText'),
            options,
        });
    };

    const commitCreationEntity = entity => {
        if (!entity) return false;
        const nextEntity = { ...entity, id: entity.id === 'draft' ? createDrawingId(entity.type) : entity.id };
        onCommit(addEntity(content, nextEntity));
        onSelectionChange([nextEntity.id]);
        onEntityCreated?.(nextEntity);
        setGesture(null);
        return true;
    };

    const creationStatus = (mode, pointCount) => {
        if (activeTool === 'arc' && mode === 'threePoint') {
            return t(pointCount < 2 ? 'canvas.arcEndPoint' : 'canvas.arcPointOnArc');
        }
        if (activeTool === 'circle' && mode === 'threePoint') {
            return t(pointCount < 2 ? 'canvas.circleSecondPointOnCircle' : 'canvas.circleThirdPoint');
        }
        if (activeTool === 'circle' && mode === 'twoPoint') return t('canvas.circleDiameterPoint');
        if (mode === 'startCenterEnd') return t(pointCount < 2 ? 'canvas.arcCenterPoint' : 'canvas.arcEndDirection');
        if (mode === 'startEndRadius') return t(pointCount < 2 ? 'canvas.arcEndPoint' : 'canvas.arcRadiusPoint');
        if (mode === 'startCenterAngle') return t(pointCount < 2 ? 'canvas.arcCenterPoint' : 'canvas.arcAngle');
        if (mode === 'tangentTangentRadius') return t(pointCount < 2 ? 'canvas.circleTangentTarget' : 'canvas.circleTangentRadius');
        if (mode === 'tangentTangentTangent') return t('canvas.circleTangentTarget');
        if (activeTool === 'polygon') return t('canvas.polygonSecondPoint');
        return t(activeTool === 'circle' ? 'canvas.circleSecondPoint' : 'canvas.secondPoint');
    };

    const handleCreationPoint = (point, targetId = null) => {
        const target = content.entities.find(entity => entity.id === targetId);
        const tangentMode = activeTool === 'circle'
            && ['tangentTangentRadius', 'tangentTangentTangent'].includes(creationMode);
        if (tangentMode) {
            const previousTargets = gesture?.kind === 'draw' ? gesture.targetIds || [] : [];
            const requiredTargets = creationMode === 'tangentTangentRadius' ? 2 : 3;
            if (previousTargets.length >= requiredTargets) {
                const entity = buildCreationEntity({
                    ...gesture,
                    current: point,
                    options: { ...(gesture.options || {}), ...creationOptions },
                }, point);
                if (!entity) {
                    onStatus?.(t('canvas.circleTangentUnavailable'));
                    return false;
                }
                return commitCreationEntity(entity);
            }
            const supportedTargetTypes = ['line', 'circle'];
            if (!target || !supportedTargetTypes.includes(target.type)) {
                onStatus?.(t('canvas.circleTangentTarget'));
                return false;
            }
            if (previousTargets.includes(target.id)) {
                onStatus?.(t('canvas.circleTangentDistinct'));
                return false;
            }
            const nextTargets = [...previousTargets, target.id];
            if (creationMode === 'tangentTangentTangent' && nextTargets.length >= 3) {
                const sources = nextTargets.map(id => content.entities.find(entity => entity.id === id)).filter(Boolean);
                if (!findThreeEntityTangentCircles(sources, drawingCircleSafety(viewBox)).length) {
                    onStatus?.(t('canvas.circleTangentUnavailable'));
                    setGesture(null);
                    return false;
                }
                setGesture({ kind: 'draw', tool: activeTool, mode: creationMode, options: creationOptions,
                    targetIds: nextTargets, points: [point], first: point, current: point });
                onStatus?.(t('canvas.circleTangentChoose'));
                return true;
            }
            if (creationMode === 'tangentTangentRadius' && nextTargets.length >= 2) {
                setGesture({ kind: 'draw', tool: activeTool, mode: creationMode, options: creationOptions, targetIds: nextTargets, points: [point], first: point, current: point });
                onStatus?.(t(Number.isFinite(creationOptions.radius)
                    ? 'canvas.circleTangentChoose'
                    : 'canvas.circleTangentRadius'));
                return true;
            }
            setGesture({ kind: 'draw', tool: activeTool, mode: creationMode, options: creationOptions, targetIds: nextTargets, points: [point], first: point, current: point });
            onStatus?.(creationStatus(creationMode, nextTargets.length));
            return true;
        }

        const currentGesture = gesture?.kind === 'draw' && gesture.tool === activeTool ? gesture : null;
        const points = currentGesture ? [...(currentGesture.points || [currentGesture.first]), point] : [point];
        const nextGesture = {
            kind: 'draw',
            tool: activeTool,
            mode: creationMode,
            options: { ...(currentGesture?.options || {}), ...creationOptions },
            points,
            first: points[0],
            current: point,
        };
        const requiredPoints = activeTool === 'arc' || (activeTool === 'circle' && creationMode === 'threePoint') ? 3 : 2;
        const arcOptionCompletes = activeTool === 'arc' && (
            creationMode === 'startCenterAngle'
                ? points.length >= 3 || (points.length >= 2 && Number.isFinite(nextGesture.options.angle))
                : creationMode === 'startEndRadius'
                    ? points.length >= 3 || (points.length >= 2 && Number.isFinite(nextGesture.options.radius))
                    : false
        );
        const completes = activeTool === 'line' || activeTool === 'text'
            ? points.length >= 2
            : activeTool === 'arc' && ['startCenterAngle', 'startEndRadius'].includes(creationMode)
                ? arcOptionCompletes
                : points.length >= requiredPoints;
        if (completes) {
            if (activeTool === 'line') return commitDraft(activeTool, points[0], point, { continueLine: true });
            const entity = buildCreationEntity(nextGesture, point);
            if (!entity) {
                onStatus?.(t(activeTool === 'arc' ? 'canvas.arcInvalid' : 'canvas.creationInvalid'));
                setGesture(nextGesture);
                return false;
            }
            return commitCreationEntity(entity);
        }
        setGesture(nextGesture);
        onStatus?.(creationStatus(creationMode, points.length));
        return true;
    };

    const updateCreationConfig = config => {
        const defaults = createDefaultDrawingCreationConfig(activeTool);
        const next = {
            mode: config.mode || defaults.mode,
            options: config.options || {},
        };
        rememberedCreationConfigsRef.current.set(activeTool, next);
        setCreationMode(next.mode);
        setCreationOptions(next.options);
        setGesture(null);
        onStatus?.(t('canvas.creationOptionsSet'));
    };

    const submitCreationInputForTool = (tool, rawValue) => {
        if (!drawingTools.has(tool) || tool === 'line' || tool === 'text') return false;
        const parsed = parseDrawingCreationInput(tool, rawValue);
        if (!parsed) return false;
        const remembered = rememberedCreationConfigsRef.current.get(tool)
            || createDefaultDrawingCreationConfig(tool);
        const current = tool === activeTool
            ? { mode: creationMode, options: creationOptions }
            : remembered;
        const next = applyDrawingCreationMode(tool, current, rawValue);
        rememberedCreationConfigsRef.current.set(tool, next);
        if (tool !== activeTool) {
            pendingCreationRef.current = {
                tool,
                mode: next.mode,
                options: next.options || {},
            };
        }
        if (parsed.kind === 'mode') {
            if (tool === activeTool) {
                setCreationMode(next.mode);
                setCreationOptions(next.options || {});
            }
            setGesture(null);
            onStatus?.(t('canvas.creationModeSet', { mode: String(parsed.mode) }));
        } else {
            if (tool === activeTool) setCreationOptions(next.options || {});
            onStatus?.(t('canvas.creationOptionsSet'));
        }
        return true;
    };

    const submitCreationInput = rawValue => submitCreationInputForTool(activeTool, rawValue);

    function submitRemotePoint(rawPoint, options = {}) {
        if (!Number.isFinite(rawPoint?.x) || !Number.isFinite(rawPoint?.y)) return false;
        const targetId = typeof options.targetId === 'string' ? options.targetId : null;
        const targetEntity = content.entities.find(entity => entity.id === targetId);
        const orthogonalOrigin = gesture?.kind === 'draw' && gesture.tool === 'line'
            ? gesture.first
            : getOperationOrthogonalOrigin(interactiveOperation);
        let point = { x: Number(rawPoint.x), y: Number(rawPoint.y) };
        if (options.snap) {
            point = resolveDrawingSnap(point, content, getViewBoxWorldUnitsPerPixel(viewBox, canvasSize) * 12, {
                excludeIds: interactiveOperation?.type === 'offset' ? (interactiveOperation.entityIds || []) : [],
                trackingAnchors,
                orthogonalOrigin,
                forceOrthogonal: Boolean(options.shift && orthogonalOrigin),
            });
        } else if (options.shift && orthogonalOrigin) {
            point = constrainRemoteOrthogonalPoint(point, orthogonalOrigin);
        }
        setOperationPoint(point);
        showPointerFeedback(point);

        if (interactiveOperation && interactiveOperation.stage !== 'select') {
            if (interactiveOperation.type === 'trim') {
                if (gesture?.kind === 'trim-fence') {
                    onInteractiveOperation?.({ fence: { first: gesture.start, second: point } });
                    setGesture(null);
                } else if (targetEntity) {
                    onInteractiveOperation?.({ point, targetId });
                } else {
                    setGesture({ kind: 'trim-fence', start: point, current: point });
                    onStatus?.(t('canvas.trimFenceSecondPoint'));
                }
                return true;
            }
            onInteractiveOperation?.({ point, targetId });
            return true;
        }

        if (activeTool === 'dimension') {
            if (gesture?.kind === 'dimension') {
                const dimension = createFreeDimension(content, gesture.first, point);
                if (dimension) {
                    onCommit(addEntity(content, dimension));
                    onSelectionChange([dimension.id]);
                    onStatus?.(t('canvas.freeDimensionAdded'));
                }
                setGesture(null);
                return Boolean(dimension);
            }
            const dimension = isDimensionableDrawingEntity(targetEntity)
                ? createDimensionForEntity(content, targetEntity, dimensionMode, point)
                : null;
            if (dimension) {
                onCommit(addEntity(content, dimension));
                onSelectionChange([dimension.id]);
                onStatus?.(t('canvas.associativeDimensionAdded'));
            } else {
                setGesture({ kind: 'dimension', first: point, current: point });
                onStatus?.(t('canvas.dimensionSecondPoint'));
            }
            return true;
        }

        if (drawingTools.has(activeTool)) {
            const activeLayer = getLayer(content, content.activeLayerId);
            if (!activeLayer?.visible || activeLayer.locked) {
                onStatus?.(t('canvas.activeLayerUnavailable'));
                return false;
            }
            return handleCreationPoint(point, targetId);
        }

        if ((activeTool === 'select' || interactiveOperation?.stage === 'select') && targetEntity && canSelectEntity(content, targetEntity)) {
            onSelectionChange(applySelectionOperation(selectedIds, [targetId], options.shift ? 'remove' : 'add'));
            return true;
        }
        return false;
    }

    useImperativeHandle(forwardedRef, () => ({
        applyNumericInput(rawValue) {
            if (gesture?.kind !== 'draw') return false;
            const values = parseDrawingNumbers(rawValue);
            if (!values.length || values.some(value => value <= 0)) return false;
            const { first, current, tool } = gesture;
            if (tool === 'line') {
                const length = values[0];
                const dx = current.x - first.x;
                const dy = current.y - first.y;
                const directionLength = Math.hypot(dx, dy) || 1;
                return commitDraft(tool, first, { x: first.x + dx / directionLength * length, y: first.y + dy / directionLength * length }, { continueLine: true });
            }
            if (tool === 'rectangle') {
                const width = values[0];
                const height = values[1] ?? values[0];
                const directionX = current.x < first.x ? -1 : 1;
                const directionY = current.y < first.y ? -1 : 1;
                const entity = buildCreationEntity({ ...gesture, options: { ...(gesture.options || {}), width, height } }, { x: first.x + width * directionX, y: first.y + height * directionY });
                return commitCreationEntity(entity);
            }
            if (tool === 'text') {
                const width = values[0];
                const height = values[1] ?? values[0];
                const directionX = current.x < first.x ? -1 : 1;
                const directionY = current.y < first.y ? -1 : 1;
                return commitDraft(tool, first, { x: first.x + width * directionX, y: first.y + height * directionY });
            }
            if (tool === 'polygon') {
                const entity = buildCreationEntity({ ...gesture, options: { ...(gesture.options || {}), radius: values[0] } }, { x: first.x + values[0], y: first.y });
                return commitCreationEntity(entity);
            }
            if (tool === 'circle') {
                if (gesture.mode === 'tangentTangentRadius') {
                    const entity = buildCreationEntity({ ...gesture, options: { ...(gesture.options || {}), radius: values[0] } }, current);
                    return commitCreationEntity(entity);
                }
                if (gesture.mode === 'startEndRadius' || gesture.mode === 'startCenterAngle') return false;
                const entity = buildCreationEntity(gesture, { x: first.x + values[0], y: first.y });
                return commitCreationEntity(entity);
            }
            if (tool === 'arc') {
                if (!['startCenterAngle', 'startEndRadius'].includes(gesture.mode)) return false;
                const options = { ...(gesture.options || {}) };
                if (gesture.mode === 'startCenterAngle') options.angle = values[0];
                if (gesture.mode === 'startEndRadius') options.radius = values[0];
                const entity = buildCreationEntity({ ...gesture, options }, current);
                return commitCreationEntity(entity);
            }
            return false;
        },
        submitCreationInput,
        submitCreationInputForTool,
        fit() {
            setViewBox(fitViewBox(content, canvasSize.width / Math.max(1, canvasSize.height)));
        },
        zoom(factor) {
            setViewBox(current => zoomDrawingViewBox(current, factor, {
                x: current.x + current.width / 2,
                y: current.y + current.height / 2,
            }, canvasSize));
        },
        setScaleRatio(scaleRatio) {
            setViewBox(current => scaleDrawingViewBox(current, canvasSize, scaleRatio));
        },
        cancel() {
            setGesture(null);
            setHoverSnap(null);
            setHoveredEntityId(null);
            setTrackingAnchors([]);
        },
        getOperationPoint() {
            return operationPoint;
        },
        getViewportCenter() {
            return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
        },
        submitPoint(point, options) {
            return submitRemotePoint(point, options);
        },
    }), [activeTool, canvasSize, content, creationMode, creationOptions, dimensionMode, gesture, interactiveOperation, operationPoint, selectedIds, submitCreationInput, submitCreationInputForTool, t, trackingAnchors, viewBox]);

    const worldPoint = event => {
        const svg = svgRef.current;
        const pointer = {
            clientX: Number.isFinite(event.clientX) ? event.clientX : Number(event.pageX) - window.scrollX,
            clientY: Number.isFinite(event.clientY) ? event.clientY : Number(event.pageY) - window.scrollY,
        };
        const matrix = svg?.getScreenCTM?.();
        if (matrix && svg?.createSVGPoint) {
            const point = svg.createSVGPoint();
            point.x = pointer.clientX;
            point.y = pointer.clientY;
            const transformed = point.matrixTransform(matrix.inverse());
            if (Number.isFinite(transformed.x) && Number.isFinite(transformed.y)) {
                return { x: transformed.x, y: transformed.y };
            }
        }
        const fallback = clientPointToViewBox(pointer, svg.getBoundingClientRect(), viewBox);
        if (Number.isFinite(fallback.x) && Number.isFinite(fallback.y)) return fallback;
        return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
    };

    const worldUnitsPerPixel = getViewBoxWorldUnitsPerPixel(viewBox, canvasSize);

    const snapPoint = (event, excludeIds = [], orthogonalOrigin = null) => {
        const point = worldPoint(event);
        const threshold = worldUnitsPerPixel * 12;
        return resolveDrawingSnap(point, content, threshold, {
            excludeIds,
            trackingAnchors,
            orthogonalOrigin,
            forceOrthogonal: Boolean(orthogonalOrigin && event.shiftKey),
        });
    };

    const showPointerFeedback = point => {
        setHoverSnap(point?.type ? point : null);
        const anchor = content.settings?.tracking ? createTrackingAnchor(point) : null;
        if (anchor) setTrackingAnchors(current => addTrackingAnchor(current, anchor));
    };

    const interactivePoint = (event, arrayHandle = null) => {
        const raw = worldPoint(event);
        const excludeIds = interactiveOperation?.type === 'offset' ? (interactiveOperation.entityIds || []) : [];
        const orthogonalOrigin = getOperationOrthogonalOrigin(interactiveOperation, arrayHandle);
        return resolveDrawingSnap(raw, content, worldUnitsPerPixel * 12, {
            excludeIds,
            trackingAnchors,
            orthogonalOrigin,
            forceOrthogonal: Boolean(orthogonalOrigin && event.shiftKey),
        });
    };

    const gripPoint = (event, target) => {
        const raw = worldPoint(event);
        const desired = { x: gesture.origin.x + raw.x - gesture.startPointer.x, y: gesture.origin.y + raw.y - gesture.startPointer.y };
        const orthogonalOrigin = event.shiftKey && target?.type !== 'line' ? gesture.origin : null;
        const snapped = resolveDrawingSnap(desired, content, worldUnitsPerPixel * 12, {
            excludeIds: [gesture.entityId], trackingAnchors, orthogonalOrigin, forceOrthogonal: Boolean(orthogonalOrigin),
        });
        return event.shiftKey ? constrainLineGripPoint(target, gesture.gripId, snapped) : snapped;
    };

    const completeSelectionWindow = current => {
        if (gesture?.kind !== 'select-window') return;
        if (pointDistance(gesture.start, current) > worldUnitsPerPixel * 3) {
            const window = createSelectionWindow(gesture.start, current);
            const candidateIds = drawingSelectionCandidates(content, window);
            onSelectionChange(applySelectionOperation(selectedIds, candidateIds, gesture.operation));
            onStatus?.(t(gesture.operation === 'remove' ? 'canvas.selectionRemoved' : 'canvas.selectionAdded', { count: candidateIds.length }));
        }
        setGesture(null);
    };

    const handlePointerDown = event => {
        if (event.button === 2) return;
        const gripTarget = event.target.closest?.('[data-grip-id]');
        const gripId = gripTarget?.dataset?.gripId || null;
        const targetId = gripTarget?.dataset?.entityId || entityIdFromDrawingEvent(event);
        const targetEntity = content.entities.find(entity => entity.id === targetId);

        if (event.button === 1 || activeTool === 'pan' || spacePressed) {
            event.preventDefault();
            svgRef.current.setPointerCapture(event.pointerId);
            setGesture({ kind: 'pan', clientX: event.clientX, clientY: event.clientY, viewBox });
            return;
        }

        if (interactiveOperation && interactiveOperation.stage !== 'select') {
            event.preventDefault();
            if (interactiveOperation.type === 'trim') {
                const point = gesture?.kind === 'trim-fence' ? snapPoint(event, [], gesture.start) : snapPoint(event);
                showPointerFeedback(point);
                if (gesture?.kind === 'trim-fence') {
                    onInteractiveOperation?.({ fence: { first: gesture.start, second: point } });
                    setGesture(null);
                    return;
                }
                if (!targetEntity) {
                    setGesture({ kind: 'trim-fence', start: point, current: point });
                    setOperationPoint(point);
                    onStatus?.(t('canvas.trimFenceSecondPoint'));
                    return;
                }
                onInteractiveOperation?.({ point, targetId });
                return;
            }
            const point = interactivePoint(event);
            showPointerFeedback(point);
            onInteractiveOperation?.({
                point,
                targetId,
            });
            return;
        }

        if (activeTool === 'dimension') {
            const snapped = snapPoint(event, [], gesture?.kind === 'dimension' ? gesture.first : null);
            showPointerFeedback(snapped);
            if (gesture?.kind === 'dimension') {
                const dimension = createFreeDimension(content, gesture.first, snapped);
                if (dimension) {
                    onCommit(addEntity(content, dimension));
                    onSelectionChange([dimension.id]);
                    onStatus?.(t('canvas.freeDimensionAdded'));
                }
                setGesture(null);
                return;
            }
            const dimension = isDimensionableDrawingEntity(targetEntity) && !isDimensionPointSnap(snapped)
                ? createDimensionForEntity(content, targetEntity, dimensionMode, worldPoint(event))
                : null;
            if (dimension) {
                onCommit(addEntity(content, dimension));
                onSelectionChange([dimension.id]);
                onStatus?.(t('canvas.associativeDimensionAdded'));
            } else {
                setGesture({ kind: 'dimension', first: snapped, current: snapped });
                setHoverSnap(snapped.type ? snapped : null);
                onStatus?.(t('canvas.dimensionSecondPoint'));
            }
            return;
        }

        if (drawingTools.has(activeTool)) {
            const activeLayer = getLayer(content, content.activeLayerId);
            if (!activeLayer?.visible || activeLayer.locked) {
                onStatus?.(t('canvas.activeLayerUnavailable'));
                return;
            }
            const snapped = snapPoint(event);
            const finalPoint = gesture?.kind === 'draw' && activeTool === 'line'
                ? snapPoint(event, [], gesture.first)
                : snapped;
            showPointerFeedback(finalPoint);
            handleCreationPoint(finalPoint, targetId);
            return;
        }

        if (activeTool === 'select' || interactiveOperation?.stage === 'select') {
            if (gesture?.kind === 'select-window') {
                event.preventDefault();
                completeSelectionWindow(worldPoint(event));
                return;
            }
            if (!interactiveOperation && gripId && targetEntity && selectedSet.has(targetId) && canEditEntity(content, targetEntity)) {
                const source = targetEntity.sourceId ? content.entities.find(entity => entity.id === targetEntity.sourceId) : null;
                const origin = getEntityGrips(targetEntity, source).find(grip => grip.id === gripId);
                if (!origin) return;
                event.preventDefault();
                svgRef.current.setPointerCapture(event.pointerId);
                setGesture({
                    kind: 'grip',
                    entityId: targetId,
                    gripId,
                    origin,
                    startPointer: worldPoint(event),
                    current: origin,
                });
                return;
            }
            if (targetEntity && canSelectEntity(content, targetEntity)) {
                const operation = event.shiftKey ? 'remove' : 'add';
                onSelectionChange(applySelectionOperation(selectedIds, [targetId], operation));
                return;
            }
            const start = worldPoint(event);
            setGesture({
                kind: 'select-window',
                start,
                current: start,
                operation: event.shiftKey ? 'remove' : 'add',
            });
            setHoverSnap(null);
            return;
        }
    };

    const handlePointerMove = event => {
        if (gesture?.kind === 'pan') {
            const rect = svgRef.current.getBoundingClientRect();
            const dx = (event.clientX - gesture.clientX) / rect.width * gesture.viewBox.width;
            const dy = (event.clientY - gesture.clientY) / rect.height * gesture.viewBox.height;
            setViewBox({ ...gesture.viewBox, x: gesture.viewBox.x - dx, y: gesture.viewBox.y - dy });
            return;
        }
        if (gesture?.kind === 'trim-fence') {
            const point = snapPoint(event, [], gesture.start);
            setGesture(current => ({ ...current, current: point }));
            setOperationPoint(point);
            showPointerFeedback(point);
            setHoveredEntityId(null);
            return;
        }
        if (interactiveOperation && interactiveOperation.stage !== 'select') {
            if (interactiveOperation.type === 'trim') {
                const targetId = entityIdFromDrawingEvent(event);
                setHoveredEntityId(!interactiveOperation.scopeIds || interactiveOperation.scopeIds.includes(targetId) ? targetId : null);
                setOperationPoint(worldPoint(event));
                setHoverSnap(null);
                return;
            }
            const point = interactivePoint(event);
            setOperationPoint(point);
            showPointerFeedback(point);
            return;
        }
        if (gesture?.kind === 'draw') {
            const snapped = snapPoint(event, [], gesture.tool === 'line' ? gesture.first : null);
            setGesture(current => ({ ...current, current: snapped }));
            showPointerFeedback(snapped);
            return;
        }
        if (gesture?.kind === 'dimension') {
            const snapped = snapPoint(event, [], gesture.first);
            setGesture(current => ({ ...current, current: snapped }));
            showPointerFeedback(snapped);
            return;
        }
        if (gesture?.kind === 'select-window') {
            setGesture(current => ({ ...current, current: worldPoint(event) }));
            setHoverSnap(null);
            setHoveredEntityId(null);
            return;
        }
        if (gesture?.kind === 'grip') {
            const target = content.entities.find(entity => entity.id === gesture.entityId);
            const snapped = gripPoint(event, target);
            setGesture(current => ({ ...current, current: snapped }));
            showPointerFeedback(snapped);
            return;
        }
        const snapped = snapPoint(event);
        showPointerFeedback(snapped);
        const targetId = entityIdFromDrawingEvent(event);
        const target = content.entities.find(entity => entity.id === targetId);
        const selectionHover = activeTool === 'select' && target && canSelectEntity(content, target);
        const dimensionHover = activeTool === 'dimension' && isDimensionableDrawingEntity(target) && !isDimensionPointSnap(snapped);
        setHoveredEntityId(selectionHover || dimensionHover ? targetId : null);
    };

    const handlePointerUp = event => {
        if (gesture?.kind === 'pan') {
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
            setGesture(null);
            return;
        }
        if (gesture?.kind === 'select-window') {
            // Selection windows are confirmed by a second click, not by button
            // release, so pointer-up intentionally leaves the preview active.
            return;
        }
        if (gesture?.kind === 'grip') {
            const target = content.entities.find(entity => entity.id === gesture.entityId);
            const snapped = gripPoint(event, target);
            if (pointDistance(gesture.origin, snapped) > worldUnitsPerPixel) {
                const source = target?.sourceId ? content.entities.find(entity => entity.id === target.sourceId) : null;
                onCommit(updateSelectedEntities(content, [gesture.entityId], entity => editEntityGrip(entity, gesture.gripId, snapped, source)));
                onStatus?.(t('canvas.gripModified'));
            }
            setGesture(null);
            setHoverSnap(null);
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
            return;
        }
        if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    };

    const handleWheel = event => {
        event.preventDefault();
        const focus = worldPoint(event);
        setViewBox(current => zoomDrawingViewBox(current, event.deltaY > 0 ? 1.12 : 0.88, focus, canvasSize));
    };

    const previewContent = useMemo(() => {
        if (gesture?.kind === 'grip') {
            const target = content.entities.find(entity => entity.id === gesture.entityId);
            const source = target?.sourceId ? content.entities.find(entity => entity.id === target.sourceId) : null;
            return updateSelectedEntities(content, [gesture.entityId], entity => editEntityGrip(entity, gesture.gripId, gesture.current, source));
        }
        if (interactiveOperation && ['move', 'rotate', 'scale'].includes(interactiveOperation.type)
            && ['destination', 'angle', 'factor', 'reference'].includes(interactiveOperation.stage) && operationPoint) {
            if (['rotate', 'scale'].includes(interactiveOperation.type) && operationUsesCopy(interactiveOperation)) return content;
            return previewTransformContent(content, interactiveOperation, operationPoint);
        }
        return content;
    }, [content, gesture, interactiveOperation, operationPoint]);
    const offsetPreview = useMemo(() => {
        if (interactiveOperation?.type !== 'offset' || interactiveOperation.stage !== 'side' || !operationPoint) return [];
        return createOffsetPreviewEntities(
            content,
            interactiveOperation.entityIds,
            interactiveOperation.distance,
            operationPoint,
            { through: interactiveOperation.offsetMode === 'through' },
        );
    }, [content, interactiveOperation, operationPoint]);
    const transformCopyPreview = useMemo(() => (
        createTransformCopyPreviewEntities(content, interactiveOperation, operationPoint)
    ), [content, interactiveOperation, operationPoint]);
    const copyPreview = useMemo(() => {
        if (interactiveOperation?.type !== 'copy' || interactiveOperation.stage !== 'destination' || !operationPoint) return [];
        return createCopyPreviewEntities(
            content,
            interactiveOperation.entityIds,
            operationDelta(interactiveOperation.basePoint, operationPoint),
        );
    }, [content, interactiveOperation, operationPoint]);
    const mirrorDrafts = useMemo(
        () => createMirrorDraftEntities(content, interactiveOperation, operationPoint),
        [content, interactiveOperation, operationPoint],
    );
    const arrayDrafts = useMemo(
        () => createArrayDraftEntities(content, interactiveOperation, operationPoint),
        [content, interactiveOperation, operationPoint],
    );
    const gestureDraft = gesture?.kind === 'draw'
        ? ['rectangle', 'circle', 'polygon', 'arc'].includes(gesture.tool)
            ? buildCreationEntity(gesture, gesture.current, 'draft')
            : buildDrawingEntity(gesture.tool, gesture.first, gesture.current, content.activeLayerId, 'draft', {
                defaultText: t('document.defaultText'),
                options: { ...(gesture.options || {}), ...(creationOptions || {}) },
            })
        : gesture?.kind === 'dimension'
            ? { id: 'dimension-draft', type: 'line', layerId: content.activeLayerId, x1: gesture.first.x, y1: gesture.first.y, x2: gesture.current.x, y2: gesture.current.y }
            : gesture?.kind === 'trim-fence'
                ? { id: 'trim-fence-draft', type: 'line', layerId: content.activeLayerId, x1: gesture.start.x, y1: gesture.start.y, x2: gesture.current.x, y2: gesture.current.y }
                : null;
    const trimPreviewEntities = useMemo(() => createTrimPreviewEntities(content, {
        fence: gesture?.kind === 'trim-fence' ? { first: gesture.start, second: gesture.current } : null,
        targetId: interactiveOperation?.type === 'trim' ? hoveredEntityId : null,
        point: operationPoint,
        scopeIds: interactiveOperation?.scopeIds,
    }), [content, gesture, hoveredEntityId, interactiveOperation, operationPoint]);
    const draftEntities = [gestureDraft, ...mirrorDrafts, ...arrayDrafts, ...offsetPreview,
        ...copyPreview, ...transformCopyPreview, ...trimPreviewEntities].filter(Boolean);
    const markerSize = worldUnitsPerPixel * 12;
    const gripSize = worldUnitsPerPixel * 9;
    const selectionWindow = gesture?.kind === 'select-window'
        ? createSelectionWindow(gesture.start, gesture.current)
        : null;
    const previewSelectedIds = selectionWindow
        ? applySelectionOperation(selectedIds, drawingSelectionCandidates(content, selectionWindow), gesture.operation)
        : null;
    const tangentTargetIds = gesture?.kind === 'draw'
        && gesture.tool === 'circle'
        && ['tangentTangentRadius', 'tangentTangentTangent'].includes(gesture.mode)
        ? gesture.targetIds || []
        : [];
    const highlightedIds = interactiveOperation?.type === 'trim'
        ? []
        : [...new Set([...tangentTargetIds, ...(hoveredEntityId ? [hoveredEntityId] : [])])];

    const blurCreationControlBeforeDrawing = event => {
        if (!svgRef.current?.contains(event.target)) return;
        const focused = document.activeElement;
        if (focused && wrapperRef.current?.contains(focused) && /^(?:INPUT|SELECT|TEXTAREA|BUTTON)$/.test(focused.tagName)) {
            focused.blur();
        }
    };

    return (
        <div
            ref={wrapperRef}
            className={`drawing-canvas is-tool-${activeTool}${hoverSnap ? ' has-snap-marker' : ''}`}
            onPointerDownCapture={blurCreationControlBeforeDrawing}
        >
            <svg
                ref={svgRef}
                className="drawing-canvas-svg"
                viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => setGesture(null)}
                onPointerLeave={() => {
                    if (interactiveOperation && !gesture) setOperationPoint(null);
                    setHoveredEntityId(null);
                    setHoverSnap(null);
                }}
                onWheel={handleWheel}
                onContextMenu={event => event.preventDefault()}
                role="application"
                aria-label={t('canvas.area')}
            >
                <DrawingGrid content={content} viewBox={viewBox} worldUnitsPerPixel={worldUnitsPerPixel} />
                <DrawingScene
                    content={previewContent}
                    assets={assets}
                    selectedIds={selectedIds}
                    previewSelectedIds={previewSelectedIds}
                    highlightedIds={highlightedIds}
                    interactive
                    dimensionTextSize={Math.max(0.18, viewBox.width / 85)}
                    draftEntities={draftEntities}
                    showGrips={activeTool === 'select' && !interactiveOperation}
                    gripSize={gripSize}
                    hiddenIds={arrayDrafts.some(entity => entity.id === 'array-preview') ? interactiveOperation?.entityIds : []}
                />
                <DrawingInteractionOverlay
                    selectionWindow={selectionWindow}
                    hoverSnap={hoverSnap}
                    trackingGuides={hoverSnap?.guides || (hoverSnap?.guide ? [hoverSnap.guide] : [])}
                    markerSize={markerSize}
                    viewBox={viewBox}
                    arrayOperation={interactiveOperation}
                    referenceOperation={interactiveOperation?.stage === 'reference' ? interactiveOperation : null}
                    referencePoint={operationPoint}
                    onArrayHandleChange={(arrayHandle, event) => { const point = interactivePoint(event, arrayHandle); showPointerFeedback(point); onInteractiveOperation?.({ arrayHandle, point }); }}
                />
            </svg>
            <DrawingCreationControls
                activeTool={activeTool}
                mode={creationMode}
                options={creationOptions}
                onChange={updateCreationConfig}
                editEntity={editEntity}
                onEditChange={onEditEntityChange}
            />
        </div>
    );
});

function constrainRemoteOrthogonalPoint(point, origin) {
    return Math.abs(point.x - origin.x) >= Math.abs(point.y - origin.y)
        ? { ...point, y: origin.y }
        : { ...point, x: origin.x };
}

function drawingCircleSafety(viewBox) {
    const span = Math.max(1, Math.abs(Number(viewBox?.width) || 0), Math.abs(Number(viewBox?.height) || 0));
    const extent = Math.max(
        Math.abs(Number(viewBox?.x) || 0),
        Math.abs((Number(viewBox?.x) || 0) + (Number(viewBox?.width) || 0)),
        Math.abs(Number(viewBox?.y) || 0),
        Math.abs((Number(viewBox?.y) || 0) + (Number(viewBox?.height) || 0)),
    );
    return {
        relativeCollinearityTolerance: 1e-10,
        maxRadiusFactor: 10_000,
        maxRadius: Math.min(1e12, span * 10_000),
        maxCoordinate: Math.min(1e12, extent + span * 10_000),
    };
}

export default DrawingCanvas;
