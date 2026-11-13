import { Select } from '~components/ui/Controls';
import React from 'react';
import DrawingCommittedNumberField from './DrawingCommittedNumberField';
import { applyDimensionStyle, normalizeDimensionStyles, retainDimensionStyleOverrides } from '~utils/drawingDimensionStyles';
import { modelToPaperMillimetres, paperMillimetresToModel } from '~utils/drawingDimensionPlacement';

const MIXED = '';

/**
 * Fields shared by every selected dimension: style, text height (paper mm at the
 * plan scale) and, for several linear dimensions, the dimension-line offset.
 * Each change updates the whole selection in one undo step.
 */
export default function DrawingDimensionCommonFields({ content, dimensions, disabled = false, onUpdate, t }) {
    if (!dimensions?.length) return null;
    const styles = normalizeDimensionStyles(content.dimensionStyles);
    const labelled = dimensions.filter(entity => !['centerMark', 'centerLine'].includes(entity.type));
    const styleId = common(dimensions.map(entity => entity.dimensionStyleId || MIXED));
    const textSizes = labelled.map(entity => Number(entity.textSize)).filter(Number.isFinite);
    const textSize = textSizes.length === labelled.length ? common(textSizes) : undefined;
    const linear = dimensions.length > 1 && dimensions.every(entity => entity.type === 'linearDimension' && !entity.seriesId);
    const offset = linear ? common(dimensions.map(entity => Math.abs(Number(entity.offset)))) : undefined;
    const ids = new Set(dimensions.map(entity => entity.id));
    const update = updater => onUpdate(entity => ids.has(entity.id) ? updater(entity) : entity);
    return (
        <section className="drawing-dimension-fields">
            <label className="drawing-sidebar-field">
                <span>{t('dimension.fields.style')}</span>
                <Select disabled={disabled} value={styleId ?? MIXED} onChange={event => {
                    const style = styles.find(candidate => candidate.id === event.target.value);
                    if (style) update(entity => applyDimensionStyle(entity, style));
                }}>
                    {(styleId ?? MIXED) === MIXED && <option value={MIXED}>{t(styleId === MIXED ? 'dimension.fields.noStyle' : 'dimension.fields.mixed')}</option>}
                    {styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
                </Select>
            </label>
            {labelled.length > 0 && (
                <DrawingCommittedNumberField
                    disabled={disabled}
                    label={t('dimension.fields.textHeightPaper')}
                    min={0.01}
                    mixed={textSize === undefined}
                    value={textSize === undefined ? undefined : modelToPaperMillimetres(content, textSize)}
                    onChange={millimetres => {
                        const size = paperMillimetresToModel(content, millimetres);
                        update(entity => ['centerMark', 'centerLine'].includes(entity.type)
                            ? entity
                            : retainDimensionStyleOverrides({ ...entity, textSize: size }, { textSize: size }));
                    }}
                />
            )}
            {linear && (
                <DrawingCommittedNumberField
                    disabled={disabled}
                    label={t('dimension.fields.offset')}
                    mixed={offset === undefined}
                    value={offset}
                    onChange={value => update(entity => {
                        const { linePoint: ignored, ...rest } = entity;
                        // Keep each dimension on its side of the measured object.
                        return { ...rest, offset: (Number(entity.offset) < 0 ? -1 : 1) * Math.abs(value) };
                    })}
                />
            )}
        </section>
    );
}

function common(values) {
    if (!values.length) return undefined;
    const first = values[0];
    return values.every(value => typeof value === 'number' ? Math.abs(value - first) < 1e-9 : value === first) ? first : undefined;
}
