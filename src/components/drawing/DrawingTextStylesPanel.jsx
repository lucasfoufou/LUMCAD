import { useEffect, useMemo, useState } from 'react';

import {
    DEFAULT_DRAWING_TEXT_STYLE,
    DEFAULT_DRAWING_TEXT_STYLE_ID,
    DRAWING_TEXT_FONTS,
    normalizeDrawingTextStyles,
} from '~utils/drawingText';

export default function DrawingTextStylesPanel({
    styles = [],
    selectedStyleId = DEFAULT_DRAWING_TEXT_STYLE_ID,
    labels = {},
    disabled = false,
    onSelect,
    onCreate,
    onRename,
    onUpdate,
    onDelete,
}) {
    const normalizedStyles = useMemo(() => normalizeDrawingTextStyles(styles), [styles]);
    const selected = normalizedStyles.find(style => style.id === selectedStyleId)
        || normalizedStyles.find(style => style.id === DEFAULT_DRAWING_TEXT_STYLE_ID)
        || normalizedStyles[0];
    const [nameDraft, setNameDraft] = useState(selected?.name || '');

    useEffect(() => setNameDraft(selected?.name || ''), [selected?.id, selected?.name]);

    if (!selected) return null;
    const update = patch => onUpdate?.(selected.id, patch);
    const finishRename = () => {
        const name = nameDraft.trim();
        if (!name) setNameDraft(selected.name);
        else if (name !== selected.name) onRename?.(selected.id, name);
    };
    const canUpdate = !disabled && typeof onUpdate === 'function';
    const previewStyle = {
        fontFamily: DRAWING_TEXT_FONTS.find(font => font.id === selected.fontFamily)?.cssFamily,
        fontSize: `${Math.max(0.75, Math.min(1.5, selected.fontSize / DEFAULT_DRAWING_TEXT_STYLE.fontSize))}rem`,
        fontWeight: selected.fontWeight,
        fontStyle: selected.fontStyle,
        textDecoration: [
            selected.underline && 'underline',
            selected.strikethrough && 'line-through',
        ].filter(Boolean).join(' ') || 'none',
        lineHeight: selected.lineHeight,
    };

    return (
        <section className="drawing-text-styles-panel" aria-label={labels.panel}>
            <header className="drawing-text-styles-panel__header">
                <strong>{labels.title}</strong>
                <button
                    type="button"
                    aria-label={labels.create}
                    title={labels.create}
                    disabled={disabled || typeof onCreate !== 'function'}
                    onClick={() => onCreate?.({
                        ...DEFAULT_DRAWING_TEXT_STYLE,
                        id: undefined,
                        name: labels.newStyleName || '',
                    })}
                >
                    <span aria-hidden="true">＋</span>
                </button>
            </header>
            <div className="drawing-text-styles-panel__body">
                <ul className="drawing-text-styles-panel__list" aria-label={labels.list}>
                    {normalizedStyles.map(style => (
                        <li key={style.id}>
                            <button
                                type="button"
                                className={style.id === selected.id ? 'is-selected' : ''}
                                aria-current={style.id === selected.id || undefined}
                                disabled={disabled || typeof onSelect !== 'function'}
                                onClick={() => onSelect?.(style.id)}
                            >
                                <span>{labels.styleNames?.[style.id] || style.name}</span>
                                <small>{labels.fonts?.[style.fontFamily] || style.fontFamily}</small>
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="drawing-text-styles-panel__editor">
                    <label>
                        <span>{labels.name}</span>
                        <input
                            type="text"
                            value={nameDraft}
                            disabled={disabled || typeof onRename !== 'function'}
                            onChange={event => setNameDraft(event.target.value)}
                            onBlur={finishRename}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    finishRename();
                                    event.currentTarget.blur();
                                } else if (event.key === 'Escape') {
                                    setNameDraft(selected.name);
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </label>
                    <label>
                        <span>{labels.font}</span>
                        <select value={selected.fontFamily} disabled={!canUpdate} onChange={event => update({ fontFamily: event.target.value })}>
                            {DRAWING_TEXT_FONTS.map(font => (
                                <option key={font.id} value={font.id}>{labels.fonts?.[font.id] || font.id}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <span>{labels.fontSize}</span>
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={selected.fontSize}
                            disabled={!canUpdate}
                            onChange={event => {
                                const fontSize = Number(event.target.value);
                                if (Number.isFinite(fontSize) && fontSize >= 0.01) update({ fontSize });
                            }}
                        />
                    </label>
                    <label>
                        <span>{labels.weight}</span>
                        <select value={selected.fontWeight} disabled={!canUpdate} onChange={event => update({ fontWeight: Number(event.target.value) })}>
                            <option value="400">{labels.normal}</option>
                            <option value="700">{labels.bold}</option>
                        </select>
                    </label>
                    <label>
                        <span>{labels.fontStyle}</span>
                        <select value={selected.fontStyle} disabled={!canUpdate} onChange={event => update({ fontStyle: event.target.value })}>
                            <option value="normal">{labels.normal}</option>
                            <option value="italic">{labels.italic}</option>
                        </select>
                    </label>
                    <label>
                        <span>{labels.lineHeight}</span>
                        <input
                            type="number"
                            min="0.8"
                            max="4"
                            step="0.1"
                            value={selected.lineHeight}
                            disabled={!canUpdate}
                            onChange={event => {
                                const lineHeight = Number(event.target.value);
                                if (Number.isFinite(lineHeight) && lineHeight >= 0.8 && lineHeight <= 4) update({ lineHeight });
                            }}
                        />
                    </label>
                    <div className="drawing-text-styles-panel__toggles">
                        <TextStyleToggle label={labels.underline} checked={selected.underline} disabled={!canUpdate} onChange={underline => update({ underline })} />
                        <TextStyleToggle label={labels.strikethrough} checked={selected.strikethrough} disabled={!canUpdate} onChange={strikethrough => update({ strikethrough })} />
                    </div>
                    <div className="drawing-text-styles-panel__preview" aria-label={labels.preview} style={previewStyle}>
                        {labels.previewText}
                    </div>
                    <button
                        type="button"
                        className="drawing-text-styles-panel__delete"
                        disabled={disabled
                            || selected.id === DEFAULT_DRAWING_TEXT_STYLE_ID
                            || typeof onDelete !== 'function'}
                        onClick={() => onDelete?.(selected.id)}
                    >
                        {labels.delete}
                    </button>
                </div>
            </div>
        </section>
    );
}

function TextStyleToggle({ checked, disabled, label, onChange }) {
    return (
        <label>
            <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
            <span>{label}</span>
        </label>
    );
}
