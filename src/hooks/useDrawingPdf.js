import { openDrawingShxFont } from '~utils/drawingShxSource';
import { convertDrawingShxText, parseDrawingShxInput } from '~utils/drawingShxText';
import { importDrawingPdfCombined } from '~utils/drawingPdfCombinedImport';
import { importDrawingPdfImages } from '~utils/drawingPdfImageImport';
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createI18nError, localizeError } from '~i18n/translator';
import { canEditEntity, createDrawingId, updateSelectedEntities } from '~utils/drawingDocument';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { parseDrawingBlockClipInput } from '~utils/drawingBlockClip';
import { openDrawingPdfSource } from '~utils/drawingPdfSource';
import { drawingPdfBytes } from '~utils/drawingPdfReader';
import { attachDrawingPdfUnderlay } from '~utils/drawingPdfUnderlay';
import { importDrawingPdfGeometry } from '~utils/drawingPdfImport';
import { importDrawingPdfText } from '~utils/drawingPdfTextImport';
import { importDrawingPdfFills } from '~utils/drawingPdfFillImport';
import { createLcadArchive } from '~utils/lcadArchive';
import { createLcadEnvelope } from '~utils/lcadDocument';

const COMMANDS = new Set(['pdfAttach', 'pdfClip', 'pdfLayers', 'pdfImport', 'pdfShxText']);

export default function useDrawingPdf({ document, history, selectedIds, setAssets, setSelectedIds, enabled, setMessage, present, t }) {
    const latest = useRef(null); const pending = useRef(false);
    latest.current = { document, history, enabled };
    const run = async (command, input) => {
        if (!enabled) { setMessage(t('reference.modelRequired')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        let target = command !== 'pdfAttach' && selectedIds.length === 1 && document.content.entities.find(entity => entity.id === selectedIds[0] && entity.pdfUnderlay);
        if (['pdfClip', 'pdfLayers'].includes(command) && (!target || !canEditEntity(document.content, target))) { setMessage(t('pdf.selection')); return; }
        pending.current = true;
        const initialId = document.id;
        const current = () => {
            const value = latest.current;
            if (value.document.id !== initialId || !value.enabled) throw createI18nError('reference.contextChanged');
            if (target && value.document.content.entities.find(entity => entity.id === target.id) !== target) throw createI18nError('reference.contextChanged');
            return value;
        };
        try {
            if (command === 'pdfShxText') {
                target = null;
                const options = parseDrawingShxInput(input);
                if (!selectedIds.length) throw createI18nError('shx.selection');
                const font = await openDrawingShxFont(options.path);
                if (!font) return;
                const value = current();
                if (value.document.content !== document.content) throw createI18nError('reference.contextChanged');
                const result = convertDrawingShxText(value.document.content, selectedIds, font, options);
                createLcadArchive(createLcadEnvelope({ ...value.document, content: result.content }));
                flushSync(() => {
                    value.history.commit(result.content); setSelectedIds(result.selectedIds); setMessage(t('shx.converted', result.report));
                });
                return;
            }
            if (command === 'pdfClip') {
                const result = parseDrawingBlockClipInput(input, target.blockClip);
                if (!result) throw createI18nError('pdf.clipSyntax');
                history.commit(updateSelectedEntities(document.content, [target.id], entity => ({ ...entity, ...result })));
                setMessage(t('pdf.updated')); return;
            }
            const tokens = tokenizeDrawingAttributeInput(input);
            if (!tokens) throw createI18nError('pdf.syntax');
            let fromUnderlay = false;
            let category = 'GEOMETRY';
            if (command === 'pdfImport') {
                category = 'ALL';
                if (['ALL', 'GEOMETRY', 'TEXT', 'FILLS', 'IMAGES'].includes(tokens[0]?.toUpperCase())) category = tokens.shift().toUpperCase();
                fromUnderlay = tokens[0]?.toUpperCase() === 'UNDERLAY';
                if (fromUnderlay) {
                    tokens.shift();
                    if (!target || tokens.length) throw createI18nError('pdf.importSyntax');
                } else target = null;
            }
            let source; let pageNumber = 1; let x = 0; let y = 0; let scale = 1; let visibility = {};
            if (command === 'pdfLayers' || fromUnderlay) {
                visibility = Object.fromEntries(target.pdfUnderlay.layers.map(layer => [layer.id, layer.visible]));
                if (command === 'pdfLayers') {
                    const action = (tokens[0] || 'LIST').toUpperCase();
                    if (action === 'LIST' && tokens.length <= 1) {
                        present({ mode: 'pdfLayers', name: target.pdfUnderlay.name, layers: target.pdfUnderlay.layers.length, objects: target.pdfUnderlay.layers });
                        return;
                    }
                    if (!['ON', 'OFF'].includes(action) || tokens.length !== 2) throw createI18nError('pdf.layerSyntax');
                    const matches = target.pdfUnderlay.layers.filter(layer => tokens[1] === '*' || layer.id === tokens[1] || layer.name.toLowerCase() === tokens[1].toLowerCase());
                    if (!matches.length) throw createI18nError('pdf.layerSyntax');
                    for (const layer of matches) visibility[layer.id] = action === 'ON';
                }
                source = document.assets.find(asset => asset.id === target.pdfUnderlay.assetId);
                if (!source) throw createI18nError('pdf.sourceFailed');
                source = { ...source, bytes: drawingPdfBytes(source.link) };
                pageNumber = target.pdfUnderlay.pageNumber;
            } else {
                let path = null;
                if (tokens.length && !['PAGE', 'SCALE', 'AT'].includes(tokens[0].toUpperCase())) path = tokens.shift();
                while (tokens.length) {
                    const key = tokens.shift().toUpperCase();
                    if (key === 'PAGE') pageNumber = Number(tokens.shift());
                    else if (key === 'SCALE') scale = Number(tokens.shift());
                    else if (key === 'AT') { x = Number(tokens.shift()); y = Number(tokens.shift()); }
                    else throw createI18nError('pdf.syntax');
                }
                if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9 || !Number.isSafeInteger(pageNumber) || pageNumber < 1) throw createI18nError('pdf.syntax');
                if (!canEditEntity(document.content, { layerId: document.content.activeLayerId })) throw createI18nError('block.error.layer');
                source = await openDrawingPdfSource(path);
                if (!source) return;
            }
            const { readBrowserDrawingPdfPage } = await import('~utils/drawingPdfRuntime');
            const page = await readBrowserDrawingPdfPage(source.bytes, { pageNumber, layerVisibility: visibility, readImages: command === 'pdfImport' && ['ALL', 'IMAGES'].includes(category) });
            const value = current();
            if (command === 'pdfImport') {
                const importer = { ALL: importDrawingPdfCombined, GEOMETRY: importDrawingPdfGeometry, TEXT: importDrawingPdfText, FILLS: importDrawingPdfFills, IMAGES: importDrawingPdfImages }[category];
                const result = importer(value.document, page, { x, y, scale, reference: fromUnderlay ? target : null });
                createLcadArchive(createLcadEnvelope(result));
                const message = category === 'ALL' ? result.report.unsupported.length ? 'pdf.objectsImportedWarning' : 'pdf.objectsImported'
                    : category === 'IMAGES' ? result.report.unsupported.length ? 'pdf.imagesImportedWarning' : 'pdf.imagesImported'
                    : category === 'TEXT' ? 'pdf.textImported'
                    : category === 'FILLS' ? result.report.unsupported.length ? 'pdf.fillsImportedWarning' : 'pdf.fillsImported'
                    : result.report.unsupported.length ? 'pdf.geometryImportedWarning' : 'pdf.geometryImported';
                // Decoder completion occurs outside the initial command event.
                // Commit this result synchronously so native MCP callers receive
                // the new document even while WebKit suspends background frames.
                flushSync(() => {
                    setAssets(result.assets); value.history.commit(result.content); setSelectedIds(result.selectedIds);
                    setMessage(t(message, { count: result.report.imported }));
                });
                return;
            }
            const sourceAsset = value.document.assets.find(asset => asset.link === source.link)
                || { id: createDrawingId('asset'), name: source.name, link: source.link, mimeType: 'application/pdf', width: 1, height: 1 };
            let result = attachDrawingPdfUnderlay(value.document, page, sourceAsset, { x, y, scale, layerId: target?.layerId || value.document.content.activeLayerId });
            if (target) {
                const added = result.content.entities.at(-1);
                result.content.entities = result.content.entities.filter(entity => entity.id !== added.id).map(entity => entity.id === target.id
                    ? { ...target, blockId: added.blockId, definitionBounds: added.definitionBounds, pdfUnderlay: added.pdfUnderlay } : entity);
                const used = result.content.entities.some(entity => entity.blockId === target.blockId)
                    || result.content.blocks.some(block => block.entities.some(entity => entity.blockId === target.blockId))
                    || result.layouts.some(layout => layout.paperEntities.some(entity => entity.blockId === target.blockId));
                if (!used) result.content.blocks = result.content.blocks.filter(block => block.id !== target.blockId);
                result.selectedIds = [target.id];
            }
            createLcadArchive(createLcadEnvelope(result));
            flushSync(() => {
                setAssets(result.assets); value.history.commit(result.content); setSelectedIds(result.selectedIds);
                setMessage(t('pdf.attached', { page: pageNumber, pages: page.pageCount }));
            });
        } catch (error) { setMessage(localizeError(error, t, 'pdf.failed')); }
        finally { pending.current = false; }
    };
    return { handles: command => COMMANDS.has(command), run };
}
