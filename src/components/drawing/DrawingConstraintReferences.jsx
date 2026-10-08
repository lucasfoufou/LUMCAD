import { SelectField } from '~components/drawing/DrawingCreationControls';
import { drawingGripLabel } from '~utils/drawingGripLabels';
import { drawingConstraintReferenceChoices } from '~utils/drawingConstraintEntities';

export function drawingConstraintReferenceLabel(selector, t) {
    if (!selector) return t('constraints.ui.whole');
    const value = selector.replace(/^@/, '');
    const segment = /^(\d+):(start|end)?$/.exec(value);
    if (segment) return `${t('grip.part', { number: Number(segment[1]) + 1 })}${segment[2] ? ` · ${t(`grip.${segment[2]}`)}` : ''}`;
    return drawingGripLabel(value, t);
}

export default function DrawingConstraintReferences({ entities, selectedIds, values, onChange, t }) {
    const options = [['', t('constraints.ui.none')], ...selectedIds.flatMap((id, index) => {
        const entity = entities.get(id);
        return drawingConstraintReferenceChoices(entity).map(selector => [`${index + 1}${selector}`,
            `${index + 1} · ${t(`entity.${entity.type}`)} · ${drawingConstraintReferenceLabel(selector, t)}`]);
    })];
    return values.map((value, index) => <SelectField key={index} label={t('constraints.ui.reference', { number: index + 1 })}
        value={value} options={options} onChange={value => onChange(index, value)} />);
}
