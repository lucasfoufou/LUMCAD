import { retainDimensionStyleOverrides } from './drawingDimensionStyles.js';
import { runDimensionStyleCommand } from './drawingDimensionStyleCommands.js';
import { applyCurrentStyleToNewDimensions } from './drawingDimensionStyles.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DIMENSION_STYLE_ID, normalizeDimensionStyles, normalizeDimensionStyleValues, applyDimensionStyle, saveDimensionStyle, deleteDimensionStyle } from './drawingDimensionStyles.js';

const dimension = { id: 'dim', type: 'linearDimension', sourceId: 'line', offset: 2 };

test('styles normalize bounded settings and retain a unique protected fallback', () => {
    const styles = normalizeDimensionStyles([{ id: 'custom', name: 'Standard', textSize: Infinity }, { id: 'duplicate', name: 'standard' }, { id: 'custom', name: 'Other' }]);
    assert.equal(styles.length, 2);
    assert.equal(styles[0].id, DEFAULT_DIMENSION_STYLE_ID);
    assert.equal(styles[0].name, 'Standard 2');
    assert.equal(styles[1].textSize, 0.35);
    assert.equal(normalizeDimensionStyleValues({ arrowSize: -1 }).arrowSize, 0);
});

test('applying a style preserves geometry and association while resetting or retaining explicit overrides', () => {
    const style = { id: 'large', textSize: 0.7, arrowType: 'closed', dimensionFormat: { precision: 2 } };
    const applied = applyDimensionStyle({ ...dimension, dimensionStyleOverrides: { textSize: 0.9 } }, style);
    assert.equal(applied.sourceId, 'line'); assert.equal(applied.offset, 2);
    assert.equal(applied.textSize, 0.7); assert.equal(applied.dimensionFormat.precision, 2);
    assert.equal(applyDimensionStyle({ ...applied, dimensionStyleOverrides: { textSize: 0.9 } }, style, { keepOverrides: true }).textSize, 0.9);
    assert.deepEqual(dimension, { id: 'dim', type: 'linearDimension', sourceId: 'line', offset: 2 });
});

test('editing a named style refreshes linked model and nested dimensions but preserves overrides', () => {
    let content = { entities: [], blocks: [], dimensionStyles: [] };
    const created = saveDimensionStyle(content, { id: 'custom', name: 'Architecture', values: { textSize: 0.5 } });
    content = { ...created.content, entities: [applyDimensionStyle(dimension, created.style)], blocks: [{ id: 'block', entities: [{ ...applyDimensionStyle(dimension, created.style), dimensionStyleOverrides: { textSize: 0.8 } }] }] };
    const before = structuredClone(content);
    const result = saveDimensionStyle(content, { id: 'custom', name: 'Architecture', values: { textSize: 0.6 } }).content;
    assert.equal(result.entities[0].textSize, 0.6);
    assert.equal(result.blocks[0].entities[0].textSize, 0.8);
    assert.deepEqual(content, before);
    assert.equal(deleteDimensionStyle(result, 'Architecture').error, 'used');
    assert.equal(deleteDimensionStyle(result, DEFAULT_DIMENSION_STYLE_ID).error, 'active');
    assert.equal(saveDimensionStyle(result, { id: 'new', name: 'architecture' }).error, 'duplicate');
});

test('document normalization and archive round trips preserve styles, active selection and snapshots', () => {
    const content = createDefaultDrawingContent();
    const saved = saveDimensionStyle(content, { id: 'custom', name: 'Plans', values: { textSize: 0.75, arrowType: 'open', dimensionFormat: { precision: 2 } } });
    const document = createLcadDocument();
    document.content = { ...saved.content, activeDimensionStyleId: 'custom', entities: [applyDimensionStyle({ ...dimension, p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 } }, saved.style)] };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.equal(restored.content.activeDimensionStyleId, 'custom');
    assert.equal(restored.content.dimensionStyles.find(style => style.id === 'custom').arrowType, 'open');
    assert.equal(restored.content.entities[0].textSize, 0.75);
    assert.equal(normalizeDrawingContent({ ...content, activeDimensionStyleId: 'missing' }).activeDimensionStyleId, DEFAULT_DIMENSION_STYLE_ID);
});

test('style commands apply atomically and current style seeds new dimensions without altering existing ones', () => {
    let content = createDefaultDrawingContent();
    content.entities = [{ ...dimension, layerId: 'dimensions' }];
    content = runDimensionStyleCommand(content, [], 'SAVE "Plans"').content;
    content = runDimensionStyleCommand(content, [], 'SET "Plans" TEXT 0.8').content;
    content = runDimensionStyleCommand(content, [], 'CURRENT "Plans"').content;
    const added = { ...dimension, id: 'new', layerId: 'dimensions' };
    const seeded = applyCurrentStyleToNewDimensions({ ...content, entities: [...content.entities, added] }, content);
    assert.equal(seeded.entities[1].textSize, 0.8);
    assert.equal(seeded.entities[0].textSize, undefined);
    const applied = runDimensionStyleCommand(content, ['dim'], 'APPLY "Plans"').content;
    assert.equal(applied.entities[0].textSize, 0.8);
    assert.equal(runDimensionStyleCommand(content, ['missing'], 'APPLY "Plans"').error, 'selection');
    assert.equal(runDimensionStyleCommand(content, [], 'SET "Plans" TEXT -1').error, 'syntax');
    assert.equal(runDimensionStyleCommand(content, [], 'DELETE "Plans"').error, 'active');
});

test('manual property edits remain overrides after style updates and rename retains stable IDs', () => {
    let content = createDefaultDrawingContent();
    content = runDimensionStyleCommand(content, [], 'SAVE "Plans"').content;
    content.entities = [{ ...dimension, layerId: 'dimensions' }];
    content = runDimensionStyleCommand(content, ['dim'], 'APPLY "Plans"').content;
    const styleId = content.entities[0].dimensionStyleId;
    content.entities[0] = retainDimensionStyleOverrides({ ...content.entities[0], textSize: 0.9 }, { textSize: 0.9 });
    content = runDimensionStyleCommand(content, [], 'RENAME "Plans" "Building plans"').content;
    content = runDimensionStyleCommand(content, [], 'SET "Building plans" TEXT 0.5').content;
    assert.equal(content.entities[0].textSize, 0.9);
    assert.equal(content.entities[0].dimensionStyleId, styleId);
    assert.equal(content.dimensionStyles.find(style => style.id === styleId).name, 'Building plans');
});

test('style edits refresh cached bounds of nested block definitions and every insertion', async () => {
    const { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, refreshDrawingBlockBounds, getDrawingBlockDefinitionBounds } = await import('./drawingBlocks.js');
    let content = createDefaultDrawingContent();
    const saved = saveDimensionStyle(content, { id: 'plans', name: 'Plans', values: { textSize: 0.2 } });
    const child = createAnonymousDrawingBlock([applyDimensionStyle({ id: 'label', type: 'linearDimension', layerId: 'dimensions',
        p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, offset: 1 }, saved.style)], { id: 'child' });
    const parent = createAnonymousDrawingBlock([createAnonymousDrawingBlockReference(child, { id: 'nested', insertionPoint: { x: 10, y: 20 } })], { id: 'parent' });
    content = refreshDrawingBlockBounds({ ...saved.content, blocks: [child, parent], entities: [createAnonymousDrawingBlockReference(parent, { id: 'model' })] });
    const before = structuredClone(content);
    const result = saveDimensionStyle(content, { id: 'plans', name: 'Plans', values: { textSize: 3, dimensionFormat: { prefix: 'Overall length: ' } } }).content;
    assert.ok(result.blocks[0].bounds.maxX - result.blocks[0].bounds.minX > before.blocks[0].bounds.maxX - before.blocks[0].bounds.minX);
    for (const block of result.blocks) assert.deepEqual(block.bounds, getDrawingBlockDefinitionBounds(block, result.blocks));
    assert.deepEqual(result.blocks[1].entities[0].definitionBounds, result.blocks[0].bounds);
    assert.deepEqual(result.entities[0].definitionBounds, result.blocks[1].bounds);
    assert.deepEqual(content, before);
    assert.equal(result.entities[0].id, 'model');
    assert.equal(result.blocks[1].entities[0].id, 'nested');
});

test('style format commands update tolerances, secondary units and inspection without erasing other format values', () => {
    let content = runDimensionStyleCommand(createDefaultDrawingContent(), [], 'SAVE Plans').content;
    for (const input of ['TOLERANCE deviation', 'TOLUPPER 0.2', 'TOLLOWER 0.1', 'TOLPRECISION 3', 'ALTERNATE ON', 'ALTUNIT in', 'ALTPRECISION 2', 'INSPECTION ON', 'INSPECTLABEL "QC A"', 'INSPECTRATE "25%"']) {
        const result = runDimensionStyleCommand(content, [], `SET Plans ${input}`);
        assert.ok(result.content, input);
        content = result.content;
    }
    const format = content.dimensionStyles.find(style => style.name === 'Plans').dimensionFormat;
    assert.deepEqual(format.tolerance, { mode: 'deviation', upper: 0.2, lower: 0.1, precision: 3 });
    assert.deepEqual(format.alternateUnits, { enabled: true, unit: 'in', precision: 2 });
    assert.deepEqual(format.inspection, { enabled: true, label: 'QC A', rate: '25%' });
    const before = structuredClone(content);
    for (const input of ['TOLERANCE junk', 'TOLUPPER -1', 'TOLLOWER Infinity', 'TOLUPPER 1000001', 'TOLPRECISION 2.5', 'ALTERNATE true', 'ALTUNIT yards', 'ALTPRECISION 9', 'INSPECTION yes', `INSPECTLABEL "${'x'.repeat(257)}"`]) {
        assert.equal(runDimensionStyleCommand(content, [], `SET Plans ${input}`).error, 'syntax', input);
    }
    assert.deepEqual(content, before);
});

test('copying legacy dimensions preserves all appearance defaults despite a different current style', async () => {
    const { copySelectedEntities } = await import('./drawingDocument.js');
    const { remapDrawingEntityDependencies } = await import('./drawingDimensions.js');
    let content = createDefaultDrawingContent();
    content.entities = [{ ...dimension, layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 3, y: 0 }, textSize: 0.4 }];
    content = runDimensionStyleCommand(content, [], 'SAVE Large').content;
    content = runDimensionStyleCommand(content, [], 'SET Large ARROW closed').content;
    content = runDimensionStyleCommand(content, [], 'SET Large GAP 2').content;
    content = runDimensionStyleCommand(content, [], 'SET Large PREFIX "Different: "').content;
    content = runDimensionStyleCommand(content, [], 'CURRENT Large').content;
    const copied = copySelectedEntities(content, ['dim']);
    const committed = applyCurrentStyleToNewDimensions(copied.content, content);
    const copy = committed.entities.at(-1);
    assert.equal(copy.textSize, 0.4);
    assert.equal(copy.arrowType, 'tick');
    assert.equal(copy.extensionGap, 0);
    assert.equal(copy.dimensionFormat.prefix, '');
    assert.equal(copy.dimensionStyleOverrides.arrowType, 'tick');
    const changed = runDimensionStyleCommand(committed, [], 'SET Large ARROW open').content;
    assert.equal(changed.entities.at(-1).arrowType, 'tick');
    const styled = applyDimensionStyle(content.entities[0], content.dimensionStyles.find(style => style.name === 'Large'));
    assert.deepEqual(remapDrawingEntityDependencies(styled, new Map()), styled);
});
