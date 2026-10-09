import React, { useId, useState } from 'react';
import { useI18n } from '~i18n/I18nProvider';
import { drawingShortcutFromEvent, formatDrawingShortcut } from '~utils/drawingCommandPreferences';
import { Button } from './Controls';

/** Capture uses the same key normalization as editor dispatch. Escape cancels;
 * Tab leaves the control without assigning a shortcut or trapping focus. */
export default function ShortcutRecorder({ value, onChange, label, conflicts = [] }) {
    const { t } = useI18n();
    const [recording, setRecording] = useState(false);
    const [error, setError] = useState(null);
    const helpId = useId();
    const text = recording ? t('commandPreferences.captureListening') : value
        ? formatDrawingShortcut(value, typeof navigator === 'undefined' ? '' : navigator.platform) : t('commandPreferences.captureStart');
    return <div className="ui-shortcut-recorder">
        <Button aria-label={`${label}: ${text}`} aria-pressed={recording} aria-describedby={helpId}
            className={recording ? 'is-recording' : ''}
            onClick={event => { event.currentTarget.focus(); setRecording(true); setError(null); }}
            onBlur={() => { setRecording(false); setError(null); }}
            onKeyDown={event => {
                if (!recording) return;
                event.stopPropagation();
                if (event.key === 'Tab') { setRecording(false); return; }
                event.preventDefault();
                if (event.key === 'Escape') { setRecording(false); setError(null); return; }
                if (event.repeat || event.isComposing || ['Shift', 'Control', 'Meta', 'Alt', 'AltGraph'].includes(event.key)) return;
                const shortcut = drawingShortcutFromEvent(event);
                if (!shortcut) { setError('commandPreferences.captureInvalid'); return; }
                if (conflicts.includes(shortcut)) { setError('commandPreferences.captureConflict'); return; }
                onChange(shortcut);
                setError(null);
                setRecording(false);
            }}>
            {text}
        </Button>
        <small id={helpId} role="status">{t(error || (recording ? 'commandPreferences.captureHelp' : 'commandPreferences.captureIdle'))}</small>
    </div>;
}
