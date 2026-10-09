import { Button, Input, Select } from '~components/ui/Controls';
import { DrawingDimensionFormatFields } from './DrawingDimensionFields';
import { useState } from 'react';

import { DIMENSION_ARROW_TYPES, deleteDimensionStyle, normalizeDimensionStyles } from '~utils/drawingDimensionStyles';
import { isDrawingDimensionEntity } from '~utils/drawingDimensions';
import { canEditEntity } from '~utils/drawingDocument';

export default function DrawingDimensionStylesPanel({ content, selectedIds, onCommand, t }) {
    const styles = normalizeDimensionStyles(content.dimensionStyles);
    const [selectedId, setSelectedId] = useState(content.activeDimensionStyleId);
    const [newName, setNewName] = useState('');
    const selected = styles.find(style => style.id === selectedId) || styles[0];
    const name = JSON.stringify(selected.name);
    const selectedIdSet = new Set(selectedIds);
    const selectedEntities = content.entities.filter(entity => selectedIdSet.has(entity.id));
    const canApply = selectedEntities.length > 0 && selectedEntities.every(entity => isDrawingDimensionEntity(entity) && canEditEntity(content, entity));
    const editFormat = patch => {
        const fields = {
            tolerance: { mode: 'TOLERANCE', upper: 'TOLUPPER', lower: 'TOLLOWER', precision: 'TOLPRECISION' },
            alternateUnits: { enabled: 'ALTERNATE', unit: 'ALTUNIT', precision: 'ALTPRECISION' },
            inspection: { enabled: 'INSPECTION', label: 'INSPECTLABEL', rate: 'INSPECTRATE' },
        };
        for (const [group, values] of Object.entries(patch)) {
            for (const [key, value] of Object.entries(values)) {
                if (value === selected.dimensionFormat[group][key]) continue;
                const argument = typeof value === 'boolean' ? value ? 'ON' : 'OFF' : JSON.stringify(value);
                onCommand(`SET ${name} ${fields[group][key]} ${argument}`);
            }
        }
    };
    return <section className="drawing-dimension-styles-panel" aria-label={t('commands.dimensionStyle')}>
        <header className="drawing-sidebar-heading"><strong>{t('commands.dimensionStyle')}</strong></header>
        <label className="drawing-sidebar-field"><span>{t('dimensionStyle.choose')}</span>
            <Select value={selected.id} onChange={event => setSelectedId(event.target.value)}>
                {styles.map(style => <option value={style.id} key={style.id}>{style.name}{style.id === content.activeDimensionStyleId ? ` (${t('dimensionStyle.current')})` : ''}</option>)}
            </Select>
        </label>
        <label className="drawing-sidebar-field"><span>{t('dimensionStyle.rename')}</span><Input key={`${selected.id}:${selected.name}`} defaultValue={selected.name} maxLength={128}
            onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            onBlur={event => { if (event.target.value !== selected.name && !onCommand(`RENAME ${name} ${JSON.stringify(event.target.value)}`)) event.target.value = selected.name; }} /></label>
        <form onSubmit={event => { event.preventDefault(); if (onCommand(`SAVE ${JSON.stringify(newName)}`)) setNewName(''); }}>
            <label className="drawing-sidebar-field"><span>{t('dimensionStyle.newName')}</span><Input required maxLength={128} value={newName} onChange={event => setNewName(event.target.value)} /></label>
            <Button type="submit">{t('dimensionStyle.create')}</Button>
        </form>
        <Button type="button" disabled={selected.id === content.activeDimensionStyleId} onClick={() => onCommand(`CURRENT ${name}`)}>{t('dimensionStyle.makeCurrent')}</Button>
        <Button type="button" disabled={!canApply} onClick={() => onCommand(`APPLY ${name}`)}>{t('dimensionStyle.apply')}</Button>
        <fieldset className="drawing-block-attribute-fields" key={selected.id}>
            <legend>{t('dimensionStyle.parameters')}</legend>
            {[
                ['TEXT', 'textSize', 0.01, 1e6], ['ARROWSIZE', 'arrowSize', 0, 1e6], ['GAP', 'extensionGap', 0, 1e6], ['OVERRUN', 'extensionOverrun', 0, 1e6],
            ].map(([field, key, min, max]) => <label className="drawing-sidebar-field" key={key}>
                <span>{t(`dimensionStyle.${key}`)}</span><Input key={selected[key]} type="number" step="any" min={min} max={max} defaultValue={selected[key]}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                    onBlur={event => {
                        if (Number(event.target.value) !== selected[key] && (!event.target.value || !onCommand(`SET ${name} ${field} ${event.target.value}`))) event.target.value = selected[key];
                    }} />
            </label>)}
            <label className="drawing-sidebar-field"><span>{t('dimensionStyle.arrowType')}</span>
                <Select value={selected.arrowType} onChange={event => onCommand(`SET ${name} ARROW ${event.target.value}`)}>
                    {DIMENSION_ARROW_TYPES.map(type => <option key={type} value={type}>{t(`dimensionStyle.arrow.${type}`)}</option>)}
                </Select>
            </label>
            <label className="drawing-sidebar-field"><span>{t('dimensionStyle.precision')}</span>
                <Select value={selected.dimensionFormat.precision} onChange={event => onCommand(`SET ${name} PRECISION ${event.target.value}`)}>
                    {Array.from({ length: 9 }, (_, value) => <option key={value} value={value}>{value}</option>)}
                </Select>
            </label>
            {['prefix', 'suffix'].map(key => <label className="drawing-sidebar-field" key={key}>
                <span>{t(`dimensionStyle.${key}`)}</span><Input key={selected.dimensionFormat[key]} defaultValue={selected.dimensionFormat[key]} maxLength={256}
                    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                    onBlur={event => { if (event.target.value !== selected.dimensionFormat[key] && !onCommand(`SET ${name} ${key.toUpperCase()} ${JSON.stringify(event.target.value)}`)) event.target.value = selected.dimensionFormat[key]; }} />
            </label>)}
            <p className="drawing-sidebar-empty">{t('dimensionStyle.toleranceUnits')}</p>
            <DrawingDimensionFormatFields format={selected.dimensionFormat} onChange={editFormat} t={t} />
        </fieldset>
        <Button type="button" disabled={Boolean(deleteDimensionStyle(content, selected.id).error)} onClick={() => onCommand(`DELETE ${name}`)}>{t('dimensionStyle.delete')}</Button>
    </section>;
}
