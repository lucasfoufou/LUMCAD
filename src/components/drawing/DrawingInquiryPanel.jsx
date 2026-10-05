import { formatDrawingDistance, formatDrawingAngle } from '~utils/drawingCoordinates';
import React from 'react';
import { useI18n } from '~i18n/I18nProvider';

const UNITS = { distance: 'm', dx: 'm', dy: 'm', x: 'm', y: 'm', radius: 'm', perimeter: 'm', totalPerimeter: 'm',
    centroidX: 'm', centroidY: 'm', area: 'm²', totalArea: 'm²', cumulativeArea: 'm²', inertiaX: 'm⁴', inertiaY: 'm⁴', angle: '°' };
const FIELDS = [...Object.keys(UNITS), 'layers', 'blocks', 'selected', 'objects', 'total', 'added', 'removed', 'changed'];

export default function DrawingInquiryPanel({ result, onCopy, settings, t }) {
    const { formatNumber, locale } = useI18n();
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
    return <section className="drawing-inquiry-panel">
        <h3>{t('inquiry.title')}</h3>
        <button type="button" disabled={!result} onClick={onCopy}>{t('inquiry.copy')}</button>
        {result ? <>
            {renderValues(result, 'summary')}
            {Array.isArray(result.rows) && <table><thead><tr><th>{t('selectionQuery.type')}</th><th>{t('selectionQuery.layer')}</th><th>{t('selectionQuery.block')}</th><th>{t('selectionQuery.count')}</th></tr></thead><tbody>
                {result.rows.map((row, index) => <tr key={index}><td>{t(`entity.${row.type}`)}</td><td>{row.layer}</td><td>{row.block}</td><td>{row.count}</td></tr>)}
            </tbody></table>}
            {Array.isArray(result.objects) && result.objects.map((object, index) => renderValues(object, object.id || index))}
            <details><summary>{t('inquiry.details')}</summary><pre tabIndex={0}>{JSON.stringify(result, null, 2)}</pre></details>
        </> : <p>{t('inquiry.empty')}</p>}
    </section>;
}
