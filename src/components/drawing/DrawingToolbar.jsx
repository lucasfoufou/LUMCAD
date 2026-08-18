import React from 'react';

import { useI18n } from '~i18n/I18nProvider';

const toolGroups = [
    [
        { id: 'select', glyph: '↖', labelKey: 'toolbar.select', alias: 'V' },
        { id: 'pan', glyph: '✥', labelKey: 'toolbar.pan', alias: 'P' },
    ],
    [
        { id: 'line', glyph: '╱', labelKey: 'toolbar.line', alias: 'L' },
        { id: 'rectangle', glyph: '▭', labelKey: 'toolbar.rectangle', alias: 'REC' },
        { id: 'circle', glyph: '○', labelKey: 'toolbar.circle', alias: 'C' },
        { id: 'polygon', glyph: '⬡', labelKey: 'toolbar.polygon', alias: 'POL' },
        { id: 'arc', glyph: '⌒', labelKey: 'toolbar.arc', alias: 'A' },
        { id: 'text', glyph: 'T', labelKey: 'toolbar.text', alias: 'T' },
    ],
    [
        { id: 'dimension', glyph: '↔', labelKey: 'toolbar.dimension', alias: 'DIM' },
    ],
];

export default function DrawingToolbar({ activeTool, activeOperation, onToolChange, actions, selectionCount, canUndo, canRedo }) {
    const { t } = useI18n();
    return (
        <aside className="drawing-toolbar" aria-label={t('toolbar.label')}>
            {toolGroups.map((group, groupIndex) => (
                <div className="drawing-toolbar-group" key={groupIndex}>
                    {group.map(tool => (
                        <ToolButton
                            key={tool.id}
                            active={activeTool === tool.id}
                            glyph={tool.glyph}
                            label={`${t(tool.labelKey)} (${tool.alias})`}
                            onClick={() => onToolChange(tool.id)}
                        />
                    ))}
                </div>
            ))}
            <div className="drawing-toolbar-group">
                <ToolButton glyph="↶" label={t('toolbar.undo')} disabled={!canUndo} onClick={actions.undo} />
                <ToolButton glyph="↷" label={t('toolbar.redo')} disabled={!canRedo} onClick={actions.redo} />
                <ToolButton glyph="⧉" label={t('toolbar.copy')} disabled={!selectionCount} onClick={actions.copy} />
                <ToolButton glyph="✂" label={t('toolbar.cut')} disabled={!selectionCount} onClick={actions.cut} />
                <ToolButton glyph="▣" label={t('toolbar.paste')} onClick={actions.paste} />
            </div>
            <div className="drawing-toolbar-group">
                <ToolButton glyph="⇱" label={t('toolbar.move')} active={activeOperation === 'move'} onClick={actions.move} />
                <ToolButton glyph="⧉" label={t('toolbar.copyFromBase')} active={activeOperation === 'copy'} onClick={actions.copyCommand} />
                <ToolButton glyph="↻" label={t('toolbar.rotate')} active={activeOperation === 'rotate'} onClick={actions.rotate} />
                <ToolButton glyph="⇥" label={t('toolbar.align')} active={activeOperation === 'align'} onClick={actions.align} />
                <ToolButton glyph="⌒" label={t('toolbar.fillet')} active={activeOperation === 'fillet'} onClick={actions.fillet} />
                <ToolButton glyph="◿" label={t('toolbar.chamfer')} active={activeOperation === 'chamfer'} onClick={actions.chamfer} />
                <ToolButton glyph="∿" label={t('toolbar.blend')} active={activeOperation === 'blend'} onClick={actions.blend} />
                <ToolButton glyph="◩" label={t('toolbar.mirror')} active={activeOperation === 'mirror'} onClick={actions.mirror} />
                <ToolButton glyph="⠿" label={t('toolbar.array')} active={activeOperation === 'array'} onClick={actions.array} />
                <ToolButton glyph="⌁" label={t('toolbar.join')} active={activeOperation === 'join'} onClick={actions.join} />
                <ToolButton glyph="⌘" label={t('toolbar.explode')} active={activeOperation === 'explode'} onClick={actions.explode} />
                <ToolButton glyph="⇲" label={t('toolbar.offset')} active={activeOperation === 'offset'} onClick={actions.offset} />
                <ToolButton glyph="✂" label={t('toolbar.trim')} active={activeOperation === 'trim'} onClick={actions.trim} />
                <ToolButton glyph="⇢" label={t('toolbar.extend')} active={activeOperation === 'extend'} onClick={actions.extend} />
                <ToolButton glyph="⌇" label={t('toolbar.break')} active={activeOperation === 'break'} onClick={actions.break} />
                <ToolButton glyph="⋮" label={t('toolbar.breakAtPoint')} active={activeOperation === 'breakAtPoint'} onClick={actions.breakAtPoint} />
                <ToolButton glyph="↔" label={t('toolbar.stretch')} active={activeOperation === 'stretch'} onClick={actions.stretch} />
                <ToolButton glyph="⇔" label={t('toolbar.lengthen')} active={activeOperation === 'lengthen'} onClick={actions.lengthen} />
                <ToolButton glyph="×" label={t('toolbar.scale')} active={activeOperation === 'scale'} onClick={actions.scale} />
                <ToolButton glyph="⌫" label={t('toolbar.delete')} disabled={!selectionCount} onClick={actions.delete} danger />
            </div>
            <div className="drawing-toolbar-group">
                <ToolButton glyph="＋" label={t('toolbar.zoomIn')} onClick={actions.zoomIn} />
                <ToolButton glyph="−" label={t('toolbar.zoomOut')} onClick={actions.zoomOut} />
                <ToolButton glyph="□" label={t('toolbar.fit')} onClick={actions.fit} />
                <ToolButton glyph="▧" label={t('toolbar.importImage')} onClick={actions.importImage} />
            </div>
        </aside>
    );
}

export function DrawingToolButton({ glyph, label, onClick, active = false, disabled = false, danger = false }) {
    return (
        <button
            type="button"
            className={['drawing-tool-button', active && 'is-active', danger && 'is-danger'].filter(Boolean).join(' ')}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            aria-pressed={active || undefined}
        >
            {glyph}
        </button>
    );
}

const ToolButton = DrawingToolButton;
