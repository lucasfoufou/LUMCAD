import { useRef } from 'react';
import { createI18nError, localizeError } from '~i18n/translator';
import { canEditEntity } from '~utils/drawingDocument';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { attachDrawingReference, reloadDrawingReference, detachDrawingReference, bindDrawingReference, compareDrawingReference, loadDrawingReferenceTree } from '~utils/drawingReferences';
import { parseDrawingBlockClipInput } from '~utils/drawingBlockClip';
import { isTauriRuntime, openLcadDocument, readLcadReferenceAtPath, writeLcadReference } from '~utils/lcadStorage';
import { createLcadEnvelope } from '~utils/lcadDocument';
import { validateDrawingBlockGraph } from '~utils/drawingBlockEditing';

const COMMANDS = new Set(['externalReference', 'referenceAttach', 'referenceBind', 'referenceClip', 'referenceEdit', 'referenceCompare']);

export default function useDrawingReferences({ document, history, setAssets, selectedIds, setSelectedIds,
    enabled, setMessage, present, setActiveTool, cancel, blockEditor, onBeginReference, t }) {
    const pending = useRef(false);
    const latest = useRef(null);
    latest.current = { document, history, enabled, blockEditor };
    const load = async (path, nested = true) => {
        const selected = path ? await readLcadReferenceAtPath(path) : await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
        const loaded = !path && selected?.path && isTauriRuntime() ? await readLcadReferenceAtPath(selected.path) : selected;
        return loaded && nested && isTauriRuntime()
            ? loadDrawingReferenceTree(loaded, readLcadReferenceAtPath, { ancestorIds: [document.id] }) : loaded;
    };
    const run = async (command, input) => {
        if (!COMMANDS.has(command)) return false;
        if (!enabled) { setMessage(t('reference.modelRequired')); return true; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return true; }
        pending.current = true;
        try {
            const tokens = tokenizeDrawingAttributeInput(input);
            if (!tokens) throw createI18nError('reference.syntax');
            const action = command === 'referenceCompare' ? 'COMPARE' : command === 'referenceEdit' ? 'EDIT' : command === 'referenceAttach' ? 'ATTACH' : command === 'referenceBind' ? 'BIND'
                : command === 'referenceClip' ? 'CLIP' : tokens.shift()?.toUpperCase() || 'LIST';
            const initialId = document.id;
            const current = () => {
                const value = latest.current;
                if (value.document.id !== initialId || !value.enabled) throw createI18nError('reference.contextChanged');
                return value;
            };
            const finish = (result, selection) => {
                const value = current();
                // Retain cached assets needed by undo snapshots, matching the
                // shared image/block import lifecycle.
                const assets = new Map(value.document.assets.map(asset => [asset.id, asset]));
                for (const asset of result.assets || []) assets.set(asset.id, asset);
                setAssets([...assets.values()]);
                value.history.commit(result.content);
                cancel(); setActiveTool('select'); setSelectedIds(selection);
                setMessage(t('reference.updated'));
            };
            if (action === 'LIST') {
                if (tokens.length) throw createI18nError('reference.syntax');
                present({ mode: 'references', objects: document.content.entities.filter(entity => entity.externalReference)
                    .map(entity => ({ id: entity.id, ...entity.externalReference, sourceMaps: undefined, owned: undefined })) });
                return true;
            }
            if (action === 'ATTACH' || action === 'OVERLAY') {
                let mode = action === 'OVERLAY' ? 'overlay' : 'attach';
                if (['ATTACH', 'OVERLAY'].includes(tokens[0]?.toUpperCase())) mode = tokens.shift().toLowerCase();
                if (![0, 1, 3].includes(tokens.length)) throw createI18nError('reference.syntax');
                const path = tokens[0] || null;
                const insertionPoint = tokens.length === 3 ? { x: Number(tokens[1]), y: Number(tokens[2]) } : { x: 0, y: 0 };
                if (![insertionPoint.x, insertionPoint.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw createI18nError('reference.syntax');
                const loaded = await load(path);
                if (!loaded) return true;
                const target = current().document;
                const layer = target.content.layers.find(item => item.id === target.content.activeLayerId);
                if (!layer || layer.locked || layer.visible === false || layer.frozen) throw createI18nError('boundary.layerUnavailable');
                const result = attachDrawingReference(target, loaded.envelope.document, { path: loaded.path, revision: loaded.revision, mode, insertionPoint });
                finish(result, [result.referenceId]);
                if (loaded.referenceWarnings?.length) setMessage(t('reference.cachedSources', { count: loaded.referenceWarnings.length }));
                return true;
            }
            const id = action === 'CLIP' ? selectedIds.length === 1 && selectedIds[0] : tokens.shift() || (selectedIds.length === 1 && selectedIds[0]);
            const reference = document.content.entities.find(entity => entity.id === id && entity.type === 'blockReference'
                && (action === 'CLIP' || entity.externalReference));
            if (!reference) throw createI18nError('reference.error.selection');
            if (action === 'SELECT') {
                if (tokens.length) throw createI18nError('reference.syntax');
                cancel(); setActiveTool('select'); setSelectedIds([reference.id]); return true;
            }
            if (action === 'COMPARE') {
                if (tokens.length > 1) throw createI18nError('reference.syntax');
                const loaded = await load(tokens[0] || reference.externalReference.path);
                if (loaded) present(compareDrawingReference(current().document, id, loaded.envelope.document));
                return true;
            }
            if (!canEditEntity(document.content, reference)) throw createI18nError('reference.locked');
            if (action === 'EDIT') {
                if (tokens.length) throw createI18nError('reference.syntax');
                if (!reference.externalReference.path || !isTauriRuntime()) throw createI18nError('reference.nativeEdit');
                const loaded = await load(reference.externalReference.path, false);
                const value = current();
                if (JSON.stringify(value.document.content.entities.find(entity => entity.id === id)) !== JSON.stringify(reference)) throw createI18nError('reference.contextChanged');
                const result = value.blockEditor.beginReference(reference, loaded);
                if (result.error) throw createI18nError(`block.error.${result.error}`);
                onBeginReference(result);
            } else if (action === 'CLIP') {
                const patch = parseDrawingBlockClipInput(tokens.join(' '), reference.blockClip);
                if (!patch) throw createI18nError('reference.clipSyntax');
                finish({ content: { ...document.content, entities: document.content.entities.map(entity => entity.id === id ? { ...entity, ...patch } : entity) } }, [id]);
            } else if (action === 'RELOAD' || action === 'PATH') {
                if (tokens.length > (action === 'PATH' ? 1 : 0)) throw createI18nError('reference.syntax');
                const loaded = await load(action === 'PATH' ? tokens[0] : reference.externalReference.path);
                if (!loaded) return true;
                const target = current().document;
                const live = target.content.entities.find(entity => entity.id === id);
                if (!live || JSON.stringify(live) !== JSON.stringify(reference)) throw createI18nError('reference.contextChanged');
                finish(reloadDrawingReference(target, id, loaded.envelope.document, { path: loaded.path, revision: loaded.revision }), [id]);
                if (loaded.referenceWarnings?.length) setMessage(t('reference.cachedSources', { count: loaded.referenceWarnings.length }));
            } else if (action === 'MODE') {
                if (tokens.length !== 1 || !['ATTACH', 'OVERLAY'].includes(tokens[0].toUpperCase())) throw createI18nError('reference.syntax');
                finish({ content: { ...document.content, entities: document.content.entities.map(entity => entity.id === id
                    ? { ...entity, externalReference: { ...entity.externalReference, mode: tokens[0].toLowerCase() } } : entity) } }, [id]);
            } else {
                if (tokens.length) throw createI18nError('reference.syntax');
                if (action === 'DETACH') finish(detachDrawingReference(document, id), []);
                else if (action === 'BIND') finish({ content: bindDrawingReference(document.content, id) }, [id]);
                else if (action === 'UNLOAD') finish({ content: { ...document.content, entities: document.content.entities.map(entity => entity.id === id
                    ? { ...entity, externalReference: { ...entity.externalReference, loaded: false } } : entity) } }, []);
                else throw createI18nError('reference.syntax');
            }
        } catch (error) { setMessage(localizeError(error, t, 'reference.failed')); }
        finally { pending.current = false; }
        return true;
    };
    const saveSource = async (close = false) => {
        if (pending.current) { setMessage(t('block.libraryBusy')); return false; }
        const source = blockEditor.session?.referenceSource;
        if (!source) return false;
        pending.current = true;
        try {
            const nextSource = { ...source.document, content: blockEditor.history.content, assets: blockEditor.assets };
            const graphError = validateDrawingBlockGraph(nextSource.content.blocks);
            if (graphError) throw createI18nError(`block.error.${graphError}`);
            // Validate host import capacity before the irreversible source write.
            reloadDrawingReference(document, source.referenceId, nextSource, { path: source.path, revision: source.revision });
            const loaded = await writeLcadReference(source.path, createLcadEnvelope(nextSource), source.revision);
            const current = latest.current;
            const stillEditing = current.blockEditor.session?.referenceSource?.referenceId === source.referenceId;
            const newerDraft = stillEditing && (current.blockEditor.history.content !== nextSource.content || current.blockEditor.assets !== nextSource.assets);
            const result = reloadDrawingReference(current.document, source.referenceId, loaded.envelope.document, { path: loaded.path, revision: loaded.revision });
            const assets = new Map(current.document.assets.map(asset => [asset.id, asset]));
            result.assets.forEach(asset => assets.set(asset.id, asset));
            setAssets([...assets.values()]);
            current.history.commit(result.content);
            if (stillEditing) current.blockEditor.acceptReferenceSave(result.content.entities.find(entity => entity.id === source.referenceId), loaded, close && !newerDraft, newerDraft);
            cancel(); setActiveTool('select'); setSelectedIds(close && !newerDraft ? [source.referenceId] : []);
            setMessage(t('reference.sourceSaved'));
            return true;
        } catch (error) { setMessage(localizeError(error, t, 'reference.failed')); return false; }
        finally { pending.current = false; }
    };
    return { run, saveSource, handles: command => COMMANDS.has(command), isBusy: () => pending.current };
}
