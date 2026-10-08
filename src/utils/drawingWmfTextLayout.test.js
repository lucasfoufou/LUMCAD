import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { getDrawingTextLayout } from './drawingText.js';
import { exportDrawingWmf } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { readDrawingWmfRecords } from './drawingWmfRecords.js';
import { rotatePoint } from './drawingPrimitives.js';
const text = { id: 'label', type: 'text', layerId: 'geometry', x: 10, y: 20, width: 6, height: 3,
    text: 'Café €\nDeux', fontSize: .3, textMode: 'multiline', horizontalAlign: 'center', color: '#224466' };
const source = entity => ({ ...createDefaultDrawingContent(), entities: [entity] });

test('WMF text export reuses multiline baselines, center alignment, clipping and code pages', () => {
    const content = source(text); const snapshot = structuredClone(content);
    const layout = getDrawingTextLayout(text, { color: text.color });
    const result = exportDrawingWmf(content); const decoded = readDrawingWmfGraphics(result.bytes).primitives;
    assert.deepEqual(decoded.map(item => item.text), ['Café €', 'Deux']);
    for (let i = 0; i < decoded.length; i++) {
        const actual = decoded[i]; const line = layout.styledLines[i];
        assert.ok(Math.abs(actual.points[0].x + result.report.origin.x - (line.x - line.width / 2)) <= result.report.coordinateStep);
        assert.ok(Math.abs(actual.points[0].y + result.report.origin.y - line.baseline) <= result.report.coordinateStep);
        assert.equal(actual.textAlign, 24); assert.equal(actual.textColor, '#224466');
        assert.ok(actual.deviceClip); assert.equal(actual.advances.length, actual.text.length);
    }
    assert.deepEqual(content, snapshot); assert.ok(result.report.warnings.includes('textFontMetrics'));
});

test('WMF rich text exports independent style runs and rotation without clipping single-line text', () => {
    const entity = { ...text, text: 'AB', runs: [{ text: 'A', marks: { bold: true, color: '#ff0000' } },
        { text: 'B', marks: { italic: true, underline: true } }], rotation: 30, textMode: 'singleLine' };
    const decoded = readDrawingWmfGraphics(exportDrawingWmf(source(entity)).bytes).primitives;
    assert.equal(decoded.length, 2); assert.equal(decoded[0].font.weight, 700);
    assert.equal(decoded[0].textColor, '#ff0000'); assert.equal(decoded[1].font.italic, true);
    assert.equal(decoded[1].font.underline, true); assert.equal(decoded[0].font.escapement, -300);
    assert.equal(decoded[0].deviceClip, undefined);
});

test('WMF text export rejects unsupported glyphs and sheared frames without changing the source', () => {
    for (const entity of [{ ...text, text: '😀' }, { ...text, mirrored: true },
        { ...text, affineFrame: { a: 1, b: 0, c: .5, d: 1, e: 0, f: 0 } }]) {
        const content = source(entity); const snapshot = structuredClone(content);
        assert.throws(() => exportDrawingWmf(content), /wmfUnsupportedCharset|wmfExportUnsupported/);
        assert.deepEqual(content, snapshot);
    }
});

test('WMF bounds contain overflowing single-line text for every alignment and rotated baselines', () => {
    for (const horizontalAlign of ['left', 'center', 'right']) {
        for (const rotation of [0, 45, 135]) {
            const entity = { ...text, width: .1, height: .1, text: 'W'.repeat(120),
                textMode: 'singleLine', horizontalAlign, rotation };
            const content = source(entity); const snapshot = structuredClone(content);
            const result = exportDrawingWmf(content);
            const { placeable } = readDrawingWmfRecords(result.bytes);
            const layout = getDrawingTextLayout(entity); const line = layout.styledLines[0];
            const left = line.x - (horizontalAlign === 'center' ? line.width / 2 : horizontalAlign === 'right' ? line.width : 0);
            const center = { x: entity.x + entity.width / 2, y: entity.y + entity.height / 2 };
            const step = result.report.coordinateStep;
            for (const x of [left, left + line.width]) for (const y of [line.top, line.top + line.height]) {
                const point = rotatePoint({ x, y }, center, rotation);
                const px = (point.x - result.report.origin.x) / step;
                const py = (point.y - result.report.origin.y) / step;
                assert.ok(px >= -1 && px <= placeable.right + 1, `horizontal extent at ${rotation}°`);
                assert.ok(py >= -1 && py <= placeable.bottom + 1, `vertical extent at ${rotation}°`);
            }
            const [decoded] = readDrawingWmfGraphics(result.bytes).primitives;
            assert.equal(decoded.text, entity.text);
            const advance = decoded.advances.reduce((sum, value) => sum + value, 0);
            assert.ok(Math.abs(advance * decoded.mapping.scaleX - line.width) <= step);
            if (rotation === 45) assert.ok(advance > 32767, 'cumulative DX may exceed a signed WORD');
            assert.deepEqual(content, snapshot);
        }
    }
});
