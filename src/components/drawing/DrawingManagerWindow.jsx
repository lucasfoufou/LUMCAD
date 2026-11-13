import { Button } from '~components/ui/Controls';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import Icon from '~components/ui/Icon';
import useLatestRef from '~hooks/useLatestRef';
import { clampFloatingWindowPosition, moveFloatingWindowByKey } from '~utils/drawingFloatingWindow';

// Position chosen by dragging, kept for the rest of the session and shared by
// every manager so they reopen where the user put them.
let sessionPosition = null;

const HEADER_HEIGHT = 44;

// Non-modal window: the drawing stays usable, e.g. to pick objects for
// constraints. The header moves it (pointer or arrow keys); Escape closes it
// when no command is running.
export default function DrawingManagerWindow({ title, closeLabel, moveLabel, commandActive = false, onClose, children }) {
    const windowRef = useRef(null);
    const [position, setPosition] = useState(sessionPosition);
    const onCloseRef = useLatestRef(onClose);
    const commandActiveRef = useLatestRef(commandActive);

    const place = next => {
        const element = windowRef.current;
        const clamped = clampFloatingWindowPosition(next, element?.getBoundingClientRect(),
            { width: window.innerWidth, height: window.innerHeight }, HEADER_HEIGHT);
        sessionPosition = clamped;
        setPosition(clamped);
    };
    const currentPosition = () => {
        const rect = windowRef.current?.getBoundingClientRect();
        return position || (rect ? { left: rect.left, top: rect.top } : { left: 0, top: HEADER_HEIGHT });
    };

    // Registered once and in the capture phase: the editor's global Escape
    // (cancel and clear the selection) re-renders the editor, and a listener
    // re-registered by that render would be skipped for the current event.
    useEffect(() => {
        const closeOnEscape = event => {
            if (event.key !== 'Escape' || event.defaultPrevented || commandActiveRef.current) return;
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const target = event.target;
            // A field or open list inside the window handles its own Escape first.
            if (windowRef.current?.contains(target) && (isTextField(target) || target.closest?.('[aria-expanded="true"]'))) return;
            event.preventDefault();
            onCloseRef.current?.();
        };
        window.addEventListener('keydown', closeOnEscape, true);
        return () => window.removeEventListener('keydown', closeOnEscape, true);
    }, [commandActiveRef, onCloseRef]);

    // Keep a dragged window reachable when the editor window shrinks.
    useLayoutEffect(() => {
        if (!position) return undefined;
        const onResize = () => place(sessionPosition);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [Boolean(position)]);

    const startDrag = event => {
        if (event.button !== 0 || event.target.closest('button:not(.drawing-manager-grip)')) return;
        const start = currentPosition();
        const origin = { x: event.clientX, y: event.clientY };
        const header = event.currentTarget;
        header.setPointerCapture?.(event.pointerId);
        const move = moveEvent => place({ left: start.left + moveEvent.clientX - origin.x, top: start.top + moveEvent.clientY - origin.y });
        const stop = () => {
            header.removeEventListener('pointermove', move);
            header.removeEventListener('pointerup', stop);
            header.removeEventListener('pointercancel', stop);
        };
        header.addEventListener('pointermove', move);
        header.addEventListener('pointerup', stop);
        header.addEventListener('pointercancel', stop);
        event.preventDefault();
    };

    const style = position
        ? { left: position.left, top: position.top, right: 'auto', maxHeight: `calc(100vh - ${position.top}px - 38px)` }
        : undefined;
    return (
        <section ref={windowRef} className="ui-popover drawing-manager-window" role="dialog" aria-label={title} style={style}>
            <header onPointerDown={startDrag}>
                <Button
                    type="button"
                    className="ui-icon-button is-small drawing-manager-grip"
                    aria-label={moveLabel}
                    title={moveLabel}
                    onKeyDown={event => {
                        const next = moveFloatingWindowByKey(currentPosition(), event.key, event.shiftKey);
                        if (!next) return;
                        event.preventDefault();
                        event.stopPropagation();
                        place(next);
                    }}
                >
                    <Icon name="drag" size="sm" />
                </Button>
                <h2>{title}</h2>
                <Button type="button" className="ui-icon-button is-small" aria-label={closeLabel} title={closeLabel} onClick={onClose}><Icon name="close" size="sm" /></Button>
            </header>
            <div className="drawing-manager-body">{children}</div>
        </section>
    );
}

function isTextField(target) {
    return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
        || (target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type));
}
