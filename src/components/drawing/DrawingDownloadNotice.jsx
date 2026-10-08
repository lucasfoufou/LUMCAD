import React, { useSyncExternalStore } from 'react';
import { getBrowserDownload, subscribeBrowserDownload, dismissBrowserDownload } from '~utils/browserDownload';
import { useI18n } from '~i18n/I18nProvider';

export default function DrawingDownloadNotice() {
    const { t } = useI18n();
    const download = useSyncExternalStore(subscribeBrowserDownload, getBrowserDownload, () => null);
    if (!download) return null;
    return <aside className="drawing-download-notice" aria-label={t('download.ready')}>
        <p role="status">{t('download.ready')}</p>
        <a href={download.url} download={download.filename}>{t('download.file', { name: download.filename })}</a>
        <button type="button" onClick={dismissBrowserDownload}>{t('download.dismiss')}</button>
    </aside>;
}
