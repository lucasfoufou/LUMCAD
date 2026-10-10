#!/usr/bin/env node
// Native integration test: launches only the supplied binary, on an isolated port.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDrawingLayout, createDrawingViewport } from '../src/utils/drawingLayouts.js';
import { buildDrawingEntity } from '../src/utils/drawingEntityFactory.js';
import { materializeDrawingBlockReference } from '../src/utils/drawingBlocks.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createLcadDocument, createLcadEnvelope } from '../src/utils/lcadDocument.js';
import { createLcadArchive, LCAD_MANIFEST_PATH, readLcadArchive } from '../src/utils/lcadArchive.js';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { pngBytes } from '../tests/e2e/fixtures.js';

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
    await nativePublication();
    await nativeFileReferences();

    async function nativePublication() {
        const run = (command, input) => call('execute_command', { command, ...(input === undefined ? {} : { input }) });
        await call('open_document', { path });
        // AUTOPUBLISH writes every layout, without a dialog, beside the saved drawing.
        const autoPath = join(work, 'auto.lcad');
        await call('save_document', { path: autoPath });
        await run('AUTOPUBLISH');
        const autoTask = getDocument({ data: new Uint8Array(await readFile(join(work, 'auto.pdf'))), useSystemFonts: true });
        assert.equal((await autoTask.promise).numPages, 2);
        await autoTask.destroy();
        console.log('PASS: native AUTOPUBLISH writes every layout beside the saved drawing.');
        // ETRANSMIT packages the saved sheet set index with its source drawing.
        const state = await call('get_state');
        await run('NEWSHEETSET', '"Projet"');
        await run('SHEETSET', `ADD CURRENT ${state.document.layouts[0].id} 1 "Plan"`);
        const indexPath = join(work, 'projet.json');
        await run('SHEETSET', `SAVE ${JSON.stringify(indexPath)}`);
        assert.equal(JSON.parse(await readFile(indexPath, 'utf8')).name, 'Projet');
        const zipPath = join(work, 'projet.zip');
        await run('ETRANSMIT', JSON.stringify(zipPath));
        const packaged = unzipSync(new Uint8Array(await readFile(zipPath)));
        const drawings = Object.keys(packaged).filter(name => name.endsWith('.lcad'));
        assert.equal(drawings.length, 1, Object.keys(packaged).join(', '));
        assert.deepEqual(readLcadArchive(packaged[drawings[0]]).document.content.entities, state.document.content.entities);
        // Paths are rewritten in the packaged index only.
        assert.ok(strFromU8(packaged['sheet-set.json']).includes(drawings[0]));
        assert.ok((await readFile(indexPath, 'utf8')).includes('auto.lcad'));
        console.log('PASS: native ETRANSMIT packages the sheet set index with its source drawing.');
    }

    async function nativeFileReferences() {
        const run = (command, input, extra = {}) => call('execute_command', { command, ...(input === undefined ? {} : { input }), ...extra });
        const content = async () => (await call('get_state')).document.content;
        const sourceEntities = async file => readLcadArchive(new Uint8Array(await readFile(file))).document.content.entities;
        const source = createLcadDocument({ name: 'Référence' });
        source.content.entities = [{ id: 'src-line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 }];
        const sourcePath = join(work, 'référence.lcad');
        await writeFile(sourcePath, createLcadArchive(createLcadEnvelope(source)));
        await call('open_document', { path });
        await run('XATTACH', `${JSON.stringify(sourcePath)} 20 0`);
        const reference = (await content()).entities.find(entity => entity.externalReference);
        assert.equal(reference.transform.e, 20);

        // REFEDIT edits the linked source; REFSAVE writes it and reloads the host cache.
        assert.match((await run('REFEDIT', reference.id)).editor.message, /Référence/);
        await call('execute_command', { command: 'line', actions: [{ type: 'point', x: 0, y: 5 }, { type: 'point', x: 4, y: 5 }, { type: 'escape' }] });
        await run('REFSAVE');
        const written = await sourceEntities(sourcePath);
        assert.deepEqual(written.map(entity => entity.type), ['line', 'line']);
        assert.equal(written[0].id, 'src-line');
        assert.deepEqual([written[1].y1, written[1].y2], [5, 5]);
        await run('REFCLOSE');
        let host = await content();
        const reloaded = host.entities.find(entity => entity.id === reference.id);
        assert.equal(host.blocks.find(block => block.id === reloaded.blockId).entities.length, 2);
        // REFCLOSE DISCARD leaves the source untouched.
        await run('REFEDIT', reference.id);
        await call('execute_command', { command: 'line', actions: [{ type: 'point', x: 0, y: 9 }, { type: 'point', x: 4, y: 9 }, { type: 'escape' }] });
        const savedSource = await readFile(sourcePath);
        await run('REFCLOSE', 'DISCARD');
        assert.deepEqual(await readFile(sourcePath), savedSource);
        assert.deepEqual((await content()).entities, host.entities);
        console.log('PASS: native REFEDIT → REFSAVE writes the source, REFCLOSE DISCARD keeps it unchanged.');

        // IMAGEATTACH reads an explicit path into a linked image with an embedded snapshot.
        const pngPath = join(work, 'photo.png');
        await writeFile(pngPath, pngBytes(8, 8));
        await run('IMAGEATTACH', JSON.stringify(pngPath));
        host = await content();
        const image = host.entities.find(entity => entity.type === 'image');
        assert.ok(image.imageSource.path.endsWith('/photo.png'));
        const imageAsset = (await call('get_state')).document.assets.find(asset => asset.id === image.assetId);
        assert.equal(imageAsset.width, 8);
        console.log('PASS: native IMAGEATTACH links the image file and embeds its snapshot.');

        // RECOVERALL inspects a damaged root and its reference; RECOVERYMANAGER opens the repaired copy.
        await call('save_document', { path: join(work, 'hôte.lcad') });
        const files = unzipSync(new Uint8Array(await readFile(join(work, 'hôte.lcad'))));
        const manifest = JSON.parse(strFromU8(files[LCAD_MANIFEST_PATH]));
        delete files[manifest.document.assets.find(asset => asset.id === image.assetId).path];
        const damagedPath = join(work, 'sinistré.lcad');
        await writeFile(damagedPath, zipSync(files));
        const batch = (await run('RECOVERALL', `FROM ${JSON.stringify(damagedPath)}`)).editor.inquiryResult;
        assert.equal(batch.mode, 'recoveryManager');
        assert.equal(batch.entries.length, 2);
        assert.ok(batch.entries.some(entry => entry.path.endsWith('référence.lcad')));
        const selected = (await run('RECOVERYMANAGER', 'SELECT 1')).editor.inquiryResult;
        assert.match(JSON.stringify(selected), /quarantin/i);
        await run('RECOVERYMANAGER', 'OPEN 1');
        const recovered = await call('get_state');
        assert.equal(recovered.filePath, null);
        assert.equal(recovered.recovered, true);
        assert.deepEqual(recovered.document.content.entities.map(entity => entity.id),
            host.entities.filter(entity => entity.id !== image.id).map(entity => entity.id));
        console.log('PASS: native RECOVERALL → RECOVERYMANAGER SELECT/OPEN recovers a damaged root with its reference.');
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
