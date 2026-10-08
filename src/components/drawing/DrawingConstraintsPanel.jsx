import DrawingConstraintReferences, { drawingConstraintReferenceLabel as referenceLabel } from '~components/drawing/DrawingConstraintReferences';
import { useMemo, useState } from 'react';
import { CheckboxField, NumberField, SelectField } from '~components/drawing/DrawingCreationControls';
import { DRAWING_CONSTRAINT_COMMANDS, runDrawingConstraintCommand } from '~utils/drawingConstraintCommands';
import { DRAWING_AUTO_CONSTRAINT_TYPES } from '~utils/drawingAutoConstraints';
import { drawingGeometricConstraintResiduals } from '~utils/drawingGeometricConstraints';

const commands = Object.entries(DRAWING_CONSTRAINT_COMMANDS);
const commandFor = type => commands.find(([, value]) => value === type)?.[0];

export default function DrawingConstraintsPanel({ content, selectedIds, onCommit, onSelect, t }) {
    const [type, setType] = useState('horizontal');
    const [references, setReferences] = useState(['', '', '']);
    const [selectionKey, setSelectionKey] = useState(selectedIds.join('|'));
    const [selectionOnly, setSelectionOnly] = useState(true);
    const [internal, setInternal] = useState(false);
    const [tolerance, setTolerance] = useState(0.0001);
    const [angle, setAngle] = useState(0.1);
    const [autoTypes, setAutoTypes] = useState([...DRAWING_AUTO_CONSTRAINT_TYPES]);
    const [preview, setPreview] = useState(null);
    const [feedback, setFeedback] = useState(null);
    const key = selectedIds.join('|');
    // Reset selectors before rendering a different selection; indices must never silently retarget.
    if (selectionKey !== key) { setSelectionKey(key); setReferences(['', '', '']); setPreview(null); setFeedback(null); }
    const entities = useMemo(() => new Map(content.entities.map(entity => [entity.id, entity])), [content.entities]);
    const count = type === 'symmetric' ? 3 : type === 'fix' ? 1 : 2;
    const label = value => t(`commands.${commandFor(value)}`);
    const run = (command, input) => {
        const result = runDrawingConstraintCommand(content, command, input, selectedIds);
        if (result.error) setFeedback({ error: true, key: `constraints.${result.error}` });
        else if (result.report !== undefined) {
            setPreview({ content, key, tolerance, angle, types: autoTypes, candidates: JSON.parse(result.report) });
            setFeedback(null);
        } else {
            if (result.changed !== false) onCommit(result.content);
            setPreview(null); setFeedback({ key: 'constraints.updated', count: result.count });
        }
    };
    const autoInput = `TOLERANCE ${tolerance} ANGLE ${angle} TYPES ${autoTypes.join(',')}`;
    const currentPreview = preview?.content === content && preview.key === key && preview.tolerance === tolerance
        && preview.angle === angle && preview.types === autoTypes ? preview.candidates : null;
    const selected = new Set(selectedIds);
    const listed = (content.geometricConstraints || []).filter(item => !selectionOnly || item.refs.some(ref => selected.has(ref.entityId)));
    const describe = ref => {
        const entity = entities.get(ref.entityId);
        const number = content.entities.findIndex(entity => entity.id === ref.entityId) + 1;
        const selector = ref.part !== undefined ? `@${ref.part}:${ref.point || ''}` : ref.point ? `@${ref.point}` : '';
        return `${number} · ${entity ? t(`entity.${entity.type}`) : t('constraints.ui.none')} · ${referenceLabel(selector, t)}`;
    };
    return <section className="drawing-constraints-panel" aria-label={t('commands.geomConstraint')}>
        <p>{t('constraints.ui.hint')}</p>
        <fieldset className="drawing-block-attribute-fields">
            <legend>{t('constraints.ui.create')}</legend>
            <SelectField label={t('constraints.ui.type')} value={type} options={commands.map(([, type]) => [type, label(type)])}
                onChange={value => { setType(value); setReferences(['', '', '']); setFeedback(null); }} />
            <DrawingConstraintReferences entities={entities} selectedIds={selectedIds} values={references.slice(0, count)} t={t}
                onChange={(index, value) => setReferences(current => current.map((previous, position) => position === index ? value : previous))} />
            {type === 'tangent' && <CheckboxField label={t('constraints.ui.internal')} checked={internal} onChange={setInternal} />}
            <button type="button" className="drawing-secondary-button" disabled={!selectedIds.length}
                onClick={() => run(commandFor(type), `${references.slice(0, count).filter(Boolean).join(' ')}${type === 'tangent' && internal ? ' INTERNAL' : ''}`)}>{t('constraints.ui.create')}</button>
        </fieldset>
        <details className="drawing-block-attribute-fields">
            <summary>{t('commands.autoConstrain')}</summary>
            <NumberField label={t('constraints.ui.tolerance')} value={tolerance} min={0.0000001} max={1} step="any" onChange={setTolerance} />
            <NumberField label={t('constraints.ui.angle')} value={angle} min={0.000001} max={10} step="any" onChange={setAngle} />
            {DRAWING_AUTO_CONSTRAINT_TYPES.map(type => <CheckboxField key={type} label={label(type)} checked={autoTypes.includes(type)}
                onChange={enabled => setAutoTypes(current => enabled ? [...current, type] : current.filter(value => value !== type))} />)}
            <button type="button" className="drawing-secondary-button" disabled={!selectedIds.length || !autoTypes.length}
                onClick={() => run('autoConstrain', `PREVIEW ${autoInput}`)}>{t('constraints.ui.preview')}</button>
            {currentPreview && <div role="status">
                <p>{t('constraints.ui.proposals', { count: currentPreview.length })}</p>
                <ul>{currentPreview.map((item, index) => <li key={index}>{label(item.type)} · {item.refs.map(describe).join(' / ')}</li>)}</ul>
                <button type="button" className="drawing-secondary-button" disabled={!currentPreview.length}
                    onClick={() => run('autoConstrain', autoInput)}>{t('constraints.ui.apply')}</button>
            </div>}
        </details>
        {feedback && <p role={feedback.error ? 'alert' : 'status'}>{t(feedback.key, { count: feedback.count })}</p>}
        <CheckboxField label={t('constraints.ui.selectionOnly')} checked={selectionOnly} onChange={setSelectionOnly} />
        {!listed.length && <p>{t('constraints.ui.empty')}</p>}
        <div className="drawing-constraint-list">{listed.map(item => {
            const residuals = drawingGeometricConstraintResiduals(item, entities);
            const satisfied = residuals?.every(value => Number.isFinite(value) && Math.abs(value) <= 1e-7);
            return <fieldset key={item.id} className="drawing-block-attribute-fields">
                <legend>{label(item.type)}</legend>
                <small>{t(satisfied ? 'constraints.ui.satisfied' : 'constraints.ui.unsatisfied')}</small>
                <p>{item.refs.map(describe).join(' / ')}</p>
                <button type="button" className="drawing-secondary-button" onClick={() => onSelect([...new Set(item.refs.map(ref => ref.entityId))])}>{t('constraints.ui.select')}</button>
                <button type="button" className="drawing-secondary-button" onClick={() => run('geomConstraint', `DELETE ${JSON.stringify(item.id)}`)}>{t('constraints.ui.remove')}</button>
            </fieldset>;
        })}</div>
    </section>;
}
