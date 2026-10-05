import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { readDrawingPdfPage } from './drawingPdfReader.js';

export async function readBrowserDrawingPdfPage(bytes, options = {}) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const root = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.href).href;
    return readDrawingPdfPage(bytes, { ...options, pdfjs,
        resourceOptions: { cMapUrl: `${root}cmaps/`, cMapPacked: true,
            standardFontDataUrl: `${root}standard_fonts/`, wasmUrl: `${root}wasm/`, useWasm: false },
        createCanvas: (width, height) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; },
    });
}
