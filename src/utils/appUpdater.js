export const APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
export const APP_UPDATE_CHECK_TIMEOUT_MS = 15_000;

export const INITIAL_APP_UPDATER_STATE = Object.freeze({
    phase: 'idle',
    version: null,
    progress: null,
    error: null,
});

export function reduceAppUpdaterState(state = INITIAL_APP_UPDATER_STATE, action = {}) {
    switch (action.type) {
    case 'check-started':
        return { ...state, phase: 'checking', progress: null, error: null };
    case 'no-update':
        return { ...INITIAL_APP_UPDATER_STATE };
    case 'update-available':
        return {
            phase: 'available',
            version: String(action.version || ''),
            progress: null,
            error: null,
        };
    case 'download-started':
        return { ...state, phase: 'downloading', progress: null, error: null };
    case 'download-progress':
        return { ...state, phase: 'downloading', progress: action.progress || null, error: null };
    case 'install-started':
        return {
            ...state,
            phase: 'installing',
            progress: state.progress ? { ...state.progress, percent: 100, finished: true } : null,
            error: null,
        };
    case 'failed':
        return {
            ...state,
            phase: 'error',
            progress: null,
            error: action.error instanceof Error ? action.error.message : String(action.error || ''),
        };
    default:
        return state;
    }
}

export function nextUpdateDownloadProgress(current, event) {
    const previous = current && typeof current === 'object'
        ? current
        : { downloaded: 0, total: null, percent: null, finished: false };
    if (event?.event === 'Started') {
        const total = positiveFiniteNumber(event.data?.contentLength);
        return {
            downloaded: 0,
            total,
            percent: total ? 0 : null,
            finished: false,
        };
    }
    if (event?.event === 'Progress') {
        const downloaded = previous.downloaded + (positiveFiniteNumber(event.data?.chunkLength) || 0);
        return {
            ...previous,
            downloaded,
            percent: previous.total
                ? Math.min(100, Math.round(downloaded / previous.total * 100))
                : null,
        };
    }
    if (event?.event === 'Finished') {
        return { ...previous, percent: 100, finished: true };
    }
    return previous;
}

export function isAppUpdaterBusy(state) {
    return state?.phase === 'downloading' || state?.phase === 'installing';
}

function positiveFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}
