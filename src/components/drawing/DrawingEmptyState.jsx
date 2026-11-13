import { Button } from '~components/ui/Controls';
import Icon from '~components/ui/Icon';
import React from 'react';

import { useI18n } from '~i18n/I18nProvider';

/** Three discreet starting points over an empty model; hidden from the first object or tool. */
export default function DrawingEmptyState({ onOpen, onImport, onHelp }) {
    const { t } = useI18n();
    return (
        <div className="drawing-empty-state" role="group" aria-label={t('emptyState.label')}>
            <Button type="button" className="ui-button is-ghost" onClick={onOpen}><Icon name="open" size="sm" />{t('emptyState.open')}</Button>
            <Button type="button" className="ui-button is-ghost" onClick={onImport}><Icon name="import" size="sm" />{t('emptyState.import')}</Button>
            <Button type="button" className="ui-button is-ghost" onClick={onHelp}><Icon name="help" size="sm" />{t('emptyState.commands')}</Button>
        </div>
    );
}
