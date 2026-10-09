import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DRAWING_PRINT_CONTENT_EDGE_GUARD_POINTS,
    createDrawingPrintPageStyle,
    getCommonDrawingPrintPage,
    getDrawingPrintContentSize,
    getDrawingPrintPageName,
    getDrawingPrintPagePointSize,
    getDrawingPrintPagePixelSize,
    printRenderedLayouts,
    waitForPrintRendering,
} from './drawingPrint.js';

const CSS_PIXELS_PER_MM = 96 / 25.4;
const A_SERIES_DIMENSIONS = {
    A4: { width: 297, height: 210 },
    A3: { width: 420, height: 297 },
    A2: { width: 594, height: 420 },
    A1: { width: 841, height: 594 },
    A0: { width: 1189, height: 841 },
};

test('print page rules use exact physical millimetres per layout', () => {
    assert.equal(createDrawingPrintPageStyle([
        { format: 'A0', orientation: 'landscape' },
        { format: 'A0', orientation: 'landscape' },
    ]), '@page layout-a0-landscape { size: 1189mm 841mm; margin: 0; }\n'
        + '.drawing-layout-print-page[data-print-page="layout-a0-landscape"] { page: layout-a0-landscape; }');
    const a2Styles = createDrawingPrintPageStyle([
        { format: 'A2', orientation: 'landscape' },
        { format: 'A2', orientation: 'portrait' },
        { format: 'A2', orientation: 'landscape' },
    ]);
    assert.equal(a2Styles.split('@page').length - 1, 2);
    assert.match(a2Styles, /@page layout-a2-landscape \{ size: 594mm 420mm; margin: 0; \}/);
    assert.match(a2Styles, /@page layout-a2-portrait \{ size: 420mm 594mm; margin: 0; \}/);
    assert.deepEqual(getCommonDrawingPrintPage([
        { format: 'A0', orientation: 'landscape' },
        { format: 'A0', orientation: 'landscape' },
    ]), { width: 1189, height: 841 });
});

test('every A-series orientation keeps exact paper dimensions and content strictly within native point bounds', () => {
    for (const [format, dimensions] of Object.entries(A_SERIES_DIMENSIONS)) {
        for (const orientation of ['landscape', 'portrait']) {
            const layout = { format, orientation };
            const pageSize = getDrawingPrintPagePixelSize(layout);
            const contentSize = getDrawingPrintContentSize(layout);
            const pointSize = getDrawingPrintPagePointSize(layout);
            const expectedPhysical = orientation === 'portrait'
                ? { width: dimensions.height, height: dimensions.width }
                : dimensions;
            assert.ok(Math.abs(pageSize.width - expectedPhysical.width * CSS_PIXELS_PER_MM) < 1e-9);
            assert.ok(Math.abs(pageSize.height - expectedPhysical.height * CSS_PIXELS_PER_MM) < 1e-9);
            assert.ok(contentSize.width < pageSize.width);
            assert.ok(contentSize.height < pageSize.height);
            assert.ok(Math.abs((pageSize.width - contentSize.width) * 72 / 96
                - DRAWING_PRINT_CONTENT_EDGE_GUARD_POINTS) < 1e-9);
            assert.ok(Math.abs((pageSize.height - contentSize.height) * 72 / 96
                - DRAWING_PRINT_CONTENT_EDGE_GUARD_POINTS) < 1e-9);
            assert.ok(Math.abs(pointSize.width - expectedPhysical.width * 72 / 25.4) < 1e-9);
            assert.ok(Math.abs(pointSize.height - expectedPhysical.height * 72 / 25.4) < 1e-9);
        }
    }
});

test('A3, A1 and A0 keep a two-point driver-rounding guard inside the landscape page boundary', () => {
    for (const format of ['A3', 'A1', 'A0']) {
        const layout = { format, orientation: 'landscape' };
        const pagePoints = getDrawingPrintPagePointSize(layout);
        const content = getDrawingPrintContentSize(layout);
        const contentPoints = {
            width: content.width * 72 / 96,
            height: content.height * 72 / 96,
        };
        assert.ok(contentPoints.width < pagePoints.width);
        assert.ok(contentPoints.height < pagePoints.height);
        assert.ok(pagePoints.width - contentPoints.width >= 1.999999999);
        assert.ok(pagePoints.height - contentPoints.height >= 1.999999999);
    }
});

test('custom paper sizes receive collision-free page names and exact print rules', () => {
    const landscape = {
        format: 'CUSTOM', orientation: 'landscape', customPaperSize: { width: 650.5, height: 320.25 },
    };
    const portrait = { ...landscape, orientation: 'portrait' };
    assert.equal(getDrawingPrintPageName(landscape), 'layout-custom-650500x320250');
    assert.equal(getDrawingPrintPageName(portrait), 'layout-custom-320250x650500');
    const styles = createDrawingPrintPageStyle([landscape, portrait]);
    assert.match(styles, /size: 650\.5mm 320\.25mm/);
    assert.match(styles, /size: 320\.25mm 650\.5mm/);
    assert.equal(getCommonDrawingPrintPage([landscape, { ...landscape }]).width, 650.5);
    assert.equal(getCommonDrawingPrintPage([landscape, portrait]), null);
});

test('print rendering waits for fonts and three committed animation frames', async () => {
    const events = [];
    const targetWindow = {
        document: { fonts: { ready: Promise.resolve().then(() => events.push('fonts')) } },
        setTimeout, clearTimeout,
        requestAnimationFrame(callback) {
            events.push('frame');
            callback();
        },
    };
    await waitForPrintRendering(targetWindow);
    assert.deepEqual(events, ['fonts', 'frame', 'frame', 'frame']);
});

test('the print layout remains mounted until afterprint', async () => {
    const listeners = new Map();
    const printClasses = new Set();
    let printed = false;
    const targetWindow = {
        document: {
            documentElement: {
                classList: {
                    add(value) { printClasses.add(value); },
                    remove(value) { printClasses.delete(value); },
                },
            },
            fonts: { ready: Promise.resolve() },
        },
        requestAnimationFrame(callback) { callback(); },
        setTimeout(callback) { return { callback }; },
        clearTimeout() {},
        addEventListener(name, callback) { listeners.set(name, callback); },
        removeEventListener(name) { listeners.delete(name); },
        print() { printed = true; },
    };
    let finished = false;
    const pending = printRenderedLayouts(targetWindow).then(() => { finished = true; });
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    assert.equal(printed, true);
    assert.equal(finished, false);
    assert.equal(printClasses.has('is-lumcad-printing'), true);
    listeners.get('afterprint')();
    await pending;
    assert.equal(finished, true);
    assert.equal(printClasses.has('is-lumcad-printing'), false);
});

test('print mode is cleaned up when the native print call fails', async () => {
    const printClasses = new Set();
    const targetWindow = {
        document: {
            documentElement: {
                classList: {
                    add(value) { printClasses.add(value); },
                    remove(value) { printClasses.delete(value); },
                },
            },
            fonts: { ready: Promise.resolve() },
        },
        requestAnimationFrame(callback) { callback(); },
        setTimeout(callback) { return { callback }; },
        clearTimeout() {},
        addEventListener() {},
        removeEventListener() {},
        print() { throw new Error('Print failed'); },
    };
    await assert.rejects(printRenderedLayouts(targetWindow), /Print failed/);
    assert.equal(printClasses.has('is-lumcad-printing'), false);
});

test('unattended publication settles even when animation frames are suspended', async () => {
    await waitForPrintRendering({ document: { fonts: { ready: Promise.resolve() } },
        requestAnimationFrame() {}, setTimeout, clearTimeout });
});
