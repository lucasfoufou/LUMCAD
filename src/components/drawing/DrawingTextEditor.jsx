import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
    DRAWING_TEXT_FONTS,
    DRAWING_TEXT_MODES,
    DRAWING_TEXT_WRAP_MODES,
    applyDrawingTextMarks,
    drawingTextRunsToText,
    getDrawingTextMarkValue,
    normalizeDrawingTextEntity,
    normalizeDrawingTextMarks,
    normalizeDrawingTextSelection,
    normalizeDrawingTextStyles,
    replaceDrawingTextRange,
    resolveDrawingTextRunStyle,
    resolveDrawingTextStyle,
    segmentDrawingText,
} from '~utils/drawingText';

const BOOLEAN_MARKS = Object.freeze(['bold', 'italic', 'underline', 'strikethrough']);
const RICH_MARKS = Object.freeze([...BOOLEAN_MARKS, 'color', 'fontFamily', 'fontSize']);
const ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
const EMPTY_EDITOR_SENTINEL = '\u200b';

export function DrawingTextEditor({
    entity,
    textStyles = [],
    labels = {},
    autoFocus = true,
    initialSelection = null,
    commitOnBlur = true,
    disabled = false,
    fallbackColor = '#000000',
    toolbarPlacement = 'above',
    className = '',
    style = undefined,
    contentStyle = undefined,
    onChange,
    onCommit,
    onCancel,
}) {
    const normalizationOptions = Array.isArray(textStyles) && textStyles.length ? { styles: textStyles } : undefined;
    const normalizedStyles = useMemo(() => normalizeDrawingTextStyles(textStyles), [textStyles]);
    const initialDraft = useMemo(
        () => normalizeDrawingTextEntity(entity, normalizationOptions),
        // A new editing session is keyed by the entity id. Live draft changes arrive through onChange.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [entity?.id],
    );
    const [draft, setDraft] = useState(initialDraft);
    const [selection, setSelection] = useState(() => initialEditorSelection(initialDraft.text, initialSelection));
    const [typingMarks, setTypingMarks] = useState({});
    const [editorFocused, setEditorFocused] = useState(false);
    const editorRef = useRef(null);
    const draftRef = useRef(initialDraft);
    const selectionRef = useRef(selection);
    const composingRef = useRef(false);
    const toolbarInteractionRef = useRef(false);

    useEffect(() => {
        draftRef.current = initialDraft;
        setDraft(initialDraft);
        const nextSelection = initialEditorSelection(initialDraft.text, initialSelection);
        selectionRef.current = nextSelection;
        setSelection(nextSelection);
        setTypingMarks({});
    }, [entity?.id, initialDraft]);

    useLayoutEffect(() => {
        if (!autoFocus || disabled || !editorRef.current) return;
        editorRef.current.focus({ preventScroll: true });
        restoreEditorSelection(editorRef.current, selectionRef.current);
    }, [autoFocus, disabled, entity?.id]);

    useLayoutEffect(() => {
        if (document.activeElement === editorRef.current) {
            restoreEditorSelection(editorRef.current, selectionRef.current);
        }
    }, [draft.text, draft.runs, editorFocused]);

    const baseStyle = resolveDrawingTextStyle(draft, normalizedStyles);
    const publishDraft = useCallback((candidate, nextSelection = selectionRef.current) => {
        const normalized = normalizeDrawingTextEntity(candidate, normalizationOptions);
        const safeSelection = normalizeDrawingTextSelection(nextSelection, normalized.text);
        draftRef.current = normalized;
        selectionRef.current = safeSelection;
        setDraft(normalized);
        setSelection(safeSelection);
        onChange?.(normalized);
        return normalized;
    }, [normalizationOptions, onChange]);

    const captureSelection = useCallback((resetTypingMarks = false) => {
        const nextSelection = readEditorSelection(editorRef.current, draftRef.current.text);
        if (!nextSelection) return selectionRef.current;
        selectionRef.current = nextSelection;
        setSelection(nextSelection);
        if (resetTypingMarks) setTypingMarks({});
        return nextSelection;
    }, []);

    const formattingSelection = useCallback(() => {
        const editor = editorRef.current;
        const root = editor?.closest('.drawing-text-editor');
        const activeElement = document.activeElement;
        if (
            toolbarInteractionRef.current
            || (activeElement && activeElement !== editor && root?.contains(activeElement))
        ) {
            return selectionRef.current;
        }
        return captureSelection(false);
    }, [captureSelection]);

    const restoreEditingContext = useCallback(() => {
        window.requestAnimationFrame(() => {
            const editor = editorRef.current;
            if (editor && !disabled) {
                editor.focus({ preventScroll: true });
                restoreEditorSelection(editor, selectionRef.current);
            }
            toolbarInteractionRef.current = false;
        });
    }, [disabled]);

    const handleToolbarPointerDown = useCallback(event => {
        captureSelection(false);
        toolbarInteractionRef.current = Boolean(event.target.closest?.('select, input'));
    }, [captureSelection]);

    const handleToolbarControlBlur = useCallback(() => {
        window.requestAnimationFrame(() => {
            const root = editorRef.current?.closest('.drawing-text-editor');
            if (root?.contains(document.activeElement)) toolbarInteractionRef.current = false;
        });
    }, []);

    const insertionMarks = useCallback(range => {
        if (!Object.keys(typingMarks).length) return null;
        const inherited = {};
        RICH_MARKS.forEach(mark => {
            const value = getDrawingTextMarkValue(draftRef.current.runs, range, mark);
            if (value !== undefined && value !== 'mixed') inherited[mark] = value;
        });
        return normalizeDrawingTextMarks({ ...inherited, ...typingMarks });
    }, [typingMarks]);

    const replaceSelection = useCallback((value, requestedSelection = null) => {
        const current = draftRef.current;
        const range = requestedSelection
            || readEditorSelection(editorRef.current, current.text)
            || selectionRef.current;
        const replacement = current.textMode === 'singleLine'
            ? String(value ?? '').replace(/\r\n?|\n/g, ' ')
            : String(value ?? '');
        const runs = replaceDrawingTextRange(current.runs, range, replacement, insertionMarks(range));
        const caret = range.start + replacement.length;
        publishDraft({ ...current, text: drawingTextRunsToText(runs), runs }, { start: caret, end: caret });
    }, [insertionMarks, publishDraft]);

    const deleteSelection = useCallback(direction => {
        const current = draftRef.current;
        let range = readEditorSelection(editorRef.current, current.text) || selectionRef.current;
        if (range.start === range.end) range = adjacentGraphemeRange(current.text, range.start, direction);
        if (range.start !== range.end) replaceSelection('', range);
    }, [replaceSelection]);

    const updateEntity = useCallback(patch => {
        const current = draftRef.current;
        publishDraft({ ...current, ...patch }, selectionRef.current);
    }, [publishDraft]);

    const applyMark = useCallback((mark, value, requestedSelection = null) => {
        const current = draftRef.current;
        const range = requestedSelection || formattingSelection();
        if (range.start === range.end) {
            setTypingMarks(previous => updateTypingMarks(previous, mark, value));
            return;
        }
        const runs = applyDrawingTextMarks(current.runs, range, { [mark]: value });
        publishDraft({ ...current, text: drawingTextRunsToText(runs), runs }, range);
    }, [formattingSelection, publishDraft]);

    const applyColor = useCallback(event => {
        applyMark('color', event.currentTarget.value);
    }, [applyMark]);

    const finishColorChange = useCallback(event => {
        applyMark('color', event.currentTarget.value);
        restoreEditingContext();
    }, [applyMark, restoreEditingContext]);

    const toggleMark = useCallback(mark => {
        const current = draftRef.current;
        const range = formattingSelection();
        const fallback = mark === 'bold'
            ? baseStyle.fontWeight >= 700
            : mark === 'italic' ? baseStyle.fontStyle === 'italic' : Boolean(baseStyle[mark]);
        const active = Object.hasOwn(typingMarks, mark)
            ? typingMarks[mark]
            : getDrawingTextMarkValue(current.runs, range, mark, fallback);
        applyMark(mark, active === true ? false : true, range);
    }, [applyMark, baseStyle, formattingSelection, typingMarks]);

    const commit = useCallback(() => {
        const normalized = normalizeDrawingTextEntity(draftRef.current, normalizationOptions);
        draftRef.current = normalized;
        onCommit?.(normalized);
    }, [normalizationOptions, onCommit]);

    const cancel = useCallback(() => onCancel?.(), [onCancel]);

    const syncBrowserText = useCallback(() => {
        const current = draftRef.current;
        const editor = editorRef.current;
        if (!editor) return;
        let nextText = readEditableText(editor);
        if (current.textMode === 'singleLine') nextText = nextText.replace(/\n/g, ' ');
        if (nextText === current.text) return;
        const difference = findDrawingTextDifference(current.text, nextText);
        replaceSelection(difference.value, difference.selection);
    }, [replaceSelection]);

    const handleBeforeInput = useCallback(event => {
        const nativeEvent = event.nativeEvent;
        if (nativeEvent.isComposing || composingRef.current) return;
        if (nativeEvent.inputType === 'insertText' && nativeEvent.data !== null) {
            event.preventDefault();
            replaceSelection(nativeEvent.data);
        } else if (['insertParagraph', 'insertLineBreak'].includes(nativeEvent.inputType)) {
            event.preventDefault();
            if (draftRef.current.textMode === 'singleLine') commit();
            else replaceSelection('\n');
        } else if (nativeEvent.inputType === 'deleteContentBackward') {
            event.preventDefault();
            deleteSelection('backward');
        } else if (nativeEvent.inputType === 'deleteContentForward') {
            event.preventDefault();
            deleteSelection('forward');
        }
    }, [commit, deleteSelection, replaceSelection]);

    const handleKeyDown = useCallback(event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (draftRef.current.textMode === 'singleLine' || event.metaKey || event.ctrlKey) commit();
            else replaceSelection('\n');
            return;
        }
        if (event.key === 'Backspace') {
            event.preventDefault();
            deleteSelection('backward');
            return;
        }
        if (event.key === 'Delete') {
            event.preventDefault();
            deleteSelection('forward');
            return;
        }
        if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
        const shortcut = event.key.toLowerCase();
        const mark = { b: 'bold', i: 'italic', u: 'underline' }[shortcut];
        if (!mark) return;
        event.preventDefault();
        toggleMark(mark);
    }, [cancel, commit, deleteSelection, replaceSelection, toggleMark]);

    const handlePaste = useCallback(event => {
        event.preventDefault();
        replaceSelection(event.clipboardData.getData('text/plain'));
    }, [replaceSelection]);

    const handleCut = useCallback(event => {
        const current = draftRef.current;
        const range = captureSelection(false);
        if (range.start === range.end) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', current.text.slice(range.start, range.end));
        replaceSelection('', range);
    }, [captureSelection, replaceSelection]);

    const handleBlur = useCallback(event => {
        if (!commitOnBlur || event.currentTarget.contains(event.relatedTarget)) return;
        const root = event.currentTarget;
        window.requestAnimationFrame(() => {
            if (root.contains(document.activeElement)) return;
            if (toolbarInteractionRef.current) {
                restoreEditingContext();
                return;
            }
            commit();
        });
    }, [commit, commitOnBlur, restoreEditingContext]);

    if (!entity) return null;

    const currentMark = (mark, fallback) => {
        if (selection.start === selection.end && Object.hasOwn(typingMarks, mark)) return typingMarks[mark];
        return getDrawingTextMarkValue(draft.runs, selection, mark, fallback);
    };
    const currentFont = currentMark('fontFamily', baseStyle.fontFamily);
    const currentFontSize = currentMark('fontSize', baseStyle.fontSize);
    const currentColor = currentMark('color', fallbackColor);
    const rootClassName = [
        'drawing-text-editor',
        toolbarPlacement === 'below' && 'is-toolbar-below',
        disabled && 'is-disabled',
        className,
    ].filter(Boolean).join(' ');
    const editableStyle = {
        fontFamily: baseStyle.cssFontFamily,
        fontWeight: baseStyle.fontWeight,
        fontStyle: baseStyle.fontStyle,
        lineHeight: baseStyle.lineHeight,
        textDecoration: [
            baseStyle.underline && 'underline',
            baseStyle.strikethrough && 'line-through',
        ].filter(Boolean).join(' ') || 'none',
        textAlign: draft.horizontalAlign,
        whiteSpace: draft.textMode === 'singleLine' || draft.wrapMode === 'none' ? 'pre' : 'pre-wrap',
        overflowWrap: ['word', 'character'].includes(draft.wrapMode) ? 'anywhere' : 'normal',
        ...contentStyle,
    };

    return (
        <div
            className={rootClassName}
            style={style}
            aria-label={labels.editor}
            onBlur={handleBlur}
            onPointerDown={event => event.stopPropagation()}
            onDoubleClick={event => event.stopPropagation()}
        >
            <div
                className="drawing-text-editor__toolbar"
                role="toolbar"
                aria-label={labels.toolbar}
                onPointerDownCapture={handleToolbarPointerDown}
                onPointerDown={event => event.stopPropagation()}
            >
                <label className="drawing-text-editor__field">
                    <span>{labels.textStyle}</span>
                    <select
                        aria-label={labels.textStyle}
                        value={draft.textStyleId}
                        disabled={disabled}
                        onBlur={handleToolbarControlBlur}
                        onChange={event => {
                            updateEntity({
                                textStyleId: event.target.value,
                                fontFamily: undefined,
                                fontSize: undefined,
                                fontWeight: undefined,
                                fontStyle: undefined,
                                lineHeight: undefined,
                                underline: undefined,
                                strikethrough: undefined,
                            });
                            restoreEditingContext();
                        }}
                    >
                        {normalizedStyles.map(textStyle => (
                            <option key={textStyle.id} value={textStyle.id}>
                                {labels.textStyles?.[textStyle.id] || textStyle.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="drawing-text-editor__field">
                    <span>{labels.font}</span>
                    <select
                        aria-label={labels.font}
                        value={currentFont === 'mixed' ? '' : currentFont}
                        disabled={disabled}
                        onBlur={handleToolbarControlBlur}
                        onChange={event => {
                            applyMark('fontFamily', event.target.value);
                            restoreEditingContext();
                        }}
                    >
                        {currentFont === 'mixed' && <option value="" disabled>{labels.mixed}</option>}
                        {DRAWING_TEXT_FONTS.map(font => (
                            <option key={font.id} value={font.id}>{labels.fonts?.[font.id] || font.id}</option>
                        ))}
                    </select>
                </label>
                <label className="drawing-text-editor__field is-compact">
                    <span>{labels.fontSize}</span>
                    <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        aria-label={labels.fontSize}
                        value={currentFontSize === 'mixed' ? '' : currentFontSize}
                        placeholder={currentFontSize === 'mixed' ? labels.mixed : undefined}
                        disabled={disabled}
                        onBlur={handleToolbarControlBlur}
                        onChange={event => {
                            const value = Number(event.target.value);
                            if (Number.isFinite(value) && value >= 0.01) {
                                applyMark('fontSize', value);
                            }
                        }}
                    />
                </label>
                <div className="drawing-text-editor__format-group">
                    <TextFormatButton
                        label={labels.bold}
                        pressed={currentMark('bold', baseStyle.fontWeight >= 700)}
                        disabled={disabled}
                        onPress={() => toggleMark('bold')}
                    ><strong aria-hidden="true">B</strong></TextFormatButton>
                    <TextFormatButton
                        label={labels.italic}
                        pressed={currentMark('italic', baseStyle.fontStyle === 'italic')}
                        disabled={disabled}
                        onPress={() => toggleMark('italic')}
                    ><em aria-hidden="true">I</em></TextFormatButton>
                    <TextFormatButton
                        label={labels.underline}
                        pressed={currentMark('underline', baseStyle.underline)}
                        disabled={disabled}
                        onPress={() => toggleMark('underline')}
                    ><u aria-hidden="true">U</u></TextFormatButton>
                    <TextFormatButton
                        label={labels.strikethrough}
                        pressed={currentMark('strikethrough', baseStyle.strikethrough)}
                        disabled={disabled}
                        onPress={() => toggleMark('strikethrough')}
                    ><s aria-hidden="true">S</s></TextFormatButton>
                    <label className="drawing-text-editor__color">
                        <span>{labels.color}</span>
                        <input
                            type="color"
                            aria-label={labels.color}
                            value={currentColor === 'mixed' ? '#000000' : currentColor}
                            disabled={disabled}
                            onBlur={handleToolbarControlBlur}
                            onInput={applyColor}
                            onChange={finishColorChange}
                        />
                    </label>
                </div>
                <label className="drawing-text-editor__field">
                    <span>{labels.textMode}</span>
                    <select
                        aria-label={labels.textMode}
                        value={draft.textMode}
                        disabled={disabled}
                        onBlur={handleToolbarControlBlur}
                        onChange={event => {
                            const textMode = event.target.value;
                            const runs = textMode === 'singleLine'
                                ? draftRef.current.runs.map(run => ({ ...run, text: run.text.replace(/\n/g, ' ') }))
                                : draftRef.current.runs;
                            publishDraft({
                                ...draftRef.current,
                                text: drawingTextRunsToText(runs),
                                runs,
                                textMode,
                                wrapMode: textMode === 'singleLine' ? 'none' : 'word',
                            }, selectionRef.current);
                            restoreEditingContext();
                        }}
                    >
                        {DRAWING_TEXT_MODES.map(mode => (
                            <option key={mode} value={mode}>{labels.textModes?.[mode] || mode}</option>
                        ))}
                    </select>
                </label>
                <label className="drawing-text-editor__field">
                    <span>{labels.wrapMode}</span>
                    <select
                        aria-label={labels.wrapMode}
                        value={draft.wrapMode}
                        disabled={disabled || draft.textMode === 'singleLine'}
                        onBlur={handleToolbarControlBlur}
                        onChange={event => {
                            updateEntity({ wrapMode: event.target.value });
                            restoreEditingContext();
                        }}
                    >
                        {DRAWING_TEXT_WRAP_MODES.map(mode => (
                            <option key={mode} value={mode}>{labels.wrapModes?.[mode] || mode}</option>
                        ))}
                    </select>
                </label>
                <label className="drawing-text-editor__field">
                    <span>{labels.alignment}</span>
                    <select
                        aria-label={labels.alignment}
                        value={draft.horizontalAlign}
                        disabled={disabled}
                        onBlur={handleToolbarControlBlur}
                        onChange={event => {
                            updateEntity({ horizontalAlign: event.target.value });
                            restoreEditingContext();
                        }}
                    >
                        {ALIGNMENTS.map(alignment => (
                            <option key={alignment} value={alignment}>
                                {labels.alignments?.[alignment] || alignment}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="drawing-text-editor__actions">
                    <button
                        type="button"
                        className="drawing-text-editor__done"
                        disabled={disabled}
                        aria-label={labels.commit}
                        title={labels.commit}
                        onClick={commit}
                    >
                        <span aria-hidden="true">✓</span>
                    </button>
                </div>
            </div>
            <div
                ref={editorRef}
                className="drawing-text-editor__content"
                role="textbox"
                aria-label={labels.content}
                aria-multiline={draft.textMode === 'multiline'}
                contentEditable={!disabled}
                suppressContentEditableWarning
                spellCheck={false}
                style={editableStyle}
                onBeforeInput={handleBeforeInput}
                onInput={() => {
                    if (!composingRef.current) syncBrowserText();
                }}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => {
                    composingRef.current = false;
                    syncBrowserText();
                }}
                onKeyDown={handleKeyDown}
                onKeyUp={event => captureSelection(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))}
                onPointerUp={() => captureSelection(true)}
                onSelect={() => captureSelection(false)}
                onFocus={() => setEditorFocused(true)}
                onBlur={() => {
                    captureSelection(false);
                    setEditorFocused(false);
                }}
                onPaste={handlePaste}
                onCut={handleCut}
                onDrop={event => {
                    event.preventDefault();
                    replaceSelection(event.dataTransfer.getData('text/plain'));
                }}
            >
                <DrawingTextRuns
                    draft={draft}
                    baseStyle={baseStyle}
                    fallbackColor={fallbackColor}
                    selection={selection}
                    showSelection={!editorFocused}
                />
            </div>
        </div>
    );
}

function TextFormatButton({ children, disabled, label, onPress, pressed }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={pressed === true}
            data-mixed={pressed === 'mixed' || undefined}
            disabled={disabled}
            onPointerDown={event => event.preventDefault()}
            onClick={onPress}
        >
            {children}
        </button>
    );
}

function DrawingTextRuns({ draft, baseStyle, fallbackColor, selection, showSelection }) {
    if (!draft.text) {
        return (
            <span key="run-0-0" data-drawing-text-run="true" data-drawing-text-empty="true">
                {EMPTY_EDITOR_SENTINEL}
            </span>
        );
    }
    let textOffset = 0;
    return draft.runs.flatMap((run, index) => {
        const runStyle = resolveDrawingTextRunStyle(baseStyle, run.marks, fallbackColor);
        const style = {
            color: runStyle.color || undefined,
            fontFamily: runStyle.cssFontFamily,
            fontSize: `${runStyle.fontSize / baseStyle.fontSize}em`,
            fontWeight: runStyle.fontWeight,
            fontStyle: runStyle.fontStyle,
            textDecoration: runStyle.textDecoration,
        };
        const runStart = textOffset;
        const runEnd = runStart + run.text.length;
        textOffset = runEnd;
        const selectedStart = showSelection ? Math.max(runStart, selection?.start ?? 0) : runEnd;
        const selectedEnd = showSelection ? Math.min(runEnd, selection?.end ?? 0) : runStart;
        const boundaries = selectedStart < selectedEnd
            ? [runStart, selectedStart, selectedEnd, runEnd]
            : [runStart, runEnd];
        return boundaries.slice(0, -1).flatMap((start, partIndex) => {
            const end = boundaries[partIndex + 1];
            if (end <= start) return [];
            const sourceText = run.text.slice(start - runStart, end - runStart);
            const text = draft.textMode === 'singleLine' ? sourceText.replace(/\n/g, ' ') : sourceText;
            const selected = showSelection && start >= selectedStart && end <= selectedEnd;
            return [(
                <span
                    key={`run-${index}-${partIndex}`}
                    className={selected ? 'drawing-text-editor__selection' : undefined}
                    data-drawing-text-run="true"
                    data-drawing-text-selected={selected || undefined}
                    style={style}
                >
                    {text}
                </span>
            )];
        });
    });
}

function initialEditorSelection(text, requestedSelection) {
    if (requestedSelection) return normalizeDrawingTextSelection(requestedSelection, text);
    return { start: text.length, end: text.length };
}

function updateTypingMarks(previous, mark, value) {
    const next = { ...previous };
    if (value === null || value === undefined) delete next[mark];
    else next[mark] = value;
    return next;
}

function adjacentGraphemeRange(text, offset, direction) {
    const segments = segmentDrawingText(text);
    const boundaries = [0];
    segments.forEach(segment => boundaries.push(boundaries.at(-1) + segment.length));
    if (direction === 'backward') {
        const start = [...boundaries].reverse().find(boundary => boundary < offset) ?? offset;
        return { start, end: offset };
    }
    const end = boundaries.find(boundary => boundary > offset) ?? offset;
    return { start: offset, end };
}

function findDrawingTextDifference(previous, next) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
    let previousEnd = previous.length;
    let nextEnd = next.length;
    while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
        previousEnd -= 1;
        nextEnd -= 1;
    }
    const selection = normalizeDrawingTextSelection({ start, end: previousEnd }, previous);
    const trailingLength = previous.length - selection.end;
    return {
        selection,
        value: next.slice(selection.start, Math.max(selection.start, next.length - trailingLength)),
    };
}

function readEditorSelection(root, text) {
    if (!root || typeof window === 'undefined') return null;
    const browserSelection = window.getSelection();
    if (!browserSelection?.rangeCount || !root.contains(browserSelection.anchorNode) || !root.contains(browserSelection.focusNode)) {
        return null;
    }
    const anchor = editorDomPointOffset(root, browserSelection.anchorNode, browserSelection.anchorOffset);
    const focus = editorDomPointOffset(root, browserSelection.focusNode, browserSelection.focusOffset);
    return normalizeDrawingTextSelection({ start: Math.min(anchor, focus), end: Math.max(anchor, focus) }, text);
}

function editorDomPointOffset(root, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
        range.setEnd(node, offset);
    } catch {
        return 0;
    }
    return readEditableText(range.cloneContents()).length;
}

function restoreEditorSelection(root, selection) {
    if (!root || typeof window === 'undefined') return;
    const browserSelection = window.getSelection();
    if (!browserSelection) return;
    const start = editorDomPointAtOffset(root, selection.start);
    const end = editorDomPointAtOffset(root, selection.end);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    browserSelection.removeAllRanges();
    browserSelection.addRange(range);
}

function editorDomPointAtOffset(root, requestedOffset) {
    let remaining = Math.max(0, requestedOffset);
    const locate = parent => {
        for (let index = 0; index < parent.childNodes.length; index += 1) {
            const node = parent.childNodes[index];
            if (node.nodeType === Node.TEXT_NODE) {
                const value = node.nodeValue || '';
                const emptySentinel = node.parentElement?.hasAttribute('data-drawing-text-empty');
                const length = emptySentinel ? value.replaceAll(EMPTY_EDITOR_SENTINEL, '').length : value.length;
                if (remaining <= length) return {
                    node,
                    offset: emptySentinel ? editorSentinelDomOffset(value, remaining) : remaining,
                };
                remaining -= length;
            } else if (node.nodeName === 'BR') {
                const length = node.hasAttribute('data-drawing-text-empty') ? 0 : 1;
                if (remaining === 0) return { node: parent, offset: index };
                if (remaining <= length) return { node: parent, offset: index + 1 };
                remaining -= length;
            } else {
                const found = locate(node);
                if (found) return found;
            }
        }
        return null;
    };
    return locate(root) || { node: root, offset: root.childNodes.length };
}

function readEditableText(root) {
    let text = '';
    root.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            const value = node.nodeValue || '';
            text += node.parentElement?.hasAttribute('data-drawing-text-empty')
                ? value.replaceAll(EMPTY_EDITOR_SENTINEL, '')
                : value;
        }
        else if (node.nodeName === 'BR') {
            if (!node.hasAttribute('data-drawing-text-empty')) text += '\n';
        } else text += readEditableText(node);
    });
    return text;
}

function editorSentinelDomOffset(value, requestedOffset) {
    let logicalOffset = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (logicalOffset >= requestedOffset) return index;
        if (value[index] !== EMPTY_EDITOR_SENTINEL) logicalOffset += 1;
    }
    return value.length;
}
