# Translating LUMCAD

LUMCAD uses a small built-in internationalization layer. English (`en`) is the source language and the fallback whenever a locale or translation key is unavailable. French (`fr`) is included as the first complete translation.

## Where translations live

Runtime text is stored in flat JavaScript catalogs:

- `src/i18n/locales/en.js` — canonical English source catalog;
- `src/i18n/locales/fr.js` — French catalog;
- `src/i18n/translator.js` — locale registry, fallback, interpolation, plural rules, and localized error handling;
- `src/i18n/I18nProvider.jsx` — React context, persisted language preference, and date/number formatters.

The selected locale is stored under `lumcad.locale`. A first launch uses English. Changing the language updates the interface immediately and the choice is restored on the next launch.

## Adding or changing interface text

1. Add a descriptive key to `src/i18n/locales/en.js`. English wording is always written first.
2. Add the same key to every other locale catalog.
3. In a React component or hook, obtain the translator with `const { t } = useI18n()` and render `t('your.key')`.
4. Never place a user-facing fallback string next to `t()`. Missing translations must fall back to the English catalog, not to an isolated component string.

Use namespaced keys that describe their purpose rather than their English wording:

```js
// Catalog
'sidebar.deleteEmptyLayer': 'Delete empty layer',

// Component
title={t('sidebar.deleteEmptyLayer')}
```

Brand names, command tokens (`LINE`, `TRIM`, `BASE`), file extensions, SI units, and user-entered drawing content are data rather than translated interface copy.

## Variables and plural forms

Variables use double braces and must be identical in every locale:

```js
'messages.unknownCommand': 'Unknown command: {{command}}',

t('messages.unknownCommand', { command: 'ABC' });
```

For counted text, provide `_one` and `_other` variants and pass `count`:

```js
'sidebar.objectCount_one': '{{count}} object',
'sidebar.objectCount_other': '{{count}} objects',

t('sidebar.objectCount', { count: 3 });
```

English and French use the singular form only for exactly `1`; zero uses the plural form. The translator uses `Intl.PluralRules` for additional locales.

## Dates and numbers

Use the formatters returned by `useI18n()` instead of hard-coding separators or locale tags:

```js
const { formatDate, formatNumber, formatTime, locale } = useI18n();
```

Drawing geometry helpers that cannot use React accept a locale argument. Their default is English.

## Commands and operation options

Command names and aliases remain stable so drawings and user habits are portable between languages. Their descriptive labels use translation keys in:

- `src/utils/drawingCommands.js`;
- `src/utils/drawingOperationOptions.js`.

Localized aliases may be accepted as additional input tokens, but the canonical full command name remains English.

## Errors from JavaScript and Rust

For a JavaScript error that may reach the interface, use `createI18nError(key, values)` and display it through `localizeError(error, t, fallbackKey)`.

Rust storage commands return structured error codes instead of complete sentences. Add a new Rust code to `STORAGE_ERROR_KEYS` in `src/i18n/translator.js`, then add its English and translated catalog entries. Paths and operating-system details are passed as interpolation values.

## Adding another language

1. Copy `src/i18n/locales/en.js` to a new file such as `de.js` and translate every value without changing keys or placeholders.
2. Import the catalog in `src/i18n/translator.js`.
3. Add the locale code to `SUPPORTED_LOCALES`, its `Intl` tag to `LOCALE_TAGS`, and the catalog to `TRANSLATIONS`.
4. Add a self-language name key (for example `language.german`) to every catalog and add the option to the language selector in `DrawingEditorHeader.jsx`.
5. Check the interface at the minimum supported window size; translated labels often require more horizontal space.

## Validation checklist

Run the complete local checks:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

`src/utils/i18n.test.js` verifies that every locale has exactly the English keys, no blank values, matching interpolation variables, working pluralization, and English fallback behavior.

Before submitting a translation, also verify:

- startup, recovery, and error screens;
- file actions and native file-dialog labels;
- toolbar tooltips and accessible names;
- command autocomplete, operation options, and status messages;
- object-snap markers and array controls on the canvas;
- both sidebar tabs;
- layout creation, viewport editing, and single/all-layout PDF export;
- language persistence after restarting LUMCAD.
