let pendingDownload = null;
const listeners = new Set();

export const getBrowserDownload = () => pendingDownload;
export function subscribeBrowserDownload(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function dismissBrowserDownload() {
    if (!pendingDownload) return;
    URL.revokeObjectURL(pendingDownload.url);
    pendingDownload = null;
    listeners.forEach(listener => listener());
}

/** Keep one retryable download alive until dismissed or replaced, including after async generation. */
export function downloadBrowserBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    if (pendingDownload) URL.revokeObjectURL(pendingDownload.url);
    pendingDownload = { url, filename };
    listeners.forEach(listener => listener());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    try {
        document.body.appendChild(anchor);
        anchor.click();
    } finally {
        anchor.remove();
    }
}
