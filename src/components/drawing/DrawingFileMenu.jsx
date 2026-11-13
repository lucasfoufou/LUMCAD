import { Button } from '~components/ui/Controls';
import Icon from '~components/ui/Icon';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { DRAWING_EXPORT_FORMATS } from '~utils/drawingFileFormats';

/**
 * File menu of the header, the same on every platform. Keyboard: arrows move,
 * Right/Enter opens Export, Left/Escape closes the submenu then the menu, Tab
 * closes. `items` comes from the editor; Export lists DRAWING_EXPORT_FORMATS and
 * marks desktop-only formats instead of hiding them.
 */
const DrawingFileMenu = forwardRef(function DrawingFileMenu({ items, onExport, desktop = true }, forwardedRef) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const buttonRef = useRef(null);
    const menuRef = useRef(null);
    const submenuRef = useRef(null);

    const close = useCallback((restoreFocus = true) => {
        setOpen(false);
        setExportOpen(false);
        if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
    }, []);

    const focusItem = (container, index) => {
        const entries = [...(container?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
        if (!entries.length) return;
        entries[(index + entries.length) % entries.length].focus();
    };

    useImperativeHandle(forwardedRef, () => ({
        openExport() {
            setOpen(true);
            setExportOpen(true);
            window.requestAnimationFrame(() => focusItem(submenuRef.current, 0));
        },
    }), []);

    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = event => {
            if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) close(false);
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        return () => window.removeEventListener('pointerdown', onPointerDown, true);
    }, [close, open]);

    const toggle = (focusFirst = false) => {
        if (open) { close(); return; }
        setOpen(true);
        setExportOpen(false);
        if (focusFirst) window.requestAnimationFrame(() => focusItem(menuRef.current, 0));
    };

    const run = action => {
        close();
        Promise.resolve().then(action).catch(() => {});
    };

    const openSubmenu = () => {
        setExportOpen(true);
        window.requestAnimationFrame(() => focusItem(submenuRef.current, 0));
    };

    const onMenuKeyDown = event => {
        const inSubmenu = submenuRef.current?.contains(event.target);
        const container = inSubmenu ? submenuRef.current : menuRef.current;
        const entries = [...container.querySelectorAll('[role="menuitem"]')]
            .filter(entry => !entry.disabled && (inSubmenu || !submenuRef.current?.contains(entry)));
        const index = entries.indexOf(event.target);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            const next = index < 0 ? 0 : index + (event.key === 'ArrowDown' ? 1 : -1);
            entries[(next + entries.length) % entries.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            entries[event.key === 'Home' ? 0 : entries.length - 1]?.focus();
        } else if (event.key === 'ArrowRight' && event.target.dataset.submenu) {
            event.preventDefault();
            openSubmenu();
        } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && inSubmenu) {
            event.preventDefault();
            event.stopPropagation();
            setExportOpen(false);
            menuRef.current?.querySelector('[data-submenu]')?.focus();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        } else if (event.key === 'Tab') {
            close(false);
        }
    };

    return (
        <div className="drawing-file-menu">
            <Button
                ref={buttonRef}
                type="button"
                className={`ui-button is-ghost drawing-file-menu-button${open ? ' is-open' : ''}`}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => toggle(false)}
                onKeyDown={event => {
                    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (!open) toggle(true);
                        else focusItem(menuRef.current, 0);
                    }
                }}
            >
                {t('fileMenu.label')}<Icon name="chevronDown" size="sm" />
            </Button>
            {open && (
                <div ref={menuRef} className="ui-popover drawing-file-menu-list" role="menu" aria-label={t('fileMenu.label')} onKeyDown={onMenuKeyDown}>
                    {items.map(item => item.separator
                        ? <div key={item.id} className="drawing-file-menu-separator" role="separator" />
                        : item.id === 'export' ? (
                            <div key={item.id} className="drawing-file-menu-submenu-anchor"
                                onPointerEnter={() => setExportOpen(true)}
                                onPointerLeave={() => setExportOpen(false)}>
                                <Button
                                    type="button"
                                    role="menuitem"
                                    data-submenu="export"
                                    aria-haspopup="menu"
                                    aria-expanded={exportOpen}
                                    onClick={openSubmenu}
                                >
                                    <Icon name={item.icon} /><span>{item.label}</span><Icon name="chevronRight" size="sm" />
                                </Button>
                                {exportOpen && (
                                    <div ref={submenuRef} className="ui-popover drawing-file-menu-list is-submenu" role="menu" aria-label={item.label}>
                                        {DRAWING_EXPORT_FORMATS.map(format => {
                                            const unavailable = format.desktopOnly && !desktop;
                                            return (
                                                <Button
                                                    key={format.id}
                                                    type="button"
                                                    role="menuitem"
                                                    aria-disabled={unavailable || undefined}
                                                    className={unavailable ? 'is-unavailable' : ''}
                                                    title={unavailable ? t('fileMenu.desktopOnly') : undefined}
                                                    onClick={() => run(() => onExport(format.id))}
                                                >
                                                    <span>{t(`fileMenu.format.${format.id}`)}</span>
                                                    {unavailable && <small>{t('fileMenu.desktopOnlyShort')}</small>}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <Button key={item.id} type="button" role="menuitem" disabled={item.disabled} onClick={() => run(item.action)}
                                onPointerEnter={() => setExportOpen(false)}>
                                <Icon name={item.icon} /><span>{item.label}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}
                            </Button>
                        ))}
                </div>
            )}
        </div>
    );
});

export default DrawingFileMenu;
