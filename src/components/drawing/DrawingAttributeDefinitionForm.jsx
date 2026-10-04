import { useState } from 'react';

export default function DrawingAttributeDefinitionForm({ onDefine, t }) {
    const [values, setValues] = useState({ tag: '', prompt: '', text: '', x: '0', y: '0', height: '0.35', constant: false, invisible: false });
    const update = (key, value) => setValues(current => ({ ...current, [key]: value }));
    return <details open>
        <summary>{t('commands.attributeDefine')}</summary>
        <form onSubmit={event => {
            event.preventDefault();
            const input = `${values.tag} ${JSON.stringify(values.text)} ${values.x} ${values.y} HEIGHT ${values.height} PROMPT ${JSON.stringify(values.prompt || values.tag)}${values.constant ? ' CONSTANT' : ''}${values.invisible ? ' INVISIBLE' : ''}`;
            onDefine(input);
        }}>
            <fieldset className="drawing-block-attribute-fields">
                <legend>{t('attribute.definition')}</legend>
                {[
                    ['tag', 'attribute.tag', 64], ['prompt', 'attribute.prompt', 256], ['text', 'attribute.default', 16384],
                ].map(([key, label, maxLength]) => <label className="drawing-sidebar-field" key={key}>
                    <span>{t(label)}</span><input value={values[key]} required={key === 'tag'} pattern={key === 'tag' ? '[A-Za-z][A-Za-z0-9_-]{0,63}' : undefined}
                        maxLength={maxLength} onChange={event => update(key, event.target.value)} />
                </label>)}
                {[
                    ['x', 'attribute.positionX', -1e12, 1e12], ['y', 'attribute.positionY', -1e12, 1e12], ['height', 'attribute.height', 0.01, 1e6],
                ].map(([key, label, min, max]) => <label className="drawing-sidebar-field" key={key}>
                    <span>{t(label)}</span><input type="number" step="any" required min={min} max={max} value={values[key]} onChange={event => update(key, event.target.value)} />
                </label>)}
                {['constant', 'invisible'].map(key => <label className="drawing-sidebar-check" key={key}>
                    <input type="checkbox" checked={values[key]} onChange={event => update(key, event.target.checked)} />{t(`attribute.${key}`)}
                </label>)}
                <button type="submit">{t('attribute.create')}</button>
            </fieldset>
        </form>
    </details>;
}
