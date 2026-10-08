import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { auditDrawingDocument, repairDrawingDocument } from './drawingAudit.js';
import { salvageDrawingDocument } from './drawingRecovery.js';
const line = id => ({ id, type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 1 });

test('audit reports and repairs dangling/duplicate group members with immutable evidence', () => {
    const document = createLcadDocument();
    document.content.entities = [line('a'), line('b')];
    document.content.groups = [{ id: 'group', name: 'Group', entityIds: ['a', 'lost', 'a', 'b'], selectable: false }];
    const before = structuredClone(document);
    assert.equal(auditDrawingDocument(document).issues[0].code, 'invalidGroup');
    const result = repairDrawingDocument(document);
    assert.equal(result.valid, true);
    assert.deepEqual(result.document.content.groups[0].entityIds, ['a', 'b']);
    assert.equal(result.document.content.groups[0].selectable, false);
    assert.deepEqual(result.repairs[0].previous, document.content.groups[0]);
    assert.deepEqual(result.document.content.entities, document.content.entities);
    assert.deepEqual(document, before);
    assert.equal(repairDrawingDocument(result.document).changed, false);
});

test('group normalization keeps the first eligible identity and records discarded raw catalogs', () => {
    const document = createLcadDocument();
    document.content.entities = [line('a')];
    document.content.groups = [null, { id: 'g', name: 'Same', entityIds: [] }, { id: 'g', name: 'Same', entityIds: ['a'] },
        { id: 'g', name: 'Other', entityIds: ['a'] }, { id: 'h', name: 'same', entityIds: ['a'] }];
    const result = repairDrawingDocument(document);
    assert.equal(result.valid, true);
    assert.deepEqual(result.document.content.groups, [{ id: 'g', name: 'Same', entityIds: ['a'], selectable: true }]);
    assert.equal(result.repairs.length, 4);
});

test('salvage repairs membership again after quarantining corrupt geometry and bounds member traversal', () => {
    const document = createLcadDocument();
    document.content.entities = [line('good'), { ...line('bad'), x2: NaN }];
    document.content.groups = [{ id: 'g', name: 'Keep', entityIds: ['good', 'bad'] }, { id: 'lost', name: 'Lost', entityIds: ['bad'] }];
    const result = salvageDrawingDocument(document);
    assert.equal(result.report.valid, true);
    assert.deepEqual(result.document.content.groups, [{ id: 'g', name: 'Keep', entityIds: ['good'], selectable: true }]);
    assert.equal(result.report.repairs.filter(item => item.code === 'repairedGroup').length, 2);
    assert.equal(result.report.quarantine.length, 1);
    document.content.groups[0].entityIds = Array(100).fill('good');
    assert.deepEqual(auditDrawingDocument(document, { maxObjects: 20 }), { error: 'limit' });
});
