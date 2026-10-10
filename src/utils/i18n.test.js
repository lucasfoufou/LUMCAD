import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    BASE_LOCALE,
    TRANSLATIONS,
    createTranslator,
    localizeError,
    normalizeLocale,
} from '../i18n/translator.js';

test('English is the base locale and unsupported locales fall back to it', () => {
    assert.equal(BASE_LOCALE, 'en');
    assert.equal(normalizeLocale('en-US'), 'en');
    assert.equal(normalizeLocale('fr_FR'), 'fr');
    assert.equal(normalizeLocale('de-DE'), 'en');
});

test('every locale contains exactly the English source keys and placeholders', () => {
    const englishKeys = Object.keys(TRANSLATIONS.en).sort();
    for (const [locale, dictionary] of Object.entries(TRANSLATIONS)) {
        assert.deepEqual(Object.keys(dictionary).sort(), englishKeys, `${locale} must match the English catalog`);
        for (const key of englishKeys) {
            assert.ok(dictionary[key].trim(), `${locale}.${key} must not be empty`);
            assert.deepEqual(placeholders(dictionary[key]), placeholders(TRANSLATIONS.en[key]), `${locale}.${key} placeholders must match English`);
        }
    }
});

test('translations interpolate values, pluralize, and localize structured errors', () => {
    const en = createTranslator('en');
    const fr = createTranslator('fr');
    assert.equal(en('messages.objectsCopied', { count: 1 }), '1 object copied.');
    assert.equal(fr('messages.objectsCopied', { count: 2 }), '2 objets copiés.');
    assert.equal(fr('sidebar.objectCount', { count: 0 }), '0 objets');
    assert.equal(localizeError({ code: 'unsupported_version', expectedVersion: 1 }, en), 'Unsupported .lcad file version (expected version: 1).');
    assert.equal(
        localizeError('{"code":"invalid_dwfx","path":"/tmp/drawing.dwfx"}', fr),
        'Le paquet DWFx généré a échoué à la validation native et n’a pas été écrit.',
    );
});

test('every literal translation key used by the interface exists in English', async () => {
    const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
    const files = await sourceFiles(sourceRoot);
    const keys = new Set();
    for (const file of files) {
        if (file.includes('/i18n/locales/') || file.endsWith('i18n.test.js')) continue;
        const source = await readFile(file, 'utf8');
        for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) keys.add(match[1]);
    }
    const missing = [...keys].filter(key => (
        !Object.hasOwn(TRANSLATIONS.en, key)
        && !Object.hasOwn(TRANSLATIONS.en, `${key}_one`)
        && !Object.hasOwn(TRANSLATIONS.en, `${key}_other`)
    )).sort();
    assert.deepEqual(missing, []);
});

function placeholders(value) {
    return [...String(value).matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
}

async function sourceFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return ['.js', '.jsx'].includes(extname(path)) ? [path] : [];
    }));
    return nested.flat();
}

test('command reports interpolate variables instead of showing single-braced placeholders', () => {
    for (const locale of ['en', 'fr']) {
        const t = createTranslator(locale);
        for (const key of ['coordinates.units', 'coordinates.ucs', 'plotStyle.list', 'layerManager.states', 'leader.styles', 'dimensionStyle.list', 'dataExtraction.field.attribute', 'dataExtraction.report', 'boundary.created']) {
            const values = { display: 'mm', precision: 2, angle: 'degrees', anglePrecision: 1, insertion: 'm', x: 0, y: 0, rotation: 0, names: 'QA', tag: 'QA', count: 2, groups: 1 };
            assert.doesNotMatch(t(key, values), /\{\w+\}/, `${locale}: ${key}`);
        }
    }
});
