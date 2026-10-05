import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingLayout, createDrawingViewport, viewportModelPointToPaperPoint } from './drawingLayouts.js';
import { exportDrawingLayout } from './drawingLayoutExport.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { getEntityAppearance } from './drawingDocument.js';
import { attachDrawingReference } from './drawingReferences.js';

test('layout export retains native clipped geometry, viewport rotation and paper millimetre-to-metre scale', () => {
    const document = createLcadDocument({ name: 'Plan' });
    document.content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 5, x2: 10, y2: 5 }];
    const viewport = createDrawingViewport({ rect: { x: 20, y: 30, width: 100, height: 100 }, modelViewBox: { x: 0, y: 0, width: 10, height: 10 }, viewRotation: 90 });
    const layout = createDrawingLayout({ name: 'Sheet', format: 'A4', viewports: [viewport], paperEntities: [{ id: 'paper-line', type: 'line', layerId: 'geometry', x1: 10, y1: 10, x2: 20, y2: 10 }] });
    const before = JSON.stringify(document);
    const exported = exportDrawingLayout(document, layout);
    assert.equal(JSON.stringify(document), before);
    assert.equal(exported.content.entities.length, 2);
    const snaps = drawingSnapEntities(exported.content);
    assert.equal(snaps.length, 2);
    const point = viewportModelPointToPaperPoint(viewport, { x: 0, y: 5 });
    assert.ok(Math.hypot(snaps[0].x1 - point.x / 1000, snaps[0].y1 - point.y / 1000) < 1e-9);
    assert.equal(snaps[1].x1, 0.01);
    assert.equal(snaps[1].x2, 0.02);
    assert.ok(exported.content.entities[0].blockClip.enabled);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(exported))).document;
    assert.deepEqual(drawingSnapEntities(restored.content), snaps);
});

test('identically named viewports keep separate layer appearances and annotation representations', () => {
    const document = createLcadDocument();
    document.content.entities = [{ id: 'note', type: 'text', layerId: 'geometry', x: 2, y: 2, width: 3, height: 1, fontSize: 0.3, text: 'Note',
        annotation: { baseScale: 100, scales: [{ scale: 100, offset: { x: 0, y: 0 } }, { scale: 50, offset: { x: 0, y: 0 } }] } }];
    const viewports = [100, 50].map((scale, index) => createDrawingViewport({ name: 'Same', rect: { x: index * 110, y: 0, width: 100, height: 100 },
        modelViewBox: { x: 0, y: 0, width: scale / 10, height: scale / 10 },
        layerOverrides: [{ layerId: 'geometry', color: index ? '#ff0000' : '#0000ff' }],
    }));
    const exported = exportDrawingLayout(document, createDrawingLayout({ format: 'A4', viewports }));
    const roots = exported.content.entities.map(reference => exported.content.blocks.find(block => block.id === reference.blockId).entities[0]);
    assert.deepEqual(roots.map(entity => getEntityAppearance(exported.content, entity).color), ['#0000ff', '#ff0000']);
    assert.deepEqual(roots.map(entity => entity.fontSize), [0.3, 0.15]);
    assert.ok(roots.every(entity => !entity.annotation));
});

test('layout export does not reveal unloaded references or viewport-hidden layers after archive reload', () => {
    const source = createLcadDocument();
    source.content.entities = [{ id: 'source-line', type: 'line', layerId: 'geometry', x1: 1, y1: 1, x2: 2, y2: 1 }];
    const document = attachDrawingReference(createLcadDocument(), source);
    document.content.entities[0].externalReference.loaded = false;
    document.content.layers.push({ id: 'hidden', name: 'Hidden', visible: true, color: '#ff0000', lineWeight: 1, lineType: 'continuous' });
    document.content.entities.push(
        { id: 'hidden-line', type: 'line', layerId: 'hidden', x1: 1, y1: 2, x2: 2, y2: 2 },
        { id: 'visible-line', type: 'line', layerId: 'geometry', x1: 1, y1: 3, x2: 2, y2: 3 },
    );
    const viewport = createDrawingViewport({ rect: { x: 0, y: 0, width: 100, height: 100 },
        modelViewBox: { x: 0, y: 0, width: 10, height: 10 }, hiddenLayerIds: ['hidden'] });
    const exported = exportDrawingLayout(document, createDrawingLayout({ viewports: [viewport] }));
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(exported))).document;
    const snaps = drawingSnapEntities(restored.content);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].y1, 0.03);
    assert.ok(restored.content.blocks.every(block => block.entities.every(entity => !entity.externalReference)));
});
