import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, createDimensionForEntity } from './drawingDocument.js';
import { createArcLengthDimensionResult } from './drawingDimensionCommands.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { editEntityGrip } from './drawingSelection.js';
import { ellipseOffsetPoint, sampleEllipseOffset } from './drawingEllipseOffset.js';
import { curvePointAt, curveTangentAt } from './drawingCurveKernel.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const arc = { id: 'arc', layerId: 'geometry', type: 'ellipse', cx: 0, cy: 0, rx: 4, ry: 2, rotation: 0, fullEllipse: false, startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true };
const dim = { id: 'dim', type: 'arcLengthDimension', layerId: 'dimensions', sourceId: arc.id, offset: 0.6 };
const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function independentLength(source) {
    const sweep = source.counterClockwise ? Math.PI / 2 : -3 * Math.PI / 2;
    const count = 30000;
    let length = 0;
    let previous = { x: source.rx, y: 0 };
    for (let index = 1; index <= count; index += 1) {
        const angle = sweep * index / count;
        const point = { x: source.rx * Math.cos(angle), y: source.ry * Math.sin(angle) };
        length += Math.hypot(point.x - previous.x, point.y - previous.y);
        previous = point;
    }
    return length;
}

test('DIMARC measures the source elliptical arc rather than a chord or annotation curve', () => {
    const geometry = getDimensionGeometry(dim, [arc]);
    near(geometry.value, independentLength(arc));
    assert.ok(geometry.value > Math.hypot(4, 2));
    near(getDimensionGeometry({ ...dim, offset: 4 }, [arc]).value, geometry.value);
    near(getDimensionGeometry(dim, [{ ...arc, rx: 8, ry: 4 }]).value, geometry.value * 2);
    const clockwise = { ...arc, counterClockwise: false };
    near(getDimensionGeometry(dim, [clockwise]).value, independentLength(clockwise), 1e-6);
    assert.equal(getDimensionGeometry(dim, [{ ...arc, fullEllipse: true }]), null);
});

test('parallel annotation points have the requested normal distance in either direction', () => {
    for (const source of [arc, { ...arc, rotation: 37 }, { ...arc, counterClockwise: false }]) {
        for (const parameter of [0, 0.2, 0.5, 0.8, 1]) {
            const point = curvePointAt(source, parameter);
            const offset = ellipseOffsetPoint(source, parameter, 0.6);
            const tangent = curveTangentAt(source, parameter);
            const dx = offset.x - point.x;
            const dy = offset.y - point.y;
            near(Math.hypot(dx, dy), 0.6);
            near(dx * tangent.x + dy * tangent.y, 0);
        }
    }
    assert.equal(sampleEllipseOffset(arc, -1), null, 'reject singular inward parallels');
    assert.equal(sampleEllipseOffset(arc, 1, { tolerance: 1e-15, maximumPoints: 8 }), null, 'do not silently degrade at the work limit');
});

test('the arc-length label grip adjusts its normal offset and refuses a cusp', () => {
    const geometry = getDimensionGeometry(dim, [arc]);
    const point = {
        x: geometry.offsetOrigin.x + geometry.offsetNormal.x * 2,
        y: geometry.offsetOrigin.y + geometry.offsetNormal.y * 2,
    };
    const moved = editEntityGrip(dim, 'dimension-position', point, [arc]);
    near(moved.offset, 2);
    near(getDimensionGeometry(moved, [arc]).value, geometry.value);
    const invalid = { x: geometry.offsetOrigin.x - geometry.offsetNormal.x * 2, y: geometry.offsetOrigin.y - geometry.offsetNormal.y * 2 };
    assert.equal(editEntityGrip(dim, 'dimension-position', invalid, [arc]), dim);
});

test('selection and picked DIMARC entry points produce the same native association', () => {
    const content = { ...createDefaultDrawingContent(), entities: [arc] };
    const result = createArcLengthDimensionResult(content, [arc.id]);
    assert.equal(result.changed, true);
    const picked = createDimensionForEntity(content, arc, 'arcLength');
    assert.equal(picked.sourceId, result.entities[0].sourceId);
    near(getDimensionGeometry(picked, content).value, getDimensionGeometry(result.entities[0], content).value);
    assert.equal(createArcLengthDimensionResult({ ...content, entities: [{ ...arc, fullEllipse: true }] }, [arc.id]).changed, false);
});

test('archive and SVG clipboard retain the elliptical arc-length label and annotation', () => {
    const document = createLcadDocument({ name: 'Elliptical arc length' });
    document.content.entities = [arc, dim];
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    const geometry = getDimensionGeometry(restored.content.entities[1], restored.content);
    near(geometry.value, independentLength(arc));
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(restored, [dim.id]));
    assert.ok(svg.includes('4.8442'));
    assert.ok((svg.match(/<line /g) || []).length > 5);
});

test('highly eccentric elliptical arcs retain measurement accuracy near their tips', () => {
    for (const rx of [100, 10000]) {
        const eccentric = { ...arc, rx, ry: 1 };
        const geometry = getDimensionGeometry(dim, [eccentric]);
        near(geometry.value, independentLength(eccentric), 2e-5);
        const clockwise = { ...eccentric, counterClockwise: false };
        near(getDimensionGeometry(dim, [clockwise]).value, independentLength(clockwise), 2e-4);
    }
});
