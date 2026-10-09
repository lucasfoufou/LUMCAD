#!/usr/bin/env node
// Interactive editor benchmark: builds a benchmark-enabled production bundle,
// serves it locally and replays the src/dev/benchmarkHarness.js scenarios in a
// headless Chrome driven through the DevTools protocol (no extra dependency).
// Usage: npm run bench:browser -- [S M L XL] [--json file] [--chrome path]
//        [--scenarios hoverSelect,wheelZoom] [--profile file.cpuprofile]
// --profile builds without minification, records a CPU profile of the whole run
// and prints the functions with the highest self time.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
};
const optionValues = new Set(['--json', '--chrome', '--scenarios', '--profile'].map(option).filter(Boolean));
const sizes = args.filter(arg => !arg.startsWith('--') && !optionValues.has(arg));
const selectedSizes = sizes.length ? sizes : ['S', 'M', 'L'];
const chromePath = option('--chrome') || process.env.CHROME_PATH || defaultChromePath();
const jsonPath = option('--json');
const scenarios = option('--scenarios');
const profilePath = option('--profile');
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
    server = await preview({ root, logLevel: 'warn', build: { outDir }, preview: { port: 4173, strictPort: false, open: false } });
    const appUrl = server.resolvedUrls.local[0];
    chrome = await launchChrome(join(workDir, 'profile'));
    const query = `bench=${selectedSizes.join(',')}${scenarios ? `&scenarios=${scenarios}` : ''}`;
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
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
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
        await send('Profiler.start');
    }
    await send('Page.navigate', { url });
    const started = Date.now();
    try {
        for (;;) {
            const value = await evaluate(`JSON.stringify(window.__LUMCAD_BENCH_RESULTS__ || (document.querySelector('.lumcad-benchmark-results') ? { error: document.querySelector('.lumcad-benchmark-results').textContent } : null))`);
            const parsed = value ? JSON.parse(value) : null;
            if (parsed?.error) throw new Error(parsed.error);
            if (parsed) {
                if (profilePath) {
                    const { result } = await send('Profiler.stop');
                    writeFileSync(profilePath, JSON.stringify(result.profile));
                    printProfileSummary(result.profile);
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

function printProfileSummary(profile) {
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
    const rows = [...totals].sort((left, right) => right[1] - left[1]).slice(0, 30)
        .map(([name, ms]) => ({ function: name, 'self ms': Math.round(ms) }));
    console.log(`\nCPU profile written to ${profilePath}; highest self time:`);
    console.table(rows);
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
