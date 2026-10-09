import { useEffect, useRef } from 'react';

/** Shared single-commit import lifecycle, including file-dialog cancellation and stale-context refusal. */
export default function useDrawingVectorImport({ documentId, assets, setAssets, history, enabled, setSelectedIds, cancel, setMessage, t },
    { prefix, labelKey, parse, read, convert, errors, summarize = null }) {
    const pending = useRef(false); const mounted = useRef(true); const latest = useRef(null);
    latest.current = { documentId, assets, history, enabled };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const run = async input => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t(`${prefix}.busy`)); return; }
        pending.current = true;
        const initial = history.content;
        try {
            const options = parse(input);
            const bytes = await read(options.path, t(labelKey));
            if (!bytes || !mounted.current) return;
            const live = latest.current;
            if (!live.enabled || live.documentId !== documentId || live.history.content !== initial || live.assets !== assets) throw new Error(`${prefix}ContextChanged`);
            const result = convert({ content: initial, assets }, bytes, options);
            setAssets(result.assets); live.history.commit(result.content); cancel(); setSelectedIds(result.selectedIds);
            const warnings = result.report.warnings.map(key => t(`${prefix}.warning.${key}`)).join('; ');
            const notes = summarize?.(result.report) || [];
            setMessage([t(`${prefix}.imported`, { count: result.report.imported }), ...notes,
                ...(warnings ? [t(`${prefix}.warnings`, { warnings })] : [])].join(' '));
        } catch (error) {
            if (mounted.current && latest.current.documentId === documentId) {
                const code = typeof error === 'string' ? error : error.message;
                const key = errors.includes(code) ? code : `${prefix}Invalid`;
                // Some refusals carry language-neutral details, such as DXF type counts.
                setMessage(t(`${prefix}.error.${key}`, { detail: error?.detail ?? '' }));
            }
        } finally { pending.current = false; }
    };
    return { run, pending, mounted, latest };
}
