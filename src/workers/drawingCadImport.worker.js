import { importDrawingDxf } from '../utils/drawingDxf.js';

self.onmessage = ({ data }) => {
    try {
        self.postMessage({ result: importDrawingDxf(data.document, data.bytes, data.options) });
    } catch (error) {
        self.postMessage({ error: { message: error.message, detail: error.detail || '' } });
    }
};
