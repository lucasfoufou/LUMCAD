import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { createDrawingStandards, parseDrawingStandards, checkDrawingStandards } from './drawingStandards.js';

test('standards are portable across IDs and ignore local visibility, locks and catalog order', () => {
    const content = createDefaultDrawingContent();
    const standard = createDrawingStandards(content, 'Office');
    assert.deepEqual(parseDrawingStandards(JSON.stringify(standard)), standard);
    const local = structuredClone(content);
    local.layers.reverse();
    local.layers.forEach((layer, i) => Object.assign(layer, { id: `local-${i}`, name: layer.name.toUpperCase(), locked: true, frozen: true, visible: false }));
    local.textStyles.forEach(style => { style.id += '-local'; });
    assert.equal(checkDrawingStandards(local, standard).compliant, true);
    assert.ok(!JSON.stringify(standard).includes('locked'));
});

test('standards report precise property differences, extra names and missing names without mutation', () => {
    const content = createDefaultDrawingContent();
    const standard = createDrawingStandards(content);
    content.layers[0].color = '#ff0000';
    content.textStyles[0].fontSize = 2;
    const removed = content.layers.pop();
    content.layers.push({ ...removed, id: 'extra', name: 'Unapproved' });
    const snapshot = structuredClone([content, standard]);
    const report = checkDrawingStandards(content, standard);
    assert.equal(report.compliant, false);
    assert.deepEqual(report.issues.find(issue => issue.scope === 'textStyles').fields, ['fontSize']);
    assert.ok(report.issues.some(issue => issue.kind === 'nonstandard' && issue.name === 'Unapproved'));
    assert.ok(report.issues.some(issue => issue.kind === 'missing' && issue.name === removed.name));
    assert.deepEqual([content, standard], snapshot);
});

test('all supported style catalogs round-trip with normalized property diagnostics', () => {
    const content = createDefaultDrawingContent();
    content.leaderStyles = [{ name: 'Leader', textSize: 0.5 }];
    content.multilineStyles = [{ name: 'Walls', elements: [{ offset: -0.2 }, { offset: 0.2 }] }];
    content.tableStyles = [{ name: 'Schedule', fontSize: 0.5 }];
    const standard = createDrawingStandards(content);
    assert.equal(checkDrawingStandards(content, JSON.stringify(standard)).compliant, true);
    content.leaderStyles[0].textSize = 1;
    content.multilineStyles[0].elements[0].offset = -0.3;
    content.tableStyles[0].fontSize = 1;
    assert.deepEqual(checkDrawingStandards(content, standard).issues.map(issue => issue.scope), ['leaderStyles', 'multilineStyles', 'tableStyles']);
});

test('ambiguous names, excessive catalogs and malformed/versioned standards refuse explicitly', () => {
    const content = createDefaultDrawingContent();
    const standard = createDrawingStandards(content);
    content.layers.push({ ...content.layers[0], id: 'duplicate', name: content.layers[0].name.toUpperCase() });
    assert.throws(() => createDrawingStandards(content), /standardsIdentity/);
    assert.throws(() => parseDrawingStandards({ ...standard, version: 2 }), /standardsInvalid/);
    const invalid = structuredClone(standard);
    invalid.catalogs.textStyles[0].values.fontSize = -1;
    assert.throws(() => parseDrawingStandards(invalid), /standardsInvalid/);
    assert.throws(() => createDrawingStandards({ layers: Array(2049).fill({ name: 'Layer' }) }), /standardsLimit/);
    const cycle = {}; cycle.self = cycle;
    assert.throws(() => parseDrawingStandards(cycle), /comparisonInvalid/);
});
