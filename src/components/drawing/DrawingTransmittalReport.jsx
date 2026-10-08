import React from 'react';
import { useI18n } from '~i18n/I18nProvider';

export default function DrawingTransmittalReport({ report, t }) {
    const { formatNumber } = useI18n();
    return <div className="drawing-transmittal-report">
        <h4>{t('sheetSet.inventoryTitle')}</h4>
        <p role="status">{t(report.complete ? report.destination ? 'sheetSet.inventorySaved' : 'sheetSet.inventoryComplete' : 'sheetSet.inventoryIncomplete')}</p>
        {report.destination && <p>{report.destination}</p>}
        {report.issue && <p role="alert">
            {report.issue.path && <span>{report.issue.path}: </span>}
            {t(`sheetSet.${report.issue.code}`)}
        </p>}
        <ol>{report.files.map(file => <li key={file.sourcePath}>
            <strong>{file.sourcePath}</strong>
            <div>{file.path}</div>
            <div>{t(`sheetSet.inventoryKind.${file.kind}`)} — {t(file.collected ? 'sheetSet.inventoryCollected' : 'sheetSet.inventoryPending')}</div>
            {file.bytes !== null && <div>{t('sheetSet.inventoryBytes', { count: formatNumber(file.bytes) })}</div>}
        </li>)}</ol>
    </div>;
}
