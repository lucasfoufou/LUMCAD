import { rebuildDrawingToleranceEntity } from '~utils/drawingTolerances';
import { rebuildDrawingTableEntity } from '~utils/drawingTableGeometry';
import { previewDrawingRevision } from '~utils/drawingRevisionSymbols';
import { beginDrawingSketch, appendDrawingSketch, drawingSketchEntities } from '~utils/drawingSketch';
import { previewDrawingLinework } from '~utils/drawingLinework';
import { createPortal } from 'react-dom';
import DrawingCoordinateOverlay from '~components/drawing/DrawingCoordinateOverlay';
import { drawingPointWithinLimits } from '~utils/drawingCoordinates';
import { isDrawingLayerVisible } from '~utils/drawingLayers';
import { editDrawingLeaderGrip } from '~utils/drawingLeaders';
import { namedDrawingViewBox } from '~utils/drawingNamedViews';
import { expandDrawingGroupSelection } from '~utils/drawingGroups';
import { spaceDimensionsAtPoint } from '~utils/drawingDimensionSpacing';
import { placeDimensionTextAtPoint, advanceDimensionBreak } from '~utils/drawingDimensionMaintenance';
import { drawingAffineFrame, framedDrawingPoint } from '~utils/drawingAffineFrame';
import { affineMatrixToSvg, inverseAffineViewBox } from '~utils/drawingAffine';
import { insertNamedDrawingBlock } from '~utils/drawingNamedBlocks';
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

import DrawingInteractionOverlay from '~components/drawing/DrawingInteractionOverlay';
import DrawingCreationControls from '~components/drawing/DrawingCreationControls';
import DrawingDynamicInput from '~components/drawing/DrawingDynamicInput';
import DrawingGrid from '~components/drawing/DrawingGrid';
import DrawingScene from '~components/drawing/DrawingScene';
import { DrawingTextEditor } from '~components/drawing/DrawingTextEditor';
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
    getEntityColor,
    getLayer,
    updateSelectedEntities,
} from '~utils/drawingDocument';
import {
    clientPointToViewBox,
    createTangentCircle,
    findThreeEntityTangentCircles,
    fitViewBox,
    fitDrawingBounds,
    getDimensionGeometry,
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
import { buildSplineCreationEntity, buildSplineCreationPreview, MAX_SPLINE_CREATION_POINTS } from '~utils/drawingSplineCreation';
import { buildEllipseCreationEntity, buildEllipseCreationPreview, ellipseCreationPointCount } from '~utils/drawingEllipseCreation';
import { buildDrawingEntity } from '~utils/drawingEntityFactory';
import { DRAWING_QDIM_GRIP_IDS, getDrawingEntityDependencyIds } from '~utils/drawingDimensions';
import {
    createAngularDimensionResult,
    createOrdinateDimensionResult,
    rebuildQdimSeriesFromGripResult,
} from '~utils/drawingDimensionCommands';
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
import { drawingTextFontSizeToPixels, resolveDrawingTextStyle, normalizeDrawingTextEntity } from '~utils/drawingText';

const drawingTools = new Set(['point', 'line', 'xline', 'ray', 'ellipse', 'spline', 'rectangle', 'circle', 'polygon', 'arc', 'text']);
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
    onEndCoalescing,
    interactiveOperation = null,
    onInteractiveOperation,
    dimensionMode = 'auto',
    editEntity = null,
    onEditEntityChange = null,
    creationControlsTarget = null,
    onCancelCommand = null,
    onImageSource = null,
    imageSourceBusy = false,
    onEntityCreated = null,
    dynamicInput = null,
    backgroundContext = null,
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
    const [editingTextId, setEditingTextId] = useState(null);
    const [editingTextInitialSelection, setEditingTextInitialSelection] = useState(null);
    const initialCreationConfigRef = useRef(createDefaultDrawingCreationConfig(activeTool));
    const [creationMode, setCreationMode] = useState(initialCreationConfigRef.current.mode);
    const [creationOptions, setCreationOptions] = useState(initialCreationConfigRef.current.options);
    const rememberedCreationConfigsRef = useRef(new Map());
    const pendingCreationRef = useRef(null);
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const editingText = useMemo(() => (
        content.entities.find(entity => entity.id === editingTextId && entity.type === 'text') || null
    ), [content.entities, editingTextId]);

    useEffect(() => {
        if (editingTextId && !editingText) {
            setEditingTextId(null);
            setEditingTextInitialSelection(null);
        }
    }, [editingText, editingTextId]);

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
        const defaults = createDefaultDrawingCreationConfig(activeTool);
        const next = pending || remembered || (activeTool === 'text'
            ? {
                ...defaults,
                options: {
                    ...defaults.options,
                    textStyleId: content.activeTextStyleId || defaults.options.textStyleId,
                },
            }
            : defaults);
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
        if (drawGesture.tool === 'spline') return buildSplineCreationPreview(points, content.activeLayerId, drawGesture.mode);
        if (drawGesture.tool === 'ellipse') return buildEllipseCreationPreview(points, content.activeLayerId, drawGesture.mode, options, id);
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
        onCommit(
            addEntity(content, nextEntity),
            nextEntity.type === 'text' ? { coalesceKey: `text-edit-${nextEntity.id}` } : undefined,
        );
        onSelectionChange([nextEntity.id]);
        onEntityCreated?.(nextEntity);
        if (nextEntity.type === 'text') {
            setEditingTextInitialSelection({ start: 0, end: String(nextEntity.text || '').length });
            setEditingTextId(nextEntity.id);
        }
        setGesture(null);
        return true;
    };

    const creationStatus = (mode, pointCount) => {
        if (activeTool === 'spline') return t('canvas.splinePoint', { count: pointCount, minimum: mode === 'control' ? 4 : 2 });
        if (activeTool === 'ellipse') return t(pointCount < 2 ? 'canvas.ellipseAxisPoint'
            : pointCount < 3 ? 'canvas.ellipseRadiusPoint'
                : pointCount < 4 ? 'canvas.ellipseStartPoint' : 'canvas.ellipseEndPoint');
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

        if (activeTool === 'point') return commitCreationEntity(buildDrawingEntity('point', point, point, content.activeLayerId, null, { options: { pointStyle: content.settings?.pointStyle } }));
        const currentGesture = gesture?.kind === 'draw' && gesture.tool === activeTool ? gesture : null;
        const points = currentGesture ? [...(currentGesture.points || [currentGesture.first]), point] : [point];
        if (activeTool === 'spline' && (points.length > MAX_SPLINE_CREATION_POINTS
            || (points.length > 1 && pointDistance(points[points.length - 2], point) <= 1e-9))) {
            onStatus?.(t('canvas.splinePointInvalid', { maximum: MAX_SPLINE_CREATION_POINTS }));
            return false;
        }
        const nextGesture = {
            kind: 'draw',
            tool: activeTool,
            mode: creationMode,
            options: { ...(currentGesture?.options || {}), ...creationOptions },
            points,
            first: points[0],
            current: point,
        };
        const requiredPoints = activeTool === 'spline' ? Infinity : activeTool === 'ellipse' ? ellipseCreationPointCount(creationMode) : activeTool === 'arc' || (activeTool === 'circle' && creationMode === 'threePoint') ? 3 : 2;
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
            const entity = activeTool === 'ellipse'
                ? buildEllipseCreationEntity(points, content.activeLayerId, creationMode, nextGesture.options)
                : buildCreationEntity(nextGesture, point);
            if (!entity) {
                onStatus?.(t(activeTool === 'arc' ? 'canvas.arcInvalid' : 'canvas.creationInvalid'));
                setGesture(activeTool === 'ellipse' ? { ...nextGesture, points: points.slice(0, -1) } : nextGesture);
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
        if (!drawingTools.has(tool) || ['point', 'line', 'xline', 'ray', 'text'].includes(tool)) return false;
        if (tool === 'spline' && tool === activeTool && ['', 'DONE'].includes(String(rawValue).trim().toUpperCase())) {
            const entity = gesture?.kind === 'draw' && gesture.tool === 'spline'
                ? buildSplineCreationEntity(gesture.points, content.activeLayerId, gesture.mode) : null;
            if (entity) commitCreationEntity(entity);
            else onStatus?.(t('canvas.splineIncomplete', { minimum: creationMode === 'control' ? 4 : 2 }));
            return true;
        }
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

    const commitDimensionEntity = (dimension, statusKey = 'canvas.associativeDimensionAdded') => {
        if (!dimension) return false;
        onCommit(addEntity(content, dimension));
        onSelectionChange([dimension.id]);
        onStatus?.(t(statusKey));
        setGesture(null);
        return true;
    };

    const commitDimensionResult = result => {
        if (!result?.changed) return false;
        onCommit(result.content);
        onSelectionChange(result.selectedIds);
        onStatus?.(t('messages.dimensionCreated', { count: result.entities.length }));
        setGesture(null);
        return true;
    };

    const handleDimensionPoint = (point, targetEntity = null, hitPoint = point) => {
        const config = normalizeCanvasDimensionMode(dimensionMode);
        const mode = config.mode;
        if (mode === 'angular') {
            if (gesture?.kind === 'dimension' && gesture.dimensionKind === 'angular-lines') {
                if (targetEntity?.type !== 'line' || gesture.sourceIds.includes(targetEntity.id)) {
                    onStatus?.(t('canvas.angularSecondSource'));
                    return true;
                }
                const result = createAngularDimensionResult(content, [...gesture.sourceIds, targetEntity.id], {
                    sourcePickPoints: [...gesture.sourcePickPoints, hitPoint],
                });
                if (!commitDimensionResult(result)) onStatus?.(t('messages.dimensionSelectionRequired'));
                return true;
            }
            if (gesture?.kind === 'dimension' && gesture.dimensionKind === 'angular-free') {
                if (!gesture.ray1Point) {
                    setGesture(current => ({ ...current, ray1Point: point, current: point }));
                    onStatus?.(t('canvas.angularSecondRay'));
                    return true;
                }
                const radius = Math.max(
                    0.01,
                    pointDistance(gesture.first, gesture.ray1Point),
                    pointDistance(gesture.first, point),
                );
                const result = createAngularDimensionResult(content, [], {
                    vertex: gesture.first,
                    ray1Point: gesture.ray1Point,
                    ray2Point: point,
                    radius,
                });
                if (!commitDimensionResult(result)) onStatus?.(t('messages.dimensionSelectionRequired'));
                return true;
            }
            if (targetEntity?.type === 'arc') {
                return commitDimensionEntity(createDimensionForEntity(content, targetEntity, config, hitPoint));
            }
            if (targetEntity?.type === 'line') {
                setGesture({
                    kind: 'dimension',
                    dimensionKind: 'angular-lines',
                    sourceIds: [targetEntity.id],
                    sourcePickPoints: [hitPoint],
                    first: point,
                    current: point,
                });
                onStatus?.(t('canvas.angularSecondSource'));
                return true;
            }
            setGesture({
                kind: 'dimension',
                dimensionKind: 'angular-free',
                first: point,
                current: point,
                ray1Point: null,
            });
            onStatus?.(t('canvas.angularFirstRay'));
            return true;
        }

        if (mode === 'ordinate') {
            if (gesture?.kind === 'dimension' && gesture.dimensionKind === 'ordinate') {
                const dx = point.x - gesture.first.x;
                const dy = point.y - gesture.first.y;
                const axis = config.axis || (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y');
                const result = createOrdinateDimensionResult(content, [], {
                    axis,
                    origin: config.origin,
                    featurePoint: gesture.first,
                    leaderPoint: point,
                });
                if (!commitDimensionResult(result)) onStatus?.(t('messages.dimensionSelectionRequired'));
                return true;
            }
            if (isDimensionableDrawingEntity(targetEntity)) {
                return commitDimensionEntity(createDimensionForEntity(content, targetEntity, config, hitPoint));
            }
            setGesture({ kind: 'dimension', dimensionKind: 'ordinate', first: point, current: point });
            onStatus?.(t('canvas.ordinateLeaderPoint'));
            return true;
        }

        if (gesture?.kind === 'dimension') {
            const dimension = createFreeDimension(content, gesture.first, point, config);
            const committed = commitDimensionEntity(dimension, 'canvas.freeDimensionAdded');
            if (!committed) setGesture(null);
            return committed;
        }
        const dimension = isDimensionableDrawingEntity(targetEntity)
            ? createDimensionForEntity(content, targetEntity, config, hitPoint)
            : null;
        if (dimension) return commitDimensionEntity(dimension);
        if (['arcLength', 'radius', 'diameter', 'joggedRadius', 'centerMark'].includes(mode)) {
            onStatus?.(t('messages.dimensionSelectionRequired'));
            return true;
        }
        setGesture({ kind: 'dimension', dimensionKind: 'linear', first: point, current: point });
        onStatus?.(t('canvas.dimensionSecondPoint'));
        return true;
    };

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
            point = constrainOrthogonalPoint(orthogonalOrigin, point, content.settings?.ucs?.rotation || 0);
        }
        if ((interactiveOperation || activeTool !== 'select') && !drawingPointWithinLimits(point, content.settings)) {
            onStatus?.(t('coordinates.outsideLimits')); return true;
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
            return handleDimensionPoint(point, isDimensionableDrawingEntity(targetEntity) ? targetEntity : null, point);
        }

        if (drawingTools.has(activeTool)) {
            const activeLayer = getLayer(content, content.activeLayerId);
            if (!isDrawingLayerVisible(activeLayer) || activeLayer.locked) {
                onStatus?.(t('canvas.activeLayerUnavailable'));
                return false;
            }
            return handleCreationPoint(point, targetId);
        }

        if ((activeTool === 'select' || interactiveOperation?.stage === 'select') && targetEntity && canSelectEntity(content, targetEntity)) {
            onSelectionChange(applySelectionOperation(selectedIds, expandDrawingGroupSelection(content, [targetId]), options.shift ? 'remove' : 'add'));
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
            if (['line', 'xline', 'ray'].includes(tool)) {
                const length = values[0];
                const dx = current.x - first.x;
                const dy = current.y - first.y;
                const directionLength = Math.hypot(dx, dy) || 1;
                return commitDraft(tool, first, { x: first.x + dx / directionLength * length, y: first.y + dy / directionLength * length }, { continueLine: tool === 'line' });
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
                const entity = buildCreationEntity(gesture, {
                    x: first.x + width * directionX,
                    y: first.y + height * directionY,
                });
                return commitCreationEntity(entity);
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
        fitObjects(ids, bounds = null) {
            if (bounds && [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
                setViewBox(fitDrawingBounds(bounds, canvasSize.width / Math.max(1, canvasSize.height))); return;
            }
            const selected = new Set(ids);
            const entities = content.entities.filter(entity => selected.has(entity.id));
            if (entities.length) setViewBox(fitViewBox({ ...content, entities }, canvasSize.width / Math.max(1, canvasSize.height)));
        },
        zoom(factor) {
            setViewBox(current => zoomDrawingViewBox(current, factor, {
                x: current.x + current.width / 2,
                y: current.y + current.height / 2,
            }, canvasSize));
        },
        restoreNamedView(view) {
            const box = namedDrawingViewBox(view, canvasSize);
            if (box) setViewBox(box);
        },
        setScaleRatio(scaleRatio) {
            setViewBox(current => scaleDrawingViewBox(current, canvasSize, scaleRatio));
        },
        cancel() {
            setGesture(null);
            if (editingTextId) onEndCoalescing?.();
            setEditingTextId(null);
            setEditingTextInitialSelection(null);
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
        editText(entityId = selectedIds[0]) {
            const entity = content.entities.find(candidate => candidate.id === entityId);
            if (entity?.type !== 'text' || !canEditEntity(content, entity)) return false;
            setEditingTextInitialSelection(null);
            setEditingTextId(entity.id);
            onSelectionChange([entity.id]);
            return true;
        },
        setTextCreationMode(textMode) {
            const defaults = createDefaultDrawingCreationConfig('text');
            const next = {
                ...defaults,
                options: {
                    ...defaults.options,
                    textStyleId: content.activeTextStyleId || defaults.options.textStyleId,
                    textMode: textMode === 'multiline' ? 'multiline' : 'singleLine',
                    wrapMode: textMode === 'multiline' ? 'word' : 'none',
                },
            };
            rememberedCreationConfigsRef.current.set('text', next);
            pendingCreationRef.current = { tool: 'text', ...next };
            if (activeTool === 'text') {
                setCreationMode(next.mode);
                setCreationOptions(next.options);
                setGesture(null);
            }
            return true;
        },
        isEditingText() {
            return Boolean(editingTextId);
        },
        submitPoint(point, options) {
            return submitRemotePoint(point, options);
        },
    }), [activeTool, canvasSize, content, creationMode, creationOptions, dimensionMode, editingTextId, gesture, interactiveOperation, onSelectionChange, operationPoint, selectedIds, submitCreationInput, submitCreationInputForTool, t, temporaryTrackingPointMode, trackingAnchors, viewBox]);

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
        const snapped = resolveDrawingSnap(point, content, threshold, {
            excludeIds,
            trackingAnchors,
            orthogonalOrigin,
            temporaryOrtho: Boolean(event.shiftKey),
        });
        return drawingPointWithinLimits(snapped, content.settings) ? snapped : point;
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
        if (isQdimGrip(gesture.gripId)) {
            const geometry = getDimensionGeometry(target, drawingDimensionSources(content, target));
            if (!geometry?.label) return snapped;
            const normal = { x: -Math.sin(geometry.angle), y: Math.cos(geometry.angle) };
            const distance = (snapped.x - gesture.origin.x) * normal.x
                + (snapped.y - gesture.origin.y) * normal.y;
            return {
                ...snapped,
                x: gesture.origin.x + normal.x * distance,
                y: gesture.origin.y + normal.y * distance,
            };
        }
        return event.shiftKey ? constrainLineGripPoint(target, gesture.gripId, snapped) : snapped;
    };

    const completeSelectionWindow = current => {
        if (gesture?.kind !== 'select-window') return;
        if (pointDistance(gesture.start, current) > worldUnitsPerPixel * 3) {
            const window = createSelectionWindow(gesture.start, current);
            const candidateIds = drawingSelectionCandidates(content, window);
            onSelectionChange(applySelectionOperation(selectedIds, expandDrawingGroupSelection(content, candidateIds), gesture.operation));
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

        if ((interactiveOperation || !['select', 'pan'].includes(activeTool)) && !drawingPointWithinLimits(worldPoint(event), content.settings)) {
            onStatus?.(t('coordinates.outsideLimits')); return;
        }
        if (interactiveOperation?.type === 'sketch' && event.button === 0) {
            event.preventDefault();
            svgRef.current.setPointerCapture(event.pointerId);
            setGesture({ kind: 'sketch', sketch: beginDrawingSketch(worldPoint(event), interactiveOperation.increment, interactiveOperation.mode) });
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
            const mode = normalizeCanvasDimensionMode(dimensionMode).mode;
            const pointSnapPrefersFreeLinear = isDimensionPointSnap(snapped)
                && ['auto', 'linear', 'aligned', 'horizontal', 'vertical', 'rotated'].includes(mode);
            handleDimensionPoint(
                snapped,
                isDimensionableDrawingEntity(targetEntity) && !pointSnapPrefersFreeLinear ? targetEntity : null,
                worldPoint(event),
            );
            return;
        }

        if (drawingTools.has(activeTool)) {
            const activeLayer = getLayer(content, content.activeLayerId);
            if (!isDrawingLayerVisible(activeLayer) || activeLayer.locked) {
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
            const qdimSeriesSelected = targetEntity?.type === 'linearDimension' && targetEntity.seriesId
                && content.entities.some(entity => (
                    entity.seriesId === targetEntity.seriesId && selectedSet.has(entity.id)
                ));
            if (!interactiveOperation && gripId && targetEntity
                && (selectedSet.has(targetId) || qdimSeriesSelected)
                && canEditEntity(content, targetEntity)) {
                const sources = drawingDimensionSources(content, targetEntity);
                const origin = getEntityGrips(targetEntity, sources).find(grip => grip.id === gripId);
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
                onSelectionChange(applySelectionOperation(selectedIds, expandDrawingGroupSelection(content, [targetId]), operation));
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
        if (gesture?.kind === 'sketch') {
            const point = worldPoint(event);
            if (drawingPointWithinLimits(point, content.settings)) setGesture(current => current?.kind === 'sketch' ? { ...current, sketch: appendDrawingSketch(current.sketch, point) } : current);
            return;
        }
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
        if (gesture && !drawingPointWithinLimits(worldPoint(event), content.settings)) {
            onStatus?.(t('coordinates.outsideLimits')); setGesture(null);
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
            return;
        }
        if (gesture?.kind === 'sketch') {
            const sketch = appendDrawingSketch(gesture.sketch, worldPoint(event));
            onInteractiveOperation?.({ sketch });
            setGesture(null);
            if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
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
                onCommit(applyDrawingGripEdit(content, gesture.entityId, gesture.gripId, snapped));
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
        if (interactiveOperation?.type === 'dimensionSpacing' && operationPoint) {
            return spaceDimensionsAtPoint(content, interactiveOperation, operationPoint).content || content;
        }
        if (interactiveOperation?.type === 'dimensionBreak' && interactiveOperation.basePoint && operationPoint) {
            return advanceDimensionBreak(content, interactiveOperation, operationPoint).content || content;
        }
        if (interactiveOperation?.type === 'dimensionTextPlacement' && operationPoint) {
            return placeDimensionTextAtPoint(content, interactiveOperation, operationPoint).content || content;
        }
        if (gesture?.kind === 'grip') {
            return applyDrawingGripEdit(content, gesture.entityId, gesture.gripId, gesture.current);
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
    const blockInsertDraft = useMemo(() => {
        if (interactiveOperation?.type !== 'blockInsert' || interactiveOperation.stage !== 'insertion' || !operationPoint) return null;
        const result = insertNamedDrawingBlock(content, interactiveOperation.name, operationPoint, { ...interactiveOperation, id: 'block-insert-preview' });
        return result.reference ? { ...result.reference, previewMode: 'copy' } : null;
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
        ? ['rectangle', 'circle', 'polygon', 'arc', 'ellipse', 'spline'].includes(gesture.tool)
            ? buildCreationEntity(gesture, gesture.current, 'draft')
            : buildDrawingEntity(gesture.tool, gesture.first, gesture.current, content.activeLayerId, 'draft', {
                defaultText: t('document.defaultText'),
                options: { ...(gesture.options || {}), ...(creationOptions || {}) },
            })
        : gesture?.kind === 'dimension'
            ? dimensionGestureDraft(gesture, content.activeLayerId)
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
    const wipeoutDraft = interactiveOperation?.type === 'wipeout' && interactiveOperation.points.length
        ? { id: 'wipeout-preview', type: 'polyline', layerId: content.activeLayerId, closed: true,
            points: [...interactiveOperation.points, ...(operationPoint ? [operationPoint] : [])] } : null;
    const leaderDraft = interactiveOperation?.type === 'leaderCreation' && interactiveOperation.points.length
        ? { id: 'leader-preview', type: 'polyline', layerId: content.activeLayerId, closed: false,
            points: [...interactiveOperation.points, ...(operationPoint ? [operationPoint] : [])] } : null;
    const toleranceDraft = interactiveOperation?.type === 'tolerance' && operationPoint ? rebuildDrawingToleranceEntity({ id: 'tolerance-preview', layerId: content.activeLayerId,
        tolerance: { ...interactiveOperation.tolerance, transform: { a: 1, b: 0, c: 0, d: 1, e: operationPoint.x, f: operationPoint.y } } }) : null;
    const tableDraft = interactiveOperation?.type === 'table' && operationPoint ? rebuildDrawingTableEntity({ id: 'table-preview', layerId: content.activeLayerId,
        table: { ...interactiveOperation.table, transform: { a: 1, b: 0, c: 0, d: 1, e: operationPoint.x, f: operationPoint.y } } }) : null;
    const fieldDraft = interactiveOperation?.type === 'field' && operationPoint ? normalizeDrawingTextEntity({ id: 'field-preview',
        layerId: content.activeLayerId, x: operationPoint.x, y: operationPoint.y, width: 8, height: 1, fontSize: 0.35, text: interactiveOperation.text }) : null;
    const revisionDraft = previewDrawingRevision(interactiveOperation, operationPoint, content.activeLayerId);
    const lineworkDraft = previewDrawingLinework(interactiveOperation, operationPoint, content.activeLayerId);
    const sketchDrafts = drawingSketchEntities(gesture?.kind === 'sketch' ? gesture.sketch : interactiveOperation?.type === 'sketch' ? interactiveOperation.sketch : null, content.activeLayerId);
    const draftEntities = [toleranceDraft, fieldDraft, tableDraft, revisionDraft, ...sketchDrafts, lineworkDraft, gestureDraft, wipeoutDraft, leaderDraft, blockInsertDraft, ...mirrorDrafts, ...arrayDrafts, ...alignDrafts, ...cornerDrafts,
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
            (stretchSelectionWindow ? drawingSelectionCandidates(content, selectionWindow) : expandDrawingGroupSelection(content, drawingSelectionCandidates(content, selectionWindow))).filter(id => (
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
            ...(gesture?.kind === 'dimension' ? gesture.sourceIds || [] : []),
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
        if (focused && (wrapperRef.current?.contains(focused) || creationControlsTarget?.contains(focused)) && /^(?:INPUT|SELECT|TEXTAREA|BUTTON)$/.test(focused.tagName)) {
            focused.blur();
        }
    };

    const beginTextEditingFromEvent = event => {
        if (activeTool !== 'select' || interactiveOperation) return;
        const entityId = entityIdFromDrawingEvent(event);
        const entity = content.entities.find(candidate => candidate.id === entityId);
        if (entity?.type !== 'text' || !canEditEntity(content, entity)) return;
        event.preventDefault();
        event.stopPropagation();
        setGesture(null);
        setEditingTextInitialSelection(null);
        setEditingTextId(entity.id);
        onSelectionChange([entity.id]);
        onStatus?.(t('textEditor.opened'));
    };

    const textEditorStyle = editingText
        ? getTextEditorOverlayStyle(editingText, viewBox, canvasSize, content.textStyles)
        : null;

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
                onDoubleClick={beginTextEditingFromEvent}
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
                <DrawingCoordinateOverlay settings={content.settings} viewBox={viewBox} worldUnitsPerPixel={worldUnitsPerPixel} t={t} />
                {backgroundContext && <g opacity="0.25" pointerEvents="none" aria-hidden="true" transform={affineMatrixToSvg(backgroundContext.transform)}>
                    <DrawingScene content={backgroundContext.content} assets={backgroundContext.assets}
                        viewBox={inverseAffineViewBox(viewBox, backgroundContext.transform)} />
                </g>}
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
                    hiddenIds={[...previewHiddenIds, ...(editingText ? [editingText.id] : [])]}
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
            {editingText && textEditorStyle && (
                <DrawingTextEditor
                    entity={editingText}
                    textStyles={content.textStyles}
                    labels={drawingTextEditorLabels(t)}
                    fallbackColor={getEntityColor(content, editingText)}
                    initialSelection={editingTextInitialSelection}
                    toolbarPlacement={textEditorStyle.toolbarPlacement}
                    style={textEditorStyle.root}
                    contentStyle={textEditorStyle.content}
                    onCommit={entity => {
                        if (JSON.stringify(entity) !== JSON.stringify(editingText)) {
                            onCommit(
                                updateSelectedEntities(content, [editingText.id], () => entity),
                                { coalesceKey: `text-edit-${editingText.id}` },
                            );
                        }
                        setEditingTextId(null);
                        setEditingTextInitialSelection(null);
                        onEndCoalescing?.();
                        onStatus?.(t('textEditor.committed'));
                    }}
                    onCancel={() => {
                        setEditingTextId(null);
                        setEditingTextInitialSelection(null);
                        onEndCoalescing?.();
                        onStatus?.(t('textEditor.cancelled'));
                    }}
                />
            )}
            <DrawingDynamicInput
                {...dynamicInput}
                anchor={dynamicInputPosition}
                enabled={dynamicInputVisible}
            />
            {!editingText && creationControlsTarget && createPortal(
                <DrawingCreationControls
                    content={content}
                    key={editEntity?.id || activeTool}
                    operation={interactiveOperation}
                    commandInput={dynamicInput}
                    onCancel={onCancelCommand}
                    embedded
                    activeTool={activeTool}
                    mode={creationMode}
                    options={creationOptions}
                    onChange={updateCreationConfig}
                    editEntity={editEntity}
                    onEditChange={onEditEntityChange}
                    onImageSource={onImageSource}
                    imageSourceBusy={imageSourceBusy}
                    textStyles={content.textStyles}
                />, creationControlsTarget
            )}
        </div>
    );
});

function normalizeCanvasDimensionMode(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...value, mode: String(value.mode || 'auto') };
    }
    return { mode: String(value || 'auto') };
}

function drawingDimensionSources(content, entity) {
    const dependencies = getDrawingEntityDependencyIds(entity);
    if (!dependencies.length) return null;
    const sourceMap = new Map(content.entities.map(candidate => [candidate.id, candidate]));
    return dependencies.map(id => sourceMap.get(id)).filter(Boolean);
}

function applyDrawingGripEdit(content, entityId, gripId, point) {
    if (gripId.startsWith('leader-')) return editDrawingLeaderGrip(content, entityId, gripId, point).content || content;
    if (isQdimGrip(gripId)) {
        return rebuildQdimSeriesFromGripResult(content, entityId, gripId, point).content;
    }
    const target = content.entities.find(entity => entity.id === entityId);
    const sources = drawingDimensionSources(content, target);
    return updateSelectedEntities(content, [entityId], entity => editEntityGrip(entity, gripId, point, sources));
}

function isQdimGrip(gripId) {
    return Object.values(DRAWING_QDIM_GRIP_IDS).includes(gripId);
}

function dimensionGestureDraft(gesture, layerId) {
    if (!gesture?.first || !gesture?.current) return null;
    if (gesture.dimensionKind === 'angular-lines') return null;
    if (gesture.dimensionKind === 'angular-free' && gesture.ray1Point) {
        return {
            id: 'dimension-draft',
            type: 'polyline',
            layerId,
            points: [gesture.ray1Point, gesture.first, gesture.current],
            closed: false,
        };
    }
    return {
        id: 'dimension-draft',
        type: 'line',
        layerId,
        x1: gesture.first.x,
        y1: gesture.first.y,
        x2: gesture.current.x,
        y2: gesture.current.y,
    };
}

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

function getTextEditorOverlayStyle(entity, viewBox, canvasSize, textStyles) {
    if (!canvasSize.width || !canvasSize.height || !viewBox.width || !viewBox.height) return null;
    const scale = Math.min(canvasSize.width / viewBox.width, canvasSize.height / viewBox.height);
    const offsetX = (canvasSize.width - viewBox.width * scale) / 2;
    const offsetY = (canvasSize.height - viewBox.height * scale) / 2;
    const x = Math.min(entity.x, entity.x + entity.width);
    const y = Math.min(entity.y, entity.y + entity.height);
    const width = Math.max(48, Math.abs(entity.width) * scale);
    const height = Math.max(30, Math.abs(entity.height) * scale);
    const frame = drawingAffineFrame(entity);
    const center = framedDrawingPoint(entity, { x: x + Math.abs(entity.width) / 2, y: y + Math.abs(entity.height) / 2 });
    const left = offsetX + (center.x - viewBox.x) * scale - width / 2;
    const top = offsetY + (center.y - viewBox.y) * scale - height / 2;
    const textStyle = resolveDrawingTextStyle(entity, textStyles);
    return {
        toolbarPlacement: top < 110 ? 'below' : 'above',
        root: {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        },
        content: {
            fontFamily: textStyle.cssFontFamily,
            fontSize: `${drawingTextFontSizeToPixels(textStyle.fontSize, scale)}px`,
            lineHeight: textStyle.lineHeight,
            transform: `${frame ? `matrix(${frame.a},${frame.b},${frame.c},${frame.d},0,0) ` : ''}${Number(entity.rotation) ? `rotate(${Number(entity.rotation)}deg)` : ''}${entity.mirrored ? ' scaleY(-1)' : ''}`.trim() || undefined,
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

export default DrawingCanvas;
