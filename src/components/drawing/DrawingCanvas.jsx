import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import DrawingInteractionOverlay from '~components/drawing/DrawingInteractionOverlay';
import DrawingCreationControls from '~components/drawing/DrawingCreationControls';
import DrawingDynamicInput from '~components/drawing/DrawingDynamicInput';
import DrawingGrid from '~components/drawing/DrawingGrid';
import DrawingScene from '~components/drawing/DrawingScene';
import { useI18n } from '~i18n/I18nProvider';
import { createArrayDraftEntities, createMirrorDraftEntities } from '~utils/drawingCompoundOperations';
import {
    createBlendPreviewEntities,
    createChamferPathPreviewEntities,
    createChamferPreviewEntities,
    createFilletPathPreviewEntities,
    createFilletPreviewEntities,
} from '~utils/drawingCornerOperations';
import { createAlignPreviewEntities } from '~utils/drawingAlignOperations';
import { getAlignPreviewPairs } from '~utils/drawingAlignCommand';
import {
    createBreakPreviewEntities,
    createLengthenPreviewEntities,
} from '~utils/drawingBreakLengthenOperations';
import { pasteDrawingClipboardPayload } from '~utils/drawingClipboard';
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
    getInteractiveOperationPointMode,
    getTrimExtendPointMode,
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
import {
    addTrackingAnchor,
    constrainOrthogonalPoint,
    createTemporaryTrackingAnchor,
    createTrackingAnchor,
    resolveDrawingSnap,
} from '~utils/drawingTracking';
import { isOrthoTrackingEnabled } from '~utils/drawingDraftingSettings';
import { createExtendPreviewEntities, createTrimPreviewEntities } from '~utils/drawingTrimOperations';
import { getOperationOrthogonalOrigin } from '~utils/drawingOperationOptions';
import { drawingDynamicInputAnchor } from '~utils/drawingPrecisionInput';
import { createStretchPreviewEntities } from '~utils/drawingStretchOperations';
import { scaleDrawingViewBox, zoomDrawingViewBox } from '~utils/drawingViewport';

const drawingTools = new Set(['line', 'rectangle', 'circle', 'polygon', 'arc', 'text']);
const cornerOperationTypes = new Set(['fillet', 'chamfer', 'blend']);
const trimExtendTypes = new Set(['trim', 'extend']);
const breakStretchLengthenTypes = new Set(['break', 'breakAtPoint', 'stretch', 'lengthen']);
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
    dynamicInput = null,
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
    const [temporaryTrackingPointMode, setTemporaryTrackingPointMode] = useState(false);
    const [operationPoint, setOperationPoint] = useState(null);
    const [operationShift, setOperationShift] = useState(false);
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
        if (!trimExtendTypes.has(interactiveOperation?.type) && gesture?.kind === 'trim-fence') setGesture(null);
        if (!trimExtendTypes.has(interactiveOperation?.type)) setOperationShift(false);
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

    useEffect(() => {
        setTrackingAnchors([]);
        setTemporaryTrackingPointMode(false);
    }, [activeTool, interactiveOperation?.type]);

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
        const preserveRawTarget = interactiveOperation
            && getInteractiveOperationPointMode(interactiveOperation.type, {
                shift: options.shift,
                targetId,
                fence: gesture?.kind === 'trim-fence',
            }) === 'raw';
        const orthogonalOrigin = gestureReferenceOrigin(gesture)
            || getOperationOrthogonalOrigin(interactiveOperation);
        let point = { x: Number(rawPoint.x), y: Number(rawPoint.y) };
        if (options.snap && !preserveRawTarget) {
            point = resolveDrawingSnap(point, content, getViewBoxWorldUnitsPerPixel(viewBox, canvasSize) * 12, {
                excludeIds: interactiveOperation?.type === 'offset' ? (interactiveOperation.entityIds || []) : [],
                trackingAnchors,
                orthogonalOrigin,
                temporaryOrtho: Boolean(options.shift),
            });
        } else if (!preserveRawTarget && !options.precision && orthogonalOrigin
            && isOrthoTrackingEnabled(content.settings, options.shift)) {
            point = constrainOrthogonalPoint(orthogonalOrigin, point);
        }
        setOperationPoint(point);
        showPointerFeedback(point);

        if (temporaryTrackingPointMode) {
            acquireTemporaryTrackingPoint(point);
            return true;
        }

        if (interactiveOperation && interactiveOperation.stage !== 'select') {
            if (trimExtendTypes.has(interactiveOperation.type)) {
                const operationType = options.shift
                    ? interactiveOperation.type === 'trim' ? 'extend' : 'trim'
                    : interactiveOperation.type;
                if (gesture?.kind === 'trim-fence') {
                    onInteractiveOperation?.({
                        fence: { points: [...(gesture.points || [gesture.start]), point] },
                        shift: gesture.shift,
                    });
                    setGesture(null);
                } else if (targetEntity) {
                    onInteractiveOperation?.({ point, targetId, shift: options.shift });
                } else if (operationType === 'trim') {
                    setGesture({
                        kind: 'trim-fence',
                        start: point,
                        current: point,
                        points: [point],
                        shift: interactiveOperation.type === 'extend',
                    });
                    onStatus?.(t('canvas.trimFenceSecondPoint'));
                } else {
                    onInteractiveOperation?.({ point, targetId: null, shift: options.shift });
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
            setTemporaryTrackingPointMode(false);
        },
        beginTemporaryTrackingPoint() {
            setTemporaryTrackingPointMode(true);
            onStatus?.(t('canvas.trackingPointPrompt'));
            return true;
        },
        getOperationPoint() {
            return operationPoint;
        },
        getPrecisionInputContext() {
            return {
                referencePoint: gestureReferenceOrigin(gesture)
                    || getOperationOrthogonalOrigin(interactiveOperation),
                directionPoint: gesture?.current || operationPoint,
            };
        },
        getViewportCenter() {
            return { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
        },
        submitPoint(point, options) {
            return submitRemotePoint(point, options);
        },
    }), [activeTool, canvasSize, content, creationMode, creationOptions, dimensionMode, gesture, interactiveOperation, operationPoint, selectedIds, submitCreationInput, submitCreationInputForTool, t, temporaryTrackingPointMode, trackingAnchors, viewBox]);

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
            temporaryOrtho: Boolean(event.shiftKey),
        });
    };

    const showPointerFeedback = point => {
        setHoverSnap(point?.type ? point : null);
        const anchor = content.settings?.tracking ? createTrackingAnchor(point, content.settings) : null;
        if (anchor) setTrackingAnchors(current => addTrackingAnchor(current, anchor));
    };

    const acquireTemporaryTrackingPoint = point => {
        const anchor = createTemporaryTrackingAnchor(point, content.settings);
        if (!anchor) return false;
        setTrackingAnchors(current => addTrackingAnchor(current, anchor));
        setTemporaryTrackingPointMode(false);
        setHoverSnap(point?.type ? point : null);
        onStatus?.(t('canvas.trackingPointAcquired'));
        return true;
    };

    const interactivePoint = (event, arrayHandle = null) => {
        const raw = worldPoint(event);
        const excludeIds = interactiveOperation?.type === 'offset' ? (interactiveOperation.entityIds || []) : [];
        const orthogonalOrigin = getOperationOrthogonalOrigin(interactiveOperation, arrayHandle);
        return resolveDrawingSnap(raw, content, worldUnitsPerPixel * 12, {
            excludeIds,
            trackingAnchors,
            orthogonalOrigin,
            temporaryOrtho: Boolean(event.shiftKey),
        });
    };

    const gripPoint = (event, target) => {
        const raw = worldPoint(event);
        const desired = { x: gesture.origin.x + raw.x - gesture.startPointer.x, y: gesture.origin.y + raw.y - gesture.startPointer.y };
        const orthogonalOrigin = target?.type !== 'line' ? gesture.origin : null;
        const snapped = resolveDrawingSnap(desired, content, worldUnitsPerPixel * 12, {
            excludeIds: [gesture.entityId], trackingAnchors, orthogonalOrigin, temporaryOrtho: Boolean(event.shiftKey),
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

        if (temporaryTrackingPointMode) {
            event.preventDefault();
            const point = snapPoint(
                event,
                [],
                gestureReferenceOrigin(gesture) || getOperationOrthogonalOrigin(interactiveOperation),
            );
            showPointerFeedback(point);
            acquireTemporaryTrackingPoint(point);
            return;
        }

        if (interactiveOperation && interactiveOperation.stage !== 'select') {
            event.preventDefault();
            if (trimExtendTypes.has(interactiveOperation.type)) {
                const pointMode = getTrimExtendPointMode(interactiveOperation.type, {
                    shift: event.shiftKey,
                    targetId,
                    fence: gesture?.kind === 'trim-fence',
                });
                const point = pointMode === 'raw'
                    ? worldPoint(event)
                    : gesture?.kind === 'trim-fence' ? snapPoint(event, [], gesture.start) : snapPoint(event);
                showPointerFeedback(point);
                if (gesture?.kind === 'trim-fence') {
                    onInteractiveOperation?.({
                        fence: { points: [...(gesture.points || [gesture.start]), point] },
                        shift: gesture.shift,
                    });
                    setGesture(null);
                    return;
                }
                const operationType = event.shiftKey
                    ? interactiveOperation.type === 'trim' ? 'extend' : 'trim'
                    : interactiveOperation.type;
                if (!targetEntity && operationType === 'trim') {
                    svgRef.current.setPointerCapture(event.pointerId);
                    setGesture({
                        kind: 'trim-fence',
                        start: point,
                        current: point,
                        points: [point],
                        pointerId: event.pointerId,
                        shift: interactiveOperation.type === 'extend',
                    });
                    setOperationPoint(point);
                    onStatus?.(t('canvas.trimFenceSecondPoint'));
                    return;
                }
                onInteractiveOperation?.({ point, targetId, shift: event.shiftKey });
                return;
            }
            if (cornerOperationTypes.has(interactiveOperation.type)) {
                const point = worldPoint(event);
                setOperationPoint(point);
                setHoverSnap(null);
                onInteractiveOperation?.({ point, targetId });
                return;
            }
            if (breakStretchLengthenTypes.has(interactiveOperation.type)) {
                const point = interactivePoint(event);
                showPointerFeedback(point);
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
            const finalPoint = snapPoint(event, [], gestureReferenceOrigin(gesture));
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
            setGesture(current => {
                const points = current.points || [current.start];
                const dragging = Boolean(event.buttons & 1);
                const last = points[points.length - 1];
                return {
                    ...current,
                    current: point,
                    points: dragging && pointDistance(last, point) >= worldUnitsPerPixel * 3
                        ? points.length < 4096 ? [...points, point] : points
                        : points,
                };
            });
            setOperationPoint(point);
            showPointerFeedback(point);
            setHoveredEntityId(null);
            return;
        }
        if (interactiveOperation && interactiveOperation.stage !== 'select') {
            if (trimExtendTypes.has(interactiveOperation.type)) {
                const targetId = entityIdFromDrawingEvent(event);
                const pointMode = getTrimExtendPointMode(interactiveOperation.type, {
                    shift: event.shiftKey,
                    targetId,
                });
                const point = pointMode === 'raw' ? worldPoint(event) : snapPoint(event);
                setHoveredEntityId(targetId || null);
                setOperationPoint(point);
                setOperationShift(event.shiftKey);
                if (pointMode === 'raw') setHoverSnap(null);
                else showPointerFeedback(point);
                return;
            }
            if (cornerOperationTypes.has(interactiveOperation.type)) {
                const point = worldPoint(event);
                const targetId = entityIdFromDrawingEvent(event);
                setHoveredEntityId(targetId || null);
                setOperationPoint(point);
                setHoverSnap(null);
                return;
            }
            if (breakStretchLengthenTypes.has(interactiveOperation.type)) {
                const point = interactivePoint(event);
                const targetId = entityIdFromDrawingEvent(event);
                const targetStage = ['break-first', 'break-at-point', 'lengthen-pick'].includes(interactiveOperation.stage);
                setHoveredEntityId(targetStage ? targetId || null : null);
                setOperationPoint(point);
                showPointerFeedback(point);
                return;
            }
            const point = interactivePoint(event);
            setOperationPoint(point);
            showPointerFeedback(point);
            return;
        }
        if (gesture?.kind === 'draw') {
            const snapped = snapPoint(event, [], gestureReferenceOrigin(gesture));
            setGesture(current => ({ ...current, current: snapped }));
            showPointerFeedback(snapped);
            return;
        }
        if (gesture?.kind === 'dimension') {
            const snapped = snapPoint(event, [], gestureReferenceOrigin(gesture));
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
        setOperationPoint(snapped);
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
        if (gesture?.kind === 'trim-fence' && (gesture.points?.length || 0) > 1) {
            const point = snapPoint(event, [], gesture.start);
            const points = [...gesture.points];
            if (pointDistance(points[points.length - 1], point) > worldUnitsPerPixel) points.push(point);
            onInteractiveOperation?.({ fence: { points }, shift: gesture.shift });
            setGesture(null);
            setOperationPoint(null);
            setHoverSnap(null);
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
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
    const alignDrafts = useMemo(() => {
        const pairs = getAlignPreviewPairs(interactiveOperation, operationPoint);
        return pairs ? createAlignPreviewEntities(content, interactiveOperation.entityIds, pairs) : [];
    }, [content, interactiveOperation, operationPoint]);
    const clipboardPreview = useMemo(() => {
        if (!['pasteClip', 'pasteBlock'].includes(interactiveOperation?.type)
            || !interactiveOperation.payload || !operationPoint) return null;
        try {
            const result = pasteDrawingClipboardPayload({ content, assets }, interactiveOperation.payload, {
                mode: interactiveOperation.type === 'pasteBlock' ? 'block' : 'insert',
                insertionPoint: operationPoint,
            });
            return {
                content: {
                    ...content,
                    layers: result.content.layers,
                    blocks: result.content.blocks,
                },
                assets: result.assets,
                entities: result.entities.map(entity => ({ ...entity, previewMode: 'copy' })),
            };
        } catch {
            return null;
        }
    }, [assets, content, interactiveOperation, operationPoint]);
    const cornerDrafts = useMemo(() => {
        if (!cornerOperationTypes.has(interactiveOperation?.type) || !hoveredEntityId || !operationPoint) return [];
        const hovered = content.entities.find(entity => entity.id === hoveredEntityId);
        if (!hovered) return [];
        const options = {
            keepSources: interactiveOperation.keepSources,
            distance1: interactiveOperation.distance1,
            distance2: interactiveOperation.distance2,
            ...(Number.isFinite(interactiveOperation.angleDegrees)
                ? { angleDegrees: interactiveOperation.angleDegrees }
                : {}),
        };
        if (interactiveOperation.pathMode && interactiveOperation.type !== 'blend') {
            return interactiveOperation.type === 'fillet'
                ? createFilletPathPreviewEntities(hovered, interactiveOperation.radius, options)
                : createChamferPathPreviewEntities(hovered, options);
        }
        if (!interactiveOperation.firstId || hovered.id === interactiveOperation.firstId) return [];
        const first = content.entities.find(entity => entity.id === interactiveOperation.firstId);
        if (!first) return [];
        if (interactiveOperation.type === 'fillet') {
            return createFilletPreviewEntities(
                first,
                interactiveOperation.firstPick,
                hovered,
                operationPoint,
                interactiveOperation.radius,
                options,
            );
        }
        if (interactiveOperation.type === 'chamfer') {
            return createChamferPreviewEntities(
                first,
                interactiveOperation.firstPick,
                hovered,
                operationPoint,
                options,
            );
        }
        return createBlendPreviewEntities(first, interactiveOperation.firstPick, hovered, operationPoint, options);
    }, [content, hoveredEntityId, interactiveOperation, operationPoint]);
    const breakDrafts = useMemo(() => {
        if (!['break', 'breakAtPoint'].includes(interactiveOperation?.type) || !operationPoint) return [];
        if (interactiveOperation.stage === 'break-second') {
            return createBreakPreviewEntities(content, {
                targetId: interactiveOperation.targetId,
                firstPoint: interactiveOperation.firstPoint,
                secondPoint: operationPoint,
            });
        }
        if (interactiveOperation.stage === 'break-at-point' && hoveredEntityId) {
            return createBreakPreviewEntities(content, {
                targetId: hoveredEntityId,
                point: operationPoint,
                atPoint: true,
            });
        }
        return [];
    }, [content, hoveredEntityId, interactiveOperation, operationPoint]);
    const lengthenDrafts = useMemo(() => {
        if (interactiveOperation?.type !== 'lengthen' || !operationPoint) return [];
        if (interactiveOperation.stage === 'lengthen-dynamic') {
            return createLengthenPreviewEntities(content, {
                targetId: interactiveOperation.targetId,
                point: interactiveOperation.pickPoint,
                mode: 'dynamic',
                dynamicPoint: operationPoint,
            });
        }
        if (interactiveOperation.stage === 'lengthen-pick'
            && interactiveOperation.mode !== 'dynamic' && hoveredEntityId) {
            return createLengthenPreviewEntities(content, {
                targetId: hoveredEntityId,
                point: operationPoint,
                mode: interactiveOperation.mode,
                value: interactiveOperation.value,
            });
        }
        return [];
    }, [content, hoveredEntityId, interactiveOperation, operationPoint]);
    const stretchDrafts = useMemo(() => (
        interactiveOperation?.type === 'stretch'
            && interactiveOperation.stage === 'stretch-second'
            && operationPoint
            ? createStretchPreviewEntities(content, interactiveOperation, operationPoint)
            : []
    ), [content, interactiveOperation, operationPoint]);
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
                ? { id: 'trim-fence-draft', type: 'polyline', layerId: content.activeLayerId,
                    points: [...(gesture.points || [gesture.start]), gesture.current], closed: false }
                : null;
    const trimExtendPreviewType = operationShift
        ? interactiveOperation?.type === 'trim' ? 'extend' : 'trim'
        : interactiveOperation?.type;
    const trimPreviewEntities = useMemo(() => createTrimPreviewEntities(content, {
        fence: gesture?.kind === 'trim-fence'
            ? { points: [...(gesture.points || [gesture.start]), gesture.current] }
            : null,
        targetId: trimExtendPreviewType === 'trim' ? hoveredEntityId : null,
        point: operationPoint,
        boundaryIds: interactiveOperation?.boundaryIds,
        extendEdges: interactiveOperation?.extendEdges,
        projection: interactiveOperation?.projection,
    }), [content, gesture, hoveredEntityId, interactiveOperation, operationPoint, trimExtendPreviewType]);
    const extendPreviewEntities = useMemo(() => createExtendPreviewEntities(content, {
        targetId: trimExtendPreviewType === 'extend' ? hoveredEntityId : null,
        point: operationPoint,
        boundaryIds: interactiveOperation?.boundaryIds,
        extendEdges: interactiveOperation?.extendEdges,
        projection: interactiveOperation?.projection,
    }), [content, hoveredEntityId, interactiveOperation, operationPoint, trimExtendPreviewType]);
    const draftEntities = [gestureDraft, ...mirrorDrafts, ...arrayDrafts, ...alignDrafts, ...cornerDrafts,
        ...breakDrafts, ...stretchDrafts, ...lengthenDrafts,
        ...(clipboardPreview?.entities || []), ...offsetPreview,
        ...copyPreview, ...transformCopyPreview, ...trimPreviewEntities, ...extendPreviewEntities].filter(Boolean);
    const markerSize = worldUnitsPerPixel * 12;
    const gripSize = worldUnitsPerPixel * 9;
    const stretchSelectionWindow = interactiveOperation?.type === 'stretch'
        && interactiveOperation.stage === 'stretch-window-second'
        && interactiveOperation.windowStart && operationPoint
        ? { ...createSelectionWindow(interactiveOperation.windowStart, operationPoint), mode: 'crossing' }
        : null;
    const selectionWindow = gesture?.kind === 'select-window'
        ? createSelectionWindow(gesture.start, gesture.current)
        : stretchSelectionWindow;
    const previewSelectedIds = selectionWindow
        ? applySelectionOperation(
            selectedIds,
            drawingSelectionCandidates(content, selectionWindow).filter(id => (
                !stretchSelectionWindow || !interactiveOperation.targetIds || interactiveOperation.targetIds.includes(id)
            )),
            gesture?.operation,
        )
        : null;
    const tangentTargetIds = gesture?.kind === 'draw'
        && gesture.tool === 'circle'
        && ['tangentTangentRadius', 'tangentTangentTangent'].includes(gesture.mode)
        ? gesture.targetIds || []
        : [];
    const highlightedIds = trimExtendTypes.has(interactiveOperation?.type)
        ? []
        : [...new Set([
            ...tangentTargetIds,
            ...(interactiveOperation?.firstId ? [interactiveOperation.firstId] : []),
            ...(hoveredEntityId ? [hoveredEntityId] : []),
        ])];
    const cornerHiddenIds = cornerDrafts.length && !interactiveOperation?.keepSources
        && ['fillet', 'chamfer'].includes(interactiveOperation?.type)
        ? interactiveOperation.pathMode
            ? [hoveredEntityId]
            : [interactiveOperation.firstId, hoveredEntityId].filter(Boolean)
        : [];
    const modificationHiddenIds = [
        ...(breakDrafts.length && interactiveOperation?.stage === 'break-second'
            ? [interactiveOperation.targetId].filter(Boolean) : []),
        ...(lengthenDrafts.length && interactiveOperation?.stage === 'lengthen-dynamic'
            ? [interactiveOperation.targetId].filter(Boolean) : []),
        ...stretchDrafts.map(entity => entity.id.replace(/^stretch-preview-/, '')),
    ];
    const previewHiddenIds = [...new Set([
        ...(arrayDrafts.some(entity => entity.id === 'array-preview') || alignDrafts.length
            ? interactiveOperation?.entityIds || []
            : []),
        ...cornerHiddenIds,
        ...modificationHiddenIds,
    ])];
    const dynamicInputVisible = Boolean(content.settings?.dynamicInput && dynamicInput && (
        drawingTools.has(activeTool)
        || activeTool === 'dimension'
        || (interactiveOperation && interactiveOperation.stage !== 'select')
    ));
    const dynamicInputPoint = gesture?.current || operationPoint;
    const dynamicInputPosition = dynamicInputVisible
        ? drawingDynamicInputAnchor(dynamicInputPoint, viewBox, canvasSize)
        : null;

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
                    content={clipboardPreview ? { ...previewContent, layers: clipboardPreview.content.layers, blocks: clipboardPreview.content.blocks } : previewContent}
                    assets={clipboardPreview?.assets || assets}
                    selectedIds={selectedIds}
                    previewSelectedIds={previewSelectedIds}
                    highlightedIds={highlightedIds}
                    interactive
                    dimensionTextSize={Math.max(0.18, viewBox.width / 85)}
                    draftEntities={draftEntities}
                    showGrips={activeTool === 'select' && !interactiveOperation}
                    gripSize={gripSize}
                    hiddenIds={previewHiddenIds}
                    hitOnlyIds={cornerHiddenIds}
                    viewBox={viewBox}
                />
                <DrawingInteractionOverlay
                    selectionWindow={selectionWindow}
                    hoverSnap={hoverSnap}
                    trackingGuides={hoverSnap?.guides || (hoverSnap?.guide ? [hoverSnap.guide] : [])}
                    trackingAnchors={trackingAnchors}
                    markerSize={markerSize}
                    viewBox={viewBox}
                    arrayOperation={interactiveOperation}
                    alignOperation={interactiveOperation?.type === 'align' ? interactiveOperation : null}
                    referenceOperation={interactiveOperation?.stage === 'reference' ? interactiveOperation : null}
                    referencePoint={operationPoint}
                    onArrayHandleChange={(arrayHandle, event) => { const point = interactivePoint(event, arrayHandle); showPointerFeedback(point); onInteractiveOperation?.({ arrayHandle, point }); }}
                />
            </svg>
            <DrawingDynamicInput
                {...dynamicInput}
                anchor={dynamicInputPosition}
                enabled={dynamicInputVisible}
            />
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

function gestureReferenceOrigin(gesture) {
    if (!gesture) return null;
    if (gesture.kind === 'dimension') return gesture.first || null;
    if (gesture.kind === 'trim-fence') return gesture.start || null;
    if (gesture.kind !== 'draw') return null;
    if (['tangentTangentRadius', 'tangentTangentTangent'].includes(gesture.mode)) return null;
    const points = Array.isArray(gesture.points) ? gesture.points : [];
    return points[points.length - 1] || gesture.first || null;
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
