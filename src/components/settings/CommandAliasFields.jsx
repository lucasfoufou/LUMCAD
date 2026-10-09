import { Button, Input, Select } from '~components/ui/Controls';
import { DRAWING_SHORTCUT_ACTIONS } from '~utils/drawingCommandPreferences';
import React from 'react';
import { useI18n } from '~i18n/I18nProvider';
import { drawingCommandDefinitions } from '~utils/drawingCommands';
import ShortcutRecorder from '~components/ui/ShortcutRecorder';

export default function CommandAliasFields({ value, onChange, shortcuts = false }) {
    const { t } = useI18n();
    const field = shortcuts ? 'shortcut' : 'alias';
    const change = (index, patch) => onChange(value.map((row, i) => i === index ? { ...row, ...patch } : row));
    return <div className="lumcad-command-aliases">
        {value.map((row, index) => <div className="lumcad-command-alias-row" key={index}>
            {shortcuts ? <ShortcutRecorder label={t('commandPreferences.shortcutNumber', { number: index + 1 })}
                value={row.shortcut} conflicts={value.filter((_, i) => i !== index).map(item => item.shortcut)}
                onChange={shortcut => change(index, { shortcut })} />
                : <Input aria-label={t('commandPreferences.aliasNumber', { number: index + 1 })}
                    value={row.alias} maxLength={32} onChange={event => change(index, { alias: event.target.value })} />}
            <Select aria-label={t('commandPreferences.commandNumber', { number: index + 1 })}
                value={row.command} onChange={event => change(index, { command: event.target.value })}>
                {shortcuts && DRAWING_SHORTCUT_ACTIONS.map(action => <option key={action} value={action}>{t(`commandPreferences.action.${action.slice(1)}`)}</option>)}
                {drawingCommandDefinitions.map(definition => <option key={definition.command} value={definition.command}>
                    {definition.name} — {t(definition.labelKey)}
                </option>)}
            </Select>
            <Button type="button" className="lumcad-settings-button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
                {t('commandPreferences.remove')}
            </Button>
        </div>)}
        <Button type="button" className="lumcad-settings-button" disabled={value.length >= 256}
            onClick={() => onChange([...value, { [field]: '', command: 'line' }])}>{t(shortcuts ? 'commandPreferences.addShortcut' : 'commandPreferences.addAlias')}</Button>
    </div>;
}
