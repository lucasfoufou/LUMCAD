import { useCallback } from 'react';

import { updateDrawingLayout } from '~utils/drawingLayouts';
import {
    DRAWING_TITLE_BLOCK_FIELDS,
    applyDrawingSheetSetup,
    drawingPaperFormatLabel,
    formatDrawingScaleLabel,
    getDrawingLayoutScaleDenominator,
    insertDrawingTitleBlock,
} from '~utils/drawingSheetSetup';

/**
 * Sheet setup and title block actions of the layout workspace. Each action is
 * one history commit, so a single Undo restores the previous layout.
 */
export default function useDrawingSheetSetup({ history, layouts, drawingName, designer, locale, setMessage, t }) {
    const titleBlockOptions = useCallback(layout => {
        const scale = getDrawingLayoutScaleDenominator(layout);
        return {
            labels: Object.fromEntries(DRAWING_TITLE_BLOCK_FIELDS.map(field => [field, t(`layout.titleBlock.${field}`)])),
            values: {
                title: String(drawingName || '').trim() || layout.name,
                project: '—',
                revision: 'A',
                scale: scale ? formatDrawingScaleLabel(scale, locale) : '—',
                format: drawingPaperFormatLabel(layout),
                date: new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date()),
                designer: String(designer || '').trim() || '—',
            },
            layerId: history.content.activeLayerId,
        };
    }, [designer, drawingName, history.content.activeLayerId, locale, t]);

    const insertTitleBlock = useCallback(layoutId => {
        const layout = layouts.find(item => item.id === layoutId);
        if (!layout) return false;
        history.commitLayouts(current => updateDrawingLayout(current, layoutId, insertDrawingTitleBlock(layout, titleBlockOptions(layout))));
        setMessage(t('layout.titleBlockInserted'));
        return true;
    }, [history, layouts, setMessage, t, titleBlockOptions]);

    const previewSheetSetup = useCallback((layoutId, { format, orientation, scale, titleBlock }) => {
        const layout = layouts.find(item => item.id === layoutId);
        if (!layout) return null;
        const options = titleBlockOptions({ ...layout, format, orientation });
        return applyDrawingSheetSetup(layout, history.content, {
            format,
            orientation,
            scale,
            titleBlock,
            titleBlockLabels: options.labels,
            titleBlockValues: options.values,
            layerId: options.layerId,
        });
    }, [history.content, layouts, titleBlockOptions]);

    const applySheetSetup = useCallback((layoutId, options) => {
        const result = previewSheetSetup(layoutId, options);
        if (!result) return null;
        history.commitLayouts(current => updateDrawingLayout(current, layoutId, result.layout));
        setMessage(t('layout.sheetSetup.applied', {
            format: drawingPaperFormatLabel(result.layout),
            orientation: t(`layout.sheetSetup.orientation.${result.layout.orientation}`),
            scale: formatDrawingScaleLabel(result.scale, locale),
        }));
        return result;
    }, [history, locale, previewSheetSetup, setMessage, t]);

    return { applySheetSetup, insertTitleBlock, previewSheetSetup };
}
