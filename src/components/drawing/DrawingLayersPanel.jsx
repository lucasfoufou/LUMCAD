import { Button, Input, Select } from '~components/ui/Controls';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import Icon from '~components/ui/Icon';
import { DrawingLayerAppearanceFields } from '~components/drawing/DrawingAppearanceFields';
import { filterDrawingLayers } from '~utils/drawingLayers';
import { addLayer, isProtectedDrawingLayer, removeEmptyLayer, updateLayer } from '~utils/drawingDocument';

// Layers tab: a fixed header (title, count, add, filter) above compact rows.
// Each state toggle shows the current state; a restricted state (hidden,
// locked, frozen, not plotted) is drawn in the warning colour.
const STATUS_DURATION_MS = 8000;

export default function DrawingLayersPanel({ content, onCommit, filter, onFilter, onMergeLayer, t }) {
    const [createdLayerId, setCreatedLayerId] = useState(null);
    const [status, setStatus] = useState('');
    const entityCounts = useMemo(() => content.entities.reduce((counts, entity) => {
        counts[entity.layerId] = (counts[entity.layerId] || 0) + 1;
        return counts;
    }, {}), [content.entities]);
    const layers = filterDrawingLayers(content.layers, filter);
    useEffect(() => {
        if (!status) return undefined;
        const timer = window.setTimeout(() => setStatus(''), STATUS_DURATION_MS);
        return () => window.clearTimeout(timer);
    }, [status]);
    const add = () => {
        const name = t('document.newLayer', { number: content.layers.length + 1 });
        const next = addLayer(content, name);
        onCommit(next);
        // A filter could hide the new layer: clear it so the user sees it.
        if (filter) onFilter?.('');
        setCreatedLayerId(next.activeLayerId);
        setStatus(t('sidebar.layerCreated', { name }));
    };
    return (
        <section className="drawing-layer-panel">
            <div className="drawing-layer-panel-header">
                <div className="drawing-sidebar-heading">
                    <div>
                        <strong>{t('sidebar.layers')}</strong>
                        <small>{t('sidebar.layerCount', { count: content.layers.length })}</small>
                    </div>
                    <Button type="button" className="ui-button is-small" onClick={add} title={t('sidebar.addLayerHint')}>
                        <Icon name="plus" size="sm" />{t('sidebar.addLayer')}
                    </Button>
                </div>
                <Input
                    type="search"
                    aria-label={t('layerManager.filter')}
                    placeholder={t('layerManager.filterHint')}
                    title={t('layerManager.filterHelp')}
                    value={filter || ''}
                    onChange={event => onFilter?.(event.target.value)}
                />
                <p className="drawing-layer-status" role="status">{status}</p>
            </div>
            <div className="drawing-layer-list">
                {layers.map(layer => (
                    <LayerRow
                        key={layer.id}
                        layer={layer}
                        content={content}
                        count={entityCounts[layer.id] || 0}
                        onCommit={onCommit}
                        onMergeLayer={onMergeLayer}
                        editName={layer.id === createdLayerId}
                        onNameEdited={() => setCreatedLayerId(null)}
                        t={t}
                    />
                ))}
                {layers.length === 0 && <p className="drawing-sidebar-empty">{t('layerManager.noMatch', { filter })}</p>}
            </div>
        </section>
    );
}

function layerToggles(layer, t) {
    return [
        { field: 'visible', restricted: !layer.visible, icon: layer.visible ? 'eye' : 'eyeOff',
            label: t(layer.visible ? 'layerManager.hideAction' : 'layerManager.showAction'), next: !layer.visible },
        { field: 'locked', restricted: Boolean(layer.locked), icon: layer.locked ? 'lock' : 'unlock',
            label: t(layer.locked ? 'layerManager.unlockAction' : 'layerManager.lockAction'), next: !layer.locked },
        { field: 'frozen', restricted: Boolean(layer.frozen), icon: 'freeze',
            label: t(layer.frozen ? 'layerManager.thawAction' : 'layerManager.freezeAction'), next: !layer.frozen },
        { field: 'plot', restricted: layer.plot === false, icon: layer.plot === false ? 'noPlot' : 'plot',
            label: t(layer.plot === false ? 'layerManager.plotAction' : 'layerManager.noPlotAction'), next: layer.plot === false },
    ];
}

// One compact row per layer; appearance and less frequent actions expand below it.
function LayerRow({ layer, content, count, onCommit, onMergeLayer, editName, onNameEdited, t }) {
    const [expanded, setExpanded] = useState(false);
    const update = (updates, options) => onCommit(updateLayer(content, layer.id, updates), options);
    const active = content.activeLayerId === layer.id;
    const protectedLayer = isProtectedDrawingLayer(layer.id);
    return (
        <div className={['drawing-layer-row', active && 'is-active', expanded && 'is-expanded'].filter(Boolean).join(' ')}>
            <div className="drawing-layer-row-header">
                <Input
                    type="radio"
                    name="activeDrawingLayer"
                    aria-label={t('sidebar.activateLayer', { name: layer.name })}
                    title={t(active ? 'sidebar.currentLayer' : 'sidebar.activateLayer', { name: layer.name })}
                    checked={active}
                    onChange={() => onCommit({ ...content, activeLayerId: layer.id })}
                />
                <Input
                    type="color"
                    className="drawing-layer-swatch"
                    value={layer.color}
                    aria-label={t('sidebar.layerColor', { name: layer.name })}
                    title={t('sidebar.layerColor', { name: layer.name })}
                    onChange={event => update({ color: event.target.value }, { coalesceKey: `layer-color-${layer.id}` })}
                />
                <div className="drawing-layer-main">
                    {protectedLayer ? (
                        <span className="drawing-layer-system-name" title={t('sidebar.protectedLayer')}>
                            <span>{layer.name}</span>
                            <Icon name="lock" size="sm" />
                            <span className="ui-visually-hidden">{t('sidebar.protectedLayer')}</span>
                        </span>
                    ) : (
                        <LayerNameInput layer={layer} editing={editName} onEdited={onNameEdited} onRename={name => update({ name })} t={t} />
                    )}
                    <small title={t('sidebar.objectCount', { count })}>{count}</small>
                </div>
                <div className="drawing-layer-actions">
                    {layerToggles(layer, t).map(toggle => (
                        <Button type="button" key={toggle.field} className={toggle.restricted ? 'is-restricted' : ''}
                            aria-pressed={toggle.restricted} title={toggle.label} aria-label={`${toggle.label} — ${layer.name}`}
                            onClick={() => update({ [toggle.field]: toggle.next })}>
                            <Icon name={toggle.icon} size="sm" />
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
                    <label className="drawing-sidebar-check">
                        <Input type="checkbox" checked={Boolean(layer.newViewportFrozen)} onChange={event => update({ newViewportFrozen: event.target.checked })} />
                        {t('layerManager.newViewportFrozen')}
                    </label>
                    {!protectedLayer && <LayerRemoval layer={layer} content={content} count={count} onCommit={onCommit} onMergeLayer={onMergeLayer} t={t} />}
                </div>
            )}
        </div>
    );
}

// The name is edited as a draft: one undo step on Enter or when the field
// loses focus; Escape restores the previous name.
function LayerNameInput({ layer, editing, onEdited, onRename, t }) {
    const inputRef = useRef(null);
    const [draft, setDraft] = useState(layer.name);
    const cancelledRef = useRef(false);
    useEffect(() => setDraft(layer.name), [layer.name]);
    useEffect(() => {
        if (!editing) return;
        const input = inputRef.current;
        input?.scrollIntoView?.({ block: 'nearest' });
        input?.focus();
        input?.select();
        onEdited?.();
    }, [editing]);
    const commit = () => {
        if (cancelledRef.current) { cancelledRef.current = false; return; }
        const name = draft.trim();
        if (name && name !== layer.name) onRename(name);
        else setDraft(layer.name);
    };
    return (
        <Input
            ref={inputRef}
            value={draft}
            maxLength={128}
            aria-label={t('sidebar.layerName')}
            title={t('sidebar.layerNameHint')}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelledRef.current = true;
                    setDraft(layer.name);
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

// An empty layer can be deleted; a layer with objects can be merged into
// another one (LAYMRG), which moves its objects and then removes it.
function LayerRemoval({ layer, content, count, onCommit, onMergeLayer, t }) {
    const targets = content.layers.filter(candidate => candidate.id !== layer.id && !candidate.locked);
    const [targetId, setTargetId] = useState(targets[0]?.id || '');
    const target = targets.find(candidate => candidate.id === targetId) || targets[0];
    if (!count) {
        return (
            <Button type="button" className="ui-button is-small is-danger" onClick={() => onCommit(removeEmptyLayer(content, layer.id))}>
                {t('sidebar.deleteEmptyLayer')}
            </Button>
        );
    }
    return (
        <div className="drawing-layer-merge">
            <p>{t('sidebar.deleteLayerHasObjects', { count })}</p>
            {onMergeLayer && target && !layer.locked && (
                <div className="drawing-layer-merge-row">
                    <Select value={target.id} aria-label={t('sidebar.mergeLayerTarget')} onChange={event => setTargetId(event.target.value)}>
                        {targets.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </Select>
                    <Button type="button" className="ui-button is-small" title={t('sidebar.mergeLayerHint')}
                        onClick={() => onMergeLayer(layer, target)}>
                        {t('sidebar.mergeLayer')}
                    </Button>
                </div>
            )}
            {layer.locked && <p>{t('sidebar.mergeLayerLocked')}</p>}
        </div>
    );
}
