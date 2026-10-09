# Unattended MCP runtime

LUMCAD can run without a visible window and generate the final PDF entirely through MCP. This mode shares the desktop editor, geometry, history, archive validation and PDF renderer. It does not implement a second CAD engine.

## Launch

Build a native binary with `npm run tauri build -- --debug --no-bundle`, then run:

```sh
LUMCAD_MCP_PORT=43780 ./src-tauri/target/debug/lumcad --headless
```

For an installed macOS application, invoke its exact `LUMCAD.app/Contents/MacOS/lumcad` executable with `--headless`. On Windows use `lumcad.exe --headless`. An optional `.lcad` argument opens that drawing at startup. An invalid startup file logs the error and exits with status 1. The actual MCP endpoint is printed to stderr, including fallback when the requested port is occupied. `/health` reports `headless: true`; poll `get_state` until the frontend is ready before editing. Terminate the process when the job is complete.

This is a **windowless Tauri runtime**, backed by an invisible native WebView. It still requires the platform's webview libraries and a graphical session; Linux servers need a display such as Xvfb. It is not a display-server-free Rust CLI. macOS also suppresses the Dock/menu-bar presence. The hidden webview retains its layout dimensions for exact canvas and publication geometry.

## Isolation and writes

- Starts with a blank document unless a startup path is supplied; never loads the GUI recovery draft.
- Uses default in-memory app settings. Changes made through this process do not persist into the GUI settings file. `LUMCAD_MCP_PORT` still selects the port.
- Autosave and update checks are disabled. Geometry lives in memory until an explicit save; closing the process loses unsaved work.
- File reads/writes retain the existing archive limits and atomic native writers. A save/export explicitly replaces its destination. The GUI recovery file is not removed by headless saves.
- Dialog-only commands reject; file import/export helpers require explicit paths instead of opening invisible native dialogs. Use the dedicated tools below for session files and final PDF.
- MCP remains localhost-only with the existing origin checks. No new network transport or authentication bypass is introduced.

## MCP workflow

1. `get_state` — inspect IDs, document and `headless` flag.
2. `open_document {"path":"/absolute/input.lcad"}` if needed. This explicitly discards the current session's unsaved edits. Save first when they must be retained.
3. Use `execute_command`, `interact` and `replace_document` as in [MCP.md](./MCP.md). Point coordinates remain metres in model space and millimetres in paper space. Changes use the normal history.
4. Configure layouts/viewports and paper annotations. PDF publishes **layouts**, so an empty layout with no viewport does not automatically show the model. Use `MVIEW`, then two paper-coordinate point actions, or supply layouts with `replace_document`.
5. `save_document {"path":"/absolute/output.lcad"}` when a source drawing is wanted.
6. `export_pdf {"path":"/absolute/output.pdf"}` — all layouts in document order; no preview/dialog. Optional `layoutIds` selects a nonempty, unique, explicitly ordered subset. Unknown IDs reject before writing.
7. Check the returned `path`, `pageCount`, `bytes` and `layoutIds`. Success is returned only after rendering and native atomic writing complete.

`open_document` returns the opened path and document ID; subsequent `get_state` reads the new session. Invalid opens preserve the current document. Saving during block editing is refused until the block editor closes. Relative destinations and wrong extensions are rejected.

Requests are serialized. They time out after 120 seconds. On timeout the underlying work may still be executing; the bridge refuses subsequent requests until restart, preventing an ambiguous write from racing the next command. Inspect the output before retrying a timed-out export. There is no automatic write retry.

## Verification

```sh
npm run test:mcp
npm run tauri build -- --debug --no-bundle
npm run test:headless
```

`test:headless` launches the native binary with an isolated port and temporary files, then checks drawing creation, explicit save, delete/reopen with exact geometry, two mixed-size PDF pages with extractible labels, reversed page order, invalid-path/unknown-layout refusals and preservation of an existing PDF on invalid input. It stops its own process and removes temporary files. The executable can be passed as an argument.

Verified locally on macOS Apple Silicon. Windows/Linux native execution remains to be checked on those platforms; browser E2E does not validate WebView2/WebKitGTK or native dialogs.
