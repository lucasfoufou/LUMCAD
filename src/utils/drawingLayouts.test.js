import assert from 'node:assert/strict';
import test from 'node:test';

import {
    addDrawingPaperAnnotation,
    applyDrawingPageSetup,
    applyDrawingViewportDisplaySettings,
    changeDrawingLayoutCustomPaperSize,
    changeDrawingLayoutFormat,
    changeDrawingLayoutMargins,
    changeDrawingLayoutOrientation,
    createDrawingLayout,
    createDrawingPaperAnnotation,
    createDrawingPageSetup,
    createDrawingPageSetupExport,
    createDrawingViewportClipPreset,
    createStandardViewportArrangement,
    createDrawingViewport,
    duplicateDrawingLayout,
    editDrawingPaperAnnotationGrip,
    getDrawingPrintableArea,
    getDrawingLayoutDimensionTextSize,
    getDrawingPaperSize,
    getDrawingViewportClipPoints,
    getDrawingViewportScale,
    importDrawingPageSetups,
    modelViewBoxFromViewport,
    normalizeDrawingPaperEntities,
    normalizeDrawingLayouts,
    parseDrawingPageSetups,
    normalizeViewportClipBoundary,
    paperPointToViewportModelPoint,
    removeDrawingPaperAnnotation,
    renameDrawingLayout,
    reorderDrawingLayouts,
    resizeDrawingViewport,
    scaleDrawingViewport,
    serializeDrawingPageSetups,
    setDrawingViewportLayerOverride,
    setDrawingViewportRotation,
    setDrawingViewportScale,
    updateDrawingViewport,
    updateDrawingPaperAnnotation,
    translateDrawingPaperAnnotation,
    viewportModelPointToPaperPoint,
} from './drawingLayouts.js';

test('paper formats expose landscape A-series dimensions', () => {
    assert.deepEqual(getDrawingPaperSize('A4'), { width: 297, height: 210 });
    assert.deepEqual(getDrawingPaperSize('A0'), { width: 1189, height: 841 });
    assert.deepEqual(getDrawingPaperSize('A4', 'portrait'), { width: 210, height: 297 });
});

test('layout dimension text keeps a constant physical paper height', () => {
    const a4 = getDrawingPaperSize('A4');
    const a0 = getDrawingPaperSize('A0');
    const a4Size = getDrawingLayoutDimensionTextSize(a4);
    const a0Size = getDrawingLayoutDimensionTextSize(a0);
    assert.equal(a4Size, 3);
    assert.equal(a0Size, 3);
    assert.equal(getDrawingLayoutDimensionTextSize(a0, {
        annotationSettings: { dimensionTextSizeMm: 5 },
    }), 5);
});

test('drawing layouts normalize to one editable A0 layout', () => {
    const [layout] = normalizeDrawingLayouts(null);
    assert.equal(layout.format, 'A0');
    assert.equal(layout.orientation, 'landscape');
    assert.equal(layout.name, 'Layout 1');
    assert.deepEqual(layout.viewports, []);
});

test('changing orientation keeps viewport placement proportional', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 29.7, y: 21, width: 148.5, height: 105 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const portrait = changeDrawingLayoutOrientation(layout, 'portrait');
    assert.equal(portrait.orientation, 'portrait');
    assert.ok(Math.abs(portrait.viewports[0].x - 21) < 1e-9);
    assert.ok(Math.abs(portrait.viewports[0].y - 29.7) < 1e-9);
    assert.ok(Math.abs(portrait.viewports[0].width - 105) < 1e-9);
    assert.ok(Math.abs(portrait.viewports[0].height - 148.5) < 1e-9);
});

test('changing paper format keeps viewport placement proportional', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 29.7, y: 21, width: 148.5, height: 105 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const resized = changeDrawingLayoutFormat(layout, 'A3');
    assert.equal(resized.viewports[0].x, 42);
    assert.ok(Math.abs(resized.viewports[0].y - 29.7) < 1e-9);
    assert.equal(resized.viewports[0].width, 210);
    assert.equal(resized.viewports[0].height, 148.5);
});

test('viewport edits stay on the paper and preserve the viewport aspect ratio', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const updated = updateDrawingViewport(layout, layout.viewports[0].id, {
        x: 290,
        y: 205,
        width: 80,
        height: 80,
    });
    const viewport = updated.viewports[0];
    assert.ok(viewport.x + viewport.width <= 297);
    assert.ok(viewport.y + viewport.height <= 210);
    assert.equal(viewport.modelViewBox.width / viewport.modelViewBox.height, viewport.width / viewport.height);
});

test('resizing a viewport changes its field of view without changing its scale', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const before = layout.viewports[0];
    const resized = resizeDrawingViewport(layout, before.id, { width: 150, height: 75 }).viewports[0];
    assert.equal(getDrawingViewportScale(resized), getDrawingViewportScale(before));
    assert.equal(resized.modelViewBox.width, 30);
    assert.equal(resized.modelViewBox.height, 15);
    assert.equal(resized.modelViewBox.x + resized.modelViewBox.width / 2, 10);
    assert.equal(resized.modelViewBox.y + resized.modelViewBox.height / 2, 5);
});

test('the scale tool resizes a viewport around a paper base point without changing zoom', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 20, height: 10 },
        })],
    });
    const before = layout.viewports[0];
    const scaled = scaleDrawingViewport(layout, before.id, 1.5, { x: 20, y: 20 }).viewports[0];
    assert.equal(scaled.x, 20);
    assert.equal(scaled.y, 20);
    assert.equal(scaled.width, 150);
    assert.equal(scaled.height, 75);
    assert.equal(getDrawingViewportScale(scaled), getDrawingViewportScale(before));
});

test('a model canvas viewport can seed a layout viewport at its target aspect', () => {
    const viewBox = modelViewBoxFromViewport({ x: 10, y: 5, width: 30, height: 20 }, 2);
    assert.equal(viewBox.x + viewBox.width / 2, 10);
    assert.equal(viewBox.y + viewBox.height / 2, 5);
    assert.equal(viewBox.width / viewBox.height, 2);
});

test('viewport scales use exact 1/X paper-to-model ratios', () => {
    const viewport = createDrawingViewport({
        rect: { x: 10, y: 10, width: 200, height: 100 },
        modelViewBox: { x: -10, y: -5, width: 20, height: 10 },
        hiddenLayerIds: ['references', 'references', '', null],
    });
    assert.equal(getDrawingViewportScale(viewport), 100);
    assert.deepEqual(viewport.hiddenLayerIds, ['references']);
    const scaled = setDrawingViewportScale(viewport, 50);
    assert.equal(getDrawingViewportScale(scaled), 50);
    assert.equal(scaled.modelViewBox.width, 10);
    assert.equal(scaled.modelViewBox.height, 5);
    assert.equal(scaled.modelViewBox.x + scaled.modelViewBox.width / 2, 0);
    assert.equal(scaled.modelViewBox.y + scaled.modelViewBox.height / 2, 0);
});

test('custom papers and margins expose a bounded printable area', () => {
    let layout = createDrawingLayout({ format: 'A4' });
    layout = changeDrawingLayoutCustomPaperSize(layout, { width: 650, height: 320 });
    assert.equal(layout.format, 'CUSTOM');
    assert.deepEqual(getDrawingPaperSize(layout), { width: 650, height: 320 });
    layout = changeDrawingLayoutMargins(layout, { top: 10, right: 15, bottom: 20, left: 25 });
    assert.deepEqual(getDrawingPrintableArea(layout), { x: 25, y: 10, width: 610, height: 290 });

    const constrained = changeDrawingLayoutMargins(layout, { top: 500, right: 500, bottom: 500, left: 500 });
    const printable = getDrawingPrintableArea(constrained);
    assert.ok(printable.width >= 8);
    assert.ok(printable.height >= 8);
});

test('paper and margin changes retain each viewport exact scale', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
        viewports: [createDrawingViewport({
            rect: { x: 20, y: 20, width: 100, height: 50 },
            modelViewBox: { x: 0, y: 0, width: 10, height: 5 },
        })],
    });
    const scale = getDrawingViewportScale(layout.viewports[0]);
    const resized = changeDrawingLayoutMargins(changeDrawingLayoutFormat(layout, 'A3'), {
        top: 20, right: 25, bottom: 30, left: 35,
    });
    assert.ok(Math.abs(getDrawingViewportScale(resized.viewports[0]) - scale) < 1e-9);
});

test('page setup snapshots apply and import without duplicate identities or names', () => {
    const source = createDrawingPageSetup({
        id: 'setup-a',
        name: 'Production',
        format: 'CUSTOM',
        customPaperSize: { width: 500, height: 350 },
        margins: { top: 5, right: 6, bottom: 7, left: 8 },
    });
    const applied = applyDrawingPageSetup(createDrawingLayout(), source);
    assert.equal(applied.pageSetupId, 'setup-a');
    assert.deepEqual(getDrawingPaperSize(applied), { width: 500, height: 350 });

    const conflict = createDrawingPageSetup({ ...source, id: 'setup-b', orientation: 'portrait' });
    const imported = importDrawingPageSetups([source], [source, conflict]);
    assert.equal(imported.pageSetups.length, 2);
    assert.equal(imported.importedIds[0], 'setup-a');
    assert.equal(imported.pageSetups[1].name, 'Production 2');
});

test('page setup exports round-trip dedicated JSON and .lcad-compatible document shapes', () => {
    const setup = createDrawingPageSetup({
        id: 'setup-portable',
        name: 'Portable',
        format: 'CUSTOM',
        customPaperSize: { width: 630.5, height: 310.25 },
        margins: { top: 5, right: 6, bottom: 7, left: 8 },
    });
    const payload = createDrawingPageSetupExport([setup], { sourceName: 'Roof plan' });
    assert.equal(payload.format, 'lumcad-page-setups');
    assert.equal(payload.version, 1);
    assert.equal(payload.sourceName, 'Roof plan');
    assert.deepEqual(parseDrawingPageSetups(serializeDrawingPageSetups([setup])), [setup]);
    assert.deepEqual(parseDrawingPageSetups({ document: { pageSetups: [setup] } }), [setup]);

    const fromLayout = parseDrawingPageSetups({
        envelope: {
            document: {
                pageSetups: [],
                layouts: [createDrawingLayout({ id: 'layout-portable', name: 'Layout snapshot', format: 'A3' })],
            },
        },
    });
    assert.equal(fromLayout.length, 1);
    assert.equal(fromLayout[0].name, 'Layout snapshot');
    assert.throws(() => parseDrawingPageSetups('{bad json'), /Invalid page-setup JSON/);
    assert.throws(() => parseDrawingPageSetups({ format: 'lumcad-page-setups', version: 2 }), /Unsupported/);
});

test('layout duplicate, rename, and reorder helpers preserve data and remap stable object IDs', () => {
    const source = createDrawingLayout({
        id: 'layout-a',
        name: 'Roof',
        viewports: [createDrawingViewport({ id: 'viewport-a' })],
        paperEntities: [
            { id: 'line-a', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
            { id: 'line-b', type: 'line', x1: 0, y1: 5, x2: 10, y2: 5 },
        ],
    });
    const copy = duplicateDrawingLayout(source, [source]);
    assert.notEqual(copy.id, source.id);
    assert.notEqual(copy.viewports[0].id, source.viewports[0].id);
    assert.equal(copy.name, 'Roof 2');
    assert.notEqual(copy.paperEntities[0].id, source.paperEntities[0].id);

    const detail = createDrawingLayout({ id: 'layout-b', name: 'Detail' });
    const renamed = renameDrawingLayout([source, detail], 'layout-b', 'roof');
    assert.equal(renamed[1].name, 'roof 2');
    assert.deepEqual(reorderDrawingLayouts(renamed, 'layout-b', 0).map(layout => layout.id), ['layout-b', 'layout-a']);

    const numbered = createDrawingLayout({ id: 'layout-numbered', name: 'Roof 2' });
    assert.equal(duplicateDrawingLayout(numbered, [source, numbered]).name, 'Roof 3');
    assert.equal(renameDrawingLayout([source, numbered], 'layout-numbered', 'Roof')[1].name, 'Roof 2');
});

test('paper-space text and line annotations use stable IDs and bounded millimetre geometry', () => {
    const layout = createDrawingLayout({
        format: 'A4',
        margins: { top: 10, right: 10, bottom: 10, left: 10 },
    });
    const text = createDrawingPaperAnnotation(layout, 'text', {
        id: 'paper-note',
        layerId: 'notes',
        text: 'Revision A',
        x: 295,
        y: -4,
        width: 50,
        height: 12,
        fontSize: 4,
        color: '#ABCDEF',
    });
    assert.equal(text.id, 'paper-note');
    assert.equal(text.layerId, 'notes');
    assert.equal(text.x, 295);
    assert.equal(text.y, 0);
    assert.equal(text.width, 2);
    assert.equal(text.text, 'Revision A');
    assert.deepEqual(text.runs, [{ text: 'Revision A', marks: {} }]);
    assert.equal(text.color, '#abcdef');

    const line = createDrawingPaperAnnotation(layout, 'line', {
        id: 'paper-line',
        x1: -20,
        y1: 500,
        x2: 100,
        y2: 40,
        lineType: 'DASHED',
        lineWeight: 3,
    });
    assert.deepEqual({ x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2 }, {
        x1: 0, y1: 210, x2: 100, y2: 40,
    });
    assert.equal(line.lineType, 'dashed');
    assert.equal(line.lineWeight, 3);
});

test('paper annotation CRUD preserves identity, normalizes edits, and leaves no duplicate IDs', () => {
    let layout = createDrawingLayout({ format: 'A4' });
    const note = createDrawingPaperAnnotation(layout, 'text', {
        id: 'paper-note',
        text: 'Original',
    });
    layout = addDrawingPaperAnnotation(layout, note);
    layout = updateDrawingPaperAnnotation(layout, note.id, entity => ({
        ...entity,
        text: 'Updated',
        x: 1_000,
    }));
    assert.equal(layout.paperEntities[0].id, 'paper-note');
    assert.equal(layout.paperEntities[0].text, 'Updated');
    assert.equal(layout.paperEntities[0].x, 296);

    const normalized = normalizeDrawingPaperEntities([
        layout.paperEntities[0],
        { ...layout.paperEntities[0] },
    ], layout);
    assert.equal(normalized.length, 2);
    assert.notEqual(normalized[0].id, normalized[1].id);

    const removed = removeDrawingPaperAnnotation(layout, note.id);
    assert.deepEqual(removed.paperEntities, []);
    assert.equal(removeDrawingPaperAnnotation(removed, 'missing'), removed);
});

test('paper annotations accept only text, line, and rectangle and support bounded visual edits', () => {
    let layout = createDrawingLayout({
        format: 'CUSTOM',
        customPaperSize: { width: 100, height: 80 },
        paperEntities: [{ id: 'unsupported', type: 'circle', cx: 10, cy: 10, r: 5 }],
    });
    assert.deepEqual(layout.paperEntities, []);
    const rectangle = createDrawingPaperAnnotation(layout, 'rectangle', {
        id: 'paper-frame',
        x: 70,
        y: 50,
        width: 20,
        height: 20,
    });
    layout = addDrawingPaperAnnotation(layout, rectangle);
    assert.equal(layout.paperEntities[0].type, 'rectangle');

    layout = translateDrawingPaperAnnotation(layout, rectangle.id, 50, 50);
    assert.deepEqual(
        { x: layout.paperEntities[0].x, y: layout.paperEntities[0].y },
        { x: 80, y: 60 },
    );
    layout = editDrawingPaperAnnotationGrip(layout, rectangle.id, 'top-left', { x: -20, y: -10 });
    assert.deepEqual(
        {
            x: layout.paperEntities[0].x,
            y: layout.paperEntities[0].y,
            width: layout.paperEntities[0].width,
            height: layout.paperEntities[0].height,
        },
        { x: 0, y: 0, width: 100, height: 80 },
    );

    const line = createDrawingPaperAnnotation(layout, 'line', {
        id: 'paper-movable-line', x1: 10, y1: 20, x2: 30, y2: 40,
    });
    layout = addDrawingPaperAnnotation(layout, line);
    layout = translateDrawingPaperAnnotation(layout, line.id, -50, 100);
    assert.deepEqual(
        (({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }))(layout.paperEntities[1]),
        { x1: 0, y1: 60, x2: 20, y2: 80 },
    );
    layout = editDrawingPaperAnnotationGrip(layout, line.id, 'start', { x: 200, y: -20 });
    assert.deepEqual(
        { x1: layout.paperEntities[1].x1, y1: layout.paperEntities[1].y1 },
        { x1: 100, y1: 0 },
    );
});

test('standard viewport arrangements stay within the printable area with stable exact scales', () => {
    const layout = createDrawingLayout({
        format: 'A3',
        margins: { top: 10, right: 15, bottom: 20, left: 25 },
    });
    const arranged = createStandardViewportArrangement(layout, 'four', { x: 0, y: 0, width: 40, height: 30 });
    const printable = getDrawingPrintableArea(arranged);
    assert.equal(arranged.viewports.length, 4);
    arranged.viewports.forEach(viewport => {
        assert.ok(viewport.x >= printable.x);
        assert.ok(viewport.y >= printable.y);
        assert.ok(viewport.x + viewport.width <= printable.x + printable.width + 1e-9);
        assert.ok(viewport.y + viewport.height <= printable.y + printable.height + 1e-9);
    });
});

test('viewport polygon clips normalize, expose paper points, and reject degenerate paths', () => {
    const viewport = createDrawingViewport({
        rect: { x: 20, y: 30, width: 100, height: 50 },
        clipBoundary: createDrawingViewportClipPreset('triangle'),
    });
    assert.deepEqual(getDrawingViewportClipPoints(viewport), [
        { x: 70, y: 30 }, { x: 120, y: 80 }, { x: 20, y: 80 },
    ]);
    assert.equal(normalizeViewportClipBoundary({
        type: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }],
    }), null);
});

test('locked viewports reject view scale and rotation changes', () => {
    const viewport = createDrawingViewport({
        locked: true,
        viewRotation: 25,
        rect: { width: 100, height: 50 },
        modelViewBox: { x: 0, y: 0, width: 10, height: 5 },
    });
    assert.equal(setDrawingViewportScale(viewport, 50), viewport);
    assert.equal(setDrawingViewportRotation(viewport, 90), viewport);
});

test('rotated viewport paper and model transforms remain inverse operations', () => {
    const viewport = createDrawingViewport({
        viewRotation: 37,
        rect: { x: 20, y: 30, width: 200, height: 100 },
        modelViewBox: { x: -10, y: -5, width: 20, height: 10 },
    });
    const model = { x: 3.25, y: -1.75 };
    const paper = viewportModelPointToPaperPoint(viewport, model);
    const restored = paperPointToViewportModelPoint(viewport, paper);
    assert.ok(Math.abs(restored.x - model.x) < 1e-10);
    assert.ok(Math.abs(restored.y - model.y) < 1e-10);
});

test('viewport display settings filter annotations and override layer appearance only', () => {
    const content = {
        layers: [{ id: 'geometry', color: '#111111', lineType: 'continuous', lineWeight: 1 }],
        entities: [
            { id: 'line', type: 'line', layerId: 'geometry' },
            { id: 'text', type: 'text', layerId: 'geometry' },
            { id: 'dimension', type: 'linearDimension', layerId: 'geometry' },
            { id: 'center', type: 'centerMark', layerId: 'geometry' },
        ],
    };
    let viewport = createDrawingViewport({
        annotationSettings: { showText: false, showDimensions: false },
    });
    viewport = setDrawingViewportLayerOverride(viewport, 'geometry', {
        color: '#abcdef', lineType: 'dashed', lineWeight: 3,
    });
    const displayed = applyDrawingViewportDisplaySettings(content, viewport);
    assert.deepEqual(displayed.entities.map(entity => entity.id), ['line']);
    assert.deepEqual(displayed.layers[0], {
        id: 'geometry', color: '#abcdef', lineType: 'dashed', lineWeight: 3,
    });
    assert.equal(content.layers[0].color, '#111111');
});
