import React, { forwardRef, useId, useState } from 'react';
import Icon from './Icon';

export const Button = forwardRef(function Button({ type = 'button', variant, size, className = '', ...props }, ref) {
    return <button ref={ref} type={type} className={['ui-button', variant && `is-${variant}`, size && `is-${size}`, className].filter(Boolean).join(' ')} {...props} />;
});

export const Input = forwardRef(function Input(props, ref) {
    return <input ref={ref} {...props} />;
});

export const Select = forwardRef(function Select(props, ref) {
    return <select ref={ref} {...props} />;
});

export const TextArea = forwardRef(function TextArea(props, ref) {
    return <textarea ref={ref} {...props} />;
});

export function Field({ label, hint, className = 'drawing-creation-field', children }) {
    return <label className={className}><span>{label}{hint && <small>{hint}</small>}</span>{children}</label>;
}

export function Disclosure({ label, children, className = 'drawing-creation-details' }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    return <div className={className}>
        <Button className="drawing-creation-details-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} />{label}
        </Button>
        {open && <div id={id} className="drawing-creation-details-fields">{children}</div>}
    </div>;
}
