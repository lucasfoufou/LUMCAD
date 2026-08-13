import React from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { fitViewBox } from '~utils/drawingGeometry';
import {
    DRAWING_ORIENTATION_OPTIONS,
    DRAWING_PAPER_FORMAT_OPTIONS,
    DRAWING_VIEWPORT_SCALE_OPTIONS,
    changeDrawingLayoutFormat,
    changeDrawingLayoutOrientation,
    getDrawingViewportScale,
    modelViewBoxFromViewport,
    removeDrawingViewport,
    resizeDrawingViewport,
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
    onSelectViewport,
    onToolChange,
    selectedViewportId,
}) {
    const { t } = useI18n();
    const viewport = layout.viewports.find(item => item.id === selectedViewportId) || null;
    const updateViewport = patch => onChange(updateDrawingViewport(layout, viewport.id, patch));
    const resizeViewport = patch => onChange(resizeDrawingViewport(layout, viewport.id, patch));
    const setModelView = modelViewBox => updateViewport({ ...viewport, modelViewBox });
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
                        {DRAWING_PAPER_FORMAT_OPTIONS.map(format => <option key={format} value={format}>{format}</option>)}
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
            <div className="drawing-layout-sidebar-actions is-wrap">
                <button type="button" onClick={onFit}>{t('layout.fitModel')}</button>
                <button type="button" onClick={onUseCurrent}>{t('layout.useCurrentView')}</button>
                <button type="button" onClick={() => onZoom(0.8)}>{t('layout.zoomIn')}</button>
                <button type="button" onClick={() => onZoom(1.25)}>{t('layout.zoomOut')}</button>
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
                <span className="drawing-scale-input"><b>1 /</b><input type="number" min="0.000001" step="1" value={roundInput(scale)} onChange={event => applyScale(event.target.value)} /></span>
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
            {content.layers.map(layer => (
                <label key={layer.id}>
                    <input type="checkbox" checked={!hidden.has(layer.id)} onChange={() => toggle(layer.id)} />
                    <i style={{ backgroundColor: layer.color }} aria-hidden="true" />
                    <span>{layer.name}</span>
                </label>
            ))}
        </fieldset>
    );
}

function NumberField({ label, value, onChange, min, step = '1' }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <input
                type="number"
                min={min}
                step={step}
                value={roundInput(value)}
                onChange={event => onChange(Number(event.target.value))}
            />
        </label>
    );
}

function roundInput(value) {
    return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}
