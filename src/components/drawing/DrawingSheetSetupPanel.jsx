import { Input, Select } from '~components/ui/Controls';
import React from 'react';

import { useI18n } from '~i18n/I18nProvider';
import {
    DRAWING_NEW_LAYOUT_FORMAT,
    DRAWING_ORIENTATION_OPTIONS,
    DRAWING_STANDARD_PAPER_FORMAT_OPTIONS,
    DRAWING_VIEWPORT_SCALE_OPTIONS,
} from '~utils/drawingLayouts';
import {
    DRAWING_SHEET_SETUP_FIT_SCALE,
    formatDrawingScaleLabel,
    getDrawingLayoutScaleDenominator,
    getDrawingSheetModelExtent,
    getDrawingSheetSetupRects,
    isDrawingTitleBlockEntity,
    resolveDrawingSheetScale,
} from '~utils/drawingSheetSetup';

/** Initial "put the model on a sheet" choices for one layout. */
export function getDrawingSheetSetupDefaults(layout) {
    const hasViewports = layout.viewports.length > 0;
    const scale = getDrawingLayoutScaleDenominator(layout);
    const standardScale = DRAWING_VIEWPORT_SCALE_OPTIONS.find(value => scale && Math.abs(value - scale) < 1e-6);
    return {
        format: hasViewports && DRAWING_STANDARD_PAPER_FORMAT_OPTIONS.includes(layout.format) ? layout.format : DRAWING_NEW_LAYOUT_FORMAT,
        orientation: hasViewports ? layout.orientation : 'landscape',
        scale: standardScale || DRAWING_SHEET_SETUP_FIT_SCALE,
        titleBlock: !hasViewports || (layout.paperEntities || []).some(isDrawingTitleBlockEntity),
    };
}

/** Form of the "Page setup" step: paper size, orientation, scale, title block. */
export default function DrawingSheetSetupPanel({ content, layout, onChange, value }) {
    const { locale, t } = useI18n();
    const rects = getDrawingSheetSetupRects({ ...layout, format: value.format, orientation: value.orientation }, { titleBlock: value.titleBlock });
    const extent = getDrawingSheetModelExtent(content);
    const fitScale = resolveDrawingSheetScale(DRAWING_SHEET_SETUP_FIT_SCALE, extent, rects.viewport);
    const scale = resolveDrawingSheetScale(value.scale, extent, rects.viewport);
    const update = patch => onChange({ ...value, ...patch });
    return (
        <div className="drawing-sheet-setup" aria-label={t('layout.sheetSetup.title')} role="group">
            <h2>{t('layout.sheetSetup.title')}</h2>
            <p className="drawing-publish-help">{t(layout.viewports.length ? 'layout.sheetSetup.introExisting' : 'layout.sheetSetup.intro')}</p>
            <label className="drawing-publish-field">
                <span>{t('layout.sheetSetup.format')}</span>
                <Select value={value.format} onChange={event => update({ format: event.target.value })}>
                    {DRAWING_STANDARD_PAPER_FORMAT_OPTIONS.map(format => <option key={format} value={format}>{format}</option>)}
                </Select>
            </label>
            <label className="drawing-publish-field">
                <span>{t('layout.orientation')}</span>
                <Select value={value.orientation} onChange={event => update({ orientation: event.target.value })}>
                    {DRAWING_ORIENTATION_OPTIONS.map(orientation => <option key={orientation} value={orientation}>{t(`layout.orientation.${orientation}`)}</option>)}
                </Select>
            </label>
            <label className="drawing-publish-field">
                <span>{t('layout.sheetSetup.scale')}</span>
                <Select value={String(value.scale)} onChange={event => update({
                    scale: event.target.value === DRAWING_SHEET_SETUP_FIT_SCALE ? DRAWING_SHEET_SETUP_FIT_SCALE : Number(event.target.value),
                })}>
                    <option value={DRAWING_SHEET_SETUP_FIT_SCALE}>{t('layout.sheetSetup.fit', { scale: formatDrawingScaleLabel(fitScale, locale) })}</option>
                    {DRAWING_VIEWPORT_SCALE_OPTIONS.map(option => <option key={option} value={option}>{formatDrawingScaleLabel(option, locale)}</option>)}
                </Select>
            </label>
            {scale < fitScale - 1e-6 && (
                <p className="drawing-publish-help is-warning" role="status">{t('layout.sheetSetup.tooLarge', { scale: formatDrawingScaleLabel(scale, locale) })}</p>
            )}
            <label className="drawing-publish-toggle">
                <Input type="checkbox" checked={value.titleBlock} onChange={event => update({ titleBlock: event.target.checked })} />
                <span>{t('layout.sheetSetup.titleBlock')}</span>
            </label>
            <p className="drawing-publish-help">{t('layout.sheetSetup.lockedHint')}</p>
        </div>
    );
}
