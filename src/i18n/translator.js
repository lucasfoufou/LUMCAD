import en from './locales/en.js';
import fr from './locales/fr.js';

export const BASE_LOCALE = 'en';
export const SUPPORTED_LOCALES = Object.freeze(['en', 'fr']);
export const LOCALE_TAGS = Object.freeze({ en: 'en-GB', fr: 'fr-FR' });
export const TRANSLATIONS = Object.freeze({ en, fr });

export function normalizeLocale(value) {
    const candidate = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return SUPPORTED_LOCALES.includes(candidate) ? candidate : BASE_LOCALE;
}

export function createTranslator(locale = BASE_LOCALE) {
    const normalizedLocale = normalizeLocale(locale);
    const base = TRANSLATIONS[BASE_LOCALE];
    const dictionary = TRANSLATIONS[normalizedLocale] || base;
    const pluralRules = new Intl.PluralRules(LOCALE_TAGS[normalizedLocale]);

    return (key, values = {}) => {
        const count = Number(values.count);
        const pluralCategory = Number.isFinite(count) && ['en', 'fr'].includes(normalizedLocale)
            ? (count === 1 ? 'one' : 'other')
            : Number.isFinite(count) ? pluralRules.select(count) : null;
        const pluralKey = pluralCategory ? `${key}_${pluralCategory}` : null;
        const template = (pluralKey && (dictionary[pluralKey] ?? base[pluralKey]))
            ?? dictionary[key]
            ?? base[key]
            ?? key;
        return interpolate(template, values);
    };
}

export function createI18nError(key, values = {}, options = {}) {
    const error = new Error(createTranslator(BASE_LOCALE)(key, values), options);
    error.translationKey = key;
    error.translationValues = values;
    return error;
}

export function localizeError(error, translate, fallbackKey = 'errors.unknown') {
    const structured = normalizeStructuredError(error);
    if (structured?.translationKey) {
        return translate(structured.translationKey, structured.translationValues || {});
    }
    if (structured?.code) {
        const key = STORAGE_ERROR_KEYS[structured.code];
        if (key) return translate(key, structured);
    }
    return translate(fallbackKey);
}

export function formatLocalizedNumber(value, locale = BASE_LOCALE, options = {}) {
    return new Intl.NumberFormat(LOCALE_TAGS[normalizeLocale(locale)], {
        useGrouping: false,
        ...options,
    }).format(Number(value) || 0);
}

function interpolate(template, values) {
    return String(template).replace(/\{\{(\w+)\}\}/g, (match, name) => (
        values[name] === undefined || values[name] === null ? match : String(values[name])
    ));
}

function normalizeStructuredError(error) {
    if (!error) return null;
    if (typeof error === 'object' && (error.code || error.translationKey)) return error;
    const raw = typeof error === 'string' ? error : error.message;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return error.translationKey ? error : null;
    }
}

const STORAGE_ERROR_KEYS = Object.freeze({
    image_source_failed: 'image.sourceFailed',
    pdf_source_failed: 'pdf.sourceFailed',
    shx_source_failed: 'shx.sourceFailed',
    invalid_json_object: 'storage.invalidJsonObject',
    invalid_format: 'storage.invalidFormat',
    unsupported_version: 'storage.unsupportedVersion',
    invalid_document: 'storage.invalidDocument',
    open_file: 'storage.openFile',
    invalid_archive: 'storage.invalidArchive',
    missing_manifest: 'storage.missingManifest',
    invalid_manifest: 'storage.invalidManifest',
    manifest_too_large: 'storage.manifestTooLarge',
    invalid_archive_entry: 'storage.invalidArchiveEntry',
    invalid_asset: 'storage.invalidAsset',
    missing_asset: 'storage.missingAsset',
    asset_too_large: 'storage.assetTooLarge',
    too_many_assets: 'storage.tooManyAssets',
    no_save_path: 'storage.noSavePath',
    create_folder: 'storage.createFolder',
    create_temporary_file: 'storage.createTemporaryFile',
    serialize_drawing: 'storage.serializeDrawing',
    finalize_file: 'storage.finalizeFile',
    sync_file: 'storage.syncFile',
    replace_file: 'storage.replaceFile',
    reference_changed: 'storage.referenceChanged',
    protected_drawing: 'storage.protectedDrawing',
    reference_too_large: 'storage.referenceTooLarge',
    recovery_directory: 'storage.recoveryDirectory',
    remove_recovery: 'storage.removeRecovery',
    invalid_publish_format: 'publish.error.invalidFormat',
    invalid_publish_path: 'publish.error.invalidPath',
    publish_extension_mismatch: 'publish.error.extensionMismatch',
    empty_publish_payload: 'publish.error.emptyPayload',
    publish_payload_too_large: 'publish.error.payloadTooLarge',
    invalid_pdf: 'publish.error.invalidPdf',
    invalid_dwfx: 'publish.error.invalidDwfx',
    publish_parent_unavailable: 'publish.error.parentUnavailable',
    publish_target_is_symlink: 'publish.error.symlinkTarget',
    publish_target_is_not_file: 'publish.error.nonFileTarget',
    inspect_publish_target: 'publish.error.inspectTarget',
    create_publish_temporary: 'publish.error.createTemporary',
    write_publish_file: 'publish.error.writeFile',
    flush_publish_file: 'publish.error.flushFile',
    sync_publish_file: 'publish.error.syncFile',
    replace_publish_file: 'publish.error.replaceFile',
    sync_publish_directory: 'publish.error.syncDirectory',
});
