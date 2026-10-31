import test from 'node:test';
import assert from 'node:assert/strict';
import { importDrawingDxf, decodeDrawingDxf, exportDrawingDxf } from './drawingDxf.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { readDrawingDxf } from './drawingDxfReader.js';
import { getDrawingTextLayout } from './drawingText.js';
import { transformAffinePoint } from './drawingAffine.js';
import { materializeDrawingBlockReference } from './drawingBlocks.js';
import { importDxfSpline } from './drawingDxfSpline.js';
import { curvePointAt } from './drawingCurveKernel.js';
import { isDrawingWipeout } from './drawingWipeout.js';

const blank = () => ({ content: createDefaultDrawingContent(), assets: [] });
const dxf = (entities, blocks = '', header = '') => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n${header}0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const line = '0\nLINE\n8\n0\n10\n0\n20\n0\n11\n2\n21\n0\n';
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const imported = text => importDrawingDxf(blank(), text);

test('WCS ellipse axes preserve negative normals and inclined arc positions', () => {
    for (const normal of [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0.6, z: 0.8 }]) {
        const source = `0\nELLIPSE\n10\n10\n20\n20\n11\n4\n21\n0\n40\n0.5\n41\n0\n42\n${Math.PI}\n210\n${normal.x}\n220\n${normal.y}\n230\n${normal.z}\n`;
        const result = imported(dxf(source));
        const ellipse = result.content.entities[0];
        for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
            const actual = curvePointAt(ellipse, fraction);
            near(actual.x, 10 + 4 * Math.cos(fraction * Math.PI));
            near(actual.y, -20 - 2 * normal.z * Math.sin(fraction * Math.PI));
        }
        assert.equal(result.report.warnings.includes('elevation'), normal.y !== 0);
    }
    // Major axis (3,0,4), normal (-.8,0,.6): minor axis (0,2.5,0).
    const tilted = imported(dxf('0\nELLIPSE\n10\n0\n20\n0\n11\n3\n21\n0\n31\n4\n40\n0.5\n210\n-0.8\n220\n0\n230\n0.6\n')).content.entities[0];
    near(tilted.rx, 3); near(tilted.ry, 2.5);
});

test('WIPEOUT asymmetric image coordinates become native masks in model metres', () => {
    // WCS = origin + u*(x+.5) + v*(.5-y), independently checked with ezdxf.
    const source = '0\nWIPEOUT\n10\n10\n20\n20\n11\n4\n21\n1\n12\n-1\n22\n3\n13\n1\n23\n1\n71\n2\n14\n-0.5\n24\n-0.5\n14\n0.5\n24\n-0.5\n14\n0.25\n24\n0.5\n';
    const content = normalizeDrawingContent(imported(dxf(source)).content);
    const mask = content.entities[0];
    assert.ok(isDrawingWipeout(mask));
    assert.equal(mask.wipeout.frame, false);
    assert.deepEqual(mask.points, [{ x: 9, y: -23 }, { x: 13, y: -24 }, { x: 13, y: -20.75 }]);
    assert.throws(() => exportDrawingDxf(content), error => error.message === 'cadUnsupported' && error.detail === 'wipeout');
});

test('MTEXT preserves its WCS anchor and projected glyph direction for nondefault normals', () => {
    for (const [normal, direction, expected] of [
        [[0, 0, -1], [1, 0, 0], [1, 0, 0, -1]],
        [[0, 0.6, 0.8], [1, 0, 0], [1, 0, 0, 0.8]],
        [[-0.8, 0, 0.6], [0.6, 0, 0.8], [0.6, 0, 0, 1]],
    ]) {
        const source = `0\nMTEXT\n10\n10\n20\n20\n40\n1\n41\n15\n71\n1\n1\nLabel\n11\n${direction[0]}\n21\n${direction[1]}\n31\n${direction[2]}\n210\n${normal[0]}\n220\n${normal[1]}\n230\n${normal[2]}\n`;
        const entity = imported(dxf(source)).content.entities[0];
        const layout = getDrawingTextLayout(entity);
        const anchor = transformAffinePoint({ x: layout.textX, y: layout.blockTop }, entity.affineFrame);
        near(anchor.x, 10); near(anchor.y, -20);
        ['a', 'b', 'c', 'd'].forEach((key, index) => near(entity.affineFrame[key], expected[index]));
    }
});

test('zero MTEXT direction from LibreDWG uses the rotation fallback with a warning', () => {
    const result = imported(dxf('0\nMTEXT\n10\n10\n20\n20\n40\n1\n11\n0\n21\n0\n31\n0\n1\nLabel\n'));
    assert.ok(result.report.warnings.includes('textFormatting'));
    near(result.content.entities[0].affineFrame.a, 1);
});

test('MTEXT rotation-only fallback uses OCS axes while absent orientation keeps the WCS default', () => {
    const sine = 0.5; const cosine = Math.sqrt(3) / 2;
    // Independently checked against ezdxf MTEXT.ucs(), including the distinction
    // between an explicit zero rotation and no rotation/direction groups at all.
    for (const [normal, rotation, direction, expected] of [
        [[0, 0, -1], 0, '', [-1, 0, 0, 1]],
        [[0.6, 0, 0.8], 0, '', [0, -1, 0.8, 0]],
        [[0.6, 0, 0.8], 30, '', [-0.8 * sine, -cosine, 0.8 * cosine, -sine]],
        [[0, 0, -1], null, '', [1, 0, 0, -1]],
        [[0.6, 0, 0.8], null, '', [1, 0, 0, 1]],
        [[0, 0, -1], 30, '11\n1\n21\n0\n31\n0\n', [1, 0, 0, -1]],
        [[0, 0, 1], 30, '11\n0\n21\n0\n31\n0\n', [cosine, -sine, sine, cosine]],
    ]) {
        const source = `0\nMTEXT\n10\n10\n20\n20\n40\n1\n41\n15\n1\nLabel\n210\n${normal[0]}\n220\n${normal[1]}\n230\n${normal[2]}\n${rotation === null ? '' : `50\n${rotation}\n`}${direction}`;
        const entity = imported(dxf(source)).content.entities[0];
        const layout = getDrawingTextLayout(entity);
        const anchor = transformAffinePoint({ x: layout.textX, y: layout.blockTop }, entity.affineFrame);
        near(anchor.x, 10); near(anchor.y, -20);
        ['a', 'b', 'c', 'd'].forEach((key, index) => near(entity.affineFrame[key], expected[index]));
    }
});

test('tiny relative and absolute MTEXT run heights survive document normalization', () => {
    for (const [headerUnit, base, formatting] of [[6, 0.2, '0.01x'], [4, 200, '2']]) {
        const source = dxf(`0\nMTEXT\n10\n10\n20\n20\n40\n${base}\n41\n10000\n1\nA{\\H${formatting};B}\n`).replace('$INSUNITS\n70\n6', `$INSUNITS\n70\n${headerUnit}`);
        const entity = normalizeDrawingContent(imported(source).content).entities[0];
        const run = entity.runs.find(run => run.text === 'B');
        const scale = Math.hypot(entity.affineFrame.c, entity.affineFrame.d);
        near(entity.fontSize * scale, 0.2); near(run.marks.fontSize * scale, 0.002);
    }
});

test('Fit and Aligned text starts at the first point and reaches the second point', () => {
    for (const type of ['TEXT', 'ATTRIB', 'ATTDEF']) for (const alignment of [3, 5]) {
        const source = `0\n${type}\n70\n2\n10\n2\n20\n3\n11\n8\n21\n11\n40\n1\n72\n${alignment}\n1\nFit\n`;
        const entity = imported(dxf(source)).content.entities[0];
        const layout = getDrawingTextLayout(entity);
        const anchor = transformAffinePoint({ x: layout.textX, y: layout.firstBaseline }, entity.affineFrame);
        const end = transformAffinePoint({ x: layout.textX + layout.styledLines[0].width, y: layout.firstBaseline }, entity.affineFrame);
        near(anchor.x, 2); near(anchor.y, -3); near(end.x, 8); near(end.y, -11);
        if (alignment === 5) near(Math.hypot(entity.affineFrame.c, entity.affineFrame.d), 1);
    }
});

test('simple imported TEXT and MTEXT can export again with physical placement and height', () => {
    for (const type of ['TEXT', 'MTEXT']) for (const height of [0.2, 0.002]) {
        const source = `0\n${type}\n10\n10\n20\n20\n40\n${height}\n41\n${type === 'TEXT' ? 1 : 15}\n50\n30\n1\nLabel\n`;
        const original = imported(dxf(source)).content;
        const record = readDrawingDxf(exportDrawingDxf(original).text).entities[0];
        near(record.position.x, 10); near(record.position.y, 20); near(record.height, height); near(record.rotation, 30);
        const restored = imported(exportDrawingDxf(original).bytes).content.entities[0];
        const layout = getDrawingTextLayout(restored);
        const anchor = transformAffinePoint({ x: layout.textX, y: type === 'TEXT' ? layout.firstBaseline : layout.blockTop }, restored.affineFrame);
        near(anchor.x, 10); near(anchor.y, -20);
    }
});

test('sub-centimetre DWG text retains its physical height through normalization and scaled blocks', () => {
    const block = '0\nBLOCK\n2\nSmall labels\n10\n0\n20\n0\n0\nMTEXT\n10\n0\n20\n0\n40\n5\n41\n100\n1\nØ200\n0\nENDBLK\n';
    const result = imported(dxf('0\nINSERT\n2\nSmall labels\n10\n0\n20\n0\n41\n10\n42\n10\n', block).replace('$INSUNITS\n70\n6', '$INSUNITS\n70\n4'));
    const content = normalizeDrawingContent(result.content);
    const text = content.blocks[0].entities[0];
    near(text.fontSize * Math.hypot(text.affineFrame.c, text.affineFrame.d), 0.005);
    const expanded = materializeDrawingBlockReference(content.entities[0], content.blocks);
    near(expanded[0].fontSize * Math.hypot(expanded[0].affineFrame.c, expanded[0].affineFrame.d), 0.05);
    assert.throws(() => imported(dxf('0\nTEXT\n10\n0\n20\n0\n40\n0.00000001\n1\nTiny\n')), /cadUnsupportedObjects/);
});

test('redraw tables place fills behind linework in model space and nested definitions', () => {
    const record = (handle, owner) => line.replace('0\nLINE\n', `0\nLINE\n5\n${handle}\n330\n${owner}\n`);
    const fill = '0\nSOLID\n5\n20\n330\nA0\n10\n0\n20\n0\n11\n2\n21\n0\n12\n0\n22\n2\n13\n2\n23\n2\n';
    const blocks = `0\nBLOCK\n2\nOrdered\n330\nB0\n10\n0\n20\n0\n${record('30', 'B0')}${record('31', 'B0')}0\nENDBLK\n`;
    const table = (owner, pairs) => `0\nSORTENTSTABLE\n5\nFE\n330\nFF\n100\nAcDbSortentsTable\n330\n${owner}\n${pairs}`;
    const indirect = table('B0', '331\n31\n5\n2\n').replace('AcDbSortentsTable\n330\nB0\n', 'AcDbSortentsTable\n');
    const dictionary = '0\nDICTIONARY\n5\nFF\n330\nB0\n100\nAcDbDictionary\n3\nACAD_SORTENTS\n360\nFE\n';
    const objects = `0\nSECTION\n2\nOBJECTS\n${table('A0', '331\n20\n5\n1\n331\n10\n5\n0\n')}${indirect}${dictionary}0\nSORTENTSTABLE\n100\nAcDbSortentsTable\n0\nENDSEC\n`;
    const data = dxf(record('10', 'A0') + fill + '0\nINSERT\n5\n21\n330\nA0\n2\nOrdered\n10\n0\n20\n0\n', blocks).replace('0\nEOF\n', `${objects}0\nEOF\n`);
    const parsed = readDrawingDxf(data);
    assert.deepEqual(parsed.entities.map(entity => entity.handle), ['20', '21', '10']);
    assert.deepEqual(parsed.blocks.get('Ordered').entities.map(entity => entity.handle), ['31', '30']);
    const result = imported(data);
    assert.deepEqual(result.content.entities.map(entity => entity.type), ['hatch', 'blockReference', 'line']);
});

test('mixed LibreDWG legacy text is recovered without corrupting valid UTF-8', () => {
    const text = dxf('0\nMTEXT\n10\n1\n20\n2\n40\n0.2\n1\nCafé\n0\nMTEXT\n10\n3\n20\n4\n40\n0.2\n1\nEt@\n', '', '9\n$ACADVER\n1\nAC1032\n9\n$DWGCODEPAGE\n3\nANSI_1252\n');
    const bytes = new TextEncoder().encode(text); bytes[bytes.indexOf(64)] = 0xe9;
    const result = importDrawingDxf(blank(), bytes);
    assert.deepEqual(result.content.entities.map(e => e.text), ['Café', 'Eté']);
    assert.ok(result.report.warnings.includes('encoding'));
    const invalid = new TextEncoder().encode(text.replace('ANSI_1252', 'ANSI_9999')); invalid[invalid.indexOf(64)] = 0xe9;
    assert.throws(() => decodeDrawingDxf(invalid), /cadEncoding/);
});

test('large non-graphical DXF sections are streamed rather than rejected at two million lines', () => {
    const text = dxf(line).replace('0\nEOF\n', `0\nSECTION\n2\nOBJECTS\n0\nXRECORD\n${'1\nx\n'.repeat(1_000_010)}0\nENDSEC\n0\nEOF\n`);
    assert.equal(readDrawingDxf(text).entities.length, 1);
});

test('dimensions import cached graphics and unreachable definitions cannot block model import', () => {
    const blocks = `0\nBLOCK\n2\n*D1\n10\n0\n20\n0\n${line}0\nENDBLK\n0\nBLOCK\n2\nUnused\n10\n0\n20\n0\n0\nIMAGE\n8\n0\n0\nENDBLK\n`;
    const result = imported(dxf('0\nDIMENSION\n2\n*D1\n10\n100\n20\n200\n', blocks));
    assert.equal(result.content.blocks.length, 1);
    const [geometry] = materializeDrawingBlockReference(result.content.entities[0], result.content.blocks);
    assert.deepEqual([geometry.x1, geometry.y1, geometry.x2, geometry.y2], [0, 0, 2, 0]);
    assert.ok(result.report.warnings.includes('dimensionGraphics'));
});

test('hidden objects and variable ATTDEFs are not rendered, while instance ATTRIB text is kept', () => {
    const result = imported(dxf(`${line}0\nLINE\n60\n1\n10\n0\n20\n0\n11\n8\n21\n0\n0\nATTDEF\n70\n0\n10\n1\n20\n1\n40\n1\n1\nDEFAULT\n0\nATTRIB\n70\n0\n10\n2\n20\n3\n40\n1\n1\nACTUAL\n`));
    assert.equal(result.report.hidden, 2);
    assert.equal(result.content.entities.length, 2);
    assert.equal(result.content.entities[1].text, 'ACTUAL');
});

test('scoped MTEXT styles and escaped literals become native rich text with the correct anchor', () => {
    const result = imported(dxf('0\nMTEXT\n10\n10\n20\n20\n40\n1\n41\n15\n71\n5\n1\nA{\\fArial|b1|i1;B}\\P\\{C\\} %%d\\~\\U+00E9\n'));
    const text = result.content.entities[0];
    assert.equal(text.text, 'AB\n{C} °\u00a0é');
    assert.ok(text.runs.some(run => run.text === 'B' && run.marks.bold && run.marks.italic));
    const layout = getDrawingTextLayout(text);
    const anchor = transformAffinePoint({ x: layout.textX, y: layout.blockTop + layout.blockHeight / 2 }, text.affineFrame);
    near(anchor.x, 10); near(anchor.y, -20);
});

test('two-vertex circular width polylines retain an exact disc even with rounded source coordinates', () => {
    const result = imported(dxf('0\nLWPOLYLINE\n70\n1\n43\n40\n10\n0\n20\n0\n42\n1\n10\n39.9999991\n20\n0\n42\n1\n'));
    const disc = result.content.entities[0];
    assert.equal(disc.linework.kind, 'donut');
    assert.equal(disc.linework.innerDiameter, 0);
    near(disc.linework.outerDiameter, 79.9999991);
    assert.equal(disc.boundaries.length, 1);
});

test('hatch islands, full circles and implicit closing edges survive normalization', () => {
    const source = '0\nHATCH\n70\n1\n91\n2\n92\n2\n72\n0\n73\n1\n93\n4\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n10\n0\n20\n10\n97\n0\n92\n0\n93\n1\n72\n2\n10\n5\n20\n5\n40\n2\n50\n0\n51\n360\n73\n1\n97\n0\n';
    const hatch = imported(dxf(source)).content.entities[0];
    assert.equal(hatch.boundaries.length, 2);
    assert.equal(hatch.boundaries[0].parts.length, 4);
    near(hatch.boundaries[1].parts[0].r ?? hatch.boundaries[1].parts[0].rx, 2);
    const open = imported(dxf('0\nHATCH\n70\n1\n91\n1\n92\n0\n93\n2\n72\n1\n10\n0\n20\n0\n11\n2\n21\n0\n72\n1\n10\n2\n20\n0\n11\n0\n21\n2\n97\n0\n'));
    assert.equal(open.content.entities[0].boundaries[0].parts.length, 3);
    assert.ok(open.report.warnings.includes('hatchBoundary'));
});

test('inclined OCS circles project to exact ellipses and mirrored OCS reflects placement', () => {
    const tilted = imported(dxf('0\nCIRCLE\n10\n0\n20\n0\n30\n10\n40\n4\n210\n0\n220\n0.6\n230\n0.8\n'));
    const e = tilted.content.entities[0];
    assert.equal(e.type, 'ellipse'); near(e.rx, 4); near(e.ry, 3.2); near(e.cy, -6);
    assert.ok(tilted.report.warnings.includes('elevation'));
    const reflected = imported(dxf('0\nCIRCLE\n10\n3\n20\n4\n40\n2\n230\n-1\n')).content.entities[0];
    near(reflected.cx, -3); near(reflected.cy, -4);
});

test('large cubic DXF splines use exact Bezier spans beyond the interactive control-point limit', () => {
    const points = Array.from({ length: 140 }, (_, i) => ({ x: i, y: Math.sin(i / 8), z: 0 }));
    const spans = points.length - 3;
    const knots = [0, 0, 0, 0, ...Array.from({ length: spans - 1 }, (_, i) => i + 1), spans, spans, spans, spans];
    const curve = importDxfSpline({ degree: 3, rational: false, closed: false, periodic: false, controlPoints: points, knots }, p => p);
    assert.equal(curve.parts.length, spans);
    assert.deepEqual(curve.parts[0].controlPoints[0], { x: points[0].x, y: points[0].y });
    assert.deepEqual(curve.parts.at(-1).controlPoints[3], { x: points.at(-1).x, y: points.at(-1).y });
    // Independent Cox-de Boor basis evaluation at the middle of an interior span.
    const u = 50.5;
    const basis = (i, degree) => degree === 0 ? Number(knots[i] <= u && u < knots[i + 1])
        : ((knots[i + degree] - knots[i]) ? (u - knots[i]) / (knots[i + degree] - knots[i]) * basis(i, degree - 1) : 0)
            + ((knots[i + degree + 1] - knots[i + 1]) ? (knots[i + degree + 1] - u) / (knots[i + degree + 1] - knots[i + 1]) * basis(i + 1, degree - 1) : 0);
    for (const axis of ['x', 'y']) {
        const expected = points.reduce((sum, p, i) => sum + p[axis] * basis(i, 3), 0);
        const actual = curve.parts[50].controlPoints.reduce((sum, p, i) => sum + p[axis] * [1, 3, 3, 1][i] / 8, 0);
        near(actual, expected);
    }
});

test('expanded block budgets retain definitions and children beyond the former truncation limits', () => {
    const blocks = Array.from({ length: 1025 }, (_, index) => ({ id: `b-${index}`, name: `Block ${index}`, basePoint: { x: 0, y: 0 },
        entities: index ? [] : Array.from({ length: 100001 }, (_, i) => ({ id: `e-${i}`, type: 'line', layerId: 'geometry', x1: i, y1: 0, x2: i + 1, y2: 0 })) }));
    const content = normalizeDrawingContent({ ...createDefaultDrawingContent(), blocks });
    assert.equal(content.blocks.length, 1025);
    assert.equal(content.blocks[0].entities.length, 100001);
    assert.equal(content.blocks[0].entities.at(-1).id, 'e-100000');
});

test('dimension caches ignore block base points while ordinary inserts retain them', () => {
    const block = '0\nBLOCK\n2\n*D1\n10\n600000\n20\n140000\n0\nLINE\n8\n0\n10\n600010\n20\n140020\n11\n600012\n21\n140020\n0\nENDBLK\n';
    const result = imported(dxf('0\nDIMENSION\n2\n*D1\n12\n5\n22\n7\n0\nINSERT\n2\n*D1\n10\n3\n20\n4\n', block));
    const [dimension, insert] = result.content.entities.map(e => materializeDrawingBlockReference(e, result.content.blocks)[0]);
    assert.deepEqual([dimension.x1, dimension.y1, dimension.x2, dimension.y2], [600015, -140027, 600017, -140027]);
    assert.deepEqual([insert.x1, insert.y1, insert.x2, insert.y2], [13, -24, 15, -24]);
});

test('absolute and relative MTEXT heights both respect source units', () => {
    const result = importDrawingDxf(blank(), dxf('0\nMTEXT\n10\n0\n20\n0\n40\n200\n1\nA{\\H400;B}{\\H2x;C}\n'), { unit: 'mm' });
    const text = result.content.entities[0];
    near(text.fontSize, 0.2);
    for (const run of text.runs.filter(run => /[BC]/.test(run.text))) near(run.marks.fontSize, 0.4);
});

test('multileaders use context placement over stale cache matrices and retain branches and arrows', () => {
    const matrix = [0, -2, 0, 100, 3, 0, 0, 200, 0, 0, 1, 0, 0, 0, 0, 1].map(n => `47\n${n}\n`).join('');
    const block = `0\nBLOCK\n330\nB1\n2\nMark\n10\n10\n20\n20\n${line}0\nENDBLK\n`;
    const source = `0\nMULTILEADER\n300\nCONTEXT_DATA{\n290\n0\n296\n1\n341\nB1\n15\n100\n25\n200\n16\n2\n26\n3\n46\n1.5707963267948966\n${matrix}140\n2\n302\nLEADER{\n10\n20\n20\n30\n11\n1\n21\n0\n40\n5\n304\nLEADER_LINE{\n10\n5\n20\n6\n10\n20\n20\n30\n305\n}\n303\n}\n301\n}\n`;
    const result = imported(dxf(source, block));
    const children = materializeDrawingBlockReference(result.content.entities[0], result.content.blocks, { recursive: true });
    const transformed = children.find(e => e.type === 'line' && Math.abs(e.x1 - 160) < 1e-8);
    assert.ok(transformed);
    near(transformed.y1, -180); near(transformed.x2, 160); near(transformed.y2, -184);
    assert.ok(children.some(e => e.type === 'hatch'));
    assert.ok(children.some(e => e.type === 'line' && e.x1 === 5 && e.y1 === -6));
    assert.ok(result.report.warnings.includes('leaderGraphics'));
});

test('clockwise hatch edges and elliptical polar angles keep the expected endpoints', async () => {
    const source = '0\nHATCH\n70\n1\n91\n1\n92\n0\n93\n1\n72\n3\n10\n0\n20\n0\n11\n4\n21\n0\n40\n0.5\n50\n315\n51\n360\n73\n0\n97\n0\n';
    const hatch = imported(dxf(source)).content.entities[0];
    const edge = hatch.boundaries[0].parts[0];
    const { getCurveStart, getCurveEnd } = await import('./drawingCurveKernel.js');
    const start = getCurveStart(edge); const end = getCurveEnd(edge);
    near(start.x, 4 / Math.sqrt(5)); near(start.y, -4 / Math.sqrt(5));
    near(end.x, 4); near(end.y, 0);
});
