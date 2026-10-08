import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { createLcadEnvelope } from '~utils/lcadDocument';
import { autosaveLcadDocument, saveLcadDocumentAs, writeLcadDocument } from '~utils/lcadStorage';

export default function useLcadAutosave({ document, filePath, onPathChange, protectedPath = null, protectedPaths = null, delayMs = 900 }) {
    const { t } = useI18n();
    const signature = useMemo(() => JSON.stringify(document), [document]);
    const latestRef = useRef({ document, signature });
    const pathRef = useRef(filePath || null);
    const lastSavedSignatureRef = useRef(signature);
    const failedSignatureRef = useRef(null);
    const timerRef = useRef(null);
    const queueRef = useRef(Promise.resolve());
    const mountedRef = useRef(true);
    const [status, setStatus] = useState('saved');
    const [error, setError] = useState(null);
    const [lastSavedAt, setLastSavedAt] = useState(null);
    const [isRecovery, setIsRecovery] = useState(false);

    latestRef.current = { document, signature };
    pathRef.current = filePath || null;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (timerRef.current) window.clearTimeout(timerRef.current);
        };
    }, []);

    const enqueue = useCallback(task => {
        const queued = queueRef.current.catch(() => null).then(task);
        queueRef.current = queued;
        return queued;
    }, []);

    const persistAutosave = useCallback(snapshot => enqueue(async () => {
        setStatus('saving');
        setError(null);
        try {
            const result = await autosaveLcadDocument(pathRef.current, createLcadEnvelope(snapshot.document));
            lastSavedSignatureRef.current = snapshot.signature;
            failedSignatureRef.current = null;
            if (mountedRef.current) {
                setLastSavedAt(result.savedAt || Date.now());
                setIsRecovery(Boolean(result.recovery));
                setStatus(latestRef.current.signature === snapshot.signature ? 'saved' : 'dirty');
            }
            return result;
        } catch (saveError) {
            failedSignatureRef.current = snapshot.signature;
            if (mountedRef.current) {
                setError(saveError);
                setStatus('error');
            }
            throw saveError;
        }
    }), [enqueue]);

    const saveAtPath = useCallback((path, snapshot) => enqueue(async () => {
        setStatus('saving');
        setError(null);
        try {
            const result = await writeLcadDocument(path, createLcadEnvelope(snapshot.document));
            lastSavedSignatureRef.current = snapshot.signature;
            failedSignatureRef.current = null;
            pathRef.current = result.path || path || null;
            onPathChange(result.path || path || null);
            if (mountedRef.current) {
                setLastSavedAt(result.savedAt || Date.now());
                setIsRecovery(false);
                setStatus(latestRef.current.signature === snapshot.signature ? 'saved' : 'dirty');
            }
            return result;
        } catch (saveError) {
            if (mountedRef.current) {
                setError(saveError);
                setStatus('error');
            }
            throw saveError;
        }
    }), [enqueue, onPathChange]);

    const saveAs = useCallback(async () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        const snapshot = latestRef.current;
        setStatus('saving');
        setError(null);
        try {
            const result = await enqueue(() => saveLcadDocumentAs(
                createLcadEnvelope(snapshot.document),
                snapshot.document.name,
                { filterName: t('fileDialog.lcadDrawing'), protectedPath, protectedPaths: protectedPaths || [] },
            ));
            if (!result) {
                if (mountedRef.current) setStatus(snapshot.signature === lastSavedSignatureRef.current ? 'saved' : 'dirty');
                return null;
            }
            lastSavedSignatureRef.current = snapshot.signature;
            failedSignatureRef.current = null;
            pathRef.current = result.path || null;
            onPathChange(result.path || null);
            if (mountedRef.current) {
                setLastSavedAt(result.savedAt || Date.now());
                setIsRecovery(false);
                setStatus(latestRef.current.signature === snapshot.signature ? 'saved' : 'dirty');
            }
            return result;
        } catch (saveError) {
            if (mountedRef.current) {
                setError(saveError);
                setStatus('error');
            }
            throw saveError;
        }
    }, [enqueue, onPathChange, protectedPath, protectedPaths, t]);

    const saveNow = useCallback(async () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        const snapshot = latestRef.current;
        if (!pathRef.current) return saveAs();
        return saveAtPath(pathRef.current, snapshot);
    }, [saveAs, saveAtPath]);

    const flushAutosave = useCallback(async () => {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        const snapshot = latestRef.current;
        // Always enqueue the visible snapshot. A previous save may still be queued
        // with a different document (for example after an undo), so merely waiting
        // for the queue could leave that intermediate state as the last disk write.
        return persistAutosave(snapshot);
    }, [persistAutosave]);

    useEffect(() => {
        if (signature === lastSavedSignatureRef.current) {
            if (status === 'dirty') setStatus('saved');
            return undefined;
        }
        if (signature === failedSignatureRef.current) return undefined;
        if (status === 'saving') return undefined;
        setStatus(current => current === 'saving' ? current : 'dirty');
        if (timerRef.current) window.clearTimeout(timerRef.current);
        const snapshot = latestRef.current;
        timerRef.current = window.setTimeout(() => {
            persistAutosave(snapshot).catch(() => {});
        }, Math.max(300, Number(delayMs) || 900));
        return () => window.clearTimeout(timerRef.current);
    }, [delayMs, persistAutosave, signature, status]);

    return { status, error, lastSavedAt, isRecovery, flushAutosave, saveNow, saveAs };
}
