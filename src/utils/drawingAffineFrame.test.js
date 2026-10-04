import { explodeDrawingEntities } from './drawingCompoundOperations.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { transformDrawingEntityAffine, materializeDrawingBlockReference, createAnonymousDrawingBlock } from './drawingBlocks.js';
import { transformAffinePoint } from './drawingAffine.js';
import { drawingAffineFrame, drawingRectTransform } from './drawingAffineFrame.js';
import { getRectEntityCorners, translateEntity, rotateEntity, scaleEntity, mirrorEntity } from './drawingPrimitives.js';
import { getEntityBounds, snapDrawingPoint } from './drawingGeometry.js';
import { getEntityGrips, editEntityGrip } from './drawingSelection.js';
import { getImageClipPoints } from './drawingImageClip.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, pasteDrawingClipboardPayload } from './drawingClipboard.js';

const matrix = { a: 2, b: 0.5, c: 0.75, d: 1, e: 10, f: -3 };
const image = { id: 'picture', type: 'image', layerId: 'geometry', x: 1, y: 2, width: 4, height: 3, rotation: 30, mirrored: true };
const near = (actual, expected) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-8, JSON.stringify({ actual, expected }));

test('nonuniform image and text decomposition preserves exact quadrilaterals and native data', () => {
    for (const entity of [image, { ...image, type: 'text', text: 'Affine label', fontSize: 0.4 }]) {
        const transformed = materializeDrawingBlockReference({ blockId: 'frame', transform: matrix }, [{ id: 'frame', entities: [entity] }])[0];
        assert.equal(transformed.type, entity.type);
        assert.deepEqual(transformed.affineFrame, matrix);
        assert.equal(transformed.rotation, entity.rotation);
        getRectEntityCorners(transformed).forEach((point, index) => near(point, transformAffinePoint(getRectEntityCorners(entity)[index], matrix)));
        assert.match(drawingRectTransform(transformed), /^matrix\(2 0.5 0.75 1 10 -3\)/);
        const bounds = getEntityBounds(transformed);
        for (const point of getRectEntityCorners(transformed)) assert.ok(point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY);
    }
});

test('move, rotation, scale, mirror, block localization and grip editing compose frames', () => {
    const transformed = transformDrawingEntityAffine(image, matrix);
    const originalCorner = getRectEntityCorners(transformed)[0];
    near(getRectEntityCorners(translateEntity(transformed, 3, 5))[0], { x: originalCorner.x + 3, y: originalCorner.y + 5 });
    near(getRectEntityCorners(rotateEntity(transformed, 90, { x: 0, y: 0 }))[0], { x: -originalCorner.y, y: originalCorner.x });
    near(getRectEntityCorners(scaleEntity(transformed, 2, { x: 0, y: 0 }))[0], { x: originalCorner.x * 2, y: originalCorner.y * 2 });
    near(getRectEntityCorners(mirrorEntity(transformed, { x: 0, y: 0 }, { x: 1, y: 0 }))[0], { x: originalCorner.x, y: -originalCorner.y });
    const definition = createAnonymousDrawingBlock([transformed], { basePoint: { x: 10, y: 20 } });
    near(getRectEntityCorners(definition.entities[0])[0], { x: originalCorner.x - 10, y: originalCorner.y - 20 });
    const grip = getEntityGrips(transformed)[0];
    const moved = { x: grip.x - 1, y: grip.y - 2 };
    const edited = editEntityGrip(transformed, grip.id, moved);
    near(getEntityGrips(edited).find(item => item.id === grip.id), moved);
    assert.deepEqual(edited.affineFrame, matrix);
});

test('crop points and endpoint snaps include reflection, rotation and the outer frame', () => {
    const cropped = { ...image, imageClip: { enabled: true, points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.2, y: 0.8 }] } };
    const transformed = transformDrawingEntityAffine(cropped, matrix);
    const points = getImageClipPoints(transformed, { world: true });
    points.forEach((point, index) => near(point, transformAffinePoint(getImageClipPoints(cropped, { world: true })[index], matrix)));
    const content = createDefaultDrawingContent(); content.entities = [transformed]; content.settings.snaps = { endpoint: true };
    const snap = snapDrawingPoint(points[0], content, 0.1);
    assert.equal(snap.type, 'endpoint'); near(snap, points[0]);
});

test('affine frames survive normalization, archive and clipboard; invalid frames are removed', () => {
    const document = createLcadDocument();
    const text = transformDrawingEntityAffine({ ...image, type: 'text', text: 'Affine' }, matrix);
    document.content.entities = [text];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities[0].affineFrame, matrix);
    const payload = createDrawingClipboardPayload(restored, [text.id]);
    assert.match(drawingClipboardPayloadToSvg(payload), /matrix\(2 0.5 0.75 1 10 -3\)/);
    const pasted = pasteDrawingClipboardPayload(createLcadDocument(), payload, { mode: 'original' });
    assert.deepEqual(pasted.entities[0].affineFrame, matrix);
    for (const invalid of [{ ...matrix, a: Infinity }, { ...matrix, d: 0.1875 }, { ...matrix, e: 1e13 }]) {
        const content = normalizeDrawingContent({ ...document.content, entities: [{ ...text, affineFrame: invalid }] });
        assert.equal(content.entities[0].affineFrame, undefined);
    }
    assert.equal(drawingAffineFrame({ ...text, type: 'line' }), null);
});

test('decomposing framed text keeps the resulting geometry in world coordinates', () => {
    const local = { id: 'text', type: 'text', layerId: 'geometry', x: 0, y: 0, width: 4, height: 2, text: 'AB', fontSize: 0.4 };
    const content = createDefaultDrawingContent();
    const plain = explodeDrawingEntities({ ...content, entities: [local] }, [local.id]);
    const framed = explodeDrawingEntities({ ...content, entities: [{ ...local, affineFrame: matrix }] }, [local.id]);
    assert.equal(framed.entities.length, plain.entities.length);
    assert.ok(framed.entities.length > 0);
    framed.entities.forEach((entity, index) => {
        const expected = transformDrawingEntityAffine(plain.entities[index], matrix);
        assert.deepEqual(getEntityBounds(entity), getEntityBounds(expected));
    });
});
