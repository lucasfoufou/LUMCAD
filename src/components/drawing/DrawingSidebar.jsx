import { DRAWING_GRIP_OBJECT_LIMIT } from '~utils/drawingSelection';
import { Button, Disclosure, Input, Select } from '~components/ui/Controls';
import { summarizeDrawingSelectionTypes } from '~utils/drawingEntityProperties';
import DrawingHyperlinkFields from '~components/drawing/DrawingHyperlinkFields';
import DrawingParametersPanel from '~components/drawing/DrawingParametersPanel';
import DrawingConstraintsPanel from '~components/drawing/DrawingConstraintsPanel';
import DrawingBlockVariantEditor from '~components/drawing/DrawingBlockVariantEditor';
import DrawingAnnotationFields from '~components/drawing/DrawingAnnotationFields';
import DrawingPlotStylesPanel from '~components/drawing/DrawingPlotStylesPanel';
import DrawingInquiryPanel from '~components/drawing/DrawingInquiryPanel';
import { createDimensionSourceMap } from '~utils/drawingDimensionSources';
import { presentDrawingDimension } from '~utils/drawingDimensionPresentation';
import { retainDimensionStyleOverrides } from '~utils/drawingDimensionStyles';
import DrawingDimensionStylesPanel from '~components/drawing/DrawingDimensionStylesPanel';
import DrawingBlockAttributeFields from '~components/drawing/DrawingBlockAttributeFields';
import DrawingBlockParameterFields from '~components/drawing/DrawingBlockParameterFields';
import DrawingBlocksPanel from '~components/drawing/DrawingBlocksPanel';
import DrawingManagerWindow from '~components/drawing/DrawingManagerWindow';
import DrawingLayersPanel from '~components/drawing/DrawingLayersPanel';
import React, { useEffect, useRef, useState } from 'react';

import Icon from '~components/ui/Icon';

import { DrawingEntityAppearanceFields } from '~components/drawing/DrawingAppearanceFields';
import DrawingDimensionFields from '~components/drawing/DrawingDimensionFields';
import DrawingQdimOptions from '~components/drawing/DrawingQdimOptions';
import DrawingTextStylesPanel from '~components/drawing/DrawingTextStylesPanel';
import { useI18n } from '~i18n/I18nProvider';
import { canEditEntity, updateSelectedEntities } from '~utils/drawingDocument';
import {
    DEFAULT_DRAWING_TEXT_STYLE_ID,
    addDrawingTextStyle,
    removeDrawingTextStyle,
    updateDrawingTextStyle,
} from '~utils/drawingText';
import {
    DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    isDrawingDimensionEntity,
    getDimensionGeometry,
} from '~utils/drawingDimensions';
import { rebuildQdimSeriesResult } from '~utils/drawingDimensionCommands';

// Managers open in a floating window over the drawing instead of panel tabs.
const MANAGER_PANELS = Object.freeze({
    textStyles: 'sidebar.textStyles',
    dimensionStyles: 'commands.dimensionStyle',
    plotStyles: 'commands.styleManager',
    parameters: 'sidebar.manageParameters',
    constraints: 'commands.geomConstraint',
    inquiry: 'inquiry.title',
});

export default function DrawingSidebar({ content, selectedIds, editEntityId = null, onCommit, panel, onPanelChange, blockSearch, onBlockSearch, onBlockDefine, onBlockInsert, onBlockEdit, onBlockImport, onBlockExport, onManageAttribute, onDefineAttribute, onDimensionStyleCommand, inquiryResult, comparisonPreview, onCopyInquiry, onInspectTransmittal, onSelectDuplicateGroup, onSelectCountOccurrence, onOpenRecovery, canOpenRecovery = false, onSelectRecovery, onShowRecoveryManager, hasRecoveryGraph = false, onShowRecoveryHistory, onRetryRecovery, onForgetRecovery, onRelinkRecovery, canRelinkRecovery, layerFilter, onLayerFilter, onMergeLayer, onPlotStyleCommand, onCreationControlsMount, onAnnotationCommand, commandActive = false, dynamicBlockEditing = false, onSmartBlockCommand, smartBlockDetection, libraryBrowser, onBrowseLibrary, onSelectConstraintObjects, parametersEnabled = false }) {
    const { t, locale } = useI18n();
    const [internalPanel, setInternalPanel] = useState('selection');
    const requested = panel || internalPanel;
    const manager = Object.hasOwn(MANAGER_PANELS, requested) ? requested : null;
    const [lastTab, setLastTab] = useState('selection');
    const [collapsed, setCollapsed] = useStoredFlag(SIDEBAR_COLLAPSED_KEY);
    const tab = manager ? lastTab : requested;
    const open = next => {
        setInternalPanel(next);
        onPanelChange?.(next);
    };
    const showTab = next => (manager ? setLastTab(next) : open(next));
    useEffect(() => {
        if (!manager) setLastTab(requested);
    }, [requested, manager]);
    // A selection opens Properties, except from the Library, where selecting
    // objects is the first step of creating or replacing a block.
    useEffect(() => {
        const selectedIdSet = new Set(selectedIds);
        if (tab !== 'blocks' && content.entities.some(entity => selectedIdSet.has(entity.id))) showTab('selection');
    }, [selectedIds.join('|')]);
    useEffect(() => {
        if (editEntityId && tab !== 'blocks') showTab('selection');
    }, [editEntityId]);
    const managerContent = {
        textStyles: () => <TextStylesPanel content={content} onCommit={onCommit} t={t} />,
        dimensionStyles: () => <DrawingDimensionStylesPanel content={content} selectedIds={selectedIds} onCommand={onDimensionStyleCommand} t={t} />,
        plotStyles: () => <DrawingPlotStylesPanel content={content} onCommand={onPlotStyleCommand} t={t} />,
        parameters: () => <DrawingParametersPanel content={content} selectedIds={selectedIds} enabled={parametersEnabled} onCommit={onCommit} onSelect={onSelectConstraintObjects} t={t} locale={locale} />,
        constraints: () => <DrawingConstraintsPanel content={content} selectedIds={selectedIds} onCommit={onCommit} onSelect={onSelectConstraintObjects} t={t} />,
        inquiry: () => <DrawingInquiryPanel comparisonPreview={comparisonPreview} settings={content.settings} layers={content.layers} blocks={content.blocks} result={inquiryResult} onCopy={onCopyInquiry} onInspectTransmittal={onInspectTransmittal} onSelectDuplicateGroup={onSelectDuplicateGroup} onSelectCountOccurrence={onSelectCountOccurrence} onOpenRecovery={onOpenRecovery} canOpenRecovery={canOpenRecovery} onSelectRecovery={onSelectRecovery} onShowRecoveryManager={onShowRecoveryManager} hasRecoveryGraph={hasRecoveryGraph} onShowRecoveryHistory={onShowRecoveryHistory} onRetryRecovery={onRetryRecovery} onForgetRecovery={onForgetRecovery} onRelinkRecovery={onRelinkRecovery} canRelinkRecovery={canRelinkRecovery} t={t} />,
    };
    const tabs = [
        ...(dynamicBlockEditing ? [['blockVariants', t('commands.blockTable')]] : []),
        ['selection', t('sidebar.properties')],
        ['layers', t('sidebar.layers')],
        ['blocks', t('sidebar.library')],
    ];
    const managers = Object.entries(MANAGER_PANELS).filter(([id]) => id !== 'parameters' || parametersEnabled);
    const managerWindow = manager && (
        <DrawingManagerWindow title={t(MANAGER_PANELS[manager])} closeLabel={t('sidebar.closeManager')} moveLabel={t('sidebar.moveManager')}
            commandActive={commandActive} onClose={() => open(lastTab)}>
            {managerContent[manager]()}
        </DrawingManagerWindow>
    );
    const collapseToggle = (
        <Button type="button" className="drawing-sidebar-collapse" aria-expanded={!collapsed}
            aria-label={t(collapsed ? 'sidebar.expandPanel' : 'sidebar.collapsePanel')} title={t(collapsed ? 'sidebar.expandPanel' : 'sidebar.collapsePanel')}
            onClick={() => setCollapsed(!collapsed)}>
            <Icon name={collapsed ? 'sidebarExpand' : 'sidebarCollapse'} size="sm" />
        </Button>
    );
    if (collapsed) {
        // A narrow strip keeps the tabs one click away and the managers open.
        return (
            <aside className="drawing-sidebar is-collapsed">
                {collapseToggle}
                {tabs.map(([id, label]) => (
                    <Button type="button" key={id} className="ui-icon-button is-small" aria-label={label} title={label}
                        onClick={() => { setCollapsed(false); showTab(id); }}>
                        <Icon name={{ selection: 'properties', layers: 'layers', blocks: 'blocks' }[id] || 'properties'} size="sm" />
                    </Button>
                ))}
                <DrawingManageMenu managers={managers} current={manager} onOpen={open} t={t} />
                {managerWindow}
            </aside>
        );
    }
    return (
        <aside className="drawing-sidebar">
            {collapseToggle}
            <div className="drawing-sidebar-header">
                <div className="drawing-sidebar-tabs" role="tablist">
                    {tabs.map(([id, label]) => (
                        <Button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => showTab(id)}>{label}</Button>
                    ))}
                </div>
                <DrawingManageMenu managers={managers} current={manager} onOpen={open} t={t} />
            </div>
            <div className="drawing-sidebar-content" role="tabpanel">
                {dynamicBlockEditing && tab === 'blockVariants' && <DrawingBlockVariantEditor content={content} selectedIds={selectedIds} onCommit={onCommit} t={t} />}
                {tab === 'selection' && (
                    <>
                        <SelectionPanel content={content} selectedIds={selectedIds} onCommit={onCommit} t={t}
                            geometryMount={<div className="drawing-properties-mount" ref={onCreationControlsMount} />} />
                        <DrawingAnnotationFields content={content} selectedIds={selectedIds} onCommand={onAnnotationCommand} t={t} />
                    </>
                )}
                {tab === 'layers' && <DrawingLayersPanel content={content} onCommit={onCommit} filter={layerFilter} onFilter={onLayerFilter} onMergeLayer={onMergeLayer} t={t} />}
                {tab === 'blocks' && <DrawingBlocksPanel libraryBrowser={libraryBrowser} onBrowseLibrary={onBrowseLibrary} onSmartCommand={onSmartBlockCommand} detection={smartBlockDetection} content={content} selectedIds={selectedIds} search={blockSearch} onSearch={onBlockSearch} onDefine={onBlockDefine} onInsert={onBlockInsert} onEdit={onBlockEdit} onImport={onBlockImport} onExport={onBlockExport} onManageAttribute={onManageAttribute} onDefineAttribute={onDefineAttribute} />}
            </div>
            {managerWindow}
        </aside>
    );
}

const SIDEBAR_COLLAPSED_KEY = 'lumcad.sidebar.collapsed';

// A per-viewer display preference kept in browser storage when available.
function useStoredFlag(key) {
    const [value, setValue] = useState(() => {
        try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
    });
    const update = next => {
        setValue(next);
        try { window.localStorage.setItem(key, next ? '1' : '0'); } catch { /* storage unavailable */ }
    };
    return [value, update];
}

// Permanent access to the managers, whatever the tab and the selection.
function DrawingManageMenu({ managers, current, onOpen, t }) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        menuRef.current?.querySelector('[role="menu"] button')?.focus();
        const close = event => {
            if (event.type === 'keydown' ? event.key === 'Escape' : !menuRef.current?.contains(event.target)) {
                if (event.type === 'keydown') event.preventDefault();
                setOpen(false);
            }
        };
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('keydown', close, true);
        return () => {
            window.removeEventListener('pointerdown', close, true);
            window.removeEventListener('keydown', close, true);
        };
    }, [open]);
    return (
        <div className="drawing-manage-menu" ref={menuRef}>
            <Button type="button" className="drawing-manage-trigger" aria-haspopup="menu" aria-expanded={open}
                aria-label={t('sidebar.manage')} title={t('sidebar.manageHint')} onClick={() => setOpen(value => !value)}>
                <Icon name="manage" size="sm" /><span>{t('sidebar.manage')}</span>
            </Button>
            {open && (
                <div className="ui-popover drawing-manage-popover" role="menu" aria-label={t('sidebar.manage')}>
                    {managers.map(([id, labelKey]) => (
                        <Button type="button" role="menuitem" key={id} aria-current={current === id || undefined}
                            onClick={() => { setOpen(false); onOpen(id); }}>
                            {t(labelKey)}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}

function TextStylesPanel({ content, onCommit, t }) {
    const commitStyles = (styles, activeTextStyleId = content.activeTextStyleId) => onCommit({
        ...content,
        textStyles: styles,
        activeTextStyleId,
    });
    return (
        <DrawingTextStylesPanel
            styles={content.textStyles}
            selectedStyleId={content.activeTextStyleId}
            labels={drawingTextStyleLabels(t)}
            onSelect={activeTextStyleId => commitStyles(content.textStyles, activeTextStyleId)}
            onCreate={draft => {
                const textStyles = addDrawingTextStyle(content.textStyles, draft);
                commitStyles(textStyles, textStyles.at(-1)?.id || content.activeTextStyleId);
            }}
            onRename={(id, name) => commitStyles(updateDrawingTextStyle(content.textStyles, id, { name }))}
            onUpdate={(id, patch) => commitStyles(updateDrawingTextStyle(content.textStyles, id, patch))}
            onDelete={id => {
                const textStyles = removeDrawingTextStyle(content.textStyles, id);
                onCommit(reassignDeletedTextStyle({
                    ...content,
                    textStyles,
                    activeTextStyleId: content.activeTextStyleId === id
                        ? DEFAULT_DRAWING_TEXT_STYLE_ID
                        : content.activeTextStyleId,
                }, id));
            }}
        />
    );
}

function reassignDeletedTextStyle(content, deletedStyleId) {
    const reassign = entity => {
        if (entity?.type === 'text' && entity.textStyleId === deletedStyleId) {
            return { ...entity, textStyleId: DEFAULT_DRAWING_TEXT_STYLE_ID };
        }
        if (entity?.type === 'polyline' && Array.isArray(entity.parts)) {
            return { ...entity, parts: entity.parts.map(reassign) };
        }
        return entity;
    };
    return {
        ...content,
        entities: content.entities.map(reassign),
        blocks: (content.blocks || []).map(block => ({ ...block, entities: block.entities.map(reassign) })),
    };
}

function drawingTextStyleLabels(t) {
    return {
        panel: t('textStyles.panel'),
        title: t('textStyles.title'),
        create: t('textStyles.create'),
        newStyleName: t('textStyles.newStyleName'),
        list: t('textStyles.list'),
        name: t('textStyles.name'),
        font: t('textStyles.font'),
        fontSize: t('textStyles.fontSize'),
        weight: t('textStyles.weight'),
        normal: t('textStyles.normal'),
        bold: t('textStyles.bold'),
        fontStyle: t('textStyles.fontStyle'),
        italic: t('textStyles.italic'),
        lineHeight: t('textStyles.lineHeight'),
        underline: t('textStyles.underline'),
        strikethrough: t('textStyles.strikethrough'),
        preview: t('textStyles.preview'),
        previewText: t('textStyles.previewText'),
        delete: t('textStyles.delete'),
        fonts: {
            sans: t('textStyles.fonts.sans'),
            serif: t('textStyles.fonts.serif'),
            monospace: t('textStyles.fonts.monospace'),
            technical: t('textStyles.fonts.technical'),
        },
        styleNames: {
            [DEFAULT_DRAWING_TEXT_STYLE_ID]: t('textStyles.styleNames.text-style-standard'),
        },
    };
}

// Order of the Properties tab: type and count, general properties, geometry
// (fields portaled by the canvas into `geometryMount`), type-specific fields,
// then the object link, collapsed.
function SelectionPanel({ content, selectedIds, onCommit, geometryMount, t }) {
    const selectedIdSet = new Set(selectedIds);
    const selected = content.entities.filter(entity => selectedIdSet.has(entity.id));
    if (selected.length === 0) return <>{geometryMount}<p className="drawing-sidebar-empty">{t('sidebar.selectObjects')}</p></>;
    const single = selected.length === 1 ? selected[0] : null;
    const selectionLocked = selected.some(entity => !canEditEntity(content, entity));
    const selectedQdimSeriesIds = new Set(selected.flatMap(entity => (
        entity.type === 'linearDimension' && entity.seriesId ? [entity.seriesId] : []
    )));
    const qdimSeriesAnchor = selectedQdimSeriesIds.size === 1
        && selected.every(entity => entity.type === 'linearDimension' && entity.seriesId === selected[0]?.seriesId)
        ? selected[0]
        : null;
    const qdimSeries = qdimSeriesAnchor
        ? content.entities.filter(entity => entity.type === 'linearDimension' && entity.seriesId === qdimSeriesAnchor.seriesId)
        : [];
    const orderedQdimSeries = [...qdimSeries].sort((left, right) => (
        Number(left.seriesIndex || 0) - Number(right.seriesIndex || 0)
    ));
    const qdimOffset = Number(orderedQdimSeries[0]?.offset ?? 0.6);
    const qdimSpacing = orderedQdimSeries.length > 1
        ? Math.abs(Number(orderedQdimSeries[1].offset) - qdimOffset)
        : DEFAULT_DRAWING_QDIM_BASELINE_SPACING;
    const qdimSeriesLocked = qdimSeries.some(entity => !canEditEntity(content, entity));
    const setSelected = updater => onCommit(updateSelectedEntities(content, selectedIds, updater));
    const setLocked = locked => {
        const ids = new Set(selectedIds);
        onCommit({
            ...content,
            entities: content.entities.map(entity => ids.has(entity.id) ? { ...entity, locked } : entity),
        });
    };
    const typeSummary = summarizeDrawingSelectionTypes(selected);
    return (
        <section className="drawing-selection-panel">
            <header className="drawing-selection-header">
                <h3>{single ? entityTypeLabel(single.type, t) : t('sidebar.selectedCount', { count: selected.length })}</h3>
                <p className="drawing-selection-type">
                    {single
                        ? t('sidebar.selectedCount', { count: 1 })
                        : typeSummary.map(({ type, count }) => t('sidebar.typeCount', { type: entityTypeLabel(type, t), count })).join(' · ')}
                </p>
            </header>
            {selected.length > DRAWING_GRIP_OBJECT_LIMIT && <p className="drawing-sidebar-empty" role="status">{t('sidebar.largeSelectionGrips', { limit: DRAWING_GRIP_OBJECT_LIMIT })}</p>}
            <section className="drawing-properties-section">
                <h4>{t('sidebar.general')}</h4>
                <label className="drawing-sidebar-field">
                    <span>{t('sidebar.layer')}</span>
                    <Select disabled={selectionLocked} value={single?.layerId || ''} onChange={event => setSelected(entity => ({ ...entity, layerId: event.target.value }))}>
                        {!single && <option value="">{t('sidebar.multipleLayers')}</option>}
                        {content.layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                    </Select>
                </label>
                <DrawingEntityAppearanceFields
                    content={content}
                    disabled={selectionLocked}
                    entities={selected}
                    onUpdate={setSelected}
                    showHeading={false}
                    t={t}
                />
                <label className="drawing-sidebar-check">
                    <Input type="checkbox" checked={selected.every(entity => entity.locked)} onChange={event => setLocked(event.target.checked)} />
                    {t('sidebar.lockSelection', { count: selected.length })}
                </label>
            </section>
            {geometryMount}
            {single?.type === 'blockReference' && <DrawingBlockAttributeFields content={content} reference={single} disabled={selectionLocked} onCommit={onCommit} t={t} />}
            {single?.type === 'blockReference' && <DrawingBlockParameterFields content={content} reference={single} disabled={selectionLocked} onCommit={onCommit} t={t} />}
            {single && isDrawingDimensionEntity(single) && !qdimSeriesAnchor && (
                <DrawingDimensionFields
                    automaticBreakTruncated={Boolean(single.dimensionAutoBreak && presentDrawingDimension(getDimensionGeometry(single, createDimensionSourceMap(content.entities, content.blocks, content)), single)?.automaticBreakTruncated)}
                    dimension={single}
                    disabled={selectionLocked}
                    onChange={(nextDimension, patch) => setSelected(() => retainDimensionStyleOverrides(nextDimension, patch))}
                    t={t}
                />
            )}
            {qdimSeries.length > 0 && (
                <DrawingQdimOptions
                    mode={qdimSeriesAnchor.seriesMode}
                    baselineEnd={qdimSeriesAnchor.baselineEnd}
                    offset={qdimOffset}
                    spacing={qdimSpacing}
                    disabled={selectionLocked || qdimSeriesLocked}
                    onChange={next => {
                        const result = rebuildQdimSeriesResult(content, qdimSeriesAnchor.seriesId, next);
                        if (result.changed) onCommit(result.content);
                    }}
                    t={t}
                />
            )}
            {single?.type === 'image' && (
                <>
                    <label className="drawing-sidebar-field">
                        <span>{t('sidebar.opacity', { value: Math.round((single.opacity ?? 0.55) * 100) })}</span>
                        <Input disabled={selectionLocked} type="range" min="0.05" max="1" step="0.05" value={single.opacity ?? 0.55} onChange={event => setSelected(entity => ({ ...entity, opacity: Number(event.target.value) }))} />
                    </label>
                    <label className="drawing-sidebar-check">
                        <Input disabled={selectionLocked} type="checkbox" checked={Boolean(single.includeInPdf)} onChange={event => setSelected(entity => ({ ...entity, includeInPdf: event.target.checked }))} />
                        {t('sidebar.includeReferenceInPdf')}
                    </label>
                </>
            )}
            {single && (
                <Disclosure className="drawing-creation-details drawing-properties-link" label={single.hyperlink ? t('hyperlink.titleSet') : t('hyperlink.title')}>
                    <DrawingHyperlinkFields content={content} entity={single} disabled={selectionLocked} onCommit={onCommit} />
                </Disclosure>
            )}
        </section>
    );
}

function entityTypeLabel(type, t) {
    return t(`entity.${type}`);
}
