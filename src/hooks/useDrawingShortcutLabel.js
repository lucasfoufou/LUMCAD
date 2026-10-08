import { useAppSettings } from '~settings/AppSettingsProvider';
import { useI18n } from '~i18n/I18nProvider';

export default function useDrawingShortcutLabel() {
    const { settings } = useAppSettings();
    const { t } = useI18n();
    return (action, label = t(`commandPreferences.action.${action}`)) => {
        const bindings = settings.commandShortcuts.filter(row => row.command === `@${action}`)
            .map(row => row.shortcut.replace('MOD', 'Ctrl/Cmd').replace('SHIFT', 'Shift').replace('ALT', 'Alt'));
        return bindings.length ? `${label} (${bindings.join(', ')})` : label;
    };
}
