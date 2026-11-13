import React, { useEffect, useRef } from 'react';

import useLatestRef from '~hooks/useLatestRef';
import { useI18n } from '~i18n/I18nProvider';
import { formatDrawingCursorPosition } from '~utils/drawingCursorPosition';

// Live X ; Y of the pointer over the model drawing, in the current UCS and
// display units. The text is written straight into the DOM once per frame so
// pointer moves never re-render the editor.
export default function DrawingCursorCoordinates({ settings }) {
    const { locale, t } = useI18n();
    const valueRef = useRef(null);
    const settingsRef = useLatestRef(settings);
    const formatRef = useLatestRef(point => formatDrawingCursorPosition(point, settingsRef.current, locale, t));
    const lastPointRef = useRef(null);

    useEffect(() => {
        let frame = 0;
        let pending = null;
        const render = () => {
            frame = 0;
            const output = valueRef.current;
            if (!output || !pending) return;
            lastPointRef.current = pending;
            output.textContent = formatRef.current(pending);
            output.parentElement?.classList.remove('is-idle');
        };
        const onPointerMove = event => {
            const svg = event.target instanceof Element ? event.target.closest('.drawing-canvas-svg') : null;
            if (!svg) {
                valueRef.current?.parentElement?.classList.add('is-idle');
                return;
            }
            const matrix = svg.getScreenCTM?.();
            if (!matrix) return;
            const inverse = matrix.inverse();
            pending = {
                x: inverse.a * event.clientX + inverse.c * event.clientY + inverse.e,
                y: inverse.b * event.clientX + inverse.d * event.clientY + inverse.f,
            };
            if (!frame) frame = window.requestAnimationFrame(render);
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            if (frame) window.cancelAnimationFrame(frame);
        };
    }, [formatRef]);

    // Units, UCS or language changes reformat the last position.
    useEffect(() => {
        if (lastPointRef.current && valueRef.current) valueRef.current.textContent = formatRef.current(lastPointRef.current);
    }, [settings, locale, formatRef]);

    return (
        <span className="drawing-cursor-position is-idle" title={t('status.cursorTitle')}>
            <span className="ui-visually-hidden">{t('status.cursor')}</span>
            <output ref={valueRef} aria-live="off">{t('status.cursorEmpty')}</output>
        </span>
    );
}
