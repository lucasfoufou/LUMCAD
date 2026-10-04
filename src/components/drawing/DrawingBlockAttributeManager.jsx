import { drawingAttributeDefinitions } from '~utils/drawingBlockAttributes';

export default function DrawingBlockAttributeManager({ block, onManage, t }) {
    const attributes = drawingAttributeDefinitions(block);
    if (!attributes.length) return <p className="drawing-sidebar-empty">{t('attribute.noDefinitions')}</p>;
    return <section aria-label={t('commands.attributeManager')}>
        {attributes.map((entity, index) => {
            const definition = entity.attributeDefinition;
            const change = (operation, value) => onManage(block.id, definition.tag, operation, value);
            return <fieldset className="drawing-block-attribute-fields" key={entity.id}>
                <legend>{definition.tag}</legend>
                {[['TAG', 'attribute.tag', definition.tag, 64], ['PROMPT', 'attribute.prompt', definition.prompt, 256], ['DEFAULT', 'attribute.default', entity.text, 16384]].map(([operation, label, value, maxLength]) => (
                    <label className="drawing-sidebar-field" key={operation}>
                        <span>{t(label)}</span><input key={value} defaultValue={value} maxLength={maxLength}
                            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                            onBlur={event => { if (event.target.value !== value && change(operation, event.target.value) === false) event.target.value = value; }} />
                    </label>
                ))}
                {['constant', 'invisible'].map(option => <label className="drawing-sidebar-check" key={option}>
                    <input type="checkbox" checked={definition[option]} onChange={event => change(option, event.target.checked ? 'ON' : 'OFF')} />{t(`attribute.${option}`)}
                </label>)}
                <button type="button" disabled={index === 0} onClick={() => change('UP')}>{t('attribute.up')}</button>
                <button type="button" disabled={index === attributes.length - 1} onClick={() => change('DOWN')}>{t('attribute.down')}</button>
                <button type="button" onClick={() => change('DELETE')}>{t('attribute.remove')}</button>
            </fieldset>;
        })}
    </section>;
}
