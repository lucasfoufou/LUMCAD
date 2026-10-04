import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { getDimensionGeometry, normalizeDrawingDimension } from './drawingDimensions.js';
import { presentDrawingDimension, drawingDimensionTextPoints } from './drawingDimensionPresentation.js';
import { translateEntity, rotateEntity, scaleEntity, mirrorEntity } from './drawingPrimitives.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { applyDimensionStyle, saveDimensionStyle } from './drawingDimensionStyles.js';
import { maintainDrawingDimensions, beginDimensionTextPlacement, placeDimensionTextAtPoint } from './drawingDimensionMaintenance.js';

function fixture() {
    const saved = saveDimensionStyle(createDefaultDrawingContent(), { id: 'plans', name: 'Plans', values: { textSize: 0.6 } });
    return { ...saved.content, activeDimensionStyleId: 'plans', entities: [applyDimensionStyle({ id: 'dim', type: 'linearDimension', layerId: 'dimensions', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 }, offset: 1 }, saved.style)] };
}

test('update clears overrides while regeneration preserves them and resolves the linked style', () => {
    const content = fixture();
    content.entities[0] = { ...content.entities[0], textSize: 0.9, dimensionStyleOverrides: { textSize: 0.9 } };
    const before = structuredClone(content);
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'update').content.entities[0].textSize, 0.6);
    assert.equal(maintainDrawingDimensions(content, [], 'regenerate').content.entities[0].textSize, 0.9);
    assert.deepEqual(content, before);
});

test('inspection is a persistent format override with explicit on/off semantics', () => {
    const content = fixture();
    const result = maintainDrawingDimensions(content, ['dim'], 'inspect', 'ON "Control" "100%"').content;
    assert.deepEqual(result.entities[0].dimensionFormat.inspection, { enabled: true, label: 'Control', rate: '100%' });
    assert.deepEqual(result.entities[0].dimensionStyleOverrides.dimensionFormat.inspection, result.entities[0].dimensionFormat.inspection);
    const disabled = maintainDrawingDimensions(result, ['dim'], 'inspect', 'OFF').content.entities[0];
    assert.equal(disabled.dimensionFormat.inspection.enabled, false);
    assert.equal(disabled.dimensionFormat.inspection.label, 'Control');
});

test('invalid selections, locked dimensions, missing styles and invalid geometry fail atomically', () => {
    const content = fixture();
    assert.equal(maintainDrawingDimensions(content, ['missing'], 'update').error, 'selection');
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'update', 'Missing').error, 'style');
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'inspect', 'OFF extra').error, 'syntax');
    content.entities[0].locked = true;
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'update').error, 'selection');
    delete content.entities[0].locked;
    content.entities[0].p2 = content.entities[0].p1;
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'update').error, 'geometry');
});

test('label edits preserve geometry and support dynamic measurement placeholders and reset', () => {
    const content = fixture();
    const before = structuredClone(content);
    const edited = maintainDrawingDimensions(content, ['dim'], 'editText', 'NEW "Clearance: <>"').content.entities[0];
    assert.equal(edited.dimensionTextOverride, 'Clearance: <>');
    assert.deepEqual(edited.p1, content.entities[0].p1);
    const restored = maintainDrawingDimensions({ ...content, entities: [edited] }, ['dim'], 'editText', 'HOME').content.entities[0];
    assert.equal(restored.dimensionTextOverride, undefined);
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'editText', 'NEW').error, 'syntax');
    assert.deepEqual(content, before);
});


test('text placement changes presentation alone, follows transformations and resets independently of content', () => {
    const content = fixture();
    const original = getDimensionGeometry(content.entities[0]);
    const placed = maintainDrawingDimensions(content, ['dim'], 'placeText', 'POSITION 12 8').content;
    const turned = maintainDrawingDimensions(placed, ['dim'], 'placeText', 'ANGLE 45').content;
    const entity = turned.entities[0];
    assert.deepEqual(getDimensionGeometry(entity), original);
    assert.deepEqual(presentDrawingDimension(original, entity).label.point, { x: 12, y: 8 });
    assert.equal(presentDrawingDimension(original, entity).label.angle, Math.PI / 4);
    assert.equal(drawingDimensionTextPoints(presentDrawingDimension(original, entity), entity).length, 4);
    assert.deepEqual(translateEntity(entity, 2, 3).dimensionTextPosition, { x: 14, y: 11 });
    const rotated = rotateEntity(entity, 90, { x: 0, y: 0 });
    assert.ok(Math.abs(rotated.dimensionTextPosition.x + 8) < 1e-9);
    assert.ok(Math.abs(rotated.dimensionTextAngle - Math.PI * 3 / 4) < 1e-9);
    assert.deepEqual(scaleEntity(entity, 2).dimensionTextPosition, { x: 24, y: 16 });
    assert.equal(mirrorEntity(entity, { x: 0, y: 0 }, { x: 1, y: 0 }).dimensionTextPosition.y, -8);
    assert.deepEqual(normalizeDrawingDimension(entity).dimensionTextPosition, entity.dimensionTextPosition);
    const reset = maintainDrawingDimensions(turned, ['dim'], 'placeText', 'HOME').content.entities[0];
    assert.equal(reset.dimensionTextPosition, undefined);
    assert.equal(reset.dimensionTextAngle, undefined);
    for (const input of ['POSITION 1', 'POSITION 1 Infinity', 'ANGLE nope', 'HOME extra']) {
        assert.equal(maintainDrawingDimensions(content, ['dim'], 'placeText', input).error, 'syntax');
    }
});

test('oblique extensions intersect the dimension line without changing projected measurement', () => {
    const content = fixture();
    const changed = maintainDrawingDimensions(content, ['dim'], 'editText', 'OBLIQUE 45').content;
    const entity = changed.entities[0];
    const geometry = getDimensionGeometry(entity);
    assert.equal(geometry.value, 5);
    assert.ok(Math.abs(geometry.first.x - 1) < 1e-9);
    assert.ok(Math.abs(geometry.second.x - 6) < 1e-9);
    assert.equal(geometry.first.y, 1);
    assert.deepEqual(geometry.sourceFirst, { x: 0, y: 0 });
    assert.equal(maintainDrawingDimensions(content, ['dim'], 'editText', 'OBLIQUE 0').error, 'obliqueGeometry');
    const restored = maintainDrawingDimensions(changed, ['dim'], 'editText', 'OBLIQUE AUTO').content.entities[0];
    assert.deepEqual(getDimensionGeometry(restored), getDimensionGeometry(content.entities[0]));
    const rotated = rotateEntity(entity, 90, { x: 0, y: 0 });
    assert.ok(Math.abs(rotated.dimensionExtensionAngle - Math.PI * 3 / 4) < 1e-9);
    assert.equal(mirrorEntity(entity, { x: 0, y: 0 }, { x: 1, y: 0 }).dimensionExtensionAngle, -Math.PI / 4);
    const text = maintainDrawingDimensions(changed, ['dim'], 'editText', 'ROTATE 30').content.entities[0];
    assert.equal(text.dimensionTextAngle, Math.PI / 6);
    assert.equal(text.dimensionExtensionAngle, Math.PI / 4);
});


test('dimension extension and label angles survive archive normalization', () => {
    const content = fixture();
    content.entities[0] = { ...content.entities[0], dimensionAutoBreak: { gap: 0.3, sourceIds: ['crossing'] }, dimensionBreaks: [{ kind: 'line', index: 2, start: 0.2, end: 0.4 }], dimensionExtensionAngle: 0.8, dimensionTextAngle: 0.5, dimensionTextPosition: { x: 3, y: 4 } };
    const document = { ...createLcadDocument(), content };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities[0].dimensionAutoBreak, content.entities[0].dimensionAutoBreak);
    assert.deepEqual(restored.content.entities[0].dimensionBreaks, content.entities[0].dimensionBreaks);
    assert.equal(restored.content.entities[0].dimensionExtensionAngle, 0.8);
    assert.equal(restored.content.entities[0].dimensionTextAngle, 0.5);
    assert.deepEqual(restored.content.entities[0].dimensionTextPosition, { x: 3, y: 4 });
});


test('interactive text placement shares preview and commit and leaves its input untouched', () => {
    const content = fixture(); const before = structuredClone(content);
    const { operation } = beginDimensionTextPlacement(content, ['dim']);
    assert.equal(operation.stage, 'position');
    assert.deepEqual(operation.basePoint, getDimensionGeometry(content.entities[0]).label.point);
    const preview = placeDimensionTextAtPoint(content, operation, { x: 8, y: 5 });
    assert.deepEqual(preview.content.entities[0].dimensionTextPosition, { x: 8, y: 5 });
    assert.deepEqual(content, before);
    assert.deepEqual(placeDimensionTextAtPoint(content, operation, { x: 8, y: 5 }), preview);
    assert.equal(beginDimensionTextPlacement(content, []).error, 'selection');
    assert.equal(placeDimensionTextAtPoint(content, operation, { x: Infinity, y: 0 }).error, 'geometry');
    content.entities[0].locked = true;
    assert.equal(placeDimensionTextAtPoint(content, operation, { x: 8, y: 5 }).error, 'selection');
});
