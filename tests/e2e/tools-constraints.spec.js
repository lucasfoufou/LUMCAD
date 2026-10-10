import { test, expect } from '@playwright/test';
import {
    start, state, command, entities, openDrawing, withContent, fit, pickEntities, expectUndoRedo,
} from './helpers.js';

// Geometric and dimensional constraints: apply through the command line on a
// selection, check the solved geometry, then undo restores the free geometry.

const fixture = withContent({ entities: [
    { id: 'a', type: 'line', x1: 0, y1: 0, x2: 10, y2: 1 },
    { id: 'b', type: 'line', x1: 0, y1: 5, x2: 8, y2: 7 },
    { id: 'c1', type: 'circle', cx: 20, cy: 0, r: 2 },
    { id: 'c2', type: 'circle', cx: 21, cy: 1, r: 3 },
    { id: 'axis', type: 'line', x1: 40, y1: -5, x2: 40, y2: 5 },
    { id: 'pa', type: 'point', x: 37, y: 1 },
    { id: 'pb', type: 'point', x: 44, y: 2 },
    { id: 'tl', type: 'line', x1: 50, y1: 3, x2: 60, y2: 3 },
    { id: 'tc', type: 'circle', cx: 55, cy: 0, r: 2 },
] });

const A = { x: 5, y: 0.5 };
const B = { x: 4, y: 6 };
// Bottom of c1, away from the overlapping c2 outline.
const C1 = { x: 20, y: 2 };
const C2 = { x: 24, y: 1 };

async function open(page) {
    await start(page);
    await openDrawing(page, fixture);
    await fit(page);
    return entities(page);
}
const byId = async (page, id) => (await entities(page)).find(entity => entity.id === id);
const length = line => Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
const direction = line => ({ x: (line.x2 - line.x1) / length(line), y: (line.y2 - line.y1) / length(line) });
const close = (actual, expected) => expect(actual).toBeCloseTo(expected, 5);

async function constrain(page, points, input) {
    const before = await entities(page);
    await pickEntities(page, points);
    await command(page, input);
    expect((await state(page)).editor.message).toMatch(/updated|created/i);
    return before;
}

test('GEOMCONSTRAINT creates, lists and deletes a relation', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'GEOMCONSTRAINT horizontal');
    await command(page, 'GEOMCONSTRAINT LIST');
    expect(JSON.parse((await state(page)).editor.message)).toMatchObject([{ type: 'horizontal', refs: [{ entityId: 'a' }] }]);
    await command(page, 'GEOMCONSTRAINT DELETE ALL');
    await command(page, 'GEOMCONSTRAINT LIST');
    expect(JSON.parse((await state(page)).editor.message)).toEqual([]);
    await command(page, 'UNDO');
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
});

test('GCCOINCIDENT joins the end of one line to the start of another', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A, B], 'GCCOINCIDENT 1@end 2@start');
    const [a, b] = [await byId(page, 'a'), await byId(page, 'b')];
    close(a.x2, b.x1);
    close(a.y2, b.y1);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCCOLLINEAR puts the second line on the first line axis', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A, B], 'GCCOLLINEAR');
    const [a, b] = [await byId(page, 'a'), await byId(page, 'b')];
    const d = direction(a);
    for (const [x, y] of [[b.x1, b.y1], [b.x2, b.y2]]) close((x - a.x1) * d.y - (y - a.y1) * d.x, 0);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCCONCENTRIC gives two circles the same centre', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [C1, C2], 'GCCONCENTRIC');
    const [c1, c2] = [await byId(page, 'c1'), await byId(page, 'c2')];
    close(c1.cx, c2.cx);
    close(c1.cy, c2.cy);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCEQUAL gives two lines the same length', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A, B], 'GCEQUAL');
    close(length(await byId(page, 'a')), length(await byId(page, 'b')));
    await expectUndoRedo(page, before, await entities(page));
});

test('GCFIX keeps a fixed point while another relation solves', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'GCFIX 1@start');
    await constrain(page, [A], 'GCHORIZONTAL');
    const a = await byId(page, 'a');
    close(a.x1, 0);
    close(a.y1, 0);
    close(a.y2, 0);
    await command(page, 'UNDO');
    await command(page, 'UNDO');
    await expect.poll(async () => entities(page)).toEqual(before);
});

test('GCHORIZONTAL levels an inclined line', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'GCHORIZONTAL');
    const a = await byId(page, 'a');
    close(a.y1, a.y2);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCVERTICAL makes an inclined line vertical', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'GCVERTICAL');
    const a = await byId(page, 'a');
    close(a.x1, a.x2);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCPARALLEL aligns the direction of two lines', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A, B], 'GCPARALLEL');
    const [a, b] = [direction(await byId(page, 'a')), direction(await byId(page, 'b'))];
    close(a.x * b.y - a.y * b.x, 0);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCPERPENDICULAR sets a right angle between two lines', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A, B], 'GCPERPENDICULAR');
    const [a, b] = [direction(await byId(page, 'a')), direction(await byId(page, 'b'))];
    close(a.x * b.x + a.y * b.y, 0);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCSYMMETRIC mirrors two points about an axis line', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [{ x: 37, y: 1 }, { x: 44, y: 2 }, { x: 40, y: 3 }], 'GCSYMMETRIC 1@node 2@node 3');
    const [pa, pb, axis] = [await byId(page, 'pa'), await byId(page, 'pb'), await byId(page, 'axis')];
    // The midpoint lies on the axis and the segment is perpendicular to it.
    const d = direction(axis);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    close((mid.x - axis.x1) * d.y - (mid.y - axis.y1) * d.x, 0);
    close((pb.x - pa.x) * d.x + (pb.y - pa.y) * d.y, 0);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCTANGENT makes a line touch a circle', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [{ x: 52, y: 3 }, { x: 57, y: 0 }], 'GCTANGENT');
    const [line, circle] = [await byId(page, 'tl'), await byId(page, 'tc')];
    const d = direction(line);
    close(Math.abs((circle.cx - line.x1) * d.y - (circle.cy - line.y1) * d.x), circle.r);
    await expectUndoRedo(page, before, await entities(page));
});

test('GCSMOOTH joins a spline to a line with continuous tangent', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [
        { id: 'l', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0 },
        { id: 's', type: 'spline', controlPoints: [{ x: 10, y: 0 }, { x: 12, y: 2 }, { x: 15, y: 3 }, { x: 18, y: 1 }] },
    ] }));
    await fit(page);
    const before = await entities(page);
    await constrain(page, [{ x: 5, y: 0 }, { x: 18, y: 1 }], 'GCSMOOTH 1@end 2@start');
    const [line, spline] = [await byId(page, 'l'), await byId(page, 's')];
    const [p0, p1] = spline.controlPoints;
    close(p0.x, line.x2);
    close(p0.y, line.y2);
    const tangent = direction({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
    const lineDirection = direction(line);
    close(tangent.x * lineDirection.y - tangent.y * lineDirection.x, 0);
    await expectUndoRedo(page, before, await entities(page));
});

test('AUTOCONSTRAIN PREVIEW reports and AUTOCONSTRAIN squares a near-rectangle', async ({ page }) => {
    await start(page);
    await openDrawing(page, withContent({ entities: [
        { id: 'r1', type: 'line', x1: 0, y1: 0, x2: 10, y2: 0.00002 },
        { id: 'r2', type: 'line', x1: 10, y1: 0.00002, x2: 10, y2: 5 },
        { id: 'r3', type: 'line', x1: 10, y1: 5, x2: 0, y2: 5 },
        { id: 'r4', type: 'line', x1: 0, y1: 5, x2: 0, y2: 0 },
    ] }));
    await fit(page);
    const before = await entities(page);
    await command(page, 'QSELECT TYPE line');
    await command(page, 'AUTOCONSTRAIN PREVIEW');
    expect(await entities(page)).toEqual(before);
    await command(page, 'AUTOCONSTRAIN');
    const r1 = await byId(page, 'r1');
    close(r1.y1, r1.y2);
    await command(page, 'GEOMCONSTRAINT LIST');
    expect(JSON.parse((await state(page)).editor.message).length).toBeGreaterThan(0);
});

test('DIMCONSTRAINT linear drives a horizontal width', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'DIMCONSTRAINT linear width "4" X');
    const a = await byId(page, 'a');
    close(Math.abs(a.x2 - a.x1), 4);
    await expectUndoRedo(page, before, await entities(page));
});

test('DCLINEAR w X drives the horizontal extent', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'DCLINEAR w "6" X');
    const a = await byId(page, 'a');
    close(Math.abs(a.x2 - a.x1), 6);
    await expectUndoRedo(page, before, await entities(page));
});

test('DCALIGNED d drives the true length', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A], 'DCALIGNED d "5"');
    close(length(await byId(page, 'a')), 5);
    await expectUndoRedo(page, before, await entities(page));
});

test('DCANGULAR drives the angle between two lines', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [A, B], 'DCANGULAR ang "30"');
    const [a, b] = [direction(await byId(page, 'a')), direction(await byId(page, 'b'))];
    const angle = Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y))) * 180 / Math.PI;
    expect([angle, 180 - angle].some(value => Math.abs(value - 30) < 1e-4)).toBe(true);
    await expectUndoRedo(page, before, await entities(page));
});

test('DCRADIUS drives a circle radius', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [C1], 'DCRADIUS r "2.5"');
    close((await byId(page, 'c1')).r, 2.5);
    await expectUndoRedo(page, before, await entities(page));
});

test('DCDIAMETER drives a circle diameter', async ({ page }) => {
    const before = await open(page);
    await constrain(page, [C1], 'DCDIAMETER dia "6"');
    close((await byId(page, 'c1')).r, 3);
    await expectUndoRedo(page, before, await entities(page));
});

test('PARAMETERS SET defines a variable that drives a dimensional constraint', async ({ page }) => {
    await open(page);
    await command(page, 'PARAMETERS SET k number "3"');
    await constrain(page, [A], 'DCLINEAR w "k*2" X');
    const a = await byId(page, 'a');
    close(Math.abs(a.x2 - a.x1), 6);
    await command(page, 'PARAMETERS SET k number "4"');
    await expect.poll(async () => {
        const line = await byId(page, 'a');
        return Math.round(Math.abs(line.x2 - line.x1) * 1e6) / 1e6;
    }).toBe(8);
});

test('DCCONVERT turns an associative dimension into a driving constraint', async ({ page }) => {
    await open(page);
    await command(page, 'DIMENSION');
    const { clickWorld } = await import('./helpers.js');
    await clickWorld(page, { x: 3, y: 0.3 });
    await page.keyboard.press('Escape');
    await command(page, 'QSELECT TYPE linearDimension');
    await command(page, 'DCCONVERT');
    await command(page, 'PARAMETERS LIST');
    const report = JSON.parse((await state(page)).editor.message);
    expect(report.dimensions.length).toBe(1);
    expect(report.dimensions[0].refs[0].entityId).toBe('a');
});
