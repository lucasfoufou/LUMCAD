import { useEffect, useState } from 'react';
import { NumberField, CheckboxField, SelectField } from '~components/drawing/DrawingCreationControls';
import { normalizeDrawingDynamicBlock, resolveDrawingDynamicBlockValues } from '~utils/drawingDynamicBlocks';
import { editDrawingDynamicBlockInstances } from '~utils/drawingDynamicBlockOperations';

export default function DrawingBlockParameterFields({ content, reference, disabled, onCommit, t }) {
    const definition = content.blocks.find(block => block.id === reference.blockId);
    const dynamic = definition?.dynamic && normalizeDrawingDynamicBlock(definition.dynamic, definition.entities);
    const [patch, setPatch] = useState({}); const [error, setError] = useState(null);
    useEffect(() => { setPatch({}); setError(null); }, [reference, definition]);
    if (!dynamic || reference.externalReference || reference.pdfUnderlay || reference.dwfUnderlay || reference.dgnUnderlay) return null;
    const values = resolveDrawingDynamicBlockValues(dynamic, { ...reference.dynamicValues, ...patch }) || reference.dynamicValues || {};
    const driven = new Set((dynamic.lookups || []).flatMap(table => Object.keys(table.rows[0].values)));
    const apply = reset => {
        const result = editDrawingDynamicBlockInstances(content, [reference.id], patch, { reset });
        if (result.error) setError(result.error);
        else { setError(null); setPatch({}); if (result.changed !== false) onCommit(result.content); }
    };
    return <fieldset disabled={disabled} className="drawing-block-attribute-fields">
        <legend>{t('commands.blockParameter')}</legend>
        <DrawingBlockParameterInputs parameters={dynamic.parameters} values={{ ...values, ...patch }} driven={driven}
            disabled={disabled} onChange={(name, value) => setPatch(current => ({ ...current, [name]: value }))} />
        {error && <p role="alert">{t(`dynamicBlock.${error}`)}</p>}
        <button type="button" className="drawing-secondary-button" onClick={() => apply(false)}>{t('dynamicBlock.apply')}</button>
        <button type="button" className="drawing-secondary-button" onClick={() => apply(true)}>{t('commands.resetBlock')}</button>
    </fieldset>;
}

export function DrawingBlockParameterInputs({ parameters, values, driven = new Set(), disabled = false, onChange }) {
    return parameters.map(parameter => {
        const value = values[parameter.name] ?? parameter.default;
        const locked = disabled || driven.has(parameter.name);
        const change = value => onChange(parameter.name, value);
        if (parameter.type === 'choice') return <SelectField key={parameter.name} label={parameter.name} value={value}
            options={parameter.choices.map(choice => [choice, choice])} disabled={locked} onChange={change} />;
        if (parameter.type === 'flip') return <CheckboxField key={parameter.name} label={parameter.name} checked={value} disabled={locked} onChange={change} />;
        if (parameter.type === 'point') return <div key={parameter.name}>
            {['x', 'y'].map(axis => <NumberField key={axis} label={`${parameter.name} ${axis.toUpperCase()}`} value={value[axis]}
                disabled={locked} onChange={coordinate => change({ ...value, [axis]: coordinate })} />)}
        </div>;
        return <NumberField key={parameter.name} label={parameter.name} value={value} min={parameter.min} max={parameter.max}
            step={parameter.step ?? 'any'} disabled={locked} onChange={change} />;
    });
}
