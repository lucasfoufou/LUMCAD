import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDrawingPrintPageStyle,
    getCommonDrawingPrintPage,
    getDrawingPrintContentSize,
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

test('print page rules use one quantized CSS page per physical layout', () => {
    assert.equal(createDrawingPrintPageStyle([
        { format: 'A0', orientation: 'landscape' },
        { format: 'A0', orientation: 'landscape' },
    ]), '@page layout-a0-landscape { size: 4493px 3178px; margin: 0; }\n'
        + '.drawing-layout-print-page[data-print-page="layout-a0-landscape"] { page: layout-a0-landscape; }');
    const a2Styles = createDrawingPrintPageStyle([
        { format: 'A2', orientation: 'landscape' },
        { format: 'A2', orientation: 'portrait' },
        { format: 'A2', orientation: 'landscape' },
    ]);
    assert.equal(a2Styles.split('@page').length - 1, 2);
    assert.match(a2Styles, /@page layout-a2-landscape \{ size: 2245px 1587px; margin: 0; \}/);
    assert.match(a2Styles, /@page layout-a2-portrait \{ size: 1587px 2245px; margin: 0; \}/);
    assert.deepEqual(getCommonDrawingPrintPage([
        { format: 'A0', orientation: 'landscape' },
        { format: 'A0', orientation: 'landscape' },
    ]), { width: 1189, height: 841 });
});

test('every A-series orientation keeps printable content strictly inside one CSS page', () => {
    for (const [format, dimensions] of Object.entries(A_SERIES_DIMENSIONS)) {
        for (const orientation of ['landscape', 'portrait']) {
            const layout = { format, orientation };
            const pageSize = getDrawingPrintPagePixelSize(layout);
            const contentSize = getDrawingPrintContentSize(layout);
            assert.equal(Number.isInteger(pageSize.width), true, `${format} ${orientation} width`);
            assert.equal(Number.isInteger(pageSize.height), true, `${format} ${orientation} height`);
            assert.deepEqual(contentSize, {
                width: pageSize.width - 2,
                height: pageSize.height - 2,
            });
            const expectedPhysical = orientation === 'portrait'
                ? { width: dimensions.height, height: dimensions.width }
                : dimensions;
            assert.deepEqual(pageSize, {
                width: Math.floor(expectedPhysical.width * CSS_PIXELS_PER_MM),
                height: Math.floor(expectedPhysical.height * CSS_PIXELS_PER_MM),
            });
            assert.ok(contentSize.width < pageSize.width, `${format} ${orientation} width fits`);
            assert.ok(contentSize.height < pageSize.height, `${format} ${orientation} height fits`);
        }
    }
});

test('print rendering waits for fonts and three committed animation frames', async () => {
    const events = [];
    const targetWindow = {
        document: { fonts: { ready: Promise.resolve().then(() => events.push('fonts')) } },
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
    let printed = false;
    const targetWindow = {
        document: { fonts: { ready: Promise.resolve() } },
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
    listeners.get('afterprint')();
    await pending;
    assert.equal(finished, true);
});
