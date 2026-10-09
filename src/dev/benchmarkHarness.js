import { createDrawingBenchmarkDocument, DRAWING_BENCHMARK_FIXTURES } from '~utils/drawingBenchmarkFixtures';
import { readLcadArchive } from '~utils/lcadArchive';

// `FILE` benchmarks the .lcad served at ?file=<name> (see bench:browser --file).
const FILE_FIXTURE = 'FILE';

/**
 * Development-only interaction benchmark. It loads a synthetic fixture into a
 * sandboxed session (autosave never writes) and replays pointer, wheel and
 * keyboard input against the real editor, timing each input until the next
 * painted frame. Exposed as `window.__LUMCAD_BENCH__`; see PERFORMANCE.md.
 */
export function installBenchmarkHarness({ loadDocument }) {
    let running = false;
    const api = {
        fixtures: Object.keys(DRAWING_BENCHMARK_FIXTURES),
        load: size => loadFixture(loadDocument, size),
        run: async (sizes = ['S', 'M', 'L']) => {
            if (running) throw new Error('A benchmark is already running.');
            running = true;
            try {
                const results = await runBenchmark(loadDocument, sizes);
                window.__LUMCAD_BENCH_RESULTS__ = results;
                return results;
            } finally {
                running = false;
            }
        },
    };
    window.__LUMCAD_BENCH__ = api;
    const autorun = requestedAutorun();
    if (autorun.length) {
        waitFor(() => canvasSvg(), 60_000)
            .then(() => api.run(autorun))
            .then(showResults)
            .catch(error => showResults({ error: error.message }));
    }
    return () => {
        if (window.__LUMCAD_BENCH__ === api) delete window.__LUMCAD_BENCH__;
    };
}

function requestedAutorun() {
    const value = new URLSearchParams(window.location.search).get('bench') || import.meta.env.VITE_LUMCAD_BENCH_AUTORUN || '';
    return value.split(',').map(size => size.trim()).filter(size => size in DRAWING_BENCHMARK_FIXTURES || size === FILE_FIXTURE);
}

async function runBenchmark(loadDocument, sizes) {
    const results = {
        date: new Date().toISOString(),
        environment: {
            userAgent: navigator.userAgent,
            devicePixelRatio: window.devicePixelRatio,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            mode: import.meta.env.MODE,
        },
        fixtures: {},
    };
    const query = new URLSearchParams(window.location.search);
    const selected = query.get('scenarios')?.split(',') || null;
    // With ?profile=1 each scenario is recorded as its own console profile (collected over CDP).
    const profileScenarios = query.get('profile') === '1';
    // With ?trace=1 scenario boundaries are marked in the DevTools timeline.
    const traceScenarios = query.get('trace') === '1';
    const restorePointerCapture = tolerateSyntheticPointerCapture();
    try {
        for (const size of sizes) {
            let peakJsHeapMiB = 0;
            const sampleMemory = () => { peakJsHeapMiB = Math.max(peakJsHeapMiB, memorySnapshot().jsHeapMiB || 0); };
            const memoryTimer = setInterval(sampleMemory, 100);
            try {
                const load = await loadFixture(loadDocument, size);
                sampleMemory();
                await settle();
                const loadedDomNodes = document.getElementsByTagName('*').length;
                const scenarios = {};
                for (const [name, scenario] of Object.entries(SCENARIOS).filter(([name]) => !selected || selected.includes(name))) {
                    if (profileScenarios) console.profile(`${size}-${name}`);
                    if (traceScenarios) console.timeStamp(`lumcad-bench:start:${size}-${name}`);
                    scenarios[name] = await observeLongTasks(() => scenario(canvasSvg()));
                    if (traceScenarios) console.timeStamp(`lumcad-bench:end:${size}-${name}`);
                    if (profileScenarios) console.profileEnd(`${size}-${name}`);
                    await settle();
                    sampleMemory();
                }
                results.fixtures[size] = { ...load, ...memorySnapshot(), peakJsHeapMiB: round(peakJsHeapMiB), domNodes: loadedDomNodes, scenarios };
                console.info(`[LUMCAD bench] ${size}`, results.fixtures[size]);
            } finally { clearInterval(memoryTimer); }
        }
    } finally {
        restorePointerCapture();
    }
    console.table(summaryRows(results));
    return results;
}

async function fixtureDocument(size) {
    if (size !== FILE_FIXTURE) return createDrawingBenchmarkDocument(size);
    const name = new URLSearchParams(window.location.search).get('file');
    const response = await fetch(`./${encodeURIComponent(name || '')}`);
    if (!response.ok) throw new Error(`Benchmark file ${name} could not be read.`);
    return readLcadArchive(new Uint8Array(await response.arrayBuffer())).document;
}

async function loadFixture(loadDocument, size) {
    const document = await fixtureDocument(size);
    const start = performance.now();
    loadDocument(document);
    await waitFor(() => entityCount() >= Math.min(document.content.entities.length, 50), 120_000);
    await nextFrame();
    return { entities: document.content.entities.length, loadMs: round(performance.now() - start) };
}

const SCENARIOS = {
    hoverSelect: async svg => {
        clickTool('select');
        return timeSequence(path(svg, 60), point => pointer(svg, 'pointermove', point));
    },
    hoverLineWithSnaps: async svg => {
        clickTool('line');
        let snapMarkers = 0;
        const timings = await timeSequence(path(svg, 60), point => {
            pointer(svg, 'pointermove', point);
            if (document.querySelector('.drawing-canvas.has-snap-marker')) snapMarkers += 1;
        });
        const lineToolActive = Boolean(document.querySelector('.drawing-canvas.is-tool-line'));
        key('Escape');
        clickTool('select');
        return { timings, checks: { lineToolActive, snapMarkers } };
    },
    wheelZoom: async svg => {
        const center = relativePoint(svg, 0.5, 0.5);
        const deltas = [...Array(10).fill(-120), ...Array(10).fill(120)];
        return timeSequence(deltas, deltaY => svg.dispatchEvent(new WheelEvent('wheel', {
            bubbles: true, cancelable: true, clientX: center.x, clientY: center.y, deltaY,
        })));
    },
    pan: async svg => {
        const start = relativePoint(svg, 0.5, 0.5);
        pointer(svg, 'pointerdown', start, { button: 1, buttons: 4 });
        const points = Array.from({ length: 30 }, (_, index) => ({ x: start.x + index * 6, y: start.y + index * 3 }));
        const timings = await timeSequence(points, point => pointer(svg, 'pointermove', point, { buttons: 4 }));
        pointer(svg, 'pointerup', points.at(-1), { button: 1 });
        return timings;
    },
    windowSelect: async svg => {
        // Selection windows follow the CAD click-move-click convention.
        clickTool('select');
        await settle();
        document.querySelector('.drawing-status-view button:last-child')?.click();
        await settle();
        const first = relativePoint(svg, 0.9, 0.1);
        const last = relativePoint(svg, 0.1, 0.9);
        click(svg, first);
        await nextFrame();
        const points = Array.from({ length: 10 }, (_, index) => interpolate(first, last, (index + 1) / 10));
        const timings = await timeSequence(points, point => pointer(svg, 'pointermove', point));
        timings.push(await timed(() => click(svg, last)));
        await settle();
        const selected = selectedCount();
        if (!selected) throw new Error(`Window selection selected no entities (${svg.getAttribute('viewBox')}); bulk timings would be invalid.`);
        return { timings, checks: { selected } };
    },
    deleteUndoRedo: async () => {
        const timings = [];
        const counts = { before: entityCount() };
        timings.push(await timed(() => key('Delete'), () => entityCount() < counts.before));
        counts.afterDelete = entityCount();
        if (counts.afterDelete >= counts.before) throw new Error('Bulk delete made no change.');
        timings.push(await timed(() => key('z', { ctrlKey: true }), () => entityCount() === counts.before));
        counts.afterUndo = entityCount();
        timings.push(await timed(() => key('Z', { ctrlKey: true, shiftKey: true }), () => entityCount() === counts.afterDelete));
        counts.afterRedo = entityCount();
        timings.push(await timed(() => key('z', { ctrlKey: true }), () => entityCount() === counts.before));
        counts.restored = entityCount();
        if (counts.afterUndo !== counts.before || counts.afterRedo !== counts.afterDelete || counts.restored !== counts.before) throw new Error(`Bulk undo/redo did not restore the scene: ${JSON.stringify(counts)}`);
        timings.push(await timed(() => key('Escape')));
        return { timings, checks: counts };
    },
    lineClicks: async svg => {
        // Rapid LINE vertices: each click must add its segment within the next frame.
        clickTool('line');
        await settle();
        const before = entityCount();
        const points = path(svg, 20);
        const timings = await timeSequence(points, point => click(svg, point));
        key('Escape');
        await settle();
        const added = entityCount() - before;
        // Undo removes the last segment (one history entry per committed vertex).
        timings.push(await timed(() => key('z', { ctrlKey: true }), () => entityCount() < before + added));
        return { timings, checks: { added } };
    },
    zoomedIn: async svg => {
        // Typical work happens zoomed into part of a plan: hover and pan there.
        const center = relativePoint(svg, 0.3, 0.45);
        for (let step = 0; step < 16; step += 1) svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: center.x, clientY: center.y, deltaY: -120 }));
        await delay(500);
        const domNodes = document.getElementsByTagName('*').length;
        const timings = await timeSequence(path(svg, 30), point => pointer(svg, 'pointermove', point));
        pointer(svg, 'pointerdown', center, { button: 1, buttons: 4 });
        const pan = Array.from({ length: 20 }, (_, index) => ({ x: center.x + index * 8, y: center.y }));
        timings.push(...await timeSequence(pan, point => pointer(svg, 'pointermove', point, { buttons: 4 })));
        pointer(svg, 'pointerup', pan.at(-1), { button: 1 });
        await delay(400);
        for (let step = 0; step < 16; step += 1) svg.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: center.x, clientY: center.y, deltaY: 120 }));
        await delay(500);
        return { timings, checks: { domNodes } };
    },
};

async function timeSequence(items, run) {
    const timings = [];
    for (const item of items) timings.push(await timed(() => run(item)));
    return timings;
}

async function timed(run, until = null) {
    const start = performance.now();
    run();
    if (until) await waitFor(until, 120_000);
    await nextFrame();
    return performance.now() - start;
}

async function observeLongTasks(run) {
    const longTasks = [];
    let observer = null;
    try {
        observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
        observer.observe({ type: 'longtask' });
    } catch {
        observer = null;
    }
    const outcome = await run();
    const { timings, checks } = Array.isArray(outcome) ? { timings: outcome } : outcome;
    await nextFrame();
    observer?.disconnect();
    return {
        ...statistics(timings),
        ...(checks ? { checks } : {}),
        ...(observer ? { longTasks: longTasks.length, longTaskMs: round(longTasks.reduce((sum, value) => sum + value, 0)) } : {}),
    };
}

function statistics(timings) {
    const sorted = [...timings].sort((left, right) => left - right);
    return {
        samples: sorted.length,
        median: round(sorted[Math.floor(sorted.length / 2)]),
        p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
        max: round(sorted.at(-1)),
        // Input order, so slow steps can be traced back to what the scenario did.
        timings: timings.map(round),
    };
}

function memorySnapshot() {
    return {
        domNodes: document.getElementsByTagName('*').length,
        ...(performance.memory ? { jsHeapMiB: round(performance.memory.usedJSHeapSize / 1024 / 1024) } : {}),
    };
}

function summaryRows(results) {
    const rows = {};
    for (const [size, fixture] of Object.entries(results.fixtures)) {
        rows[`${size} load`] = { ms: fixture.loadMs, domNodes: fixture.domNodes, heapMiB: fixture.jsHeapMiB };
        for (const [name, scenario] of Object.entries(fixture.scenarios)) {
            rows[`${size} ${name}`] = { median: scenario.median, p95: scenario.p95, max: scenario.max, longTasks: scenario.longTasks, checks: scenario.checks && JSON.stringify(scenario.checks) };
        }
    }
    return rows;
}

function showResults(results) {
    const panel = document.createElement('pre');
    panel.className = 'lumcad-benchmark-results';
    panel.style.cssText = 'position:fixed;inset:auto 8px 8px auto;z-index:99999;max-height:60vh;overflow:auto;margin:0;padding:8px;font:11px monospace;background:#0f172a;color:#e2e8f0;border-radius:6px;';
    panel.textContent = JSON.stringify(results.error ? results : summaryRows(results), null, 1);
    document.body.append(panel);
}

function tolerateSyntheticPointerCapture() {
    const { setPointerCapture, releasePointerCapture } = Element.prototype;
    Element.prototype.setPointerCapture = function setCapture(pointerId) {
        try { setPointerCapture.call(this, pointerId); } catch { /* synthetic pointer */ }
    };
    Element.prototype.releasePointerCapture = function releaseCapture(pointerId) {
        try { releasePointerCapture.call(this, pointerId); } catch { /* synthetic pointer */ }
    };
    return () => {
        Element.prototype.setPointerCapture = setPointerCapture;
        Element.prototype.releasePointerCapture = releasePointerCapture;
    };
}

function entityCount() {
    return Number(canvasSvg()?.querySelector(':scope > .drawing-scene')?.dataset.renderedEntities) || 0;
}

function selectedCount() {
    return canvasSvg()?.querySelectorAll(':scope > .drawing-scene-decorations > .is-selected').length || 0;
}

function canvasSvg() {
    return document.querySelector('.drawing-canvas-svg');
}

function clickTool(tool) {
    document.querySelector(`[data-tool="${tool}"]`)?.click();
}

function key(value, modifiers = {}) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...modifiers }));
}

function click(svg, point) {
    pointer(svg, 'pointerdown', point, { button: 0, buttons: 1 });
    pointer(svg, 'pointerup', point, { button: 0 });
}

function pointer(svg, type, point, { button = 0, buttons = 0 } = {}) {
    svg.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        clientX: point.x, clientY: point.y, button, buttons,
    }));
}

function path(svg, count) {
    return Array.from({ length: count }, (_, index) => relativePoint(
        svg,
        0.1 + 0.8 * ((index * 0.6180339887) % 1),
        0.1 + 0.8 * ((index * 0.7548776662) % 1),
    ));
}

function relativePoint(svg, ratioX, ratioY) {
    const bounds = svg.getBoundingClientRect();
    return { x: bounds.left + bounds.width * ratioX, y: bounds.top + bounds.height * ratioY };
}

function interpolate(first, last, ratio) {
    return { x: first.x + (last.x - first.x) * ratio, y: first.y + (last.y - first.y) * ratio };
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function settle() {
    await delay(350); // Allow the deferred pan/zoom viewport to commit before the next interaction.
    for (let index = 0; index < 5; index += 1) await nextFrame();
}

async function waitFor(check, timeoutMs) {
    const start = performance.now();
    for (;;) {
        const value = check();
        if (value) return value;
        if (performance.now() - start > timeoutMs) throw new Error('Benchmark timed out waiting for the editor.');
        await nextFrame();
    }
}

function round(value) {
    return Math.round(value * 10) / 10;
}
