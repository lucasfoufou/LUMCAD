import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingStandards, checkDrawingStandards } from './drawingStandards.js';
import { repairDrawingStandards } from './drawingStandardsRepair.js';
import { applyDimensionStyle } from './drawingDimensionStyles.js';

function repair(document, standard, predicate = () => true) {
    const report = checkDrawingStandards(document.content, standard);
    return repairDrawingStandards(document, standard, report, report.issues.flatMap((issue, index) => predicate(issue) ? [index] : []));
}

test('accepted standard properties retain IDs, local layer state and unrelated geometry', () => {
    const document = createLcadDocument();
    const standard = createDrawingStandards(document.content);
    document.content.layers[0] = { ...document.content.layers[0], color: '#ff0000', locked: true, visible: false };
    document.content.textStyles[0].fontSize = 2;
    const before = structuredClone(document);
    const result = repair(document, standard);
    assert.ok(result.document, JSON.stringify(result));
    assert.equal(result.report.compliant, true);
    assert.equal(result.document.content.layers[0].id, before.content.layers[0].id);
    assert.equal(result.document.content.layers[0].locked, true);
    assert.equal(result.document.content.layers[0].visible, false);
    assert.deepEqual(result.document.content.entities, before.content.entities);
    assert.deepEqual(document, before);
});

test('missing definitions get independent local IDs and survive archive persistence', () => {
    const document = createLcadDocument();
    const source = structuredClone(document.content);
    source.layers.push({ ...source.layers[0], id: 'external-id', name: 'Required layer' });
    source.textStyles.push({ ...source.textStyles[0], id: 'external-style', name: 'Required style' });
    const standard = createDrawingStandards(source);
    const result = repair(document, standard);
    assert.ok(result.document, JSON.stringify(result));
    assert.equal(result.report.compliant, true);
    assert.notEqual(result.document.content.layers.at(-1).id, 'external-id');
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(result.document))).document;
    assert.equal(checkDrawingStandards(loaded.content, standard).compliant, true);
    assert.equal(loaded.content.layers.at(-1).id, result.document.content.layers.at(-1).id);
});

test('dimension repairs refresh snapshots while keeping explicit entity overrides and refuse locked edits atomically', () => {
    const document = createLcadDocument();
    const style = document.content.dimensionStyles[0];
    const standard = createDrawingStandards(document.content);
    style.textSize = 2;
    document.content.entities = [applyDimensionStyle({ id: 'dim', type: 'linearDimension', layerId: 'dimensions',
        p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 }, offset: 1 }, style)];
    const before = structuredClone(document);
    const result = repair(document, standard);
    assert.ok(result.document, JSON.stringify(result));
    assert.equal(result.document.content.entities[0].textSize, 0.35);
    assert.deepEqual(document, before);
    document.content.entities[0].dimensionStyleOverrides = { textSize: 0.9 };
    assert.equal(repair(document, standard).document.content.entities[0].textSize, 0.9);
    document.content.entities[0].locked = true;
    const refused = repair(document, standard);
    assert.equal(refused.error, 'standardsLocked');
    assert.equal(refused.document, undefined);
    assert.equal(document.content.dimensionStyles[0].textSize, 2);
});

test('stale accepted issues, invalid selections and unspecified replacements cannot partially repair a drawing', () => {
    const document = createLcadDocument();
    const standard = createDrawingStandards(document.content);
    document.content.textStyles[0].fontSize = 2;
    const report = checkDrawingStandards(document.content, standard);
    document.content.textStyles[0].fontSize = 3;
    assert.equal(repairDrawingStandards(document, standard, report, [0]).error, 'standardsStale');
    assert.equal(repairDrawingStandards(document, standard, report, [0, 0]).error, 'standardsSelection');
    document.content.layers.push({ ...document.content.layers[0], id: 'extra', name: 'Extra' });
    assert.equal(repair(document, standard).error, 'standardsReplacementRequired');
    const selected = repair(document, standard, issue => issue.kind === 'properties');
    assert.ok(selected.document);
    assert.equal(selected.report.issues.length, 1);
    assert.equal(selected.report.issues[0].kind, 'nonstandard');
});
