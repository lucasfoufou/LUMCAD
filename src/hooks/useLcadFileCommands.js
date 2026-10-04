import { useCallback, useEffect, useState } from 'react';

import useLatestRef from '~hooks/useLatestRef';
import { useI18n } from '~i18n/I18nProvider';
import { localizeError } from '~i18n/translator';
import { createLcadDocument, createLcadEnvelope } from '~utils/lcadDocument';
import { printRenderedLayouts, waitForPrintRendering } from '~utils/drawingPrint';
import {
    createDrawingDwfx,
    createDrawingPdf,
    getAutomaticDrawingPublishPath,
    writeDrawingPublishFile,
} from '~utils/drawingPublish';
import {
    clearLcadRecovery,
    exportLcadDocumentAs,
    listenForLcadOpen,
    openLcadDocument,
    readLcadDocumentAtPath,
} from '~utils/lcadStorage';

export default function useLcadFileCommands({
    autosave,
    document,
    drawingDefaults,
    filePath,
    recovered,
    onReplaceSession,
    publishRendererRef = null,
    setMessage,
    blockEditing = false,
}) {
    const { t } = useI18n();
    const [isExporting, setIsExporting] = useState(false);
    const [printJob, setPrintJob] = useState(null);
    const [publishRequest, setPublishRequest] = useState(null);

    const saveDrawingAs = useCallback(async () => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return null; }
        const result = await autosave.saveAs();
        setMessage(t(result ? 'file.savedAs' : 'file.saveAsCancelled'));
        return result;
    }, [autosave, blockEditing, setMessage, t]);

    const prepareSessionReplacement = useCallback(async () => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return false; }
        try {
            const unsavedLocalDocument = !filePath && (
                autosave.isRecovery || recovered || autosave.status !== 'saved'
            );
            if (unsavedLocalDocument) {
                const shouldSave = window.confirm(t('file.confirmUnsaved'));
                if (shouldSave && !await autosave.saveNow()) return false;
            } else if (autosave.status === 'dirty' || autosave.status === 'saving') {
                await autosave.saveNow();
            }
            return true;
        } catch (error) {
            setMessage(localizeError(error, t, 'file.currentSaveFailed'));
            return false;
        }
    }, [autosave, blockEditing, filePath, recovered, setMessage, t]);

    const replaceWithLoaded = useCallback(async loaded => {
        await clearLcadRecovery();
        onReplaceSession({
            document: loaded.envelope.document,
            path: loaded.path,
            recovered: loaded.recovered,
        });
    }, [onReplaceSession]);

    const createNewDrawing = useCallback(async () => {
        if (!await prepareSessionReplacement()) return;
        await clearLcadRecovery();
        onReplaceSession({
            document: createLcadDocument({
                name: t('document.untitled'),
                layoutName: t('layout.defaultName', { number: 1 }),
                gridSpacing: drawingDefaults?.gridSpacing,
                tracking: drawingDefaults?.tracking,
            }),
            path: null,
            recovered: false,
        });
    }, [drawingDefaults, onReplaceSession, prepareSessionReplacement, t]);

    const openDrawing = useCallback(async () => {
        if (!await prepareSessionReplacement()) return;
        try {
            const loaded = await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
            if (loaded) await replaceWithLoaded(loaded);
        } catch (error) {
            setMessage(localizeError(error, t, 'file.openFailed'));
        }
    }, [prepareSessionReplacement, replaceWithLoaded, setMessage, t]);

    const openDrawingAtPath = useCallback(async path => {
        if (!path || !await prepareSessionReplacement()) return;
        try {
            await replaceWithLoaded(await readLcadDocumentAtPath(path));
        } catch (error) {
            setMessage(localizeError(error, t, 'file.systemOpenFailed'));
        }
    }, [prepareSessionReplacement, replaceWithLoaded, setMessage, t]);

    const externalOpenRef = useLatestRef(openDrawingAtPath);
    useEffect(() => {
        let disposed = false;
        let unlisten = null;
        listenForLcadOpen(path => {
            if (!disposed) externalOpenRef.current(path);
        }).then(cleanup => {
            if (disposed) cleanup();
            else unlisten = cleanup;
        }).catch(() => {});
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [externalOpenRef]);

    const resolveRequestedLayouts = useCallback(layoutIds => {
        const requestedIds = new Set(Array.isArray(layoutIds) ? layoutIds : []);
        return requestedIds.size
            ? document.layouts.filter(layout => requestedIds.has(layout.id))
            : document.layouts;
    }, [document.layouts]);

    const exportPdf = useCallback(async (layoutIds, { format = 'pdf' } = {}) => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return false; }
        const layouts = resolveRequestedLayouts(layoutIds);
        if (!layouts.length) {
            setMessage(t('layout.noLayoutsToExport'));
            return false;
        }
        setPublishRequest({
            format: format === 'dwfx' ? 'dwfx' : 'pdf',
            layoutIds: layouts.map(layout => layout.id),
        });
        return true;
    }, [blockEditing, resolveRequestedLayouts, setMessage, t]);

    const closePublishDialog = useCallback(() => setPublishRequest(null), []);

    const publishRenderedLayouts = useCallback(async ({ format, pages, layouts }) => {
        if (!pages?.length || pages.length !== layouts?.length) {
            throw new Error(t('publish.renderIncomplete'));
        }
        setIsExporting(true);
        try {
            const bytes = format === 'dwfx'
                ? await createDrawingDwfx(pages, { title: document.name })
                : await createDrawingPdf(pages, { title: document.name });
            const result = await writeDrawingPublishFile({
                bytes,
                defaultName: document.name,
                filterName: t(format === 'dwfx' ? 'fileDialog.dwfxDrawing' : 'fileDialog.pdfDrawing'),
                format,
            });
            setMessage(t(result ? 'publish.exported' : 'publish.cancelled', {
                count: layouts.length,
                format: format.toUpperCase(),
            }));
            return Boolean(result);
        } catch (error) {
            setMessage(localizeError(error, t, 'publish.failed'));
            return false;
        } finally {
            setIsExporting(false);
        }
    }, [document.name, setMessage, t]);

    const printPublishedLayouts = useCallback(async ({ layouts, plotSettings }) => {
        if (!layouts?.length) return false;
        setIsExporting(true);
        try {
            setPrintJob({ drawing: document, layouts, plotSettings });
            await printRenderedLayouts(window, { layouts });
            setMessage(t('file.printDialogOpened', { count: layouts.length }));
            return true;
        } catch (error) {
            setMessage(localizeError(error, t, 'file.pdfFailed'));
            return false;
        } finally {
            setPrintJob(null);
            setIsExporting(false);
        }
    }, [document, setMessage, t]);

    const autoPublish = useCallback(async (layoutIds = null) => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return false; }
        const path = getAutomaticDrawingPublishPath(filePath, 'pdf');
        if (!path) {
            setMessage(t('publish.autoRequiresSavedDrawing'));
            return false;
        }
        const layouts = resolveRequestedLayouts(layoutIds);
        if (!layouts.length) {
            setMessage(t('layout.noLayoutsToExport'));
            return false;
        }
        setIsExporting(true);
        try {
            await waitForPrintRendering(window);
            const requested = new Set(layouts.map(layout => layout.id));
            const pages = (publishRendererRef?.current?.getPages?.() || [])
                .filter(page => requested.has(page.layout.id));
            if (pages.length !== layouts.length) throw new Error(t('publish.renderIncomplete'));
            const bytes = await createDrawingPdf(pages, { title: document.name });
            const result = await writeDrawingPublishFile({
                bytes,
                defaultName: document.name,
                explicitPath: path,
                filterName: t('fileDialog.pdfDrawing'),
                format: 'pdf',
            });
            setMessage(t('publish.autoPublished', { count: layouts.length, path: result.path }));
            return true;
        } catch (error) {
            setMessage(localizeError(error, t, 'publish.failed'));
            return false;
        } finally {
            setIsExporting(false);
        }
    }, [blockEditing, document.name, filePath, publishRendererRef, resolveRequestedLayouts, setMessage, t]);

    const exportPageSetups = useCallback(async pageSetupIds => {
        const requestedIds = new Set(Array.isArray(pageSetupIds) ? pageSetupIds : []);
        const pageSetups = requestedIds.size
            ? document.pageSetups.filter(pageSetup => requestedIds.has(pageSetup.id))
            : document.pageSetups;
        if (!pageSetups.length) {
            setMessage(t('layout.noPageSetupsToExport'));
            return false;
        }
        setIsExporting(true);
        try {
            const exportName = t('layout.pageSetupExportName', { name: document.name });
            const exportDocument = {
                ...createLcadDocument({
                    name: exportName,
                    layoutName: t('layout.defaultName', { number: 1 }),
                }),
                pageSetups,
            };
            const result = await exportLcadDocumentAs(
                createLcadEnvelope(exportDocument),
                exportName,
                { filterName: t('fileDialog.lcadDrawing') },
            );
            setMessage(t(result ? 'layout.pageSetupsExported' : 'layout.pageSetupsExportCancelled', {
                count: pageSetups.length,
            }));
            return Boolean(result);
        } catch (error) {
            setMessage(localizeError(error, t, 'layout.pageSetupsExportFailed'));
            return false;
        } finally {
            setIsExporting(false);
        }
    }, [document.name, document.pageSetups, setMessage, t]);

    return {
        createNewDrawing,
        autoPublish,
        closePublishDialog,
        exportPageSetups,
        exportPdf,
        isExporting,
        openDrawing,
        printPublishedLayouts,
        printJob,
        publishRenderedLayouts,
        publishRequest,
        saveDrawingAs,
    };
}
