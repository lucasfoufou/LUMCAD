# Frontend end-to-end tests

Run `npm run test:e2e`. Install the browser once with `npx playwright install chromium`, or set `CHROME_PATH` to an existing Chrome executable. Node follows `.nvmrc`.

The suite launches an isolated Vite server on `127.0.0.1:1429` and real Chromium contexts. It enters commands through the actual command input, sends pointer/keyboard events, handles browser file choosers and downloads, and asserts resulting document geometry and visible UI. It does not call MCP or a replacement command executor.

`VITE_LUMCAD_E2E=1` enables a read-only state probe used to observe the React editor. It is excluded from ordinary development and production builds. Each test has fresh browser storage; no personal recovery drawing or app preferences are read. Port 1429 must be free; an existing server is never reused silently.

## Coverage levels

- **Catalog entry and preconditions:** an explicit, reviewed expectation for each of the **298 canonical commands** in `src/mcp/commands.json`. Assertions cover prompt, tool, interactive stage, workspace, entity count and file-chooser activation, plus relevant panel state. Missing or obsolete catalog expectations fail the coverage check. The prompt is checked through its translation key(s) (`messageKeys`), not its wording: the rendered message must match the current English template, with `{{values}}` as wildcards. Rewording a catalog entry therefore does not break the suite; switching a command to another key does, which is the change worth reviewing. Several keys are listed only when they render identical text. Empty prompts and untranslated data output (PARAMETERS JSON) stay literal in `message`. Every listed key must exist in English and French.
- **Complete workflows:** creation and cancellation for native shapes, exact line coordinates, selection/delete/undo/redo, drafting settings, divide/measure distances, move/copy/scale/rotate, compound paths/splines/multilines/donuts/clouds/tables, associative fills, blocks/insertion/explode, grouping/visibility, LCAD download/reopen, pointer interaction in English/French, PDF download, and DXF picker/import/undo/redo/download/refusal.
- **Command workflows:** the `tools-*.spec.js` files hold one successful end-to-end workflow per command, by family (creation, modification, annotation, constraints, blocks, layers/selection/inquiry, drafting, layouts/publication, files/references). Each test builds a known fixture, drives the real front (command bar, pointer, panels, file chooser), asserts exact geometry or the bytes of every produced file (PDF pages, PNG/JPEG/SVG/WMF headers, DWFx/LCAD ZIP contents, downloaded JSON) and checks undo/redo where the command edits history. Imports and attachments read real files: a damaged archive, a PNG, a two-layer vector PDF, a V7 DGN, an SHP font, and DWFx/WMF written by LUMCAD itself (`tests/e2e/fixtures.js`).
- **Successful-workflow plan:** `tests/e2e/workflow-plan.js` accounts for **every** catalog command. `COVERED` names the test that proves a command end to end; `TODO` holds the scenario still to write, grouped by family with a `TODO(e2e)` note. `workflow-plan.spec.js` fails when a command is missing or listed twice, or when a `COVERED` reference no longer names an existing test (Playwright title, or `PASS:` line of the headless script), and registers each TODO as `test.fixme`. Current state: **all 298 commands covered**, 288 in the browser and 10 that only succeed natively (DWGIN/DWGOUT, AUTOPUBLISH, ETRANSMIT, REFEDIT/REFSAVE/REFCLOSE, IMAGEATTACH, RECOVERALL/RECOVERYMANAGER) through `test:headless`.
- **Native unattended integration:** separate `npm run test:headless`; see HEADLESS.md. This validates the Tauri MCP bridge, native files and final multipage PDF.

Neither layer is **exhaustive functional acceptance of every command option**: a workflow proves one representative success path per command. Every option combination, interchange fidelity on arbitrary customer files, OS print dialogs and the native clipboard (the browser suite uses Chromium's clipboard permission) still need specialized fixtures or native acceptance. In particular, a tested empty-selection refusal is not evidence that a full valid geometry operation has been tested. Keep these levels explicit when reporting coverage; the broad entry suite and the completed workflows are separate tests.

## Maintenance

- Add a command to the authoritative catalog, then add its reviewed expectation (with `messageKeys`) to `tests/e2e/catalog-expectations.json` and either a successful workflow using actual front controls or a `TODO` scenario in `workflow-plan.js`.
- When writing a planned workflow, replace its `test.fixme` by a real test in a feature spec and move the command from `TODO` to `COVERED`.
- Put common browser actions in `tests/e2e/helpers.js` and binary input files in `tests/e2e/fixtures.js`; tests observe through the state probe but must not modify state through it. Load a fixture with `openDrawing(page, withContent({ entities }))`, which goes through the real OPEN file chooser.
- Select with `pickEntities`/`windowSelect`, which clear the selection first: picks add to it (PICKADD), and clicking a group member selects the whole group. Pick away from endpoints, midpoints and intersections when the command needs the object rather than a snapped point, and remember the topmost object within 6 px wins.
- Assert on geometry rather than IDs for commands that legitimately replace objects (TRIM, BREAKATPOINT); keep ID assertions for commands that must preserve identity.
- For geometry changes, assert coordinates/IDs and exact undo/redo. For files, read the actual output. Avoid success claims based only on a nonempty command message.
- Failures retain a screenshot and Playwright trace in `test-results/`. Open the HTML report with `npx playwright show-report`. Generated reports are ignored by Git.
- `npm run check` remains frontend unit tests, production build and Rust tests. E2E is deliberately explicit because it needs a browser. The frontend E2E CI job installs Chromium, runs the same suite and retains failure artifacts.

Native UI acceptance and outstanding platform checks remain in [NATIVE_QA.md](./NATIVE_QA.md). Performance scenarios and their budgets remain in [PERFORMANCE.md](./PERFORMANCE.md).

## Local acceptance — 2026-10-09

On macOS Apple Silicon with Chrome 154: **338 tests passed** (294 command-entry cases, one catalog-completeness check and 43 workflow cases). Full checks passed 1,516 frontend unit tests, the production build and 93 Rust tests; dedicated MCP checks passed as well. One pre-existing opt-in native MCP test remains ignored by the normal Rust suite; the new explicit headless integration runs separately. Remote CI and native Windows/Linux acceptance were not run locally.

Reviewing command outputs exposed nine single-braced translation templates (units/UCS, style lists, quantity reports and boundary counts); these now interpolate correctly in EN/FR, with regression assertions. Publication waiting also has a timer fallback for suspended WebView animation frames, covered by a focused unit test and actual headless PDF generation.

### DXF/DWG extension — 2026-10-09

**345 browser tests passed**: 298 command-entry cases, one catalog-completeness check and 46 workflows. The added successful workflows cover DXF import/undo/redo, DXF download and unsupported-entity refusal. Full checks passed 1,532 frontend tests, the production build and 95 Rust tests, plus the dedicated MCP suite (one pre-existing opt-in Rust test remains ignored). Native macOS integration separately exercises DXF and real LibreDWG export/import/undo, including a scaled/rotated static block. This does not validate native Windows/Linux or arbitrary customer DWG files.

### Complete command workflows — 2026-10-10

**587 browser tests passed** in 4.2 min: 299 catalog entry/completeness cases, 2 plan checks, 48 earlier workflows and 238 new command workflows (`tools-*.spec.js`). `test:headless` passed its 8 native scenarios, including the new desktop-only file workflows. Full checks passed 1,548 frontend unit tests, the production build and 97 Rust tests, plus the dedicated MCP suite. Measured on macOS Apple Silicon with Chrome; Windows/Linux not run.

Writing the workflows exposed and fixed three product defects:
- in the text editor, typing a line, Enter, then a second line merged both lines and moved the line break to the end ("Line oneLine two\n"); the caret now enters the new empty line;
- raster PDF and DWFx pages were rasterized as if every sheet were A0 (`getDrawingRasterSize` received a paper size and fell back to the default format), so an A4 DWFx embedded a 64 Mpx image that DWFATTACH then refused; pages now follow the dialog's DPI;
- headless mode refused IMAGEATTACH even with an explicit path, contrary to MCP.md; only the picker form is refused now.
