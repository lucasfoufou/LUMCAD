import { Button } from '~components/ui/Controls';
import React, { useEffect, useRef } from 'react';

import { useI18n } from '~i18n/I18nProvider';

const MENU_WIDTH = 220;
const ITEM_HEIGHT = 30;

/**
 * Canvas right-click menu shown when no command is running: repeat the last
 * command and, on a selection, the usual modify commands. Keyboard: arrows move,
 * Enter activates, Escape or a click elsewhere closes it.
 */
export default function DrawingContextMenu({ position, items, onClose }) {
    const { t } = useI18n();
    const menuRef = useRef(null);

    useEffect(() => {
        if (!position) return undefined;
        menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
        const closeOutside = event => { if (!menuRef.current?.contains(event.target)) onClose(); };
        window.addEventListener('pointerdown', closeOutside, true);
        window.addEventListener('resize', onClose);
        window.addEventListener('wheel', onClose, { passive: true });
        return () => {
            window.removeEventListener('pointerdown', closeOutside, true);
            window.removeEventListener('resize', onClose);
            window.removeEventListener('wheel', onClose);
        };
    }, [position, onClose]);

    if (!position || !items.length) return null;
    const left = Math.max(8, Math.min(position.x, window.innerWidth - MENU_WIDTH - 8));
    const top = Math.max(8, Math.min(position.y, window.innerHeight - items.length * ITEM_HEIGHT - 16));

    const handleKeyDown = event => {
        const buttons = [...menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')];
        const index = buttons.indexOf(document.activeElement);
        if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
        } else if (event.key === 'Enter' || event.key === ' ') {
            // Keep the global Enter/Space handlers (repeat command) out of it.
            event.stopPropagation();
        }
    };

    return (
        <div
            ref={menuRef}
            className="drawing-context-menu"
            role="menu"
            aria-label={t('contextMenu.label')}
            style={{ left, top }}
            onKeyDown={handleKeyDown}
            onContextMenu={event => event.preventDefault()}
        >
            {items.map(item => (
                <Button
                    key={item.id}
                    role="menuitem"
                    type="button"
                    className={item.danger ? 'is-danger' : ''}
                    onClick={() => { onClose(); item.run(); }}
                >
                    <span>{item.label}</span>
                    {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </Button>
            ))}
        </div>
    );
}
