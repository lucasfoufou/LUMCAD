import { invoke } from '@tauri-apps/api/core';

import { normalizeLocale } from '../i18n/translator.js';
import { isTauriRuntime } from '../utils/lcadStorage.js';

export const APP_SETTINGS_STORAGE_KEY = 'lumcad.settings.v1';
const LEGACY_LANGUAGE_STORAGE_KEY = 'lumcad.locale';
export const DEFAULT_APP_SETTINGS = Object.freeze({
    version: 1,
    language: 'en',
    autosaveDelayMs: 900,
    drawingDefaults: Object.freeze({
        designer: '',
        gridSpacing: 0.5,
        tracking: false,
        angleUnit: 'degrees',
        clockwiseAngles: false,
        mirrorText: false,
    }),
    mcp: Object.freeze({
        enabled: true,
        preferredPort: 43622,
    }),
});

export function normalizeAppSettings(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const drawingDefaults = source.drawingDefaults && typeof source.drawingDefaults === 'object'
        ? source.drawingDefaults
        : {};
    const mcp = source.mcp && typeof source.mcp === 'object' ? source.mcp : {};
    return {
        version: 1,
        language: normalizeLocale(source.language),
        autosaveDelayMs: clampFiniteInteger(source.autosaveDelayMs, 300, 10_000, 900),
        drawingDefaults: {
            designer: String(drawingDefaults.designer || '').trim().slice(0, 120),
            gridSpacing: clampFiniteNumber(drawingDefaults.gridSpacing, 0.0001, 1_000, 0.5),
            tracking: Boolean(drawingDefaults.tracking),
            angleUnit: ['degrees', 'radians', 'gradians'].includes(drawingDefaults.angleUnit)
                ? drawingDefaults.angleUnit
                : 'degrees',
            clockwiseAngles: Boolean(drawingDefaults.clockwiseAngles),
            mirrorText: Boolean(drawingDefaults.mirrorText),
        },
        mcp: {
            enabled: source.mcp ? mcp.enabled !== false : true,
            preferredPort: clampFiniteInteger(mcp.preferredPort, 1_024, 65_535, 43_622),
        },
    };
}

export async function loadAppSettings() {
    if (isTauriRuntime()) {
        let settings = normalizeAppSettings(await invoke('get_app_settings'));
        const legacyLanguage = readLegacyLanguage();
        if (legacyLanguage) {
            settings = normalizeAppSettings(await invoke('update_app_settings', {
                settings: { ...settings, language: legacyLanguage },
            }));
            removeLegacyLanguage();
        }
        return settings;
    }
    try {
        const stored = normalizeAppSettings(JSON.parse(window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY) || 'null'));
        const legacyLanguage = readLegacyLanguage();
        if (!legacyLanguage) return stored;
        const migrated = normalizeAppSettings({ ...stored, language: legacyLanguage });
        window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(migrated));
        removeLegacyLanguage();
        return migrated;
    } catch {
        return normalizeAppSettings();
    }
}

export async function saveAppSettings(settings) {
    const normalized = normalizeAppSettings(settings);
    if (isTauriRuntime()) return normalizeAppSettings(await invoke('update_app_settings', { settings: normalized }));
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}

export async function getMcpStatus() {
    if (!isTauriRuntime()) {
        return {
            enabled: false,
            running: false,
            starting: false,
            endpoint: null,
            healthEndpoint: null,
            preferredPort: null,
            actualPort: null,
            fallbackUsed: false,
            protocolVersion: null,
            lastError: null,
            browserPreview: true,
        };
    }
    return invoke('get_mcp_status');
}

function clampFiniteInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isInteger(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

function clampFiniteNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

function readLegacyLanguage() {
    try {
        const value = window.localStorage.getItem(LEGACY_LANGUAGE_STORAGE_KEY);
        return /^(?:en|fr)$/.test(value || '') ? value : null;
    } catch {
        return null;
    }
}

function removeLegacyLanguage() {
    try {
        window.localStorage.removeItem(LEGACY_LANGUAGE_STORAGE_KEY);
    } catch {
        // Legacy cleanup is optional in privacy-restricted webviews.
    }
}
