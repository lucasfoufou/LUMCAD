import { useState } from 'react';
import { NumberField, SelectField, CheckboxField } from '~components/drawing/DrawingCreationControls';

const quote = value => JSON.stringify(String(value));
const TYPES = ['distance', 'angle', 'number', 'point', 'flip', 'choice'];
const ACTIONS = ['move', 'rotate', 'scale', 'flip', 'stretch', 'array'];
const initialParameter = () => ({ name: '', type: 'distance', value: 1, x: 0, y: 0, choices: '', min: 0, max: 1e9, step: 0 });
const initialAction = () => ({ id: '', type: 'move', parameter: '', x: 1, y: 0, originX: 0, originY: 0,
    minX: 0, minY: 0, maxX: 1, maxY: 1, targets: [], useSelection: true });

export default function DrawingBlockDefinitionEditor({ dynamic, selectedIds, onCommand, t }) {
    const [parameter, setParameter] = useState(initialParameter);
    const [action, setAction] = useState(initialAction);
    const editParameter = patch => setParameter(current => ({ ...current, ...patch }));
    const editAction = patch => setAction(current => ({ ...current, ...patch }));
    const numeric = ['distance', 'angle', 'number'].includes(parameter.type);
    const actionParameter = dynamic.parameters.find(item => item.name === action.parameter) || dynamic.parameters[0];
    const saveParameter = () => {
        let value = parameter.type === 'point' ? `${parameter.x} ${parameter.y}` : parameter.type === 'flip' ? parameter.value ? 'ON' : 'OFF' : quote(parameter.value);
        if (parameter.type === 'choice') value += ` ${parameter.choices.split('\n').filter(Boolean).map(quote).join(' ')}`;
        if (numeric) value += ` MIN ${parameter.min} MAX ${parameter.max}${parameter.step ? ` STEP ${parameter.step}` : ''}`;
        onCommand('blockParameter', `SET ${quote(parameter.name)} ${parameter.type} ${value}`);
    };
    const saveAction = () => {
        const tokens = ['SET', quote(action.id), action.type, quote(actionParameter.name)];
        if (['move', 'stretch'].includes(action.type) && actionParameter.type !== 'point' || action.type === 'array') tokens.push(action.x, action.y);
        if (['rotate', 'scale', 'flip'].includes(action.type)) tokens.push(action.originX, action.originY);
        if (action.type === 'flip') tokens.push(action.x, action.y);
        if (action.type === 'stretch') tokens.push(action.minX, action.minY, action.maxX, action.maxY);
        onCommand('blockAction', tokens.join(' '), action.useSelection ? selectedIds : action.targets);
    };
    return <>
        <details className="drawing-block-attribute-fields">
            <summary>{t('commands.blockParameter')}</summary>
            <SelectField label={t('dynamicBlock.editParameter')} value={dynamic.parameters.some(item => item.name === parameter.name) ? parameter.name : ''}
                options={ [['', t('dynamicBlock.newParameter')], ...dynamic.parameters.map(item => [item.name, item.name])] }
                onChange={name => {
                    const source = dynamic.parameters.find(item => item.name === name);
                    setParameter(source ? { name, type: source.type, value: source.default, x: source.default?.x ?? 0, y: source.default?.y ?? 0,
                        choices: source.choices?.join('\n') || '', min: source.min ?? 0, max: source.max ?? 1e9, step: source.step ?? 0 } : initialParameter());
                }} />
            <label className="drawing-sidebar-field"><span>{t('dynamicBlock.parameterName')}</span><input value={parameter.name} maxLength={64} onChange={event => editParameter({ name: event.target.value })} /></label>
            <SelectField label={t('dynamicBlock.parameterType')} value={parameter.type} options={TYPES.map(type => [type, t(`dynamicBlock.type.${type}`)])}
                onChange={type => editParameter({ type, value: type === 'flip' ? false : type === 'choice' ? '' : 1, min: type === 'distance' ? 0 : -1e9 })} />
            {numeric && <>
                <NumberField label={t('dynamicBlock.defaultValue')} value={parameter.value} onChange={value => editParameter({ value })} />
                <NumberField label={t('dynamicBlock.minimum')} value={parameter.min} onChange={min => editParameter({ min })} />
                <NumberField label={t('dynamicBlock.maximum')} value={parameter.max} onChange={max => editParameter({ max })} />
                <NumberField label={t('dynamicBlock.increment')} value={parameter.step} min={0} onChange={step => editParameter({ step })} />
            </>}
            {parameter.type === 'point' && ['x', 'y'].map(axis => <NumberField key={axis} label={`${t('dynamicBlock.defaultValue')} ${axis.toUpperCase()}`} value={parameter[axis]} onChange={value => editParameter({ [axis]: value })} />)}
            {parameter.type === 'flip' && <CheckboxField label={t('dynamicBlock.defaultValue')} checked={parameter.value} onChange={value => editParameter({ value })} />}
            {parameter.type === 'choice' && <>
                <label className="drawing-sidebar-field"><span>{t('dynamicBlock.defaultValue')}</span><input value={parameter.value} onChange={event => editParameter({ value: event.target.value })} /></label>
                <label className="drawing-sidebar-field"><span>{t('dynamicBlock.choices')}</span><textarea rows={4} value={parameter.choices} onChange={event => editParameter({ choices: event.target.value })} /></label>
            </>}
            <button type="button" className="drawing-secondary-button" disabled={!parameter.name} onClick={saveParameter}>{t('dynamicBlock.saveParameter')}</button>
            <button type="button" className="drawing-secondary-button" disabled={!dynamic.parameters.some(item => item.name === parameter.name)} onClick={() => onCommand('blockParameter', `DELETE ${quote(parameter.name)}`)}>{t('dynamicBlock.deleteParameter')}</button>
        </details>
        <details className="drawing-block-attribute-fields">
            <summary>{t('commands.blockAction')}</summary>
            {!actionParameter ? <p>{t('dynamicBlock.parameterRequired')}</p> : <>
                <SelectField label={t('dynamicBlock.editAction')} value={dynamic.actions.some(item => item.id === action.id) ? action.id : ''}
                    options={ [['', t('dynamicBlock.newAction')], ...dynamic.actions.map(item => [item.id, item.id])] }
                    onChange={id => {
                        const source = dynamic.actions.find(item => item.id === id);
                        const vector = source?.direction || source?.offset || source?.axisEnd;
                        setAction(source ? { ...initialAction(), id, type: source.type, parameter: source.parameter, targets: source.targets, useSelection: false,
                            x: vector?.x ?? 1, y: vector?.y ?? 0, originX: source.origin?.x ?? 0, originY: source.origin?.y ?? 0,
                            ...source.window } : initialAction());
                    }} />
                <label className="drawing-sidebar-field"><span>{t('dynamicBlock.actionName')}</span><input value={action.id} maxLength={64} onChange={event => editAction({ id: event.target.value })} /></label>
                <SelectField label={t('dynamicBlock.actionType')} value={action.type} options={ACTIONS.map(type => [type, t(`dynamicBlock.action.${type}`)])} onChange={type => editAction({ type })} />
                <SelectField label={t('dynamicBlock.actionParameter')} value={actionParameter.name} options={dynamic.parameters.map(item => [item.name, item.name])} onChange={parameter => editAction({ parameter })} />
                <CheckboxField label={t('dynamicBlock.actionSelection')} checked={action.useSelection} onChange={useSelection => editAction({ useSelection })} />
                <p>{t('dynamicBlock.targetCount', { count: action.useSelection ? selectedIds.length : action.targets.length })}</p>
                {(['move', 'stretch'].includes(action.type) && actionParameter.type !== 'point' || ['array', 'flip'].includes(action.type)) && ['x', 'y'].map(axis =>
                    <NumberField key={axis} label={`${t(action.type === 'flip' ? 'dynamicBlock.axisEnd' : action.type === 'array' ? 'dynamicBlock.spacing' : 'dynamicBlock.direction')} ${axis.toUpperCase()}`}
                        value={action[axis]} onChange={value => editAction({ [axis]: value })} />)}
                {['rotate', 'scale', 'flip'].includes(action.type) && ['X', 'Y'].map(axis => <NumberField key={axis} label={`${t('dynamicBlock.origin')} ${axis}`} value={action[`origin${axis}`]} onChange={value => editAction({ [`origin${axis}`]: value })} />)}
                {action.type === 'stretch' && ['minX', 'minY', 'maxX', 'maxY'].map(key => <NumberField key={key} label={t(`dynamicBlock.window.${key}`)} value={action[key]} onChange={value => editAction({ [key]: value })} />)}
                <button type="button" className="drawing-secondary-button" disabled={!action.id} onClick={saveAction}>{t('dynamicBlock.saveAction')}</button>
                <button type="button" className="drawing-secondary-button" disabled={!dynamic.actions.some(item => item.id === action.id)} onClick={() => onCommand('blockAction', `DELETE ${quote(action.id)}`)}>{t('dynamicBlock.deleteAction')}</button>
            </>}
        </details>
    </>;
}
