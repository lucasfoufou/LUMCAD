import { useCallback, useEffect, useReducer, useRef } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';

import { isTauriRuntime } from '~utils/lcadStorage';
import {
    APP_UPDATE_CHECK_INTERVAL_MS,
    APP_UPDATE_CHECK_TIMEOUT_MS,
    INITIAL_APP_UPDATER_STATE,
    nextUpdateDownloadProgress,
    reduceAppUpdaterState,
} from '~utils/appUpdater';

export default function useAppUpdater({ beforeInstall } = {}) {
    const [state, dispatch] = useReducer(reduceAppUpdaterState, INITIAL_APP_UPDATER_STATE);
    const beforeInstallRef = useRef(beforeInstall);
    const updateRef = useRef(null);
    const checkPromiseRef = useRef(null);
    const installPromiseRef = useRef(null);
    const mountedRef = useRef(true);
    beforeInstallRef.current = beforeInstall;

    const checkNow = useCallback(() => {
        if (!isTauriRuntime()) return Promise.resolve(null);
        if (installPromiseRef.current) return Promise.resolve(updateRef.current);
        if (checkPromiseRef.current) return checkPromiseRef.current;
        if (mountedRef.current) dispatch({ type: 'check-started' });
        const pending = check({ timeout: APP_UPDATE_CHECK_TIMEOUT_MS })
            .then(async update => {
                if (!mountedRef.current) {
                    await closeUpdate(update);
                    return null;
                }
                const previous = updateRef.current;
                updateRef.current = update;
                if (previous && previous !== update) await closeUpdate(previous);
                dispatch(update
                    ? { type: 'update-available', version: update.version }
                    : { type: 'no-update' });
                return update;
            })
            .catch(error => {
                if (mountedRef.current) dispatch({ type: 'failed', error });
                return null;
            })
            .finally(() => {
                if (checkPromiseRef.current === pending) checkPromiseRef.current = null;
            });
        checkPromiseRef.current = pending;
        return pending;
    }, []);

    const installAvailableUpdate = useCallback(() => {
        if (installPromiseRef.current) return installPromiseRef.current;
        const update = updateRef.current;
        if (!update) return Promise.resolve(false);
        const pending = (async () => {
            dispatch({ type: 'download-started' });
            let progress = null;
            try {
                await beforeInstallRef.current?.();
                await update.downloadAndInstall(event => {
                    progress = nextUpdateDownloadProgress(progress, event);
                    if (!mountedRef.current) return;
                    if (event.event === 'Finished') dispatch({ type: 'install-started' });
                    else dispatch({ type: 'download-progress', progress });
                });
                if (mountedRef.current) dispatch({ type: 'install-started' });
                await relaunch();
                return true;
            } catch (error) {
                if (mountedRef.current) dispatch({ type: 'failed', error });
                return false;
            }
        })().finally(() => {
            if (installPromiseRef.current === pending) installPromiseRef.current = null;
        });
        installPromiseRef.current = pending;
        return pending;
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        if (!isTauriRuntime()) return () => { mountedRef.current = false; };
        checkNow();
        const interval = window.setInterval(checkNow, APP_UPDATE_CHECK_INTERVAL_MS);
        return () => {
            mountedRef.current = false;
            window.clearInterval(interval);
            const update = updateRef.current;
            updateRef.current = null;
            closeUpdate(update);
        };
    }, [checkNow]);

    return { ...state, checkNow, installAvailableUpdate };
}

async function closeUpdate(update) {
    if (!update || typeof update.close !== 'function') return;
    try {
        await update.close();
    } catch {
        // Native updater resources are best-effort during application teardown.
    }
}
