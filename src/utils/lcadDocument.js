import { createDefaultDrawingContent, createDrawingId, normalizeDrawingContent } from './drawingDocument.js';
import { createI18nError } from '../i18n/translator.js';
import {
    createDefaultDrawingLayouts,
    normalizeDrawingLayouts,
    normalizeDrawingPageSetups,
} from './drawingLayouts.js';

export const LCAD_FORMAT = 'lumcad';
export const LCAD_FORMAT_VERSION = 2;
export const LCAD_MIN_READABLE_FORMAT_VERSION = 1;
export const LCAD_APP_VERSION = '0.3.0';
export const SUPPORTED_LCAD_IMAGE_MIME_TYPES = Object.freeze([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
]);

export function createLcadDocument({
    name = 'Untitled',
    layoutName = 'Layout 1',
    gridSpacing = 0.5,
    tracking = false,
} = {}) {
    const now = new Date().toISOString();
    return {
        id: createDrawingId('drawing'),
        name: normalizeDocumentName(name),
        content: createDefaultDrawingContent({ gridSpacing, tracking }),
        assets: [],
        layouts: createDefaultDrawingLayouts({ name: layoutName }),
        pageSetups: [],
        createdAt: now,
        updatedAt: now,
    };
}

export function createLcadEnvelope(document, savedAt = new Date()) {
    const normalized = normalizeLcadDocument(document);
    return {
        format: LCAD_FORMAT,
        formatVersion: LCAD_FORMAT_VERSION,
        appVersion: LCAD_APP_VERSION,
        document: {
            ...normalized,
            updatedAt: savedAt.toISOString(),
        },
    };
}

export function normalizeLcadEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
        throw createI18nError('errors.invalidEnvelope');
    }
    if (envelope.format !== LCAD_FORMAT) {
        throw createI18nError('errors.notLumcad');
    }
    if (!Number.isInteger(envelope.formatVersion)
        || envelope.formatVersion < LCAD_MIN_READABLE_FORMAT_VERSION
        || envelope.formatVersion > LCAD_FORMAT_VERSION) {
        throw createI18nError('errors.unsupportedFormatVersion', { version: String(envelope.formatVersion) });
    }
    if (!envelope.document || typeof envelope.document !== 'object' || Array.isArray(envelope.document)) {
        throw createI18nError('errors.invalidDocument');
    }
    return {
        ...envelope,
        formatVersion: LCAD_FORMAT_VERSION,
        document: normalizeLcadDocument(envelope.document),
    };
}

export function normalizeLcadDocument(document) {
    const now = new Date().toISOString();
    return {
        id: typeof document?.id === 'string' && document.id ? document.id : createDrawingId('drawing'),
        name: normalizeDocumentName(document?.name),
        content: normalizeDrawingContent(document?.content),
        assets: normalizeEmbeddedAssets(document?.assets),
        layouts: normalizeDrawingLayouts(document?.layouts),
        pageSetups: normalizeDrawingPageSetups(document?.pageSetups),
        createdAt: isIsoDate(document?.createdAt) ? document.createdAt : now,
        updatedAt: isIsoDate(document?.updatedAt) ? document.updatedAt : now,
    };
}

export function safeLcadFilename(value) {
    const base = String(value || 'Untitled')
        .replace(/\.lcad$/i, '')
        .replace(/[^a-zA-Z0-9À-ÿ._ -]+/g, '-')
        .replace(/[. ]+$/g, '')
        .trim() || 'Untitled';
    return `${base}.lcad`;
}

function normalizeDocumentName(value) {
    const name = String(value || '').trim();
    return name || 'Untitled';
}

function normalizeEmbeddedAssets(assets) {
    if (!Array.isArray(assets)) return [];
    return assets.flatMap(asset => {
        if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string') return [];
        const link = typeof asset.link === 'string' ? asset.link : '';
        const mimeType = normalizeLcadAssetMimeType(inferDataUrlMimeType(link));
        if (!mimeType) return [];
        const width = Number(asset.width);
        const height = Number(asset.height);
        if (!(width > 0) || !(height > 0)) return [];
        return [{
            id: asset.id,
            name: typeof asset.name === 'string' ? asset.name : 'Reference image',
            mimeType,
            width,
            height,
            link,
        }];
    });
}

export function normalizeLcadImageMimeType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'image/jpg') return 'image/jpeg';
    return SUPPORTED_LCAD_IMAGE_MIME_TYPES.includes(normalized) ? normalized : null;
}

export function normalizeLcadAssetMimeType(value) {
    const mime = String(value || '').trim().toLowerCase();
    return ['application/pdf', 'model/vnd.dwfx+xps', 'image/vnd.dgn'].includes(mime) ? mime : normalizeLcadImageMimeType(value);
}

function inferDataUrlMimeType(link) {
    return /^data:([^;,]+)/i.exec(link)?.[1] || null;
}

function isIsoDate(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
