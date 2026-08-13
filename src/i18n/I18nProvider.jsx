import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
    BASE_LOCALE,
    LOCALE_TAGS,
    createTranslator,
    formatLocalizedNumber,
    normalizeLocale,
} from './translator.js';

const defaultTranslator = createTranslator(BASE_LOCALE);
const I18nContext = createContext({
    locale: BASE_LOCALE,
    localeTag: LOCALE_TAGS[BASE_LOCALE],
    setLocale: () => {},
    t: defaultTranslator,
    formatNumber: value => formatLocalizedNumber(value),
    formatTime: value => new Intl.DateTimeFormat(LOCALE_TAGS[BASE_LOCALE], { hour: '2-digit', minute: '2-digit' }).format(new Date(value)),
    formatDate: value => formatDateValue(value, BASE_LOCALE),
});

export function I18nProvider({ initialLocale = BASE_LOCALE, onLocaleChange = null, children }) {
    const [locale, setLocaleState] = useState(() => normalizeLocale(initialLocale));
    const setLocale = useCallback(value => {
        const nextLocale = normalizeLocale(value);
        setLocaleState(nextLocale);
        onLocaleChange?.(nextLocale);
    }, [onLocaleChange]);
    const value = useMemo(() => {
        const localeTag = LOCALE_TAGS[locale];
        return {
            locale,
            localeTag,
            setLocale,
            t: createTranslator(locale),
            formatNumber: (number, options) => formatLocalizedNumber(number, locale, options),
            formatTime: date => new Intl.DateTimeFormat(localeTag, { hour: '2-digit', minute: '2-digit' }).format(new Date(date)),
            formatDate: date => formatDateValue(date, locale),
        };
    }, [locale, setLocale]);

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    return useContext(I18nContext);
}

function formatDateValue(value, locale) {
    if (!value) return '-';
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    if (!match) return String(value);
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat(LOCALE_TAGS[normalizeLocale(locale)], { timeZone: 'UTC' }).format(date);
}
