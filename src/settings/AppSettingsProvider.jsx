import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { normalizeAppSettings, saveAppSettings } from './appSettings.js';

const AppSettingsContext = createContext({
    settings: normalizeAppSettings(),
    updateSettings: async () => normalizeAppSettings(),
});

export function AppSettingsProvider({ initialSettings, children }) {
    const [settings, setSettings] = useState(() => normalizeAppSettings(initialSettings));
    const settingsRef = useRef(settings);
    const updateSettings = useCallback(async next => {
        const candidate = normalizeAppSettings(typeof next === 'function' ? next(settingsRef.current) : next);
        const saved = await saveAppSettings(candidate);
        settingsRef.current = saved;
        setSettings(saved);
        return saved;
    }, []);
    const value = useMemo(() => ({ settings, updateSettings }), [settings, updateSettings]);
    return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
    return useContext(AppSettingsContext);
}
