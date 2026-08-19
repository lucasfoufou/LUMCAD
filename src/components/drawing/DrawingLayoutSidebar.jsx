import React from 'react';

import DrawingPaperAnnotationPanel from '~components/drawing/DrawingPaperAnnotationPanel';
import { useI18n } from '~i18n/I18nProvider';
import { DRAWING_LINE_TYPE_OPTIONS, DRAWING_LINE_WEIGHT_OPTIONS } from '~utils/drawingDocument';
import { fitViewBox } from '~utils/drawingGeometry';
import {
    DRAWING_CUSTOM_PAPER_FORMAT,
    DRAWING_ORIENTATION_OPTIONS,
    DRAWING_PAPER_FORMAT_OPTIONS,
    DRAWING_VIEWPORT_ARRANGEMENT_OPTIONS,
    DRAWING_VIEWPORT_CLIP_PRESET_OPTIONS,
    DRAWING_VIEWPORT_SCALE_OPTIONS,
    DRAWING_VIEWPORT_VISUAL_STYLE_OPTIONS,
    applyDrawingPageSetup,
    changeDrawingLayoutCustomPaperSize,
    changeDrawingLayoutFormat,
    changeDrawingLayoutMargins,
    changeDrawingLayoutOrientation,
    createDrawingPageSetupFromLayout,
    createDrawingViewportClipPreset,
    createStandardViewportArrangement,
    clearDrawingViewportLayerOverride,
    getDrawingPaperSize,
    getDrawingViewportScale,
    modelViewBoxFromViewport,
    removeDrawingViewport,
    resizeDrawingViewport,
    setDrawingViewportLayerOverride,
    setDrawingViewportRotation,
    setDrawingViewportScale,
    updateDrawingViewport,
} from '~utils/drawingLayouts';

export default function DrawingLayoutSidebar({
    content,
    currentModelViewport,
    isExporting,
    layout,
    layoutCount,
    onChange,
    onDeleteLayout,
    onExportAll,
    onExportCurrent,
    onExportPageSetups,
    onCreatePageSetup,
    onDeletePageSetup,
    onImportPageSetups,
    onSelectViewport,
    onSelectedPaperEntityChange,
    onToolChange,
    pageSetups = [],
    selectedViewportId,
    selectedPaperEntityId,
}) {
    const { t } = useI18n();
    const viewport = layout.viewports.find(item => item.id === selectedViewportId) || null;
    const updateViewport = patch => onChange(updateDrawingViewport(layout, viewport.id, patch));
    const resizeViewport = patch => onChange(resizeDrawingViewport(layout, viewport.id, patch));
    const setModelView = modelViewBox => {
        if (!viewport.locked) updateViewport({ ...viewport, modelViewBox });
    };
    const fitModel = () => setModelView(fitViewBox(content, viewport.width / viewport.height));
    const useCurrentModelView = () => setModelView(modelViewBoxFromViewport(
        currentModelViewport,
        viewport.width / viewport.height,
    ));
    const zoom = factor => {
        const source = viewport.modelViewBox;
        const width = source.width * factor;
        const height = width * viewport.height / viewport.width;
        setModelView({
            x: source.x + (source.width - width) / 2,
            y: source.y + (source.height - height) / 2,
            width,
            height,
        });
    };

    const deleteViewport = () => {
        onChange(removeDrawingViewport(layout, viewport.id));
        onSelectViewport(null);
        onToolChange('select');
    };

    return (
        <aside className="drawing-sidebar drawing-layout-sidebar">
            <div className="drawing-layout-sidebar-title">
                <strong>{t('layout.properties')}</strong>
                <small>{t('layout.viewportCount', { count: layout.viewports.length })}</small>
            </div>
            <div className="drawing-sidebar-content">
                <label className="drawing-sidebar-field">
                    <span>{t('layout.name')}</span>
                    <input value={layout.name} onChange={event => onChange({ ...layout, name: event.target.value })} />
                </label>
                <label className="drawing-sidebar-field">
                    <span>{t('layout.paperFormat')}</span>
                    <select value={layout.format} onChange={event => onChange(changeDrawingLayoutFormat(layout, event.target.value))}>
                        {DRAWING_PAPER_FORMAT_OPTIONS.map(format => (
                            <option key={format} value={format}>
                                {format === DRAWING_CUSTOM_PAPER_FORMAT ? t('layout.paperFormatCustom') : format}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="drawing-sidebar-field">
                    <span>{t('layout.orientation')}</span>
                    <select value={layout.orientation} onChange={event => onChange(changeDrawingLayoutOrientation(layout, event.target.value))}>
                        {DRAWING_ORIENTATION_OPTIONS.map(orientation => (
                            <option key={orientation} value={orientation}>{t(`layout.orientation.${orientation}`)}</option>
                        ))}
                    </select>
                </label>
                {layout.format === DRAWING_CUSTOM_PAPER_FORMAT && (
                    <CustomPaperFields layout={layout} onChange={onChange} t={t} />
                )}
                <PaperMarginFields layout={layout} onChange={onChange} t={t} />
                <PageSetupProfiles
                    layout={layout}
                    pageSetups={pageSetups}
                    onApply={pageSetup => onChange(applyDrawingPageSetup(layout, pageSetup))}
                    onCreate={onCreatePageSetup
                        ? () => onCreatePageSetup(createDrawingPageSetupFromLayout(layout, { name: layout.name }))
                        : null}
                    onDelete={onDeletePageSetup}
                    onExport={onExportPageSetups}
                    onImport={onImportPageSetups}
                    t={t}
                />
                <StandardArrangementField
                    layout={layout}
                    currentModelViewport={currentModelViewport}
                    onChange={onChange}
                    t={t}
                />
                <div className="drawing-layout-sidebar-actions">
                    <button type="button" onClick={() => onToolChange('viewport')}>{t('layout.addViewport')}</button>
                    <button
                        type="button"
                        className="is-danger"
                        disabled={layoutCount <= 1}
                        onClick={() => { if (window.confirm(t('layout.confirmDelete'))) onDeleteLayout(); }}
                    >
                        {t('layout.deleteLayout')}
                    </button>
                </div>

                <DrawingPaperAnnotationPanel
                    content={content}
                    layout={layout}
                    onChange={onChange}
                    onSelectedPaperEntityChange={onSelectedPaperEntityChange}
                    selectedPaperEntityId={selectedPaperEntityId}
                    t={t}
                />

                {viewport ? (
                    <ViewportFields
                        content={content}
                        viewport={viewport}
                        onChange={updateViewport}
                        onResize={resizeViewport}
                        onFit={fitModel}
                        onUseCurrent={useCurrentModelView}
                        onZoom={zoom}
                        onDelete={deleteViewport}
                        t={t}
                    />
                ) : (
                    <p className="drawing-sidebar-empty">{t('layout.selectViewport')}</p>
                )}

                <section className="drawing-layout-export-panel">
                    <h3>{t('layout.exportTitle')}</h3>
                    <button type="button" disabled={isExporting} onClick={onExportCurrent}>
                        {isExporting ? t('header.preparing') : t('layout.exportCurrent')}
                    </button>
                    <button type="button" disabled={isExporting} onClick={onExportAll}>
                        {t('layout.exportAll')}
                    </button>
                </section>
            </div>
        </aside>
    );
}

function ViewportFields({ content, viewport, onChange, onResize, onFit, onUseCurrent, onZoom, onDelete, t }) {
    const viewBox = viewport.modelViewBox;
    const centerX = viewBox.x + viewBox.width / 2;
    const centerY = viewBox.y + viewBox.height / 2;
    const setModel = patch => onChange({
        ...viewport,
        modelViewBox: { ...viewBox, ...patch },
    });
    return (
        <section className="drawing-layout-viewport-panel">
            <h3>{t('layout.viewportProperties')}</h3>
            <div className="drawing-field-grid">
                <NumberField label={t('layout.xMm')} value={viewport.x} onChange={value => onChange({ ...viewport, x: value })} />
                <NumberField label={t('layout.yMm')} value={viewport.y} onChange={value => onChange({ ...viewport, y: value })} />
                <NumberField label={t('layout.widthMm')} value={viewport.width} min="8" onChange={value => onResize({ width: value })} />
                <NumberField label={t('layout.heightMm')} value={viewport.height} min="8" onChange={value => onResize({ height: value })} />
                <NumberField label={t('layout.modelCenterX')} value={centerX} step="0.1" onChange={value => setModel({ x: value - viewBox.width / 2 })} />
                <NumberField label={t('layout.modelCenterY')} value={centerY} step="0.1" onChange={value => setModel({ y: value - viewBox.height / 2 })} />
            </div>
            <ViewportScaleField viewport={viewport} onChange={onChange} t={t} />
            <ViewportDisplayFields viewport={viewport} onChange={onChange} t={t} />
            <div className="drawing-layout-sidebar-actions is-wrap">
                <button type="button" disabled={viewport.locked} onClick={onFit}>{t('layout.fitModel')}</button>
                <button type="button" disabled={viewport.locked} onClick={onUseCurrent}>{t('layout.useCurrentView')}</button>
                <button type="button" disabled={viewport.locked} onClick={() => onZoom(0.8)}>{t('layout.zoomIn')}</button>
                <button type="button" disabled={viewport.locked} onClick={() => onZoom(1.25)}>{t('layout.zoomOut')}</button>
                <button type="button" className="is-danger" onClick={onDelete}>{t('layout.deleteViewport')}</button>
            </div>
            <ViewportLayerVisibility content={content} viewport={viewport} onChange={onChange} t={t} />
            <p className="drawing-layout-help">{t('layout.viewportHelp')}</p>
        </section>
    );
}

function ViewportScaleField({ viewport, onChange, t }) {
    const scale = getDrawingViewportScale(viewport);
    const preset = DRAWING_VIEWPORT_SCALE_OPTIONS.find(value => Math.abs(value - scale) < 1e-6) || '';
    const applyScale = value => {
        const denominator = Number(value);
        if (denominator > 0) onChange(setDrawingViewportScale(viewport, denominator));
    };
    return (
        <div className="drawing-viewport-scale-field">
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportScalePreset')}</span>
                <select value={preset} onChange={event => applyScale(event.target.value)}>
                    <option value="">{t('layout.customScale')}</option>
                    {DRAWING_VIEWPORT_SCALE_OPTIONS.map(value => <option key={value} value={value}>1 / {value}</option>)}
                </select>
            </label>
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportScale')}</span>
                <span className="drawing-scale-input"><b>1 /</b><input type="number" min="0.000001" step="1" value={roundInput(scale)} disabled={viewport.locked} onChange={event => applyScale(event.target.value)} /></span>
            </label>
        </div>
    );
}

function ViewportLayerVisibility({ content, viewport, onChange, t }) {
    const hidden = new Set(viewport.hiddenLayerIds || []);
    const toggle = layerId => {
        const next = new Set(hidden);
        if (next.has(layerId)) next.delete(layerId);
        else next.add(layerId);
        onChange({ ...viewport, hiddenLayerIds: [...next] });
    };
    return (
        <fieldset className="drawing-viewport-layers">
            <legend>{t('layout.viewportLayers')}</legend>
            <p>{t('layout.viewportLayersHint')}</p>
            {content.layers.map(layer => <ViewportLayerRow
                key={layer.id}
                layer={layer}
                hidden={hidden.has(layer.id)}
                viewport={viewport}
                onChange={onChange}
                onToggle={() => toggle(layer.id)}
                t={t}
            />)}
        </fieldset>
    );
}

function NumberField({ label, value, onChange, disabled = false, max, min, step = '1' }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <input
                type="number"
                disabled={disabled}
                max={max}
                min={min}
                step={step}
                value={roundInput(value)}
                onChange={event => onChange(Number(event.target.value))}
            />
        </label>
    );
}

function CustomPaperFields({ layout, onChange, t }) {
    const paper = getDrawingPaperSize(layout);
    const update = patch => onChange(changeDrawingLayoutCustomPaperSize(layout, {
        width: patch.width ?? paper.width,
        height: patch.height ?? paper.height,
    }));
    return (
        <div className="drawing-field-grid drawing-layout-paper-fields">
            <NumberField label={t('layout.customPaperWidth')} value={paper.width} min="10" max="5000" onChange={width => update({ width })} />
            <NumberField label={t('layout.customPaperHeight')} value={paper.height} min="10" max="5000" onChange={height => update({ height })} />
        </div>
    );
}

function PaperMarginFields({ layout, onChange, t }) {
    const margins = layout.margins || {};
    const update = patch => onChange(changeDrawingLayoutMargins(layout, { ...margins, ...patch }));
    return (
        <fieldset className="drawing-layout-fieldset">
            <legend>{t('layout.paperMargins')}</legend>
            <div className="drawing-field-grid">
                {['top', 'right', 'bottom', 'left'].map(side => (
                    <NumberField
                        key={side}
                        label={t(`layout.margin.${side}`)}
                        value={margins[side] || 0}
                        min="0"
                        step="0.5"
                        onChange={value => update({ [side]: value })}
                    />
                ))}
            </div>
        </fieldset>
    );
}

function PageSetupProfiles({ layout, pageSetups, onApply, onCreate, onDelete, onExport, onImport, t }) {
    return (
        <fieldset className="drawing-layout-fieldset">
            <legend>{t('layout.pageSetups')}</legend>
            <label className="drawing-sidebar-field">
                <span>{t('layout.pageSetupProfile')}</span>
                <select value={layout.pageSetupId || ''} onChange={event => {
                    const pageSetup = pageSetups.find(item => item.id === event.target.value);
                    if (pageSetup) onApply(pageSetup);
                }}>
                    <option value="">{t('layout.pageSetupNone')}</option>
                    {pageSetups.map(pageSetup => <option key={pageSetup.id} value={pageSetup.id}>{pageSetup.name}</option>)}
                </select>
            </label>
            <div className="drawing-layout-sidebar-actions is-wrap">
                <button type="button" disabled={!onCreate} onClick={onCreate || undefined}>{t('layout.savePageSetup')}</button>
                <button type="button" disabled={!onImport} onClick={onImport || undefined}>{t('layout.importPageSetup')}</button>
                <button type="button" disabled={!onExport || pageSetups.length === 0} onClick={onExport || undefined}>{t('layout.exportPageSetups')}</button>
                <button type="button" disabled={!onDelete || !layout.pageSetupId} onClick={() => onDelete?.(layout.pageSetupId)}>{t('layout.deletePageSetup')}</button>
            </div>
        </fieldset>
    );
}

function StandardArrangementField({ currentModelViewport, layout, onChange, t }) {
    const apply = arrangement => {
        if (layout.viewports.length && !window.confirm(t('layout.confirmReplaceViewports'))) return;
        const modelViewBox = currentModelViewport
            ? modelViewBoxFromViewport(currentModelViewport, 1)
            : undefined;
        onChange(createStandardViewportArrangement(layout, arrangement, modelViewBox));
    };
    return (
        <label className="drawing-sidebar-field drawing-layout-arrangement-field">
            <span>{t('layout.standardArrangement')}</span>
            <select defaultValue="" onChange={event => {
                if (event.target.value) apply(event.target.value);
                event.target.value = '';
            }}>
                <option value="">{t('layout.chooseArrangement')}</option>
                {DRAWING_VIEWPORT_ARRANGEMENT_OPTIONS.map(arrangement => (
                    <option key={arrangement} value={arrangement}>{t(`layout.arrangement.${arrangement}`)}</option>
                ))}
            </select>
        </label>
    );
}

function ViewportDisplayFields({ viewport, onChange, t }) {
    const clipPreset = viewport.clipBoundary
        ? viewport.clipBoundary.points.length === 3 ? 'triangle'
            : viewport.clipBoundary.points.length === 6 ? 'hexagon' : 'custom'
        : 'rectangle';
    const visual = viewport.visualSettings || {};
    const annotation = viewport.annotationSettings || {};
    return (
        <fieldset className="drawing-layout-fieldset drawing-viewport-display-fields">
            <legend>{t('layout.viewportDisplay')}</legend>
            <ToggleField
                checked={Boolean(viewport.locked)}
                label={t('layout.viewportLockedLabel')}
                onChange={locked => onChange({ ...viewport, locked })}
            />
            <NumberField
                disabled={viewport.locked}
                label={t('layout.viewportRotation')}
                value={viewport.viewRotation || 0}
                step="1"
                onChange={rotation => onChange(setDrawingViewportRotation(viewport, rotation))}
            />
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportClip')}</span>
                <select value={clipPreset} onChange={event => onChange({
                    ...viewport,
                    clipBoundary: createDrawingViewportClipPreset(event.target.value),
                })}>
                    {DRAWING_VIEWPORT_CLIP_PRESET_OPTIONS.map(preset => (
                        <option key={preset} value={preset}>{t(`layout.viewportClip.${preset}`)}</option>
                    ))}
                    {clipPreset === 'custom' && <option value="custom">{t('layout.viewportClip.custom')}</option>}
                </select>
            </label>
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportVisualStyle')}</span>
                <select value={visual.style || 'normal'} onChange={event => onChange({
                    ...viewport,
                    visualSettings: { ...visual, style: event.target.value },
                })}>
                    {DRAWING_VIEWPORT_VISUAL_STYLE_OPTIONS.map(style => (
                        <option key={style} value={style}>{t(`layout.viewportVisualStyle.${style}`)}</option>
                    ))}
                </select>
            </label>
            <ToggleField
                checked={visual.showLineweights !== false}
                label={t('layout.viewportShowLineweights')}
                onChange={showLineweights => onChange({
                    ...viewport,
                    visualSettings: { ...visual, showLineweights },
                })}
            />
            <ToggleField
                checked={annotation.showText !== false}
                label={t('layout.viewportShowText')}
                onChange={showText => onChange({
                    ...viewport,
                    annotationSettings: { ...annotation, showText },
                })}
            />
            <ToggleField
                checked={annotation.showDimensions !== false}
                label={t('layout.viewportShowDimensions')}
                onChange={showDimensions => onChange({
                    ...viewport,
                    annotationSettings: { ...annotation, showDimensions },
                })}
            />
            <NumberField
                label={t('layout.viewportDimensionTextSize')}
                value={annotation.dimensionTextSizeMm || 3}
                min="0.5"
                max="50"
                step="0.5"
                onChange={dimensionTextSizeMm => onChange({
                    ...viewport,
                    annotationSettings: { ...annotation, dimensionTextSizeMm },
                })}
            />
        </fieldset>
    );
}

function ViewportLayerRow({ hidden, layer, onChange, onToggle, t, viewport }) {
    const override = viewport.layerOverrides?.find(item => item.layerId === layer.id) || null;
    const setOverride = patch => onChange(setDrawingViewportLayerOverride(viewport, layer.id, patch));
    return (
        <div className="drawing-viewport-layer-row">
            <label className="drawing-viewport-layer-visibility">
                <input type="checkbox" checked={!hidden} onChange={onToggle} />
                <i style={{ backgroundColor: override?.color || layer.color }} aria-hidden="true" />
                <span>{layer.name}</span>
            </label>
            <div className="drawing-viewport-layer-overrides">
                <label title={t('layout.viewportColorOverride')}>
                    <input
                        type="checkbox"
                        checked={Boolean(override?.color)}
                        aria-label={t('layout.viewportColorOverride')}
                        onChange={event => setOverride({ color: event.target.checked ? layer.color : null })}
                    />
                    <input
                        type="color"
                        value={override?.color || layer.color}
                        disabled={!override?.color}
                        aria-label={t('layout.viewportColorOverride')}
                        onChange={event => setOverride({ color: event.target.value })}
                    />
                </label>
                <select
                    value={override?.lineType || ''}
                    aria-label={t('layout.viewportLineTypeOverride')}
                    onChange={event => setOverride({ lineType: event.target.value || null })}
                >
                    <option value="">{t('sidebar.byLayer')}</option>
                    {DRAWING_LINE_TYPE_OPTIONS.map(lineType => <option key={lineType} value={lineType}>{t(`lineType.${lineType}`)}</option>)}
                </select>
                <select
                    value={override?.lineWeight || ''}
                    aria-label={t('layout.viewportLineWeightOverride')}
                    onChange={event => setOverride({ lineWeight: event.target.value ? Number(event.target.value) : null })}
                >
                    <option value="">{t('sidebar.byLayer')}</option>
                    {DRAWING_LINE_WEIGHT_OPTIONS.map(lineWeight => <option key={lineWeight} value={lineWeight}>{lineWeight}</option>)}
                </select>
                <button
                    type="button"
                    disabled={!override}
                    aria-label={t('layout.clearViewportLayerOverrides')}
                    title={t('layout.clearViewportLayerOverrides')}
                    onClick={() => onChange(clearDrawingViewportLayerOverride(viewport, layer.id))}
                >
                    ×
                </button>
            </div>
        </div>
    );
}

function ToggleField({ checked, label, onChange }) {
    return (
        <label className="drawing-layout-toggle-field">
            <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
            <span>{label}</span>
        </label>
    );
}

function roundInput(value) {
    return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}
