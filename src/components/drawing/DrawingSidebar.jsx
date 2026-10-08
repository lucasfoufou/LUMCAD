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

export default function DrawingSidebar({ content, selectedIds, onCommit, panel, onPanelChange, blockSearch, onBlockSearch, onBlockDefine, onBlockInsert, onBlockEdit, onBlockImport, onBlockExport, onManageAttribute, onDefineAttribute, onDimensionStyleCommand, inquiryResult, comparisonPreview, onCopyInquiry, onSelectDuplicateGroup, onSelectCountOccurrence, onOpenRecovery, canOpenRecovery = false, onSelectRecovery, onShowRecoveryManager, hasRecoveryGraph = false, onShowRecoveryHistory, onRetryRecovery, onForgetRecovery, onRelinkRecovery, canRelinkRecovery, layerFilter, onLayerFilter, onPlotStyleCommand, onCreationControlsMount, onAnnotationCommand, dynamicBlockEditing = false, onSmartBlockCommand, smartBlockDetection, libraryBrowser, onBrowseLibrary, onSelectConstraintObjects, parametersEnabled = false }) {
    const { t, locale } = useI18n();
    const [internalTab, setInternalTab] = useState('layers');
    const tab = panel || internalTab;
    const setTab = nextTab => {
        setInternalTab(nextTab);
        onPanelChange?.(nextTab);
    };
    useEffect(() => {
        const selected = content.entities.find(entity => selectedIds.includes(entity.id));
        const reportSelection = tab === 'inquiry' && inquiryResult?.selectedIds?.join('|') === selectedIds.join('|');
        if (selected && !reportSelection && !['constraints', 'parameters'].includes(tab)) setTab('selection');
    }, [selectedIds.join('|')]);
    return (
        <aside className="drawing-sidebar">
            <div className="drawing-sidebar-tabs" role="tablist">
                {dynamicBlockEditing && <button type="button" className={tab === 'blockVariants' ? 'is-active' : ''} onClick={() => setTab('blockVariants')}>{t('commands.blockTable')}</button>}
                <button type="button" className={tab === 'layers' ? 'is-active' : ''} onClick={() => setTab('layers')}>{t('sidebar.layers')}</button>
                <button type="button" className={tab === 'selection' ? 'is-active' : ''} onClick={() => setTab('selection')}>{t('sidebar.selection')}</button>
                <button type="button" className={tab === 'textStyles' ? 'is-active' : ''} onClick={() => setTab('textStyles')}>{t('sidebar.textStyles')}</button>
                <button type="button" className={tab === 'dimensionStyles' ? 'is-active' : ''} onClick={() => setTab('dimensionStyles')}>{t('commands.dimensionStyle')}</button>
                <button type="button" className={tab === 'blocks' ? 'is-active' : ''} onClick={() => setTab('blocks')}>{t('block.palette')}</button>
                <button type="button" className={tab === 'plotStyles' ? 'is-active' : ''} onClick={() => setTab('plotStyles')}>{t('commands.styleManager')}</button>
                {parametersEnabled && <button type="button" className={tab === 'parameters' ? 'is-active' : ''} onClick={() => setTab('parameters')}>{t('commands.parameters')}</button>}
                <button type="button" className={tab === 'constraints' ? 'is-active' : ''} onClick={() => setTab('constraints')}>{t('commands.geomConstraint')}</button>
                <button type="button" className={tab === 'inquiry' ? 'is-active' : ''} onClick={() => setTab('inquiry')}>{t('inquiry.title')}</button>
            </div>
            <div className="drawing-sidebar-content">
                {dynamicBlockEditing && tab === 'blockVariants' && <DrawingBlockVariantEditor content={content} selectedIds={selectedIds} onCommit={onCommit} t={t} />}
                <DrawingAnnotationFields content={content} selectedIds={selectedIds} onCommand={onAnnotationCommand} t={t} />
                <div className="drawing-properties-mount" ref={onCreationControlsMount} />
                {tab === 'parameters' && <DrawingParametersPanel content={content} selectedIds={selectedIds} enabled={parametersEnabled} onCommit={onCommit} onSelect={onSelectConstraintObjects} t={t} locale={locale} />}
                {tab === 'constraints' && <DrawingConstraintsPanel content={content} selectedIds={selectedIds} onCommit={onCommit} onSelect={onSelectConstraintObjects} t={t} />}
                {tab === 'plotStyles' && <DrawingPlotStylesPanel content={content} onCommand={onPlotStyleCommand} t={t} />}
                {tab === 'inquiry' && <DrawingInquiryPanel comparisonPreview={comparisonPreview} settings={content.settings} result={inquiryResult} onCopy={onCopyInquiry} onSelectDuplicateGroup={onSelectDuplicateGroup} onSelectCountOccurrence={onSelectCountOccurrence} onOpenRecovery={onOpenRecovery} canOpenRecovery={canOpenRecovery} onSelectRecovery={onSelectRecovery} onShowRecoveryManager={onShowRecoveryManager} hasRecoveryGraph={hasRecoveryGraph} onShowRecoveryHistory={onShowRecoveryHistory} onRetryRecovery={onRetryRecovery} onForgetRecovery={onForgetRecovery} onRelinkRecovery={onRelinkRecovery} canRelinkRecovery={canRelinkRecovery} t={t} />}
                {tab === 'layers' && <LayersPanel content={content} onCommit={onCommit} filter={layerFilter} onFilter={onLayerFilter} t={t} />}
                {tab === 'selection' && <SelectionPanel content={content} selectedIds={selectedIds} onCommit={onCommit} t={t} />}
                {tab === 'textStyles' && <TextStylesPanel content={content} onCommit={onCommit} t={t} />}
                {tab === 'dimensionStyles' && <DrawingDimensionStylesPanel content={content} selectedIds={selectedIds} onCommand={onDimensionStyleCommand} t={t} />}
                {tab === 'blocks' && <DrawingBlocksPanel libraryBrowser={libraryBrowser} onBrowseLibrary={onBrowseLibrary} onSmartCommand={onSmartBlockCommand} detection={smartBlockDetection} content={content} selectedIds={selectedIds} search={blockSearch} onSearch={onBlockSearch} onDefine={onBlockDefine} onInsert={onBlockInsert} onEdit={onBlockEdit} onImport={onBlockImport} onExport={onBlockExport} onManageAttribute={onManageAttribute} onDefineAttribute={onDefineAttribute} />}
            </div>
        </aside>
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
                <button type="button" onClick={() => onCommit(addLayer(content, t('document.newLayer', { number: content.layers.length + 1 })))}>{t('sidebar.add')}</button>
            </div>
            <input aria-label={t('layerManager.filter')} placeholder={t('layerManager.filterHint')} value={filter || ''} onChange={event => onFilter?.(event.target.value)} />
            <div className="drawing-layer-list">
                {filterDrawingLayers(content.layers, filter).map(layer => (
                    <div key={layer.id} className={`drawing-layer-row ${content.activeLayerId === layer.id ? 'is-active' : ''}`}>
                        <div className="drawing-layer-row-header">
                            <input
                                type="radio"
                                name="activeDrawingLayer"
                                aria-label={t('sidebar.activateLayer', { name: layer.name })}
                                checked={content.activeLayerId === layer.id}
                                onChange={() => onCommit({ ...content, activeLayerId: layer.id })}
                            />
                            <div className="drawing-layer-main">
                                <input
                                    value={layer.name}
                                    disabled={isProtectedDrawingLayer(layer.id)}
                                    title={isProtectedDrawingLayer(layer.id) ? t('sidebar.protectedLayer') : undefined}
                                    onChange={event => onCommit(updateLayer(content, layer.id, { name: event.target.value }))}
                                    aria-label={t('sidebar.layerName')}
                                />
                                <small>{t('sidebar.objectCount', { count: entityCounts[layer.id] || 0 })}</small>
                            </div>
                            <div className="drawing-layer-actions">
                                <button type="button" className={layer.visible ? 'is-active' : ''} title={t(layer.visible ? 'sidebar.hide' : 'sidebar.show')} onClick={() => onCommit(updateLayer(content, layer.id, { visible: !layer.visible }))}>
                                    {layer.visible ? '◉' : '○'}
                                </button>
                                <button type="button" className={layer.locked ? 'is-active' : ''} title={t(layer.locked ? 'sidebar.unlock' : 'sidebar.lock')} onClick={() => onCommit(updateLayer(content, layer.id, { locked: !layer.locked }))}>
                                    {layer.locked ? '◆' : '◇'}
                                </button>
                                <button
                                    type="button"
                                    className="is-danger"
                                    title={t('sidebar.deleteEmptyLayer')}
                                    disabled={Boolean(entityCounts[layer.id]) || isProtectedDrawingLayer(layer.id)}
                                    onClick={() => onCommit(removeEmptyLayer(content, layer.id))}
                                >×</button>
                            </div>
                        </div>
                        <div className="drawing-layer-flags">
                            {['frozen', 'newViewportFrozen', 'plot'].map(field => <label key={field}>
                                <input type="checkbox" checked={field === 'plot' ? layer[field] !== false : Boolean(layer[field])}
                                    onChange={event => onCommit(updateLayer(content, layer.id, { [field]: event.target.checked }))} />
                                {t(`layerManager.${field}`)}
                            </label>)}
                        </div>
                        <DrawingLayerAppearanceFields
                            layer={layer}
                            t={t}
                            onChange={updates => onCommit(updateLayer(content, layer.id, updates))}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

function SelectionPanel({ content, selectedIds, onCommit, t }) {
    const selected = content.entities.filter(entity => selectedIds.includes(entity.id));
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
            {single && <p className="drawing-selection-type">{t('sidebar.type')} : <strong>{entityTypeLabel(single.type, t)}</strong></p>}
            <label className="drawing-sidebar-check">
                <input type="checkbox" checked={selected.every(entity => entity.locked)} onChange={event => setLocked(event.target.checked)} />
                {t('sidebar.lockSelection', { count: selected.length })}
            </label>
            <label className="drawing-sidebar-field">
                <span>{t('sidebar.layer')}</span>
                <select disabled={selectionLocked} value={single?.layerId || ''} onChange={event => setSelected(entity => ({ ...entity, layerId: event.target.value }))}>
                    {!single && <option value="">{t('sidebar.multipleLayers')}</option>}
                    {content.layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                </select>
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
                        <input disabled={selectionLocked} type="range" min="0.05" max="1" step="0.05" value={single.opacity ?? 0.55} onChange={event => setSelected(entity => ({ ...entity, opacity: Number(event.target.value) }))} />
                    </label>
                    <label className="drawing-sidebar-check">
                        <input disabled={selectionLocked} type="checkbox" checked={Boolean(single.includeInPdf)} onChange={event => setSelected(entity => ({ ...entity, includeInPdf: event.target.checked }))} />
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
