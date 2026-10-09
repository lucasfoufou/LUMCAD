import React, { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

import DrawingEditorWorkspace from '~components/drawing/DrawingEditorWorkspace';
import AppSettingsDialog from '~components/settings/AppSettingsDialog';
import { useI18n } from '~i18n/I18nProvider';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { localizeError } from '~i18n/translator';
import { createLcadDocument } from '~utils/lcadDocument';
import { clearLcadRecovery, isTauriRuntime, loadStartupLcad, openLcadDocument } from '~utils/lcadStorage';

const BENCHMARK_HARNESS_ENABLED = import.meta.env.DEV || import.meta.env.VITE_LUMCAD_BENCH === '1';

export default function App() {
    const { t } = useI18n();
    const { settings } = useAppSettings();
    const sheetSetSessionRef = useRef(null);
    const initialTranslatorRef = useRef(t);
    const initialDrawingDefaultsRef = useRef(settings.drawingDefaults);
    const [session, setSession] = useState(null);
    const [startupError, setStartupError] = useState(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const replaceSession = useCallback(next => {
        setSession({
            ...next,
            key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        });
        setStartupError(null);
    }, []);

    useEffect(() => {
        let cancelled = false;
        loadStartupLcad()
            .then(loaded => {
                if (cancelled) return;
                replaceSession(loaded
                    ? { document: loaded.envelope.document, path: loaded.path, recovered: loaded.recovered }
                    : { document: createLocalizedDocument(initialTranslatorRef.current, initialDrawingDefaultsRef.current), path: null, recovered: false });
            })
            .catch(error => {
                if (!cancelled) setStartupError(error);
            });
        return () => { cancelled = true; };
    }, [replaceSession]);

    useEffect(() => {
        if (!BENCHMARK_HARNESS_ENABLED) return undefined;
        let disposed = false;
        let uninstall = null;
        import('~dev/benchmarkHarness').then(({ installBenchmarkHarness }) => {
            if (disposed) return;
            uninstall = installBenchmarkHarness({
                loadDocument: document => replaceSession({ document, path: null, recovered: false, sandbox: true }),
            });
        }).catch(() => {});
        return () => {
            disposed = true;
            uninstall?.();
        };
    }, [replaceSession]);

    useEffect(() => {
        if (!isTauriRuntime()) return undefined;
        let unlisten = null;
        let disposed = false;
        listen('lumcad://open-settings', () => setSettingsOpen(true)).then(cleanup => {
            if (disposed) cleanup();
            else unlisten = cleanup;
        }).catch(() => {});
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        const preventWebviewContextMenu = event => event.preventDefault();
        window.addEventListener('contextmenu', preventWebviewContextMenu, { capture: true });
        return () => window.removeEventListener('contextmenu', preventWebviewContextMenu, { capture: true });
    }, []);

    const startFresh = async () => {
        await clearLcadRecovery();
        replaceSession({ document: createLocalizedDocument(t, settings.drawingDefaults), path: null, recovered: false });
    };

    const openFromError = async () => {
        try {
            const loaded = await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
            if (loaded) replaceSession({ document: loaded.envelope.document, path: loaded.path, recovered: loaded.recovered });
        } catch (error) {
            setStartupError(error);
        }
    };

    let content;
    if (startupError) {
        content = (
            <main className="lumcad-startup-error">
                <div>
                    <h1>{t('app.startupErrorTitle')}</h1>
                    <p>{localizeError(startupError, t)}</p>
                    <div className="lumcad-startup-actions">
                        <button type="button" onClick={() => startFresh().catch(setStartupError)}>{t('app.newDrawing')}</button>
                        <button type="button" onClick={() => openFromError().catch(setStartupError)}>{t('app.openLcad')}</button>
                    </div>
                </div>
            </main>
        );
    } else if (!session) {
        content = <main className="lumcad-loading">{t('app.loading')}</main>;
    } else {
        content = <DrawingEditorWorkspace
            key={session.key}
            sheetSetSessionRef={sheetSetSessionRef}
            initialDocument={session.document}
            initialPath={session.path}
            recovered={session.recovered}
            initialRecoveryReport={session.recoveryReport}
            initialRecoveryGraph={session.recoveryGraph}
            initialTemplateSourcePath={session.templateSourcePath}
            initialMessage={session.initialMessage}
            sandbox={Boolean(session.sandbox)}
            onReplaceSession={replaceSession}
            onOpenSettings={() => setSettingsOpen(true)}
        />;
    }

    return (
        <>
            {content}
            <AppSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </>
    );
}

function createLocalizedDocument(t, defaults) {
    return createLcadDocument({
        name: t('document.untitled'),
        layoutName: t('layout.defaultName', { number: 1 }),
        gridSpacing: defaults?.gridSpacing,
        tracking: defaults?.tracking,
    });
}
