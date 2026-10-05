import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, getEntityAppearance, normalizeDrawingContent } from './drawingDocument.js';
import { normalizeDrawingPlotStyles, convertDrawingPlotStyles } from './drawingPlotStyles.js';
import { applyDrawingPlotStyle, applyDrawingDeviceProfile, normalizeDrawingPlotSettings, drawingPlotStampText } from './drawingPlot.js';
import { resolveDrawingBlockChild } from './drawingBlocks.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.settings.plotStyleMode = 'color';
    content.plotStyles = normalizeDrawingPlotStyles([{ name: 'Roof', sourceColor: '#172033', color: '#ff0000', lineWeight: 3, lineType: 'dashed', screening: 50 }]);
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 1 }];
    return content;
}

test('plot mapping uses effective ByLayer colors only in publication and composes global styles', () => {
    const content = fixture();
    const printed = applyDrawingPlotStyle(content, { colorMode: 'asDisplayed', plotLineweights: true });
    assert.deepEqual(getEntityAppearance(printed, content.entities[0]), { color: '#ff0000', lineWeight: 3, lineType: 'dashed', transparency: 50 });
    assert.equal(getEntityAppearance(content, content.entities[0]).color, '#172033');
    assert.equal(getEntityAppearance(applyDrawingPlotStyle(content, null), content.entities[0]).color, '#172033');
    const mono = applyDrawingPlotStyle(content, { colorMode: 'monochrome', plotLineweights: false });
    assert.equal(getEntityAppearance(mono, content.entities[0]).color, '#000000');
    assert.equal(getEntityAppearance(mono, content.entities[0]).lineWeight, 1);
    assert.equal(JSON.stringify(printed.layers), JSON.stringify(content.layers));
});

test('named assignments convert color tables and propagate through nested block content', () => {
    const content = fixture();
    const named = convertDrawingPlotStyles(content, 'named').content;
    assert.equal(named.entities[0].plotStyleName, 'Roof');
    named.entities[0].color = '#0000ff';
    const printed = applyDrawingPlotStyle(named, {});
    assert.equal(getEntityAppearance(printed, named.entities[0]).color, '#ff0000');
    const child = resolveDrawingBlockChild({ ...named.entities[0], plotStyleName: null }, { layerId: 'dimensions', plotStyleName: 'Roof' });
    assert.equal(child.plotStyleName, 'Roof');
    assert.equal(getEntityAppearance(printed, child).lineWeight, 3);
    assert.deepEqual(normalizeDrawingContent(named).plotStyles, named.plotStyles);
});

test('output profile and bounded stamps persist in page-setup plot settings', () => {
    const raster = applyDrawingDeviceProfile({}, 'pdfRaster');
    assert.equal(raster.quality.mode, 'raster');
    assert.equal(raster.quality.rasterDpi, 300);
    const settings = normalizeDrawingPlotSettings({ ...raster, stamp: { enabled: true, text: '{layout} {date} {scale}', sizeMm: 3 }, scale: { mode: 'fixed', denominator: 50 } });
    assert.deepEqual(normalizeDrawingPlotSettings(settings), settings);
    assert.equal(drawingPlotStampText(settings.stamp, { name: 'Roof', plotSettings: settings }, new Date('2026-10-05')), 'Roof 2026-10-05 1:50');
    assert.equal(normalizeDrawingPlotSettings({ stamp: { text: 'x'.repeat(1000), sizeMm: 100 } }).stamp.text.length, 512);
});

test('compound geometry and rich text colour overrides resolve in the publication layer context', async () => {
    const { resolveDrawingPlotEntityDetails } = await import('./drawingPlotStyles.js');
    const content = fixture();
    const printed = applyDrawingPlotStyle(content, {});
    const layer = printed.layers[0];
    const entity = { type: 'polyline', layerId: layer.id, parts: [{ type: 'line', color: '#172033' }],
        runs: [{ text: 'Note', marks: { color: '#172033' } }], pattern: { endColor: '#172033' } };
    const resolved = resolveDrawingPlotEntityDetails(entity, layer);
    assert.equal(resolved.parts[0].color, '#ff0000');
    assert.equal(resolved.parts[0].transparency, 50);
    assert.equal(resolved.runs[0].marks.color, '#ff0000');
    assert.equal(resolved.pattern.endColor, '#ff0000');
    assert.equal(entity.parts[0].color, '#172033');
});

test('plot catalogs, assignment mode and stamped page setup survive archive reload', async () => {
    const { createLcadDocument, createLcadEnvelope } = await import('./lcadDocument.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const document = { ...createLcadDocument(), content: convertDrawingPlotStyles(fixture(), 'named').content };
    document.layouts[0].plotSettings = normalizeDrawingPlotSettings({ ...applyDrawingDeviceProfile({}, 'pdfRaster'), stamp: { enabled: true, text: '{layout}', sizeMm: 3 } });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.plotStyles, document.content.plotStyles);
    assert.equal(loaded.content.entities[0].plotStyleName, 'Roof');
    assert.equal(loaded.content.settings.plotStyleMode, 'named');
    assert.deepEqual(loaded.layouts[0].plotSettings, document.layouts[0].plotSettings);
});
