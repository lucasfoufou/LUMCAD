import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMcpPath, selectMcpPdfLayouts } from './mcpFiles.js';
import { runMcpFrontendRequest } from '../mcp/frontendBridge.js';

test('unattended file paths require absolute typed destinations on each desktop platform', () => {
    for (const path of ['/tmp/plan.pdf', 'C:\\Plans\\épreuve.pdf', '\\\\server\\share\\plan.pdf']) assert.equal(validateMcpPath(path, 'pdf'), path);
    for (const path of ['', 'relative.pdf', '/tmp/plan.lcad', '/tmp/x\0.pdf', null]) assert.throws(() => validateMcpPath(path, 'pdf'));
});

test('PDF selection preserves explicit order and refuses partial or empty publication', () => {
    const layouts = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(selectMcpPdfLayouts(layouts, ['b', 'a']), [layouts[1], layouts[0]]);
    assert.equal(selectMcpPdfLayouts(layouts), layouts);
    for (const ids of [[], ['a', 'a'], ['a', 'missing'], 'a']) assert.throws(() => selectMcpPdfLayouts(layouts, ids));
    assert.throws(() => selectMcpPdfLayouts([]));
});

test('MCP file calls await completion and forward failures without an apparent success', async () => {
    let completed = false;
    const result = await runMcpFrontendRequest({ kind: 'export_pdf', path: '/tmp/a.pdf', layoutIds: ['a'] }, () => ({
        async exportPdf(path, ids) { await Promise.resolve(); completed = true; return { path, ids }; },
    }), async () => assert.ok(completed));
    assert.deepEqual(result, { path: '/tmp/a.pdf', ids: ['a'] });
    await assert.rejects(runMcpFrontendRequest({ kind: 'save_document', path: '/no/file.lcad' }, () => ({
        async saveDocument() { throw new Error('write failed'); },
    })), /write failed/);
});
