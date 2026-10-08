import React, { useMemo } from 'react';
import DrawingContentPreview from './DrawingContentPreview';
import { drawingComparisonHighlights, drawingComparisonViewBox } from '~utils/drawingComparisonVisual';

export default function DrawingComparisonPreview({ comparison, t }) {
    const visual = useMemo(() => {
        if (!comparison) return null;
        const { baseline, incoming, report } = comparison;
        try {
            return { viewBox: drawingComparisonViewBox(baseline, incoming),
                before: drawingComparisonHighlights(baseline, report), after: drawingComparisonHighlights(incoming, report) };
        } catch { return null; }
    }, [comparison]);
    if (!comparison) return null;
    if (!visual) return <p>{t('comparison.comparisonLimit')}</p>;
    return <div className="drawing-comparison-preview">
        <p>{t('comparison.previewHint')}</p>
        {[['before', comparison.baseline], ['after', comparison.incoming]].map(([side, document]) => <div key={side}>
            <h4>{t(`comparison.${side}`)}</h4>
            <DrawingContentPreview content={document.content} assets={document.assets} viewBox={visual.viewBox}
                highlightedIds={visual[side]} label={t(`comparison.${side}`)} />
        </div>)}
    </div>;
}
