import React from 'react';

import { DrawingToolButton } from '~components/drawing/DrawingToolbar';
import { useI18n } from '~i18n/I18nProvider';

export default function DrawingLayoutToolbar({ activeTool, hasSelection, onToolChange, onDelete, onFitPaper, onScale, onZoomIn, onZoomOut }) {
    const { t } = useI18n();
    return (
        <aside className="drawing-toolbar drawing-layout-toolbar" aria-label={t('layout.tools')}>
            <div className="drawing-toolbar-group">
                <DrawingToolButton
                    active={activeTool === 'select'}
                    glyph="↖"
                    label={t('layout.selectTool')}
                    onClick={() => onToolChange('select')}
                />
                <DrawingToolButton
                    active={activeTool === 'viewport'}
                    glyph="▣"
                    label={t('layout.viewportTool')}
                    onClick={() => onToolChange('viewport')}
                />
                <DrawingToolButton
                    active={activeTool === 'pan-paper'}
                    glyph="✋︎"
                    label={t('layout.panPaperTool')}
                    onClick={() => onToolChange('pan-paper')}
                />
                <DrawingToolButton
                    active={activeTool === 'pan-view'}
                    glyph="☝︎"
                    label={t('layout.panViewTool')}
                    onClick={() => onToolChange('pan-view')}
                />
                <DrawingToolButton
                    active={activeTool === 'scale'}
                    disabled={!hasSelection}
                    glyph="×"
                    label={t('layout.scaleViewportTool')}
                    onClick={onScale}
                />
            </div>
            <div className="drawing-toolbar-group">
                <DrawingToolButton glyph="＋" label={t('layout.paperZoomIn')} onClick={onZoomIn} />
                <DrawingToolButton glyph="−" label={t('layout.paperZoomOut')} onClick={onZoomOut} />
                <DrawingToolButton glyph="□" label={t('layout.fitPaper')} onClick={onFitPaper} />
            </div>
            <div className="drawing-toolbar-group">
                <DrawingToolButton
                    danger
                    disabled={!hasSelection}
                    glyph="⌫"
                    label={t('layout.deleteViewport')}
                    onClick={onDelete}
                />
            </div>
        </aside>
    );
}
