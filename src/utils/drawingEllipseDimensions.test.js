import test from 'node:test';
import assert from 'node:assert/strict';
import { getEllipseAxisSegments, nearestEllipseAxis } from './drawingEllipseGeometry.js';
import { createDefaultDrawingContent, createDimensionForEntity } from './drawingDocument.js';
import { createQuickDimensionResult } from './drawingDimensionCommands.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { rotateEntity, transformEntity } from './drawingPrimitives.js';
import { createDrawingClipboardPayload, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const ellipse = { id: 'ellipse', type: 'ellipse', layerId: 'geometry', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0, fullEllipse: true, startAngle: 0, endAngle: 0, counterClockwise: true };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const contentWith = (...entities) => ({ ...createDefaultDrawingContent(), entities });

test('ellipse dimensions choose the axis nearest the picked curve feature', () => {
    assert.deepEqual(getEllipseAxisSegments(ellipse)[0], [{ x: -4, y: 0 }, { x: 4, y: 0 }]);
    assert.equal(nearestEllipseAxis(ellipse, { x: 4, y: 0 }), 0);
    assert.equal(nearestEllipseAxis(ellipse, { x: 0, y: -2 }), 1);
    const content = contentWith(ellipse);
    const major = createDimensionForEntity(content, ellipse, 'auto', { x: 4, y: 0 });
    const minor = createDimensionForEntity(content, ellipse, 'auto', { x: 0, y: 2 });
    assert.equal(major.edgeIndex, 0);
    assert.equal(minor.edgeIndex, 1);
    assert.equal(major.sourceId, ellipse.id);
    near(getDimensionGeometry(major, [ellipse]).value, 8);
    near(getDimensionGeometry(minor, [ellipse]).value, 4);
    assert.equal(createDimensionForEntity(content, ellipse, 'radius'), null, 'an ellipse has no single circular radius');
});

test('axis dimensions remain associated after radius, rotation and affine edits', () => {
    const minor = createDimensionForEntity(contentWith(ellipse), ellipse, 'auto', { x: 0, y: 2 });
    const changed = rotateEntity({ ...ellipse, ry: 3 }, 30, { x: 0, y: 0 });
    near(getDimensionGeometry(minor, [changed]).value, 6);
    const scaled = transformEntity(changed, { scaleX: 2, scaleY: 2 });
    near(getDimensionGeometry(minor, [scaled]).value, 12);
    const geometry = getDimensionGeometry(minor, [changed]);
    near(geometry.sourceSecond.x, -1.5);
    near(geometry.sourceSecond.y, 3 * Math.sqrt(3) / 2);
});

test('linear command candidates support elliptical axes and projection modes', () => {
    const content = contentWith(ellipse);
    const result = createQuickDimensionResult(content, [ellipse.id], { measurementMode: 'aligned', edgeIndex: 1 });
    assert.equal(result.changed, true);
    near(getDimensionGeometry(result.entities[0], [ellipse]).value, 4);
    const rotated = rotateEntity(ellipse, 30, { x: 0, y: 0 });
    const horizontal = createDimensionForEntity(contentWith(rotated), rotated, 'horizontal', { x: 4, y: 2 });
    near(getDimensionGeometry(horizontal, [rotated]).value, 8 * Math.sqrt(3) / 2);
});

test('elliptical-arc axes stay measurable and point references use the same stable features', () => {
    const arc = { ...ellipse, fullEllipse: false, endAngle: Math.PI / 2 };
    const dimension = createDimensionForEntity(contentWith(arc), arc, 'aligned', { x: 0, y: 2 });
    near(getDimensionGeometry(dimension, [arc]).value, 4);
    const referenced = {
        ...dimension, sourceId: undefined,
        sourcePointReferences: [0, 1].map(endpointIndex => ({ sourceId: ellipse.id, sourceType: 'ellipse', edgeIndex: 1, endpointIndex })),
    };
    near(getDimensionGeometry(referenced, [{ ...ellipse, ry: 5 }]).value, 10);
});

test('archive and clipboard preserve elliptical-axis association with remapped IDs', () => {
    const dimension = createDimensionForEntity(contentWith(ellipse), ellipse, 'auto', { x: 0, y: 2 });
    const document = createLcadDocument({ name: 'Ellipse dimensions' });
    document.content = contentWith(ellipse, dimension);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    near(getDimensionGeometry(restored.content.entities[1], restored.content).value, 4);
    const payload = createDrawingClipboardPayload(restored, [dimension.id]);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, payload, { mode: 'original' });
    const pastedDimension = pasted.content.entities.find(entity => entity.type === 'linearDimension');
    const pastedEllipse = pasted.content.entities.find(entity => entity.type === 'ellipse');
    assert.equal(pastedDimension.sourceId, pastedEllipse.id);
    assert.notEqual(pastedEllipse.id, ellipse.id);
    near(getDimensionGeometry(pastedDimension, pasted.content).value, 4);
});

test('nonuniform scale preserves axis identity when radii change order', () => {
    const content = contentWith(ellipse);
    const first = createDimensionForEntity(content, ellipse, 'auto', { x: 4, y: 0 });
    const second = createDimensionForEntity(content, ellipse, 'auto', { x: 0, y: 2 });
    const changed = transformEntity(ellipse, { scaleX: 0.25, scaleY: 2 });
    near(getDimensionGeometry(first, [changed]).value, 2);
    near(getDimensionGeometry(second, [changed]).value, 8);
    near(changed.rotation, 0);
    const turned = rotateEntity(changed, 45, { x: 0, y: 0 });
    near(getDimensionGeometry(first, [turned]).value, 2);
    near(getDimensionGeometry(second, [turned]).value, 8);
});
