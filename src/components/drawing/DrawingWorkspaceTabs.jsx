import React, { useEffect, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { DRAWING_LAYOUT_TEMPLATE_OPTIONS } from '~utils/drawingLayouts';

export default function DrawingWorkspaceTabs({
    activeLayoutId,
    isExporting = false,
    layouts,
    mode,
    onAddLayout,
    onAddLayoutFromTemplate,
    onDeleteLayout,
    onDuplicateLayout,
    onExportSelected,
    onMoveLayout,
    onOpenLayout,
    onOpenModel,
    onRenameLayout,
    onSelectedLayoutsChange,
    selectedLayoutIds,
}) {
    const { t } = useI18n();
    const stripRef = useRef(null);
    const suppressClickRef = useRef(false);
    const [menu, setMenu] = useState(null);
    const [renamingLayoutId, setRenamingLayoutId] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const [drag, setDrag] = useState(null);
    const [internalSelectedIds, setInternalSelectedIds] = useState(() => (
        activeLayoutId ? [activeLayoutId] : []
    ));
    const selection = Array.isArray(selectedLayoutIds) ? selectedLayoutIds : internalSelectedIds;
    const selectedSet = new Set(selection);
    const selectedInOrder = layouts.filter(layout => selectedSet.has(layout.id)).map(layout => layout.id);

    useEffect(() => {
        if (!menu) return undefined;
        const close = event => {
            if (event.key === 'Escape') setMenu(null);
        };
        const closeFromPointer = event => {
            if (!event.target.closest?.('.drawing-workspace-layout-menu, .is-layout-menu')) setMenu(null);
        };
        window.addEventListener('keydown', close);
        window.addEventListener('pointerdown', closeFromPointer);
        return () => {
            window.removeEventListener('keydown', close);
            window.removeEventListener('pointerdown', closeFromPointer);
        };
    }, [menu]);

    const publishSelection = ids => {
        const validIds = layouts.filter(layout => ids.includes(layout.id)).map(layout => layout.id);
        if (!Array.isArray(selectedLayoutIds)) setInternalSelectedIds(validIds);
        onSelectedLayoutsChange?.(validIds);
    };
    const beginRename = layout => {
        setMenu(null);
        setRenamingLayoutId(layout.id);
        setRenameValue(layout.name);
    };
    const finishRename = layout => {
        const value = renameValue.trim();
        if (value) onRenameLayout?.(layout.id, value);
        setRenamingLayoutId(null);
    };
    const addFromTemplate = template => {
        setAddMenuOpen(false);
        if (onAddLayoutFromTemplate) onAddLayoutFromTemplate(template);
        else onAddLayout();
    };
    const openLayout = (event, layout) => {
        if (suppressClickRef.current) return;
        if (event.metaKey || event.ctrlKey) {
            const next = selectedSet.has(layout.id)
                ? selection.filter(id => id !== layout.id)
                : [...selection, layout.id];
            publishSelection(next);
            return;
        }
        publishSelection([layout.id]);
        onOpenLayout(layout.id);
    };
    const openModel = () => {
        publishSelection([]);
        onOpenModel();
    };
    const toggleMenu = (event, layout) => {
        if (menu?.id === layout.id) {
            setMenu(null);
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        setMenu({
            id: layout.id,
            left: Math.max(8, Math.min(window.innerWidth - 208, rect.right - 196)),
            bottom: Math.max(8, window.innerHeight - rect.top + 5),
        });
    };
    const scrollTabs = direction => stripRef.current?.scrollBy({
        left: direction * Math.max(180, stripRef.current.clientWidth * 0.72),
        behavior: 'smooth',
    });
    const beginPointerReorder = (event, layout, index) => {
        if (!onMoveLayout || event.button !== 0 || event.metaKey || event.ctrlKey
            || event.target.closest?.('.is-layout-menu, form, input')) return;
        setDrag({
            active: false,
            id: layout.id,
            index,
            overIndex: index,
            pointerId: event.pointerId,
            startX: event.clientX,
        });
    };
    const updatePointerReorder = event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const active = drag.active || Math.abs(event.clientX - drag.startX) >= 8;
        if (!active) return;
        if (!drag.active && !event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        event.preventDefault();
        const strip = stripRef.current;
        if (strip) {
            const rect = strip.getBoundingClientRect();
            if (event.clientX < rect.left + 36) strip.scrollLeft -= 18;
            if (event.clientX > rect.right - 36) strip.scrollLeft += 18;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-layout-index]');
        const overIndex = target ? Number(target.dataset.layoutIndex) : drag.overIndex;
        setDrag(current => current?.pointerId === event.pointerId ? {
            ...current,
            active: true,
            overIndex: Number.isInteger(overIndex) ? overIndex : current.overIndex,
        } : current);
    };
    const finishPointerReorder = event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (drag.active) {
            event.preventDefault();
            suppressClickRef.current = true;
            window.setTimeout(() => { suppressClickRef.current = false; }, 0);
            if (drag.overIndex !== drag.index) onMoveLayout?.(drag.id, drag.overIndex);
        }
        setDrag(null);
    };
    const reorderFromKeyboard = (event, layout, index) => {
        if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || !onMoveLayout) return;
        event.preventDefault();
        const nextIndex = Math.max(0, Math.min(layouts.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
        if (nextIndex !== index) onMoveLayout(layout.id, nextIndex);
    };
    const menuLayout = menu ? layouts.find(layout => layout.id === menu.id) : null;

    return (
        <nav className="drawing-workspace-tabs" aria-label={t('layout.workspaceTabs')}>
            <button type="button" className={mode === 'model' ? 'is-active is-model' : 'is-model'} onClick={openModel}>
                {t('layout.model')}
            </button>
            <button type="button" className="is-tab-scroll" onClick={() => scrollTabs(-1)} aria-label={t('layout.scrollTabsLeft')} title={t('layout.scrollTabsLeft')}>
                <span aria-hidden="true">‹</span>
            </button>
            <div className="drawing-workspace-tab-strip" ref={stripRef} onScroll={() => setMenu(null)}>
                {layouts.map((layout, index) => (
                    <div
                        className={[
                            'drawing-workspace-layout-tab',
                            drag?.id === layout.id && drag.active && 'is-dragging',
                            drag?.active && drag.overIndex === index && 'is-drop-target',
                            drag?.active && drag.overIndex === index && drag.index < index && 'is-drop-after',
                        ].filter(Boolean).join(' ')}
                        data-layout-index={index}
                        key={layout.id}
                        onPointerDown={event => beginPointerReorder(event, layout, index)}
                        onPointerMove={updatePointerReorder}
                        onPointerUp={finishPointerReorder}
                        onPointerCancel={() => setDrag(null)}
                    >
                        {renamingLayoutId === layout.id ? (
                            <form onSubmit={event => { event.preventDefault(); finishRename(layout); }}>
                                <input
                                    autoFocus
                                    aria-label={t('layout.renameLayout')}
                                    value={renameValue}
                                    onBlur={() => setRenamingLayoutId(null)}
                                    onChange={event => setRenameValue(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            setRenamingLayoutId(null);
                                        }
                                    }}
                                />
                            </form>
                        ) : (
                            <button
                                type="button"
                                className={[
                                    mode === 'layout' && activeLayoutId === layout.id && 'is-active',
                                    selectedSet.has(layout.id) && 'is-selected',
                                ].filter(Boolean).join(' ')}
                                aria-current={mode === 'layout' && activeLayoutId === layout.id ? 'page' : undefined}
                                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                                aria-pressed={selectedSet.has(layout.id)}
                                onClick={event => openLayout(event, layout)}
                                onDoubleClick={() => beginRename(layout)}
                                onKeyDown={event => reorderFromKeyboard(event, layout, index)}
                            >
                                {layout.name}
                            </button>
                        )}
                        {(onRenameLayout || onDuplicateLayout || onDeleteLayout) && (
                            <button
                                type="button"
                                className="is-layout-menu"
                                aria-label={t('layout.layoutMenu', { name: layout.name })}
                                aria-haspopup="menu"
                                aria-expanded={menu?.id === layout.id}
                                title={t('layout.layoutMenu', { name: layout.name })}
                                onClick={event => toggleMenu(event, layout)}
                            >
                                <span aria-hidden="true">⋮</span>
                            </button>
                        )}
                    </div>
                ))}
            </div>
            <button type="button" className="is-tab-scroll" onClick={() => scrollTabs(1)} aria-label={t('layout.scrollTabsRight')} title={t('layout.scrollTabsRight')}>
                <span aria-hidden="true">›</span>
            </button>
            <div className="drawing-workspace-add-tab">
                <button
                    type="button"
                    className="is-add"
                    onClick={() => onAddLayoutFromTemplate ? setAddMenuOpen(current => !current) : onAddLayout()}
                    aria-label={t('layout.addLayout')}
                    aria-expanded={onAddLayoutFromTemplate ? addMenuOpen : undefined}
                    title={t('layout.addLayout')}
                >
                    +
                </button>
                {addMenuOpen && (
                    <div className="drawing-workspace-layout-menu is-add-menu">
                        {DRAWING_LAYOUT_TEMPLATE_OPTIONS.map(template => (
                            <button type="button" key={template} onClick={() => addFromTemplate(template)}>
                                {t(`layout.template.${template}`)}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {onExportSelected && (
                <button
                    type="button"
                    className="is-export-selected"
                    disabled={isExporting || selectedInOrder.length === 0}
                    onClick={() => onExportSelected(selectedInOrder)}
                    title={t('layout.exportSelected', { count: selectedInOrder.length })}
                >
                    {t('layout.exportSelected', { count: selectedInOrder.length })}
                </button>
            )}
            {menuLayout && (
                <div
                    className="drawing-workspace-layout-menu is-floating"
                    role="menu"
                    aria-label={t('layout.layoutMenu', { name: menuLayout.name })}
                    style={{ left: `${menu.left}px`, bottom: `${menu.bottom}px` }}
                >
                    <button role="menuitem" type="button" disabled={!onRenameLayout} onClick={() => beginRename(menuLayout)}>{t('layout.renameLayout')}</button>
                    <button role="menuitem" type="button" disabled={!onDuplicateLayout} onClick={() => { setMenu(null); onDuplicateLayout?.(menuLayout.id); }}>{t('layout.duplicateLayout')}</button>
                    <button role="menuitem" type="button" className="is-danger" disabled={!onDeleteLayout || layouts.length <= 1} onClick={() => { setMenu(null); onDeleteLayout?.(menuLayout.id); }}>{t('layout.deleteLayout')}</button>
                </div>
            )}
        </nav>
    );
}
