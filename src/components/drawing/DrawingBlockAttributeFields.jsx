import { Button, Input } from '~components/ui/Controls';
import { drawingAttributeDefinitions, drawingAttributeValues } from '~utils/drawingBlockAttributes';
import { editDrawingAttribute, syncDrawingAttributes } from '~utils/drawingAttributeOperations';

export default function DrawingBlockAttributeFields({ content, reference, disabled, onCommit, t }) {
    const block = content.blocks.find(block => block.id === reference.blockId);
    const definitions = drawingAttributeDefinitions(block);
    if (!definitions.length) return null;
    return <fieldset disabled={disabled} className="drawing-block-attribute-fields">
        <legend>{t('attribute.values')}</legend>
        <DrawingAttributeValueInputs block={block} reference={reference} t={t} onChange={(tag, value) => {
            const result = editDrawingAttribute(content, [reference.id], tag, value);
            if (result.content) onCommit(result.content);
        }} />
        <Button type="button" className="drawing-secondary-button" onClick={() => {
            const result = syncDrawingAttributes(content, [reference.id]);
            if (result.content) onCommit(result.content);
        }}>{t('commands.attributeSync')}</Button>
    </fieldset>;
}

export function DrawingAttributeValueInputs({ block, reference, onChange, t }) {
    const values = drawingAttributeValues(block, reference);
    return drawingAttributeDefinitions(block).map(entity => {
        const definition = entity.attributeDefinition;
        const value = values[definition.tag];
        return <label className="drawing-sidebar-field" key={definition.tag}>
            <span>{definition.prompt || definition.tag} ({definition.tag}){definition.constant ? ` — ${t('attribute.constant')}` : ''}</span>
            <Input key={`${reference.id}:${value}`} defaultValue={value} disabled={definition.constant} maxLength={16384}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                onBlur={event => { if (event.target.value !== value) onChange(definition.tag, event.target.value); }} />
        </label>;
    });
}
