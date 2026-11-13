import { Button, Input } from '~components/ui/Controls';
import Icon from '~components/ui/Icon';
import useDialogFocus from '~hooks/useDialogFocus';
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { groupDrawingCommands } from '~utils/drawingCommandGroups';
import { drawingCommandDefinitions, getDrawingCommandDefinition, searchDrawingCommands } from '~utils/drawingCommands';

/**
 * "All commands" (HELP, ?, F1): every command by family, filtered by the
 * command-line search; Enter or a click runs the highlighted command.
 */
export default function DrawingCommandPalette({ open, onClose, onRun }) {
    const { t } = useI18n();
    const titleId = useId();
    const listId = useId();
    const dialogRef = useDialogFocus(open, onClose);
    const inputRef = useRef(null);
    const listRef = useRef(null);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        if (!open) return undefined;
        setQuery('');
        setActiveIndex(0);
        const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    const results = useMemo(() => {
        if (!query.trim()) {
            return [...drawingCommandDefinitions]
                .sort((left, right) => t(left.labelKey).localeCompare(t(right.labelKey)))
                .map(definition => ({ command: definition.command, name: definition.name, alias: definition.alias, labelKey: definition.labelKey }));
        }
        return searchDrawingCommands(query, { translate: t, limit: Infinity, allowSpaces: true });
    }, [query, t]);
    const groups = useMemo(() => groupDrawingCommands(results), [results]);
    const ordered = useMemo(() => groups.flatMap(group => group.commands), [groups]);
    const active = ordered[Math.min(activeIndex, ordered.length - 1)] || null;
    const description = active ? getDrawingCommandDefinition(active.command)?.description : '';

    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [active]);

    if (!open) return null;

    const onKeyDown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActiveIndex(current => Math.max(0, Math.min(ordered.length - 1, current + step)));
        } else if (event.key === 'Enter' && active) {
            event.preventDefault();
            onRun(active.name);
        }
    };

    return (
        <div className="lumcad-settings-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section ref={dialogRef} className="drawing-command-palette" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <header>
                    <h1 id={titleId}>{t('commandPalette.title')}</h1>
                    <Button type="button" className="ui-icon-button" onClick={onClose} aria-label={t('settings.close')} title={t('settings.close')}>
                        <Icon name="close" />
                    </Button>
                </header>
                <div className="drawing-command-palette-search">
                    <Icon name="search" />
                    <Input
                        ref={inputRef}
                        value={query}
                        onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
                        onKeyDown={onKeyDown}
                        placeholder={t('commandPalette.placeholder')}
                        aria-label={t('commandPalette.search')}
                        aria-controls={listId}
                        aria-activedescendant={active ? `${listId}-${active.command}` : undefined}
                        autoComplete="off"
                        spellCheck="false"
                    />
                    <span className="drawing-command-palette-count">{t('commandBar.matchCount', { count: ordered.length })}</span>
                </div>
                <div ref={listRef} id={listId} className="drawing-command-palette-list" role="listbox" aria-label={t('commandPalette.title')}>
                    {groups.map(group => (
                        <div key={group.id} role="group" aria-labelledby={`${listId}-group-${group.id}`}>
                            <h2 id={`${listId}-group-${group.id}`}>{t(`commandPalette.group.${group.id}`)}</h2>
                            {group.commands.map(command => (
                                <div
                                    key={command.command}
                                    id={`${listId}-${command.command}`}
                                    role="option"
                                    aria-selected={command === active}
                                    className={`drawing-command-palette-row${command === active ? ' is-active' : ''}`}
                                    onMouseDown={event => event.preventDefault()}
                                    onMouseEnter={() => setActiveIndex(ordered.indexOf(command))}
                                    onClick={() => onRun(command.name)}
                                >
                                    <span>{t(command.labelKey)}</span>
                                    <strong>{command.name}</strong>
                                    <kbd>{command.alias}</kbd>
                                </div>
                            ))}
                        </div>
                    ))}
                    {!ordered.length && <p className="drawing-command-palette-empty">{t('commandPalette.empty')}</p>}
                </div>
                <footer>
                    <p>{t('commandPalette.hint')}</p>
                    {description && (
                        <details>
                            <summary>{t('commandPalette.technicalReference')}</summary>
                            <p lang="en">{description}</p>
                        </details>
                    )}
                </footer>
            </section>
        </div>
    );
}
