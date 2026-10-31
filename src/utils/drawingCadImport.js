import { importDrawingDxf } from './drawingDxf.js';

/** Parse large CAD files off the UI thread; a worker belongs to one import only. */
export function convertDrawingCad(document, bytes, options) {
    if (typeof Worker === 'undefined') return Promise.resolve(importDrawingDxf(document, bytes, options));
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/drawingCadImport.worker.js', import.meta.url), { type: 'module' });
        const finish = (error, result) => {
            clearTimeout(timeout); worker.terminate();
            if (error) reject(Object.assign(new Error(error.message || 'cadInvalid'), { detail: error.detail || '' }));
            else resolve(result);
        };
        const timeout = setTimeout(() => finish({ message: 'cadImportTimeout' }), 90000);
        worker.onmessage = ({ data }) => finish(data.error, data.result);
        worker.onerror = () => finish({ message: 'cadInvalid' });
        try { worker.postMessage({ document, bytes, options }, bytes instanceof Uint8Array ? [bytes.buffer] : []); }
        catch (error) { finish(error); }
    });
}
