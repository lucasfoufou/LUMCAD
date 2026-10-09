import useLatestRef from './useLatestRef.js';
import { createLcadEnvelope } from '~utils/lcadDocument';
import { readLcadDocumentAtPath, exportLcadDocumentAs, isTauriRuntime } from '~utils/lcadStorage';
import { createDrawingPdf, writeDrawingPublishFile } from '~utils/drawingPublish';
import { validateMcpPath, selectMcpPdfLayouts } from '~utils/mcpFiles';

// Uses the same archive validation, publication renderer and atomic native writers
// as interactive files. Explicit file operations never launch a native dialog.
export default function useMcpFiles({ document, blockEditing, onReplaceSession, setFilePath, withPublishPages, protectedPaths = [] }) {
    const latestDocument = useLatestRef(document);
    const requireDesktop = () => {
        if (!isTauriRuntime()) throw new Error('MCP file operations require the native desktop runtime.');
        if (blockEditing) throw new Error('Close the block editor before opening, saving or publishing.');
    };
    return {
        async openDocument(path) {
            requireDesktop();
            validateMcpPath(path, 'lcad');
            const loaded = await readLcadDocumentAtPath(path);
            onReplaceSession({ document: loaded.envelope.document, path: loaded.path, recovered: false });
            return { path: loaded.path, documentId: loaded.envelope.document.id };
        },
        async saveDocument(path) {
            requireDesktop();
            validateMcpPath(path, 'lcad');
            const result = await exportLcadDocumentAs(createLcadEnvelope(document), document.name, { destinationPath: path, protectedPaths });
            setFilePath(result.path);
            return result;
        },
        async exportPdf(path, layoutIds) {
            requireDesktop();
            validateMcpPath(path, 'pdf');
            const layouts = selectMcpPdfLayouts(document.layouts, layoutIds);
            const { bytes, pageCount } = await withPublishPages(async renderedPages => {
                const rendered = new Map(renderedPages.map(page => [page.layout.id, page]));
                const pages = layouts.map(layout => rendered.get(layout.id));
                if (pages.some(page => !page)) throw new Error('The publication renderer is not ready.');
                return { bytes: await createDrawingPdf(pages, { title: document.name }), pageCount: pages.length };
            });
            if (latestDocument.current !== document) throw new Error('The document changed during PDF preparation; no file was written.');
            const result = await writeDrawingPublishFile({ bytes, format: 'pdf', explicitPath: path, defaultName: document.name });
            return { path: result.path, pageCount, bytes: bytes.length, layoutIds: layouts.map(layout => layout.id) };
        },
    };
}
