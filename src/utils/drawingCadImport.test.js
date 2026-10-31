import test from 'node:test';
import assert from 'node:assert/strict';
import { convertDrawingCad } from './drawingCadImport.js';

test('CAD workers terminate on timeout, parse failure and worker error without returning content', async t => {
    const previous = globalThis.Worker;
    t.after(() => { if (previous) globalThis.Worker = previous; else delete globalThis.Worker; });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let worker;
    globalThis.Worker = class {
        constructor() { worker = this; this.terminated = 0; }
        postMessage() {}
        terminate() { this.terminated++; }
    };
    for (const mode of ['timeout', 'parse', 'worker']) {
        const pending = convertDrawingCad({}, new Uint8Array(), {});
        const rejection = assert.rejects(pending, mode === 'timeout' ? /cadImportTimeout/ : /cadInvalid/);
        if (mode === 'timeout') t.mock.timers.tick(90000);
        else if (mode === 'parse') worker.onmessage({ data: { error: { message: 'cadInvalid' } } });
        else worker.onerror();
        await rejection;
        assert.equal(worker.terminated, 1);
        t.mock.timers.tick(90000);
        assert.equal(worker.terminated, 1, 'completion clears the timeout');
    }
});
