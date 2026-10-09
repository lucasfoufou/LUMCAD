import { useEffect, useRef } from 'react';

/** Shared modal keyboard boundary; nested controls can consume Escape. */
export default function useDialogFocus(open, onClose, busy = false) {
    const ref = useRef(null);
    const busyRef = useRef(busy);
    busyRef.current = busy;
    useEffect(() => {
        if (!open) return undefined;
        const previous = document.activeElement;
        const elements = () => [...(ref.current?.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [])].filter(element => !element.hidden && element.getClientRects().length > 0);
        const frame = requestAnimationFrame(() => elements()[0]?.focus({ preventScroll: true }));
        const onKeyDown = event => {
            if (event.defaultPrevented) return;
            if (event.key === 'Escape' && !busyRef.current) {
                event.preventDefault();
                onClose();
            }
            if (event.key !== 'Tab') return;
            const focusable = elements();
            if (!focusable.length) return;
            const first = focusable[0], last = focusable.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('keydown', onKeyDown);
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
        };
    }, [open, onClose]);
    return ref;
}
