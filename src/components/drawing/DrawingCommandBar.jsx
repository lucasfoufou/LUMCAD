import { Button, Input } from '~components/ui/Controls';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { getDrawingCommandDefinition } from '~utils/drawingCommands';
import React, { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { getDrawingCommandSuggestions, resolveDrawingAutocompleteSubmission } from '~utils/drawingCommands';
import { getDrawingCreationOptionSuggestions } from '~utils/drawingCreation';
import { getDrawingOperationOptionSuggestions } from '~utils/drawingOperationOptions';

const DrawingCommandBar = forwardRef(function DrawingCommandBar({
    value = '', onChange, onSubmit, message, operation = null, activeTool = 'select', optionsRef = null,
}, forwardedRef) {
    const { t } = useI18n();
    const { settings } = useAppSettings();
    const inputRef = useRef(null);
    const historyPanelId = useId();
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [suggestionIndex, setSuggestionIndex] = useState(-1);
    const [focused, setFocused] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const suggestions = useMemo(() => {
        if (operation) return getDrawingOperationOptionSuggestions(operation, value);
        if (activeTool !== 'select') return getDrawingCreationOptionSuggestions(activeTool, value);
        const prefix = value.trim().toUpperCase();
        const personal = prefix && !/\s/.test(prefix) ? settings.commandAliases
            .filter(row => row.alias.startsWith(prefix)).map(row => {
                const definition = getDrawingCommandDefinition(row.command);
                return { ...definition, alias: row.alias, completion: row.alias, tokens: [row.alias] };
            }) : [];
        return [...personal, ...getDrawingCommandSuggestions(value)].slice(0, 5);
    }, [activeTool, operation, value, settings.commandAliases]);
    const activeSuggestionIndex = suggestions.length && suggestionIndex >= 0
        ? Math.min(suggestions.length - 1, suggestionIndex)
        : -1;

    useImperativeHandle(forwardedRef, () => ({
        focus(nextValue = null) {
            if (nextValue !== null) onChange(nextValue);
            window.requestAnimationFrame(() => {
                inputRef.current?.focus();
                inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
            });
        },
    }), [onChange]);

    const runCommand = rawCommand => {
        const command = String(rawCommand || '').trim();
        if (command) setHistory(current => [command, ...current.filter(item => item !== command)].slice(0, 30));
        setHistoryIndex(-1);
        setHistoryOpen(false);
        onSubmit(command);
    };

    const selectHistoryCommand = command => {
        onChange(command);
        setHistoryIndex(-1);
        setSuggestionIndex(-1);
        setHistoryOpen(false);
        window.requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
    };

    const submit = event => {
        event.preventDefault();
        const shouldComplete = suggestionIndex >= 0 || String(value).trim().length > 0;
        runCommand(shouldComplete
            ? resolveDrawingAutocompleteSubmission(value, suggestions, suggestionIndex)
            : value);
    };

    const handleKeyDown = event => {
        if (event.key === 'Tab' && suggestions.length) {
            event.preventDefault();
            const suggestion = suggestions[Math.max(0, suggestionIndex)];
            onChange(suggestion.completion);
            setSuggestionIndex(-1);
            return;
        }
        if (event.key === 'Enter' && suggestions.length
            && (suggestionIndex >= 0 || String(value).trim().length > 0)) {
            event.preventDefault();
            runCommand(resolveDrawingAutocompleteSubmission(value, suggestions, suggestionIndex));
            setSuggestionIndex(-1);
            return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (suggestions.length) {
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setSuggestionIndex(current => Math.max(0, Math.min(suggestions.length - 1, current + direction)));
            return;
        }
        const direction = event.key === 'ArrowUp' ? 1 : -1;
        const nextIndex = Math.max(-1, Math.min(history.length - 1, historyIndex + direction));
        setHistoryIndex(nextIndex);
        onChange(nextIndex < 0 ? '' : history[nextIndex]);
    };

    return (
        // Command line of the window header: the prompt shows the current message
        // before the input; suggestions, history and the options of the active
        // command open below it.
        <div className={`drawing-command-area${(focused && suggestions.length > 0) || historyOpen ? ' is-listing' : ''}`}>
            <form
                className="drawing-command-bar"
                onSubmit={submit}
                onKeyDown={event => {
                    if (event.key !== 'Escape' || !historyOpen) return;
                    event.preventDefault();
                    setHistoryOpen(false);
                    inputRef.current?.focus();
                }}
            >
                <Button
                    id={`${historyPanelId}-toggle`}
                    type="button"
                    className="drawing-command-prompt"
                    aria-label={t('commandBar.history')}
                    aria-controls={historyPanelId}
                    aria-expanded={historyOpen}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => {
                        setHistoryOpen(current => !current);
                        setSuggestionIndex(-1);
                    }}
                >
                    <span aria-hidden="true">{historyOpen ? '^' : '>'}</span>
                </Button>
                {message && <span className="drawing-command-message" title={message} aria-live="polite">{message}</span>}
                <Input
                    ref={inputRef}
                    value={value}
                    onChange={event => {
                        onChange(event.target.value);
                        setSuggestionIndex(-1);
                        setHistoryOpen(false);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    aria-label={t('commandBar.inputLabel')}
                    autoComplete="off"
                    spellCheck="false"
                    placeholder={message ? '' : t('commandBar.placeholder')}
                />
                <Button type="submit">{t('commandBar.enter')}</Button>
                {focused && suggestions.length > 0 && !historyOpen && (
                    <div className="drawing-command-suggestions" role="listbox" aria-label={t('commandBar.suggestions')}>
                        {suggestions.map((suggestion, index) => (
                            <Button
                                type="button"
                                role="option"
                                aria-selected={index === activeSuggestionIndex}
                                className={index === activeSuggestionIndex ? 'is-active' : ''}
                                key={suggestion.command}
                                onMouseDown={event => event.preventDefault()}
                                onClick={() => {
                                    onChange(suggestion.completion);
                                    setSuggestionIndex(-1);
                                    setHistoryOpen(false);
                                    inputRef.current?.focus();
                                }}
                            >
                                <strong>{suggestion.name}</strong><span><kbd>{suggestion.alias}</kbd> {t(suggestion.labelKey)}</span>
                            </Button>
                        ))}
                    </div>
                )}
                {historyOpen && (
                    <div id={historyPanelId} className="drawing-command-history" aria-labelledby={`${historyPanelId}-toggle`}>
                        {history.length > 0 ? (
                            <ul>
                                {history.map(command => (
                                    <li key={command}>
                                        <Button
                                            type="button"
                                            onMouseDown={event => event.preventDefault()}
                                            onClick={() => selectHistoryCommand(command)}
                                        >
                                            {command}
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        ) : <p>{t('commandBar.historyEmpty')}</p>}
                    </div>
                )}
            </form>
            {optionsRef && (
                <div className="ui-popover drawing-command-panel">
                    {message && <p className="drawing-command-panel-message">{message}</p>}
                    <div className="drawing-options-slot" ref={optionsRef} />
                </div>
            )}
        </div>
    );
});

export default DrawingCommandBar;
