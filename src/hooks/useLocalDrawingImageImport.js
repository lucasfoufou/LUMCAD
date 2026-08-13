import { useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { createI18nError, localizeError } from '~i18n/translator';
import { addEntity, createDrawingId, getReferenceLayerId } from '~utils/drawingDocument';
import { normalizeLcadImageMimeType } from '~utils/lcadDocument';

const MAX_REFERENCE_IMAGE_BYTES = 25 * 1024 * 1024;

export default function useLocalDrawingImageImport({
    history,
    viewport,
    setActiveTool,
    setAssets,
    setMessage,
    setSelectedIds,
}) {
    const { t } = useI18n();
    const [isUploading, setIsUploading] = useState(false);

    const handleImageFile = async event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setMessage(t('image.notImage'));
            return;
        }
        const mimeType = normalizeLcadImageMimeType(file.type);
        if (!mimeType) {
            setMessage(t('image.unsupportedFormat'));
            return;
        }
        if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
            setMessage(t('image.tooLarge'));
            return;
        }

        setIsUploading(true);
        try {
            const link = await readFileAsDataUrl(file);
            const dimensions = await readImageDimensions(link);
            const asset = {
                id: createDrawingId('asset'),
                name: file.name,
                mimeType,
                width: dimensions.width,
                height: dimensions.height,
                link,
            };
            setAssets(current => [...current, asset]);

            const width = Math.min(12, Math.max(2, viewport.width * 0.35));
            const height = width * asset.height / asset.width;
            const image = {
                id: createDrawingId('image'),
                type: 'image',
                layerId: getReferenceLayerId(history.content),
                assetId: asset.id,
                x: viewport.x - width / 2,
                y: viewport.y - height / 2,
                width,
                height,
                opacity: 0.55,
                includeInPdf: false,
            };
            history.commit(addEntity(history.content, image));
            setSelectedIds([image.id]);
            setActiveTool('select');
            setMessage(t('image.imported'));
        } catch (error) {
            setMessage(localizeError(error, t, 'image.importFailed'));
        } finally {
            setIsUploading(false);
        }
    };

    return { handleImageFile, isUploading };
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(String(reader.result)), { once: true });
        reader.addEventListener('error', () => reject(createI18nError('image.readFailed')), { once: true });
        reader.readAsDataURL(file);
    });
}

function readImageDimensions(source) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve({ width: image.naturalWidth, height: image.naturalHeight }), { once: true });
        image.addEventListener('error', () => reject(createI18nError('image.invalidDimensions')), { once: true });
        image.src = source;
    });
}
