import { useEffect, useMemo, useState } from 'react';
import { SelectField, TextField, CheckboxField } from '~components/drawing/DrawingCreationControls';
import DrawingConstraintReferences from '~components/drawing/DrawingConstraintReferences';
import { DRAWING_DIMENSIONAL_COMMANDS, runDrawingDimensionalCommand } from '~utils/drawingDimensionalCommands';
import { normalizeDrawingDimensionalConstraints, drawingDimensionalConstraintResiduals } from '~utils/drawingDimensionalConstraints';

const quote = value => JSON.stringify(String(value));
const commandFor = type => Object.keys(DRAWING_DIMENSIONAL_COMMANDS).find(key => DRAWING_DIMENSIONAL_COMMANDS[key] === type);

function ExpressionEditor({ definition, value, dependencies, onSave, onDelete, children, t }) {
    const [expression, setExpression] = useState(definition.expression);
    useEffect(() => setExpression(definition.expression), [definition.expression]);
    return <form onSubmit={event => { event.preventDefault(); onSave(expression); }}>
        <fieldset className="drawing-block-attribute-fields">
            <legend>{definition.name}</legend>
            <p>{t('parameters.ui.value', { value })}</p>
            <TextField label={t('parameters.ui.expression')} value={expression} onChange={setExpression} />
            {!!dependencies?.length && <p>{t('parameters.ui.dependencies', { names: dependencies.join(', ') })}</p>}
            {children}
            <button type="submit" className="drawing-secondary-button" disabled={!expression.trim()}>{t('parameters.ui.apply')}</button>
            <button type="button" className="drawing-secondary-button" onClick={onDelete}>{t('parameters.ui.delete')}</button>
        </fieldset>
    </form>;
}

export default function DrawingParametersPanel({ content, selectedIds, enabled, onCommit, onSelect, t, locale = 'en' }) {
    const [parameter, setParameter] = useState({ name: '', type: 'distance', expression: '' });
    const [dimension, setDimension] = useState({ name: '', type: 'aligned', expression: '', axis: 'X' });
    const [references, setReferences] = useState(['', '']);
    const [selectionKey, setSelectionKey] = useState(selectedIds.join('|'));
    const [selectionOnly, setSelectionOnly] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const key = selectedIds.join('|');
    if (key !== selectionKey) { setSelectionKey(key); setReferences(['', '']); }
    const entities = useMemo(() => new Map(content.entities.map(entity => [entity.id, entity])), [content.entities]);
    const graph = useMemo(() => normalizeDrawingDimensionalConstraints(content.dimensionalConstraints, content.entities, content.parameters),
        [content.dimensionalConstraints, content.entities, content.parameters]);
    if (!enabled) return <p>{t('dimensional.modelOnly')}</p>;
    if (graph.error) return <p role="alert">{t(`dimensional.${graph.error}`)}</p>;
    const run = (command, input) => {
        const result = runDrawingDimensionalCommand(content, command, input, selectedIds);
        if (result.error) { setFeedback({ error: true, key: `dimensional.${result.error}` }); return false; }
        if (result.changed !== false) onCommit(result.content);
        setFeedback({ key: 'dimensional.updated' }); return true;
    };
    const format = (value, type) => `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 10 }).format(value)}${type === 'angle' ? '°' : type === 'number' ? '' : ' m'}`;
    const referenceCount = ['radius', 'diameter'].includes(dimension.type) ? 1 : 2;
    const selected = new Set(selectedIds);
    const dimensions = graph.constraints.filter(item => !selectionOnly || selected.has(item.dimensionId) || item.refs.some(ref => selected.has(ref.entityId)));
    return <div className="drawing-constraints-panel drawing-parameters-panel">
        <p>{t('parameters.ui.hint')}</p>
        {feedback && <p role={feedback.error ? 'alert' : 'status'}>{t(feedback.key)}</p>}
        <form onSubmit={event => {
            event.preventDefault();
            if ([...graph.parameters, ...graph.constraints].some(item => item.name === parameter.name.trim().toLowerCase())) {
                setFeedback({ error: true, key: 'dimensional.duplicate' }); return;
            }
            if (run('parameters', `SET ${quote(parameter.name)} ${parameter.type} ${quote(parameter.expression)}`)) setParameter(current => ({ ...current, name: '', expression: '' }));
        }}>
            <fieldset className="drawing-block-attribute-fields">
                <legend>{t('parameters.ui.create')}</legend>
                <TextField label={t('parameters.ui.name')} value={parameter.name} maxLength={64} onChange={name => setParameter(current => ({ ...current, name }))} />
                <SelectField label={t('parameters.ui.type')} value={parameter.type}
                    options={['number', 'distance', 'angle'].map(type => [type, t(`dynamicBlock.type.${type}`)])}
                    onChange={type => setParameter(current => ({ ...current, type }))} />
                <TextField label={t('parameters.ui.expression')} value={parameter.expression} onChange={expression => setParameter(current => ({ ...current, expression }))} />
                <button type="submit" className="drawing-secondary-button" disabled={!parameter.name.trim() || !parameter.expression.trim()}>{t('parameters.ui.save')}</button>
            </fieldset>
        </form>
        <details className="drawing-block-attribute-fields">
            <summary>{t('parameters.ui.createDimension')}</summary>
            <form onSubmit={event => {
                event.preventDefault();
                const input = [quote(dimension.name), quote(dimension.expression), ...(dimension.type === 'linear' ? [dimension.axis] : []), ...references.slice(0, referenceCount).filter(Boolean)].join(' ');
                if (run(commandFor(dimension.type), input)) setDimension(current => ({ ...current, name: '', expression: '' }));
            }}>
                <TextField label={t('parameters.ui.name')} value={dimension.name} maxLength={64} onChange={name => setDimension(current => ({ ...current, name }))} />
                <SelectField label={t('constraints.ui.type')} value={dimension.type}
                    options={Object.entries(DRAWING_DIMENSIONAL_COMMANDS).map(([command, type]) => [type, t(`commands.${command}`)])}
                    onChange={type => { setDimension(current => ({ ...current, type })); setReferences(['', '']); }} />
                <TextField label={t('parameters.ui.expression')} value={dimension.expression} onChange={expression => setDimension(current => ({ ...current, expression }))} />
                {dimension.type === 'linear' && <SelectField label={t('parameters.ui.axis')} value={dimension.axis} options={[['X', 'X'], ['Y', 'Y']]}
                    onChange={axis => setDimension(current => ({ ...current, axis }))} />}
                <DrawingConstraintReferences entities={entities} selectedIds={selectedIds} values={references.slice(0, referenceCount)} t={t}
                    onChange={(index, value) => setReferences(current => current.map((previous, position) => position === index ? value : previous))} />
                <button type="submit" className="drawing-secondary-button" disabled={!selectedIds.length || !dimension.name.trim() || !dimension.expression.trim()}>{t('parameters.ui.createDimension')}</button>
            </form>
        </details>
        <fieldset className="drawing-block-attribute-fields">
            <legend>{t('commands.dcConvert')}</legend>
            <p>{t('parameters.ui.convertHint')}</p>
            <button type="button" className="drawing-secondary-button" disabled={!selectedIds.length} onClick={() => run('dcConvert', '')}>{t('commands.dcConvert')}</button>
        </fieldset>
        <h4>{t('commands.parameters')}</h4>
        {!graph.parameters.length && <p>{t('parameters.ui.empty')}</p>}
        {graph.parameters.map(item => <ExpressionEditor key={item.name} definition={item} t={t}
            value={format(graph.values[item.name], item.type)} dependencies={graph.dependencies[item.name]}
            onSave={expression => run('parameters', `SET ${quote(item.name)} ${item.type} ${quote(expression)}`)}
            onDelete={() => run('parameters', `DELETE ${quote(item.name)}`)} />)}
        <h4>{t('commands.dimConstraint')}</h4>
        <CheckboxField label={t('constraints.ui.selectionOnly')} checked={selectionOnly} onChange={setSelectionOnly} />
        {!dimensions.length && <p>{t('parameters.ui.noDimensions')}</p>}
        {dimensions.map(item => {
            const residuals = drawingDimensionalConstraintResiduals(item, entities, graph.values[item.name]);
            const satisfied = residuals?.every(value => Math.abs(value) <= 1e-7);
            return <ExpressionEditor key={item.id} definition={item} t={t} value={format(graph.values[item.name], item.type === 'angular' ? 'angle' : 'distance')}
                dependencies={graph.dependencies[item.name]} onSave={expression => run('dimConstraint', `SET ${quote(item.id)} ${quote(expression)}`)}
                onDelete={() => run('dimConstraint', `DELETE ${quote(item.id)}`)}>
                <p>{t(`commands.${commandFor(item.type)}`)} · {t(satisfied ? 'constraints.ui.satisfied' : 'constraints.ui.unsatisfied')}</p>
                <button type="button" className="drawing-secondary-button" onClick={() => onSelect?.([...new Set([...item.refs.map(ref => ref.entityId), ...(item.dimensionId ? [item.dimensionId] : [])])])}>{t('constraints.ui.select')}</button>
            </ExpressionEditor>;
        })}
    </div>;
}
