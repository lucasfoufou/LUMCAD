import { Button, Input, Select } from '~components/ui/Controls';
import React from 'react';

import DrawingPaperAnnotationPanel from '~components/drawing/DrawingPaperAnnotationPanel';
import Icon from '~components/ui/Icon';
import { useI18n } from '~i18n/I18nProvider';
import { DRAWING_LINE_TYPE_OPTIONS, DRAWING_LINE_WEIGHT_OPTIONS } from '~utils/drawingDocument';
import { parseDecimalDraft } from '~utils/drawingFormValues';
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
    createFittedDrawingViewport,
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
import {
    formatDrawingScaleLabel,
    getDrawingSheetSetupRects,
    isDrawingTitleBlockEntity,
    snapDrawingViewportToStandardScale,
} from '~utils/drawingSheetSetup';

export default function DrawingLayoutSidebar({
    content,
    currentModelViewport,
    layout,
    layoutCount,
    onChange,
    onDeleteLayout,
    onExportPageSetups,
    onCreatePageSetup,
    onDeletePageSetup,
    onImportPageSetups,
    onInsertTitleBlock = null,
    onOpenSheetSetup = null,
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
    const addFittedViewport = () => {
        const { viewport: rect } = getDrawingSheetSetupRects(layout, {
            titleBlock: (layout.paperEntities || []).some(isDrawingTitleBlockEntity),
        });
        const created = snapDrawingViewportToStandardScale(createFittedDrawingViewport(content, rect));
        onChange({ ...layout, viewports: [...layout.viewports, created] });
        onToolChange('select');
        onSelectViewport(created.id);
    };
    const hasTitleBlock = (layout.paperEntities || []).some(isDrawingTitleBlockEntity);

    return (
        <aside className="drawing-sidebar drawing-layout-sidebar">
            <div className="drawing-layout-sidebar-title">
                <strong>{t('layout.properties')}</strong>
                <small>{t('layout.viewportCount', { count: layout.viewports.length })}</small>
            </div>
            <div className="drawing-sidebar-content">
                {viewport && (
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
                )}
                <SidebarSection title={t('layout.section.sheet')} defaultOpen>
                    <label className="drawing-sidebar-field">
                        <span>{t('layout.name')}</span>
                        <Input value={layout.name} onChange={event => onChange({ ...layout, name: event.target.value })} />
                    </label>
                    <div className="drawing-field-grid">
                        <label className="drawing-sidebar-field">
                            <span>{t('layout.paperFormat')}</span>
                            <Select value={layout.format} onChange={event => onChange(changeDrawingLayoutFormat(layout, event.target.value))}>
                                {DRAWING_PAPER_FORMAT_OPTIONS.map(format => (
                                    <option key={format} value={format}>
                                        {format === DRAWING_CUSTOM_PAPER_FORMAT ? t('layout.paperFormatCustom') : format}
                                    </option>
                                ))}
                            </Select>
                        </label>
                        <label className="drawing-sidebar-field">
                            <span>{t('layout.orientation')}</span>
                            <Select value={layout.orientation} onChange={event => onChange(changeDrawingLayoutOrientation(layout, event.target.value))}>
                                {DRAWING_ORIENTATION_OPTIONS.map(orientation => (
                                    <option key={orientation} value={orientation}>{t(`layout.orientation.${orientation}`)}</option>
                                ))}
                            </Select>
                        </label>
                    </div>
                    {layout.format === DRAWING_CUSTOM_PAPER_FORMAT && (
                        <CustomPaperFields layout={layout} onChange={onChange} t={t} />
                    )}
                </SidebarSection>
                <SidebarSection title={t('layout.section.viewports')} defaultOpen>
                    {layout.viewports.length === 0 && <p className="drawing-layout-help">{t('layout.emptyViewports')}</p>}
                    <div className="drawing-layout-sidebar-actions is-stacked">
                        {layout.viewports.length === 0 && (
                            <Button type="button" className="is-primary" onClick={addFittedViewport}>{t('layout.addFittedViewport')}</Button>
                        )}
                        {onOpenSheetSetup && <Button type="button" onClick={onOpenSheetSetup}>{t('layout.openSheetSetup')}</Button>}
                        <Button type="button" onClick={() => onToolChange('viewport')}>{t('layout.addViewport')}</Button>
                    </div>
                    <StandardArrangementField
                        content={content}
                        layout={layout}
                        currentModelViewport={currentModelViewport}
                        onChange={onChange}
                        t={t}
                    />
                    {!viewport && layout.viewports.length > 0 && <p className="drawing-sidebar-empty">{t('layout.selectViewport')}</p>}
                </SidebarSection>
                <SidebarSection title={t('layout.section.titleBlock')} defaultOpen>
                    <p className="drawing-layout-help">{t('layout.titleBlockHint')}</p>
                    <div className="drawing-layout-sidebar-actions is-stacked">
                        <Button type="button" disabled={!onInsertTitleBlock} onClick={onInsertTitleBlock || undefined}>
                            {t(hasTitleBlock ? 'layout.replaceTitleBlock' : 'layout.insertTitleBlock')}
                        </Button>
                    </div>
                </SidebarSection>
                <SidebarSection title={t('layout.paperAnnotations')} defaultOpen={Boolean(selectedPaperEntityId)} key={selectedPaperEntityId ? 'paper-open' : 'paper'}>
                    <DrawingPaperAnnotationPanel
                        content={content}
                        layout={layout}
                        onChange={onChange}
                        onSelectedPaperEntityChange={onSelectedPaperEntityChange}
                        selectedPaperEntityId={selectedPaperEntityId}
                        t={t}
                    />
                </SidebarSection>
                <SidebarSection title={t('layout.paperMargins')}>
                    <PaperMarginFields layout={layout} onChange={onChange} t={t} />
                </SidebarSection>
                <SidebarSection title={t('layout.pageSetups')}>
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
                </SidebarSection>
                <div className="drawing-layout-sidebar-actions">
                    <Button
                        type="button"
                        className="is-danger"
                        disabled={layoutCount <= 1}
                        onClick={() => { if (window.confirm(t('layout.confirmDelete'))) onDeleteLayout(); }}
                    >
                        {t('layout.deleteLayout')}
                    </Button>
                </div>
            </div>
        </aside>
    );
}

function SidebarSection({ children, defaultOpen = false, title }) {
    return (
        <details className="drawing-layout-section" open={defaultOpen || undefined}>
            <summary>
                <Icon name="chevronRight" size="sm" className="drawing-layout-section-chevron" />
                <span>{title}</span>
            </summary>
            <div className="drawing-layout-section-body">{children}</div>
        </details>
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
        <section className="drawing-layout-viewport-panel" aria-label={t('layout.viewportProperties')}>
            <h3>{t('layout.viewportProperties')}</h3>
            <ViewportScaleField viewport={viewport} onChange={onChange} t={t} />
            <ToggleField
                checked={Boolean(viewport.locked)}
                label={t('layout.viewportLockedLabel')}
                onChange={locked => onChange({ ...viewport, locked })}
            />
            <div className="drawing-layout-sidebar-actions is-wrap">
                <Button type="button" disabled={viewport.locked} onClick={onFit}>{t('layout.fitModel')}</Button>
                <Button type="button" disabled={viewport.locked} onClick={onUseCurrent}>{t('layout.useCurrentView')}</Button>
                <Button type="button" disabled={viewport.locked} onClick={() => onZoom(0.8)}>{t('layout.zoomIn')}</Button>
                <Button type="button" disabled={viewport.locked} onClick={() => onZoom(1.25)}>{t('layout.zoomOut')}</Button>
            </div>
            <SidebarSection title={t('layout.viewportPosition')}>
                <div className="drawing-field-grid">
                    <NumberField label={t('layout.xMm')} value={viewport.x} precision={1} onChange={value => onChange({ ...viewport, x: value })} />
                    <NumberField label={t('layout.yMm')} value={viewport.y} precision={1} onChange={value => onChange({ ...viewport, y: value })} />
                    <NumberField label={t('layout.widthMm')} value={viewport.width} precision={1} min="8" onChange={value => onResize({ width: value })} />
                    <NumberField label={t('layout.heightMm')} value={viewport.height} precision={1} min="8" onChange={value => onResize({ height: value })} />
                    <NumberField disabled={viewport.locked} label={t('layout.modelCenterX')} value={centerX} precision={3} step="0.1" onChange={value => setModel({ x: value - viewBox.width / 2 })} />
                    <NumberField disabled={viewport.locked} label={t('layout.modelCenterY')} value={centerY} precision={3} step="0.1" onChange={value => setModel({ y: value - viewBox.height / 2 })} />
                </div>
            </SidebarSection>
            <SidebarSection title={t('layout.viewportDisplay')}>
                <ViewportDisplayFields viewport={viewport} onChange={onChange} t={t} />
            </SidebarSection>
            <SidebarSection title={t('layout.viewportLayers')} defaultOpen>
                <ViewportLayerVisibility content={content} viewport={viewport} onChange={onChange} t={t} />
            </SidebarSection>
            <p className="drawing-layout-help">{t('layout.viewportHelp')}</p>
            <div className="drawing-layout-sidebar-actions">
                <Button type="button" className="is-danger" onClick={onDelete}>{t('layout.deleteViewport')}</Button>
            </div>
        </section>
    );
}

function ViewportScaleField({ viewport, onChange, t }) {
    const scale = getDrawingViewportScale(viewport);
    const preset = DRAWING_VIEWPORT_SCALE_OPTIONS.find(value => Math.abs(value - scale) < 1e-6) || '';
    const applyScale = value => {
        const denominator = Number(value);
        if (denominator > 0 && !viewport.locked) onChange(setDrawingViewportScale(viewport, denominator));
    };
    return (
        <div className="drawing-viewport-scale-field">
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportScaleLabel')}</span>
                <Select value={preset} disabled={viewport.locked} onChange={event => applyScale(event.target.value)}>
                    {!preset && <option value="">{t('layout.viewportScaleCustom', { scale: formatDrawingScaleLabel(scale) })}</option>}
                    {DRAWING_VIEWPORT_SCALE_OPTIONS.map(value => <option key={value} value={value}>{formatDrawingScaleLabel(value)}</option>)}
                </Select>
            </label>
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportScale')}</span>
                <span className="drawing-scale-input"><b>1:</b><CommitNumberInput value={scale} disabled={viewport.locked} onCommit={applyScale} /></span>
            </label>
            {viewport.locked && <p className="drawing-layout-help is-locked">{t('layout.viewportScaleLockedHint')}</p>}
        </div>
    );
}

/** A number input applied on Enter or blur (Escape restores), never per keystroke. */
function CommitNumberInput({ value, disabled = false, onCommit, precision = 6 }) {
    const formatted = String(roundInput(value, precision));
    const [draft, setDraft] = React.useState(formatted);
    const focusedRef = React.useRef(false);
    React.useEffect(() => { if (!focusedRef.current) setDraft(formatted); }, [formatted]);
    const commit = () => {
        focusedRef.current = false;
        const parsed = parseDecimalDraft(draft);
        if (parsed.kind === 'complete' && parsed.value > 0 && String(parsed.value) !== formatted) onCommit(parsed.value);
        else setDraft(formatted);
    };
    return (
        <Input
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={draft}
            onFocus={() => { focusedRef.current = true; }}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                else if (event.key === 'Escape') { event.preventDefault(); setDraft(formatted); focusedRef.current = false; event.currentTarget.blur(); }
            }}
        />
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
        <div className="drawing-viewport-layers">
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
        </div>
    );
}

function NumberField({ label, value, onChange, disabled = false, max, min, precision = 6, step = '1' }) {
    const formatted = String(roundInput(value, precision));
    const [draft, setDraft] = React.useState(formatted);
    const focusedRef = React.useRef(false);
    React.useEffect(() => { if (!focusedRef.current) setDraft(formatted); }, [formatted]);
    const commit = () => {
        focusedRef.current = false;
        const parsed = parseDecimalDraft(draft);
        if (parsed.kind !== 'complete') { setDraft(formatted); return; }
        const bounded = Math.min(Number.isFinite(Number(max)) ? Number(max) : Infinity,
            Math.max(Number.isFinite(Number(min)) ? Number(min) : -Infinity, parsed.value));
        if (String(roundInput(bounded, precision)) !== formatted) onChange(bounded);
        else setDraft(formatted);
    };
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <Input
                type="text"
                role="spinbutton"
                inputMode="decimal"
                disabled={disabled}
                aria-valuemax={max}
                aria-valuemin={min}
                data-step={step}
                value={draft}
                onFocus={() => { focusedRef.current = true; }}
                onChange={event => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={event => {
                    if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
                    else if (event.key === 'Escape') { event.preventDefault(); setDraft(formatted); focusedRef.current = false; event.currentTarget.blur(); }
                }}
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
        <div className="drawing-layout-fieldset-body">
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
        </div>
    );
}

function PageSetupProfiles({ layout, pageSetups, onApply, onCreate, onDelete, onExport, onImport, t }) {
    return (
        <div className="drawing-layout-fieldset-body">
            <label className="drawing-sidebar-field">
                <span>{t('layout.pageSetupProfile')}</span>
                <Select value={layout.pageSetupId || ''} onChange={event => {
                    const pageSetup = pageSetups.find(item => item.id === event.target.value);
                    if (pageSetup) onApply(pageSetup);
                }}>
                    <option value="">{t('layout.pageSetupNone')}</option>
                    {pageSetups.map(pageSetup => <option key={pageSetup.id} value={pageSetup.id}>{pageSetup.name}</option>)}
                </Select>
            </label>
            <div className="drawing-layout-sidebar-actions is-wrap">
                <Button type="button" disabled={!onCreate} onClick={onCreate || undefined}>{t('layout.savePageSetup')}</Button>
                <Button type="button" disabled={!onImport} onClick={onImport || undefined}>{t('layout.importPageSetup')}</Button>
                <Button type="button" disabled={!onExport || pageSetups.length === 0} onClick={onExport || undefined}>{t('layout.exportPageSetups')}</Button>
                <Button type="button" disabled={!onDelete || !layout.pageSetupId} onClick={() => onDelete?.(layout.pageSetupId)}>{t('layout.deletePageSetup')}</Button>
            </div>
        </div>
    );
}

function StandardArrangementField({ content, currentModelViewport, layout, onChange, t }) {
    const apply = arrangement => {
        if (layout.viewports.length && !window.confirm(t('layout.confirmReplaceViewports'))) return;
        const modelViewBox = currentModelViewport
            ? modelViewBoxFromViewport(currentModelViewport, 1)
            : undefined;
        const arranged = createStandardViewportArrangement(layout, arrangement, modelViewBox, content.layers);
        onChange({ ...arranged, viewports: arranged.viewports.map(snapDrawingViewportToStandardScale) });
    };
    return (
        <label className="drawing-sidebar-field drawing-layout-arrangement-field">
            <span>{t('layout.standardArrangement')}</span>
            <Select defaultValue="" onChange={event => {
                if (event.target.value) apply(event.target.value);
                event.target.value = '';
            }}>
                <option value="">{t('layout.chooseArrangement')}</option>
                {DRAWING_VIEWPORT_ARRANGEMENT_OPTIONS.map(arrangement => (
                    <option key={arrangement} value={arrangement}>{t(`layout.arrangement.${arrangement}`)}</option>
                ))}
            </Select>
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
        <div className="drawing-viewport-display-fields">
            <NumberField
                disabled={viewport.locked}
                label={t('layout.viewportRotation')}
                value={viewport.viewRotation || 0}
                step="1"
                onChange={rotation => onChange(setDrawingViewportRotation(viewport, rotation))}
            />
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportClip')}</span>
                <Select value={clipPreset} onChange={event => onChange({
                    ...viewport,
                    clipBoundary: createDrawingViewportClipPreset(event.target.value),
                })}>
                    {DRAWING_VIEWPORT_CLIP_PRESET_OPTIONS.map(preset => (
                        <option key={preset} value={preset}>{t(`layout.viewportClip.${preset}`)}</option>
                    ))}
                    {clipPreset === 'custom' && <option value="custom">{t('layout.viewportClip.custom')}</option>}
                </Select>
            </label>
            <label className="drawing-sidebar-field">
                <span>{t('layout.viewportVisualStyle')}</span>
                <Select value={visual.style || 'normal'} onChange={event => onChange({
                    ...viewport,
                    visualSettings: { ...visual, style: event.target.value },
                })}>
                    {DRAWING_VIEWPORT_VISUAL_STYLE_OPTIONS.map(style => (
                        <option key={style} value={style}>{t(`layout.viewportVisualStyle.${style}`)}</option>
                    ))}
                </Select>
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
        </div>
    );
}

function ViewportLayerRow({ hidden, layer, onChange, onToggle, t, viewport }) {
    const override = viewport.layerOverrides?.find(item => item.layerId === layer.id) || null;
    const setOverride = patch => onChange(setDrawingViewportLayerOverride(viewport, layer.id, patch));
    return (
        <div className="drawing-viewport-layer-row">
            <label className="drawing-viewport-layer-visibility">
                <Input type="checkbox" checked={!hidden} onChange={onToggle} />
                <i style={{ backgroundColor: override?.color || layer.color }} aria-hidden="true" />
                <span>{layer.name}</span>
            </label>
            <div className="drawing-viewport-layer-overrides">
                <label title={t('layout.viewportColorOverride')}>
                    <Input
                        type="checkbox"
                        checked={Boolean(override?.color)}
                        aria-label={t('layout.viewportColorOverride')}
                        onChange={event => setOverride({ color: event.target.checked ? layer.color : null })}
                    />
                    <Input
                        type="color"
                        value={override?.color || layer.color}
                        disabled={!override?.color}
                        aria-label={t('layout.viewportColorOverride')}
                        onChange={event => setOverride({ color: event.target.value })}
                    />
                </label>
                <Select
                    value={override?.lineType || ''}
                    aria-label={t('layout.viewportLineTypeOverride')}
                    onChange={event => setOverride({ lineType: event.target.value || null })}
                >
                    <option value="">{t('sidebar.byLayer')}</option>
                    {DRAWING_LINE_TYPE_OPTIONS.map(lineType => <option key={lineType} value={lineType}>{t(`lineType.${lineType}`)}</option>)}
                </Select>
                <Select
                    value={override?.lineWeight || ''}
                    aria-label={t('layout.viewportLineWeightOverride')}
                    onChange={event => setOverride({ lineWeight: event.target.value ? Number(event.target.value) : null })}
                >
                    <option value="">{t('sidebar.byLayer')}</option>
                    {DRAWING_LINE_WEIGHT_OPTIONS.map(lineWeight => <option key={lineWeight} value={lineWeight}>{lineWeight}</option>)}
                </Select>
                <Button
                    type="button"
                    disabled={!override}
                    aria-label={t('layout.clearViewportLayerOverrides')}
                    title={t('layout.clearViewportLayerOverrides')}
                    onClick={() => onChange(clearDrawingViewportLayerOverride(viewport, layer.id))}
                >
                    ×
                </Button>
            </div>
        </div>
    );
}

function ToggleField({ checked, label, onChange }) {
    return (
        <label className="drawing-layout-toggle-field">
            <Input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
            <span>{label}</span>
        </label>
    );
}

function roundInput(value, precision = 6) {
    const factor = 10 ** precision;
    return Math.round((Number(value) || 0) * factor) / factor;
}
