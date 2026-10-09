import { Button } from '~components/ui/Controls';
import React from 'react';

import Icon from '~components/ui/Icon';
import { useI18n } from '~i18n/I18nProvider';

// Bottom bar of the editor: model/layout tabs on the left, drafting aids and
// view controls on the right.
export default function DrawingStatusBar({ tabs, aids, onZoomIn, onZoomOut, onFit }) {
    const { t } = useI18n();
    return (
        <footer className="drawing-status-bar">
            <div className="drawing-status-tabs">{tabs}</div>
            <div className="drawing-status-aids">
                {aids}
                {onFit && (
                    <span className="drawing-status-view" role="group" aria-label={t('status.view')}>
                        <Button type="button" className="ui-icon-button is-small" onClick={onZoomOut} aria-label={t('toolbar.zoomOut')} title={t('toolbar.zoomOut')}><Icon name="zoomOut" size="sm" /></Button>
                        <Button type="button" className="ui-icon-button is-small" onClick={onZoomIn} aria-label={t('toolbar.zoomIn')} title={t('toolbar.zoomIn')}><Icon name="zoomIn" size="sm" /></Button>
                        <Button type="button" className="ui-icon-button is-small" onClick={onFit} aria-label={t('toolbar.fit')} title={t('toolbar.fit')}><Icon name="fit" size="sm" /></Button>
                    </span>
                )}
            </div>
        </footer>
    );
}
