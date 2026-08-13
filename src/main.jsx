import React, { useCallback, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

import App from './App.jsx';
import { I18nProvider } from './i18n/I18nProvider.jsx';
import { AppSettingsProvider, useAppSettings } from './settings/AppSettingsProvider.jsx';
import { loadAppSettings } from './settings/appSettings.js';
import './style/app.scss';

ReactDOM.createRoot(document.getElementById('root')).render(
    <RootProviders />,
);

function RootProviders() {
    const [initialSettings, setInitialSettings] = useState(null);
    useEffect(() => {
        let disposed = false;
        loadAppSettings().then(settings => {
            if (!disposed) setInitialSettings(settings);
        }).catch(() => {
            if (!disposed) setInitialSettings({});
        });
        return () => { disposed = true; };
    }, []);
    if (!initialSettings) return null;
    return (
        <AppSettingsProvider initialSettings={initialSettings}>
            <LocalizedApp />
        </AppSettingsProvider>
    );
}

function LocalizedApp() {
    const { settings, updateSettings } = useAppSettings();
    const updateLocale = useCallback(language => {
        updateSettings(current => ({ ...current, language })).catch(() => {});
    }, [updateSettings]);
    return (
        <I18nProvider initialLocale={settings.language} onLocaleChange={updateLocale}>
            <App />
        </I18nProvider>
    );
}
