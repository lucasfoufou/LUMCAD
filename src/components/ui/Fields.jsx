import { Button, Field, Input, TextArea } from '~components/ui/Controls';
import React, { useEffect, useId, useRef, useState } from 'react';
import { formatDecimalValue, parseDecimalDraft } from '~utils/drawingFormValues';
import Icon from './Icon';

export function NumberField({ label, value, onChange, min, max, step = 0.1, placeholder, disabled = false }) {
    const formattedValue = formatDecimalValue(value);
    const [draft, setDraft] = useState(formattedValue);
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) setDraft(formattedValue);
    }, [formattedValue]);

    const applyDraft = rawValue => {
        setDraft(rawValue);
        const parsed = parseDecimalDraft(rawValue);
        if (parsed.kind === 'empty') onChange(undefined);
        else if (parsed.kind === 'complete') onChange(parsed.value);
    };

    const finishEditing = () => {
        focusedRef.current = false;
        const parsed = parseDecimalDraft(draft);
        if (parsed.kind === 'complete') onChange(parsed.value);
        else if (parsed.kind === 'empty') onChange(undefined);
        setDraft(formattedValue);
    };

    return (
        <Field label={label}>
            <Input
                type="text"
                role="spinbutton"
                inputMode="decimal"
                value={draft}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={Number.isFinite(value) ? value : undefined}
                data-step={step}
                placeholder={placeholder}
                disabled={disabled}
                onFocus={() => { focusedRef.current = true; }}
                onChange={event => applyDraft(event.target.value)}
                onBlur={finishEditing}
            />
        </Field>
    );
}

export function TextAreaField({ label, value, onChange, placeholder, disabled = false, className = '', singleLine = false }) {
    return (
        <Field label={label} className={`drawing-creation-field ${className}`.trim()}>
            {singleLine ? (
                <Input type="text" value={value} placeholder={placeholder} disabled={disabled} onChange={event => onChange(event.target.value)} />
            ) : (
                <TextArea value={value} placeholder={placeholder} disabled={disabled} rows="2" onChange={event => onChange(event.target.value)} />
            )}
        </Field>
    );
}

export function CheckboxField({ label, checked, onChange, disabled = false }) {
    return (
        <label className="drawing-creation-toggle">
            <Input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
            <span>{label}</span>
        </label>
    );
}

export function SelectField({ label, value, onChange, options, disabled = false }) {
    const fieldRef = useRef(null);
    const triggerRef = useRef(null);
    const labelId = useId();
    const listboxId = useId();
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const selected = options.find(([optionValue]) => optionValue === value) || options[0];

    useEffect(() => {
        if (!open) return undefined;
        const closeOnOutsidePointer = event => {
            if (fieldRef.current?.contains(event.target)) return;
            setOpen(false);
            triggerRef.current?.blur();
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer, true);
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    }, [open]);

    const selectValue = nextValue => {
        onChange(nextValue);
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <div ref={fieldRef} className="drawing-creation-field drawing-creation-select-field"
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
            <span id={labelId}>{label}</span>
            <Button
                ref={triggerRef}
                type="button"
                className="drawing-creation-select"
                role="combobox"
                aria-labelledby={labelId}
                aria-controls={listboxId}
                aria-expanded={open}
                aria-haspopup="listbox"
                aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
                disabled={disabled}
                onClick={event => {
                    event.currentTarget.focus();
                    setActiveIndex(Math.max(0, options.findIndex(([option]) => option === value)));
                    setOpen(current => !current);
                }}
                onKeyDown={event => {
                    const { key } = event;
                    if (key === 'Escape' && open) {
                        event.preventDefault(); event.stopPropagation(); setOpen(false);
                    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
                        event.preventDefault(); event.stopPropagation();
                        const initial = Math.max(0, options.findIndex(([option]) => option === value));
                        setActiveIndex(key === 'Home' ? 0 : key === 'End' ? options.length - 1
                            : open ? (activeIndex + (key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : initial);
                        setOpen(true);
                    } else if (open && (key === 'Enter' || key === ' ')) {
                        event.preventDefault(); event.stopPropagation();
                        if (options[activeIndex]) selectValue(options[activeIndex][0]);
                    }
                }}
            >
                <span>{selected?.[1] || ''}</span>
                <Icon name="chevronDown" />
            </Button>
            {open && (
                <div id={listboxId} className="drawing-creation-select-menu" role="listbox" aria-labelledby={labelId}>
                    {options.map(([optionValue, optionLabel], index) => (
                        <Button
                            type="button"
                            role="option"
                            id={`${listboxId}-${index}`}
                            tabIndex={-1}
                            onPointerDown={event => event.preventDefault()}
                            aria-selected={optionValue === value}
                            className={[optionValue === value && 'is-selected', index === activeIndex && 'is-active'].filter(Boolean).join(' ')}
                            key={optionValue}
                            onClick={() => selectValue(optionValue)}
                        >
                            {optionLabel}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function TextField({ label, value, onChange, maxLength = 512, disabled = false, placeholder }) {
    return <Field className="drawing-sidebar-field" label={label}>
        <Input type="text" value={value} maxLength={maxLength} disabled={disabled} placeholder={placeholder}
            onChange={event => onChange(event.target.value)} />
    </Field>;
}
