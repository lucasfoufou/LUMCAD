import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createLcadTemplateSession, parseNewDrawingInput, parseTemplateSaveInput, prepareLcadTemplate } from './lcadTemplates.js';

test('template export accepts an optional destination without interpreting invalid syntax', () => {
    assert.deepEqual(parseTemplateSaveInput(''), { path: null });
    assert.deepEqual(parseTemplateSaveInput('TO "/templates/office plan.lcad"'), { path: '/templates/office plan.lcad' });
    for (const input of ['TO', 'TO ""', 'FROM a', 'TO a b', 'TO "unclosed']) assert.equal(parseTemplateSaveInput(input), null);
});

test('NEW distinguishes blank creation, template selection and an explicit quoted source', () => {
    assert.deepEqual(parseNewDrawingInput(''), { template: false, path: null });
    assert.deepEqual(parseNewDrawingInput('template'), { template: true, path: null });
    assert.deepEqual(parseNewDrawingInput('FROM "/templates/office plan.lcad"'), { template: true, path: '/templates/office plan.lcad' });
    for (const input of ['FROM', 'FROM ""', 'FROM "unclosed', 'FROM a b', 'TEMPLATE extra', 'DELETE']) {
        assert.equal(parseNewDrawingInput(input), null);
    }
});

test('new template instances own their document identity while retaining drawing resources and stable internal references', () => {
    const template = createLcadDocument({ name: 'Office template', gridSpacing: 0.25 });
    template.content.entities = [{ id: 'title-line', type: 'line', layerId: '0', x1: 0, y1: 0, x2: 5, y2: 0 }];
    template.createdAt = '2020-01-01T00:00:00.000Z';
    const before = structuredClone(template);
    const first = createLcadTemplateSession(template, { name: 'Project A' });
    const second = createLcadTemplateSession(template, { name: 'Project B' });
    assert.notEqual(first.document.id, template.id);
    assert.notEqual(first.document.id, second.document.id);
    assert.equal(first.document.name, 'Project A');
    assert.notEqual(first.document.createdAt, template.createdAt);
    assert.equal(first.path, null);
    assert.equal(first.recovered, false);
    assert.deepEqual(first.document.content, template.content);
    assert.deepEqual(first.document.layouts, template.layouts);
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(first.document))).document;
    assert.equal(loaded.id, first.document.id);
    assert.deepEqual(loaded.content.entities, first.document.content.entities);
    first.document.content.entities[0].x2 = 12;
    assert.deepEqual(template, before);
    assert.equal(second.document.content.entities[0].x2, 5);
});

test('template references retain their source directory and report unresolved browser-relative locations', () => {
    const template = createLcadDocument();
    template.content.blocks = [{ id: 'xref-cache', name: 'Reference', entities: [], basePoint: { x: 0, y: 0 } }];
    template.content.entities = [{ id: 'xref', type: 'blockReference', layerId: '0', blockId: 'xref-cache',
        x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0,
        externalReference: { version: 1, sourceDocumentId: 'reference-source', path: 'details/reference.lcad', mode: 'overlay', loaded: false } }];
    const native = createLcadTemplateSession(template, { sourcePath: '/templates/office.lcad' });
    assert.equal(native.document.content.entities[0].externalReference.path, '/templates/details/reference.lcad');
    assert.deepEqual(native.unresolvedReferences, []);
    const browser = createLcadTemplateSession(template);
    assert.equal(browser.document.content.entities[0].externalReference.path, 'details/reference.lcad');
    assert.equal(browser.unresolvedReferences.length, 1);
    assert.equal(template.content.entities[0].externalReference.path, 'details/reference.lcad');
    const exported = prepareLcadTemplate(template, '/project/original.lcad');
    const archive = readLcadArchive(createLcadArchive(createLcadEnvelope(exported.document)));
    const instance = createLcadTemplateSession(archive.document, { sourcePath: '/other/template.lcad' });
    assert.equal(instance.document.content.entities[0].externalReference.path, '/project/details/reference.lcad');
    assert.equal(exported.document.id, template.id);
});
