import React, { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { getDrawingCommandSuggestions, resolveDrawingAutocompleteSubmission } from '~utils/drawingCommands';
import { getDrawingCreationOptionSuggestions } from '~utils/drawingCreation';
import { getDrawingOperationOptionSuggestions } from '~utils/drawingOperationOptions';

const DrawingCommandBar = forwardRef(function DrawingCommandBar({
    value = '', onChange, onSubmit, message, operation = null, activeTool = 'select',
}, forwardedRef) {
    const { t } = useI18n();
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
        return getDrawingCommandSuggestions(value);
    }, [activeTool, operation, value]);
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
        <div className="drawing-command-area">
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
                <button
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
                </button>
                <input
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
                    placeholder={t('commandBar.placeholder')}
                />
                <button type="submit">{t('commandBar.enter')}</button>
                {focused && suggestions.length > 0 && !historyOpen && (
                    <div className="drawing-command-suggestions" role="listbox" aria-label={t('commandBar.suggestions')}>
                        {suggestions.map((suggestion, index) => (
                            <button
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
                            </button>
                        ))}
                    </div>
                )}
                {historyOpen && (
                    <div id={historyPanelId} className="drawing-command-history" aria-labelledby={`${historyPanelId}-toggle`}>
                        {history.length > 0 ? (
                            <ul>
                                {history.map(command => (
                                    <li key={command}>
                                        <button
                                            type="button"
                                            onMouseDown={event => event.preventDefault()}
                                            onClick={() => selectHistoryCommand(command)}
                                        >
                                            {command}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : <p>{t('commandBar.historyEmpty')}</p>}
                    </div>
                )}
            </form>
            {message && !(focused && suggestions.length) && !historyOpen && <div className="drawing-command-message" aria-live="polite">{message}</div>}
        </div>
    );
});

export default DrawingCommandBar;
