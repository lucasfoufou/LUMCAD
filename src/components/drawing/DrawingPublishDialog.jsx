import useDialogFocus from '~hooks/useDialogFocus';
import { Button, Input, Select } from '~components/ui/Controls';
import { DRAWING_DEVICE_PROFILES, applyDrawingDeviceProfile, normalizeDrawingPlotStamp } from '~utils/drawingPlot';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import DrawingLayoutPage from '~components/drawing/DrawingLayoutPage';
import DrawingPublishRenderer from '~components/drawing/DrawingPublishRenderer';
import { useI18n } from '~i18n/I18nProvider';
import { getDrawingPaperSize } from '~utils/drawingLayouts';
import {
    DRAWING_PLOT_AREA_MODES,
    DRAWING_PLOT_COLOR_MODES,
    DRAWING_PLOT_QUALITY_MODES,
    DRAWING_PLOT_SCALE_MODES,
    normalizeDrawingPlotSettings,
} from '~utils/drawingPlot';
import { getDrawingRasterSize } from '~utils/drawingPublish';

export default function DrawingPublishDialog({
    drawing,
    initialFormat = 'pdf',
    initialLayoutIds = [],
    onApplySettings = null,
    onClose,
    onPublish,
    onSystemPrint,
    open,
    pageSetups = [],
}) {
    const { t } = useI18n();
    const [selectedIds, setSelectedIds] = useState([]);
    const [previewId, setPreviewId] = useState(null);
    const [settings, setSettings] = useState(() => normalizeDrawingPlotSettings());
    const [marginsById, setMarginsById] = useState({});
    const [format, setFormat] = useState('pdf');
    const [rememberSettings, setRememberSettings] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const dialogRef = useDialogFocus(open, onClose, busy);
    const initializedRef = useRef(false);
    const rendererRef = useRef(null);

    useEffect(() => {
        if (!open) {
            initializedRef.current = false;
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        const requested = new Set(initialLayoutIds);
        const ids = drawing.layouts
            .filter(layout => !requested.size || requested.has(layout.id))
            .map(layout => layout.id);
        const fallbackIds = ids.length ? ids : drawing.layouts.map(layout => layout.id);
        const first = drawing.layouts.find(layout => layout.id === fallbackIds[0]) || drawing.layouts[0];
        setSelectedIds(fallbackIds);
        setPreviewId(first?.id || null);
        setSettings(normalizeDrawingPlotSettings(first?.plotSettings));
        setMarginsById(Object.fromEntries(drawing.layouts.map(layout => [layout.id, { ...layout.margins }])));
        setFormat(initialFormat === 'dwfx' ? 'dwfx' : 'pdf');
        setRememberSettings(true);
        setBusy(false);
        setError('');
    }, [drawing, initialFormat, initialLayoutIds, open]);



    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const layouts = useMemo(() => drawing.layouts
        .filter(layout => selectedSet.has(layout.id))
        .map(layout => ({ ...layout, margins: marginsById[layout.id] || layout.margins })),
    [drawing.layouts, marginsById, selectedSet]);
    const previewLayout = layouts.find(layout => layout.id === previewId) || layouts[0] || null;
    const rasterSize = useMemo(() => previewLayout
        ? getDrawingRasterSize(previewLayout, settings.quality.rasterDpi)
        : null, [previewLayout, settings.quality.rasterDpi]);

    if (!open) return null;

    const updateNestedSettings = (key, patch) => setSettings(current => normalizeDrawingPlotSettings({
        ...current,
        [key]: { ...current[key], ...patch },
    }));
    const toggleLayout = layoutId => {
        setSelectedIds(current => {
            const next = new Set(current);
            if (next.has(layoutId)) {
                if (next.size === 1) return current;
                next.delete(layoutId);
            } else {
                next.add(layoutId);
            }
            const ordered = drawing.layouts.filter(layout => next.has(layout.id)).map(layout => layout.id);
            if (!next.has(previewId)) setPreviewId(ordered[0] || null);
            return ordered;
        });
    };
    const applyPageSetup = pageSetupId => {
        const pageSetup = pageSetups.find(item => item.id === pageSetupId);
        if (!pageSetup) return;
        setSettings(normalizeDrawingPlotSettings(pageSetup.plotSettings));
        setMarginsById(current => ({
            ...current,
            ...Object.fromEntries(selectedIds.map(layoutId => [layoutId, { ...pageSetup.margins }])),
        }));
    };
    const updateMargin = (layoutId, side, value) => setMarginsById(current => ({
        ...current,
        [layoutId]: { ...current[layoutId], [side]: Math.max(0, Number(value) || 0) },
    }));
    const renderedPages = () => rendererRef.current?.getPages() || [];
    const run = async action => {
        if (!layouts.length || busy) return;
        setBusy(true);
        setError('');
        try {
            await waitForCommittedPublishPages();
            const result = await action(renderedPages(), layouts, settings);
            if (result === false) throw new Error(t('publish.failed'));
            if (rememberSettings) onApplySettings?.(selectedIds, settings, marginsById);
        } catch (publishError) {
            setError(publishError instanceof Error ? publishError.message : t('publish.failed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="drawing-publish-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) onClose();
        }}>
            <section ref={dialogRef} className="drawing-publish-dialog" role="dialog" aria-modal="true" aria-labelledby="drawing-publish-title">
                <header className="drawing-publish-header">
                    <div>
                        <span>{t('publish.kicker')}</span>
                        <h1 id="drawing-publish-title">{t('publish.title')}</h1>
                    </div>
                    <Button type="button" onClick={onClose} disabled={busy} aria-label={t('publish.close')}>×</Button>
                </header>
                <div className="drawing-publish-body">
                    <aside className="drawing-publish-sheets" aria-label={t('publish.sheets')}>
                        <strong>{t('publish.sheets')}</strong>
                        {drawing.layouts.map(layout => (
                            <label key={layout.id} className={previewLayout?.id === layout.id ? 'is-previewed' : ''}>
                                <Input
                                    type="checkbox"
                                    checked={selectedSet.has(layout.id)}
                                    onChange={() => toggleLayout(layout.id)}
                                />
                                <Button type="button" onClick={() => {
                                    if (!selectedSet.has(layout.id)) toggleLayout(layout.id);
                                    setPreviewId(layout.id);
                                }}>
                                    <span>{layout.name}</span>
                                    <small>{paperLabel(layout)}</small>
                                </Button>
                            </label>
                        ))}
                    </aside>
                    <div className="drawing-publish-preview">
                        {previewLayout ? (
                            <div className="drawing-publish-preview-sheet" style={{
                                aspectRatio: `${getDrawingPaperSize(previewLayout).width} / ${getDrawingPaperSize(previewLayout).height}`,
                            }}>
                                <DrawingLayoutPage
                                    assets={drawing.assets}
                                    content={drawing.content}
                                    layout={previewLayout}
                                    plotSettings={settings}
                                    role="img"
                                    aria-label={t('publish.previewLabel', { name: previewLayout.name })}
                                />
                            </div>
                        ) : <p>{t('publish.noSheets')}</p>}
                    </div>
                    <aside className="drawing-publish-settings" aria-label={t('publish.settings')}>
                        <PublishSelect label={t('publish.outputFormat')} value={format} onChange={setFormat}>
                            <option value="pdf">PDF</option>
                            <option value="dwfx">DWFx</option>
                        </PublishSelect>
                        <PublishSelect label={t('publish.pageSetup')} value="" onChange={applyPageSetup}>
                            <option value="">{t('publish.pageSetupCurrent')}</option>
                            {pageSetups.map(pageSetup => <option key={pageSetup.id} value={pageSetup.id}>{pageSetup.name}</option>)}
                        </PublishSelect>
                        <fieldset>
                            <legend>{t('publish.area')}</legend>
                            <PublishSelect label={t('publish.areaMode')} value={settings.area.mode} onChange={mode => updateNestedSettings('area', { mode })}>
                                {DRAWING_PLOT_AREA_MODES.map(mode => <option key={mode} value={mode}>{t(`publish.area.${mode}`)}</option>)}
                            </PublishSelect>
                            {settings.area.mode === 'window' && (
                                <div className="drawing-publish-number-grid">
                                    {['x', 'y', 'width', 'height'].map(field => <PublishNumber
                                        key={field}
                                        label={t(`publish.window.${field}`)}
                                        min={field === 'width' || field === 'height' ? 0.001 : undefined}
                                        value={settings.area.window[field]}
                                        onChange={value => updateNestedSettings('area', {
                                            window: { ...settings.area.window, [field]: value },
                                        })}
                                    />)}
                                </div>
                            )}
                            {settings.area.mode === 'layout' && (
                                <p className="drawing-publish-help">{t('publish.layoutScaleHelp')}</p>
                            )}
                        </fieldset>
                        {settings.area.mode !== 'layout' && (
                            <fieldset>
                                <legend>{t('publish.scale')}</legend>
                                <PublishSelect label={t('publish.scaleMode')} value={settings.scale.mode} onChange={mode => updateNestedSettings('scale', { mode })}>
                                    {DRAWING_PLOT_SCALE_MODES.map(mode => <option key={mode} value={mode}>{t(`publish.scale.${mode}`)}</option>)}
                                </PublishSelect>
                                {settings.scale.mode === 'fixed' && <PublishNumber
                                    label={t('publish.denominator')}
                                    min={1}
                                    value={settings.scale.denominator}
                                    onChange={denominator => updateNestedSettings('scale', { denominator })}
                                />}
                                <p className="drawing-publish-help">{t(settings.scale.mode === 'fixed'
                                    ? 'publish.fixedScaleHelp'
                                    : 'publish.fitScaleHelp')}</p>
                                <PublishToggle
                                    checked={settings.scale.centered}
                                    label={t('publish.centered')}
                                    onChange={centered => updateNestedSettings('scale', { centered })}
                                />
                                {!settings.scale.centered && (
                                    <div className="drawing-publish-number-grid">
                                        {['x', 'y'].map(field => <PublishNumber
                                            key={field}
                                            label={t(`publish.offset.${field}`)}
                                            value={settings.scale.offsetMm[field]}
                                            onChange={value => updateNestedSettings('scale', {
                                                offsetMm: { ...settings.scale.offsetMm, [field]: value },
                                            })}
                                        />)}
                                    </div>
                                )}
                            </fieldset>
                        )}
                        {previewLayout && (
                            <fieldset>
                                <legend>{t('publish.margins')}</legend>
                                <div className="drawing-publish-number-grid">
                                    {['top', 'right', 'bottom', 'left'].map(side => <PublishNumber
                                        key={side}
                                        label={t(`layout.margin.${side}`)}
                                        min={0}
                                        value={marginsById[previewLayout.id]?.[side] || 0}
                                        onChange={value => updateMargin(previewLayout.id, side, value)}
                                    />)}
                                </div>
                            </fieldset>
                        )}
                        <fieldset>
                            <legend>{t('publish.style')}</legend>
                            <PublishSelect label={t('plotStyle.deviceProfile')} value={settings.deviceProfile || 'pdfVector'} onChange={profile => setSettings(current => applyDrawingDeviceProfile(current, profile))}>
                                {DRAWING_DEVICE_PROFILES.map(profile => <option key={profile} value={profile}>{t(`plotStyle.profile.${profile}`)}</option>)}
                            </PublishSelect>
                            <PublishSelect label={t('publish.colorMode')} value={settings.style.colorMode} onChange={colorMode => updateNestedSettings('style', { colorMode })}>
                                {DRAWING_PLOT_COLOR_MODES.map(mode => <option key={mode} value={mode}>{t(`publish.color.${mode}`)}</option>)}
                            </PublishSelect>
                            <PublishToggle
                                checked={settings.style.plotLineweights}
                                label={t('publish.lineweights')}
                                onChange={plotLineweights => updateNestedSettings('style', { plotLineweights })}
                            />
                        </fieldset>
                        <fieldset>
                            <legend>{t('plotStyle.stamp')}</legend>
                            <PublishToggle checked={settings.stamp?.enabled === true} label={t('plotStyle.stampEnabled')}
                                onChange={enabled => updateNestedSettings('stamp', { ...normalizeDrawingPlotStamp(settings.stamp), enabled })} />
                            <label className="drawing-sidebar-field"><span>{t('plotStyle.stampText')}</span>
                                <Input value={normalizeDrawingPlotStamp(settings.stamp).text} maxLength={512} onChange={event => updateNestedSettings('stamp', { ...normalizeDrawingPlotStamp(settings.stamp), text: event.target.value })} />
                            </label>
                            <PublishNumber label={t('plotStyle.stampSize')} min={1} max={10} value={normalizeDrawingPlotStamp(settings.stamp).sizeMm}
                                onChange={sizeMm => updateNestedSettings('stamp', { ...normalizeDrawingPlotStamp(settings.stamp), sizeMm })} />
                        </fieldset>
                        <fieldset>
                            <legend>{t('publish.quality')}</legend>
                            <PublishSelect label={t('publish.qualityMode')} value={settings.quality.mode} onChange={mode => updateNestedSettings('quality', { mode })}>
                                {DRAWING_PLOT_QUALITY_MODES.map(mode => <option key={mode} value={mode}>{t(`publish.quality.${mode}`)}</option>)}
                            </PublishSelect>
                            {(settings.quality.mode === 'raster' || format === 'dwfx') && <PublishNumber
                                label={t('publish.rasterDpi')}
                                min={72}
                                max={1200}
                                step={1}
                                value={settings.quality.rasterDpi}
                                onChange={rasterDpi => updateNestedSettings('quality', { rasterDpi })}
                            />}
                            {(settings.quality.mode === 'raster' || format === 'dwfx') && rasterSize && (
                                <p className="drawing-publish-help">{t('publish.rasterDpiHelp', {
                                    dpi: Math.round(rasterSize.dpi),
                                    height: rasterSize.height,
                                    width: rasterSize.width,
                                })}</p>
                            )}
                            <PublishNumber
                                label={t('publish.imageDpi')}
                                min={72}
                                max={1200}
                                step={1}
                                value={settings.quality.imageDpi}
                                onChange={imageDpi => updateNestedSettings('quality', { imageDpi })}
                            />
                            <p className="drawing-publish-help">{t('publish.imageDpiHelp')}</p>
                        </fieldset>
                        <PublishToggle checked={rememberSettings} label={t('publish.remember')} onChange={setRememberSettings} />
                    </aside>
                </div>
                <footer className="drawing-publish-footer">
                    <span role="status" className={error ? 'is-error' : ''}>{error || (busy ? t('publish.preparing') : '')}</span>
                    <div>
                        <Button type="button" disabled={busy} onClick={onClose}>{t('publish.cancel')}</Button>
                        <Button type="button" disabled={busy || !layouts.length} onClick={() => run((pages, selectedLayouts, plotSettings) => onSystemPrint({
                            pages, layouts: selectedLayouts, plotSettings,
                        }))}>{t('publish.systemPrint')}</Button>
                        <Button type="button" className="is-primary" disabled={busy || !layouts.length} onClick={() => run((pages, selectedLayouts, plotSettings) => onPublish({
                            format, pages, layouts: selectedLayouts, plotSettings,
                        }))}>{t(format === 'pdf' ? 'publish.exportPdf' : 'publish.exportDwfx')}</Button>
                    </div>
                </footer>
                <DrawingPublishRenderer
                    ref={rendererRef}
                    drawing={drawing}
                    layouts={layouts}
                    plotSettings={settings}
                />
            </section>
        </div>
    );
}

function PublishSelect({ children, label, onChange, value }) {
    return (
        <label className="drawing-publish-field">
            <span>{label}</span>
            <Select value={value} onChange={event => onChange(event.target.value)}>{children}</Select>
        </label>
    );
}

function PublishNumber({ label, max, min, onChange, step = 'any', value }) {
    const formattedValue = String(roundInput(value));
    const [draft, setDraft] = useState(formattedValue);
    const cancelRef = useRef(false);
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) setDraft(formattedValue);
    }, [formattedValue]);

    const finishEditing = () => {
        focusedRef.current = false;
        if (cancelRef.current) {
            cancelRef.current = false;
            setDraft(formattedValue);
            return;
        }
        const parsed = parsePublishNumber(draft);
        if (parsed === null) {
            setDraft(formattedValue);
            return;
        }
        const bounded = Math.min(
            Number.isFinite(Number(max)) ? Number(max) : Infinity,
            Math.max(Number.isFinite(Number(min)) ? Number(min) : -Infinity, parsed),
        );
        const next = roundInput(bounded);
        setDraft(String(next));
        onChange(next);
    };

    return (
        <label className="drawing-publish-field">
            <span>{label}</span>
            <Input
                aria-valuemax={max}
                aria-valuemin={min}
                aria-valuenow={parsePublishNumber(draft) ?? undefined}
                data-step={step}
                inputMode="decimal"
                onBlur={finishEditing}
                onChange={event => setDraft(event.target.value)}
                onFocus={() => {
                    cancelRef.current = false;
                    focusedRef.current = true;
                }}
                onKeyDown={event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelRef.current = true;
                        event.currentTarget.blur();
                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                        event.preventDefault();
                        const stepValue = Number.isFinite(Number(step)) ? Math.abs(Number(step)) : 1;
                        const current = parsePublishNumber(draft) ?? (Number(value) || 0);
                        setDraft(String(roundInput(current + (event.key === 'ArrowUp' ? stepValue : -stepValue))));
                    }
                }}
                role="spinbutton"
                type="text"
                value={draft}
            />
        </label>
    );
}

function PublishToggle({ checked, label, onChange }) {
    return (
        <label className="drawing-publish-toggle">
            <Input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
            <span>{label}</span>
        </label>
    );
}

function paperLabel(layout) {
    const paper = getDrawingPaperSize(layout);
    return `${layout.format} · ${paper.width} × ${paper.height} mm`;
}

function roundInput(value) {
    return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}

function parsePublishNumber(value) {
    const text = String(value ?? '').trim();
    if (!text || ['-', '+', '.', '-.', '+.'].includes(text)) return null;
    const parsed = Number(text.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

async function waitForCommittedPublishPages() {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
}
