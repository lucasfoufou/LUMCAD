import { Button } from '~components/ui/Controls';
import useDrawingShortcutLabel from '~hooks/useDrawingShortcutLabel';
import React, { useEffect, useRef, useState } from 'react';

import Icon from '~components/ui/Icon';
import { useI18n } from '~i18n/I18nProvider';

const tool = (id, labelKey, alias, icon = id) => ({ id, kind: 'tool', labelKey, alias, icon });
// Operation labels already carry their command alias, e.g. "Move (M)".
const operation = (id, labelKey, action = id, icon = id) => ({ id, kind: 'operation', labelKey, action, icon });
const family = (id, members) => ({ id, family: true, members });

// Tool rail: one slot per tool or family. A family shows its active or last
// used member; its other members open in a flyout.
const sections = [
    [tool('select', 'toolbar.select', 'V'), tool('pan', 'toolbar.pan', 'P')],
    [
        family('line', [tool('line', 'toolbar.line', 'L'), tool('xline', 'toolbar.xline', 'XL'), tool('ray', 'toolbar.ray', 'RAY')]),
        family('rectangle', [tool('rectangle', 'toolbar.rectangle', 'REC'), tool('polygon', 'toolbar.polygon', 'POL')]),
        tool('circle', 'toolbar.circle', 'C'),
        tool('arc', 'toolbar.arc', 'A'),
        tool('ellipse', 'toolbar.ellipse', 'EL'),
        tool('spline', 'toolbar.spline', 'SPL'),
        tool('point', 'toolbar.point', 'POINT'),
        tool('hatch', 'toolbar.hatch', 'H'),
        tool('text', 'toolbar.text', 'T'),
    ],
    [
        tool('dimension', 'toolbar.dimension', 'DIM'),
        { id: 'importImage', kind: 'action', labelKey: 'toolbar.importImage', action: 'importImage', icon: 'image' },
    ],
    [
        operation('move', 'toolbar.move'),
        operation('copy', 'toolbar.copyFromBase', 'copyCommand'),
        family('rotate', [operation('rotate', 'toolbar.rotate'), operation('align', 'toolbar.align')]),
        operation('scale', 'toolbar.scale'),
        operation('mirror', 'toolbar.mirror'),
        operation('offset', 'toolbar.offset'),
        family('trim', [operation('trim', 'toolbar.trim'), operation('extend', 'toolbar.extend')]),
        family('fillet', [operation('fillet', 'toolbar.fillet'), operation('chamfer', 'toolbar.chamfer'), operation('blend', 'toolbar.blend')]),
        family('array', [
            operation('array', 'toolbar.array'),
            operation('arrayPolar', 'toolbar.arrayPolar'),
            operation('arrayPath', 'toolbar.arrayPath'),
            { id: 'arrayEdit', kind: 'action', labelKey: 'toolbar.arrayEdit', action: 'arrayEdit', icon: 'arrayEdit', needsSingleSelection: true },
        ]),
        family('break', [
            operation('break', 'toolbar.break'),
            operation('breakAtPoint', 'toolbar.breakAtPoint'),
            operation('stretch', 'toolbar.stretch'),
            operation('lengthen', 'toolbar.lengthen'),
        ]),
        operation('join', 'toolbar.join'),
        operation('explode', 'toolbar.explode'),
        { id: 'delete', kind: 'action', action: 'delete', icon: 'erase', shortcut: 'delete', needsSelection: true, danger: true },
    ],
];

const LONG_PRESS_MS = 400;

export default function DrawingToolbar({ activeTool, activeOperation, onToolChange, actions, selectionCount }) {
    const { t } = useI18n();
    const shortcutLabel = useDrawingShortcutLabel();
    const [choices, setChoices] = useState({});
    const [tooltip, setTooltip] = useState(null);
    const [flyout, setFlyout] = useState(null);
    const flyoutRef = useRef(null);

    const label = item => (item.shortcut ? shortcutLabel(item.shortcut) : t(item.labelKey));
    const isActive = item => (item.kind === 'tool' ? activeTool === item.id : item.kind === 'operation' && activeOperation === item.id);
    const isDisabled = item => (item.needsSelection && !selectionCount) || (item.needsSingleSelection && selectionCount !== 1);
    const shown = slot => (slot.family
        ? slot.members.find(isActive) || slot.members.find(member => member.id === choices[slot.id]) || slot.members[0]
        : slot);
    const run = (item, slot = null) => {
        if (slot) setChoices(current => ({ ...current, [slot.id]: item.id }));
        setFlyout(null);
        if (item.kind === 'tool') onToolChange(item.id);
        else actions[item.action]?.();
    };
    const showTooltip = (event, item) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setTooltip({ text: label(item), alias: item.alias, top: rect.top + rect.height / 2, left: rect.right + 8 });
    };
    const openFlyout = (event, slot) => {
        const rect = event.currentTarget.closest('.drawing-tool-slot').getBoundingClientRect();
        setTooltip(null);
        setFlyout({ slot, top: rect.top, left: rect.right + 6 });
    };

    useEffect(() => {
        if (!flyout) return undefined;
        flyoutRef.current?.querySelector('button:not(:disabled)')?.focus();
        const close = event => {
            if (event.type === 'keydown' ? event.key === 'Escape' : !flyoutRef.current?.contains(event.target)) setFlyout(null);
        };
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('keydown', close, true);
        return () => {
            window.removeEventListener('pointerdown', close, true);
            window.removeEventListener('keydown', close, true);
        };
    }, [flyout]);

    return (
        <aside className="drawing-toolbar" aria-label={t('toolbar.label')} onScroll={() => setTooltip(null)}>
            {sections.map((section, sectionIndex) => (
                <div className="drawing-toolbar-group" key={sectionIndex}>
                    {section.map(slot => {
                        const item = shown(slot);
                        return (
                            <ToolSlot
                                key={slot.id}
                                item={item}
                                label={label(item)}
                                active={isActive(item)}
                                disabled={isDisabled(item)}
                                hasMembers={Boolean(slot.family)}
                                moreLabel={slot.family ? t('toolbar.moreTools', { tool: label(item) }) : null}
                                onRun={() => run(item, slot.family ? slot : null)}
                                onOpenMembers={event => openFlyout(event, slot)}
                                onHover={event => showTooltip(event, item)}
                                onLeave={() => setTooltip(null)}
                            />
                        );
                    })}
                </div>
            ))}
            {tooltip && (
                <div className="ui-tooltip drawing-toolbar-tooltip" role="tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
                    {tooltip.text}{tooltip.alias && <kbd>{tooltip.alias}</kbd>}
                </div>
            )}
            {flyout && (
                <div ref={flyoutRef} className="ui-popover drawing-toolbar-flyout" role="menu" style={{ top: flyout.top, left: flyout.left }}>
                    {flyout.slot.members.map(member => (
                        <Button
                            type="button"
                            role="menuitemradio"
                            key={member.id}
                            aria-checked={isActive(member)}
                            disabled={isDisabled(member)}
                            onClick={() => run(member, flyout.slot)}
                        >
                            <Icon name={member.icon} />
                            <span>{label(member)}</span>
                            {member.alias && <kbd>{member.alias}</kbd>}
                        </Button>
                    ))}
                </div>
            )}
        </aside>
    );
}

function ToolSlot({ item, label, active, disabled, hasMembers, moreLabel, onRun, onOpenMembers, onHover, onLeave }) {
    const pressRef = useRef(null);
    const longPressedRef = useRef(false);
    const cancelPress = () => window.clearTimeout(pressRef.current);
    return (
        <div className="drawing-tool-slot">
            <DrawingToolButton
                icon={item.icon}
                label={label}
                toolId={item.kind === 'tool' ? item.id : undefined}
                nativeTitle={false}
                active={active}
                disabled={disabled}
                danger={item.danger}
                onClick={() => {
                    // A long press opens the family instead of running the shown tool.
                    if (longPressedRef.current) longPressedRef.current = false;
                    else onRun();
                }}
                onPointerEnter={onHover}
                onPointerLeave={() => { cancelPress(); onLeave(); }}
                onFocus={onHover}
                onBlur={onLeave}
                onContextMenu={hasMembers ? event => { event.preventDefault(); onOpenMembers(event); } : undefined}
                onPointerDown={hasMembers ? event => {
                    const target = event.currentTarget;
                    longPressedRef.current = false;
                    pressRef.current = window.setTimeout(() => {
                        longPressedRef.current = true;
                        onOpenMembers({ currentTarget: target });
                    }, LONG_PRESS_MS);
                } : undefined}
                onPointerUp={cancelPress}
            />
            {hasMembers && (
                <Button type="button" className="drawing-tool-more" aria-label={moreLabel} aria-haspopup="menu" onClick={onOpenMembers} />
            )}
        </div>
    );
}

export function DrawingToolButton({ icon, glyph, label, onClick, active = false, disabled = false, danger = false, toolId = undefined, nativeTitle = true, ...events }) {
    return (
        <Button
            type="button"
            className={['drawing-tool-button', active && 'is-active', danger && 'is-danger'].filter(Boolean).join(' ')}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={nativeTitle ? label : undefined}
            aria-pressed={active || undefined}
            data-tool={toolId}
            {...events}
        >
            {icon ? <Icon name={icon} /> : glyph}
        </Button>
    );
}
