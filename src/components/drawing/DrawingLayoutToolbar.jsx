import React from 'react';

import { DrawingToolButton } from '~components/drawing/DrawingToolbar';
import { useI18n } from '~i18n/I18nProvider';

export default function DrawingLayoutToolbar({
    activeTool,
    hasSelection,
    hasPaperSelection = false,
    onClip,
    onPaperCreate,
    onDelete,
    onFitPaper,
    onMaximize,
    onMinimize,
    onScale,
    onToggleLock,
    onToolChange,
    onZoomIn,
    onZoomOut,
    viewportLocked = false,
    viewportMaximized = false,
}) {
    const { t } = useI18n();
    return (
        <aside className="drawing-toolbar drawing-layout-toolbar" aria-label={t('layout.tools')}>
            <div className="drawing-toolbar-group">
                <DrawingToolButton
                    active={activeTool === 'select'}
                    icon="select"
                    label={t('layout.selectTool')}
                    onClick={() => onToolChange('select')}
                />
                <DrawingToolButton
                    active={activeTool === 'viewport'}
                    icon="viewport"
                    label={t('layout.viewportTool')}
                    onClick={() => onToolChange('viewport')}
                />
                <DrawingToolButton
                    active={activeTool === 'pan-paper'}
                    icon="pan"
                    label={t('layout.panPaperTool')}
                    onClick={() => onToolChange('pan-paper')}
                />
                <DrawingToolButton
                    active={activeTool === 'pan-view'}
                    icon="move"
                    label={t('layout.panViewTool')}
                    onClick={() => onToolChange('pan-view')}
                />
                <DrawingToolButton
                    active={activeTool === 'scale'}
                    disabled={!hasSelection}
                    icon="scale"
                    label={t('layout.scaleViewportTool')}
                    onClick={onScale}
                />
                <DrawingToolButton
                    disabled={!hasSelection || !onClip}
                    icon="polygon"
                    label={t('layout.viewportClipTool')}
                    onClick={onClip}
                />
                <DrawingToolButton
                    active={viewportLocked}
                    disabled={!hasSelection || !onToggleLock}
                    icon={viewportLocked ? 'lock' : 'unlock'}
                    label={t(viewportLocked ? 'layout.unlockViewport' : 'layout.lockViewport')}
                    onClick={onToggleLock}
                />
                {(onMaximize || onMinimize) && (
                    <DrawingToolButton
                        active={viewportMaximized}
                        disabled={!hasSelection || (viewportMaximized ? !onMinimize : !onMaximize)}
                        icon={viewportMaximized ? 'zoomOut' : 'fit'}
                        label={t(viewportMaximized ? 'layout.minimizeViewport' : 'layout.maximizeViewport')}
                        onClick={viewportMaximized ? onMinimize : onMaximize}
                    />
                )}
            </div>
            <div className="drawing-toolbar-group">
                {['text', 'line', 'rectangle'].map(type => <DrawingToolButton key={type} icon={type}
                    label={t(`layout.paperAnnotation.${type}`)} onClick={() => onPaperCreate?.(type)} />)}
            </div>
            <div className="drawing-toolbar-group">
                <DrawingToolButton icon="zoomIn" label={t('layout.paperZoomIn')} onClick={onZoomIn} />
                <DrawingToolButton icon="zoomOut" label={t('layout.paperZoomOut')} onClick={onZoomOut} />
                <DrawingToolButton icon="fit" label={t('layout.fitPaper')} onClick={onFitPaper} />
            </div>
            <div className="drawing-toolbar-group">
                <DrawingToolButton
                    danger
                    disabled={!hasSelection && !hasPaperSelection}
                    icon="erase"
                    label={t(hasPaperSelection ? 'layout.deletePaperAnnotation' : 'layout.deleteViewport')}
                    onClick={onDelete}
                />
            </div>
        </aside>
    );
}
