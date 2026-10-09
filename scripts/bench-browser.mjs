#!/usr/bin/env node
// Interactive editor benchmark: builds a benchmark-enabled production bundle,
// serves it locally and replays the src/dev/benchmarkHarness.js scenarios in a
// headless Chrome driven through the DevTools protocol (no extra dependency).
// Usage: npm run bench:browser -- [S M L XL] [--json file] [--chrome path]
//        [--scenarios hoverSelect,wheelZoom] [--profile file.cpuprofile] [--trace]
// --profile builds without minification and records one CPU profile per
// scenario (file-<size>-<scenario>.cpuprofile), excluding fixture loading;
// and prints the functions with the highest self time.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
};
const optionValues = new Set(['--json', '--chrome', '--scenarios', '--profile', '--file'].map(option).filter(Boolean));
const sizes = args.filter(arg => !arg.startsWith('--') && !optionValues.has(arg));
const selectedSizes = sizes.length ? sizes : option('--file') ? ['FILE'] : ['S', 'M', 'L'];
const chromePath = option('--chrome') || process.env.CHROME_PATH || defaultChromePath();
const jsonPath = option('--json');
const scenarios = option('--scenarios');
const profilePath = option('--profile');
// --trace sums main-thread timeline work (style, layout, paint, hit testing,
// scripting) inside each scenario, which a CPU profile reports as "(program)".
const trace = args.includes('--trace');
// --file drawing.lcad benchmarks a real drawing (size FILE) instead of the fixtures.
const filePath = option('--file');
const timeoutMs = 20 * 60 * 1000;

if (!chromePath || !existsSync(chromePath)) fail('Chrome was not found. Pass --chrome <path> or set CHROME_PATH.');

const workDir = mkdtempSync(join(tmpdir(), 'lumcad-bench-'));
let server = null;
let chrome = null;
try {
    process.env.VITE_LUMCAD_BENCH = '1';
    const { build, preview } = await import('vite');
    const outDir = join(workDir, 'dist');
    await build({ root, logLevel: 'warn', build: { outDir, emptyOutDir: true, minify: !profilePath } });
    if (filePath) copyFileSync(resolve(filePath), join(outDir, 'bench-file.lcad'));
    server = await preview({ root, logLevel: 'warn', build: { outDir }, preview: { port: 4173, strictPort: false, open: false } });
    const appUrl = server.resolvedUrls.local[0];
    chrome = await launchChrome(join(workDir, 'profile'));
    const query = `bench=${selectedSizes.join(',')}${scenarios ? `&scenarios=${scenarios}` : ''}${profilePath ? '&profile=1' : ''}${trace ? '&trace=1' : ''}${filePath ? '&file=bench-file.lcad' : ''}`;
    const results = await runInChrome(chrome.port, `${appUrl}?${query}`);
    printResults(results);
    if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(results, null, 2)}\n`);
} finally {
    if (chrome) await stopChrome(chrome.process);
    await server?.close();
    rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function stopChrome(child) {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise(resolveExit => {
        child.once('exit', resolveExit);
        child.kill();
    });
}

function defaultChromePath() {
    if (process.platform === 'darwin') return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'win32') return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    return ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync) || null;
}

function launchChrome(profileDir) {
    const child = spawn(chromePath, [
        '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
        '--window-size=1440,900', '--force-device-scale-factor=1', '--enable-precise-memory-info',
        '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return new Promise((resolvePort, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Chrome did not expose a DevTools endpoint.')), 30_000);
        child.stderr.on('data', chunk => {
            output += chunk;
            const match = output.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
            if (match) {
                clearTimeout(timer);
                resolvePort({ process: child, port: Number(match[1]) });
            }
        });
        child.on('exit', code => reject(new Error(`Chrome exited early (${code}).`)));
    });
}

async function runInChrome(port, url) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
        socket.addEventListener('open', resolveOpen, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    const traceEvents = [];
    let traceDone = null;
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Tracing.dataCollected') {
            traceEvents.push(...message.params.value);
            return;
        }
        if (message.method === 'Tracing.tracingComplete') {
            traceDone?.();
            return;
        }
        if (message.method === 'Profiler.consoleProfileFinished') {
            const file = profilePath.replace(/(\.cpuprofile)?$/, `-${message.params.title}.cpuprofile`);
            writeFileSync(file, JSON.stringify(message.params.profile));
            printProfileSummary(message.params.profile, `${message.params.title} → ${file}`);
            return;
        }
        pending.get(message.id)?.(message);
        pending.delete(message.id);
    });
    const send = (method, params = {}) => new Promise(resolveMessage => {
        const id = nextId++;
        pending.set(id, resolveMessage);
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
    if (profilePath) {
        await send('Profiler.enable');
        await send('Profiler.setSamplingInterval', { interval: 200 });
    }
    if (trace) await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
    await send('Page.navigate', { url });
    const started = Date.now();
    try {
        for (;;) {
            const value = await evaluate(`JSON.stringify(window.__LUMCAD_BENCH_RESULTS__ || (document.querySelector('.lumcad-benchmark-results') ? { error: document.querySelector('.lumcad-benchmark-results').textContent } : null))`);
            const parsed = value ? JSON.parse(value) : null;
            if (parsed?.error) throw new Error(parsed.error);
            if (parsed) {
                if (trace) {
                    const complete = new Promise(resolveTrace => { traceDone = resolveTrace; });
                    await send('Tracing.end');
                    await complete;
                    printTraceSummary(traceEvents);
                }
                return parsed;
            }
            if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for benchmark results.');
            await new Promise(resolveDelay => setTimeout(resolveDelay, 2000));
        }
    } finally {
        socket.close();
    }
}

function printResults(results) {
    console.log(`\nLUMCAD interactive benchmark — ${results.environment.userAgent}`);
    console.log(`Viewport ${results.environment.viewport.width}×${results.environment.viewport.height}, milliseconds from input to next frame.\n`);
    const rows = {};
    for (const [size, fixture] of Object.entries(results.fixtures)) {
        rows[`${size} load`] = { median: fixture.loadMs, p95: '', max: '', longTasks: '', checks: `${fixture.domNodes} DOM nodes, ${fixture.jsHeapMiB} MiB heap` };
        for (const [name, scenario] of Object.entries(fixture.scenarios)) {
            rows[`${size} ${name}`] = { median: scenario.median, p95: scenario.p95, max: scenario.max, longTasks: scenario.longTasks ?? '', checks: scenario.checks ? JSON.stringify(scenario.checks) : '' };
        }
    }
    console.table(rows);
}

function printProfileSummary(profile, title) {
    const interval = (profile.endTime - profile.startTime) / Math.max(1, profile.samples.length) / 1000;
    const counts = new Map();
    for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
    const totals = new Map();
    for (const node of profile.nodes) {
        const { functionName, url, lineNumber } = node.callFrame;
        const file = url ? url.split('/').at(-1) : '';
        const key = `${functionName || '(anonymous)'} ${file}${file ? `:${lineNumber + 1}` : ''}`;
        totals.set(key, (totals.get(key) || 0) + (counts.get(node.id) || 0) * interval);
    }
    const rows = [...totals].sort((left, right) => right[1] - left[1]).slice(0, 20)
        .map(([name, ms]) => ({ function: name, 'self ms': Math.round(ms) }));
    console.log(`\nCPU profile ${title}; highest self time:`);
    console.table(rows);
}

/** Main-thread timeline time per event name between the harness scenario markers. */
function printTraceSummary(events) {
    const markers = events.filter(event => event.name === 'TimeStamp' && /^lumcad-bench:/.test(event.args?.data?.message || ''));
    const main = events.find(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain');
    for (const start of markers.filter(marker => marker.args.data.message.includes(':start:'))) {
        const title = start.args.data.message.split(':start:')[1];
        const end = markers.find(marker => marker.args.data.message === `lumcad-bench:end:${title}`);
        if (!end) continue;
        const totals = new Map();
        for (const event of events) {
            if (event.ph !== 'X' || event.ts < start.ts || event.ts > end.ts || (main && event.tid !== main.tid)) continue;
            totals.set(event.name, (totals.get(event.name) || 0) + (event.dur || 0) / 1000);
        }
        const rows = [...totals].sort((left, right) => right[1] - left[1]).slice(0, 12)
            .map(([name, ms]) => ({ event: name, ms: Math.round(ms) }));
        console.log(`\nTimeline ${title} (${Math.round((end.ts - start.ts) / 1000)} ms, nested events overlap):`);
        console.table(rows);
    }
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
