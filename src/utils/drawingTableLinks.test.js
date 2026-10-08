import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createDrawingTable } from './drawingTableCommands.js';
import { normalizeDrawingTable, normalizeDrawingTableDataLink } from './drawingTables.js';
import { refreshDrawingTableDefinition, updateDrawingTableLinks } from './drawingTableLinks.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const dataLink = { path: '/tmp/source.csv', name: 'source.csv', delimiter: ';' };
const incoming = { cells: [['Name', 'Value'], ['A', '=2+3']], dataLink };

test('linked table refresh retains placement, intersecting cell formatting and dimensions while resizing', () => {
    const source = normalizeDrawingTable({ cells: [[{ value: 'old', style: { color: '#ff0000' } }, '1', 'keep?'], ['x', '2', 'y']],
        style: { fontSize: 0.4, rowHeight: 2, columnWidth: 4 }, rowHeights: [1, 1.5], columnWidths: [2, 3, 5],
        merges: [{ row: 0, column: 0, rows: 1, columns: 2 }, { row: 1, column: 1, rows: 1, columns: 2 }],
        transform: { a: 0, b: 2, c: -1, d: 0, e: 10, f: 20 } });
    const original = structuredClone(source);
    const refreshed = refreshDrawingTableDefinition(source, { ...incoming, cells: [...incoming.cells, ['B', '9']] });
    assert.deepEqual(source, original);
    assert.deepEqual(refreshed.transform, source.transform);
    assert.equal(refreshed.cells[0][0].style.color, '#ff0000');
    assert.equal(refreshed.cells[0][0].value, 'Name');
    assert.deepEqual(refreshed.rowHeights, [1, 1.5, 2]);
    assert.deepEqual(refreshed.columnWidths, [2, 3]);
    assert.deepEqual(refreshed.merges, [source.merges[0]]);
    assert.deepEqual(refreshed.dataLink, dataLink);
});

test('linked table updates are all-or-nothing for missing/locked targets and detach preserves values', () => {
    const first = createDrawingTable(createDefaultDrawingContent(), { cells: [['old']] }, { x: 0, y: 0 });
    const second = createDrawingTable(first.content, { cells: [['second']] }, { x: 20, y: 0 });
    const ids = second.content.entities.map(entity => entity.id);
    const source = second.content;
    const snapshot = structuredClone(source);
    assert.equal(updateDrawingTableLinks(source, [{ id: ids[0], table: incoming }, { id: 'missing', table: incoming }]).error, 'linkSelection');
    const locked = { ...source, entities: source.entities.map((entity, i) => i ? { ...entity, locked: true } : entity) };
    assert.equal(updateDrawingTableLinks(locked, ids.map(id => ({ id, table: incoming }))).error, 'linkSelection');
    assert.equal(updateDrawingTableLinks(source, [{ id: ids[0], table: incoming }, { id: ids[0], table: incoming }]).error, 'linkSelection');
    assert.deepEqual(source, snapshot);
    const updated = updateDrawingTableLinks(source, ids.map(id => ({ id, table: incoming })));
    assert.deepEqual(updated.selectedIds, ids);
    assert.equal(updated.content.entities[0].parts.find(part => part.id.endsWith(':cell:1:1')).text, '5');
    const detached = updateDrawingTableLinks(updated.content, [{ id: ids[0], detach: true }]);
    assert.equal(detached.content.entities[0].table.dataLink, undefined);
    assert.deepEqual(detached.content.entities[0].table.cells, updated.content.entities[0].table.cells);
    assert.deepEqual(detached.content.entities[0].parts, updated.content.entities[0].parts);
    assert.equal(detached.content.entities[1], updated.content.entities[1]);
});

test('CSV link metadata round-trips with cached values without reading an external file', () => {
    const created = createDrawingTable(createDefaultDrawingContent(), incoming, { x: 8, y: 5 });
    const document = { ...createLcadDocument(), content: created.content };
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities[0].table, created.content.entities[0].table);
    assert.deepEqual(normalizeDrawingContent(created.content).entities[0].table.dataLink, dataLink);
    assert.deepEqual(normalizeDrawingTableDataLink({ ...dataLink, path: null }), { ...dataLink, path: null });
    for (const path of ['relative.csv', '../data/values.csv']) {
        assert.deepEqual(normalizeDrawingTableDataLink({ ...dataLink, path }), { ...dataLink, path });
    }
    for (const path of ['https://example.com/remote.csv', 'C:drive-relative.csv', '/tmp/file.json', '/tmp/bad\0.csv']) {
        assert.equal(normalizeDrawingTableDataLink({ ...dataLink, path }), null);
    }
    assert.equal(normalizeDrawingTableDataLink({ ...dataLink, delimiter: '|' }), null);
    assert.deepEqual(normalizeDrawingTable({ ...incoming, dataLink: { path: 'broken' } }).cells, normalizeDrawingTable(incoming).cells);
    assert.equal(normalizeDrawingTable({ ...incoming, dataLink: { path: 'broken' } }).dataLink, undefined);
});

test('linked table clipboard and SVG carry visible values, formatting, formulas and remapped identities', async () => {
    const { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } = await import('./drawingClipboard.js');
    const created = createDrawingTable(createDefaultDrawingContent(), { ...incoming,
        cells: [['Name', 'Value'], ['A', { value: '=2+3', style: { color: '#ff0000', bold: true } }]],
        style: { name: 'Custom', fontSize: 0.5 } }, { x: 8, y: 5 });
    const document = { ...createLcadDocument(), content: created.content };
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, created.selectedIds));
    const visibleSvg = svg.split('</metadata>')[1];
    assert.match(visibleSvg, /<text/);
    assert.match(visibleSvg, />5<\/tspan>/);
    assert.match(visibleSvg, /<tspan fill="#ff0000"[^>]*font-weight="700"/);
    assert.match(visibleSvg, /clip-path="url\(#clipboard-text-/);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    const copied = normalizeDrawingContent(pasted.content).entities[0];
    assert.notEqual(copied.id, created.selectedIds[0]);
    assert.deepEqual(copied.table, document.content.entities[0].table);
    assert.ok(copied.parts.every(part => part.id.startsWith(`${copied.id}:`)));
});
