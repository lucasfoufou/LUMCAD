import { DrawingAttributeValueInputs } from './DrawingBlockAttributeFields';
import { drawingAttributeDefinitions } from '~utils/drawingBlockAttributes';
import DrawingAttributeDefinitionForm from './DrawingAttributeDefinitionForm';
import DrawingBlockAttributeManager from './DrawingBlockAttributeManager';
import DrawingLibraryBrowser from './DrawingLibraryBrowser';
import { useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { normalizeDrawingBlockName } from '~utils/drawingNamedBlocks';

export default function DrawingBlocksPanel({ content, selectedIds, search = '', onSearch, onDefine, onInsert, onEdit, onImport, onExport, onManageAttribute, onDefineAttribute, onSmartCommand, detection, libraryBrowser, onBrowseLibrary }) {
    const { t } = useI18n();
    const [insertionValues, setInsertionValues] = useState({});
    const [name, setName] = useState('');
    const [keepSources, setKeepSources] = useState(false);
    const blocks = (content.blocks || []).filter(block => !block.name.startsWith('*')
        && block.name.toLowerCase().includes(search.trim().toLowerCase()));
    // Blocks first; authoring and library exchange are folded below.
    return <section className="drawing-blocks-panel" aria-label={t('block.palette')}>
        <input type="search" aria-label={t('block.search')} placeholder={t('block.search')} value={search} onChange={event => onSearch?.(event.target.value)} />
        <ul className="drawing-block-list" aria-label={t('block.definitions')}>
            {blocks.map(block => <li key={block.id} className="drawing-block-card">
                <header>
                    <strong>{block.name}</strong>
                    <button type="button" className="ui-button is-small is-primary" onClick={() => onInsert?.(block.id, insertionValues[block.id])} aria-label={t('block.insertNamed', { name: block.name })}>{t('commands.blockInsert')}</button>
                </header>
                {!!drawingAttributeDefinitions(block).length && <fieldset className="drawing-block-attribute-fields">
                    <legend>{t('attribute.insertionValues')}</legend>
                    <DrawingAttributeValueInputs block={block} reference={{ id: block.id, attributeValues: insertionValues[block.id] }} t={t}
                        onChange={(tag, value) => setInsertionValues(current => ({ ...current, [block.id]: { ...current[block.id], [tag]: value } }))} />
                </fieldset>}
                <div className="drawing-block-actions">
                    <button type="button" className="ui-button is-small" onClick={() => onEdit?.(block.id)} aria-label={t('block.editNamed', { name: block.name })}>{t('commands.blockEdit')}</button>
                    <button type="button" className="ui-button is-small" onClick={() => onExport?.(block.id)} aria-label={t('block.exportNamed', { name: block.name })}>{t('commands.blockExport')}</button>
                    {onSmartCommand && <button type="button" className="ui-button is-small" disabled={!selectedIds.length}
                        onClick={() => onSmartCommand('blockReplace', `"${block.id}"`)}
                        aria-label={t('smartBlock.replaceNamed', { name: block.name })}>{t('commands.blockReplace')}</button>}
                </div>
                <details><summary>{t('commands.attributeManager')}</summary>
                    <DrawingBlockAttributeManager block={block} onManage={onManageAttribute} t={t} />
                </details>
            </li>)}
        </ul>
        {!blocks.length && <p className="drawing-sidebar-empty">{t('block.empty')}</p>}
        <details className="ui-section">
            <summary>{t('block.createFromSelection')}</summary>
            <form onSubmit={event => {
                event.preventDefault();
                if (normalizeDrawingBlockName(name)) onDefine?.(`"${name.trim()}"${keepSources ? ' KEEP' : ''}`);
            }}>
                <label className="drawing-sidebar-field"><span>{t('block.name')}</span><input value={name} maxLength={128} onChange={event => setName(event.target.value)} /></label>
                <label className="drawing-sidebar-check"><input type="checkbox" checked={keepSources} onChange={event => setKeepSources(event.target.checked)} /><span>{t('block.keepSources')}</span></label>
                <button type="submit" disabled={!selectedIds.length || !normalizeDrawingBlockName(name)}>{t('block.createFromSelection')}</button>
            </form>
            {onSmartCommand && <div className="drawing-block-smart-controls">
                <button type="button" disabled={!selectedIds.length} onClick={() => onSmartCommand('blockDetect', '')}>{t('commands.blockDetect')}</button>
                {detection && <p role="status">{t('smartBlock.detected', { count: detection.occurrences.length })}</p>}
                <button type="button" disabled={!selectedIds.length || !normalizeDrawingBlockName(name)}
                    onClick={() => onSmartCommand('blockConvert', `"${normalizeDrawingBlockName(name)}"`)}>{t('commands.blockConvert')}</button>
            </div>}
            <DrawingAttributeDefinitionForm onDefine={onDefineAttribute} t={t} />
        </details>
        <details className="ui-section">
            <summary>{t('block.libraries')}</summary>
            <div className="drawing-block-smart-controls">
                <button type="button" onClick={() => onBrowseLibrary?.('')}>{t('contentBrowser.title')}</button>
                <button type="button" onClick={() => onImport?.()}>{t('commands.blockImport')}</button>
                <button type="button" onClick={() => onExport?.()} disabled={!content.blocks.some(block => !block.name.startsWith('*'))}>{t('block.exportLibrary')}</button>
            </div>
            {libraryBrowser && <DrawingLibraryBrowser library={libraryBrowser} onCommand={onBrowseLibrary} />}
        </details>
    </section>;
}
