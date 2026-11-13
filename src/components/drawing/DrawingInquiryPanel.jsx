import { Button, Input } from '~components/ui/Controls';
import DrawingTransmittalReport from './DrawingTransmittalReport';
import DrawingComparisonPreview from './DrawingComparisonPreview';
import { formatDrawingDistance, formatDrawingAngle } from '~utils/drawingCoordinates';
import { formatDrawingCursorPosition } from '~utils/drawingCursorPosition';
import { describeDrawingEntityForList } from '~utils/drawingEntityListing';
import React from 'react';
import { useI18n } from '~i18n/I18nProvider';
import { localizeError } from '~i18n/translator';

const UNITS = { distance: 'm', dx: 'm', dy: 'm', x: 'm', y: 'm', radius: 'm', perimeter: 'm', totalPerimeter: 'm',
    centroidX: 'm', centroidY: 'm', area: 'm²', totalArea: 'm²', cumulativeArea: 'm²', inertiaX: 'm⁴', inertiaY: 'm⁴', angle: '°' };
const FIELDS = [...Object.keys(UNITS), 'layers', 'blocks', 'selected', 'objects', 'total', 'added', 'removed', 'changed'];

export default function DrawingInquiryPanel({ result, layers = [], blocks = [], onCopy, onInspectTransmittal, onSelectDuplicateGroup, onSelectCountOccurrence, settings, t, comparisonPreview, onOpenRecovery, canOpenRecovery = false,
    onSelectRecovery, onShowRecoveryManager, hasRecoveryGraph = false, onShowRecoveryHistory, onRetryRecovery, onForgetRecovery, onRelinkRecovery, canRelinkRecovery = false }) {
    const { formatNumber, formatDate, formatTime, locale } = useI18n();
    const renderValues = (values, key) => <dl key={key}>
        {values.id && <><dt>{t('inquiry.object')}</dt><dd>{values.id}</dd></>}
        {values.name && <><dt>{t('reference.name')}</dt><dd>{values.name}</dd></>}
        {Object.hasOwn(values, 'path') && <><dt>{t('reference.path')}</dt><dd>{values.path || t('reference.snapshot')}</dd></>}
        {typeof values.loaded === 'boolean' && <><dt>{t('reference.status')}</dt><dd>{t(values.loaded ? 'reference.loaded' : 'reference.unloaded')}</dd></>}
        {typeof values.visible === 'boolean' && <><dt>{t('reference.status')}</dt><dd>{t(values.visible ? 'pdf.layerVisible' : 'pdf.layerHidden')}</dd></>}
        {FIELDS.filter(field => typeof values[field] === 'number').map(field => <React.Fragment key={field}>
            <dt>{t(`inquiry.field.${field}`)}</dt>
            <dd>{UNITS[field] ? field === 'angle' ? formatDrawingAngle(values[field], settings, locale) : formatDrawingDistance(values[field], settings, locale, UNITS[field] === 'm²' ? 2 : UNITS[field] === 'm⁴' ? 4 : 1) : formatNumber(values[field], { maximumFractionDigits: 6 })}</dd>
        </React.Fragment>)}
    </dl>;
    const heading = { sheetSet: 'sheetSet.title', standards: 'standards.title', drawingCompare: 'comparison.title', recoveryRelink: 'recovery.relink',
        recoveryHistory: 'recovery.historyTitle', recoveryManager: 'recovery.managerTitle', recovery: 'recovery.title', audit: 'audit.title' }[result?.mode];
    // Recovery tools belong to recovery results; RECOVERYMANAGER opens them otherwise.
    const recoveryResult = String(result?.mode || '').startsWith('recovery');
    const listing = Array.isArray(result?.objects) && result.objects.some(object => object && Object.hasOwn(object, 'layerId'));
    return <section className="drawing-inquiry-panel">
        {/* The window already says "Measurements"; only other results get their own title. */}
        {heading && <h3>{t(heading)}</h3>}
        <Button type="button" disabled={!result} onClick={onCopy}>{t('inquiry.copy')}</Button>
        {hasRecoveryGraph && recoveryResult && result?.mode !== 'recoveryManager' && <Button type="button" onClick={onShowRecoveryManager}>{t('recovery.managerTitle')}</Button>}
        {onShowRecoveryHistory && recoveryResult && result?.mode !== 'recoveryHistory' && <Button type="button" onClick={onShowRecoveryHistory}>{t('recovery.historyTitle')}</Button>}
        {result ? <>
            {!listing && renderValues(result, 'summary')}
            {result.mode === 'sheetSet' && <>
                <p>{t(result.dirty ? 'sheetSet.modified' : 'sheetSet.recorded')}</p>
                {result.checked && <p>{t('sheetSet.checked')}</p>}
                <Button type="button" onClick={onInspectTransmittal}>{t('sheetSet.inspectTransmittal')}</Button>
                {result.transmittal && <DrawingTransmittalReport report={result.transmittal} t={t} />}
                <ol>{result.sheets.map(sheet => <li key={sheet.id}><strong>{sheet.number}</strong> — {sheet.title}</li>)}</ol>
            </>}
            {result.mode === 'standards' && <>
                <p>{result.name}</p><p>{t('standards.result', { count: result.issues.length })}</p>
                <ol>{result.issues.map((issue, index) => <li key={index}>
                    <strong>{t(`standards.kind.${issue.kind}`)}</strong> — {t(`standards.scope.${issue.scope}`)}: {issue.name}
                </li>)}</ol>
            </>}
            {result.mode === 'drawingCompare' && <>
                <DrawingComparisonPreview comparison={comparisonPreview} t={t} />
                <p>{result.path || t('reference.snapshot')}</p>
                <p>{t('comparison.summary', result.counts)}</p>
                <ol>{result.changes.map(change => <li key={`${change.scope}:${change.key}`}>
                    <strong>{t(`comparison.kind.${change.kind}`)}</strong> — {change.scope}: {change.key}
                </li>)}</ol>
            </>}

            {canRelinkRecovery && <Button type="button" onClick={onRelinkRecovery}>{t('recovery.relink')}</Button>}
            {result.mode === 'recoveryRelink' && <>
                <p>{t('recovery.relinkResult', { count: result.changes.length })}</p>
                <p>{t('recovery.referencePaths', { pinned: formatNumber(result.changes.length), unresolved: formatNumber(result.unresolved.length) })}</p>
                <ul>{result.changes.map((change, index) => <li key={index}>{change.from} → {change.to}</li>)}</ul>
            </>}
            {result.mode === 'recoveryHistory' && <>
                <p>{t('recovery.historyExplanation')}</p>
                {!result.entries.length && <p>{t('recovery.historyEmpty')}</p>}
                <ol>{result.entries.map(entry => <li key={entry.id}>
                    <strong>{entry.sourceName}</strong>
                    <div>{entry.sourcePath || t('reference.snapshot')}</div>
                    <time dateTime={new Date(entry.recordedAt).toISOString()}>{formatDate(entry.recordedAt)} {formatTime(entry.recordedAt)}</time>
                    <p>{t('recovery.historySummary', { files: formatNumber(entry.files), ready: formatNumber(entry.ready), issues: formatNumber(entry.issues), quarantined: formatNumber(entry.quarantined) })}</p>
                    {!entry.complete && <p>{t('recovery.historyIncomplete')}</p>}
                    <Button type="button" aria-label={t('recovery.retrySource', { name: entry.sourceName })} onClick={() => onRetryRecovery(entry.id)}>{t('recovery.retry')}</Button>
                    <Button type="button" aria-label={t('recovery.forgetSource', { name: entry.sourceName })} onClick={() => onForgetRecovery(entry.id)}>{t('recovery.forget')}</Button>
                </li>)}</ol>
            </>}
            {result.mode === 'recoveryManager' && <>
                <p role="status">{t(result.complete ? 'recovery.batchComplete' : 'recovery.batchPartial', { count: result.entries.length })}</p>
                {result.limited && <p>{t('recovery.batchLimit')}</p>}
                <ol>{result.entries.map(entry => <li key={entry.id}>
                    <Button type="button" disabled={entry.status === 'failed'} onClick={() => onSelectRecovery(entry.id)}>{entry.path || t('recovery.unknownSource')}</Button>
                    <p>{t(`recovery.status.${entry.status}`)}</p>
                    {entry.savedPath && <p>{t('recovery.savedCopyPath', { path: entry.savedPath })}</p>}
                    {entry.error && <p>{localizeError(entry.error, t, 'recovery.failed')}</p>}
                    {entry.status !== 'failed' && <p>{t('recovery.quarantined', { count: entry.quarantined })}</p>}
                </li>)}</ol>
                <ul>{result.edges.filter(edge => ['cycle', 'failed', 'limit'].includes(edge.status)).map((edge, index) => <li key={index}>
                    {t(`recovery.edge.${edge.status}`)} — {edge.path}
                </li>)}</ul>
            </>}
            {result.mode === 'recovery' && <>
                <p role="status">{t(result.opened ? 'recovery.opened' : result.ready ? 'recovery.ready' : 'recovery.unresolved')}</p>
                {result.opened && <p>{t('recovery.referencePaths', { pinned: formatNumber(result.referencePaths?.length || 0), unresolved: formatNumber(result.unresolvedReferencePaths?.length || 0) })}</p>}
                {!result.opened && <Button type="button" disabled={!canOpenRecovery} onClick={onOpenRecovery}>{t('recovery.openCopy')}</Button>}
                <p>{t('recovery.quarantined', { count: result.quarantine?.length || 0 })}</p>
                <ul>{result.archiveIssues?.map((issue, index) => <li key={index}>
                    {t(`recovery.archive.${issue.code}`)}{issue.path ? ` — ${issue.path}` : ''}
                </li>)}</ul>
            </>}
            {['audit', 'recovery'].includes(result.mode) && <>
                <p role="status">{t(result.valid ? 'audit.clean' : 'audit.found', { count: result.issues.length })}</p>
                {result.repairs && <p>{t('audit.repaired', { count: result.repairs.length })}</p>}
                <ol>{result.issues.map((issue, index) => <li key={index}>
                    <strong>{t(`audit.issue.${issue.code}`)}</strong>
                    <div>{issue.path}</div>
                    {issue.entityId && <div>{t('inquiry.object')}: {issue.entityId}</div>}
                    {issue.reference && <div>{t('audit.reference')}: {String(issue.reference)}</div>}
                </li>)}</ol>
            </>}
            {result.mode === 'countObjects' && result.occurrences.length > 0 && <>
                <Button type="button" onClick={() => onSelectCountOccurrence('PREVIOUS')}>{t('selectionQuery.occurrencePrevious')}</Button>
                <Button type="button" onClick={() => onSelectCountOccurrence('NEXT')}>{t('selectionQuery.occurrenceNext')}</Button>
                <label className="drawing-creation-field"><span>{t('selectionQuery.occurrenceIndex')}</span><Input type="number" min="1" max={result.occurrences.length}
                    value={result.activeOccurrence === undefined ? '' : result.activeOccurrence + 1}
                    onChange={event => { if (event.target.value) onSelectCountOccurrence(Number(event.target.value) - 1); }} /></label>
                {result.activeOccurrence !== undefined && <p role="status">
                    {t('selectionQuery.occurrencePosition', { number: result.activeOccurrence + 1, total: result.occurrences.length })}
                    {' — '}{result.occurrences[result.activeOccurrence].block || t(`entity.${result.occurrences[result.activeOccurrence].type}`)}
                    <br />{result.occurrences[result.activeOccurrence].path.join(' → ')}
                </p>}
            </>}
            {result.mode === 'countDuplicates' && <>
                <p>{t('selectionQuery.duplicateResult', { groups: result.groups.length, count: result.total, examined: result.examined })}</p>
                <p>{t('selectionQuery.duplicateCriteria', { tolerance: result.tolerance })}</p>
                {result.exactOnlyIds?.length > 0 && <p>{t('selectionQuery.duplicateExact', { count: result.exactOnlyIds.length })}</p>}
                {result.nested && <p>{t('selectionQuery.duplicateNested')}</p>}
                {result.unsupportedPaths?.length > 0 && <p>{t('selectionQuery.duplicateClips', { count: result.unsupportedPaths.length })}</p>}
                {result.unsupportedIds.length > 0 && <p>{t('selectionQuery.duplicateUnsupported', { count: result.unsupportedIds.length })}</p>}
                {result.groups.length > 0 && <>
                    <Button type="button" onClick={() => onSelectDuplicateGroup('PREVIOUS')}>{t('selectionQuery.duplicatePrevious')}</Button>
                    <Button type="button" onClick={() => onSelectDuplicateGroup('NEXT')}>{t('selectionQuery.duplicateNext')}</Button>
                </>}
                <ol>{result.groups.map((group, index) => <li key={index}>
                    <Button type="button" aria-pressed={result.activeGroup === index} onClick={() => onSelectDuplicateGroup(index)}>
                        {t('selectionQuery.duplicateGroup', { number: index + 1, count: group.length })}
                    </Button>
                    <div>{group.map(id => result.occurrencePaths?.[id]?.join(' → ') || id).join(', ')}</div>
                </li>)}</ol>
            </>}
            {Array.isArray(result.rows) && <table><thead><tr><th>{t('selectionQuery.type')}</th><th>{t('selectionQuery.layer')}</th><th>{t('selectionQuery.block')}</th><th>{t('selectionQuery.count')}</th></tr></thead><tbody>
                {result.rows.map((row, index) => <tr key={index}><td>{t(`entity.${row.type}`)}</td><td>{row.layer}</td><td>{row.block}</td><td>{row.count}</td></tr>)}
            </tbody></table>}
            {listing && result.objects.map((object, index) => (
                <DrawingListedObject key={object.id || index} entry={describeDrawingEntityForList(object, { layers, blocks })} settings={settings} locale={locale} t={t} />
            ))}
            {!listing && Array.isArray(result.objects) && result.objects.map((object, index) => renderValues(object, object.id || index))}
            <details>
                <summary>{t('inquiry.details')}</summary>
                {listing && <p className="drawing-inquiry-ids">{t('inquiry.objectIds', { ids: result.objects.map(object => object.id).join(', ') })}</p>}
                <pre tabIndex={0}>{JSON.stringify(result, null, 2)}</pre>
            </details>
        </> : <p>{t('inquiry.empty')}</p>}
    </section>;
}

const LISTED_VALUE_EXPONENTS = { length: 1, perimeter: 1, radius: 1, area: 2 };

// One object of a LIST result: type, layer by name, measures and key points.
function DrawingListedObject({ entry, settings, locale, t }) {
    if (!entry) return null;
    return <article className="drawing-inquiry-object">
        <h4>{t(`entity.${entry.type}`)}{entry.blockName ? ` — ${entry.blockName}` : ''}</h4>
        <dl>
            <dt>{t('sidebar.layer')}</dt><dd>{entry.layerName ?? t('inquiry.unknownLayer')}</dd>
            {Object.entries(entry.values).map(([key, value]) => <React.Fragment key={key}>
                <dt>{t(`inquiry.list.${key}`)}</dt>
                <dd>{formatDrawingDistance(value, settings, locale, LISTED_VALUE_EXPONENTS[key])}</dd>
            </React.Fragment>)}
            {entry.points.map(point => <React.Fragment key={point.key}>
                <dt>{t(`inquiry.point.${point.key}`)}</dt>
                <dd>{formatDrawingCursorPosition(point, settings, locale, t)}</dd>
            </React.Fragment>)}
        </dl>
    </article>;
}
