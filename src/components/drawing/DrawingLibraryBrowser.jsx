import { Button, Input } from '~components/ui/Controls';
import React, { useMemo, useState } from 'react';
import { useI18n } from '~i18n/I18nProvider';
import { previewDrawingLibraryEntry } from '~utils/drawingBlockLibrary';
import DrawingContentPreview from './DrawingContentPreview';

export default function DrawingLibraryBrowser({ library, onCommand }) {
    const { t } = useI18n();
    const [search, setSearch] = useState('');
    const selected = library.entries.find(entry => entry.key === library.selectedKey);
    const preview = useMemo(() => previewDrawingLibraryEntry(library, library.selectedKey), [library]);
    const index = library.entries.indexOf(selected) + 1;
    return <section className="drawing-library-browser" aria-label={t('contentBrowser.title')}>
        <header className="drawing-sidebar-heading"><strong>{t('contentBrowser.title')}</strong>
            <Button type="button" onClick={() => onCommand('CLOSE')}>{t('contentBrowser.close')}</Button>
        </header>
        <strong>{library.document.name}</strong>
        {library.path && <p className="drawing-library-source">{library.path}</p>}
        {!!library.unresolvedReferences?.length && <p role="status">{t('contentBrowser.unresolved', { count: library.unresolvedReferences.length })}</p>}
        <Button type="button" onClick={() => onCommand('OPEN')}>{t('contentBrowser.open')}</Button>
        <label className="drawing-sidebar-field"><span>{t('contentBrowser.search')}</span>
            <Input type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <ul aria-label={t('contentBrowser.entries')}>
            {library.entries.map((entry, position) => entry.name.toLowerCase().includes(search.trim().toLowerCase()) && <li key={entry.key}>
                <Button type="button" aria-pressed={entry.key === library.selectedKey} onClick={() => onCommand(`SELECT ${position + 1}`)}>
                    {entry.name} — {t(entry.blockId ? 'contentBrowser.block' : 'contentBrowser.drawing')}
                </Button>
            </li>)}
        </ul>
        {preview && <DrawingContentPreview content={preview} assets={library.document.assets} label={t('contentBrowser.preview', { name: selected.name })} />}
        {selected && <>
            <p>{t('contentBrowser.objects', { count: selected.objects })}</p>
            <div className="drawing-block-smart-controls">
                <Button type="button" onClick={() => onCommand(`IMPORT ${index}`)}>{t('contentBrowser.import')}</Button>
                <Button type="button" onClick={() => onCommand(`INSERT ${index}`)}>{t('contentBrowser.insert')}</Button>
            </div>
        </>}
    </section>;
}
