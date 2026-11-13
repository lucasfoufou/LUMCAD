// Families of the "All commands" palette. Kept beside the catalog rather than
// in src/mcp/commands.json: the grouping is presentation only, MCP clients do
// not need it, and a command missing here simply shows under "Other".

const GROUPS = [
    ['files', [
        'new', 'quickNew', 'open', 'quickSave', 'saveAs', 'saveTemplate', 'import', 'export',
        'dwgImport', 'dwgExport', 'dxfImport', 'dxfExport', 'pdfImport', 'dgnImport', 'wmfImport', 'wmfExport',
        'pngOut', 'jpegOut', 'svgOut', 'recover', 'recoverAll', 'recoveryManager', 'audit', 'purge',
        'contentBrowser', 'drawingStandards', 'drawingCheckStandards', 'drawingCompare', 'drawingCompareImport',
    ]],
    ['draw', [
        'line', 'xline', 'ray', 'widePolyline', 'rectangle', 'polygon', 'circle', 'arc', 'ellipse', 'spline',
        'point', 'pointStyle', 'divide', 'measure', 'donut', 'multiline', 'multilineStyle', 'sketch',
        'revisionCloud', 'revisionProperties', 'breakLine', 'hatch', 'solid', 'gradient', 'region', 'boundary',
        'wipeout', 'centerLine', 'centerMark', 'centerReassociate', 'centerDisassociate', 'centerReset', 'creationPanel',
    ]],
    ['modify', [
        'move', 'copy', 'copyBase', 'rotate', 'scale', 'mirror', 'offset', 'trim', 'extend', 'fillet', 'chamfer',
        'blend', 'array', 'arrayPolar', 'arrayPath', 'arrayEdit', 'arrayClose', 'break', 'breakAtPoint', 'stretch',
        'lengthen', 'join', 'explode', 'xplode', 'align', 'delete', 'polylineEdit', 'splineEdit', 'hatchEdit',
        'multilineEdit', 'matchProperties', 'transparency', 'drawOrder', 'hatchToBack', 'textToFront', 'flatten',
        'overkill', 'group', 'groupEdit', 'ungroup', 'undo', 'redo', 'copyClip', 'cutClip', 'pasteClip',
        'pasteOriginal', 'pasteBlock', 'hyperlink',
    ]],
    ['annotate', [
        'text', 'multilineText', 'textEdit', 'textStyle', 'arcText', 'leader', 'multiLeaderEdit', 'multiLeaderAlign',
        'multiLeaderCollect', 'multiLeaderStyle', 'table', 'tableEdit', 'tableStyle', 'tableExport', 'dataLink',
        'dataLinkUpdate', 'field', 'updateField', 'tolerance', 'objectScale', 'scaleListEdit', 'annotationUpdate',
        'annotationReset',
    ]],
    ['dimension', [
        'dimension', 'linearDimension', 'alignedDimension', 'rotatedDimension', 'angularDimension', 'arcDimension',
        'radiusDimension', 'diameterDimension', 'joggedDimension', 'ordinateDimension', 'quickDimension',
        'baselineDimension', 'continueDimension', 'dimensionStyle', 'dimensionEdit', 'dimensionTextEdit',
        'dimensionBreak', 'dimensionSpace', 'dimensionDisassociate', 'dimensionReassociate', 'dimensionUpdate',
        'dimensionRegenerate', 'dimensionInspect',
    ]],
    ['layers', [
        'layerFlags', 'layerState', 'layerStateSave', 'layerIsolate', 'layerUnisolate', 'layerWalk', 'layerMerge',
        'layerTranslate', 'layerFilter', 'layerMatch', 'layerCurrent', 'copyToLayer',
    ]],
    ['blocks', [
        'blockDefine', 'blockInsert', 'blockEdit', 'blockSave', 'blockClose', 'blockExport', 'blockImport',
        'blockBase', 'blockSearch', 'blockDetect', 'blockConvert', 'blockReplace', 'blockLookupTable', 'blockTable',
        'blockVisibility', 'blockParameter', 'blockAction', 'resetBlock', 'blockCount', 'attributeDefine',
        'attributeEdit', 'attributeManager', 'attributeSync', 'attributeDisplay', 'attributeExtract',
    ]],
    ['references', [
        'externalReference', 'referenceAttach', 'referenceBind', 'referenceClip', 'referenceEdit', 'referenceSave',
        'referenceClose', 'referenceCompare', 'imageAttach', 'imageSource', 'imageClip', 'imageAdjust', 'pdfAttach',
        'pdfClip', 'pdfLayers', 'pdfShxText', 'dgnAttach', 'dgnClip', 'dwfAttach', 'dwfClip',
    ]],
    ['constraints', [
        'parameters', 'dimConstraint', 'dcLinear', 'dcAligned', 'dcAngular', 'dcRadius', 'dcDiameter', 'dcConvert',
        'autoConstrain', 'geomConstraint', 'gcCoincident', 'gcCollinear', 'gcConcentric', 'gcEqual', 'gcFix',
        'gcHorizontal', 'gcParallel', 'gcPerpendicular', 'gcSymmetric', 'gcTangent', 'gcVertical', 'gcSmooth',
    ]],
    ['layout', [
        'layout', 'pageSetup', 'pageSetupImport', 'pageSetupExport', 'modelSpace', 'paperSpace', 'viewport', 'viewportScale',
        'viewportClip', 'viewportLayer', 'viewportMax', 'viewportMin', 'changeSpace', 'exportLayout', 'alignSpace',
        'plot', 'pdf', 'pdfAll', 'pdfSelected', 'publish', 'autoPublish', 'dwfx', 'styleManager', 'plotStyle',
        'convertPlotStyles', 'convertColorTable', 'sheetSet', 'newSheetSet', 'openSheetSet', 'sheetSetArchive',
    ]],
    ['view', [
        'zoom', 'fit', 'pan', 'namedView', 'viewGo', 'hideObjects', 'isolateObjects', 'unisolateObjects', 'ucs',
        'ucsIcon', 'select', 'quickSelect', 'selectionFilter', 'selectSimilar',
    ]],
    ['inquiry', [
        'measureGeometry', 'distanceInquiry', 'areaInquiry', 'coordinateInquiry', 'entityList', 'drawingStatus',
        'massProperties', 'selectCount', 'countObjects', 'countArea', 'countList', 'countTable', 'dataExtract',
        'quickCalc',
    ]],
    ['settings', [
        'options', 'help', 'aliasEdit', 'draftingSettings', 'ortho', 'polar', 'objectTracking',
        'temporaryTrackingPoint', 'dynamicInput', 'drawingUnits', 'drawingLimits',
    ]],
];

/** Group ids in palette order; 'other' collects commands not listed above. */
export const DRAWING_COMMAND_GROUP_IDS = Object.freeze([...GROUPS.map(([id]) => id), 'other']);

const groupByCommand = new Map(GROUPS.flatMap(([id, commands]) => commands.map(command => [command, id])));

export function getDrawingCommandGroup(command) {
    return groupByCommand.get(command) || 'other';
}

/** Splits command search results into ordered `{ id, commands }` groups, keeping each group's order. */
export function groupDrawingCommands(results) {
    const groups = new Map(DRAWING_COMMAND_GROUP_IDS.map(id => [id, []]));
    for (const result of results) groups.get(getDrawingCommandGroup(result.command)).push(result);
    return [...groups].filter(([, commands]) => commands.length).map(([id, commands]) => ({ id, commands }));
}
