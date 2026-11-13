import { Button } from '~components/ui/Controls';
import useDialogFocus from '~hooks/useDialogFocus';
import React, { useCallback, useId } from 'react';

import { useI18n } from '~i18n/I18nProvider';

/**
 * Save / Don't save / Cancel before a drawing without a file is replaced.
 * Escape and the backdrop cancel; only an explicit choice continues.
 */
export default function UnsavedChangesDialog({ request, onChoose }) {
    const { t } = useI18n();
    const titleId = useId();
    const cancel = useCallback(() => onChoose('cancel'), [onChoose]);
    const dialogRef = useDialogFocus(Boolean(request), cancel);
    if (!request) return null;
    return (
        <div className="lumcad-settings-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) cancel();
        }}>
            <section ref={dialogRef} className="lumcad-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <h1 id={titleId}>{t('file.unsavedTitle', { name: request.name || t('document.untitled') })}</h1>
                <p>{t('file.unsavedBody')}</p>
                <footer>
                    <Button type="button" className="lumcad-settings-button is-primary" onClick={() => onChoose('save')}>{t('file.unsavedSave')}</Button>
                    <Button type="button" className="lumcad-settings-button" onClick={() => onChoose('discard')}>{t('file.unsavedDiscard')}</Button>
                    <Button type="button" className="lumcad-settings-button" onClick={cancel}>{t('file.unsavedCancel')}</Button>
                </footer>
            </section>
        </div>
    );
}
