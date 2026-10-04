import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { maintainDrawingCenters } from './drawingCenterMaintenance.js';
import { pickDimensionReassociationSource } from './drawingDimensionAssociations.js';

function fixture() {
    return { ...createDefaultDrawingContent(), entities: [
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 2, cy: 3, r: 4 },
        { id: 'other', type: 'circle', layerId: 'geometry', cx: 20, cy: 30, r: 2 },
        { id: 'center', type: 'centerMark', layerId: 'dimensions', sourceId: 'circle', size: 2, extension: 1 },
    ] };
}

test('centre commands detach and reassociate while retaining IDs and geometry', () => {
    const content = fixture();
    const before = structuredClone(content);
    const detached = maintainDrawingCenters(content, ['center'], 'centerDisassociate').content;
    assert.equal(detached.entities[2].sourceId, undefined);
    assert.deepEqual(getDimensionGeometry(detached.entities[2]).center, { x: 2, y: 3 });
    const result = maintainDrawingCenters(detached, ['center'], 'centerReassociate', 'other').content;
    assert.equal(result.entities[2].id, 'center');
    assert.equal(result.entities[2].size, 2);
    assert.deepEqual(getDimensionGeometry(result.entities[2], result.entities).center, { x: 20, y: 30 });
    assert.deepEqual(content, before);
});

test('centre reset restores default dimensions and the current style while preserving source links', () => {
    const content = fixture();
    content.entities[2].dimensionStyleOverrides = { textSize: 8 };
    const result = maintainDrawingCenters(content, ['center'], 'centerReset').content;
    assert.equal(result.entities[2].size, 0.25);
    assert.equal(result.entities[2].extension, 0);
    assert.equal(result.entities[2].sourceId, 'circle');
    assert.deepEqual(result.entities[2].dimensionStyleOverrides, {});
    assert.equal(result.entities[0], content.entities[0]);
});

test('interactive centre reassociation uses the shared source picker; invalid selections are atomic', () => {
    const content = fixture();
    const operation = maintainDrawingCenters(content, ['center'], 'centerReassociate').operation;
    assert.equal(pickDimensionReassociationSource(content, operation, 'other').content.entities[2].sourceId, 'other');
    assert.equal(maintainDrawingCenters(content, ['center', 'circle'], 'centerReset').error, 'selection');
    assert.equal(maintainDrawingCenters(content, ['center'], 'centerReset', 'junk').error, 'syntax');
    assert.equal(maintainDrawingCenters(content, ['center'], 'centerReassociate', 'missing').error, 'geometry');
    content.entities[2].locked = true;
    assert.equal(maintainDrawingCenters(content, ['center'], 'centerDisassociate').error, 'selection');
});
