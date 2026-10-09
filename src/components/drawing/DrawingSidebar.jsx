import { DRAWING_GRIP_OBJECT_LIMIT } from '~utils/drawingSelection';
import { Button, Input, Select } from '~components/ui/Controls';
import DrawingHyperlinkFields from '~components/drawing/DrawingHyperlinkFields';
import DrawingParametersPanel from '~components/drawing/DrawingParametersPanel';
import DrawingConstraintsPanel from '~components/drawing/DrawingConstraintsPanel';
import DrawingBlockVariantEditor from '~components/drawing/DrawingBlockVariantEditor';
import DrawingAnnotationFields from '~components/drawing/DrawingAnnotationFields';
import DrawingPlotStylesPanel from '~components/drawing/DrawingPlotStylesPanel';
import { filterDrawingLayers } from '~utils/drawingLayers';
import DrawingInquiryPanel from '~components/drawing/DrawingInquiryPanel';
import { createDimensionSourceMap } from '~utils/drawingDimensionSources';
import { presentDrawingDimension } from '~utils/drawingDimensionPresentation';
import { retainDimensionStyleOverrides } from '~utils/drawingDimensionStyles';
import DrawingDimensionStylesPanel from '~components/drawing/DrawingDimensionStylesPanel';
import DrawingBlockAttributeFields from '~components/drawing/DrawingBlockAttributeFields';
import DrawingBlockParameterFields from '~components/drawing/DrawingBlockParameterFields';
import DrawingBlocksPanel from '~components/drawing/DrawingBlocksPanel';
import React, { useEffect, useMemo, useState } from 'react';

import Icon from '~components/ui/Icon';

import { DrawingEntityAppearanceFields, DrawingLayerAppearanceFields } from '~components/drawing/DrawingAppearanceFields';
import DrawingDimensionFields from '~components/drawing/DrawingDimensionFields';
import DrawingQdimOptions from '~components/drawing/DrawingQdimOptions';
import DrawingTextStylesPanel from '~components/drawing/DrawingTextStylesPanel';
import { useI18n } from '~i18n/I18nProvider';
import { addLayer, canEditEntity, isProtectedDrawingLayer, removeEmptyLayer, updateLayer, updateSelectedEntities } from '~utils/drawingDocument';
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
    parameters: 'commands.parameters',
    constraints: 'commands.geomConstraint',
    inquiry: 'inquiry.title',
});

export default function DrawingSidebar({ content, selectedIds, editEntityId = null, onCommit, panel, onPanelChange, blockSearch, onBlockSearch, onBlockDefine, onBlockInsert, onBlockEdit, onBlockImport, onBlockExport, onManageAttribute, onDefineAttribute, onDimensionStyleCommand, inquiryResult, comparisonPreview, onCopyInquiry, onInspectTransmittal, onSelectDuplicateGroup, onSelectCountOccurrence, onOpenRecovery, canOpenRecovery = false, onSelectRecovery, onShowRecoveryManager, hasRecoveryGraph = false, onShowRecoveryHistory, onRetryRecovery, onForgetRecovery, onRelinkRecovery, canRelinkRecovery, layerFilter, onLayerFilter, onPlotStyleCommand, onCreationControlsMount, onAnnotationCommand, dynamicBlockEditing = false, onSmartBlockCommand, smartBlockDetection, libraryBrowser, onBrowseLibrary, onSelectConstraintObjects, parametersEnabled = false }) {
    const { t, locale } = useI18n();
    const [internalPanel, setInternalPanel] = useState('selection');
    const requested = panel || internalPanel;
    const manager = Object.hasOwn(MANAGER_PANELS, requested) ? requested : null;
    const [lastTab, setLastTab] = useState('selection');
    const tab = manager ? lastTab : requested;
    const open = next => {
        setInternalPanel(next);
        onPanelChange?.(next);
    };
    const showTab = next => (manager ? setLastTab(next) : open(next));
    useEffect(() => {
        if (!manager) setLastTab(requested);
    }, [requested, manager]);
    useEffect(() => {
        const selectedIdSet = new Set(selectedIds);
        if (content.entities.some(entity => selectedIdSet.has(entity.id))) showTab('selection');
    }, [selectedIds.join('|')]);
    useEffect(() => {
        if (editEntityId) showTab('selection');
    }, [editEntityId]);
    const managerContent = {
        textStyles: () => <TextStylesPanel content={content} onCommit={onCommit} t={t} />,
        dimensionStyles: () => <DrawingDimensionStylesPanel content={content} selectedIds={selectedIds} onCommand={onDimensionStyleCommand} t={t} />,
        plotStyles: () => <DrawingPlotStylesPanel content={content} onCommand={onPlotStyleCommand} t={t} />,
        parameters: () => <DrawingParametersPanel content={content} selectedIds={selectedIds} enabled={parametersEnabled} onCommit={onCommit} onSelect={onSelectConstraintObjects} t={t} locale={locale} />,
        constraints: () => <DrawingConstraintsPanel content={content} selectedIds={selectedIds} onCommit={onCommit} onSelect={onSelectConstraintObjects} t={t} />,
        inquiry: () => <DrawingInquiryPanel comparisonPreview={comparisonPreview} settings={content.settings} result={inquiryResult} onCopy={onCopyInquiry} onInspectTransmittal={onInspectTransmittal} onSelectDuplicateGroup={onSelectDuplicateGroup} onSelectCountOccurrence={onSelectCountOccurrence} onOpenRecovery={onOpenRecovery} canOpenRecovery={canOpenRecovery} onSelectRecovery={onSelectRecovery} onShowRecoveryManager={onShowRecoveryManager} hasRecoveryGraph={hasRecoveryGraph} onShowRecoveryHistory={onShowRecoveryHistory} onRetryRecovery={onRetryRecovery} onForgetRecovery={onForgetRecovery} onRelinkRecovery={onRelinkRecovery} canRelinkRecovery={canRelinkRecovery} t={t} />,
    };
    const tabs = [
        ...(dynamicBlockEditing ? [['blockVariants', t('commands.blockTable')]] : []),
        ['selection', t('sidebar.properties')],
        ['layers', t('sidebar.layers')],
        ['blocks', t('sidebar.library')],
    ];
    return (
        <aside className="drawing-sidebar">
            <div className="drawing-sidebar-tabs" role="tablist">
                {tabs.map(([id, label]) => (
                    <Button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => showTab(id)}>{label}</Button>
                ))}
            </div>
            <div className="drawing-sidebar-content" role="tabpanel">
                {dynamicBlockEditing && tab === 'blockVariants' && <DrawingBlockVariantEditor content={content} selectedIds={selectedIds} onCommit={onCommit} t={t} />}
                {tab === 'selection' && (
                    <>
                        <div className="drawing-properties-mount" ref={onCreationControlsMount} />
                        <SelectionPanel content={content} selectedIds={selectedIds} onCommit={onCommit} t={t} />
                        {!selectedIds.length && (
                            <section className="ui-section drawing-manage-section">
                                <header>{t('sidebar.manage')}</header>
                                <div className="drawing-manage-grid">
                                    {Object.entries(MANAGER_PANELS)
                                        .filter(([id]) => id !== 'parameters' || parametersEnabled)
                                        .map(([id, labelKey]) => <Button type="button" key={id} onClick={() => open(id)}>{t(labelKey)}</Button>)}
                                </div>
                            </section>
                        )}
                        <DrawingAnnotationFields content={content} selectedIds={selectedIds} onCommand={onAnnotationCommand} t={t} />
                    </>
                )}
                {tab === 'layers' && <LayersPanel content={content} onCommit={onCommit} filter={layerFilter} onFilter={onLayerFilter} t={t} />}
                {tab === 'blocks' && <DrawingBlocksPanel libraryBrowser={libraryBrowser} onBrowseLibrary={onBrowseLibrary} onSmartCommand={onSmartBlockCommand} detection={smartBlockDetection} content={content} selectedIds={selectedIds} search={blockSearch} onSearch={onBlockSearch} onDefine={onBlockDefine} onInsert={onBlockInsert} onEdit={onBlockEdit} onImport={onBlockImport} onExport={onBlockExport} onManageAttribute={onManageAttribute} onDefineAttribute={onDefineAttribute} />}
            </div>
            {manager && (
                <DrawingManagerWindow title={t(MANAGER_PANELS[manager])} closeLabel={t('sidebar.closeManager')} onClose={() => open(lastTab)}>
                    {managerContent[manager]()}
                </DrawingManagerWindow>
            )}
        </aside>
    );
}

// Non-modal window: the drawing stays usable, e.g. to pick objects for constraints.
function DrawingManagerWindow({ title, closeLabel, onClose, children }) {
    useEffect(() => {
        const closeOnEscape = event => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
        window.addEventListener('keydown', closeOnEscape);
        return () => window.removeEventListener('keydown', closeOnEscape);
    }, [onClose]);
    return (
        <section className="ui-popover drawing-manager-window" role="dialog" aria-label={title}>
            <header>
                <h2>{title}</h2>
                <Button type="button" className="ui-icon-button is-small" aria-label={closeLabel} title={closeLabel} onClick={onClose}><Icon name="close" size="sm" /></Button>
            </header>
            <div className="drawing-manager-body">{children}</div>
        </section>
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

function LayersPanel({ content, onCommit, filter, onFilter, t }) {
    const entityCounts = useMemo(() => content.entities.reduce((counts, entity) => {
        counts[entity.layerId] = (counts[entity.layerId] || 0) + 1;
        return counts;
    }, {}), [content.entities]);
    return (
        <section className="drawing-layer-panel">
            <div className="drawing-sidebar-heading">
                <div><strong>{t('sidebar.layers')}</strong><small>{t('sidebar.layerCount', { count: content.layers.length })}</small></div>
                <Button type="button" onClick={() => onCommit(addLayer(content, t('document.newLayer', { number: content.layers.length + 1 })))}>{t('sidebar.add')}</Button>
            </div>
            <Input aria-label={t('layerManager.filter')} placeholder={t('layerManager.filterHint')} value={filter || ''} onChange={event => onFilter?.(event.target.value)} />
            <div className="drawing-layer-list">
                {filterDrawingLayers(content.layers, filter).map(layer => (
                    <LayerRow key={layer.id} layer={layer} content={content} count={entityCounts[layer.id] || 0} onCommit={onCommit} t={t} />
                ))}
            </div>
        </section>
    );
}

// One compact row per layer; appearance and less frequent flags expand below it.
function LayerRow({ layer, content, count, onCommit, t }) {
    const [expanded, setExpanded] = useState(false);
    const update = updates => onCommit(updateLayer(content, layer.id, updates));
    const active = content.activeLayerId === layer.id;
    const toggles = [
        ['visible', layer.visible, layer.visible ? 'eye' : 'eyeOff', t(layer.visible ? 'sidebar.hide' : 'sidebar.show')],
        ['locked', layer.locked, layer.locked ? 'lock' : 'unlock', t(layer.locked ? 'sidebar.unlock' : 'sidebar.lock')],
        ['frozen', layer.frozen, 'freeze', t('layerManager.frozen')],
        ['plot', layer.plot !== false, 'plot', t('layerManager.plot')],
    ];
    return (
        <div className={`drawing-layer-row ${active ? 'is-active' : ''}`}>
            <div className="drawing-layer-row-header">
                <Input
                    type="radio"
                    name="activeDrawingLayer"
                    aria-label={t('sidebar.activateLayer', { name: layer.name })}
                    checked={active}
                    onChange={() => onCommit({ ...content, activeLayerId: layer.id })}
                />
                <span className="drawing-layer-swatch" style={{ background: layer.color }} aria-hidden="true" />
                <div className="drawing-layer-main">
                    <Input
                        value={layer.name}
                        disabled={isProtectedDrawingLayer(layer.id)}
                        title={isProtectedDrawingLayer(layer.id) ? t('sidebar.protectedLayer') : undefined}
                        onChange={event => update({ name: event.target.value })}
                        aria-label={t('sidebar.layerName')}
                    />
                    <small>{t('sidebar.objectCount', { count })}</small>
                </div>
                <div className="drawing-layer-actions">
                    {toggles.map(([field, on, icon, label]) => (
                        <Button type="button" key={field} className={on ? 'is-active' : ''} aria-pressed={Boolean(on)} title={label} aria-label={label}
                            onClick={() => update({ [field]: field === 'plot' ? !on : !layer[field] })}>
                            <Icon name={icon} size="sm" />
                        </Button>
                    ))}
                    <Button type="button" aria-expanded={expanded} title={t('sidebar.layerDetails')} aria-label={t('sidebar.layerDetails')} onClick={() => setExpanded(open => !open)}>
                        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size="sm" />
                    </Button>
                </div>
            </div>
            {expanded && (
                <div className="drawing-layer-details">
                    <DrawingLayerAppearanceFields layer={layer} t={t} onChange={update} />
                    <div className="drawing-layer-flags">
                        <label>
                            <Input type="checkbox" checked={Boolean(layer.newViewportFrozen)} onChange={event => update({ newViewportFrozen: event.target.checked })} />
                            {t('layerManager.newViewportFrozen')}
                        </label>
                        <Button type="button" className="ui-button is-small is-danger" disabled={Boolean(count) || isProtectedDrawingLayer(layer.id)}
                            title={t('sidebar.deleteEmptyLayer')} onClick={() => onCommit(removeEmptyLayer(content, layer.id))}>
                            {t('sidebar.deleteEmptyLayer')}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}

function SelectionPanel({ content, selectedIds, onCommit, t }) {
    const selectedIdSet = new Set(selectedIds);
    const selected = content.entities.filter(entity => selectedIdSet.has(entity.id));
    if (selected.length === 0) return <p className="drawing-sidebar-empty">{t('sidebar.selectObjects')}</p>;
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
    return (
        <section className="drawing-selection-panel">
            <h3>{t('sidebar.selectedCount', { count: selected.length })}</h3>
            {selected.length > DRAWING_GRIP_OBJECT_LIMIT && <p className="drawing-sidebar-empty" role="status">{t('sidebar.largeSelectionGrips', { limit: DRAWING_GRIP_OBJECT_LIMIT })}</p>}
            {single && <p className="drawing-selection-type">{t('sidebar.type')} : <strong>{entityTypeLabel(single.type, t)}</strong></p>}
            <label className="drawing-sidebar-check">
                <Input type="checkbox" checked={selected.every(entity => entity.locked)} onChange={event => setLocked(event.target.checked)} />
                {t('sidebar.lockSelection', { count: selected.length })}
            </label>
            <label className="drawing-sidebar-field">
                <span>{t('sidebar.layer')}</span>
                <Select disabled={selectionLocked} value={single?.layerId || ''} onChange={event => setSelected(entity => ({ ...entity, layerId: event.target.value }))}>
                    {!single && <option value="">{t('sidebar.multipleLayers')}</option>}
                    {content.layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                </Select>
            </label>
            {single?.type === 'blockReference' && <DrawingBlockAttributeFields content={content} reference={single} disabled={selectionLocked} onCommit={onCommit} t={t} />}
            {single?.type === 'blockReference' && <DrawingBlockParameterFields content={content} reference={single} disabled={selectionLocked} onCommit={onCommit} t={t} />}
            {single && <DrawingHyperlinkFields content={content} entity={single} disabled={selectionLocked} onCommit={onCommit} />}
            <DrawingEntityAppearanceFields
                content={content}
                disabled={selectionLocked}
                entities={selected}
                onUpdate={setSelected}
                t={t}
            />
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
        </section>
    );
}

function entityTypeLabel(type, t) {
    return t(`entity.${type}`);
}
