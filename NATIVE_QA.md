# Native acceptance — 2026-10-09

## Environment and isolation

Actual macOS 26.6.2 (25G83), Apple Silicon, French AZERTY keyboard, Tauri 2 / WKWebView. Source: current working tree. Development was launched with `npm run tauri dev`; window acceptance used a separately bundled debug application built from that same source:

```sh
npm run tauri build -- --debug --bundles app --config '{"productName":"LUMCAD QA","identifier":"io.github.lucasfoufou.lumcad.qa","bundle":{"createUpdaterArtifacts":false}}'
```

Open the exact resulting `src-tauri/target/debug/bundle/macos/LUMCAD QA.app` path. Selecting an application by the generic name LUMCAD initially resolved to an older installed application; it was observed, not edited, and is not part of this acceptance record. All subsequent modifications used the distinct QA profile and synthetic files in `/tmp`.

The automation tool sends physical key positions. On this Mac's AZERTY layout, its `super+w` produces Cmd+Z and `super+m` produces Cmd+comma. These are automation mappings, not changes to application shortcuts.

## Verified in the native window

| Workflow | Observation |
| --- | --- |
| Settings via application menu and Cmd+comma | Opens the actual modal; initial focus lands on Close. |
| Record Cmd+Shift+K | Value captured and displayed using platform labels. Explicit button focus fixes the WKWebView click behaviour. |
| Record existing Cmd+K | Conflict shown immediately; previous binding preserved. |
| Escape during recording | Cancels capture, preserves previous value and keeps Settings open. |
| Tab during recording | Leaves capture and focuses the command selector. |
| Close Settings without saving the test binding | Reopening restores the original Cmd+Shift+S binding. |
| Capture F8 → F6, save, close and reopen | F6 actually toggles orthogonal mode and updates its hint; reopening retains F6. Restoring F8 is also saved and verified. |
| English → French in Settings | Saved language updates controls and the native Drawing/Dessin menu. |
| Text creation options | Main fields stay visible; typography/alignment expand and collapse. |
| Shared select keyboard | Arrow navigation + Enter changes single-line to multiline; Escape closes the list without cancelling the active tool. |
| Minimum window, French | At 1000 × 680, text fields wrap within the options panel; header, sidebar and drafting controls remain reachable. |
| Native open dialog | Opens the synthetic S `.lcad` fixture (1,099 objects). |
| Shared static-block geometry in WKWebView | Roof/PV fixture renders; wheel zoom and pointer selection identify a block reference with the correct layer and properties. |
| Delete then keyboard Undo | Removes and restores the selected block. A subsequent native Save As file has content deeply equal to the original fixture: all 1,099 objects and properties. |
| Native Save As | Creates a separate `.lcad` in `/tmp` and reports success. |
| Publication modal | Initial focus and reverse-Tab wrapping reach Save PDF. Escape closes the modal. |
| Native PDF export | Save dialog creates a readable one-page A0 PDF (1189 × 841 mm); page count and media box independently parsed with PDF.js. |
| Native Drawing menu | Pointer-created line: menu Undo changes object count 1 → 0; menu Redo changes it 0 → 1. |

The macOS system Edit menu retains native **text** editing. It does not operate the CAD undo stack, which is why a separate Drawing/Dessin menu now exposes the shared drawing actions without taking over text-editor accelerators. Drawing-menu dispatch is suspended while a modal is open.

This is targeted acceptance of this hardening pass, not acceptance of every CAD command. Cross-platform installers, physical printing and a fresh aggregate native RAM peak are not claimed verified here.

## Platform matrix

| Target | Build/unit coverage in this session | Manual acceptance |
| --- | --- | --- |
| macOS Apple Silicon | `npm run check`, native debug `.app`, MCP suite | Workflows above passed |
| macOS Intel | Not executed locally; release workflow has an Intel target | Pending on Intel hardware |
| Windows x64 | Desktop checks workflow prepared, not dispatched | Pending; WebView2, Ctrl shortcuts, dialogs, paths and printing |
| Linux x64 | Desktop checks workflow prepared, not dispatched | Pending; WebKitGTK, clipboard, dialogs and printing |

The new `.github/workflows/desktop-checks.yml` runs frontend/Rust checks and compiles the native application on macOS, Windows and Linux for pull requests or manual dispatch. No push, PR creation or remote workflow run was requested or performed. CI compilation is not a substitute for native window acceptance.

## Repeatable acceptance on the remaining targets

1. Build from the same revision in an isolated QA profile; note OS, architecture, graphics stack, keyboard layout and window dimensions.
2. Open S, M and L fixtures through the native dialog. Check a repeated block, dynamic block, clipped block, text and dimensions before/after pan and zoom. Compare export geometry with the canvas.
3. Create, cancel, select, delete, undo and redo using pointer, keyboard and drawing actions. Verify text inputs keep native editing semantics. Repeat on EN/FR at the minimum window size.
4. Record a shortcut, reject a conflict/reserved key, cancel with Escape, leave with Tab, save/restart and restore defaults.
5. Save As, reopen, compare content, export PDF, cancel the system print dialog and then test a real printer when one is available. Include paths with spaces and accented characters.
6. Run the corrected browser and document benchmarks in PERFORMANCE.md, record sampled JS-heap peak separately from native process memory. Confirm nonempty selection and exact undo/redo restoration. Report all out-of-budget cases.
7. On macOS Intel specifically repeat menu/accelerator, clipboard and block-rendering acceptance; on Windows/Linux validate their native dialogs and platform clipboard behaviour. Do not mark an unexecuted row as passed.

## Unattended follow-up

The native executable built from the headless implementation was launched with `--headless` on this macOS host. MCP created a line with exact coordinates, saved/reopened a temporary `.lcad` with unchanged geometry, and generated two mixed-format PDF pages. PDF.js independently recovered the expected paper labels and verified reversed page ordering. Relative save paths, missing input files, nonexistent layout IDs and dialog-only Save As were refused. Unknown-layout publication preserved the existing output bytes. An invalid startup drawing exits with a diagnostic and status 1. The process used temporary destinations and was terminated after the test. See `npm run test:headless` and HEADLESS.md for the repeatable check. Windows/Linux headless acceptance remains pending.

## UX overhaul — 2026-11-13 (native acceptance pending)

The overhaul recorded in UX_AUDIT.md was verified in Chrome only (unit tests, the browser end-to-end suite, Rust tests and the headless script). None of the rows below has been executed in a native window; do not mark them as passed without running them.

| Workflow | What to check |
| --- | --- |
| File menu on Windows, Linux and macOS | Every entry works; Ctrl/Cmd+S, Ctrl/Cmd+, and F1; the macOS Drawing menu entries Save, Import, Export and Print / PDF; Cmd+, is not handled twice with the native accelerator. |
| Open a `.dwg` and a `.dxf` | A new drawing named after the file is created and imported; without LibreDWG the message offers "Open DWG settings" and that button opens the right section. |
| Browse buttons in Settings | Native folder and file pickers for the LibreDWG folder and the new-drawing template. |
| First launch language | With no `settings.json`, the interface follows the system language (WebView2 and WKWebView); an explicit choice is never overwritten. |
| Bundled LibreDWG lookup | With a `libredwg` folder in the application resources, Settings reports it as found; a folder typed in Settings still wins. |
| Canvas input | Space as Enter, right click and the context menu, Ctrl/Cmd+A, drag selection window in WebView2 and WKWebView. |
| Text editing | One click places a text and focuses the editor; clicking elsewhere commits; the same on a layout sheet. |
| Dimension placement and grips | Placement preview, text grip, hover states. |
| Manager windows | Dragging the header, Escape, the collapsed panel (`:has()` selector), restricted layer states (`color-mix()`), the colour swatch input. |
| Y axis setting | Toggle in Settings › Drawing, persistence in `settings.json`, an ordinate dimension in a published PDF. |
| Print / PDF | Page-setup step, title block, system print dialog preselecting the sheet size. |
