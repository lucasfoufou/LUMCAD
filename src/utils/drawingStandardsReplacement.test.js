import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { createDrawingStandards, checkDrawingStandards } from './drawingStandards.js';
import { replaceDrawingStandard } from './drawingStandardsReplacement.js';
import { applyDimensionStyle } from './drawingDimensionStyles.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';

function replace(document, standard, scope, name, target) {
    const report = checkDrawingStandards(document.content, standard);
    return replaceDrawingStandard(document, standard, report, report.issues.findIndex(issue => issue.scope === scope && issue.name === name), target);
}

test('layer replacement reuses merge semantics for objects, viewport hiding and saved filters', () => {
    const document = createLcadDocument();
    const standard = createDrawingStandards(document.content);
    const target = document.content.layers[0];
    document.content.layers.push({ ...target, id: 'legacy', name: 'Legacy' });
    document.content.entities = [{ id: 'line', type: 'line', layerId: 'legacy', x1: 0, y1: 0, x2: 2, y2: 0 }];
    document.content.activeLayerId = 'legacy';
    document.content.selectionFilters = [{ id: 'filter', name: 'Walls', criteria: [{ field: 'LAYER', operator: '=', value: 'Legacy' }] }];
    document.layouts[0].viewports.forEach(viewport => { viewport.hiddenLayerIds = ['legacy']; });
    const before = structuredClone(document);
    const result = replace(document, standard, 'layers', 'Legacy', target.name);
    assert.ok(result.document, JSON.stringify(result));
    assert.equal(result.report.compliant, true);
    assert.equal(result.document.content.entities[0].layerId, target.id);
    assert.equal(result.document.content.entities[0].id, 'line');
    assert.equal(result.document.content.activeLayerId, target.id);
    assert.equal(result.document.content.selectionFilters[0].criteria[0].value, target.id);
    result.document.layouts[0].viewports.forEach(viewport => assert.deepEqual(viewport.hiddenLayerIds, [target.id]));
    assert.deepEqual(document, before);
    document.content.entities[0].locked = true;
    assert.equal(replace(document, standard, 'layers', 'Legacy', target.name).error, 'standardsLocked');
});

test('replacement onto an absent approved definition keeps the local identity and corrects properties', () => {
    const document = createLcadDocument();
    const source = { ...document.content.textStyles[0], id: 'local', name: 'Legacy', fontSize: 3 };
    document.content.textStyles.push(source);
    const reference = structuredClone(document.content);
    reference.textStyles[1] = { ...source, id: 'external', name: 'Approved', fontSize: 0.6 };
    const result = replace(document, createDrawingStandards(reference), 'textStyles', 'Legacy', 'approved');
    assert.ok(result.document, JSON.stringify(result));
    assert.deepEqual(result.document.content.textStyles[1], { ...source, name: 'Approved', fontSize: 0.6 });
    assert.equal(result.report.compliant, true);
});

test('dimension style merging remaps active and entity references while retaining explicit overrides', () => {
    const document = createLcadDocument();
    const target = document.content.dimensionStyles[0];
    const standard = createDrawingStandards(document.content);
    const source = { ...target, id: 'legacy', name: 'Legacy', textSize: 3 };
    document.content.dimensionStyles.push(source);
    document.content.activeDimensionStyleId = source.id;
    document.content.entities = [applyDimensionStyle({ id: 'dimension', type: 'linearDimension', layerId: 'dimensions',
        p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 }, offset: 1, dimensionStyleOverrides: { arrowSize: 0.9 } }, source, { keepOverrides: true })];
    const result = replace(document, standard, 'dimensionStyles', 'Legacy', target.name);
    assert.ok(result.document, JSON.stringify(result));
    assert.equal(result.document.content.activeDimensionStyleId, target.id);
    assert.equal(result.document.content.entities[0].dimensionStyleId, target.id);
    assert.equal(result.document.content.entities[0].textSize, target.textSize);
    assert.equal(result.document.content.entities[0].arrowSize, 0.9);
    document.content.entities[0].locked = true;
    assert.equal(replace(document, standard, 'dimensionStyles', 'Legacy', target.name).error, 'standardsLocked');
});

test('unknown targets and stale issue snapshots reject without mutation', () => {
    const document = createLcadDocument();
    const standard = createDrawingStandards(document.content);
    document.content.layers.push({ ...document.content.layers[0], id: 'legacy', name: 'Legacy' });
    const report = checkDrawingStandards(document.content, standard);
    const before = structuredClone(document);
    assert.equal(replaceDrawingStandard(document, standard, report, 0, 'Unknown').error, 'standardsTarget');
    assert.deepEqual(document, before);
    document.content.layers.at(-1).color = '#ff0000';
    assert.equal(replaceDrawingStandard(document, standard, report, 0, standard.catalogs.layers[0].name).error, 'standardsStale');
});

test('text style merging remaps nested block text and active styles without changing text content', () => {
    const document = createLcadDocument();
    const target = document.content.textStyles[0];
    const standard = createDrawingStandards(document.content);
    document.content.textStyles.push({ ...target, id: 'legacy-text', name: 'Legacy text' });
    document.content.activeTextStyleId = 'legacy-text';
    const text = { ...buildDrawingEntity('text', { x: 0, y: 0 }, { x: 3, y: 1 }, 'geometry', 'label', { options: { text: 'Keep this label' } }), textStyleId: 'legacy-text' };
    const block = createAnonymousDrawingBlock([text], { id: 'labels' });
    document.content.blocks = [block];
    document.content.entities = [createAnonymousDrawingBlockReference(block, { id: 'instance' })];
    const before = structuredClone(document);
    const result = replace(document, standard, 'textStyles', 'Legacy text', target.name);
    assert.ok(result.document, JSON.stringify(result));
    assert.equal(result.document.content.activeTextStyleId, target.id);
    assert.equal(result.document.content.blocks[0].entities[0].textStyleId, target.id);
    assert.equal(result.document.content.blocks[0].entities[0].text, text.text);
    assert.equal(result.document.content.entities[0].id, 'instance');
    assert.deepEqual(document, before);
});

test('named leader, multiline and table presets merge without rewriting independent entity snapshots', () => {
    for (const scope of ['leaderStyles', 'multilineStyles', 'tableStyles']) {
        const document = createLcadDocument();
        if (scope === 'leaderStyles') document.content.leaderStyles = [{ name: 'Approved', textSize: 0.35, arrowSize: 0.2, landingLength: 0.75, arrowType: 'closed' }];
        const target = document.content[scope][0];
        const standard = createDrawingStandards(document.content);
        document.content[scope].push({ ...structuredClone(target), name: 'Legacy' });
        const before = structuredClone(document);
        const result = replace(document, standard, scope, 'Legacy', target.name);
        assert.ok(result.document, JSON.stringify(result));
        assert.equal(result.report.compliant, true);
        assert.deepEqual(result.document.content.entities, before.content.entities);
        assert.deepEqual(document, before);
    }
});
