import { Button, Input } from '~components/ui/Controls';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { getDrawingCommandDefinition } from '~utils/drawingCommands';
import React, { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Icon from '~components/ui/Icon';
import useDrawingCommandLog from '~hooks/useDrawingCommandLog';

import { useI18n } from '~i18n/I18nProvider';
import { resolveDrawingAutocompleteSubmission, searchDrawingCommands } from '~utils/drawingCommands';
import { getDrawingCreationOptionSuggestions } from '~utils/drawingCreation';
import { getDrawingOperationOptionSuggestions } from '~utils/drawingOperationOptions';

const DrawingCommandBar = forwardRef(function DrawingCommandBar({
    value = '', onChange, onSubmit, message, operation = null, activeTool = 'select', optionsRef = null, onOpenSettings = null,
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
        // Up to 50 matches, scrolling; the label search finds French and English words.
        return [...personal, ...searchDrawingCommands(value, { translate: t, limit: 50 })].slice(0, 50);
    }, [activeTool, operation, value, settings.commandAliases, t]);
    const commandLog = useDrawingCommandLog(message);
    const messageRef = useRef(null);
    const [messageOverflows, setMessageOverflows] = useState(false);
    const [dismissedMessage, setDismissedMessage] = useState(null);
    // A message cut by the command line shows in full below it until dismissed.
    useLayoutEffect(() => {
        const element = messageRef.current;
        setMessageOverflows(Boolean(element && element.scrollWidth > element.clientWidth + 1));
    }, [message]);
    useEffect(() => { setDismissedMessage(null); }, [message]);
    const converterMissing = message && message === t('cad.error.cadConverterMissing');
    const showFullMessage = Boolean(message) && (messageOverflows || converterMissing) && dismissedMessage !== message;
    const activeSuggestionIndex = suggestions.length && suggestionIndex >= 0
        ? Math.min(suggestions.length - 1, suggestionIndex)
        : -1;

    useImperativeHandle(forwardedRef, () => ({
        focus(nextValue = null) {
            if (nextValue !== null) onChange(nextValue);
            // Focus now, within the forwarding keydown: a key pressed right after
            // (typically Enter) must reach the input, not the canvas. The caret
            // moves to the end once the new value has rendered.
            inputRef.current?.focus({ preventScroll: true });
            window.requestAnimationFrame(() => {
                inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
            });
        },
    }), [onChange]);

    const runCommand = rawCommand => {
        const command = String(rawCommand || '').trim();
        if (command) setHistory(current => [command, ...current.filter(item => item !== command)].slice(0, 30));
        commandLog.recordCommand(command);
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

    const optionPrompt = Boolean(operation) || activeTool !== 'select';
    const submit = event => {
        event.preventDefault();
        const shouldComplete = suggestionIndex >= 0 || String(value).trim().length > 0;
        runCommand(shouldComplete
            ? resolveDrawingAutocompleteSubmission(value, suggestions, suggestionIndex, { options: optionPrompt })
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
            runCommand(resolveDrawingAutocompleteSubmission(value, suggestions, suggestionIndex, { options: optionPrompt }));
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
        // Command line of the window header: the current message follows the
        // input; suggestions, history and the options of the active command open
        // below it.
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
                {/* Status messages trail the input (inline end), like a status area. */}
                {message && <span ref={messageRef} className="drawing-command-message" title={message} aria-live="polite">{message}</span>}
                <Button type="submit">{t('commandBar.enter')}</Button>
                {focused && suggestions.length > 0 && !historyOpen && (
                    <div className="drawing-command-suggestions" role="listbox" aria-label={t('commandBar.suggestions')}>
                        {!operation && activeTool === 'select' && (
                            <p className="drawing-command-suggestions-count" aria-hidden="true">{t('commandBar.matchCount', { count: suggestions.length })}</p>
                        )}
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
                        <CommandLogView log={commandLog} t={t} />
                        <h2 className="drawing-command-history-heading">{t('commandBar.recentCommands')}</h2>
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
            {showFullMessage && !historyOpen && !(focused && suggestions.length > 0) && (
                <div className="ui-popover drawing-command-full-message" role="status">
                    <p>{message}</p>
                    <div className="drawing-command-full-message-actions">
                        {converterMissing && onOpenSettings && (
                            <Button type="button" className="ui-button is-primary" onClick={() => onOpenSettings('files')}>
                                <Icon name="gear" size="sm" />{t('cad.openDwgSettings')}
                            </Button>
                        )}
                        <Button type="button" className="ui-icon-button" aria-label={t('commandBar.dismissMessage')} title={t('commandBar.dismissMessage')}
                            onClick={() => setDismissedMessage(message)}>
                            <Icon name="close" size="sm" />
                        </Button>
                    </div>
                </div>
            )}
            {optionsRef && (
                <div className="ui-popover drawing-command-panel">
                    {message && <p className="drawing-command-panel-message">{message}</p>}
                    <div className="drawing-options-slot" ref={optionsRef} />
                </div>
            )}
        </div>
    );
});

/** Session text window (AutoCAD F2): each command with the replies it produced. */
function CommandLogView({ log, t }) {
    const [copied, setCopied] = useState(false);
    const listRef = useRef(null);
    useLayoutEffect(() => {
        if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [log.entries]);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(log.toText());
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
        } catch {
            setCopied(false);
        }
    };
    return (
        <section className="drawing-command-log" aria-label={t('commandBar.log')}>
            <header>
                <h2 className="drawing-command-history-heading">{t('commandBar.log')}</h2>
                <Button type="button" className="ui-button is-ghost" onMouseDown={event => event.preventDefault()} onClick={copy} disabled={!log.entries.length}>
                    <Icon name="copy" size="sm" />{t(copied ? 'commandBar.logCopied' : 'commandBar.logCopy')}
                </Button>
            </header>
            {log.entries.length > 0 ? (
                <ol ref={listRef}>
                    {log.entries.map(entry => (
                        <li key={entry.id} className={entry.kind === 'command' ? 'is-command' : ''}>
                            {entry.kind === 'command' ? `> ${entry.text}` : entry.text}
                        </li>
                    ))}
                </ol>
            ) : <p>{t('commandBar.logEmpty')}</p>}
        </section>
    );
}

export default DrawingCommandBar;
