import React from 'react';

import { useI18n } from '~i18n/I18nProvider';

export default function DrawingWorkspaceTabs({ activeLayoutId, layouts, mode, onAddLayout, onOpenLayout, onOpenModel }) {
    const { t } = useI18n();
    return (
        <nav className="drawing-workspace-tabs" aria-label={t('layout.workspaceTabs')}>
            <button type="button" className={mode === 'model' ? 'is-active' : ''} onClick={onOpenModel}>
                {t('layout.model')}
            </button>
            {layouts.map(layout => (
                <button
                    type="button"
                    key={layout.id}
                    className={mode === 'layout' && activeLayoutId === layout.id ? 'is-active' : ''}
                    onClick={() => onOpenLayout(layout.id)}
                >
                    {layout.name}
                </button>
            ))}
            <button type="button" className="is-add" onClick={onAddLayout} aria-label={t('layout.addLayout')} title={t('layout.addLayout')}>
                +
            </button>
        </nav>
    );
}
