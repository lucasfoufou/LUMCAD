import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingWmfTextEntity, drawingWmfTextEntities } from './drawingWmfTextEntity.js';
import { getDrawingTextLayout } from './drawingText.js';
import { framedDrawingPoint } from './drawingAffineFrame.js';

test('WMF text baseline anchors survive rotated and reflected physical mappings', () => {
    for (const angle of [0, 900, -450]) for (const scaleX of [0.0001, -0.0001]) {
        const entity = drawingWmfTextEntity({ text: 'Café', font: { height: -20, width: 0, escapement: angle, orientation: angle, weight: 700 },
            mapping: { scaleX, scaleY: 0.0002 }, points: [{ x: 3, y: 4 }], textColor: '#112233', backgroundMode: 1, textAlign: 24 });
        const layout = getDrawingTextLayout(entity);
        const anchor = framedDrawingPoint(entity, { x: layout.textX, y: layout.firstBaseline });
        assert.ok(Math.hypot(anchor.x - 3, anchor.y - 4) < 1e-10);
        assert.equal(entity.text, 'Café'); assert.equal(entity.fontWeight, 700);
        assert.ok(Math.abs(Math.hypot(entity.affineFrame.a / scaleX, entity.affineFrame.b / .0002) - 20) < 1e-10);
    }
});

test('WMF explicit advances retain negative spacing, alignment and rotation', () => {
    const primitive = { text: 'ABC', advances: [20, -5, 15], font: { height: -20, width: 0, escapement: 900, orientation: 900 },
        mapping: { scaleX: .001, scaleY: .002 }, points: [{ x: 3, y: 4 }], backgroundMode: 1, textAlign: 30 };
    const entities = drawingWmfTextEntities(primitive);
    const expected = [4.03, 3.99, 4];
    entities.forEach((entity, index) => {
        const layout = getDrawingTextLayout(entity);
        const anchor = framedDrawingPoint(entity, { x: layout.textX, y: layout.firstBaseline });
        assert.ok(Math.abs(anchor.x - 3) < 1e-10);
        assert.ok(Math.abs(anchor.y - expected[index]) < 1e-10);
        assert.equal(entity.text, primitive.text[index]);
    });
    assert.throws(() => drawingWmfTextEntities(primitive, { maxEntities: 2 }), /wmfLimit/);
    assert.throws(() => drawingWmfTextEntities({ ...primitive, text: 'a\u0301b' }), /wmfUnsupportedTextSpacing/);
});
