#!/usr/bin/env node
// Native integration test: launches only the supplied binary, on an isolated port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDrawingLayout, createDrawingViewport } from '../src/utils/drawingLayouts.js';
import { buildDrawingEntity } from '../src/utils/drawingEntityFactory.js';
import { materializeDrawingBlockReference } from '../src/utils/drawingBlocks.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const binary = resolve(process.argv[2] || `src-tauri/target/debug/lumcad${process.platform === 'win32' ? '.exe' : ''}`);
const work = await mkdtemp(join(tmpdir(), 'lumcad-headless-'));
const child = spawn(binary, ['--headless'], { env: { ...process.env, LUMCAD_MCP_PORT: '43780' }, stdio: ['ignore', 'ignore', 'pipe'] });
let logs = '';
child.stderr.on('data', chunk => { logs += chunk; });
let endpoint;
let id = 0;
async function request(method, params = {}) {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(120_000) });
    const result = await response.json();
    if (result.error) throw new Error(JSON.stringify(result.error));
    return result.result;
}
async function call(name, args = {}) {
    const result = await request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result));
    return result.structuredContent || JSON.parse(result.content[0].text);
}
try {
    const deadline = Date.now() + 90_000;
    for (;;) {
        if (child.exitCode !== null) throw new Error(`Headless process exited: ${logs}`);
        endpoint = logs.match(/LUMCAD MCP endpoint: (http:\/\/127\.0\.0\.1:\d+\/mcp)/)?.[1];
        if (endpoint) {
            try { if ((await call('get_state')).headless) break; } catch {}
        }
        if (Date.now() > deadline) throw new Error(`Headless runtime not ready: ${logs}`);
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal((await (await fetch(endpoint.replace('/mcp', '/health'))).json()).headless, true);
    const initial = await call('get_state');
    assert.equal(initial.filePath, null);
    assert.equal(initial.document.content.entities.length, 0);
    await call('execute_command', { command: 'line', actions: [{ type: 'point', x: 0, y: 0 }, { type: 'point', x: 10, y: 0 }, { type: 'escape' }] });
    await assert.rejects(call('open_document', { path: join(work, 'missing.lcad') }));
    const drawn = await call('get_state');
    assert.equal(drawn.document.content.entities.length, 1);
    assert.equal(drawn.document.content.entities[0].x2, 10);
    const layouts = ['A4', 'A3'].map((format, index) => createDrawingLayout({
        id: `headless-layout-${index}`, name: format, format,
        viewports: [createDrawingViewport({ rect: { x: 10, y: 40, width: 250, height: 150 }, modelViewBox: { x: -1, y: -1, width: 12, height: 8 } })],
        paperEntities: [buildDrawingEntity('text', { x: 20, y: 20 }, { x: 120, y: 30 }, drawn.document.content.layers[0].id,
            `caption-${index}`, { options: { textMode: 'singleLine', text: `Headless QA ${format}`, fontSize: 5 } })],
    }));
    await call('replace_document', { document: { layouts } });
    const path = join(work, 'épreuve.lcad');
    await call('save_document', { path });
    await call('execute_command', { command: 'delete', selection: drawn.document.content.entities.map(e => e.id) });
    assert.equal((await call('get_state')).document.content.entities.length, 0);
    await call('open_document', { path });
    assert.deepEqual((await call('get_state')).document.content.entities, drawn.document.content.entities);
    const pdfPath = join(work, 'épreuve.pdf');
    const exported = await call('export_pdf', { path: pdfPath });
    assert.equal(exported.pageCount, 2);
    const bytes = new Uint8Array(await readFile(pdfPath));
    const pdfTask = getDocument({ data: bytes, useSystemFonts: true });
    const pdf = await pdfTask.promise;
    assert.equal(pdf.numPages, 2);
    for (let pageNumber = 1; pageNumber <= 2; pageNumber++) {
        const text = await (await pdf.getPage(pageNumber)).getTextContent();
        assert.ok(text.items.map(item => item.str).join(' ').includes(`Headless QA ${pageNumber === 1 ? 'A4' : 'A3'}`));
    }
    const operators = await (await pdf.getPage(1)).getOperatorList();
    assert.ok(operators.fnArray.length > 3, 'PDF contains rendered artwork');
    await pdfTask.destroy();
    const savedPdf = await readFile(pdfPath);
    await assert.rejects(call('export_pdf', { path: pdfPath, layoutIds: ['missing'] }), /Unknown layout/);
    assert.deepEqual(await readFile(pdfPath), savedPdf);
    const reversed = await call('export_pdf', { path: pdfPath, layoutIds: layouts.map(l => l.id).reverse() });
    assert.deepEqual(reversed.layoutIds, layouts.map(l => l.id).reverse());
    const reverseTask = getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: true });
    const reversePdf = await reverseTask.promise;
    const firstText = await (await reversePdf.getPage(1)).getTextContent();
    assert.ok(firstText.items.map(item => item.str).join(' ').includes('Headless QA A3'));
    await reverseTask.destroy();
    await assert.rejects(call('save_document', { path: 'relative.lcad' }), /absolute/);
    if (process.platform !== 'win32') await assert.rejects(call('open_document', { path: 'C:\\plan.lcad' }), /absolute/);
    await assert.rejects(call('execute_command', { command: 'saveAs' }), /dialog/);
    assert.deepEqual((await call('get_state')).document.content.entities, drawn.document.content.entities);
    console.log('PASS: native headless MCP create → save → delete → open → PDF, geometry and refusal checks.');
    // DWG needs LibreDWG: LUMCAD_LIBREDWG_DIR, or LUMCAD_TEST_DWG=1 to rely on automatic lookup.
    const dwg = process.env.LUMCAD_LIBREDWG_DIR || process.env.LUMCAD_TEST_DWG === '1';
    for (const format of ['dxf', ...(dwg ? ['dwg'] : [])]) {
        const cadPath = join(work, `épreuve.${format}`);
        const block = { id: 'cad-block', name: 'Roof', basePoint: { x: 0, y: 0 }, entities: [
            { id: 'cad-child', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 },
        ] };
        const fixture = [...drawn.document.content.entities,
            { id: 'cad-circle', type: 'circle', layerId: 'geometry', cx: 5, cy: 6, r: 3 },
            { id: 'cad-insert', type: 'blockReference', layerId: 'geometry', blockId: block.id,
                transform: { a: 0, b: 2, c: -3, d: 0, e: 10, f: 20 } },
        ];
        await call('replace_document', { document: { content: { ...drawn.document.content, entities: fixture, blocks: [block] } } });
        await call('execute_command', { command: `${format.toUpperCase()}OUT`, input: JSON.stringify(cadPath) });
        const exportedBytes = await readFile(cadPath);
        assert.ok(exportedBytes.length > 100);
        if (format === 'dwg') assert.equal(exportedBytes.subarray(0, 6).toString(), 'AC1015');
        const ids = (await call('get_state')).document.content.entities.map(entity => entity.id);
        await call('execute_command', { command: 'delete', selection: ids });
        const importedResult = await call('execute_command', { command: `${format.toUpperCase()}IN`, input: JSON.stringify(cadPath) });
        const importedContent = (await call('get_state')).document.content;
        const imported = importedContent.entities;
        assert.equal(imported.length, 3, importedResult.editor.message);
        assert.equal(imported[1].r, 3);
        const child = materializeDrawingBlockReference(imported[2], importedContent.blocks)[0];
        for (const [key, value] of Object.entries({ x1: 10, y1: 20, x2: 10, y2: 24 })) assert.ok(Math.abs(child[key] - value) < 1e-8);
        assert.equal(imported[0].type, 'line');
        assert.deepEqual([imported[0].x1, imported[0].y1, imported[0].x2, imported[0].y2], [0, 0, 10, 0]);
        await call('execute_command', { command: 'undo' });
        assert.equal((await call('get_state')).document.content.entities.length, 0);
        await call('open_document', { path });
        console.log(`PASS: native ${format.toUpperCase()} export → import → undo through MCP.`);
    }
} finally {
    if (child.exitCode === null) {
        child.kill();
        await new Promise(resolve => child.once('exit', resolve));
    }
    await rm(work, { recursive: true, force: true });
}

const invalid = spawn(binary, ['--headless', join(work, 'missing.lcad')], {
    env: { ...process.env, LUMCAD_MCP_PORT: '43780' }, stdio: ['ignore', 'ignore', 'pipe'],
});
let diagnostic = '';
invalid.stderr.on('data', chunk => { diagnostic += chunk; });
const exitCode = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => { invalid.kill(); reject(new Error('Invalid startup did not fail promptly.')); }, 30_000);
    invalid.once('error', error => { clearTimeout(timer); reject(error); });
    invalid.once('exit', code => { clearTimeout(timer); resolveExit(code); });
});
assert.equal(exitCode, 1, diagnostic);
assert.match(diagnostic, /headless startup failed/);
console.log('PASS: invalid startup file exits with a diagnostic and a nonzero status.');
