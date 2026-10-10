import { Button, Input } from '~components/ui/Controls';
import useDrawingArcText from '~hooks/useDrawingArcText';
import { parseDrawingHyperlinkInput } from '~utils/drawingHyperlinks';
import { setDrawingHyperlink } from '~utils/drawingHyperlinkOperations';
import { openDrawingHyperlink } from '~utils/openDrawingHyperlink';
import { expandDrawingAlias, validateDrawingAliases } from '~utils/drawingCommandPreferences';
import useDrawingImageExport from '~hooks/useDrawingImageExport';
import useDrawingSheetSet from '~hooks/useDrawingSheetSet';
import DrawingDownloadNotice from './DrawingDownloadNotice';
import useDrawingStandards from '~hooks/useDrawingStandards';
import useDrawingComparison from '~hooks/useDrawingComparison';
import { auditDrawingDocument, repairDrawingDocument } from '~utils/drawingAudit';
import { flattenDrawingEntities, parseDrawingFlattenInput } from '~utils/drawingFlatten';
import { purgeDrawingDefinitions, parseDrawingPurgeInput } from '~utils/drawingPurge';
import { cleanupDrawingEntities, parseDrawingCleanupInput } from '~utils/drawingCleanup';
import useDrawingConstraints from '~hooks/useDrawingConstraints';
import useDrawingSmartBlocks from '~hooks/useDrawingSmartBlocks';
import useDrawingDynamicBlocks from '~hooks/useDrawingDynamicBlocks';
import useDrawingTolerances from '~hooks/useDrawingTolerances';
import useDrawingFields from '~hooks/useDrawingFields';
import useDrawingTables from '~hooks/useDrawingTables';
import useDrawingRevision from '~hooks/useDrawingRevision';
import useDrawingSketch from '~hooks/useDrawingSketch';
import useDrawingLinework from '~hooks/useDrawingLinework';
import useDrawingPointPlacement from '~hooks/useDrawingPointPlacement';
import useDrawingAnnotations from '~hooks/useDrawingAnnotations';
import useDrawingReferences from '~hooks/useDrawingReferences';
import useDrawingDwf from '~hooks/useDrawingDwf';
import useDrawingPdf from '~hooks/useDrawingPdf';
import { drawingReferenceEditContext } from '~utils/drawingReferences';
import { alignDrawingViewportPoints, transferDrawingSpace } from '~utils/drawingSpaceTransfer';
import { exportDrawingLayout } from '~utils/drawingLayoutExport';
import { createLcadEnvelope } from '~utils/lcadDocument';
import { updateDrawingLeader } from '~utils/drawingLeaders';
import useDrawingCoordinates from '~hooks/useDrawingCoordinates';
import { resolveDrawingUcsInput } from '~utils/drawingCoordinates';
import useDrawingPlotStyles from '~hooks/useDrawingPlotStyles';
import { isDrawingLayerVisible } from '~utils/drawingLayers';
import useDrawingLayers from '~hooks/useDrawingLayers';
import useDrawingLeaders from '~hooks/useDrawingLeaders';
import useDrawingSelectionQueries from '~hooks/useDrawingSelectionQueries';
import useDrawingInquiry from '~hooks/useDrawingInquiry';
import useDrawingObjectVisibility from '~hooks/useDrawingObjectVisibility';
import { runNamedDrawingViewCommand, importNamedDrawingViews } from '~utils/drawingNamedViews';
import { canSelectEntity } from '~utils/drawingDocument';
import { matchDrawingProperties, makeDrawingLayerCurrent, copyDrawingSelectionToLayer } from '~utils/drawingPropertyCommands';
import { runDrawingGroupCommand } from '~utils/drawingGroups';
import { beginCenterLine, pickCenterLineSource } from '~utils/drawingCenterLineCommands';
import { maintainDrawingCenters } from '~utils/drawingCenterMaintenance';
import { spaceDrawingDimensions, beginDimensionSpacing, spaceDimensionsAtPoint } from '~utils/drawingDimensionSpacing';
import { disassociateDrawingDimensions, reassociateDrawingDimensions, beginDimensionReassociation, pickDimensionReassociationSource } from '~utils/drawingDimensionAssociations';
import { maintainDrawingDimensions, beginDimensionTextPlacement, placeDimensionTextAtPoint, beginDimensionBreak, advanceDimensionBreak } from '~utils/drawingDimensionMaintenance';
import { runDimensionStyleCommand } from '~utils/drawingDimensionStyleCommands';
import { exportDrawingAttributes } from '~utils/drawingAttributeExport';
import useDrawingTableFiles from '~hooks/useDrawingTableFiles';
import useDrawingWmf from '~hooks/useDrawingWmf';
import useDrawingDgn from '~hooks/useDrawingDgn';
import useDrawingCad from '~hooks/useDrawingCad';
import useOnDemandPublishPages from '~hooks/useOnDemandPublishPages';
import useDrawingDataExtraction from '~hooks/useDrawingDataExtraction';
import { manageDrawingAttributes, parseDrawingAttributeManagerInput } from '~utils/drawingAttributeManager';
import { defineDrawingAttribute, editDrawingAttribute, syncDrawingAttributes } from '~utils/drawingAttributeOperations';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import useDrawingBlockLibrary from '~hooks/useDrawingBlockLibrary';
import useDrawingBlockEditor from '~hooks/useDrawingBlockEditor';
import { createDrawingBlockWorkflow } from '~utils/drawingBlockWorkflow';
import useDrawingImageSource from '~hooks/useDrawingImageSource';
import { createDrawingHatch, parseHatchPatternInput } from '~utils/drawingHatches';
import { createDrawingBoundaries } from '~utils/drawingBoundaryDetection';
import { createDrawingRegion } from '~utils/drawingRegions';
import { parseImageAdjustmentInput } from '~utils/drawingImageAdjustments';
import { parseImageClipInput } from '~utils/drawingImageClip';
import { parseDrawingOrderInput, reorderDrawingEntities, drawingAnnotationIds } from '~utils/drawingOrder';
import { createDrawingWipeout, drawingWipeoutFromSources, isDrawingWipeout } from '~utils/drawingWipeout';
import { getEllipseAxisSegments } from '~utils/drawingEllipseGeometry';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DrawingCommandBar from '~components/drawing/DrawingCommandBar';
import DrawingEditorBody from '~components/drawing/DrawingEditorBody';
import DrawingSnapControls from '~components/drawing/DrawingSnapControls';
import DrawingStatusBar from '~components/drawing/DrawingStatusBar';
import DrawingEditorHeader from '~components/drawing/DrawingEditorHeader';
import DrawingLayoutEditor from '~components/drawing/DrawingLayoutEditor';
import DrawingPrintPage from '~components/drawing/DrawingPrintPage';
import DrawingPublishDialog from '~components/drawing/DrawingPublishDialog';
import DrawingPublishRenderer from '~components/drawing/DrawingPublishRenderer';
import DrawingModelExportRenderer from '~components/drawing/DrawingModelExportRenderer';
import DrawingWorkspaceTabs from '~components/drawing/DrawingWorkspaceTabs';
import useDrawingAlignCommand from '~hooks/useDrawingAlignCommand';
import useDrawingArrayCommand from '~hooks/useDrawingArrayCommand';
import useDrawingBreakStretchLengthenCommand from '~hooks/useDrawingBreakStretchLengthenCommand';
import useDrawingClipboard from '~hooks/useDrawingClipboard';
import useDrawingCompoundCommands from '~hooks/useDrawingCompoundCommands';
import useDrawingCornerCommand from '~hooks/useDrawingCornerCommand';
import useDrawingEditorShortcuts from '~hooks/useDrawingEditorShortcuts';
import useDrawingHistory from '~hooks/useDrawingHistory';
import useAppUpdater from '~hooks/useAppUpdater';
import useLcadAutosave from '~hooks/useLcadAutosave';
import useLcadFileCommands from '~hooks/useLcadFileCommands';
import useDrawingRecovery from '~hooks/useDrawingRecovery';
import useLocalDrawingImageImport from '~hooks/useLocalDrawingImageImport';
import useMcpFiles from '~hooks/useMcpFiles';
import { isHeadlessRuntime } from '~utils/runtimeMode';
import useLumcadMcpBridge from '~hooks/useLumcadMcpBridge';
import { useI18n } from '~i18n/I18nProvider';
import { localizeError } from '~i18n/translator';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { getDrawingCommandDefinition, getDrawingCommandInput, isNumericDrawingInput, parseDrawingCommand, parseDrawingNumbers } from '~utils/drawingCommands';
import {
    canEditEntity,
    addEntity,
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
    changeDrawingLayoutMargins,
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
import { openLcadDocument, exportLcadDocumentAs } from '~utils/lcadStorage';
import { applySplineEditInput, isEditableSpline } from '~utils/drawingSplineEditing';
import { isEditableDrawingPolyline, editDrawingPolyline, parseDrawingPolylineEdit } from '~utils/drawingPolylineEditing';
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
    sheetSetSessionRef,
    initialPath = null,
    recovered = false,
    initialRecoveryReport = null,
    initialRecoveryGraph = null,
    initialTemplateSourcePath = null,
    initialMessage = '',
    sandbox = false,
    onReplaceSession,
    onOpenSettings,
}) {
    const { formatNumber, locale, t } = useI18n();
    const { settings, updateSettings } = useAppSettings();
    const canvasRef = useRef(null);
    const layoutCanvasRef = useRef(null);
    const commandBarRef = useRef(null);
    const [commandOptionsTarget, setCommandOptionsTarget] = useState(null);
    const imageInputRef = useRef(null);
    const blockSelectionRef = useRef([]);
    const blockViewContextRef = useRef(null);
    const publishPages = useOnDemandPublishPages();
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
    const [filePath, setFilePath] = useState(initialPath);
    const [selectedIds, setSelectedIds] = useState([]);
    const [activeTool, setActiveTool] = useState('select');
    const [dimensionMode, setDimensionMode] = useState('auto');
    const [commandValue, setCommandValue] = useState('');
    const [interactiveOperation, setInteractiveOperation] = useState(null);
    const [creationPanelEntityId, setCreationPanelEntityId] = useState(null);
    const [message, setMessage] = useState(initialMessage);
    const [viewport, setViewport] = useState({ x: 10, y: 10, width: 30, height: 20 });
    const [workspaceMode, setWorkspaceMode] = useState('model');
    const [activeLayoutId, setActiveLayoutId] = useState(initialDocument.layouts?.[0]?.id || null);
    const [selectedLayoutIds, setSelectedLayoutIds] = useState(() => (
        initialDocument.layouts?.[0]?.id ? [initialDocument.layouts[0].id] : []
    ));
    const [selectedViewportId, setSelectedViewportId] = useState(null);
    const [maximizedViewportId, setMaximizedViewportId] = useState(null);
    const [layoutTool, setLayoutTool] = useState('select');
    const [sidebarPanel, setSidebarPanel] = useState(initialRecoveryReport ? 'inquiry' : 'layers');
    const [blockSearch, setBlockSearch] = useState('');
    const [draftingSettingsOpen, setDraftingSettingsOpen] = useState(false);
    const [calculatorMode, setCalculatorMode] = useState(false);
    // Normalize once: an inline argument would re-normalize the whole drawing on every render.
    const [initialHistoryState] = useState(() => ({
        ...initialDocument,
        assets: initialDocument.assets || [],
        content: normalizeDrawingContent(initialDocument.content),
        layouts: initialDocument.layouts || [],
        pageSetups: initialDocument.pageSetups || [],
    }));
    const modelHistory = useDrawingHistory(initialHistoryState);
    const name = modelHistory.documentState.name;
    const modelAssets = modelHistory.documentState.assets;
    const setName = useCallback(value => modelHistory.updateMetadata('name', value), [modelHistory.updateMetadata]);
    const setModelAssets = useCallback(value => modelHistory.updateMetadata('assets', value), [modelHistory.updateMetadata]);
    const blockEditor = useDrawingBlockEditor({ modelHistory, modelAssets, setModelAssets });
    const { assets, setAssets } = blockEditor;
    const annotations = useDrawingAnnotations({ history: blockEditor.history, enabled: workspaceMode === 'model', selectedIds, setSelectedIds, setMessage, t });
    const objectVisibility = useDrawingObjectVisibility(annotations.history, `${initialDocument.id}:${blockEditor.session?.blockId || "model"}`, workspaceMode === 'model');
    const { history } = objectVisibility;
    useEffect(() => {
        if (history.rejection?.kind === 'constraint') setMessage(t('constraints.editRejected'));
    }, [history.rejection, t]);
    const layouts = modelHistory.layouts;
    const pageSetups = modelHistory.pageSetups;
    const document = useMemo(() => ({
        ...modelHistory.documentState,
        name,
        assets: modelAssets,
        layouts,
        pageSetups,
        content: modelHistory.content,
    }), [modelAssets, modelHistory.documentState, layouts, name, pageSetups]);
    const recoverySaveRef = useRef(null);
    const handlePathChange = useCallback(nextPath => {
        setFilePath(nextPath);
        recoverySaveRef.current?.(nextPath);
    }, []);
    const recoverySourcePaths = useMemo(() => [
        ...(initialRecoveryGraph?.entries.map(entry => entry.sourcePath) || []),
        initialRecoveryReport?.path, initialTemplateSourcePath,
    ].filter(Boolean), [initialRecoveryGraph, initialRecoveryReport?.path, initialTemplateSourcePath]);
    const autosave = useLcadAutosave({
        document,
        filePath,
        onPathChange: handlePathChange,
        protectedPath: initialRecoveryReport?.path || initialTemplateSourcePath || null,
        protectedPaths: recoverySourcePaths,
        delayMs: settings.autosaveDelayMs,
        enabled: !sandbox,
    });
    const updater = useAppUpdater({ beforeInstall: autosave.flushAutosave });
    const installAvailableUpdate = useCallback(async () => {
        if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
        if (!updater.version || !window.confirm(t('updater.confirmInstall', { version: updater.version }))) return;
        if (!await updater.installAvailableUpdate()) setMessage(t('updater.installFailed'));
    }, [blockEditor.session, t, updater.installAvailableUpdate, updater.version]);
    const {
        autoPublish,
        closePublishDialog,
        createNewDrawing,
        createQuickDrawing,
        saveDrawingTemplate,
        exportPageSetups,
        exportPdf,
        openDrawing,
        openRecoveredDrawing,
        printPublishedLayouts,
        printJob,
        publishRenderedLayouts,
        publishRequest,
        saveDrawingAs,
    } = useLcadFileCommands({
        autosave,
        document,
        drawingDefaults: settings.drawingDefaults,
        protectedPaths: recoverySourcePaths,
        filePath,
        recovered,
        onReplaceSession,
        withPublishPages: publishPages.withPublishPages,
        setMessage,
        blockEditing: Boolean(blockEditor.session),
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
    const inquiry = useDrawingInquiry({ content: history.content, selectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, setSidebarPanel, enabled: workspaceMode === 'model', t, initialResult: initialRecoveryReport });
    const recovery = useDrawingRecovery({ filePath, document, commitDocument: modelHistory.commitDocument, blockEditing: Boolean(blockEditor.session), present: inquiry.present,
        openRecoveredDrawing, setMessage, t, initialReport: initialRecoveryReport, initialGraph: initialRecoveryGraph });
    recoverySaveRef.current = recovery.recordSavedCopy;
    const coordinates = useDrawingCoordinates({ history, setMessage, enabled: workspaceMode === 'model' && !blockEditor.session, t });
    const plotStyles = useDrawingPlotStyles({ history, selectedIds, setMessage, setSidebarPanel, enabled: !blockEditor.session, t });
    const layerManager = useDrawingLayers({ history: modelHistory, selectedIds, setMessage, setSidebarPanel, enabled: !blockEditor.session, t });
    const sheetSet = useDrawingSheetSet({ sessionRef: sheetSetSessionRef, document, filePath, present: inquiry.present, setMessage, t });
    const standards = useDrawingStandards({ document, enabled: workspaceMode === 'model' && !blockEditor.session, present: inquiry.present,
        commitDocument: modelHistory.commitDocument, setMessage, t });
    const comparison = useDrawingComparison({ document, enabled: workspaceMode === 'model' && !blockEditor.session, present: inquiry.present,
        commitDocument: modelHistory.commitDocument, setSelectedIds, cancel: () => { canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select'); }, setMessage, t });
    const references = useDrawingReferences({ document, history: modelHistory, setAssets: setModelAssets, selectedIds, setSelectedIds,
        enabled: workspaceMode === 'model' && !blockEditor.session, setMessage, present: inquiry.present,
        setActiveTool, cancel: () => { canvasRef.current?.cancel(); setInteractiveOperation(null); }, blockEditor,
        onBeginReference: result => activateBlockEditing(result), t });
    const pdf = useDrawingPdf({ document, history: modelHistory, selectedIds, setAssets: setModelAssets, setSelectedIds,
        enabled: workspaceMode === 'model' && !blockEditor.session, setMessage, present: inquiry.present, t });
    const dwf = useDrawingDwf({ document, history: modelHistory, selectedIds, setAssets: setModelAssets, setSelectedIds,
        enabled: workspaceMode === 'model' && !blockEditor.session, setMessage, t });
    const referenceContext = useMemo(() => blockEditor.session?.referenceSource
        ? drawingReferenceEditContext(document, blockEditor.session.referenceSource.reference, blockEditor.session.referenceSource.document) : null,
    [document, blockEditor.session?.referenceSource]);
    const leaders = useDrawingLeaders({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', blockEditing: Boolean(blockEditor.session), t });
    const selectionQueries = useDrawingSelectionQueries({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, present: inquiry.present, focusObjects: (ids, bounds) => canvasRef.current?.fitObjects(ids, bounds), setMessage, enabled: workspaceMode === 'model', blockEditing: Boolean(blockEditor.session), t });
    const pointPlacement = useDrawingPointPlacement({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', t });
    const dataExtraction = useDrawingDataExtraction({ documentId: document.id, history, selectedIds, setSelectedIds,
        enabled: workspaceMode === 'model' && !blockEditor.session, setMessage, t,
        cancel: () => { canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select'); } });
    const dgn = useDrawingDgn({ documentId: document.id, assets, setAssets, history, selectedIds, setSelectedIds, setMessage, t,
        enabled: workspaceMode === 'model' && !blockEditor.session,
        cancel: () => { canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select'); } });
    const cadOptions = { documentId: document.id, name, assets, setAssets, history, setSelectedIds, setMessage, t,
        enabled: workspaceMode === 'model' && !blockEditor.session,
        cancel: () => { canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select'); } };
    const dxf = useDrawingCad(cadOptions, 'dxf');
    const dwg = useDrawingCad(cadOptions, 'dwg');
    const wmf = useDrawingWmf({ documentId: document.id, name, locale, assets, setAssets, history, setSelectedIds, setMessage, t,
        enabled: workspaceMode === 'model' && !blockEditor.session,
        cancel: () => { canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select'); } });
    const imageExport = useDrawingImageExport({ documentId: document.id, name, content: history.content, assets,
        enabled: workspaceMode === 'model' && !blockEditor.session, setMessage, t });
    const tableFiles = useDrawingTableFiles({ documentId: document.id, filePath, history, selectedIds, setSelectedIds,
        enabled: workspaceMode === 'model' && !blockEditor.session, setOperation: setInteractiveOperation, setActiveTool, setMessage,
        cancel: () => canvasRef.current?.cancel?.(), t });
    const fields = useDrawingFields({ document, history: modelHistory, selectedIds, setSelectedIds, workspaceMode, activeLayoutId,
        getPaperSelection: () => layoutCanvasRef.current?.getPaperSelection?.(), blockEditing: Boolean(blockEditor.session),
        operation: interactiveOperation, setOperation: setInteractiveOperation, setActiveTool, setMessage, t });
    const constraints = useDrawingConstraints({ history, selectedIds, enabled: workspaceMode === 'model', dimensionalEnabled: workspaceMode === 'model' && !blockEditor.session?.referenceSource, setMessage, t });
    const smartBlocks = useDrawingSmartBlocks({ history, selectedIds, setSelectedIds, enabled: workspaceMode === 'model' && !blockEditor.session, setMessage, t });
    const dynamicBlocks = useDrawingDynamicBlocks({ history, selectedIds, blockEditor, enabled: workspaceMode === 'model', setMessage, t });
    const arcText = useDrawingArcText({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', t });
    const tolerances = useDrawingTolerances({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model' && !blockEditor.session, t });
    const tables = useDrawingTables({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', t });
    const revision = useDrawingRevision({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', t });
    const sketchTool = useDrawingSketch({ history, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', t });
    const linework = useDrawingLinework({ history, selectedIds, setSelectedIds, operation: interactiveOperation,
        setOperation: setInteractiveOperation, setActiveTool, setMessage, enabled: workspaceMode === 'model', t });
    const selectedEntities = useMemo(() => {
        const selectedIdSet = new Set(selectedIds);
        return history.content.entities.filter(entity => selectedIdSet.has(entity.id));
    }, [history.content.entities, selectedIds]);
    const creationPanelEntity = useMemo(() => (
        activeTool === 'select' && !interactiveOperation
            ? history.content.entities.find(entity => entity.id === creationPanelEntityId)
                || (selectedEntities.length === 1 ? selectedEntities[0] : null)
            : null
    ), [activeTool, interactiveOperation, creationPanelEntityId, history.content.entities, selectedEntities]);

    const openModelWorkspace = () => {
        layoutCanvasRef.current?.cancel();
        setWorkspaceMode('model');
        setSelectedViewportId(null);
        setMaximizedViewportId(null);
        setLayoutTool('select');
        setMessage('');
    };

    const openLayoutWorkspace = layoutId => {
        if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
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
        if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
        const layout = createDrawingLayoutFromTemplate({
            layers: history.content.layers,
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

    const applyPublishSettings = (layoutIds, plotSettings, marginsById) => {
        const requestedIds = new Set(layoutIds);
        history.commitLayouts(current => current.map(layout => {
            if (!requestedIds.has(layout.id)) return layout;
            const next = {
                ...layout,
                pageSetupId: null,
                plotSettings,
            };
            return changeDrawingLayoutMargins(next, marginsById[layout.id] || layout.margins);
        }));
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
        if (layoutCanvasRef.current?.getPaperSelection() && layoutCanvasRef.current.removePaperSelection()) return;
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
    const blockCommands = createDrawingBlockWorkflow({
        history, selectedIds, canvasRef, commandBarRef, setInteractiveOperation, setActiveTool, setSelectedIds, setMessage, t,
    });
    const imageSource = useDrawingImageSource({
        history, assets, documentId: initialDocument.id, viewport, setAssets, setSelectedIds, setActiveTool, setMessage,
    });
    const { handleImageFile, isUploading } = useLocalDrawingImageImport({
        history, viewport, setActiveTool, setAssets, setMessage, setSelectedIds,
    });
    const blockLibrary = useDrawingBlockLibrary({ document, history, assets, setAssets, selectedIds,
        protectedPaths: recoverySourcePaths,
        blockEditing: Boolean(blockEditor.session), filePath, setMessage, setSidebarPanel, setBlockSearch,
        setInteractiveOperation, setActiveTool, canvasRef });
    const manageDimensionStyle = input => {
        if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return false; }
        const result = runDimensionStyleCommand(history.content, selectedIds, input);
        if (result.error) { setMessage(t(`dimensionStyle.error.${result.error}`)); return false; }
        if (result.list) { setSidebarPanel('dimensionStyles'); setMessage(t('dimensionStyle.list', { names: result.list })); }
        else { history.commit(result.content); setMessage(t('dimensionStyle.updated')); }
        return true;
    };
    const manageAttribute = (blockName, tag, operation, value) => {
        if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return false; }
        const result = manageDrawingAttributes(history.content, blockName, tag, operation, value);
        if (result.error) { setMessage(t(`attribute.error.${result.error}`)); return false; }
        if (result.changed) history.commit(result.content);
        setMessage(t('attribute.updated'));
        return true;
    };
    const beginBlockEdit = input => {
        if (isUploading || imageSource.busy) { setMessage(t('block.error.imageBusy')); return; }
        const requested = String(input || '').trim().replace(/^"(.*)"$/, '$1');
        const reference = selectedEntities.length === 1 && selectedEntities[0].type === 'blockReference' ? selectedEntities[0] : null;
        if (!requested && (!reference || !canEditEntity(history.content, reference))) { setMessage(t('block.error.editSelection')); return; }
        const targetBlock = history.content.blocks.find(block => block.id === requested || block.name.toLowerCase() === requested.toLowerCase());
        const referenceBlocks = new Set(history.content.entities.filter(entity => entity.externalReference)
            .flatMap(entity => [entity.blockId, ...entity.externalReference.owned.blocks]));
        if ((!requested && reference?.externalReference) || referenceBlocks.has(targetBlock?.id)) {
            setMessage(t('reference.editRequired')); return;
        }
        if ((!requested && reference?.leader) || history.content.entities.some(entity => entity.leader && entity.blockId === targetBlock?.id)) {
            setMessage(t('leader.editCommand')); return;
        }
        const result = blockEditor.begin(requested || reference.blockId);
        if (result.error) { setMessage(t(`block.error.${result.error}`)); return; }
        activateBlockEditing(result);
    };
    const activateBlockEditing = result => {
        blockSelectionRef.current = selectedIds;
        imageSource.cancel();
        closePublishDialog();
        canvasRef.current?.cancel();
        openModelWorkspace();
        setSelectedIds([]);
        setCreationPanelEntityId(null);
        setInteractiveOperation(null);
        setActiveTool('select');
        setCommandValue('');
        setMessage(t(result.referenceSource ? 'reference.editing' : 'block.editing', { name: result.name }));
    };
    const finishBlockEdit = async (close = false, discard = false) => {
        if (isUploading || imageSource.busy) { setMessage(t('block.error.imageBusy')); return; }
        if (references.isBusy()) { setMessage(t('block.libraryBusy')); return; }
        if (blockEditor.session?.referenceSource && !discard) {
            await references.saveSource(close); return;
        }
        const result = discard ? blockEditor.discard() : blockEditor.save({ close });
        if (result.error) { setMessage(t(`block.error.${result.error}`)); return; }
        imageSource.cancel();
        canvasRef.current?.cancel();
        setInteractiveOperation(null);
        setCreationPanelEntityId(null);
        setActiveTool('select');
        setCommandValue('');
        if (close || discard) setSelectedIds(blockSelectionRef.current.filter(id => modelHistory.content.entities.some(entity => entity.id === id)));
        setMessage(t(discard ? 'block.editDiscarded' : 'block.editSaved'));
    };
    useEffect(() => {
        const context = blockEditor.session?.blockId || null;
        if (context !== blockViewContextRef.current) canvasRef.current?.fit();
        blockViewContextRef.current = context;
    }, [blockEditor.session?.blockId]);
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
        history.endCoalescing();
    }, [creationPanelEntity?.id, history.endCoalescing]);

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
            const sources = editable.filter(entity => ['line', 'xline', 'ray', 'ellipse', 'rectangle', 'circle', 'polygon', 'arc', 'polyline'].includes(entity.type));
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
        if (result.error) { setMessage(t(`constraints.${result.error}`)); return false; }
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
        if (result.error) { setMessage(t(`constraints.${result.error}`)); return false; }
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

    const applyPropertyCommand = (command, sourceId, targetIds) => {
        const result = command === 'layerCurrent' ? makeDrawingLayerCurrent(history.content, sourceId)
            : matchDrawingProperties(history.content, targetIds, sourceId, { layerOnly: command === 'layerMatch' });
        if (result.error) { setMessage(t(`propertyCommand.${result.error}`)); return false; }
        history.commit(result.content);
        finishInteractiveOperation(result.selectedIds || selectedIds, t('propertyCommand.updated'));
        return true;
    };

    const handleInteractiveOperation = ({ point, targetId, fence, arrayHandle, sketch, shift = false }) => {
        if (arcText.point({ point, targetId }) || tolerances.point({ point }) || fields.point({ point }) || tables.point({ point }) || revision.point({ point, targetId }) || sketchTool.point({ point, sketch }) || linework.point({ point, targetId }) || pointPlacement.point({ point, targetId }) || inquiry.point({ point, targetId }) || selectionQueries.point(point) || leaders.point(point)) return;
        if (interactiveOperation?.type === 'matchProperties') {
            if (interactiveOperation.sourceId) {
                applyPropertyCommand(interactiveOperation.command, interactiveOperation.sourceId, [targetId]);
            } else if (interactiveOperation.command === 'layerCurrent' || interactiveOperation.entityIds.length) {
                applyPropertyCommand(interactiveOperation.command, targetId, interactiveOperation.entityIds);
            } else {
                const source = history.content.entities.find(entity => entity.id === targetId);
                if (!source || !canSelectEntity(history.content, source)) { setMessage(t('propertyCommand.source')); return; }
                setInteractiveOperation({ ...interactiveOperation, sourceId: targetId });
                setMessage(t('propertyCommand.targetPrompt'));
            }
            return;
        }

        if (interactiveOperation?.type === 'centerLineCreation') {
            const result = pickCenterLineSource(history.content, interactiveOperation, targetId);
            if (result.error) setMessage(t(`centerMaintenance.error.${result.error}`));
            else if (result.operation) { setInteractiveOperation(result.operation); setMessage(t('centerLine.secondPrompt')); }
            else { history.commit(result.content); finishInteractiveOperation(result.selectedIds, t('dimensionMaintenance.updated')); }
            return;
        }
        if (interactiveOperation?.type === 'dimensionSpacing') {
            const result = spaceDimensionsAtPoint(history.content, interactiveOperation, point);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                history.commit(result.content);
                finishInteractiveOperation(interactiveOperation.entityIds, t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (interactiveOperation?.type === 'dimensionBreak') {
            const result = advanceDimensionBreak(history.content, interactiveOperation, point);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else if (result.operation) {
                setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.breakSecondPrompt'));
            } else {
                history.commit(result.content);
                finishInteractiveOperation(interactiveOperation.entityIds, t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (interactiveOperation?.type === 'dimensionTextPlacement') {
            const result = placeDimensionTextAtPoint(history.content, interactiveOperation, point);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                history.commit(result.content);
                finishInteractiveOperation(interactiveOperation.entityIds, t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (interactiveOperation?.type === 'dimensionReassociation') {
            const result = pickDimensionReassociationSource(history.content, interactiveOperation, targetId);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else if (result.operation) {
                setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.secondSourcePrompt'));
            } else {
                history.commit(result.content);
                finishInteractiveOperation(interactiveOperation.entityIds, t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (blockCommands.point(interactiveOperation, point)) return;
        if (interactiveOperation?.type === 'wipeout') {
            if (!point || interactiveOperation.points.length >= 128) { setMessage(t('wipeout.invalid')); return; }
            setInteractiveOperation({ ...interactiveOperation, points: [...interactiveOperation.points, { x: point.x, y: point.y }] });
            setMessage(t('wipeout.prompt'));
            return;
        }
        if (interactiveOperation?.type === 'drawOrder') {
            if (!targetId || interactiveOperation.entityIds.includes(targetId)) { setMessage(t('drawOrder.referencePrompt')); return; }
            const next = reorderDrawingEntities(history.content, interactiveOperation.entityIds, interactiveOperation.mode, targetId);
            if (next !== history.content) history.commit(next);
            finishInteractiveOperation(interactiveOperation.entityIds, t('drawOrder.applied'));
            return;
        }
        if (['boundary', 'region'].includes(interactiveOperation?.type)) {
            if (!point) return;
            const layer = getLayer(history.content, history.content.activeLayerId);
            if (!isDrawingLayerVisible(layer) || layer.locked) { setMessage(t('boundary.layerUnavailable')); return; }
            const sources = history.content.entities.filter(entity => canSelectEntity(history.content, entity));
            const region = interactiveOperation.type === 'region';
            const area = region && createDrawingRegion(sources, layer.id, createDrawingId('region'), point);
            const boundaries = region ? area && [area] : createDrawingBoundaries(sources, point, layer.id, () => createDrawingId('boundary'));
            if (!boundaries) { setMessage(t('hatch.pickFailed')); return; }
            history.commit({ ...history.content, entities: [...history.content.entities, ...boundaries] });
            finishInteractiveOperation(boundaries.map(entity => entity.id), t(region ? 'region.created' : 'boundary.created', { count: boundaries.length }));
            return;
        }
        if (interactiveOperation?.type === 'hatch') {
            if (!point) return;
            const layer = getLayer(history.content, history.content.activeLayerId);
            if (!isDrawingLayerVisible(layer) || layer.locked) { setMessage(t('hatch.layerUnavailable')); return; }
            const sources = history.content.entities.filter(entity => canSelectEntity(history.content, entity));
            const entity = createDrawingHatch(sources, layer.id, interactiveOperation.pattern, createDrawingId('hatch'), point);
            if (!entity) { setMessage(t('hatch.pickFailed')); return; }
            history.commit(addEntity(history.content, entity));
            finishInteractiveOperation([entity.id], t('hatch.created'));
            setCreationPanelEntityId(entity.id);
            return;
        }
        if (['copyBase', 'pasteClip', 'pasteBlock'].includes(interactiveOperation?.type)) {
            void handleClipboardPoint(interactiveOperation, point);
            return;
        }
        if (interactiveOperation?.stage === 'reference') {
            handleReferencePoint(interactiveOperation, point);
            return;
        }
        if (handleArrayPoint(interactiveOperation, point, arrayHandle, targetId)) return;
        if (handleMirrorPoint(interactiveOperation, point)) return;
        if (handleAlignPoint(interactiveOperation, point)) return;
        if (handleCornerPoint(interactiveOperation, point, targetId)) return;
        if (handleModificationPoint(interactiveOperation, point, targetId)) return;
        if (interactiveOperation?.type === 'offset') {
            if (interactiveOperation.stage !== 'side') return;
            const operationIds = new Set(interactiveOperation.entityIds);
            const sources = history.content.entities.filter(entity => (
                operationIds.has(entity.id) && canEditEntity(history.content, entity)
            ));
            if (!sources.length) {
                setInteractiveOperation(null);
                setActiveTool('select');
                setMessage(t('messages.offsetNoLongerEditable'));
                return;
            }
            if (interactiveOperation.destinationLayer === 'current') {
                const destination = getLayer(history.content, history.content.activeLayerId);
                if (!isDrawingLayerVisible(destination) || destination.locked) {
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
                const operationIds = new Set(interactiveOperation.entityIds);
                const originals = history.content.entities.filter(entity => operationIds.has(entity.id));
                const result = pasteDrawingEntities(history.content, originals, delta);
                if (result.error) { setMessage(t(`constraints.${result.error}`)); return; }
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
        const result = (workspaceMode === 'layout' ? resolveDrawingPointInput : (value, options) => resolveDrawingUcsInput(value, options, history.content.settings))(rawValue, {
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
        if (revision.input(rawValue) || sketchTool.input(rawValue) || linework.input(rawValue) || pointPlacement.input(rawValue) || inquiry.input(rawValue) || leaders.input(rawValue)) return true;
        if (['arcText', 'linework', 'sketch', 'revision', 'table', 'field', 'tolerance'].includes(interactiveOperation?.type)) {
            if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t('linework.centerPrompt'));
            return true;
        }
        if (interactiveOperation?.type === 'leaderCreation') {
            if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t('leader.pointPrompt'));
            return true;
        }
        if (interactiveOperation?.type === 'countArea') {
            if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t('selectionQuery.areaPrompt'));
            return true;
        }
        if (interactiveOperation?.type === 'inquiry') {
            if (!['radius', 'length', 'mass'].includes(interactiveOperation.mode) && submitPrecisionPoint(rawValue, { allowDirectDistance: false })) return true;
            setMessage(t('inquiry.pointPrompt'));
            return true;
        }
        if (!interactiveOperation) return false;
        if (interactiveOperation.type === 'centerLineCreation') {
            setMessage(t(interactiveOperation.sourceIds.length ? 'centerLine.secondPrompt' : 'centerLine.firstPrompt'));
            return true;
        }
        if (interactiveOperation.type === 'dimensionReassociation') {
            setMessage(t(interactiveOperation.sourceIds.length ? 'dimensionMaintenance.secondSourcePrompt' : 'dimensionMaintenance.sourcePrompt'));
            return true;
        }
        if (interactiveOperation.type === 'dimensionSpacing') {
            const value = String(rawValue).trim();
            if (value.toUpperCase() === 'AUTO' || value && Number.isFinite(Number(value))) {
                const result = spaceDrawingDimensions(history.content, interactiveOperation.entityIds, `${value} BASE "${interactiveOperation.baseId}"`);
                if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
                else {
                    history.commit(result.content);
                    finishInteractiveOperation(interactiveOperation.entityIds, t('dimensionMaintenance.updated'));
                }
            } else if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t('dimensionMaintenance.spacingPrompt'));
            return true;
        }
        if (interactiveOperation.type === 'dimensionBreak') {
            if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t(interactiveOperation.basePoint ? 'dimensionMaintenance.breakSecondPrompt' : 'dimensionMaintenance.breakFirstPrompt'));
            return true;
        }
        if (interactiveOperation.type === 'dimensionTextPlacement') {
            if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t('dimensionMaintenance.textPositionPrompt'));
            return true;
        }
        if (['blockDefine', 'blockInsert', 'blockBase'].includes(interactiveOperation.type)) {
            if (interactiveOperation.stage !== 'name' && submitPrecisionPoint(rawValue, { allowDirectDistance: false })) return true;
            return blockCommands.input(interactiveOperation, rawValue);
        }
        if (interactiveOperation.type === 'wipeout') {
            if (submitPrecisionPoint(rawValue, { allowDirectDistance: false })) return true;
            const token = String(rawValue).trim().toUpperCase();
            if (!token || token === 'DONE') {
                const layer = getLayer(history.content, history.content.activeLayerId);
                const entity = isDrawingLayerVisible(layer) && !layer.locked && createDrawingWipeout(interactiveOperation.points, layer.id, createDrawingId('wipeout'));
                if (!entity) { setMessage(t('wipeout.invalid')); return true; }
                history.commit(addEntity(history.content, entity));
                finishInteractiveOperation([entity.id], t('wipeout.created'));
            } else if (token === 'UNDO') setInteractiveOperation({ ...interactiveOperation, points: interactiveOperation.points.slice(0, -1) });
            else setMessage(t('wipeout.prompt'));
            return true;
        }
        if (interactiveOperation.type === 'drawOrder') {
            setMessage(t('drawOrder.referencePrompt'));
            return true;
        }
        if (['boundary', 'region'].includes(interactiveOperation.type)) {
            if (!submitPrecisionPoint(rawValue, { allowDirectDistance: false })) setMessage(t('boundary.pickPrompt'));
            return true;
        }
        if (interactiveOperation.type === 'hatch') {
            if (submitPrecisionPoint(rawValue, { allowDirectDistance: false })) return true;
            const pattern = parseHatchPatternInput(rawValue, interactiveOperation.pattern);
            if (pattern) setInteractiveOperation({ ...interactiveOperation, pattern });
            setMessage(t(pattern ? 'hatch.pickPrompt' : 'hatch.invalidOptions'));
            return true;
        }
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
        const source = selectedEntities.find(entity => ['line', 'rectangle', 'polygon', 'ellipse'].includes(entity.type));
        if (source?.type === 'ellipse') {
            const segment = getEllipseAxisSegments(source)[0];
            return segment && Math.abs(segment[1].y - segment[0].y) > Math.abs(segment[1].x - segment[0].x) ? 'vertical' : 'horizontal';
        }
        if (source?.type !== 'line') return 'horizontal';
        return Math.abs(source.y2 - source.y1) > Math.abs(source.x2 - source.x1) ? 'vertical' : 'horizontal';
    };

    const submitCommand = async rawValue => {
        rawValue = expandDrawingAlias(rawValue, settings.commandAliases);
        if (isHeadlessRuntime()) {
            const command = parseDrawingCommand(rawValue)?.command;
            // IMAGEATTACH reads an explicit path without a dialog; only its picker form is refused.
            const pickerOnly = command === 'imageAttach' && !getDrawingCommandInput(rawValue).trim();
            if (pickerOnly || ['new', 'quickNew', 'open', 'saveAs', 'plot', 'pdf', 'pdfAll', 'pdfSelected', 'publish', 'dwfx', 'aliasEdit'].includes(command)) {
                throw new Error(t('headless.dialogUnavailable'));
            }
        }
        const immediateCommand = parseDrawingCommand(rawValue);
        if (immediateCommand?.command === 'hyperlink') {
            try {
                if (workspaceMode !== 'model') throw new Error('selection');
                const parsed = parseDrawingHyperlinkInput(getDrawingCommandInput(rawValue));
                if (parsed.action === 'edit') {
                    if (selectedIds.length !== 1) throw new Error('selection');
                    setSidebarPanel('selection');
                    setMessage(t('hyperlink.editHint'));
                } else if (parsed.action === 'open') {
                    const selectedIdSet = new Set(selectedIds);
                    const selected = history.content.entities.filter(entity => selectedIdSet.has(entity.id));
                    if (selected.length !== 1 || !selected[0].hyperlink) throw new Error('selection');
                    await openDrawingHyperlink(selected[0].hyperlink);
                    setMessage(t('hyperlink.opened'));
                } else {
                    const next = setDrawingHyperlink(history.content, selectedIds, parsed.action === 'remove' ? null : parsed.link);
                    if (next !== history.content) history.commit(next);
                    setMessage(t('hyperlink.saved'));
                }
            } catch { setMessage(t('hyperlink.failed')); }
            setCommandValue('');
            return;
        }

        if (immediateCommand?.command === 'aliasEdit') {
            const input = getDrawingCommandInput(rawValue).trim();
            if (!input) { onOpenSettings(); setCommandValue(''); return; }
            const tokens = input.split(/\s+/);
            const operation = tokens.shift().toUpperCase();
            const alias = (tokens.shift() || '').toUpperCase();
            try {
                if (operation === 'SET' && tokens.length === 1) {
                    const rows = validateDrawingAliases([{ alias, command: tokens[0] }]);
                    await updateSettings(current => ({ ...current, commandAliases: validateDrawingAliases([
                        ...current.commandAliases.filter(row => row.alias !== alias), ...rows,
                    ]) }));
                } else if (operation === 'REMOVE' && alias && !tokens.length) {
                    await updateSettings(current => {
                        if (!current.commandAliases.some(row => row.alias === alias)) throw new Error('invalid');
                        return { ...current, commandAliases: current.commandAliases.filter(row => row.alias !== alias) };
                    });
                } else throw new Error('invalid');
                setMessage(t('commandPreferences.saved'));
            } catch { setMessage(t('commandPreferences.commandError')); }
            setCommandValue('');
            return;
        }

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
        if (workspaceMode === 'model' && isNumericDrawingInput(rawValue) && canvasRef.current?.applyNumericInput(rawValue)) {
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
        if (blockEditor.session && ['paperSpace', 'layout', 'pageSetup', 'pageSetupImport', 'pageSetupExport',
            'viewport', 'viewportClip', 'viewportLayer', 'viewportMax', 'viewportMin', 'alignSpace', 'exportLayout', 'changeSpace'].includes(parsed.command)) {
            setMessage(t('block.error.closeFirst')); return;
        }
        setInteractiveOperation(null);
        canvasRef.current?.cancel();
        if (workspaceMode === 'layout' && ['line', 'rectangle', 'text', 'multilineText'].includes(parsed.command)) {
            const tokens = tokenizeDrawingAttributeInput(getDrawingCommandInput(rawValue));
            if (!tokens || !['text', 'multilineText'].includes(parsed.command) && tokens.length) { setMessage(t('paperWorkflow.invalid')); return; }
            setLayoutTool('select'); layoutCanvasRef.current?.cancel();
            layoutCanvasRef.current?.beginPaperCreation(['text', 'multilineText'].includes(parsed.command) ? 'text' : parsed.command,
                ['text', 'multilineText'].includes(parsed.command) ? { text: tokens.join(' ').replaceAll('\\n', '\n'), textMode: parsed.command === 'text' ? 'singleLine' : 'multiline', fontSize: 3 } : {});
            return;
        }
        if (workspaceMode === 'layout' && parsed.command === 'move' && layoutCanvasRef.current?.getPaperSelection()) {
            if (!layoutCanvasRef.current.movePaperSelection()) setMessage(t('paperWorkflow.invalid')); return;
        }
        if (workspaceMode === 'layout' && parsed.command === 'textEdit' && layoutCanvasRef.current?.getPaperSelection()) {
            if (!layoutCanvasRef.current.editPaperSelection()) setMessage(t('paperWorkflow.invalid')); return;
        }
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
        if (parsed.command === 'changeSpace') {
            const tokens = tokenizeDrawingAttributeInput(getDrawingCommandInput(rawValue));
            if (!tokens || tokens.length > 2) { setMessage(t('spaceTransfer.syntax')); return; }
            const layout = tokens[1] ? layouts.find(item => item.id === tokens[1] || item.name.toLowerCase() === tokens[1].toLowerCase()) : activeLayout;
            const viewport = tokens[0] ? layout?.viewports.find(item => item.id === tokens[0] || item.name.toLowerCase() === tokens[0].toLowerCase())
                : layout?.viewports.find(item => item.id === selectedViewportId) || (layout?.viewports.length === 1 ? layout.viewports[0] : null);
            const toPaper = workspaceMode === 'model';
            const paperId = layoutCanvasRef.current?.getPaperSelection();
            if (!toPaper && layout?.id !== activeLayout?.id) { setMessage(t('spaceTransfer.syntax')); return; }
            const result = transferDrawingSpace(document, layout?.id, viewport?.id, toPaper ? selectedIds : paperId ? [paperId] : [], toPaper);
            if (result.error) { setMessage(t(result.error === 'viewport' ? 'spaceTransfer.viewport' : `block.error.${result.error}`)); return; }
            modelHistory.commitDocument(current => ({ ...current, content: result.content, layouts: result.layouts }), { applyCreationStyles: false });
            if (toPaper) openLayoutWorkspace(layout.id);
            else { openModelWorkspace(); setSelectedIds(result.selectedIds); }
            setMessage(t(toPaper ? 'spaceTransfer.toPaper' : 'spaceTransfer.toModel')); return;
        }
        if (parsed.command === 'alignSpace') {
            const viewport = activeLayout?.viewports.find(item => item.id === selectedViewportId);
            if (!viewport || viewport.locked || workspaceMode !== 'layout') { setMessage(t('spaceTransfer.alignmentSelection')); return; }
            const input = getDrawingCommandInput(rawValue).trim();
            if (!input) { layoutCanvasRef.current?.beginSpaceAlignment(viewport.id); return; }
            const values = input.split(/[\s,]+/).map(Number);
            if (values.length !== 8 || !values.every(Number.isFinite)) { setMessage(t('spaceTransfer.alignmentSyntax')); return; }
            const points = Array.from({ length: 4 }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
            const aligned = alignDrawingViewportPoints(viewport, points.slice(0, 2), points.slice(2));
            if (!aligned) { setMessage(t('spaceTransfer.alignmentInvalid')); return; }
            commitActiveLayout({ ...activeLayout, viewports: activeLayout.viewports.map(item => item.id === viewport.id ? aligned : item) });
            setMessage(t('spaceTransfer.aligned')); return;
        }
        if (parsed.command === 'exportLayout') {
            const requested = getDrawingCommandInput(rawValue).trim().replace(/^"(.*)"$/, '$1');
            const layout = requested ? layouts.find(item => item.id === requested || item.name.toLowerCase() === requested.toLowerCase()) : activeLayout;
            try {
                const exported = exportDrawingLayout(document, layout);
                const result = await exportLcadDocumentAs(createLcadEnvelope(exported), exported.name,
                    { filterName: t('fileDialog.lcadDrawing'), protectedPath: filePath });
                if (result) setMessage(t('layoutExport.saved'));
            } catch (error) { setMessage(localizeError(error, t, 'layoutExport.failed')); }
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
                selectedIdsOfTypes(['line', 'rectangle', 'polygon', 'ellipse', 'linearDimension']),
                { measurementMode },
            ), { mode: measurementMode });
            return;
        }
        if (parsed.command === 'alignedDimension') {
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIdsOfTypes(['line', 'rectangle', 'polygon', 'ellipse', 'linearDimension']),
                { measurementMode: 'aligned' },
            ), { mode: 'aligned' });
            return;
        }
        if (parsed.command === 'rotatedDimension') {
            const dimensionAngle = (parsed.args[0] || 0) * Math.PI / 180;
            commitDimensionCommand(createQuickDimensionResult(
                history.content,
                selectedIdsOfTypes(['line', 'rectangle', 'polygon', 'ellipse', 'linearDimension']),
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
        if (['select', 'point', 'line', 'xline', 'ray', 'ellipse', 'spline', 'rectangle', 'circle', 'polygon', 'arc', 'pan'].includes(parsed.command)) {
            openModelWorkspace();
            if (['rectangle', 'circle', 'polygon', 'arc', 'ellipse', 'spline'].includes(parsed.command)) {
                canvasRef.current?.submitCreationInputForTool(parsed.command, rawValue);
            }
            setActiveTool(parsed.command);
            setMessage(t('messages.toolActive', { tool: t(`commands.${parsed.command}`) }));
            return;
        }
        if (parsed.command === 'region' && selectedEntities.length && getDrawingCommandInput(rawValue).trim().toUpperCase() !== 'PICK') {
            const layer = getLayer(history.content, history.content.activeLayerId);
            if (!isDrawingLayerVisible(layer) || layer.locked) { setMessage(t('boundary.layerUnavailable')); return; }
            const region = createDrawingRegion(selectedEntities, layer.id, createDrawingId('region'));
            if (!region) { setMessage(t('region.closedRequired')); return; }
            history.commit(addEntity(history.content, region));
            finishInteractiveOperation([region.id], t('region.created'));
            return;
        }
        if (['boundary', 'region'].includes(parsed.command)) {
            openModelWorkspace();
            setSelectedIds([]);
            setActiveTool('select');
            setInteractiveOperation({ type: parsed.command, stage: 'pick' });
            setMessage(t('boundary.pickPrompt'));
            return;
        }
        if (['hatch', 'gradient', 'solid'].includes(parsed.command)) {
            let input = getDrawingCommandInput(rawValue).trim();
            const pick = /^PICK(?:\s|$)/i.test(input) || !selectedEntities.length;
            input = input.replace(/^PICK(?:\s+|$)/i, '');
            const pattern = parseHatchPatternInput(input || (parsed.command === 'gradient' ? 'gradient' : parsed.command === 'solid' ? 'solid' : 'lines'));
            if (!pattern) { setMessage(t('hatch.invalidOptions')); return; }
            if (pick) {
                openModelWorkspace();
                setSelectedIds([]);
                setActiveTool('select');
                setInteractiveOperation({ type: 'hatch', stage: 'pick', pattern });
                setMessage(t('hatch.pickPrompt'));
                return;
            }
            const sources = selectedEntities.filter(entity => canEditEntity(history.content, entity));
            const entity = pattern && sources.length === selectedEntities.length
                ? createDrawingHatch(sources, history.content.activeLayerId, pattern, createDrawingId('hatch')) : null;
            if (!entity) { setMessage(t('hatch.boundariesRequired')); return; }
            history.commit(addEntity(history.content, entity));
            setSelectedIds([entity.id]);
            setActiveTool('select');
            setCreationPanelEntityId(entity.id);
            setMessage(t('hatch.created'));
            return;
        }
        if (parsed.command === 'wipeout') {
            const input = getDrawingCommandInput(rawValue).trim().toUpperCase();
            if (['FRAME ON', 'FRAME OFF'].includes(input)) {
                const masks = selectedEntities.filter(entity => isDrawingWipeout(entity) && canEditEntity(history.content, entity));
                if (!masks.length) { setMessage(t('wipeout.selectMask')); return; }
                history.commit(updateSelectedEntities(history.content, masks.map(entity => entity.id), entity => ({ ...entity, wipeout: { frame: input === 'FRAME ON' } })));
                setMessage(t('drawOrder.applied'));
                return;
            }
            if (input && input !== 'POINTS') { setMessage(t('wipeout.prompt')); return; }
            const layer = getLayer(history.content, history.content.activeLayerId);
            if (!isDrawingLayerVisible(layer) || layer.locked) { setMessage(t('boundary.layerUnavailable')); return; }
            if (selectedEntities.length && input !== 'POINTS') {
                const entity = drawingWipeoutFromSources(selectedEntities, layer.id, createDrawingId('wipeout'));
                if (!entity) { setMessage(t('wipeout.invalid')); return; }
                history.commit(addEntity(history.content, entity));
                finishInteractiveOperation([entity.id], t('wipeout.created'));
                return;
            }
            openModelWorkspace();
            setSelectedIds([]);
            setActiveTool('select');
            setInteractiveOperation({ type: 'wipeout', stage: 'pick', points: [] });
            setMessage(t('wipeout.prompt'));
            return;
        }
        if (parsed.command === 'recover') { await recovery.run(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'recoverAll') { await recovery.run(getDrawingCommandInput(rawValue), { all: true }); return; }
        if (parsed.command === 'recoveryManager') { await recovery.run(getDrawingCommandInput(rawValue), { manager: true }); return; }
        if (parsed.command === 'audit') {
            if (blockEditor.session) { setMessage(t('audit.closeEditor')); return; }
            const input = getDrawingCommandInput(rawValue).trim().toUpperCase();
            if (input && !['CHECK', 'REPAIR'].includes(input)) { setMessage(t('audit.syntax')); return; }
            const result = input === 'REPAIR' ? repairDrawingDocument(document, { recoveredLayerName: t('audit.recoveredLayer') }) : auditDrawingDocument(document);
            if (result.error) { setMessage(t(`audit.${result.error}`)); return; }
            if (input === 'REPAIR' && result.changed) modelHistory.commitDocument(current => ({ ...current, content: result.document.content, layouts: result.document.layouts }), { applyCreationStyles: false });
            const { document: repairedDocument, before, ...report } = result;
            inquiry.present({ mode: 'audit', ...report, ...(before ? { beforeIssues: before.issues } : {}) });
            setMessage(t(result.valid ? 'audit.clean' : 'audit.found', { count: result.issues.length }));
            return;
        }
        if (parsed.command === 'flatten') {
            if (workspaceMode !== 'model') { setMessage(t('namedView.modelRequired')); return; }
            const options = parseDrawingFlattenInput(getDrawingCommandInput(rawValue));
            if (!options) { setMessage(t('flatten.syntax')); return; }
            const ids = options.all ? history.content.entities.map(entity => entity.id) : selectedIds;
            if (!ids.length) { setMessage(t('cleanup.selection')); return; }
            const result = flattenDrawingEntities(history.content, ids);
            if (result.error) { setMessage(t(`flatten.${result.error}`)); return; }
            if (!options.preview && result.changed) history.commit(result.content);
            setMessage(t(options.preview ? 'flatten.preview' : 'flatten.completed', result.report));
            return;
        }
        if (parsed.command === 'purge') {
            if (blockEditor.session) { setMessage(t('purge.closeEditor')); return; }
            const options = parseDrawingPurgeInput(getDrawingCommandInput(rawValue));
            if (!options) { setMessage(t('purge.syntax')); return; }
            const result = purgeDrawingDefinitions(document, options);
            if (result.error) { setMessage(t(`purge.${result.error}`)); return; }
            if (!options.preview && result.changed) modelHistory.commit(result.content);
            setMessage(t(options.preview ? 'purge.preview' : 'purge.completed', result.report));
            return;
        }
        if (parsed.command === 'overkill') {
            if (workspaceMode !== 'model') { setMessage(t('namedView.modelRequired')); return; }
            const options = parseDrawingCleanupInput(getDrawingCommandInput(rawValue));
            if (!options) { setMessage(t('cleanup.syntax')); return; }
            const ids = options.all ? history.content.entities.map(entity => entity.id) : selectedIds;
            if (!ids.length) { setMessage(t('cleanup.selection')); return; }
            const result = cleanupDrawingEntities(history.content, ids, options);
            if (result.error) { setMessage(t(`cleanup.${result.error}`)); return; }
            if (!options.preview && result.changed) {
                history.commit(result.content);
                setSelectedIds(result.selectedIds);
            }
            setMessage(t(options.preview ? 'cleanup.preview' : 'cleanup.completed', result.report));
            return;
        }
        if (['tableEdit', 'multilineEdit'].includes(parsed.command) && !getDrawingCommandInput(rawValue).trim()) {
            if (workspaceMode !== 'model') { setMessage(t('namedView.modelRequired')); return; }
            const entity = selectedEntities[0];
            const kind = parsed.command === 'tableEdit' ? 'table' : 'linework';
            if (selectedEntities.length !== 1 || !entity?.[kind] || !canEditEntity(history.content, entity)) {
                setMessage(t(`${kind}.selection`)); return;
            }
            canvasRef.current?.cancel();
            setInteractiveOperation(null);
            setActiveTool('select');
            setCreationPanelEntityId(entity.id);
            setMessage(t('messages.creationPanelOpened', { type: t(`commands.${parsed.command}`) }));
            return;
        }
        if (['dwfAttach', 'dwfClip'].includes(parsed.command)) { await dwf.run(parsed.command, getDrawingCommandInput(rawValue)); return; }
        if (pdf.handles(parsed.command)) { await pdf.run(parsed.command, getDrawingCommandInput(rawValue)); return; }
        if (references.handles(parsed.command)) { await references.run(parsed.command, getDrawingCommandInput(rawValue)); return; }
        if (['sheetSet', 'newSheetSet', 'openSheetSet'].includes(parsed.command)) { await sheetSet.run(parsed.command, getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'sheetSetArchive') { await sheetSet.run('sheetSet', `ARCHIVE ${getDrawingCommandInput(rawValue)}`); return; }
        if (['drawingStandards', 'drawingCheckStandards'].includes(parsed.command)) { await standards.run(getDrawingCommandInput(rawValue), parsed.command === 'drawingCheckStandards'); return; }
        if (parsed.command === 'drawingCompareImport') { comparison.importChanges(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'drawingCompare') { await comparison.run(getDrawingCommandInput(rawValue)); return; }
        if (dataExtraction.handles(parsed.command)) { await dataExtraction.run(parsed.command, getDrawingCommandInput(rawValue)); return; }
        const imageFormat = { pngOut: 'png', jpegOut: 'jpg', svgOut: 'svg' }[parsed.command];
        const exportFormat = parsed.command === 'pdf' && /^(PNG|JPG|JPEG|SVG)(?:\s|$)/i.exec(getDrawingCommandInput(rawValue));
        if (imageFormat || exportFormat) {
            const format = imageFormat || exportFormat[1].toLowerCase().replace('jpeg', 'jpg');
            const input = getDrawingCommandInput(rawValue);
            await imageExport.run(format, imageFormat ? input : input.slice(exportFormat[1].length).trim()); return;
        }
        if (parsed.command === 'dxfImport') { await dxf.run(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'dxfExport') { await dxf.exportFile(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'dwgImport') { await dwg.run(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'dwgExport') { await dwg.exportFile(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'wmfExport') { await wmf.exportFile(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'dgnImport') { await dgn.run(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'dgnAttach') { await dgn.attach(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'dgnClip') { dgn.clip(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'wmfImport') { await wmf.run(getDrawingCommandInput(rawValue)); return; }
        if (tableFiles.handles(parsed.command, getDrawingCommandInput(rawValue))) { await tableFiles.run(parsed.command, getDrawingCommandInput(rawValue)); return; }
        if (arcText.run(parsed.command, getDrawingCommandInput(rawValue)) || constraints.run(parsed.command, getDrawingCommandInput(rawValue)) || smartBlocks.run(parsed.command, getDrawingCommandInput(rawValue)) || dynamicBlocks.run(parsed.command, getDrawingCommandInput(rawValue)) || tolerances.run(parsed.command, getDrawingCommandInput(rawValue)) || fields.run(parsed.command, getDrawingCommandInput(rawValue)) || tables.run(parsed.command, getDrawingCommandInput(rawValue)) || revision.run(parsed.command, getDrawingCommandInput(rawValue)) || sketchTool.run(parsed.command, getDrawingCommandInput(rawValue)) || linework.run(parsed.command, getDrawingCommandInput(rawValue)) || pointPlacement.run(parsed.command, getDrawingCommandInput(rawValue)) || annotations.run(parsed.command, getDrawingCommandInput(rawValue)) || coordinates.run(parsed.command, getDrawingCommandInput(rawValue)) || plotStyles.run(parsed.command, getDrawingCommandInput(rawValue)) || layerManager.run(parsed.command, getDrawingCommandInput(rawValue)) || inquiry.run(parsed.command, getDrawingCommandInput(rawValue)) || selectionQueries.run(parsed.command, getDrawingCommandInput(rawValue)) || leaders.run(parsed.command, getDrawingCommandInput(rawValue))) return;
        if (['hideObjects', 'isolateObjects', 'unisolateObjects'].includes(parsed.command)) {
            if (workspaceMode !== 'model') { setMessage(t('namedView.modelRequired')); return; }
            if (parsed.command !== 'unisolateObjects' && !selectedIds.length) { setMessage(t('propertyCommand.selection')); return; }
            objectVisibility.update(parsed.command === 'hideObjects' ? 'hide' : parsed.command === 'isolateObjects' ? 'isolate' : 'show', selectedIds);
            if (parsed.command === 'hideObjects') setSelectedIds([]);
            setMessage(t('objectVisibility.updated'));
            return;
        }
        if (['namedView', 'viewGo'].includes(parsed.command)) {
            if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
            if (workspaceMode !== 'model') { setMessage(t('namedView.modelRequired')); return; }
            const input = getDrawingCommandInput(rawValue);
            if (parsed.command === 'namedView' && input.toUpperCase() === 'IMPORT') {
                try {
                    const loaded = await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
                    if (!loaded) return;
                    const result = importNamedDrawingViews(history.content, loaded.envelope.document.content.namedViews);
                    if (result.error) setMessage(t(`namedView.${result.error}`));
                    else { if (result.count) history.commit(result.content); setMessage(t('namedView.imported', { count: result.count })); }
                } catch (error) { setMessage(localizeError(error, t, 'namedView.importFailed')); }
                return;
            }
            const result = runNamedDrawingViewCommand(history.content, viewport, input, parsed.command === 'viewGo');
            if (result.error) { setMessage(t(`namedView.${result.error}`)); return; }
            if (result.content) history.commit(result.content);
            if (result.view) canvasRef.current?.restoreNamedView(result.view);
            setMessage(result.names !== undefined ? t('namedView.list', { names: result.names }) : t('namedView.updated'));
            return;
        }
        if (['matchProperties', 'layerMatch', 'layerCurrent', 'copyToLayer'].includes(parsed.command)) {
            const tokens = tokenizeDrawingAttributeInput(getDrawingCommandInput(rawValue));
            if (!tokens || tokens.length > 1) { setMessage(t('propertyCommand.syntax')); return; }
            if (parsed.command === 'copyToLayer') {
                if (!tokens.length) { setMessage(t('propertyCommand.syntax')); return; }
                const result = copyDrawingSelectionToLayer(history.content, selectedIds, tokens[0]);
                if (result.error) setMessage(t(`propertyCommand.${result.error}`));
                else { history.commit(result.content); finishInteractiveOperation(result.selectedIds, t('propertyCommand.updated')); }
                return;
            }
            const sourceId = tokens[0] || (parsed.command === 'layerCurrent' && selectedIds.length === 1 ? selectedIds[0] : null);
            if (sourceId && !history.content.entities.some(entity => entity.id === sourceId && canSelectEntity(history.content, entity))) {
                setMessage(t('propertyCommand.source')); return;
            }
            if (sourceId && (parsed.command === 'layerCurrent' || selectedIds.length)) {
                applyPropertyCommand(parsed.command, sourceId, selectedIds);
                return;
            }
            openModelWorkspace();
            setActiveTool('select');
            setInteractiveOperation({ type: 'matchProperties', stage: 'pick', command: parsed.command, sourceId, entityIds: selectedIds });
            setMessage(t(sourceId ? 'propertyCommand.targetPrompt' : 'propertyCommand.sourcePrompt'));
            return;
        }
        if (['group', 'groupEdit', 'ungroup'].includes(parsed.command)) {
            if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
            const result = runDrawingGroupCommand(history.content, selectedIds, parsed.command, getDrawingCommandInput(rawValue));
            if (result.error) { setMessage(t(`groups.${result.error}`)); return; }
            if (result.content) history.commit(result.content);
            if (result.selectedIds) setSelectedIds(result.selectedIds);
            setMessage(result.names !== undefined ? t('groups.list', { names: result.names }) : t('groups.updated'));
            return;
        }
        if (parsed.command === 'drawOrder') {
            const mode = parseDrawingOrderInput(getDrawingCommandInput(rawValue));
            if (!mode) { setMessage(t('drawOrder.options')); return; }
            const ids = selectedEntities.filter(entity => canEditEntity(history.content, entity)).map(entity => entity.id);
            if (!ids.length) { setMessage(t('drawOrder.selectionRequired')); return; }
            if (['above', 'below'].includes(mode)) {
                setActiveTool('select');
                setInteractiveOperation({ type: 'drawOrder', stage: 'pick', mode, entityIds: ids });
                setMessage(t('drawOrder.referencePrompt'));
                return;
            }
            const next = reorderDrawingEntities(history.content, ids, mode);
            if (next !== history.content) history.commit(next);
            setMessage(t('drawOrder.applied'));
            return;
        }
        if (parsed.command === 'textToFront') {
            const mode = getDrawingCommandInput(rawValue).trim().toLowerCase() || 'all';
            if (!['text', 'dimensions', 'all'].includes(mode)) { setMessage(t('drawOrder.annotationOptions')); return; }
            const next = reorderDrawingEntities(history.content, drawingAnnotationIds(history.content, mode), 'front');
            if (next !== history.content) history.commit(next);
            setMessage(t('drawOrder.applied'));
            return;
        }
        if (parsed.command === 'hatchToBack') {
            const ids = new Set(selectedEntities.filter(entity => entity.type === 'hatch').map(entity => entity.id));
            const candidates = history.content.entities.filter(entity => entity.type === 'hatch' && (!ids.size || ids.has(entity.id)) && canEditEntity(history.content, entity));
            const next = reorderDrawingEntities(history.content, candidates.map(entity => entity.id), 'back');
            if (next !== history.content) history.commit(next);
            setMessage(t('hatch.sentToBack'));
            return;
        }
        if (parsed.command === 'centerLine') {
            const result = beginCenterLine(history.content, selectedIds, getDrawingCommandInput(rawValue));
            if (result.error) setMessage(t(`centerMaintenance.error.${result.error}`));
            else {
                openModelWorkspace(); canvasRef.current?.cancel?.(); setActiveTool('select');
                if (result.operation) { setInteractiveOperation(result.operation); setMessage(t(result.operation.sourceIds.length ? 'centerLine.secondPrompt' : 'centerLine.firstPrompt')); }
                else { setInteractiveOperation(null); history.commit(result.content); setSelectedIds(result.selectedIds); setMessage(t('dimensionMaintenance.updated')); }
            }
            return;
        }
        if (['centerReassociate', 'centerDisassociate', 'centerReset'].includes(parsed.command)) {
            const result = maintainDrawingCenters(history.content, selectedIds, parsed.command, getDrawingCommandInput(rawValue));
            if (result.error) setMessage(t(`centerMaintenance.error.${result.error}`));
            else {
                openModelWorkspace(); canvasRef.current?.cancel?.(); setActiveTool('select');
                if (result.operation) {
                    setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.sourcePrompt'));
                } else {
                    setInteractiveOperation(null); history.commit(result.content); setMessage(t('dimensionMaintenance.updated'));
                }
            }
            return;
        }
        if (parsed.command === 'dimensionReassociate' && !getDrawingCommandInput(rawValue).trim()) {
            const result = beginDimensionReassociation(history.content, selectedIds);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                openModelWorkspace(); canvasRef.current?.cancel?.(); setActiveTool('select');
                setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.sourcePrompt'));
            }
            return;
        }
        if (['dimensionDisassociate', 'dimensionReassociate'].includes(parsed.command)) {
            const tokens = tokenizeDrawingAttributeInput(getDrawingCommandInput(rawValue));
            const result = !tokens || parsed.command === 'dimensionDisassociate' && tokens.length ? { error: 'syntax' }
                : parsed.command === 'dimensionDisassociate' ? disassociateDrawingDimensions(history.content, selectedIds)
                    : reassociateDrawingDimensions(history.content, selectedIds, tokens);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select');
                history.commit(result.content); setMessage(t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (parsed.command === 'dimensionSpace' && /^POINT(?:\s|$)/i.test(getDrawingCommandInput(rawValue).trim())) {
            const result = beginDimensionSpacing(history.content, selectedIds, getDrawingCommandInput(rawValue));
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                openModelWorkspace(); canvasRef.current?.cancel?.(); setActiveTool('select');
                setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.spacingPrompt'));
                commandBarRef.current?.focus?.('');
            }
            return;
        }
        if (parsed.command === 'dimensionSpace') {
            const result = spaceDrawingDimensions(history.content, selectedIds, getDrawingCommandInput(rawValue));
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select');
                history.commit(result.content); setMessage(t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (parsed.command === 'dimensionBreak' && ['', 'MANUAL'].includes(getDrawingCommandInput(rawValue).trim().toUpperCase())) {
            const result = beginDimensionBreak(history.content, selectedIds);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                openModelWorkspace(); canvasRef.current?.cancel?.(); setActiveTool('select');
                setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.breakFirstPrompt'));
                commandBarRef.current?.focus?.('');
            }
            return;
        }
        if (parsed.command === 'dimensionTextEdit' && ['', 'POINT'].includes(getDrawingCommandInput(rawValue).trim().toUpperCase())) {
            const result = beginDimensionTextPlacement(history.content, selectedIds);
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                openModelWorkspace(); canvasRef.current?.cancel?.(); setActiveTool('select');
                setInteractiveOperation(result.operation); setMessage(t('dimensionMaintenance.textPositionPrompt'));
                commandBarRef.current?.focus?.('');
            }
            return;
        }
        if (['dimensionUpdate', 'dimensionRegenerate', 'dimensionInspect', 'dimensionEdit', 'dimensionTextEdit', 'dimensionBreak'].includes(parsed.command)) {
            const operation = { dimensionUpdate: 'update', dimensionRegenerate: 'regenerate', dimensionInspect: 'inspect', dimensionEdit: 'editText', dimensionTextEdit: 'placeText', dimensionBreak: 'break' }[parsed.command];
            const result = maintainDrawingDimensions(history.content, selectedIds, operation, getDrawingCommandInput(rawValue));
            if (result.error) setMessage(t(`dimensionMaintenance.error.${result.error}`));
            else {
                canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select');
                history.commit(result.content); setMessage(t('dimensionMaintenance.updated'));
            }
            return;
        }
        if (parsed.command === 'dimensionStyle') { manageDimensionStyle(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'attributeExtract') {
            if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
            try {
                if (await exportDrawingAttributes(history.content, selectedIds, getDrawingCommandInput(rawValue), t('commands.attributeExtract'))) setMessage(t('attribute.exported'));
            } catch (error) {
                const key = ['attributeExtractionFormat', 'attributeExtractionEmpty', 'attributeExtractionDesktop', 'attributeExtractionDependency', 'attributeExtractionLimit'].includes(error.message) ? error.message : 'attributeExtractionFailed';
                setMessage(t(`attribute.error.${key}`));
            }
            return;
        }
        if (parsed.command === 'attributeManager') {
            const options = parseDrawingAttributeManagerInput(getDrawingCommandInput(rawValue));
            if (!options) { setMessage(t('attribute.error.managerSyntax')); return; }
            if (options.open) { setBlockSearch(options.blockName); setSidebarPanel('blocks'); return; }
            manageAttribute(options.blockName, options.tag, options.operation, options.value); return;
        }
        if (['attributeDefine', 'attributeEdit', 'attributeSync', 'attributeDisplay'].includes(parsed.command)) {
            const input = getDrawingCommandInput(rawValue);
            if (parsed.command === 'attributeDefine' && !input.trim()) { setSidebarPanel('blocks'); return; }
            if (parsed.command === 'attributeEdit' && !input.trim()) { setSidebarPanel('selection'); return; }
            if (parsed.command === 'attributeDisplay') {
                const token = input.trim().toLowerCase();
                const mode = token === 'on' ? 'all' : token;
                if (!['normal', 'all', 'off'].includes(mode)) { setMessage(t('attribute.error.displaySyntax')); return; }
                history.commit({ ...history.content, settings: { ...history.content.settings, attributeDisplay: mode } });
                setMessage(t('attribute.updated')); return;
            }
            const tokens = tokenizeDrawingAttributeInput(input);
            const result = parsed.command === 'attributeDefine' ? defineDrawingAttribute(history.content, input)
                : parsed.command === 'attributeEdit' ? tokens?.length === 2
                    ? editDrawingAttribute(history.content, selectedIds, tokens[0], tokens[1]) : { error: 'editSyntax' }
                    : tokens && tokens.length <= 1 ? syncDrawingAttributes(history.content, selectedIds, tokens[0] || '') : { error: 'syncSyntax' };
            if (result.error) { setMessage(t(`attribute.error.${result.error}`)); return; }
            canvasRef.current?.cancel?.(); setInteractiveOperation(null); setActiveTool('select');
            history.commit(result.content);
            if (result.entity) setSelectedIds([result.entity.id]);
            setSidebarPanel('selection'); setMessage(t('attribute.updated')); return;
        }
        if (parsed.command === 'blockEdit') { beginBlockEdit(getDrawingCommandInput(rawValue)); return; }
        if (['referenceSave', 'referenceClose'].includes(parsed.command) && !blockEditor.session?.referenceSource) {
            setMessage(t('reference.noSourceEditor')); return;
        }
        if (['blockSave', 'referenceSave'].includes(parsed.command)) { await finishBlockEdit(); return; }
        if (['blockClose', 'referenceClose'].includes(parsed.command)) {
            const mode = getDrawingCommandInput(rawValue).trim().toUpperCase() || 'SAVE';
            if (!['SAVE', 'DISCARD'].includes(mode)) { setMessage(t('block.closeOptions')); return; }
            await finishBlockEdit(true, mode === 'DISCARD'); return;
        }
        if (parsed.command === 'blockSearch') { openModelWorkspace(); setBlockSearch(getDrawingCommandInput(rawValue).trim()); setSidebarPanel('blocks'); return; }
        if (parsed.command === 'blockBase') {
            if (blockEditor.session) { setMessage(t('block.error.closeFirst')); return; }
            openModelWorkspace(); blockCommands.base(getDrawingCommandInput(rawValue)); return;
        }
        if (parsed.command === 'blockDefine') { openModelWorkspace(); blockCommands.define(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'blockExport') { await blockLibrary.run('export', getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'contentBrowser') { await blockLibrary.browse(getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'blockImport') { await blockLibrary.run('import', getDrawingCommandInput(rawValue)); return; }
        if (parsed.command === 'blockInsert') {
            openModelWorkspace();
            const input = getDrawingCommandInput(rawValue);
            if (/^FILE(?:\s|$)/i.test(input)) await blockLibrary.run('import', input.replace(/^FILE\s*/i, ''), true);
            else blockCommands.insert(input);
            return;
        }
        if (parsed.command === 'transparency') {
            const input = getDrawingCommandInput(rawValue).trim();
            const transparency = Number(input.replace(',', '.'));
            const editable = selectedEntities.filter(entity => canEditEntity(history.content, entity));
            if (!input || !Number.isFinite(transparency) || transparency < 0 || transparency > 90 || !editable.length) {
                setMessage(t('image.transparencyOptions')); return;
            }
            history.commit(updateSelectedEntities(history.content, editable.map(entity => entity.id), entity => ({ ...entity, transparency })));
            setMessage(t('image.transparencyApplied'));
            return;
        }
        if (parsed.command === 'imageAttach') {
            await imageSource.run(getDrawingCommandInput(rawValue), null, true);
            return;
        }
        if (parsed.command === 'imageSource' && getDrawingCommandInput(rawValue).trim()) {
            await imageSource.run(getDrawingCommandInput(rawValue), selectedEntities.length === 1 ? selectedEntities[0] : null);
            return;
        }
        if (['imageAdjust', 'imageClip', 'imageSource'].includes(parsed.command)) {
            const entity = selectedEntities.length === 1 && selectedEntities[0];
            if (entity?.type !== 'image' || !canEditEntity(history.content, entity)) { setMessage(t('image.adjustSelection')); return; }
            const input = getDrawingCommandInput(rawValue).trim();
            if (input) {
                const imageAdjustments = parsed.command === 'imageAdjust' && parseImageAdjustmentInput(input, entity.imageAdjustments);
                const patch = parsed.command === 'imageClip' ? parseImageClipInput(input, entity.imageClip) : imageAdjustments && { imageAdjustments };
                if (!patch) { setMessage(t(parsed.command === 'imageClip' ? 'image.clipInvalid' : 'image.adjustInvalid')); return; }
                history.commit(updateSelectedEntities(history.content, [entity.id], current => ({ ...current, ...patch })));
            }
            openModelWorkspace();
            setActiveTool('select');
            setCreationPanelEntityId(entity.id);
            setMessage(t('messages.creationPanelOpened', { type: t('entity.image') }));
            return;
        }
        if (parsed.command === 'creationPanel') setSidebarPanel('selection');
        if (parsed.command === 'creationPanel' && selectedEntities.length > 1) {
            canvasRef.current?.cancel();
            setInteractiveOperation(null);
            setActiveTool('select');
            setCreationPanelEntityId(null);
            return;
        }
        if (parsed.command === 'polylineEdit') {
            const entity = selectedEntities[0];
            if (selectedEntities.length !== 1 || !isEditableDrawingPolyline(entity) || !canEditEntity(history.content, entity)) {
                setMessage(t('polylineEdit.selection')); return;
            }
            const input = getDrawingCommandInput(rawValue).trim();
            if (input) {
                const result = editDrawingPolyline(entity, parseDrawingPolylineEdit(input));
                if (result.error) { setMessage(t('polylineEdit.invalid')); return; }
                if (result.changed) history.commit(updateSelectedEntities(history.content, [entity.id], () => result.entity));
            }
            openModelWorkspace(); canvasRef.current?.cancel(); setInteractiveOperation(null); setActiveTool('select');
            setCreationPanelEntityId(entity.id); setMessage(t('polylineEdit.opened')); return;
        }
        if (['creationPanel', 'splineEdit', 'hatchEdit'].includes(parsed.command)) {
            const valid = selectedEntities.filter(parsed.command === 'splineEdit'
                ? entity => isEditableSpline(entity) || (getDrawingCommandInput(rawValue).trim().toUpperCase() === 'FIT'
                    && entity.type === 'polyline' && !entity.array && !entity.closed && Array.isArray(entity.points))
                : parsed.command === 'hatchEdit' ? entity => entity.type === 'hatch' : supportsDrawingCreationPanel);
            if (selectedEntities.length !== 1 || valid.length !== 1) {
                setCreationPanelEntityId(null);
                setMessage(t(parsed.command === 'splineEdit' ? 'spline.editSelectionRequired' : parsed.command === 'hatchEdit' ? 'hatch.selectionRequired' : 'messages.creationPanelSelectionRequired'));
                return;
            }
            openModelWorkspace();
            canvasRef.current?.cancel();
            setInteractiveOperation(null);
            setActiveTool('select');
            if (parsed.command === 'hatchEdit' && getDrawingCommandInput(rawValue).trim()) {
                const entity = valid[0];
                const input = getDrawingCommandInput(rawValue).trim();
                const pattern = parseHatchPatternInput(input, entity.pattern);
                if (!canEditEntity(history.content, entity) || (!pattern && input.toUpperCase() !== 'DETACH')) {
                    setMessage(t('hatch.invalidOptions')); return;
                }
                history.commit(updateSelectedEntities(history.content, [entity.id], current => {
                    if (pattern) return { ...current, pattern };
                    const { sourceIds, ...detached } = current;
                    return detached;
                }));
            }
            if (parsed.command === 'splineEdit' && getDrawingCommandInput(rawValue).trim()) {
                const entity = valid[0];
                const next = canEditEntity(history.content, entity)
                    ? applySplineEditInput(entity, getDrawingCommandInput(rawValue)) : entity;
                if (next === entity) {
                    setMessage(t('spline.editInvalid'));
                    return;
                }
                history.commit(updateSelectedEntities(history.content, [entity.id], () => next));
                if (!supportsDrawingCreationPanel(next)) {
                    setCreationPanelEntityId(null);
                    setMessage(t('spline.converted'));
                    return;
                }
            }
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
        else if (parsed.command === 'arrayPath') beginArray(false, 'path');
        else if (parsed.command === 'arrayPolar') beginArray(false, 'polar');
        else if (parsed.command === 'arrayEdit') beginArray(true);
        else if (parsed.command === 'arrayClose') setMessage(t('array.noActiveArray'));
        else if (parsed.command === 'align') beginAlign();
        else if (['fillet', 'chamfer', 'blend'].includes(parsed.command)) beginCornerOperation(parsed.command, parsed.args);
        else if (parsed.command === 'join') beginCompoundOperation('join');
        else if (parsed.command === 'explode') beginCompoundOperation('explode');
        else if (parsed.command === 'xplode') beginCompoundOperation('xplode');
        else if (parsed.command === 'delete') workspaceMode === 'layout' ? deleteSelectedViewport() : deleteSelection();
        else if (parsed.command === 'undo') history.undo();
        else if (parsed.command === 'redo') history.redo();
        else if (parsed.command === 'saveAs') await saveDrawingAs();
        else if (parsed.command === 'new') await createNewDrawing(getDrawingCommandInput(rawValue));
        else if (parsed.command === 'quickNew') await createQuickDrawing(getDrawingCommandInput(rawValue));
        else if (parsed.command === 'saveTemplate') await saveDrawingTemplate(getDrawingCommandInput(rawValue));
        else if (parsed.command === 'open') await openDrawing();
        else if (parsed.command === 'pdf' || parsed.command === 'plot') await exportPdf(activeLayout ? [activeLayout.id] : []);
        else if (parsed.command === 'pdfAll') await exportPdf(layouts.map(layout => layout.id));
        else if (parsed.command === 'pdfSelected') await exportPdf(selectedLayoutIds);
        else if (parsed.command === 'publish') {
            const input = getDrawingCommandInput(rawValue);
            if (/^SHEETSET(?:\s|$)/i.test(input)) await sheetSet.run('sheetSet', `PUBLISH ${input.replace(/^SHEETSET\s*/i, '') || 'PDF'}`);
            else await exportPdf(layouts.map(layout => layout.id));
        }
        else if (parsed.command === 'dwfx') await exportPdf(layouts.map(layout => layout.id), { format: 'dwfx' });
        else if (parsed.command === 'autoPublish') await autoPublish(layouts.map(layout => layout.id));
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
        imageSource.cancel();
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
        command: submitCommand,
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
        searchCommand: () => commandBarRef.current?.focus(),
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
        arrayPath: () => beginArray(false, 'path'),
        arrayPolar: () => beginArray(false, 'polar'),
        arrayEdit: () => beginArray(true),
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

    const mcpFiles = useMcpFiles({ document, blockEditing: Boolean(blockEditor.session), onReplaceSession,
        setFilePath: handlePathChange, withPublishPages: publishPages.withPublishPages, protectedPaths: recoverySourcePaths });
    useLumcadMcpBridge({
        ...mcpFiles,
        getState: () => ({
            headless: isHeadlessRuntime(),
            document,
            filePath,
            recovered: Boolean(recovered && !filePath),
            selection: workspaceMode === 'layout'
                ? (layoutCanvasRef.current?.getPaperSelection() ? [layoutCanvasRef.current.getPaperSelection()] : selectedViewportId ? [selectedViewportId] : [])
                : selectedIds,
            editor: {
                blockEdit: blockEditor.session ? { blockId: blockEditor.session.blockId, name: blockEditor.session.name,
                    dirty: blockEditor.dirty, content: history.content, assets,
                    referenceSource: blockEditor.session.referenceSource ? { referenceId: blockEditor.session.referenceSource.referenceId,
                        path: blockEditor.session.referenceSource.path, revision: blockEditor.session.referenceSource.revision } : null } : null,
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
                inquiryResult: inquiry.getResult(),
                contentBrowser: blockLibrary.getBrowserReport(),
                dataExtraction: dataExtraction.getReport(),
                comparison: comparison.getReport(),
                standards: standards.getReport(),
                sheetSet: sheetSet.getReport(),
                hiddenObjectIds: objectVisibility.hiddenIds,
                calculatorMode,
                inputVariables: { ...inputVariablesRef.current },
            },
        }),
        executeAction: async action => {
            if (action.type === 'selection') {
                const knownIds = new Set(history.content.entities.map(entity => entity.id));
                const viewportIds = new Set(activeLayout?.viewports.map(viewport => viewport.id) || []);
                const paperIds = new Set(activeLayout?.paperEntities?.map(entity => entity.id) || []);
                const ids = [...new Set(action.ids || [])];
                const unknownIds = ids.filter(id => !knownIds.has(id) && !viewportIds.has(id) && !paperIds.has(id));
                if (unknownIds.length) throw new Error(`Unknown LUMCAD entity IDs: ${unknownIds.join(', ')}`);
                const paperSelection = ids.filter(id => paperIds.has(id));
                if (paperSelection.length) {
                    if (paperSelection.length !== 1 || ids.length !== 1 || workspaceMode !== 'layout') throw new Error('Select one paper annotation in the active layout.');
                    if (!layoutCanvasRef.current?.selectPaperEntity(paperSelection[0])) throw new Error('Paper annotation cannot be selected.');
                    setSelectedViewportId(null); setSelectedIds([]); return;
                }
                if (workspaceMode === 'layout') layoutCanvasRef.current?.selectPaperEntity(null);
                const selectedViewportIds = ids.filter(id => viewportIds.has(id));
                const selectedEntityIds = ids.filter(id => knownIds.has(id));
                if (selectedViewportIds.length && selectedEntityIds.length) {
                    throw new Error('A LUMCAD selection cannot mix model entities and layout viewports.');
                }
                if (selectedViewportIds.length > 1) {
                    throw new Error('Only one layout viewport can be selected at a time.');
                }
                if (selectedViewportIds.length && blockEditor.session) throw new Error('Close the block editor before selecting a layout viewport.');
                if (selectedViewportIds.length) {
                    setWorkspaceMode('layout');
                    setSelectedViewportId(selectedViewportIds[0]);
                    setSelectedIds([]);
                    return;
                }
                if (workspaceMode === 'layout') setSelectedViewportId(null);
                setSelectedIds(ids.filter(id => {
                    const entity = history.content.entities.find(item => item.id === id);
                    return entity && canSelectEntity(history.content, entity);
                }));
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
            if (blockEditor.session) throw new Error('Close the block editor with BCLOSE before replacing the document.');
            if (!replacement || typeof replacement !== 'object' || Array.isArray(replacement)) {
                throw new Error('replace_document requires a LUMCAD document object.');
            }
            const normalized = normalizeLcadDocument({ ...document, ...replacement });
            objectVisibility.update('show', []);
            canvasRef.current?.cancel();
            history.commitDocument({
                content: normalized.content,
                layouts: normalized.layouts,
                pageSetups: normalized.pageSetups || [],
            }, { applyCreationStyles: false, preserveConstraintSnapshot: true });
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
            <DrawingDownloadNotice />
            <div className={`drawing-editor-shell ${blockEditor.session ? 'is-block-editing' : 'has-workspace-tabs'}`} onDragStart={event => { if (!isDrawingTextInput(event.target)) event.preventDefault(); }}>
                <DrawingEditorHeader
                    name={name}
                    onNameChange={setName}
                    filePath={filePath}
                    saveStatus={autosave.status}
                    isRecovery={autosave.isRecovery || (recovered && !filePath)}
                    lastSavedAt={autosave.lastSavedAt}
                    onNew={() => createNewDrawing().catch(() => {})}
                    onOpen={() => openDrawing().catch(() => {})}
                    onPlot={() => exportPdf(activeLayout ? [activeLayout.id] : layouts.map(layout => layout.id)).catch(() => {})}
                    onSaveAs={() => saveDrawingAs().catch(() => {})}
                    onOpenSettings={onOpenSettings}
                    commandLine={(
                        <DrawingCommandBar
                            ref={commandBarRef}
                            value={commandValue}
                            onChange={setCommandValue}
                            onSubmit={value => submitCommand(value).catch(() => {})}
                            message={message}
                            operation={interactiveOperation}
                            activeTool={workspaceMode === 'model' ? activeTool : 'select'}
                            optionsRef={setCommandOptionsTarget}
                        />
                    )}
                    editActions={{
                        undo: history.undo, redo: history.redo, canUndo: history.canUndo, canRedo: history.canRedo,
                        copy: toolbarActions.copy, cut: toolbarActions.cut, paste: toolbarActions.paste,
                        canCopy: workspaceMode === 'model' && selectedIds.length > 0,
                    }}
                    updateState={updater}
                    onInstallUpdate={() => installAvailableUpdate().catch(() => setMessage(t('updater.installFailed')))}
                />
                {blockEditor.session && <section className="drawing-block-edit-bar" aria-label={t('block.editor')}>
                    <strong>{t(blockEditor.session.referenceSource ? 'reference.editing' : 'block.editing', { name: blockEditor.session.name })}</strong>
                    <span>{t(blockEditor.dirty ? 'block.draftModified' : 'block.draftSaved')}</span>
                    {blockEditor.session.referenceSource && <span>{t('reference.sourceWriteNotice')}</span>}
                    <Button type="button" onClick={() => finishBlockEdit()}>{t(blockEditor.session.referenceSource ? 'commands.referenceSave' : 'commands.blockSave')}</Button>
                    <Button type="button" onClick={() => finishBlockEdit(true)}>{t('block.saveAndClose')}</Button>
                    <Button type="button" onClick={() => finishBlockEdit(true, true)}>{t('block.discardAndClose')}</Button>
                </section>}
                {workspaceMode === 'model' ? (
                    <DrawingEditorBody
                        toolbar={{ activeTool, activeOperation: interactiveOperation?.arrayKind === 'path' ? 'arrayPath' : interactiveOperation?.arrayKind === 'polar' ? 'arrayPolar' : interactiveOperation?.type || null, actions: toolbarActions,
                            selectionCount: selectedIds.length }}
                        onToolChange={tool => {
                            if (tool === 'hatch') { submitCommand('HATCH').catch(() => {}); return; }
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
                        canvas={{ content: history.content, assets, activeTool, dimensionMode, selectedIds, interactiveOperation, backgroundContext: referenceContext,
                            onSelectionChange: setSelectedIds, onCommit: history.commit, onViewportChange: setViewport,
                            onEndCoalescing: history.endCoalescing, onCancelCommand: cancelCommand,
                            onStatus: setMessage, onInteractiveOperation: handleInteractiveOperation,
                            dynamicInput: { value: commandValue, onChange: setCommandValue, focus: value => commandBarRef.current?.focus(value),
                                onSubmit: value => submitCommand(value).catch(() => {}) },
                            onEntityCreated: entity => {
                                if (!supportsDrawingCreationPanel(entity) || ['text', 'line'].includes(entity.type)) return;
                                setCreationPanelEntityId(entity.id);
                                setInteractiveOperation(null);
                                setActiveTool('select');
                                setMessage(t('messages.creationPanelOpened', { type: t(`entity.${entity.type}`) }));
                            },
                            editEntity: creationPanelEntity,
                            onImageSource: input => imageSource.run(input, creationPanelEntity),
                            imageSourceBusy: imageSource.busy,
                            onEditEntityChange: creationPanelEntity && canEditEntity(history.content, creationPanelEntity)
                                ? patch => history.commit(patch.leaderEdit
                                    ? updateDrawingLeader(history.content, creationPanelEntity.id, patch.leaderEdit).content || history.content
                                    : updateSelectedEntities(
                                    history.content,
                                    [creationPanelEntity.id],
                                    entity => patch.id === entity.id ? patch : ({ ...entity, ...patch }),
                                ), { coalesceKey: `creation-panel-${creationPanelEntity.id}` })
                                : null }}
                        optionsTarget={workspaceMode === 'model' ? commandOptionsTarget : null}
                        sidebar={{ content: history.content, selectedIds, parametersEnabled: !blockEditor.session?.referenceSource, onSelectConstraintObjects: setSelectedIds, onSmartBlockCommand: smartBlocks.run, smartBlockDetection: smartBlocks.detection, dynamicBlockEditing: Boolean(blockEditor.session && !blockEditor.session.referenceSource), onCommit: history.commit, onAnnotationCommand: annotations.run,
                            inquiryResult: inquiry.result, comparisonPreview: comparison.preview, onCopyInquiry: inquiry.copy, onInspectTransmittal: () => sheetSet.run('sheetSet', 'INVENTORY'), onSelectDuplicateGroup: selectionQueries.selectDuplicateGroup, onSelectCountOccurrence: selectionQueries.selectCountOccurrence,
                            onOpenRecovery: recovery.open, canOpenRecovery: recovery.canOpen,
                            onSelectRecovery: recovery.select, onShowRecoveryManager: recovery.showManager, hasRecoveryGraph: recovery.hasGraph,
                            onShowRecoveryHistory: recovery.showHistory, onRetryRecovery: recovery.retry, onForgetRecovery: recovery.forget, onRelinkRecovery: recovery.relink, canRelinkRecovery: recovery.canRelink,
                            layerFilter: layerManager.filter, onLayerFilter: layerManager.setFilter, onPlotStyleCommand: plotStyles.run,
                            panel: sidebarPanel, onPanelChange: setSidebarPanel,
                            libraryBrowser: blockLibrary.browser, onBrowseLibrary: blockLibrary.browse,
                            blockSearch, onBlockSearch: setBlockSearch, onBlockDefine: blockCommands.define, onBlockInsert: blockCommands.insert, onBlockEdit: beginBlockEdit, onBlockImport: () => blockLibrary.run('import'),
                            onBlockExport: id => blockLibrary.run('export', id || 'LIBRARY'), onDimensionStyleCommand: manageDimensionStyle, onManageAttribute: manageAttribute, onDefineAttribute: input => submitCommand(`ATTDEF ${input}`) }}
                    />
                ) : activeLayout && (
                    <DrawingLayoutEditor
                        activeTool={layoutTool}
                        assets={assets}
                        canvasRef={layoutCanvasRef}
                        content={history.content}
                        currentModelViewport={viewport}
                        layout={activeLayout}
                        layoutCount={layouts.length}
                        onChange={commitActiveLayout}
                        onCreatePageSetup={createPageSetup}
                        onDeleteLayout={() => deleteLayout(activeLayout.id)}
                        onDeletePageSetup={deletePageSetup}
                        onDeleteViewport={deleteSelectedViewport}
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
                <DrawingStatusBar
                    tabs={!blockEditor.session && (
                        <DrawingWorkspaceTabs
                            activeLayoutId={activeLayout?.id || null}
                            layouts={layouts}
                            mode={workspaceMode}
                            onAddLayout={addLayout}
                            onAddLayoutFromTemplate={addLayout}
                            onDeleteLayout={deleteLayout}
                            onDuplicateLayout={duplicateLayout}
                            onMoveLayout={moveLayout}
                            onOpenLayout={openLayoutWorkspace}
                            onOpenModel={openModelWorkspace}
                            onRenameLayout={renameLayout}
                            onSelectedLayoutsChange={setSelectedLayoutIds}
                            selectedLayoutIds={selectedLayoutIds}
                        />
                    )}
                    aids={workspaceMode === 'model' && (
                        <DrawingSnapControls
                            content={history.content}
                            onChange={history.commit}
                            scaleRatio={getScreenScaleRatio(viewport.worldUnitsPerPixel)}
                            onScaleChange={ratio => canvasRef.current?.setScaleRatio(ratio)}
                            draftingSettingsOpen={draftingSettingsOpen}
                            onDraftingSettingsOpenChange={setDraftingSettingsOpen}
                            onTemporaryTrackingPoint={() => canvasRef.current?.beginTemporaryTrackingPoint()}
                        />
                    )}
                    onZoomIn={workspaceMode === 'model' ? toolbarActions.zoomIn : undefined}
                    onZoomOut={workspaceMode === 'model' ? toolbarActions.zoomOut : undefined}
                    onFit={workspaceMode === 'model' ? toolbarActions.fit : undefined}
                />
                <Input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleImageFile} disabled={isUploading} />
                {isUploading && <div className="drawing-upload-indicator">{t('messages.importingImage')}</div>}
            </div>
            {publishPages.active && <DrawingPublishRenderer ref={publishPages.rendererRef} drawing={document} layouts={layouts} />}
            <DrawingModelExportRenderer request={wmf.renderRequest} />
            <DrawingModelExportRenderer request={imageExport.request} />
            {sheetSet.publication.request && <DrawingPublishRenderer
                entries={sheetSet.publication.request.entries} onReady={sheetSet.publication.onReady} />}
            {publishRequest && (
                <DrawingPublishDialog
                    drawing={document}
                    initialFormat={publishRequest.format}
                    initialLayoutIds={publishRequest.layoutIds}
                    onApplySettings={applyPublishSettings}
                    onClose={closePublishDialog}
                    onPublish={publishRenderedLayouts}
                    onSystemPrint={printPublishedLayouts}
                    open
                    pageSetups={pageSetups}
                />
            )}
            {printJob && (
                <div className="lumcad-print-root">
                    <DrawingPrintPage
                        drawing={printJob.drawing}
                        layouts={printJob.layouts}
                        plotSettings={printJob.plotSettings}
                    />
                </div>
            )}
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
        || operation.stage === 'array-center' || operation.stage === 'array-option-center'
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
