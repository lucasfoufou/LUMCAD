import { Button, Input } from '~components/ui/Controls';
import { useState } from 'react';
import DrawingBlockDefinitionEditor from '~components/drawing/DrawingBlockDefinitionEditor';
import { SelectField } from '~components/ui/Fields';
import { DrawingBlockParameterInputs } from '~components/drawing/DrawingBlockParameterFields';
import { runDrawingDynamicBlockCommand } from '~utils/drawingDynamicBlockCommands';

const quote = value => JSON.stringify(String(value));
const valueTokens = (parameter, value) => parameter.type === 'point' ? `${value.x} ${value.y}`
    : parameter.type === 'flip' ? value ? 'ON' : 'OFF' : quote(value);

export default function DrawingBlockVariantEditor({ content, selectedIds, onCommit, t }) {
    const dynamic = content.blockDynamicDraft || { parameters: [], actions: [] };
    const choices = dynamic.parameters.filter(parameter => parameter.type === 'choice');
    const [tableName, setTableName] = useState('');
    const [selectorName, setSelectorName] = useState('');
    const [choiceName, setChoiceName] = useState('');
    const [outputName, setOutputName] = useState('');
    const [draftValue, setDraftValue] = useState(undefined);
    const [error, setError] = useState(null);
    const selector = choices.find(parameter => parameter.name === selectorName) || choices[0];
    const choice = selector?.choices.includes(choiceName) ? choiceName : selector?.choices[0];
    const outputs = dynamic.parameters.filter(parameter => parameter.name !== selector?.name);
    const output = outputs.find(parameter => parameter.name === outputName) || outputs[0];
    const savedRow = (dynamic.lookups || []).find(table => table.name.toLowerCase() === tableName.trim().toLowerCase()
        && table.parameter === selector?.name)?.rows.find(row => row.key === choice);
    const currentValue = draftValue ?? savedRow?.values[output?.name] ?? output?.default;
    const run = (command, input, targets = selectedIds) => {
        const result = runDrawingDynamicBlockCommand(content, command, input, targets, { editing: true });
        setError(result.error || null);
        if (result.content) onCommit(result.content);
    };
    return <section className="drawing-selection-panel">
        <DrawingBlockDefinitionEditor dynamic={dynamic} selectedIds={selectedIds} onCommand={run} t={t} />
        <h3>{t('commands.blockTable')}</h3>
        {!choices.length ? <p>{t('dynamicBlock.choiceRequired')}</p> : <>
            <SelectField label={t('dynamicBlock.selector')} value={selector.name} options={choices.map(parameter => [parameter.name, parameter.name])}
                onChange={value => { setSelectorName(value); setChoiceName(''); setDraftValue(undefined); }} />
            <SelectField label={t('dynamicBlock.variant')} value={choice} options={selector.choices.map(value => [value, value])} onChange={value => { setChoiceName(value); setDraftValue(undefined); }} />
            <fieldset className="drawing-block-attribute-fields">
                <legend>{t('commands.blockVisibility')}</legend>
                <p>{t('dynamicBlock.membership', { count: selectedIds.length })}</p>
                <Button type="button" className="drawing-secondary-button" onClick={() => run('blockVisibility', `SET ${quote(selector.name)} ${quote(choice)}`)}>{t('dynamicBlock.useSelection')}</Button>
                {dynamic.visibility && <Button type="button" className="drawing-secondary-button" onClick={() => run('blockVisibility', 'DELETE')}>{t('dynamicBlock.clearVisibility')}</Button>}
            </fieldset>
            <fieldset className="drawing-block-attribute-fields">
                <legend>{t('commands.blockLookupTable')}</legend>
                <label className="drawing-sidebar-field"><span>{t('dynamicBlock.tableName')}</span>
                    <Input value={tableName} maxLength={64} onChange={event => { setTableName(event.target.value); setDraftValue(undefined); }} /></label>
                {output && <>
                    <SelectField label={t('dynamicBlock.output')} value={output.name} options={outputs.map(parameter => [parameter.name, parameter.name])}
                        onChange={value => { setOutputName(value); setDraftValue(undefined); }} />
                    <DrawingBlockParameterInputs key={`${selector.name}:${output.name}`} parameters={[output]} values={{ [output.name]: currentValue }}
                        onChange={(_, value) => setDraftValue(value)} />
                    <Button type="button" disabled={!tableName.trim()} className="drawing-secondary-button" onClick={() => run('blockLookupTable',
                        `SET ${quote(tableName)} ${quote(selector.name)} ${quote(choice)} ${quote(output.name)} ${valueTokens(output, currentValue)}`)}>{t('dynamicBlock.saveVariant')}</Button>
                </>}
            </fieldset>
        </>}
        {(dynamic.lookups || []).map(table => <fieldset key={table.name} className="drawing-block-attribute-fields">
            <legend>{table.name}</legend>
            {table.rows.map(row => <p key={row.key}>{row.key}: {Object.entries(row.values).map(([name, value]) => `${name} = ${typeof value === 'object' ? `${value.x}, ${value.y}` : value}`).join('; ')}</p>)}
            <Button type="button" className="drawing-secondary-button" onClick={() => {
                setTableName(table.name); setSelectorName(table.parameter); setChoiceName(table.rows[0].key);
                const name = Object.keys(table.rows[0].values)[0]; setOutputName(name); setDraftValue(undefined);
            }}>{t('dynamicBlock.editTable')}</Button>
            <Button type="button" className="drawing-secondary-button" onClick={() => run('blockLookupTable', `DELETE ${quote(table.name)}`)}>{t('dynamicBlock.deleteTable')}</Button>
        </fieldset>)}
        {error && <p role="alert">{t(`dynamicBlock.${error}`)}</p>}
    </section>;
}
