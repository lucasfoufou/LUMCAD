import React, { useState } from 'react';
import { DRAWING_LINE_WEIGHT_OPTIONS } from '~utils/drawingDocument';
import { normalizeDrawingPlotStyles } from '~utils/drawingPlotStyles';

export default function DrawingPlotStylesPanel({ content, onCommand, t }) {
    const [name, setName] = useState('');
    const [draft, setDraft] = useState({ sourceColor: '#172033', color: '#000000', lineWeight: 1, screening: 100, lineType: 'continuous' });
    const styles = normalizeDrawingPlotStyles(content.plotStyles);
    const field = (key, value) => setDraft(current => ({ ...current, [key]: value }));
    return <section className="drawing-plot-styles-panel">
        <h3>{t('commands.styleManager')}</h3>
        <label className="drawing-sidebar-field"><span>{t('plotStyle.mode')}</span>
            <select value={content.settings.plotStyleMode || 'off'} onChange={event => onCommand('convertPlotStyles', event.target.value)}>
                {['off', 'color', 'named'].map(mode => <option key={mode} value={mode}>{t(mode === 'color' ? 'plotStyle.colorMode' : `plotStyle.${mode}`)}</option>)}
            </select>
        </label>
        <label className="drawing-sidebar-field"><span>{t('plotStyle.saved')}</span><select value="" onChange={event => {
            const style = styles.find(style => style.name === event.target.value); if (style) { setName(style.name); setDraft(style); }
        }}><option value="">{t('plotStyle.choose')}</option>{styles.map(style => <option key={style.name}>{style.name}</option>)}</select></label>
        <label className="drawing-sidebar-field"><span>{t('plotStyle.name')}</span><input value={name} maxLength={128} onChange={event => setName(event.target.value)} /></label>
        {['sourceColor', 'color'].map(key => <label key={key} className="drawing-sidebar-field"><span>{t(`plotStyle.${key}`)}</span><input type="color" value={draft[key] || '#000000'} onChange={event => field(key, event.target.value)} /></label>)}
        <label className="drawing-sidebar-field"><span>{t('plotStyle.weight')}</span><select value={draft.lineWeight || '-'} onChange={event => field('lineWeight', event.target.value === '-' ? null : Number(event.target.value))}>
            <option value="-">{t('plotStyle.inherit')}</option>{DRAWING_LINE_WEIGHT_OPTIONS.map(value => <option key={value}>{value}</option>)}
        </select></label>
        <label className="drawing-sidebar-field"><span>{t('plotStyle.screening')}</span><input type="number" min={0} max={100} value={draft.screening} onChange={event => field('screening', Number(event.target.value))} /></label>
        <label className="drawing-sidebar-field"><span>{t('plotStyle.lineType')}</span><select value={draft.lineType || '-'} onChange={event => field('lineType', event.target.value === '-' ? null : event.target.value)}>
            <option value="-">{t('plotStyle.inherit')}</option>{['continuous', 'dashed', 'dotted'].map(value => <option key={value} value={value}>{t(`lineType.${value}`)}</option>)}
        </select></label>
        <button type="button" disabled={!name.trim()} onClick={() => onCommand('plotStyle', `SAVE ${JSON.stringify(name)} ${draft.sourceColor || '-'} ${draft.color || '-'} ${draft.lineWeight || '-'} ${draft.screening} ${draft.lineType || '-'}`)}>{t('plotStyle.save')}</button>
        <button type="button" disabled={!styles.some(style => style.name === name)} onClick={() => onCommand('plotStyle', `APPLY ${JSON.stringify(name)}`)}>{t('plotStyle.apply')}</button>
        <button type="button" disabled={!styles.some(style => style.name === name)} onClick={() => onCommand('plotStyle', `DELETE ${JSON.stringify(name)}`)}>{t('plotStyle.delete')}</button>
    </section>;
}
