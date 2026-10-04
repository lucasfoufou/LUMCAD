import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

import { useI18n } from '~i18n/I18nProvider';
import { createI18nError, localizeError } from '~i18n/translator';
import { addEntity, canEditEntity, createDrawingId, getReferenceLayerId, updateSelectedEntities } from '~utils/drawingDocument';
import { normalizeImageSource, parseImageSourceInput, replaceImageSource } from '~utils/drawingImageSource';
import { isTauriRuntime } from '~utils/lcadStorage';
import { readImageDimensions } from './useLocalDrawingImageImport';

export default function useDrawingImageSource({ history, assets, documentId, viewport, setAssets, setSelectedIds, setActiveTool, setMessage }) {
    const { t } = useI18n();
    const [busy, setBusy] = useState(false);
    const pending = useRef(false);
    const generation = useRef(0);
    useEffect(() => () => { generation.current += 1; }, []);
    const latest = useRef(null);
    latest.current = { history, assets, documentId };

    const run = async (input, entity = null, attach = false) => {
        if (pending.current) return;
        const operation = attach ? { action: 'link', path: input.trim().replace(/^"(.*)"$/, '$1') || null } : parseImageSourceInput(input);
        if (!operation) { setMessage(t('image.sourceOptions')); return; }
        if (!attach && (entity?.type !== 'image' || !canEditEntity(history.content, entity))) {
            setMessage(t('image.sourceSelection')); return;
        }
        if (operation.action === 'embed') {
            if (entity.imageSource) history.commit(updateSelectedEntities(history.content, [entity.id], current => replaceImageSource(current, current.assetId, null)));
            setMessage(t('image.sourceEmbedded'));
            return;
        }
        if (!isTauriRuntime()) { setMessage(t('image.sourceDesktop')); return; }
        if (operation.action === 'reload' && !normalizeImageSource(entity.imageSource)) {
            setMessage(t('image.sourceNotLinked')); return;
        }
        const initialDocumentId = documentId;
        const operationGeneration = generation.current;
        pending.current = true;
        setBusy(true);
        try {
            const path = operation.action === 'reload' ? entity.imageSource.path : operation.path || await open({
                multiple: false, directory: false,
                filters: [{ name: t('entity.image'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }],
            });
            if (!path) return;
            const source = await invoke('read_image_source', { path });
            const dimensions = await readImageDimensions(source.link);
            if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 64 * 1024 * 1024) throw createI18nError('image.invalidDimensions');
            const current = latest.current;
            if (current.documentId !== initialDocumentId || generation.current !== operationGeneration) return;
            const target = entity && current.history.content.entities.find(item => item.id === entity.id);
            // Do not apply delayed disk results to a deleted/replaced/locked image.
            if (!attach && (!target || !canEditEntity(current.history.content, target)
                || target.assetId !== entity.assetId || target.imageSource?.path !== entity.imageSource?.path)) {
                setMessage(t('image.sourceChanged')); return;
            }
            const existing = current.assets.find(asset => asset.link === source.link);
            const asset = existing || { id: createDrawingId('asset'), name: source.name, mimeType: source.mimeType, link: source.link, ...dimensions };
            if (!existing) setAssets(values => [...values, asset]);
            const imageSource = { mode: 'linked', path: source.path };
            if (attach) {
                const width = Math.min(12, Math.max(2, viewport.width * 0.35));
                const height = width * asset.height / asset.width;
                const image = { id: createDrawingId('image'), type: 'image', layerId: getReferenceLayerId(current.history.content),
                    assetId: asset.id, imageSource, x: viewport.x - width / 2, y: viewport.y - height / 2, width, height,
                    opacity: 0.55, includeInPdf: false };
                current.history.commit(content => addEntity(content, image));
                setSelectedIds([image.id]);
                setActiveTool('select');
            } else {
                current.history.commit(content => updateSelectedEntities(content, [target.id], image => replaceImageSource(image, asset.id, imageSource)));
            }
            setMessage(t('image.sourceLoaded'));
        } catch (error) {
            setMessage(localizeError(error, t, 'image.sourceFailed'));
        } finally {
            pending.current = false;
            setBusy(false);
        }
    };
    return { run, busy, cancel: () => { generation.current += 1; } };
}
