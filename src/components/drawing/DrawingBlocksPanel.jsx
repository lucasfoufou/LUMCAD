import { Button, Input } from '~components/ui/Controls';
import { DrawingAttributeValueInputs } from './DrawingBlockAttributeFields';
import { drawingAttributeDefinitions } from '~utils/drawingBlockAttributes';
import DrawingAttributeDefinitionForm from './DrawingAttributeDefinitionForm';
import DrawingBlockAttributeManager from './DrawingBlockAttributeManager';
import DrawingLibraryBrowser from './DrawingLibraryBrowser';
import React, { useMemo, useState } from 'react';
import DrawingContentPreview from './DrawingContentPreview';
import Icon from '~components/ui/Icon';

import { useI18n } from '~i18n/I18nProvider';
import { normalizeDrawingBlockName } from '~utils/drawingNamedBlocks';

export default function DrawingBlocksPanel({ content, selectedIds, search = '', onSearch, onDefine, onInsert, onEdit, onImport, onExport, onManageAttribute, onDefineAttribute, onSmartCommand, detection, libraryBrowser, onBrowseLibrary }) {
    const { t } = useI18n();
    const [insertionValues, setInsertionValues] = useState({});
    const [name, setName] = useState('');
    const [keepSources, setKeepSources] = useState(false);
    const namedBlocks = (content.blocks || []).filter(block => !block.name.startsWith('*'));
    const blocks = namedBlocks.filter(block => block.name.toLowerCase().includes(search.trim().toLowerCase()));
    const hasSelection = selectedIds.length > 0;
    // Blocks first, then creation from the selection; less frequent tools are folded below.
    return <section className="drawing-blocks-panel" aria-label={t('block.palette')}>
        {namedBlocks.length > 0 && <Input type="search" aria-label={t('block.search')} placeholder={t('block.search')} value={search} onChange={event => onSearch?.(event.target.value)} />}
        <ul className="drawing-block-list" aria-label={t('block.definitions')}>
            {blocks.map(block => <li key={block.id} className="drawing-block-card">
                <DrawingBlockThumbnail content={content} block={block} />
                <header>
                    <strong>{block.name}</strong>
                    <Button type="button" className="ui-button is-small is-primary" onClick={() => onInsert?.(block.id, insertionValues[block.id])} aria-label={t('block.insertNamed', { name: block.name })}>{t('commands.blockInsert')}</Button>
                </header>
                {!!drawingAttributeDefinitions(block).length && <fieldset className="drawing-block-attribute-fields">
                    <legend>{t('attribute.insertionValues')}</legend>
                    <DrawingAttributeValueInputs block={block} reference={{ id: block.id, attributeValues: insertionValues[block.id] }} t={t}
                        onChange={(tag, value) => setInsertionValues(current => ({ ...current, [block.id]: { ...current[block.id], [tag]: value } }))} />
                </fieldset>}
                <div className="drawing-block-actions">
                    <Button type="button" className="ui-button is-small" onClick={() => onEdit?.(block.id)} aria-label={t('block.editNamed', { name: block.name })}>{t('commands.blockEdit')}</Button>
                    <Button type="button" className="ui-button is-small" onClick={() => onExport?.(block.id)} aria-label={t('block.exportNamed', { name: block.name })}>{t('commands.blockExport')}</Button>
                    {onSmartCommand && <span className="drawing-disabled-hint" title={hasSelection ? undefined : t('block.replaceNeedsSelection')}>
                        <Button type="button" className="ui-button is-small" disabled={!hasSelection}
                            onClick={() => onSmartCommand('blockReplace', `"${block.id}"`)}
                            aria-label={t('smartBlock.replaceNamed', { name: block.name })}>{t('commands.blockReplace')}</Button>
                    </span>}
                </div>
                <details><summary>{t('commands.attributeManager')}</summary>
                    <DrawingBlockAttributeManager block={block} onManage={onManageAttribute} t={t} />
                </details>
            </li>)}
        </ul>
        {!namedBlocks.length && <div className="drawing-list-empty drawing-blocks-empty">
            <Icon name="blocks" />
            <strong>{t('block.emptyTitle')}</strong>
            <p>{t('block.emptyHint')}</p>
        </div>}
        {namedBlocks.length > 0 && !blocks.length && <p className="drawing-sidebar-empty">{t('block.noMatch', { search: search.trim() })}</p>}
        <section className="drawing-properties-section drawing-block-create">
            <h4>{t('block.createTitle')}</h4>
            <form onSubmit={event => {
                event.preventDefault();
                if (normalizeDrawingBlockName(name)) onDefine?.(`"${name.trim()}"${keepSources ? ' KEEP' : ''}`);
            }}>
                <label className="drawing-sidebar-field"><span>{t('block.name')}</span><Input value={name} maxLength={128} onChange={event => setName(event.target.value)} /></label>
                <label className="drawing-sidebar-check"><Input type="checkbox" checked={keepSources} onChange={event => setKeepSources(event.target.checked)} /><span>{t('block.keepSources')}</span></label>
                <Button type="submit" className="ui-button is-primary" disabled={!hasSelection || !normalizeDrawingBlockName(name)}>{t('block.createFromSelectionAction')}</Button>
                <p className="drawing-sidebar-empty" role="status">
                    {!hasSelection ? t('block.createNeedsSelection') : !normalizeDrawingBlockName(name) ? t('block.createNeedsName', { count: selectedIds.length }) : t('block.createReady', { count: selectedIds.length })}
                </p>
            </form>
        </section>
        <details className="ui-section">
            <summary>{t('block.moreOptions')}</summary>
            {onSmartCommand && <div className="drawing-block-smart-controls">
                <Button type="button" disabled={!selectedIds.length} onClick={() => onSmartCommand('blockDetect', '')}>{t('commands.blockDetect')}</Button>
                {detection && <p role="status">{t('smartBlock.detected', { count: detection.occurrences.length })}</p>}
                <Button type="button" disabled={!selectedIds.length || !normalizeDrawingBlockName(name)}
                    onClick={() => onSmartCommand('blockConvert', `"${normalizeDrawingBlockName(name)}"`)}>{t('commands.blockConvert')}</Button>
            </div>}
            <DrawingAttributeDefinitionForm onDefine={onDefineAttribute} t={t} />
        </details>
        <details className="ui-section">
            <summary>{t('block.libraries')}</summary>
            <div className="drawing-block-smart-controls">
                <Button type="button" onClick={() => onBrowseLibrary?.('')}>{t('contentBrowser.title')}</Button>
                <Button type="button" onClick={() => onImport?.()}>{t('commands.blockImport')}</Button>
                <Button type="button" onClick={() => onExport?.()} disabled={!content.blocks.some(block => !block.name.startsWith('*'))}>{t('block.exportLibrary')}</Button>
            </div>
            {libraryBrowser && <DrawingLibraryBrowser library={libraryBrowser} onCommand={onBrowseLibrary} />}
        </details>
    </section>;
}

// Above this size a block keeps its card without a thumbnail, so the panel
// stays fast on large drawings.
const THUMBNAIL_ENTITY_LIMIT = 400;

function DrawingBlockThumbnail({ content, block }) {
    const preview = useMemo(() => (
        block.entities?.length && block.entities.length <= THUMBNAIL_ENTITY_LIMIT
            ? { ...content, entities: block.entities }
            : null
    ), [block, content.layers, content.blocks, content.settings]);
    if (!preview) return null;
    return <div className="drawing-block-thumbnail" aria-hidden="true"><DrawingContentPreview content={preview} label={block.name} /></div>;
}
