import { useCallback, useEffect, useRef, useState } from 'react';

import useLatestRef from '~hooks/useLatestRef';
import { useI18n } from '~i18n/I18nProvider';
import { localizeError } from '~i18n/translator';
import { createLcadDocument, createLcadEnvelope } from '~utils/lcadDocument';
import { createLcadRecoveredSession, readSavedRecoveredCandidate } from '~utils/lcadRecovery';
import { createLcadTemplateSession, parseNewDrawingInput, parseTemplateSaveInput, prepareLcadTemplate } from '~utils/lcadTemplates';
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
    isTauriRuntime,
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
    protectedPaths = [],
}) {
    const { t } = useI18n();
    const [isExporting, setIsExporting] = useState(false);
    const [printJob, setPrintJob] = useState(null);
    const [publishRequest, setPublishRequest] = useState(null);
    const newDrawingPending = useRef(false);

    const saveDrawingAs = useCallback(async () => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return null; }
        try {
            const result = await autosave.saveAs();
            setMessage(t(result ? 'file.savedAs' : 'file.saveAsCancelled'));
            return result;
        } catch (error) {
            setMessage(localizeError(error, t, 'file.currentSaveFailed'));
            return null;
        }
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

    const createNewDrawing = useCallback(async (input = '') => {
        const request = parseNewDrawingInput(input);
        if (!request) { setMessage(t('template.newSyntax')); return false; }
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return false; }
        if (newDrawingPending.current) return false;
        newDrawingPending.current = true;
        try {
            let loaded = request.template
                ? await (request.path ? readLcadDocumentAtPath(request.path) : openLcadDocument({ filterName: t('fileDialog.lcadDrawing') }))
                : null;
            if ((request.template && !loaded) || !await prepareSessionReplacement()) return false;
            // Saving the active drawing in the prompt may have updated the selected template.
            if (loaded?.path) loaded = await readLcadDocumentAtPath(loaded.path);
            const next = loaded
                ? createLcadTemplateSession(loaded.envelope.document, { name: t('document.untitled'), sourcePath: loaded.path })
                : { document: createLcadDocument({
                    name: t('document.untitled'),
                    layoutName: t('layout.defaultName', { number: 1 }),
                    gridSpacing: drawingDefaults?.gridSpacing,
                    tracking: drawingDefaults?.tracking,
                }), path: null, recovered: false };
            if (loaded) next.initialMessage = t(next.unresolvedReferences.length ? 'template.createdUnresolved' : 'template.created', {
                count: next.unresolvedReferences.length,
            });
            await clearLcadRecovery();
            onReplaceSession(next);
            return true;
        } catch (error) {
            setMessage(localizeError(error, t, 'file.openFailed'));
            return false;
        } finally { newDrawingPending.current = false; }
    }, [blockEditing, drawingDefaults, onReplaceSession, prepareSessionReplacement, setMessage, t]);

    const createQuickDrawing = useCallback(async (input = '') => {
        if (String(input).trim()) { setMessage(t('template.quickSyntax')); return false; }
        const path = drawingDefaults?.templatePath;
        return createNewDrawing(path ? isTauriRuntime() ? `FROM ${JSON.stringify(path)}` : 'TEMPLATE' : '');
    }, [createNewDrawing, drawingDefaults?.templatePath, setMessage, t]);

    const saveDrawingTemplate = useCallback(async (input = '') => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return false; }
        const request = parseTemplateSaveInput(input);
        if (!request) { setMessage(t('template.saveSyntax')); return false; }
        try {
            const prepared = prepareLcadTemplate(document, filePath);
            const result = await exportLcadDocumentAs(createLcadEnvelope(prepared.document), document.name, {
                filterName: t('fileDialog.lcadDrawing'),
                destinationPath: request.path,
                protectedPath: filePath,
                protectedPaths,
            });
            setMessage(t(result ? prepared.unresolved.length ? 'template.savedUnresolved' : 'template.saved' : 'file.saveAsCancelled', {
                count: prepared.unresolved.length,
            }));
            return Boolean(result);
        } catch (error) {
            setMessage(localizeError(error, t, 'file.currentSaveFailed'));
            return false;
        }
    }, [blockEditing, document, filePath, protectedPaths, setMessage, t]);

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

    const openRecoveredDrawing = useCallback(async (result, recoveryGraph = null) => {
        if (!result?.ready || !result.report?.valid || !result.envelope?.document || !await prepareSessionReplacement()) return false;
        const graph = typeof recoveryGraph === 'function' ? recoveryGraph() : recoveryGraph;
        const candidate = await readSavedRecoveredCandidate(result, graph, readLcadDocumentAtPath);
        const session = createLcadRecoveredSession(candidate, t('recovery.copyName', { name: candidate.envelope.document.name || t('document.untitled') }), graph);
        if (!session) return false;
        await clearLcadRecovery();
        onReplaceSession(session);
        return true;
    }, [onReplaceSession, prepareSessionReplacement, t]);

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
        createQuickDrawing,
        saveDrawingTemplate,
        autoPublish,
        closePublishDialog,
        exportPageSetups,
        exportPdf,
        isExporting,
        openDrawing,
        openRecoveredDrawing,
        printPublishedLayouts,
        printJob,
        publishRenderedLayouts,
        publishRequest,
        saveDrawingAs,
    };
}
