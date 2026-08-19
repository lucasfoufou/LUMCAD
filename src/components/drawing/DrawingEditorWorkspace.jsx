import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DrawingEditorBody from '~components/drawing/DrawingEditorBody';
import DrawingEditorHeader from '~components/drawing/DrawingEditorHeader';
import DrawingLayoutEditor from '~components/drawing/DrawingLayoutEditor';
import DrawingPrintPage from '~components/drawing/DrawingPrintPage';
import DrawingWorkspaceTabs from '~components/drawing/DrawingWorkspaceTabs';
import useDrawingAlignCommand from '~hooks/useDrawingAlignCommand';
import useDrawingArrayCommand from '~hooks/useDrawingArrayCommand';
import useDrawingBreakStretchLengthenCommand from '~hooks/useDrawingBreakStretchLengthenCommand';
import useDrawingClipboard from '~hooks/useDrawingClipboard';
import useDrawingCompoundCommands from '~hooks/useDrawingCompoundCommands';
import useDrawingCornerCommand from '~hooks/useDrawingCornerCommand';
import useDrawingEditorShortcuts from '~hooks/useDrawingEditorShortcuts';
import useDrawingHistory from '~hooks/useDrawingHistory';
import useLcadAutosave from '~hooks/useLcadAutosave';
import useLcadFileCommands from '~hooks/useLcadFileCommands';
import useLocalDrawingImageImport from '~hooks/useLocalDrawingImageImport';
import useLumcadMcpBridge from '~hooks/useLumcadMcpBridge';
import { useI18n } from '~i18n/I18nProvider';
import { localizeError } from '~i18n/translator';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { getDrawingCommandDefinition, getDrawingCommandInput, isNumericDrawingInput, parseDrawingCommand, parseDrawingNumbers } from '~utils/drawingCommands';
import {
    canEditEntity,
    createDrawingId,
    deleteSelectedEntities,
    getLayer,
    normalizeDrawingContent,
    pasteDrawingEntities,
    transformSelectedEntities,
    updateSelectedEntities,
} from '~utils/drawingDocument';
import { getOffsetThroughParameters, getScreenScaleRatio, offsetEntity, offsetEntityTowardPoint, pointDistance, rotateEntity, scaleEntity, translateEntity } from '~utils/drawingGeometry';
import {
    advanceReferenceTransform,
    beginReferenceTransform,
    convertAngle,
    createAngleConfig,
    directionalDelta,
    formatOperationDelta,
    formatOperationNumber,
    operationAngle,
    operationDelta,
    operationScaleFactor,
    operationUsesCopy,
} from '~utils/drawingOperations';
import { parseDrawingOperationOption, reopenBasicDrawingOperationOption } from '~utils/drawingOperationOptions';
import {
    extendDrawingTarget,
    replaceTrimScope,
    trimDrawingFence,
    trimDrawingTarget,
} from '~utils/drawingTrimOperations';
import { isDrawingTextInput } from '~utils/drawingInteraction';
import {
    createDrawingLayoutFromTemplate,
    createDrawingPageSetupFromLayout,
    createDrawingViewportClipPreset,
    duplicateDrawingLayout,
    importDrawingPageSetups,
    modelViewBoxFromViewport,
    removeDrawingViewport,
    reorderDrawingLayouts,
    renameDrawingLayout,
    updateDrawingLayout,
    updateDrawingViewport,
} from '~utils/drawingLayouts';
import {
    createAngularDimensionResult,
    createArcLengthDimensionResult,
    createBaselineDimensionResult,
    createCenterMarkResult,
    createContinuedDimensionResult,
    createJoggedRadiusDimensionResult,
    createOrdinateDimensionResult,
    createQuickDimensionResult,
} from '~utils/drawingDimensionCommands';
import { normalizeLcadDocument } from '~utils/lcadDocument';
import { openLcadDocument } from '~utils/lcadStorage';
import { supportsDrawingCreationPanel } from '~utils/drawingCreation';
import { normalizePolarAngles } from '~utils/drawingDraftingSettings';
import {
    evaluateDrawingCalculation,
    evaluateDrawingExpression,
    hasDrawingPointSyntax,
    isDrawingExpressionInput,
    resolveDrawingPointInput,
} from '~utils/drawingPrecisionInput';

const draftingCommands = new Set([
    'ortho',
    'polar',
    'objectTracking',
    'draftingSettings',
    'temporaryTrackingPoint',
]);

export default function DrawingEditorWorkspace({
    initialDocument,
    initialPath = null,
    recovered = false,
    onReplaceSession,
    onOpenSettings,
}) {
    const { formatNumber, locale, t } = useI18n();
    const { settings } = useAppSettings();
    const canvasRef = useRef(null);
    const layoutCanvasRef = useRef(null);
    const commandBarRef = useRef(null);
    const imageInputRef = useRef(null);
    const inputVariablesRef = useRef({});
    const previousLocaleRef = useRef(locale);
    const hasAppliedRotationRef = useRef(false);
    const lastOperationValuesRef = useRef({
        offset: 1,
        move: 1,
        copy: 1,
        rotate: settings.drawingDefaults.clockwiseAngles ? -90 : 90,
        scale: 1,
        arrayColumns: 2,
        arrayRows: 2,
        filletRadius: 0,
        chamferDistance1: 0,
        chamferDistance2: 0,
    });
    const [name, setName] = useState(initialDocument.name);
    const [assets, setAssets] = useState(initialDocument.assets || []);
    const [filePath, setFilePath] = useState(initialPath);
    const [selectedIds, setSelectedIds] = useState([]);
    const [activeTool, setActiveTool] = useState('select');
    const [dimensionMode, setDimensionMode] = useState('auto');
    const [commandValue, setCommandValue] = useState('');
    const [interactiveOperation, setInteractiveOperation] = useState(null);
    const [creationPanelEntityId, setCreationPanelEntityId] = useState(null);
    const [message, setMessage] = useState('');
    const [viewport, setViewport] = useState({ x: 10, y: 10, width: 30, height: 20 });
    const [workspaceMode, setWorkspaceMode] = useState('model');
    const [activeLayoutId, setActiveLayoutId] = useState(initialDocument.layouts?.[0]?.id || null);
    const [selectedLayoutIds, setSelectedLayoutIds] = useState(() => (
        initialDocument.layouts?.[0]?.id ? [initialDocument.layouts[0].id] : []
    ));
    const [selectedViewportId, setSelectedViewportId] = useState(null);
    const [maximizedViewportId, setMaximizedViewportId] = useState(null);
    const [layoutTool, setLayoutTool] = useState('select');
    const [sidebarPanel, setSidebarPanel] = useState('layers');
    const [draftingSettingsOpen, setDraftingSettingsOpen] = useState(false);
    const [calculatorMode, setCalculatorMode] = useState(false);
    const history = useDrawingHistory({
        content: normalizeDrawingContent(initialDocument.content),
        layouts: initialDocument.layouts || [],
        pageSetups: initialDocument.pageSetups || [],
    });
    const layouts = history.layouts;
    const pageSetups = history.pageSetups;
    const document = useMemo(() => ({
        ...initialDocument,
        name,
        assets,
        layouts,
        pageSetups,
        content: history.content,
    }), [assets, history.content, initialDocument, layouts, name, pageSetups]);
    const handlePathChange = useCallback(nextPath => setFilePath(nextPath), []);
    const autosave = useLcadAutosave({
        document,
        filePath,
        onPathChange: handlePathChange,
        delayMs: settings.autosaveDelayMs,
    });
    const {
        createNewDrawing,
        exportPageSetups,
        exportPdf,
        isExporting,
        openDrawing,
        printJob,
        saveDrawingAs,
    } = useLcadFileCommands({
        autosave,
        document,
        drawingDefaults: settings.drawingDefaults,
        filePath,
        recovered,
        onReplaceSession,
        setMessage,
    });

    const activeLayout = useMemo(() => (
        layouts.find(layout => layout.id === activeLayoutId) || layouts[0] || null
    ), [activeLayoutId, layouts]);
    useEffect(() => {
        const viewportIds = new Set(activeLayout?.viewports.map(viewport => viewport.id) || []);
        if (selectedViewportId && !viewportIds.has(selectedViewportId)) setSelectedViewportId(null);
        if (maximizedViewportId && !viewportIds.has(maximizedViewportId)) setMaximizedViewportId(null);
    }, [activeLayout, maximizedViewportId, selectedViewportId]);
    useEffect(() => {
        const layoutIds = new Set(layouts.map(layout => layout.id));
        setSelectedLayoutIds(current => {
            const filtered = current.filter(id => layoutIds.has(id));
            if (filtered.length) return filtered.length === current.length ? current : filtered;
            return activeLayout?.id ? [activeLayout.id] : [];
        });
    }, [activeLayout?.id, layouts]);
    const selectedEntities = useMemo(() => history.content.entities.filter(entity => selectedIds.includes(entity.id)), [history.content.entities, selectedIds]);
    const creationPanelEntity = useMemo(() => (
        history.content.entities.find(entity => entity.id === creationPanelEntityId) || null
    ), [creationPanelEntityId, history.content.entities]);

    const openModelWorkspace = () => {
        layoutCanvasRef.current?.cancel();
        setWorkspaceMode('model');
        setSelectedViewportId(null);
        setMaximizedViewportId(null);
        setLayoutTool('select');
        setMessage('');
    };

    const openLayoutWorkspace = layoutId => {
        canvasRef.current?.cancel();
        setWorkspaceMode('layout');
        setActiveLayoutId(layoutId);
        setSelectedLayoutIds([layoutId]);
        setSelectedIds([]);
        setInteractiveOperation(null);
        setActiveTool('select');
        setCommandValue('');
        setSelectedViewportId(null);
        setMaximizedViewportId(null);
        setLayoutTool('select');
        setMessage(t('layout.opened'));
    };

    const addLayout = (template = 'blank') => {
        const layout = createDrawingLayoutFromTemplate({
            template,
            name: t('layout.defaultName', { number: layouts.length + 1 }),
            format: activeLayout?.format || 'A0',
            orientation: activeLayout?.orientation || 'landscape',
            customPaperSize: activeLayout?.customPaperSize,
            margins: activeLayout?.margins,
            modelViewBox: modelViewBoxFromViewport(viewport, 1),
        });
        history.commitLayouts(current => [...current, layout]);
        setActiveLayoutId(layout.id);
        setSelectedLayoutIds([layout.id]);
        setWorkspaceMode('layout');
        setSelectedIds([]);
        setInteractiveOperation(null);
        setActiveTool('select');
        setCommandValue('');
        setSelectedViewportId(null);
        setMaximizedViewportId(null);
        setLayoutTool('viewport');
        setMessage(t('layout.created'));
    };

    const commitActiveLayout = (nextLayout, options = {}) => {
        if (!activeLayout) return;
        history.commitLayouts(current => updateDrawingLayout(current, activeLayout.id, nextLayout), options);
    };

    const deleteLayout = (layoutId = activeLayout?.id) => {
        const layout = layouts.find(candidate => candidate.id === layoutId);
        if (!layout || layouts.length <= 1) return;
        const index = layouts.findIndex(candidate => candidate.id === layout.id);
        const remaining = layouts.filter(candidate => candidate.id !== layout.id);
        const next = remaining[Math.min(index, remaining.length - 1)];
        history.commitLayouts(remaining);
        setSelectedLayoutIds(current => {
            const filtered = current.filter(id => id !== layout.id);
            return filtered.length ? filtered : [next.id];
        });
        if (activeLayout?.id === layout.id) {
            setActiveLayoutId(next.id);
            setSelectedViewportId(null);
            setMaximizedViewportId(null);
            setLayoutTool('select');
        }
        setMessage(t('layout.deleted'));
    };

    const duplicateLayout = layoutId => {
        const source = layouts.find(layout => layout.id === layoutId);
        if (!source) return;
        const duplicate = duplicateDrawingLayout(source, layouts);
        const index = layouts.findIndex(layout => layout.id === layoutId);
        history.commitLayouts(current => {
            const next = [...current];
            next.splice(index + 1, 0, duplicate);
            return next;
        });
        setSelectedLayoutIds([duplicate.id]);
        openLayoutWorkspace(duplicate.id);
    };

    const moveLayout = (layoutId, toIndex) => history.commitLayouts(current => (
        reorderDrawingLayouts(current, layoutId, toIndex)
    ));

    const renameLayout = (layoutId, nextName) => history.commitLayouts(current => (
        renameDrawingLayout(current, layoutId, nextName)
    ));

    const createPageSetup = pageSetup => history.commitDocument(current => {
        const imported = importDrawingPageSetups(current.pageSetups || [], [pageSetup]);
        const pageSetupId = imported.importedIds[0] || null;
        return {
            ...current,
            pageSetups: imported.pageSetups,
            layouts: current.layouts.map(layout => layout.id === activeLayout?.id
                ? { ...layout, pageSetupId }
                : layout),
        };
    });

    const deletePageSetup = pageSetupId => history.commitDocument(current => ({
        ...current,
        pageSetups: (current.pageSetups || []).filter(pageSetup => pageSetup.id !== pageSetupId),
        layouts: current.layouts.map(layout => layout.pageSetupId === pageSetupId
            ? { ...layout, pageSetupId: null }
            : layout),
    }));

    const importPageSetups = async () => {
        try {
            const loaded = await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
            if (!loaded) return;
            const importedDocument = loaded.envelope.document;
            const candidates = importedDocument.pageSetups?.length
                ? importedDocument.pageSetups
                : importedDocument.layouts.map(layout => createDrawingPageSetupFromLayout(layout));
            if (!candidates.length) {
                setMessage(t('layout.pageSetupsImportEmpty'));
                return;
            }
            const result = importDrawingPageSetups(pageSetups, candidates);
            history.commitPageSetups(result.pageSetups);
            setMessage(t('layout.pageSetupsImported', { count: result.importedIds.length }));
        } catch (error) {
            setMessage(localizeError(error, t, 'layout.pageSetupsImportFailed'));
        }
    };

    const deleteSelectedViewport = () => {
        if (!activeLayout || !selectedViewportId) return;
        commitActiveLayout(removeDrawingViewport(activeLayout, selectedViewportId));
        if (maximizedViewportId === selectedViewportId) setMaximizedViewportId(null);
        setSelectedViewportId(null);
        setMessage(t('layout.viewportDeleted'));
    };
    const {
        activateCompoundSelection,
        beginCompoundOperation,
        completeMirrorChoice,
        handleMirrorPoint,
        submitCompoundValue,
    } = useDrawingCompoundCommands({
        canvasRef,
        commandBarRef,
        history,
        interactiveOperation,
        selectedIds,
        selectedEntities,
        setActiveTool,
        setInteractiveOperation,
        setMessage,
        setSelectedIds,
    });
    const { activateAlignSelection, beginAlign, handleAlignPoint, submitAlignValue } = useDrawingAlignCommand({
        canvasRef,
        commandBarRef,
        history,
        selectedEntities,
        selectedIds,
        interactiveOperation,
        setActiveTool,
        setInteractiveOperation,
        setMessage,
        setSelectedIds,
        t,
    });
    const { activateArraySelection, beginArray, handleArrayPoint, submitArrayValue } = useDrawingArrayCommand({
        canvasRef, commandBarRef, history, lastOperationValuesRef, selectedEntities,
        setActiveTool, setInteractiveOperation, setMessage, setSelectedIds,
    });
    const { handleImageFile, isUploading } = useLocalDrawingImageImport({
        history, viewport, setActiveTool, setAssets, setMessage, setSelectedIds,
    });
    const {
        beginCopyBase,
        beginPasteBlock,
        beginPasteClip,
        copyClip,
        cutClip,
        handleClipboardPoint,
        pasteOriginal,
        submitClipboardValue,
    } = useDrawingClipboard({
        assets,
        canvasRef,
        document,
        history,
        interactiveOperation,
        selectedIds,
        setActiveTool,
        setAssets,
        setInteractiveOperation,
        setMessage,
        setSelectedIds,
        t,
    });
    const { beginCornerOperation, handleCornerPoint, submitCornerValue } = useDrawingCornerCommand({
        canvasRef,
        commandBarRef,
        history,
        interactiveOperation,
        lastOperationValuesRef,
        locale,
        setActiveTool,
        setInteractiveOperation,
        setMessage,
        setSelectedIds,
        t,
    });
    const {
        beginBreakCommand,
        beginLengthenCommand,
        beginStretchCommand,
        handleModificationPoint,
        submitModificationValue,
    } = useDrawingBreakStretchLengthenCommand({
        canvasRef,
        commandBarRef,
        history,
        interactiveOperation,
        selectedEntities,
        selectedIds,
        setActiveTool,
        setInteractiveOperation,
        setMessage,
        setSelectedIds,
    });

    useEffect(() => {
        const validIds = new Set(history.content.entities.map(entity => entity.id));
        setSelectedIds(current => current.filter(id => validIds.has(id)));
    }, [history.content.entities]);

    useEffect(() => {
        if (!creationPanelEntityId) return;
        const exists = history.content.entities.some(entity => entity.id === creationPanelEntityId);
        if (!exists || !selectedIds.includes(creationPanelEntityId)) setCreationPanelEntityId(null);
    }, [creationPanelEntityId, history.content.entities, selectedIds]);

    useEffect(() => {
        if (!creationPanelEntityId) history.endCoalescing();
    }, [creationPanelEntityId, history.endCoalescing]);

    useEffect(() => {
        window.document.title = `${name || t('document.untitled')} — LUMCAD`;
    }, [name, t]);

    useEffect(() => {
        if (!hasAppliedRotationRef.current) {
            lastOperationValuesRef.current.rotate = settings.drawingDefaults.clockwiseAngles ? -90 : 90;
        }
    }, [settings.drawingDefaults.clockwiseAngles]);

    useEffect(() => {
        if (previousLocaleRef.current === locale) return;
        previousLocaleRef.current = locale;
        if (interactiveOperation) setMessage(t('messages.continueActiveCommand'));
        else if (activeTool !== 'select') setMessage(t('messages.toolActive', { tool: t(`commands.${activeTool}`) }));
        else setMessage('');
    }, [locale]);

    const deleteSelection = () => {
        if (!selectedIds.length) return;
        history.commit(deleteSelectedEntities(history.content, selectedIds));
        setSelectedIds([]);
        setMessage(t('messages.selectionDeleted'));
    };

    const activateOperationSelection = (operation, editable, reportInvalid = true) => {
        if (operation.type === 'offset') {
            const sources = editable.filter(entity => ['line', 'rectangle', 'circle', 'polygon', 'arc', 'polyline'].includes(entity.type));
            if (!sources.length) {
                if (reportInvalid) setMessage(t('messages.offsetSelectionRequired'));
                return false;
            }
            const distance = operation.requestedValue;
            const hasDistance = Number.isFinite(distance) && distance > 0;
            const offsetMode = operation.offsetMode === 'through' ? 'through' : 'distance';
            const shared = {
                type: 'offset',
                entityIds: sources.map(entity => entity.id),
                offsetMode,
                eraseSource: Boolean(operation.eraseSource),
                destinationLayer: operation.destinationLayer === 'current' ? 'current' : 'source',
            };
            if (hasDistance) lastOperationValuesRef.current.offset = distance;
            setInteractiveOperation(offsetMode === 'through'
                ? { ...shared, stage: 'side' }
                : hasDistance
                    ? { ...shared, stage: 'side', distance }
                    : { ...shared, stage: 'distance' });
            setActiveTool('offset');
            setMessage(offsetMode === 'through'
                ? t('messages.offsetThroughPrompt', { count: sources.length })
                : hasDistance
                ? t('messages.offsetSidePrompt', { count: sources.length, distance })
                : t('messages.offsetDistancePrompt', { distance: lastOperationValuesRef.current.offset }));
            if (offsetMode !== 'through' && !hasDistance) commandBarRef.current?.focus('');
            return true;
        }
        if (!editable.length) {
            if (reportInvalid) setMessage(t('messages.editableSelectionRequired'));
            return false;
        }
        setInteractiveOperation({ ...operation, stage: 'base', entityIds: editable.map(entity => entity.id) });
        setActiveTool(operation.type);
        setMessage(operationBasePrompt(operation.type, t));
        return true;
    };

    const beginTransformOperation = (type, requestedValue = null) => {
        if (workspaceMode === 'layout' && type === 'scale') {
            beginViewportScale(requestedValue);
            return;
        }
        canvasRef.current?.cancel();
        setCreationPanelEntityId(null);
        const operation = {
            type,
            stage: 'select',
            requestedValue: Number.isFinite(requestedValue) ? requestedValue : null,
            ...(['rotate', 'scale'].includes(type) ? { copyMode: 'replace' } : {}),
            ...(type === 'rotate' ? {
                angleUnit: settings.drawingDefaults.angleUnit,
                angleDirection: settings.drawingDefaults.clockwiseAngles ? 'clockwise' : 'counterClockwise',
            } : {}),
            ...(type === 'mirror' ? {
                copyMode: 'copy',
                mirrorTextGlyphs: settings.drawingDefaults.mirrorText,
            } : {}),
            ...(type === 'offset' ? {
                offsetMode: 'distance',
                eraseSource: false,
                destinationLayer: 'source',
            } : {}),
        };
        const editable = selectedEntities.filter(entity => canEditEntity(history.content, entity));
        if (activateOperationSelection(operation, editable, false)) return;
        setInteractiveOperation(operation);
        setActiveTool('select');
        setMessage(t('messages.operationSelectionPrompt', { operation: t(`operations.${type}`) }));
    };

    const beginViewportScale = (requestedValue = null) => {
        layoutCanvasRef.current?.cancel();
        const viewport = activeLayout?.viewports.find(item => item.id === selectedViewportId) || null;
        const operation = {
            type: 'scale',
            scope: 'viewport',
            stage: viewport ? 'base' : 'select',
            viewportId: viewport?.id || null,
            requestedValue: Number.isFinite(requestedValue) ? requestedValue : null,
        };
        setInteractiveOperation(operation);
        setLayoutTool(viewport ? 'scale' : 'select');
        setMessage(viewport
            ? operationBasePrompt('scale', t)
            : t('layout.scaleSelectionPrompt'));
    };

    const beginTrimExtend = type => {
        canvasRef.current?.cancel();
        const boundaryIds = selectedEntities
            .filter(entity => canEditEntity(history.content, entity))
            .map(entity => entity.id);
        setInteractiveOperation({
            type,
            stage: 'pick',
            boundaryIds: boundaryIds.length ? boundaryIds : null,
            extendEdges: false,
            projection: '2d',
        });
        setActiveTool(type);
        setMessage(boundaryIds.length
            ? t(`messages.${type}Preselected`, { count: boundaryIds.length })
            : t(`messages.${type}Start`));
    };

    const beginTrim = () => beginTrimExtend('trim');
    const beginExtend = () => beginTrimExtend('extend');

    const confirmOperationSelection = () => {
        if (!interactiveOperation || interactiveOperation.stage !== 'select') return false;
        if (interactiveOperation.scope === 'viewport') {
            const viewport = activeLayout?.viewports.find(item => item.id === selectedViewportId);
            if (!viewport) {
                setMessage(t('layout.scaleSelectionPrompt'));
                return true;
            }
            setInteractiveOperation({ ...interactiveOperation, stage: 'base', viewportId: viewport.id });
            setLayoutTool('scale');
            setMessage(operationBasePrompt('scale', t));
            return true;
        }
        if (interactiveOperation.type === 'array') return activateArraySelection(interactiveOperation, selectedEntities);
        if (interactiveOperation.type === 'align') return activateAlignSelection(interactiveOperation, selectedEntities);
        if (['join', 'explode', 'xplode'].includes(interactiveOperation.type)) {
            return activateCompoundSelection(interactiveOperation, selectedEntities);
        }
        activateOperationSelection(
            interactiveOperation,
            selectedEntities.filter(entity => canEditEntity(history.content, entity)),
        );
        return true;
    };

    const finishInteractiveOperation = (nextSelection, nextMessage) => {
        setSelectedIds(nextSelection);
        setInteractiveOperation(null);
        setActiveTool('select');
        setMessage(nextMessage);
    };

    const applyScaleOperation = (operation, factorOrTransform, basePoint) => {
        const nonUniform = factorOrTransform && typeof factorOrTransform === 'object';
        const factor = nonUniform ? null : Number(factorOrTransform);
        const scaleX = nonUniform ? Number(factorOrTransform.scaleX) : factor;
        const scaleY = nonUniform ? Number(factorOrTransform.scaleY) : factor;
        if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) return false;
        if (!nonUniform) lastOperationValuesRef.current.scale = factor;
        if (operation.scope === 'viewport') {
            if (!activeLayout?.viewports.some(viewport => viewport.id === operation.viewportId)) {
                setInteractiveOperation(null);
                setLayoutTool('select');
                setMessage(t('layout.viewportNoLongerAvailable'));
                return false;
            }
            commitActiveLayout(scaleDrawingViewport(activeLayout, operation.viewportId, factor, basePoint));
            setSelectedViewportId(operation.viewportId);
            setInteractiveOperation(null);
            setLayoutTool('select');
            setMessage(t('layout.viewportScaleApplied', { factor: formatOperationNumber(factor, locale) }));
            return true;
        }
        const result = transformSelectedEntities(
            history.content,
            operation.entityIds,
            entity => scaleEntity(entity, nonUniform
                ? { origin: basePoint, scaleX, scaleY }
                : factor, basePoint),
            { copy: operationUsesCopy(operation) },
        );
        if (!result.changed) return false;
        history.commit(result.content);
        finishInteractiveOperation(result.selectedIds, t(nonUniform
            ? operationUsesCopy(operation) ? 'messages.scaleXYCopyApplied' : 'messages.scaleXYApplied'
            : operationUsesCopy(operation) ? 'messages.scaleCopyApplied' : 'messages.scaleApplied', {
            factor: formatOperationNumber(factor, locale),
            scaleX: formatOperationNumber(scaleX, locale),
            scaleY: formatOperationNumber(scaleY, locale),
        }));
        return true;
    };

    const applyRotateOperation = (operation, angle, basePoint) => {
        hasAppliedRotationRef.current = true;
        lastOperationValuesRef.current.rotate = angle;
        const result = transformSelectedEntities(
            history.content,
            operation.entityIds,
            entity => rotateEntity(entity, angle, basePoint),
            { copy: operationUsesCopy(operation) },
        );
        if (!result.changed) return false;
        history.commit(result.content);
        finishInteractiveOperation(result.selectedIds, t(operationUsesCopy(operation)
            ? 'messages.rotationCopyApplied'
            : 'messages.rotationApplied', {
            angle: formatOperationNumber(displayRotationAngle(angle, operation), locale),
            unit: angleUnitSymbol(operation.angleUnit),
        }));
        return true;
    };

    const handleReferencePoint = (operation, point) => {
        const result = advanceReferenceTransform(operation, point);
        if (!result) return false;
        if (!result.complete) {
            setInteractiveOperation(result.operation);
            setMessage(referenceTransformPrompt(result.operation, t));
            return true;
        }
        if (!result.valid) {
            setInteractiveOperation(result.reason === 'source'
                ? beginReferenceTransform(operation)
                : operation);
            setMessage(t(result.reason === 'source'
                ? 'messages.referenceSourceDistinct'
                : 'messages.referenceTargetDistinct'));
            return true;
        }
        if (operation.type === 'scale') return applyScaleOperation(operation, result.value, result.basePoint);
        applyRotateOperation(operation, result.value, result.basePoint);
        return true;
    };

    const handleInteractiveOperation = ({ point, targetId, fence, arrayHandle, shift = false }) => {
        if (['copyBase', 'pasteClip', 'pasteBlock'].includes(interactiveOperation?.type)) {
            void handleClipboardPoint(interactiveOperation, point);
            return;
        }
        if (interactiveOperation?.stage === 'reference') {
            handleReferencePoint(interactiveOperation, point);
            return;
        }
        if (handleArrayPoint(interactiveOperation, point, arrayHandle)) return;
        if (handleMirrorPoint(interactiveOperation, point)) return;
        if (handleAlignPoint(interactiveOperation, point)) return;
        if (handleCornerPoint(interactiveOperation, point, targetId)) return;
        if (handleModificationPoint(interactiveOperation, point, targetId)) return;
        if (interactiveOperation?.type === 'offset') {
            if (interactiveOperation.stage !== 'side') return;
            const sources = history.content.entities.filter(entity => (
                interactiveOperation.entityIds.includes(entity.id) && canEditEntity(history.content, entity)
            ));
            if (!sources.length) {
                setInteractiveOperation(null);
                setActiveTool('select');
                setMessage(t('messages.offsetNoLongerEditable'));
                return;
            }
            if (interactiveOperation.destinationLayer === 'current') {
                const destination = getLayer(history.content, history.content.activeLayerId);
                if (!destination?.visible || destination.locked) {
                    setMessage(t('messages.offsetDestinationLayerUnavailable'));
                    return;
                }
            }
            const offsetResults = sources.map(source => {
                const through = interactiveOperation.offsetMode === 'through'
                    ? getOffsetThroughParameters(source, point)
                    : null;
                const offset = interactiveOperation.offsetMode === 'through'
                    ? through && offsetEntity(source, through.distance * through.side)
                    : offsetEntityTowardPoint(source, interactiveOperation.distance, point);
                return {
                    source,
                    copy: offset ? {
                        ...offset,
                        id: createDrawingId(offset.type || source.type),
                        layerId: interactiveOperation.destinationLayer === 'current'
                            ? history.content.activeLayerId
                            : source.layerId,
                    } : null,
                };
            });
            const copies = offsetResults.map(result => result.copy).filter(Boolean);
            if (!copies.length) {
                setMessage(t('messages.offsetInvalidSide'));
                return;
            }
            const baseContent = interactiveOperation.eraseSource
                ? deleteSelectedEntities(history.content, offsetResults
                    .filter(result => result.copy)
                    .map(result => result.source.id))
                : history.content;
            history.commit({ ...baseContent, entities: [...baseContent.entities, ...copies] });
            const skipped = sources.length - copies.length;
            setSelectedIds([]);
            setInteractiveOperation({
                type: 'offset',
                stage: 'select',
                requestedValue: interactiveOperation.offsetMode === 'through' ? null : interactiveOperation.distance,
                offsetMode: interactiveOperation.offsetMode,
                eraseSource: interactiveOperation.eraseSource,
                destinationLayer: interactiveOperation.destinationLayer,
            });
            setActiveTool('offset');
            const through = interactiveOperation.offsetMode === 'through';
            setMessage(t(through
                ? skipped ? 'messages.offsetThroughCreatedWithSkipped' : 'messages.offsetThroughCreated'
                : skipped ? 'messages.offsetCreatedWithSkipped' : 'messages.offsetCreated', {
                count: copies.length,
                distance: interactiveOperation.distance,
                skipped,
            }));
            return;
        }

        if (!['trim', 'extend'].includes(interactiveOperation?.type)) {
            if (!interactiveOperation || interactiveOperation.stage === 'select') return;
            if (interactiveOperation.stage === 'base') {
                const nextStage = ({ move: 'destination', copy: 'destination', rotate: 'angle', scale: 'factor', mirror: 'mirror-axis' })[interactiveOperation.type];
                setInteractiveOperation({ ...interactiveOperation, stage: nextStage, basePoint: point });
                const promptKeys = {
                    move: 'messages.moveDestinationPrompt',
                    copy: 'messages.copyDestinationPrompt',
                    rotate: 'messages.rotateAnglePrompt',
                    scale: 'messages.scaleFactorPrompt',
                    mirror: 'messages.mirrorAxisSecond',
                };
                setMessage(t(promptKeys[interactiveOperation.type], {
                    angle: formatOperationNumber(displayRotationAngle(
                        lastOperationValuesRef.current.rotate,
                        interactiveOperation,
                    ), locale),
                    unit: angleUnitSymbol(interactiveOperation.angleUnit),
                    factor: lastOperationValuesRef.current.scale,
                }));
                return;
            }
            if (interactiveOperation.type === 'mirror' && interactiveOperation.stage === 'mirror-axis') {
                if (pointDistance(interactiveOperation.basePoint, point) <= 1e-9) {
                    setMessage(t('messages.mirrorAxisDistinct'));
                    return;
                }
                setInteractiveOperation({ ...interactiveOperation, stage: 'mirror-choice', axisSecond: point });
                setMessage(t('messages.mirrorOptions'));
                commandBarRef.current?.focus('');
                return;
            }
            if (interactiveOperation.type === 'mirror' && interactiveOperation.stage === 'mirror-choice') return;
            if (!interactiveOperation.basePoint || !point) return;
            if (interactiveOperation.type === 'move') {
                const delta = operationDelta(interactiveOperation.basePoint, point);
                history.commit(updateSelectedEntities(history.content, interactiveOperation.entityIds, entity => translateEntity(entity, delta.x, delta.y)));
                finishInteractiveOperation(interactiveOperation.entityIds, t('messages.moveApplied', { delta: formatOperationDelta(delta, locale) }));
            } else if (interactiveOperation.type === 'copy') {
                const delta = operationDelta(interactiveOperation.basePoint, point);
                const originals = history.content.entities.filter(entity => interactiveOperation.entityIds.includes(entity.id));
                const result = pasteDrawingEntities(history.content, originals, delta);
                history.commit(result.content);
                lastOperationValuesRef.current.copy = Math.hypot(delta.x, delta.y);
                setSelectedIds(result.selectedIds);
                setInteractiveOperation(current => ({ ...current, placedCount: (current.placedCount || 0) + 1 }));
                setMessage(t('messages.copyPlaced', { count: result.entities.length }));
            } else if (interactiveOperation.type === 'rotate') {
                const angle = operationAngle(interactiveOperation.basePoint, point);
                applyRotateOperation(interactiveOperation, angle, interactiveOperation.basePoint);
            } else if (interactiveOperation.type === 'scale') {
                const factor = operationScaleFactor(interactiveOperation.basePoint, point);
                if (factor <= 0) return;
                applyScaleOperation(interactiveOperation, factor, interactiveOperation.basePoint);
            }
            return;
        }

        const operationType = shift
            ? interactiveOperation.type === 'trim' ? 'extend' : 'trim'
            : interactiveOperation.type;
        const trimExtendOptions = {
            boundaryIds: interactiveOperation.boundaryIds,
            extendEdges: interactiveOperation.extendEdges,
            projection: interactiveOperation.projection,
        };

        if (fence) {
            if (operationType !== 'trim') {
                setMessage(t('messages.extendClickEndpoint'));
                return;
            }
            const result = trimDrawingFence(history.content, fence, trimExtendOptions);
            if (result.changedCount) history.commit(result.content);
            const nextBoundaryIds = replaceTrimScope(
                interactiveOperation.boundaryIds,
                result.affectedIds,
                result.replacementIds,
            );
            if (interactiveOperation.boundaryIds) {
                setInteractiveOperation({ ...interactiveOperation, boundaryIds: nextBoundaryIds });
            }
            setSelectedIds(result.replacementIds);
            setMessage(result.changedCount
                ? t('messages.trimFenceChanged', { count: result.changedCount })
                : t('messages.trimFenceMiss'));
            return;
        }

        const target = history.content.entities.find(entity => entity.id === targetId);
        if (!target) {
            setMessage(t(operationType === 'trim' ? 'messages.trimClickPortion' : 'messages.extendClickEndpoint'));
            return;
        }
        if (!canEditEntity(history.content, target)) {
            setMessage(t('messages.trimExtendLocked'));
            return;
        }
        const result = operationType === 'trim'
            ? trimDrawingTarget(history.content, target, point, trimExtendOptions)
            : extendDrawingTarget(history.content, target, point, trimExtendOptions);
        if (!result.changed) {
            setMessage(t(operationType === 'trim' ? 'messages.trimCannot' : 'messages.extendCannot'));
            return;
        }
        history.commit(result.content);
        const replacementIds = result.replacementIds || result.replacements.map(entity => entity.id);
        const nextBoundaryIds = replaceTrimScope(interactiveOperation.boundaryIds, [target.id], replacementIds);
        if (interactiveOperation.boundaryIds) {
            setInteractiveOperation({ ...interactiveOperation, boundaryIds: nextBoundaryIds });
        }
        setSelectedIds(replacementIds);
        setMessage(operationType === 'extend'
            ? t('messages.extendApplied')
            : result.replacements.length
                ? t('messages.trimFragments', { count: result.replacements.length })
                : t('messages.trimSegmentDeleted'));
    };

    const submitPrecisionPoint = (rawValue, { allowDirectDistance = true } = {}) => {
        const activeCanvas = workspaceMode === 'layout' ? layoutCanvasRef : canvasRef;
        const context = activeCanvas.current?.getPrecisionInputContext?.() || {};
        const result = resolveDrawingPointInput(rawValue, {
            ...context,
            allowDirectDistance,
            decimalComma: locale === 'fr',
            lengthUnit: workspaceMode === 'layout' ? 'mm' : 'm',
            angleUnit: settings.drawingDefaults.angleUnit,
            variables: inputVariablesRef.current,
        });
        if (!result.matched) return false;
        if (!result.valid) {
            setMessage(t(`precisionInput.error.${result.error}`));
            return true;
        }
        const accepted = activeCanvas.current?.submitPoint(result.point, { precision: true });
        if (!accepted) setMessage(t('messages.pointRequired'));
        return true;
    };

    const submitOperationValue = rawValue => {
        if (!interactiveOperation) return false;
        const empty = !String(rawValue).trim();
        if (submitClipboardValue(rawValue, interactiveOperation)) return true;
        if (submitCompoundValue(rawValue, interactiveOperation)) return true;
        if (submitAlignValue(rawValue, interactiveOperation)) return true;
        if (submitCornerValue(rawValue, interactiveOperation)) return true;
        if (submitModificationValue(rawValue, interactiveOperation)) return true;
        if (['trim', 'extend'].includes(interactiveOperation.type)) {
            if (empty) {
                finishInteractiveOperation(selectedIds, t(`messages.${interactiveOperation.type}Complete`));
                return true;
            }
            const trimExtendOption = parseDrawingOperationOption(interactiveOperation, rawValue);
            if (['edgeExtend', 'edgeFinite', 'projectNone'].includes(trimExtendOption?.option)) {
                const nextOperation = {
                    ...interactiveOperation,
                    ...(trimExtendOption.option === 'edgeExtend' ? { extendEdges: true } : {}),
                    ...(trimExtendOption.option === 'edgeFinite' ? { extendEdges: false } : {}),
                    ...(trimExtendOption.option === 'projectNone' ? { projection: 'none' } : {}),
                };
                setInteractiveOperation(nextOperation);
                setMessage(t('messages.trimExtendOptionSet', {
                    option: t(`operationOptions.${interactiveOperation.type}.${trimExtendOption.option === 'edgeExtend'
                        ? 'extendEdge'
                        : trimExtendOption.option === 'edgeFinite' ? 'finiteEdge' : 'projectNone'}`),
                }));
                return true;
            }
        }
        if (interactiveOperation.stage === 'mirror-choice') {
            completeMirrorChoice(interactiveOperation, rawValue);
            return true;
        }
        if (interactiveOperation.type === 'mirror' && ['mirror-option-base', 'mirror-option-axis'].includes(interactiveOperation.stage)) {
            if (parseDrawingOperationOption(interactiveOperation, rawValue)) {
                completeMirrorChoice(interactiveOperation, rawValue);
                return true;
            }
            if (submitPrecisionPoint(rawValue)) return true;
            const values = parseDrawingNumbers(rawValue);
            if (values.length >= 2) handleMirrorPoint(interactiveOperation, { x: values[0], y: values[1] });
            else setMessage(t('messages.mirrorPointOrCoordinates'));
            return true;
        }
        if (interactiveOperation.type === 'array') {
            const pointMode = operationPrecisionPointMode(interactiveOperation);
            if (pointMode && submitPrecisionPoint(rawValue, { allowDirectDistance: pointMode === 'direct' })) return true;
            return submitArrayValue(interactiveOperation, rawValue);
        }
        const parsedOption = parseDrawingOperationOption(interactiveOperation, rawValue);
        if (parsedOption?.option === 'reference' && ['scale', 'rotate'].includes(interactiveOperation.type)) {
            const referenceOperation = beginReferenceTransform(interactiveOperation, interactiveOperation.type === 'rotate'
                ? { referenceMode: 'sourceTarget' }
                : {});
            setInteractiveOperation(referenceOperation);
            setMessage(referenceTransformPrompt(referenceOperation, t));
            return true;
        }
        if (parsedOption?.option === 'nonUniform' && interactiveOperation.type === 'scale'
            && parsedOption.args.length >= 2 && interactiveOperation.basePoint) {
            const [scaleX, scaleY] = parsedOption.args;
            if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) {
                setMessage(t('messages.scaleXYPositive'));
                return true;
            }
            applyScaleOperation(interactiveOperation, { scaleX, scaleY }, interactiveOperation.basePoint);
            return true;
        }
        const reopened = reopenBasicDrawingOperationOption(interactiveOperation, parsedOption, t);
        if (reopened) {
            setInteractiveOperation(reopened.operation);
            setMessage(reopened.message);
            if (reopened.focus) commandBarRef.current?.focus('');
            return true;
        }
        const pointMode = operationPrecisionPointMode(interactiveOperation);
        if (pointMode && submitPrecisionPoint(rawValue, { allowDirectDistance: pointMode === 'direct' })) return true;
        let values = empty ? (interactiveOperation.requestedValues || []) : parseDrawingNumbers(rawValue);
        if (!empty && !isNumericDrawingInput(rawValue)) {
            if (!isDrawingExpressionInput(rawValue, inputVariablesRef.current)) return false;
            try {
                values = [evaluateDrawingExpression(rawValue, {
                    decimalComma: locale === 'fr',
                    unitType: interactiveOperation.stage === 'angle' ? 'angle' : 'length',
                    angleUnit: interactiveOperation.angleUnit,
                    lengthUnit: workspaceMode === 'layout' ? 'mm' : 'm',
                    variables: inputVariablesRef.current,
                })];
            } catch (error) {
                setMessage(t(`precisionInput.error.${error?.precisionInputCode || 'invalidExpression'}`));
                return true;
            }
        }
        if (interactiveOperation.stage === 'select') return confirmOperationSelection();
        if (interactiveOperation.stage === 'reference') {
            if (values.length >= 2) handleReferencePoint(interactiveOperation, { x: values[0], y: values[1] });
            else setMessage(referenceTransformPrompt(interactiveOperation, t));
            return true;
        }
        if (interactiveOperation.stage === 'distance') {
            const distance = values[0] ?? lastOperationValuesRef.current.offset;
            if (!Number.isFinite(distance) || distance <= 0) {
                setMessage(t('messages.offsetPositive'));
                return true;
            }
            lastOperationValuesRef.current.offset = distance;
            setInteractiveOperation({ ...interactiveOperation, stage: 'side', distance });
            setMessage(t('operationPrompt.offsetSide', { distance }));
            return true;
        }
        if (interactiveOperation.stage === 'destination') {
            const basePoint = interactiveOperation.basePoint;
            const currentPoint = canvasRef.current?.getOperationPoint();
            let delta = null;
            if (values.length >= 2) delta = { x: values[0], y: values[1] };
            else {
                const distance = values[0] ?? lastOperationValuesRef.current[interactiveOperation.type];
                delta = directionalDelta(basePoint, currentPoint, distance);
                if (Number.isFinite(distance)) lastOperationValuesRef.current[interactiveOperation.type] = distance;
            }
            if (!delta) return true;
            handleInteractiveOperation({ point: { x: basePoint.x + delta.x, y: basePoint.y + delta.y } });
            return true;
        }
        if (interactiveOperation.stage === 'angle') {
            const enteredAngle = values[0] ?? interactiveOperation.requestedValue
                ?? displayRotationAngle(lastOperationValuesRef.current.rotate, interactiveOperation);
            const configured = createAngleConfig(enteredAngle, {
                unit: interactiveOperation.angleUnit,
                direction: interactiveOperation.angleDirection,
            });
            if (!configured) return true;
            applyRotateOperation(interactiveOperation, configured.radians * 180 / Math.PI, interactiveOperation.basePoint);
            return true;
        }
        if (interactiveOperation.stage === 'scale-xy') {
            const [scaleX, scaleY] = values;
            if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) {
                setMessage(t('messages.scaleXYPositive'));
                return true;
            }
            applyScaleOperation(interactiveOperation, { scaleX, scaleY }, interactiveOperation.basePoint);
            return true;
        }
        if (interactiveOperation.stage === 'factor') {
            const factor = values[0] ?? interactiveOperation.requestedValue ?? lastOperationValuesRef.current.scale;
            if (!Number.isFinite(factor) || factor <= 0) {
                setMessage(t('messages.scalePositive'));
                return true;
            }
            lastOperationValuesRef.current.scale = factor;
            handleInteractiveOperation({
                point: { x: interactiveOperation.basePoint.x + factor, y: interactiveOperation.basePoint.y },
            });
            return true;
        }
        if (empty) setMessage(t('messages.pointRequired'));
        return true;
    };

    const setOrthoMode = enabled => {
        const nextEnabled = Boolean(enabled);
        history.commit(current => ({
            ...current,
            settings: {
                ...current.settings,
                ortho: nextEnabled,
                ...(nextEnabled ? { polarTracking: false } : {}),
            },
        }));
        setMessage(t(nextEnabled ? 'messages.orthoEnabled' : 'messages.orthoDisabled'));
    };

    const setPolarMode = enabled => {
        const nextEnabled = Boolean(enabled);
        history.commit(current => ({
            ...current,
            settings: {
                ...current.settings,
                polarTracking: nextEnabled,
                ...(nextEnabled ? { ortho: false } : {}),
            },
        }));
        setMessage(t(nextEnabled ? 'messages.polarEnabled' : 'messages.polarDisabled'));
    };

    const setObjectTrackingMode = enabled => {
        const nextEnabled = Boolean(enabled);
        history.commit(current => ({
            ...current,
            settings: { ...current.settings, tracking: nextEnabled },
        }));
        setMessage(t(nextEnabled ? 'messages.objectTrackingEnabled' : 'messages.objectTrackingDisabled'));
    };

    const executeDraftingCommand = parsed => {
        if (!draftingCommands.has(parsed?.command)) return false;
        if (parsed.command === 'ortho') {
            setOrthoMode(parsed.args.length ? parsed.args[0] !== 0 : !history.content.settings.ortho);
        } else if (parsed.command === 'polar') {
            if (parsed.args.length) {
                const [increment, ...additionalAngles] = parsed.args;
                if (increment === 0 && !additionalAngles.length) {
                    setPolarMode(false);
                } else if (Number.isFinite(increment) && increment >= 1 && increment <= 180) {
                    history.commit(current => ({
                        ...current,
                        settings: {
                            ...current.settings,
                            ortho: false,
                            polarTracking: true,
                            polarIncrement: increment,
                            polarAngles: normalizePolarAngles(additionalAngles),
                        },
                    }));
                    setMessage(t('messages.polarConfigured', { increment }));
                } else setMessage(t('messages.polarIncrementInvalid'));
            } else setPolarMode(!history.content.settings.polarTracking);
        } else if (parsed.command === 'objectTracking') {
            setObjectTrackingMode(parsed.args.length ? parsed.args[0] !== 0 : !history.content.settings.tracking);
        } else if (parsed.command === 'draftingSettings') {
            setDraftingSettingsOpen(true);
            setMessage(t('messages.draftingSettingsOpened'));
        } else if (parsed.command === 'temporaryTrackingPoint') {
            canvasRef.current?.beginTemporaryTrackingPoint();
        }
        return true;
    };

    const runCalculation = rawExpression => {
        const expression = String(rawExpression || '').trim();
        if (!expression) {
            setCalculatorMode(true);
            setMessage(t('messages.calculatorPrompt'));
            commandBarRef.current?.focus('');
            return true;
        }
        try {
            const result = evaluateDrawingCalculation(expression, inputVariablesRef.current, {
                decimalComma: locale === 'fr',
            });
            inputVariablesRef.current = result.variables;
            setCalculatorMode(false);
            const value = formatNumber(result.value, { maximumFractionDigits: 10 });
            setMessage(t(result.variable
                ? 'messages.calculatorVariableSet'
                : 'messages.calculatorResult', { name: result.variable, value }));
        } catch (error) {
            setCalculatorMode(true);
            setMessage(t(`precisionInput.error.${error?.precisionInputCode || 'invalidExpression'}`));
        }
        return true;
    };

    const executePrecisionCommand = (parsed, rawValue) => {
        if (parsed?.command === 'quickCalc') return runCalculation(getDrawingCommandInput(rawValue));
        if (parsed?.command !== 'dynamicInput') return false;
        const requested = resolveBooleanModeInput(getDrawingCommandInput(rawValue), history.content.settings.dynamicInput);
        if (requested === null) {
            setMessage(t('messages.dynamicInputChoice'));
            return true;
        }
        history.commit(current => ({
            ...current,
            settings: { ...current.settings, dynamicInput: requested },
        }));
        setMessage(t(requested ? 'messages.dynamicInputEnabled' : 'messages.dynamicInputDisabled'));
        return true;
    };

    const activateTextTool = textMode => {
        openModelWorkspace();
        canvasRef.current?.cancel();
        canvasRef.current?.setTextCreationMode(textMode);
        setActiveTool('text');
        setMessage(t('messages.toolActive', {
            tool: t(textMode === 'multiline' ? 'commands.multilineText' : 'commands.text'),
        }));
    };

    const activateDimensionTool = mode => {
        openModelWorkspace();
        canvasRef.current?.cancel();
        setDimensionMode(mode);
        setActiveTool('dimension');
        setMessage(t('messages.dimensionPrompt'));
    };

    const commitDimensionCommand = (result, fallbackMode = null) => {
        if (result?.changed) {
            openModelWorkspace();
            history.commit(result.content);
            setSelectedIds(result.selectedIds);
            setActiveTool('select');
            setMessage(t('messages.dimensionCreated', { count: result.entities.length }));
            return true;
        }
        if (fallbackMode) {
            activateDimensionTool(fallbackMode);
            return true;
        }
        setMessage(t('messages.dimensionSelectionRequired'));
        return false;
    };

    const selectedIdsOfTypes = types => {
        const accepted = new Set(types);
        return selectedEntities.filter(entity => accepted.has(entity.type)).map(entity => entity.id);
    };

    const inferredLinearMeasurementMode = () => {
        const source = selectedEntities.find(entity => ['line', 'rectangle', 'polygon'].includes(entity.type));
        if (source?.type !== 'line') return 'horizontal';
        return Math.abs(source.y2 - source.y1) > Math.abs(source.x2 - source.x1) ? 'vertical' : 'horizontal';
    };

    const submitCommand = async rawValue => {
        const immediateCommand = parseDrawingCommand(rawValue);
        if (executeDraftingCommand(immediateCommand)) {
            setCommandValue('');
            return;
        }
        if (executePrecisionCommand(immediateCommand, rawValue)) {
            setCommandValue('');
            return;
        }
        if (calculatorMode) {
            runCalculation(rawValue);
            setCommandValue('');
            return;
        }
        if (!interactiveOperation && (!immediateCommand || immediateCommand.command === 'unknown')
            && hasDrawingPointSyntax(rawValue, { decimalComma: locale === 'fr' })
            && submitPrecisionPoint(rawValue)) {
            setCommandValue('');
            return;
        }
        if (isNumericDrawingInput(rawValue) && canvasRef.current?.applyNumericInput(rawValue)) {
            setCommandValue('');
            setMessage(t('messages.objectCreatedFromValue'));
            return;
        }
        if (submitOperationValue(rawValue)) {
            setCommandValue('');
            return;
        }
        if (interactiveOperation) {
            setCommandValue('');
            setMessage(t('messages.continueActiveCommand'));
            return;
        }
        if (workspaceMode === 'model' && activeTool !== 'select'
            && (!immediateCommand || immediateCommand.command === 'unknown')) {
            if (canvasRef.current?.submitCreationInput(rawValue)) {
                setCommandValue('');
                return;
            }
            if (submitPrecisionPoint(rawValue)) {
                setCommandValue('');
                return;
            }
            setCommandValue('');
            setMessage(t('messages.continueActiveCommand'));
            return;
        }
        if (workspaceMode === 'layout' && layoutTool === 'viewport'
            && (!immediateCommand || immediateCommand.command === 'unknown')
            && submitPrecisionPoint(rawValue)) {
            setCommandValue('');
            return;
        }
        const parsed = parseDrawingCommand(rawValue);
        if (parsed?.command === 'unknown' && canvasRef.current?.submitCreationInput(rawValue)) {
            setCommandValue('');
            return;
        }
        setCommandValue('');
        if (!parsed) return;
        setInteractiveOperation(null);
        canvasRef.current?.cancel();
        if (parsed.command === 'modelSpace') {
            openModelWorkspace();
            return;
        }
        if (parsed.command === 'paperSpace') {
            if (activeLayout) openLayoutWorkspace(activeLayout.id);
            else addLayout();
            return;
        }
        if (parsed.command === 'layout') {
            const requestedTemplate = String(getDrawingCommandInput(rawValue) || '').trim();
            const template = {
                BLANK: 'blank',
                SINGLE: 'single',
                ONE: 'single',
                TWOHORIZONTAL: 'twoHorizontal',
                HORIZONTAL: 'twoHorizontal',
                TWOVERTICAL: 'twoVertical',
                VERTICAL: 'twoVertical',
                FOUR: 'four',
                '4': 'four',
            }[requestedTemplate.replace(/[\s_-]+/g, '').toUpperCase()];
            if (template) addLayout(template);
            else if (activeLayout) openLayoutWorkspace(activeLayout.id);
            else addLayout();
            return;
        }
        if (parsed.command === 'pageSetup') {
            if (activeLayout) openLayoutWorkspace(activeLayout.id);
            else addLayout();
            return;
        }
        if (parsed.command === 'pageSetupImport') {
            await importPageSetups();
            return;
        }
        if (parsed.command === 'pageSetupExport') {
            await exportPageSetups();
            return;
        }
        if (parsed.command === 'viewport') {
            if (!activeLayout) addLayout();
            else {
                openLayoutWorkspace(activeLayout.id);
                setLayoutTool('viewport');
                setMessage(t('layout.viewportFirstPoint'));
            }
            return;
        }
        if (parsed.command === 'viewportClip') {
            if (!activeLayout || !selectedViewportId) {
                setMessage(t('layout.viewportSelectionRequired'));
                return;
            }
            const selectedViewport = activeLayout.viewports.find(viewport => viewport.id === selectedViewportId);
            commitActiveLayout(updateDrawingViewport(activeLayout, selectedViewportId, {
                clipBoundary: selectedViewport?.clipBoundary ? null : createDrawingViewportClipPreset('hexagon'),
            }));
            setMessage(t('layout.viewportClipUpdated'));
            return;
        }
        if (parsed.command === 'viewportLayer') {
            if (!activeLayout || !selectedViewportId) {
                setMessage(t('layout.viewportSelectionRequired'));
                return;
            }
            openLayoutWorkspace(activeLayout.id);
            setSelectedViewportId(selectedViewportId);
            setMessage(t('layout.viewportLayerOverridesOpened'));
            return;
        }
        if (parsed.command === 'viewportMax') {
            if (!activeLayout || !selectedViewportId) {
                setMessage(t('layout.viewportSelectionRequired'));
                return;
            }
            setMaximizedViewportId(selectedViewportId);
            setLayoutTool('pan-view');
            setMessage(t('layout.viewportMaximized'));
            return;
        }
        if (parsed.command === 'viewportMin') {
            setMaximizedViewportId(null);
            setLayoutTool('select');
            setMessage(t('layout.viewportMinimized'));
            return;
        }
        if (parsed.command === 'text' || parsed.command === 'multilineText') {
            activateTextTool(parsed.command === 'multilineText' ? 'multiline' : 'singleLine');
            return;
        }
        if (parsed.command === 'textEdit') {
            openModelWorkspace();
            const text = selectedEntities.length === 1 && selectedEntities[0].type === 'text'
                ? selectedEntities[0]
                : null;
            if (!text || !canvasRef.current?.editText(text.id)) {
                setMessage(t('messages.textSelectionRequired'));
                return;
            }
            setActiveTool('select');
            setSidebarPanel('selection');
            setMessage(t('textEditor.opened'));
            return;
        }
        if (parsed.command === 'textStyle') {
            openModelWorkspace();
            setSidebarPanel('textStyles');
            setMessage(t('messages.textStylesOpened'));
            return;
        }
        if (parsed.command === 'dimension') {
            activateDimensionTool('auto');
            return;
        }
        if (parsed.command === 'linearDimension') {
            const measurementMode = inferredLinearMeasurementMode();
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIdsOfTypes(['line', 'rectangle', 'polygon', 'linearDimension']),
                { measurementMode },
            ), { mode: measurementMode });
            return;
        }
        if (parsed.command === 'alignedDimension') {
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIdsOfTypes(['line', 'rectangle', 'polygon', 'linearDimension']),
                { measurementMode: 'aligned' },
            ), { mode: 'aligned' });
            return;
        }
        if (parsed.command === 'rotatedDimension') {
            const dimensionAngle = (parsed.args[0] || 0) * Math.PI / 180;
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIdsOfTypes(['line', 'rectangle', 'polygon', 'linearDimension']),
                { measurementMode: 'rotated', dimensionAngle },
            ), { mode: 'rotated', dimensionAngle });
            return;
        }
        if (parsed.command === 'angularDimension') {
            commitDimensionCommand(
                createAngularDimensionResult(history.content, selectedIds),
                { mode: 'angular' },
            );
            return;
        }
        if (parsed.command === 'arcDimension') {
            commitDimensionCommand(
                createArcLengthDimensionResult(history.content, selectedIds),
                { mode: 'arcLength' },
            );
            return;
        }
        if (parsed.command === 'radiusDimension' || parsed.command === 'diameterDimension') {
            const radialMode = parsed.command === 'diameterDimension' ? 'diameter' : 'radius';
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIdsOfTypes(['circle', 'arc']),
                { radialMode },
            ), { mode: radialMode });
            return;
        }
        if (parsed.command === 'joggedDimension') {
            commitDimensionCommand(
                createJoggedRadiusDimensionResult(history.content, selectedIds),
                { mode: 'joggedRadius' },
            );
            return;
        }
        if (parsed.command === 'ordinateDimension') {
            const requestedAxis = String(getDrawingCommandInput(rawValue) || '').trim().toUpperCase();
            const axis = requestedAxis === 'Y' ? 'y' : 'x';
            commitDimensionCommand(
                createOrdinateDimensionResult(history.content, selectedIds, { axis }),
                { mode: 'ordinate', axis },
            );
            return;
        }
        if (parsed.command === 'quickDimension') {
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIds,
                parseQdimCommandOptions(getDrawingCommandInput(rawValue)),
            ));
            return;
        }
        if (parsed.command === 'baselineDimension') {
            const { baselineEnd } = parseQdimCommandOptions(
                getDrawingCommandInput(rawValue),
                { qdimMode: 'baseline' },
            );
            commitDimensionCommand(createBaselineDimensionResult(history.content, selectedIds, { baselineEnd }));
            return;
        }
        if (parsed.command === 'continueDimension') {
            commitDimensionCommand(createContinuedDimensionResult(history.content, selectedIds));
            return;
        }
        if (parsed.command === 'centerMark') {
            commitDimensionCommand(
                createCenterMarkResult(history.content, selectedIds),
                { mode: 'centerMark' },
            );
            return;
        }
        if (['select', 'line', 'rectangle', 'circle', 'polygon', 'arc', 'pan'].includes(parsed.command)) {
            openModelWorkspace();
            if (['rectangle', 'circle', 'polygon', 'arc'].includes(parsed.command)) {
                canvasRef.current?.submitCreationInputForTool(parsed.command, rawValue);
            }
            setActiveTool(parsed.command);
            setMessage(t('messages.toolActive', { tool: t(`commands.${parsed.command}`) }));
            return;
        }
        if (parsed.command === 'creationPanel') {
            const valid = selectedEntities.filter(supportsDrawingCreationPanel);
            if (selectedEntities.length !== 1 || valid.length !== 1) {
                setCreationPanelEntityId(null);
                setMessage(t('messages.creationPanelSelectionRequired'));
                return;
            }
            openModelWorkspace();
            canvasRef.current?.cancel();
            setInteractiveOperation(null);
            setActiveTool('select');
            setCreationPanelEntityId(valid[0].id);
            setMessage(t('messages.creationPanelOpened', { type: t(`entity.${valid[0].type}`) }));
            return;
        }
        if (parsed.command === 'offset') {
            beginTransformOperation('offset', parsed.args[0]);
        } else if (parsed.command === 'trim') {
            beginTrim();
        } else if (parsed.command === 'extend') {
            beginExtend();
        } else if (parsed.command === 'break') {
            beginBreakCommand(false);
        } else if (parsed.command === 'breakAtPoint') {
            beginBreakCommand(true);
        } else if (parsed.command === 'stretch') {
            beginStretchCommand();
        } else if (parsed.command === 'lengthen') {
            beginLengthenCommand(parsed.args[0]);
        } else if (parsed.command === 'copyBase') {
            beginCopyBase();
        } else if (parsed.command === 'copyClip') {
            await copyClip();
        } else if (parsed.command === 'cutClip') {
            await cutClip();
        } else if (parsed.command === 'pasteClip') {
            await beginPasteClip();
        } else if (parsed.command === 'pasteOriginal') {
            await pasteOriginal();
        } else if (parsed.command === 'pasteBlock') {
            await beginPasteBlock();
        } else if (parsed.command === 'move') {
            beginTransformOperation('move', parsed.args[0]);
        } else if (parsed.command === 'scale') {
            beginTransformOperation('scale', parsed.args[0]);
        } else if (parsed.command === 'rotate') beginTransformOperation('rotate', parsed.args[0]);
        else if (parsed.command === 'copy') beginTransformOperation('copy', parsed.args[0]);
        else if (parsed.command === 'mirror') beginTransformOperation('mirror');
        else if (parsed.command === 'array') beginArray();
        else if (parsed.command === 'align') beginAlign();
        else if (['fillet', 'chamfer', 'blend'].includes(parsed.command)) beginCornerOperation(parsed.command, parsed.args);
        else if (parsed.command === 'join') beginCompoundOperation('join');
        else if (parsed.command === 'explode') beginCompoundOperation('explode');
        else if (parsed.command === 'xplode') beginCompoundOperation('xplode');
        else if (parsed.command === 'delete') workspaceMode === 'layout' ? deleteSelectedViewport() : deleteSelection();
        else if (parsed.command === 'undo') history.undo();
        else if (parsed.command === 'redo') history.redo();
        else if (parsed.command === 'saveAs') await saveDrawingAs();
        else if (parsed.command === 'new') await createNewDrawing();
        else if (parsed.command === 'open') await openDrawing();
        else if (parsed.command === 'pdf') await exportPdf(activeLayout ? [activeLayout.id] : []);
        else if (parsed.command === 'pdfAll') await exportPdf(layouts.map(layout => layout.id));
        else if (parsed.command === 'pdfSelected') await exportPdf(selectedLayoutIds);
        else if (parsed.command === 'fit') canvasRef.current?.fit();
        else if (parsed.command === 'zoom' && parsed.args[0]) canvasRef.current?.zoom(1 / parsed.args[0]);
        else setMessage(t('messages.unknownCommand', { command: parsed.alias }));
    };

    const toggleAllSnaps = () => {
        const snaps = history.content.settings.snaps;
        const shouldEnable = !Object.values(snaps).some(Boolean);
        history.commit({
            ...history.content,
            settings: {
                ...history.content.settings,
                snaps: Object.fromEntries(Object.keys(snaps).map(key => [key, shouldEnable])),
            },
        });
        setMessage(t(shouldEnable ? 'messages.snapsEnabled' : 'messages.snapsDisabled'));
    };

    const cancelCommand = () => {
        if (workspaceMode === 'layout') {
            layoutCanvasRef.current?.cancel();
            setSelectedViewportId(null);
            setLayoutTool('select');
        } else canvasRef.current?.cancel();
        setSelectedIds([]);
        setCreationPanelEntityId(null);
        setInteractiveOperation(null);
        setCalculatorMode(false);
        setActiveTool('select');
        setCommandValue('');
        setMessage(t('messages.commandCancelled'));
    };

    useDrawingEditorShortcuts({ commandBarRef, actions: {
        undo: history.undo,
        redo: history.redo,
        copy: copyClip,
        cut: cutClip,
        paste: beginPasteClip,
        saveAs: saveDrawingAs,
        newDocument: createNewDrawing,
        open: openDrawing,
        delete: () => workspaceMode === 'layout' ? deleteSelectedViewport() : deleteSelection(),
        toggleSnaps: toggleAllSnaps,
        toggleOrtho: () => setOrthoMode(!history.content.settings.ortho),
        togglePolar: () => setPolarMode(!history.content.settings.polarTracking),
        toggleObjectTracking: () => setObjectTrackingMode(!history.content.settings.tracking),
        enter: () => submitCommand(''),
        cancel: cancelCommand,
    } });

    const toolbarActions = {
        undo: history.undo,
        redo: history.redo,
        copy: () => copyClip().catch(() => {}),
        cut: () => cutClip().catch(() => {}),
        paste: () => beginPasteClip().catch(() => {}),
        delete: deleteSelection,
        move: () => beginTransformOperation('move'),
        copyCommand: () => beginTransformOperation('copy'),
        rotate: () => beginTransformOperation('rotate'),
        mirror: () => beginTransformOperation('mirror'),
        array: beginArray,
        align: beginAlign,
        fillet: () => beginCornerOperation('fillet'),
        chamfer: () => beginCornerOperation('chamfer'),
        blend: () => beginCornerOperation('blend'),
        join: () => beginCompoundOperation('join'),
        explode: () => beginCompoundOperation('explode'),
        offset: () => beginTransformOperation('offset'),
        trim: beginTrim,
        extend: beginExtend,
        break: () => beginBreakCommand(false),
        breakAtPoint: () => beginBreakCommand(true),
        stretch: beginStretchCommand,
        lengthen: () => beginLengthenCommand(),
        scale: () => beginTransformOperation('scale'),
        zoomIn: () => canvasRef.current?.zoom(0.8),
        zoomOut: () => canvasRef.current?.zoom(1.25),
        fit: () => canvasRef.current?.fit(),
        importImage: () => imageInputRef.current?.click(),
    };

    useLumcadMcpBridge({
        getState: () => ({
            document,
            filePath,
            recovered: Boolean(recovered && !filePath),
            selection: workspaceMode === 'layout'
                ? (selectedViewportId ? [selectedViewportId] : [])
                : selectedIds,
            editor: {
                activeTool,
                dimensionMode: activeTool === 'dimension' ? dimensionMode : null,
                interactiveOperation,
                workspaceMode,
                activeLayoutId: activeLayout?.id || null,
                selectedLayoutIds,
                layoutTool: workspaceMode === 'layout' ? layoutTool : null,
                selectedViewportId: workspaceMode === 'layout' ? selectedViewportId : null,
                maximizedViewportId: workspaceMode === 'layout' ? maximizedViewportId : null,
                message,
                viewport,
                canUndo: history.canUndo,
                canRedo: history.canRedo,
                calculatorMode,
                inputVariables: { ...inputVariablesRef.current },
            },
        }),
        executeAction: async action => {
            if (action.type === 'selection') {
                const knownIds = new Set(history.content.entities.map(entity => entity.id));
                const viewportIds = new Set(activeLayout?.viewports.map(viewport => viewport.id) || []);
                const ids = [...new Set(action.ids || [])];
                const unknownIds = ids.filter(id => !knownIds.has(id) && !viewportIds.has(id));
                if (unknownIds.length) throw new Error(`Unknown LUMCAD entity IDs: ${unknownIds.join(', ')}`);
                const selectedViewportIds = ids.filter(id => viewportIds.has(id));
                const selectedEntityIds = ids.filter(id => knownIds.has(id));
                if (selectedViewportIds.length && selectedEntityIds.length) {
                    throw new Error('A LUMCAD selection cannot mix model entities and layout viewports.');
                }
                if (selectedViewportIds.length > 1) {
                    throw new Error('Only one layout viewport can be selected at a time.');
                }
                if (selectedViewportIds.length) {
                    setWorkspaceMode('layout');
                    setSelectedViewportId(selectedViewportIds[0]);
                    setSelectedIds([]);
                    return;
                }
                if (workspaceMode === 'layout') setSelectedViewportId(null);
                setSelectedIds(ids);
                return;
            }
            if (action.type === 'command') {
                const definition = getDrawingCommandDefinition(action.command);
                if (!definition) throw new Error(`Unknown LUMCAD command: ${String(action.command || '')}`);
                await submitCommand([definition.name, action.input].filter(value => value !== null && value !== undefined && value !== '').join(' '));
                return;
            }
            if (action.type === 'point') {
                const activeCanvas = workspaceMode === 'layout' ? layoutCanvasRef : canvasRef;
                const accepted = activeCanvas.current?.submitPoint(
                    { x: action.x, y: action.y },
                    { targetId: action.targetId, shift: action.shift, snap: action.snap },
                );
                if (!accepted) throw new Error('The active LUMCAD command cannot accept this point.');
                return;
            }
            if (action.type === 'input') {
                await submitCommand(action.value);
                return;
            }
            if (action.type === 'enter') {
                await submitCommand('');
                return;
            }
            if (action.type === 'escape') {
                cancelCommand();
                return;
            }
            throw new Error(`Unsupported LUMCAD MCP action: ${String(action.type || '')}`);
        },
        replaceDocument: async replacement => {
            if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
                throw new Error('replace_document requires a LUMCAD document object.');
            }
            const normalized = normalizeLcadDocument({ ...document, ...replacement });
            canvasRef.current?.cancel();
            history.commitDocument({
                content: normalized.content,
                layouts: normalized.layouts,
                pageSetups: normalized.pageSetups || [],
            });
            setName(normalized.name);
            setAssets(normalized.assets);
            setActiveLayoutId(normalized.layouts[0]?.id || null);
            setSelectedLayoutIds(normalized.layouts[0]?.id ? [normalized.layouts[0].id] : []);
            setWorkspaceMode('model');
            setSelectedViewportId(null);
            setMaximizedViewportId(null);
            setLayoutTool('select');
            setSelectedIds([]);
            setInteractiveOperation(null);
            setActiveTool('select');
            setMessage('');
        },
    });

    return (
        <>
            <div className="drawing-editor-shell has-workspace-tabs" onDragStart={event => { if (!isDrawingTextInput(event.target)) event.preventDefault(); }}>
                <DrawingEditorHeader
                    name={name}
                    onNameChange={setName}
                    filePath={filePath}
                    saveStatus={autosave.status}
                    isRecovery={autosave.isRecovery || (recovered && !filePath)}
                    lastSavedAt={autosave.lastSavedAt}
                    onNew={() => createNewDrawing().catch(() => {})}
                    onOpen={() => openDrawing().catch(() => {})}
                    onSaveAs={() => saveDrawingAs().catch(() => {})}
                    onOpenSettings={onOpenSettings}
                />
                {workspaceMode === 'model' ? (
                    <DrawingEditorBody
                        toolbar={{ activeTool, activeOperation: interactiveOperation?.type || null, actions: toolbarActions,
                            selectionCount: selectedIds.length, canUndo: history.canUndo, canRedo: history.canRedo }}
                        onToolChange={tool => {
                            canvasRef.current?.cancel();
                            setCreationPanelEntityId(null);
                            if (tool === 'dimension') setDimensionMode('auto');
                            setActiveTool(tool);
                            setInteractiveOperation(null);
                            setMessage(tool === 'dimension'
                                ? t('messages.dimensionPrompt')
                                : t('messages.toolActive', { tool: t(`commands.${tool}`) }));
                        }}
                        canvasRef={canvasRef}
                        canvas={{ content: history.content, assets, activeTool, dimensionMode, selectedIds, interactiveOperation,
                            onSelectionChange: setSelectedIds, onCommit: history.commit, onViewportChange: setViewport,
                            onEndCoalescing: history.endCoalescing,
                            onStatus: setMessage, onInteractiveOperation: handleInteractiveOperation,
                            dynamicInput: { value: commandValue, onChange: setCommandValue,
                                onSubmit: value => submitCommand(value).catch(() => {}) },
                            onEntityCreated: entity => {
                                if (!supportsDrawingCreationPanel(entity) || entity.type === 'text') return;
                                setCreationPanelEntityId(entity.id);
                                setInteractiveOperation(null);
                                setActiveTool('select');
                                setMessage(t('messages.creationPanelOpened', { type: t(`entity.${entity.type}`) }));
                            },
                            editEntity: creationPanelEntity,
                            onEditEntityChange: creationPanelEntity && canEditEntity(history.content, creationPanelEntity)
                                ? patch => history.commit(updateSelectedEntities(
                                    history.content,
                                    [creationPanelEntityId],
                                    entity => ({ ...entity, ...patch }),
                                ), { coalesceKey: `creation-panel-${creationPanelEntityId}` })
                                : null }}
                        snap={{ content: history.content, onChange: history.commit,
                            scaleRatio: getScreenScaleRatio(viewport.worldUnitsPerPixel),
                            onScaleChange: ratio => canvasRef.current?.setScaleRatio(ratio),
                            draftingSettingsOpen,
                            onDraftingSettingsOpenChange: setDraftingSettingsOpen,
                            onTemporaryTrackingPoint: () => canvasRef.current?.beginTemporaryTrackingPoint() }}
                        commandBarRef={commandBarRef}
                        command={{ value: commandValue, onChange: setCommandValue,
                            onSubmit: value => submitCommand(value).catch(() => {}), message,
                            operation: interactiveOperation, activeTool }}
                        sidebar={{ content: history.content, selectedIds, onCommit: history.commit,
                            panel: sidebarPanel, onPanelChange: setSidebarPanel }}
                    />
                ) : activeLayout && (
                    <DrawingLayoutEditor
                        activeTool={layoutTool}
                        assets={assets}
                        canvasRef={layoutCanvasRef}
                        command={{
                            value: commandValue,
                            onChange: setCommandValue,
                            onSubmit: value => submitCommand(value).catch(() => {}),
                            operation: interactiveOperation,
                        }}
                        commandBarRef={commandBarRef}
                        content={history.content}
                        currentModelViewport={viewport}
                        isExporting={isExporting}
                        layout={activeLayout}
                        layoutCount={layouts.length}
                        message={message}
                        onChange={commitActiveLayout}
                        onCreatePageSetup={createPageSetup}
                        onDeleteLayout={() => deleteLayout(activeLayout.id)}
                        onDeletePageSetup={deletePageSetup}
                        onDeleteViewport={deleteSelectedViewport}
                        onExportAll={() => exportPdf(layouts.map(layout => layout.id)).catch(() => {})}
                        onExportCurrent={() => exportPdf([activeLayout.id]).catch(() => {})}
                        onExportPageSetups={() => exportPageSetups().catch(() => {})}
                        onImportPageSetups={() => importPageSetups().catch(() => {})}
                        onMaximizeViewport={viewportId => {
                            setSelectedViewportId(viewportId);
                            setMaximizedViewportId(viewportId);
                            setLayoutTool('pan-view');
                            setMessage(t('layout.viewportMaximized'));
                        }}
                        onMinimizeViewport={() => {
                            setMaximizedViewportId(null);
                            setLayoutTool('select');
                            setMessage(t('layout.viewportMinimized'));
                        }}
                        onSelectedViewportChange={setSelectedViewportId}
                        onScaleViewport={() => beginViewportScale()}
                        onStatus={setMessage}
                        onToolChange={tool => {
                            layoutCanvasRef.current?.cancel();
                            setInteractiveOperation(null);
                            setLayoutTool(tool);
                            setMessage(t({
                                viewport: 'layout.viewportFirstPoint',
                                'pan-view': 'layout.panViewPrompt',
                                'pan-paper': 'layout.panPaperPrompt',
                            }[tool] || 'layout.selectPrompt'));
                        }}
                        selectedViewportId={selectedViewportId}
                        operation={interactiveOperation?.scope === 'viewport' ? interactiveOperation : null}
                        pageSetups={pageSetups}
                        viewportMaximized={Boolean(maximizedViewportId)}
                        maximizedViewportId={maximizedViewportId}
                        onOperationPoint={point => handleInteractiveOperation({ point })}
                    />
                )}
                <DrawingWorkspaceTabs
                    activeLayoutId={activeLayout?.id || null}
                    isExporting={isExporting}
                    layouts={layouts}
                    mode={workspaceMode}
                    onAddLayout={addLayout}
                    onAddLayoutFromTemplate={addLayout}
                    onDeleteLayout={deleteLayout}
                    onDuplicateLayout={duplicateLayout}
                    onExportSelected={ids => exportPdf(ids).catch(() => {})}
                    onMoveLayout={moveLayout}
                    onOpenLayout={openLayoutWorkspace}
                    onOpenModel={openModelWorkspace}
                    onRenameLayout={renameLayout}
                    onSelectedLayoutsChange={setSelectedLayoutIds}
                    selectedLayoutIds={selectedLayoutIds}
                />
                <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleImageFile} disabled={isUploading} />
                {isUploading && <div className="drawing-upload-indicator">{t('messages.importingImage')}</div>}
            </div>
            {printJob && <div className="lumcad-print-root"><DrawingPrintPage drawing={printJob.drawing} layouts={printJob.layouts} /></div>}
        </>
    );
}

function referenceTransformPrompt(operation, t) {
    const points = operation?.referencePoints || [];
    if (operation?.type === 'rotate' && operation.referenceMode === 'sourceTarget') {
        if (!operation.basePoint) return t('messages.rotateReferenceBasePoint');
        const pointName = 'ABCD'[points.length] || '?';
        return t(points.length < 2
            ? 'messages.rotateReferenceSourcePoint'
            : 'messages.rotateReferenceTargetPoint', { point: pointName });
    }
    const pointName = 'ABCDEF'[points.length] || '?';
    if (operation?.type === 'scale') {
        return t(points.length < 2
            ? 'messages.scaleReferenceSourcePoint'
            : 'messages.scaleReferenceTargetPoint', { point: pointName });
    }
    return t(points.length < 3
        ? 'messages.rotateReferenceSourcePoint'
        : 'messages.rotateReferenceTargetPoint', { point: pointName });
}

function displayRotationAngle(angleDegrees, operation) {
    const conventionalDegrees = operation?.angleDirection === 'clockwise'
        ? -Number(angleDegrees)
        : Number(angleDegrees);
    return convertAngle(conventionalDegrees, 'degrees', operation?.angleUnit || 'degrees') ?? conventionalDegrees;
}

function parseQdimCommandOptions(value, defaults = {}) {
    const tokens = String(value || '').trim().toUpperCase().split(/[\s,;_-]+/).filter(Boolean);
    let qdimMode = defaults.qdimMode === 'baseline' ? 'baseline' : 'continuous';
    let baselineEnd = defaults.baselineEnd === 'last' ? 'last' : 'first';
    if (tokens.some(token => ['BASELINE', 'BASE', 'B'].includes(token))) qdimMode = 'baseline';
    if (tokens.some(token => ['CONTINUOUS', 'CONTINUE', 'CHAIN', 'C'].includes(token))) qdimMode = 'continuous';
    if (tokens.some(token => ['LAST', 'RIGHT', 'END'].includes(token))) baselineEnd = 'last';
    if (tokens.some(token => ['FIRST', 'LEFT', 'START'].includes(token))) baselineEnd = 'first';
    return { qdimMode, baselineEnd };
}

function angleUnitSymbol(unit) {
    if (unit === 'radians') return 'rad';
    if (unit === 'gradians') return 'gon';
    return '°';
}

function operationBasePrompt(type, t) {
    if (type === 'rotate') return t('messages.rotateBasePrompt');
    return t(type === 'scale' ? 'messages.operationBaseReferencePrompt' : 'messages.operationBasePrompt', {
        operation: t(`operations.${type}`),
    });
}

function operationPrecisionPointMode(operation) {
    if (!operation || operation.stage === 'select') return null;
    if (['angle', 'factor'].includes(operation.stage)) return 'coordinate';
    if (operation.stage === 'base' || operation.stage === 'destination' || operation.stage === 'reference'
        || operation.stage === 'side' || operation.stage === 'pick' || operation.stage === 'insertion'
        || operation.stage === 'corner-first' || operation.stage === 'corner-second'
        || operation.stage === 'break-first' || operation.stage === 'break-second'
        || operation.stage === 'break-at-point' || operation.stage.startsWith('stretch-')
        || operation.stage === 'lengthen-pick' || operation.stage === 'lengthen-dynamic'
        || operation.stage.startsWith('align-source-') || operation.stage.startsWith('align-destination-')
        || operation.stage === 'mirror-axis' || operation.stage.startsWith('mirror-option-')
        || operation.stage === 'array-horizontal' || operation.stage === 'array-vertical'
        || ['array-option-base', 'array-option-xSpacing', 'array-option-ySpacing'].includes(operation.stage)) {
        return 'direct';
    }
    return null;
}

function resolveBooleanModeInput(value, current) {
    const token = String(value || '').trim().toUpperCase();
    if (!token || token === 'TOGGLE') return !Boolean(current);
    if (['1', 'ON', 'YES', 'OUI'].includes(token)) return true;
    if (['0', 'OFF', 'NO', 'NON'].includes(token)) return false;
    return null;
}
