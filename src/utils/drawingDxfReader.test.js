import test from 'node:test';
import assert from 'node:assert/strict';
import { readDrawingDxf } from './drawingDxfReader.js';
import { exportDrawingDxf, importDrawingDxf } from './drawingDxf.js';
import { createDefaultDrawingContent, DEFAULT_DRAWING_COLOR } from './drawingDocument.js';

const dxf = (entities, { header = '', tables = '', blocks = '' } = {}) => [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', header, '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES', tables, '0', 'ENDSEC',
    '0', 'SECTION', '2', 'BLOCKS', blocks, '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES', entities, '0', 'ENDSEC',
    '0', 'EOF', '',
].filter(Boolean).join('\n');
const blank = () => ({ content: createDefaultDrawingContent(), assets: [] });

test('POLYLINE vertices are read until SEQEND and fitted control frames are skipped', () => {
    const vertex = (x, y, flags = 0) => `0\nVERTEX\n8\n0\n10\n${x}\n20\n${y}\n30\n0\n70\n${flags}`;
    const text = dxf([
        '0\nPOLYLINE\n8\nWalls\n66\n1\n70\n5\n10\n0\n20\n0\n30\n0',
        vertex(0, 0, 16), vertex(5, 5, 16), vertex(0, 0, 8), vertex(4, 1, 8), vertex(9, 0, 8),
        '0\nSEQEND\n8\nWalls',
    ].join('\n'));
    const [polyline] = readDrawingDxf(text).entities;
    assert.equal(polyline.closed, true);
    assert.deepEqual(polyline.vertices.map(vertex => [vertex.x, vertex.y]), [[0, 0], [4, 1], [9, 0]]);
    assert.throws(() => readDrawingDxf(text.replace('0\nSEQEND\n8\nWalls\n', '')), /cadInvalid/);
});

test('MTEXT chunks, direction vectors, XDATA and application groups are handled', () => {
    const text = dxf([
        '0\nMTEXT\n5\n2A\n102\n{ACAD_REACTORS\n330\n1F\n102\n}\n8\nNotes\n10\n1\n20\n2\n40\n0.5\n41\n4',
        '3\nFirst part, \n1\nsecond part\n11\n0\n21\n1\n1001\nAPP\n1000\nignored\n1010\n9\n1020\n9',
    ].join('\n'));
    const [mtext] = readDrawingDxf(text).entities;
    assert.equal(mtext.text, 'First part, second part');
    assert.equal(mtext.rotation, 90);
    assert.equal(mtext.layer, 'Notes');
    assert.deepEqual(mtext.position, { x: 1, y: 2, z: 0 });
});

test('embedded objects end the owning record instead of overriding its geometry', () => {
    const text = dxf('0\nMTEXT\n8\n0\n10\n1\n20\n2\n40\n1\n1\nLabel\n101\nEmbedded Object\n10\n99\n20\n99');
    assert.deepEqual(readDrawingDxf(text).entities[0].position, { x: 1, y: 2, z: 0 });
});

test('unsupported records are reported rather than skipped, including inside blocks', () => {
    const parsed = readDrawingDxf(dxf('0\nHATCH\n8\n0', {
        blocks: '0\nBLOCK\n2\n*D1\n70\n1\n10\n0\n20\n0\n0\nSOLID\n8\n0\n0\nENDBLK\n8\n0',
    }));
    assert.deepEqual(parsed.entities, [{ type: 'HATCH', unsupported: true, paperSpace: false }]);
    assert.equal(parsed.blocks.get('*D1').entities[0].type, 'SOLID');
    assert.throws(() => importDrawingDxf(blank(), dxf('0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n0\n0\nHATCH\n8\n0')),
        error => error.message === 'cadUnsupportedObjects' && error.detail === 'HATCH ×1');
});

test('ACI 7 is the default ink in both directions and layer flags round-trip', () => {
    const tables = '0\nTABLE\n2\nLAYER\n0\nLAYER\n2\nInk\n70\n6\n62\n-7\n6\nCONTINUOUS\n0\nENDTAB';
    const imported = importDrawingDxf(blank(), dxf('0\nLINE\n8\nInk\n10\n0\n20\n0\n11\n1\n21\n0', { tables })).content;
    const layer = imported.layers.find(item => item.name === 'Ink');
    assert.equal(layer.color, DEFAULT_DRAWING_COLOR);
    assert.deepEqual([layer.visible, layer.frozen, layer.newViewportFrozen, layer.locked], [false, false, true, true]);
    const exported = readDrawingDxf(exportDrawingDxf(imported).text);
    assert.equal(exported.layers.get('Ink').colorIndex, 7);
    assert.equal(exported.layers.get('Ink').trueColor, null);
    assert.equal(exported.layers.get('Ink').visible, false);
});

test('orphan ENDBLK records written by LibreDWG are tolerated between definitions', () => {
    const blocks = '0\nBLOCK\n2\nPart\n70\n0\n10\n0\n20\n0\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n1\n21\n0\n0\nENDBLK\n8\n0\n0\nENDBLK\n5\n2F';
    const parsed = readDrawingDxf(dxf('0\nINSERT\n8\n0\n2\nPart\n10\n0\n20\n0', { blocks }));
    assert.deepEqual([...parsed.blocks.keys()], ['Part']);
    assert.equal(parsed.blocks.get('Part').entities.length, 1);
});

test('reader refuses malformed numbers, trailing records and oversized input', () => {
    assert.throws(() => readDrawingDxf(dxf('0\nLINE\n8\n0\n10\n\n20\n0\n11\n1\n21\n0')), /cadInvalid/);
    assert.throws(() => readDrawingDxf(`${dxf('')}0\nLINE\n`), /cadInvalid/);
    assert.throws(() => readDrawingDxf('x'.repeat(64 * 1024 * 1024 + 1)), /cadLimit/);
});

const line = (layer, extra = '') => `0\nLINE\n8\n${layer}${extra}\n10\n0\n20\n0\n11\n1\n21\n0`;

test('paper-space objects are ignored and counted instead of refusing the model import', () => {
    const result = importDrawingDxf(blank(), dxf([line('Plan'), '0\nVIEWPORT\n67\n1\n8\n0', line('Sheet', '\n67\n1')].join('\n'), {
        blocks: '0\nBLOCK\n2\n*Paper_Space\n70\n0\n10\n0\n20\n0\n0\nHATCH\n8\n0\n0\nENDBLK\n8\n0',
    }));
    assert.equal(result.content.entities.length, 1);
    assert.equal(result.report.paperSpace, 2);
    assert.equal(result.report.skipped, null);
    assert.equal(result.content.layers.some(layer => layer.name === 'Sheet'), false);
});

test('unsupported model objects are listed in the refusal, and SKIP imports everything else', () => {
    const entities = [line('Plan'), '0\nHATCH\n8\nHatches', '0\nHATCH\n8\nHatches', '0\nDIMENSION\n8\nDims\n2\n*D1',
        line('Raised', '\n39\n2')].join('\n');
    const blocks = '0\nBLOCK\n2\n*D1\n70\n1\n10\n0\n20\n0\n0\nSOLID\n8\n0\n0\nENDBLK\n8\n0';
    const text = dxf(entities, { blocks });
    const original = blank(); const before = structuredClone(original);
    assert.throws(() => importDrawingDxf(original, text),
        error => error.message === 'cadUnsupportedObjects' && error.detail === 'HATCH ×2, DIMENSION ×1, LINE ×1');
    assert.deepEqual(original, before);
    const result = importDrawingDxf(original, text, { skip: true });
    assert.equal(result.content.entities.length, 1);
    assert.equal(result.report.skipped, 'HATCH ×2, DIMENSION ×1, LINE ×1');
    assert.equal(result.report.skippedCount, 4);
    // Dimension geometry blocks are not imported, and left-out objects create no layers.
    assert.equal(result.content.blocks.length, 0);
    assert.deepEqual(result.content.layers.slice(before.content.layers.length).map(layer => layer.name), ['Plan']);
});

test('SKIP keeps block definitions with their supported children and drops unusable inserts', () => {
    const blocks = [
        '0\nBLOCK\n2\nPanel\n70\n0\n10\n0\n20\n0', line('0'), '0\nHATCH\n8\n0', '0\nENDBLK\n8\n0',
        '0\nBLOCK\n2\nUnused\n70\n0\n10\n0\n20\n0', line('0'), '0\nENDBLK\n8\n0',
        '0\nBLOCK\n2\nSite\n70\n4\n1\n/x/site.dwg\n10\n0\n20\n0\n0\nENDBLK\n8\n0',
    ].join('\n');
    const entities = ['0\nINSERT\n8\nRoof\n2\nPanel\n10\n5\n20\n0', '0\nINSERT\n8\nRoof\n2\nSite\n10\n0\n20\n0'].join('\n');
    const result = importDrawingDxf(blank(), dxf(entities, { blocks }), { skip: true });
    assert.deepEqual(result.content.blocks.map(block => [block.name, block.entities.length]), [['Panel', 1], ['Unused', 1]]);
    assert.deepEqual(result.content.entities.map(entity => entity.type), ['blockReference']);
    assert.equal(result.report.skipped, 'HATCH ×1, INSERT ×1');
});
