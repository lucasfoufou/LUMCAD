# Performance and reliability baseline

- Last measured: 2026-10-12 (linework batching)
- Scope: editor responsiveness, memory, and document size limits for large 2D drawings

This document defines how LUMCAD performance is measured, the budgets that changes must respect, and the current baseline. Re-run the benchmarks and update the baseline when a change targets performance or alters rendering, snapping, selection, history, or persistence.

## Reference drawings

`src/utils/drawingBenchmarkFixtures.js` generates deterministic synthetic roof/PV plans. Each 12.5 × 11.7 m roof section contains 157 model entities:

| Entity kind | Per section | Notes |
| --- | --- | --- |
| Roof outline + associative hatch | 1 + 1 | Hatch boundary follows the outline (`sourceIds`). |
| PV panels | 60 `blockReference` | One 4-child panel block definition. |
| Rails + fixings | 12 lines + 60 circles | |
| Cable runs | 6 polylines (12 vertices) + 6 arcs | |
| Labels | 7 single-line texts | |
| Dimensions | 3 linear dimensions | One associative to a rail. |
| Junction box | 1 `blockReference` | |

| Fixture | Model entities | Sections | JSON size |
| --- | --- | --- | --- |
| `S` | 1,099 | 7 | 0.2 MiB |
| `M` | 5,024 | 32 | 0.9 MiB |
| `L` | 20,096 | 128 | 3.7 MiB |
| `XL` | 50,083 | 319 | 9.3 MiB |

Fixtures are audit-clean and round-trip through `.lcad` (see `drawingBenchmarkFixtures.test.js`).

## Running the benchmarks

| Command | What it measures |
| --- | --- |
| `npm run bench -- [S M L XL] [--json file]` | Headless document pipeline in Node: open/save archive, document serialization, history commit, snapping (including the first query after an edit), window selection, document heap. |
| `npm run bench:browser -- [S M L XL] [--file drawing.lcad] [--json file] [--chrome path] [--scenarios a,b] [--profile file.cpuprofile] [--trace]` | Builds a benchmark-enabled production bundle, serves it, and replays real editor input in headless Chrome through the DevTools protocol. Requires a local Chrome (`CHROME_PATH` overrides the default location). `--profile` builds without minification, records one CPU profile per scenario (`file-<size>-<scenario>.cpuprofile`, fixture loading excluded) and prints the functions with the highest self time. `--trace` adds the main-thread timeline per scenario (style recalculation, layout, layerization, paint, hit testing), which a CPU profile only reports as `(program)`. JSON results include every step's duration in input order (`timings`). `--file` replays the scenarios on a real `.lcad` drawing (reported as size `FILE`). |

The interactive harness (`src/dev/benchmarkHarness.js`) is installed only in development builds or when the bundle is built with `VITE_LUMCAD_BENCH=1`; production builds exclude it. It exposes `window.__LUMCAD_BENCH__.load(size)` and `window.__LUMCAD_BENCH__.run(['S', 'M'])` in the developer console. Fixtures load into a **sandboxed session**: autosave never writes the recovery file, so a benchmark never replaces the user's recovery draft.

Scenarios, all timed from the dispatched input to the next painted frame:

| Scenario | Input | Sanity check |
| --- | --- | --- |
| `hoverSelect` | 60 pointer moves with the select tool | — |
| `hoverLineWithSnaps` | 60 pointer moves with LINE active (object snaps) | LINE active, snap markers shown |
| `wheelZoom` | 10 wheel steps in, 10 out | — |
| `pan` | Middle-button drag, 30 moves | — |
| `windowSelect` | Click, 10 moves, click (CAD selection window) | Selected entity count |
| `deleteUndoRedo` | Delete, undo, redo, undo | Entity counts before/after each step |
| `lineRubberBand` | LINE active, first point clicked, then 30 pointer moves dragging the rubber band | No segment committed |
| `lineClicks` | LINE active, 20 rapid vertex clicks, Escape, then undo of the last segment | Segments added |
| `zoomedIn` | Zoom in 16 steps, 30 pointer moves and a 20-move pan, zoom back out | DOM nodes while zoomed in |

On a 60 Hz display one frame is 16.7 ms, so a value close to 16.7 ms means the input was handled within the next frame; 33 ms means one dropped frame. Headless Chrome composites in software, so native compositing in the desktop app is cheaper than these figures.

Native memory in the Tauri shell: build with `VITE_LUMCAD_BENCH=1 VITE_LUMCAD_BENCH_AUTORUN=S,M,L npx tauri build --debug --no-bundle`, launch `src-tauri/target/debug/lumcad`, and sample the resident memory of the app and its WebKit helper processes. Rebuild `dist/` with `npm run build` afterwards.

## Budgets

Targets for the `L` fixture (20,000 entities) on a recent Apple Silicon laptop, unless stated otherwise:

| Interaction | Budget |
| --- | --- |
| Pointer move (hover, snapping, tracking) | p95 ≤ 20 ms (no dropped frame) |
| Pan and wheel zoom | p95 ≤ 20 ms |
| Window selection completion | ≤ 50 ms |
| Edit commit, undo, redo | ≤ 50 ms (`XL`: ≤ 100 ms) |
| Open drawing | ≤ 1 s (`XL`: ≤ 2 s) |
| Autosave | no main-thread task > 50 ms |
| Model DOM nodes | proportional to visible entities, not drawing size |
| Persistence | `XL` saves, autosaves and reopens |

## Baseline before Lot 1 — 2026-10-08

### Document pipeline (`npm run bench`, Node 22, Apple Silicon)

Median / p95 in milliseconds per operation:

| Operation | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Open archive | 6 / 13 | 22 / 26 | 98 / 101 | refused |
| Save archive | 8 / 9 | 33 / 35 | 137 / 145 | refused |
| Autosave signature (`JSON.stringify`) | 0.5 / 0.5 | 2.3 / 2.6 | 9.4 / 9.9 | 25 / 32 |
| Commit one moved entity | 0.6 / 0.8 | 2.7 / 3.1 | 12 / 12 | 30 / 33 |
| Snap on pointer move | 2.8 / 4.8 | 10.8 / 16.0 | 18.9 / 27.5 | 34 / 47 |
| Window selection (¼ of drawing) | 1.0 / 1.5 | 3.1 / 3.7 | 11.5 / 12.2 | 26 / 26 |

### Interactive editor (`npm run bench:browser`, headless Chrome, 1440 × 900)

Median / p95 in milliseconds from input to next frame:

| Scenario | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Load fixture | 171 | 296 | 1,294 | 4,216 |
| Hover, select tool | 16 / 27 | 69 / 93 | 278 / 448 | 819 / 1,312 |
| Hover, LINE with snaps | 17 / 29 | 71 / 93 | 281 / 553 | 801 / 1,507 |
| Wheel zoom | 31 / 37 | 147 / 161 | 684 / 1,351 | 1,927 / 3,685 |
| Pan | 30 / 37 | 148 / 196 | 615 / 934 | 1,886 / 3,907 |
| Window selection, slowest step | 33 | 156 | 779 | 3,131¹ |
| Delete / undo / redo | 25 / 33 | 123 / 159 | 533 / 653 | n/a¹ |
| DOM nodes after load | 8,140 | 36,897 | 150,631 | 377,619 |
| JS heap after scenarios | 24 MiB | 175 MiB | 1,087 MiB | 854 MiB² |

¹ The `XL` selection window selected nothing within the scenario, so delete/undo/redo had no effect. ² Heap sampled before garbage collection.

### Native shell memory (Tauri debug build, WKWebView)

Resident memory sampled every 3 s (app process + WebKit helper processes started by the app):

| State | App | WebContent | Other WebKit | Total |
| --- | --- | --- | --- | --- |
| Idle after startup (startup drawing) | 116 MiB | 345 MiB | 191 MiB | 652 MiB |
| Peak during `S → M → L` autorun | 106 MiB | 2,757 MiB | 136 MiB | 2,999 MiB |
| End of the 6-minute run | 97 MiB | 1,831 MiB | 92 MiB | 2,020 MiB |

Interaction timings inside WKWebView are not yet collected automatically; the headless Chrome figures above are the reference until a native timing export exists.

## Current — after Lot 1 (2026-10-08)

### Document pipeline

| Operation | M | L | XL |
| --- | --- | --- | --- |
| Open archive | 22 / 31 | 84 / 114 | 235 / 271 |
| Save archive | 26 / 31 | 106 / 110 | 275 / 308 |
| Snap on pointer move | 0.11 / 0.37 | 0.12 / 0.62 | 0.14 / 0.43 |
| First snap after an edit (index update) | 3.5 / 4.9 | 7.6 / 7.9 | 23 / 55 |
| Window selection (¼ of drawing) | 1.7 / 2.3 | 5.2 / 6.0 | 9.2 / 10.1 |

### Interactive editor

| Scenario | S | M | L | XL |
| --- | --- | --- | --- | --- |
| Hover, select tool | 17 / 18 | 17 / 19 | 17 / 18 | 34 / 46 |
| Hover, LINE with snaps | 17 / 18 | 17 / 20 | 17 / 36 | 33 / 59 |
| Wheel zoom (p95 = settle redraw) | 17 / 27 | 17 / 92 | 17 / 363 | 25 / 853 |
| Pan (p95 = settle redraw) | 17 / 20 | 17 / 22 | 17 / 68 | 141 / 1,591 |
| Zoomed-in hover and pan | 17 / 18 | 17 / 17 | 17 / 18 | 17 / 17 |
| DOM nodes while zoomed in | 523 | 3,092 | 5,968 | 14,834 |
| Window selection, slowest step | 39 | 119 | 501 | 2,046 |
| Delete / undo / redo | 27 / 35 | 102 / 134 | 327 / 613 | n/a |

### Native shell memory

Same `S → M → L` autorun as the baseline:

| State | App | WebContent | Other WebKit | Total |
| --- | --- | --- | --- | --- |
| Start of the run | 116 MiB | 456 MiB | 204 MiB | 776 MiB |
| Peak (all of `L` visible after loading) | 95 MiB | 2,559 MiB | 76 MiB | 2,730 MiB |
| End of the 6-minute run | 100 MiB | 1,045 MiB | 59 MiB | 1,204 MiB |

The peak is dominated by the DOM of a fully visible `L` drawing; zoomed-in work renders a fraction of it.

## Changes made in Lot 1

- `.lcad` manifests are written as compact JSON with a 64 MiB bound in JavaScript and Rust; `XL` saves (506 KiB archive) and reopens. `AUDIT` and recovery cover 2,000,000 examined objects.
- Model entities are memoized; viewport-dependent output (construction lines, culled or tessellated circles, blocks containing them) is the only geometry re-rendered on pan or zoom.
- Pan and wheel zoom move the rendered SVG with a composited CSS transform and redraw once the view settles (120 ms, at most every 300 ms during long gestures).
- Pointer feedback (snap markers, tracking guides, hover outline, array handles) is drawn in a separate overlay SVG, so hovering never repaints the drawing.
- The interactive scene renders only entities in the visible area plus a 10 % margin; dimensions, leaders, infinite lines and unknown kinds always render.
- Snapping, tracking intersections and window selection query cached uniform-grid indexes (`drawingSpatialIndex.js`); block expansion and bounds are cached per entity, and visibility is applied per query. Every block occurrence is now snappable (the former per-move expansion budget of 10,000 children is gone).
- Autosave compares immutable document identities instead of serializing the drawing on every change; the initial document is normalized once instead of on every editor render.
- Repeated `Array.includes` lookups over selections were replaced by `Set` lookups, and text layout reuses one grapheme segmenter.

## Remaining findings after Lot 1 (historical)

- Bulk edits on large drawings (delete/undo of thousands of objects, large window selections) still re-create many SVG nodes: about 330 ms at `L`.
- Each entity still renders a hit shape in addition to its visible shape; picking through the spatial index would halve the DOM.
- The settle redraw after pan or zoom is proportional to the visible entity count (about 350 ms when all of `L` is visible).
- Each history commit still runs whole-document refresh passes (constraints, hatches, path arrays, arc texts, quantity tables): about 14 ms at `L`.
- `XL` window selection and pan in a fully visible view remain above budget.

## Follow-up — 2026-10-09

The interactive canvas shares eligible static block geometry through scene-local SVG definitions and `use` instances. Dynamic, clipped, external, nested, annotated and viewport-dependent blocks keep the original rendering path. Publication/export uses the original renderer. Empty collection defaults are stable; dimension-size invalidation only affects entities which actually use it. Recursive block dependency caches are keyed by the definition catalog, so editing a nested definition invalidates them correctly.

Selections above 100 objects retain every outline and editing command but omit individual grips. Properties explains the limit. Dimension-series grip discovery is a single pass and also bounds the number of series objects displayed.

### Corrected measurement protocol

The old XL selection sometimes selected zero objects and consequently measured a no-op delete. The harness now fits the drawing, selects a substantial region, requires a nonempty result, and waits for the actual delete/undo/redo scene counts before timing completion. It fails on a no-op or a failed restoration. Scenarios wait for deferred viewport updates. Consequently the new bulk measurements must not be compared directly with the original smaller selections or first-frame-only timings.

`peakJsHeapMiB` samples Chromium's JS heap every 100 ms and at scenario boundaries. This is a **sampled JS-heap peak**, not total native RAM or an allocation limit; short peaks may be missed and collection timing varies. WKWebView/GPU/native RSS has not been remeasured comparably in this pass. The older native numbers above remain historical.

### Comparable before/after, fixture L alone

Same machine, Chrome 154, 1440 × 813, production bundles, same corrected harness. Baseline is the repository's previous committed implementation; after is this working tree. Raw results: [before](./benchmarks/hardening-2026-10-09/before-L.json), [after](./benchmarks/hardening-2026-10-09/after-L.json).

| Measure | Before | After |
| --- | ---: | ---: |
| Load all 20,096 objects | 1,695 ms | 986 ms |
| DOM nodes, overview | 150,932 | 81,824 |
| Sampled peak JS heap | 1,246 MiB | 606 MiB |
| Window selection, 19,976 objects, median / max | 273 / 773 ms | 106 / 136 ms |
| Delete / undo / redo, median / max | 206 / 1,855 ms | 111 / 972 ms |
| Wheel zoom, median / max | 17 / 325 ms | 17 / 197 ms |
| Pan, median / max | 17 / 402 ms | 17 / 181 ms |
| Zoomed-in hover/pan, median / p95 | 17 / 18 ms | 17 / 18 ms |

### Stress limits and remaining work

The complete S → M → L → XL run is stored [here](./benchmarks/hardening-2026-10-09/after-S-M-L-XL.json), and the document pipeline [here](./benchmarks/hardening-2026-10-09/document.json). XL loads 50,083 objects with 205,401 DOM nodes (the earlier unchanged overview had 377,649), selects 49,760 objects, deletes, and restores the exact scene count through undo/redo. The sampled peak is 1,484 MiB. Zoomed-in work remains around 17 ms.

XL overview interaction remains outside the comfort budget: window selection reaches 532 ms, pan 560 ms and a full bulk undo/redraw reaches 8.4 s in the sequential stress run. This pass improves the common L case substantially but does not establish a hard memory ceiling or make every 50,000-object overview interaction smooth. Full-remount costs, per-entity hit shapes and whole-document refresh passes remain the next targets. Do not present the normal zoomed-in frame time as the full-drawing redraw time.

### Headless/E2E regression check — 2026-10-09

After adding unattended file APIs and the E2E state probe, the document benchmarks completed for S/M/L/XL and the browser L scenario restored all 20,096 entities through delete/undo/redo. L retained 81,824 DOM nodes; load was 952 ms, bulk undo/redraw maximum 921 ms and window-selection maximum 140 ms. Zoomed-in p95 was 17.5 ms; overview hover p95 was 23.5 ms, still above the 20 ms budget. These verification runs overlapped other validation work, so they do not replace the isolated before/after baseline or establish a new native RAM peak.

### DXF/DWG regression check — 2026-10-09

The [document pipeline](./benchmarks/cad-interchange-2026-10-09/document.json) completed for S/M/L/XL (XL archive open p95 275 ms, save p95 300 ms). The [browser S/M run](./benchmarks/cad-interchange-2026-10-09/browser-S-M.json) restored the full scene after bulk edits: M loads in 204 ms, hover p95 18.6 ms, snapping p95 20.7 ms, pan p95 29.5 ms and wheel zoom p95 51.3 ms. M bulk edit/undo/redo peaks at 151 ms. These results still exceed several interaction budgets; they do not establish that the overview/memory work is complete. Validation ran concurrently, so this is a regression check, not an isolated before/after performance claim. It does not measure large DXF/DWG conversion latency or native converter RAM.

## Overview and bulk-edit pass — 2026-10-09

### Changes

- **Pointer picking uses the spatial index.** `pickDrawingEntity` finds the topmost rendered entity within 6 px (the former 12 px stroke hit area), including filled hatches of any pattern, text and image frames and block extents. The model scene takes no pointer events and renders no transparent hit shapes, so the browser no longer hit-tests every shape. The layout canvas keeps DOM hit shapes for its few paper annotations.
- **One element per plain entity.** Model entities render their shape without a wrapper group. Selection outlines, hover previews and grips are drawn in a decoration layer above the scene, so selecting thousands of objects never remounts their shapes. Selection outlines are now always visible above other objects.
- **Linear bulk restores.** Entities are grouped into contiguous chunks whose boundaries depend only on entity IDs (`drawingSceneChunks.js`). This avoids React 18's quadratic sibling search when thousands of shapes are re-inserted (undo of a bulk delete), while an ordinary edit still touches one chunk.
- **Lighter text markup.** Single-line text renders no unused clip path, and a line made of one run styled like its text element renders without a nested `tspan`.
- **No forced layout per pointer move.** Pointer coordinates come from a cached canvas rectangle instead of `getScreenCTM()`, which forced a synchronous layout of the whole scene on every move. The scene and symbol definitions keep their own cursor value, so cursor changes restyle one element instead of every shape.
- **Selection hover without object snap.** With the select tool and no command, hover no longer computes object snaps (as in other CAD tools, snap markers belong to drawing commands). Intersection snapping caches each entity's normalized curve paths.
- **Cached hit geometry.** Hatch boundary segments and dimension parts are cached per entity. Dimensions now have bounds in the selection index instead of being tested on every query.
- **Cheaper history commits.** The associative hatch and arc-text refresh passes skip pairs whose entity and sources are unchanged, index only what they need, and new-dimension styling stops early when no unstyled dimension exists.

- **Publication pages on demand.** AUTOPUBLISH and MCP `export_pdf` render every layout offscreen. These pages were mounted permanently and re-rendered all layouts and viewports on every edit, pan and zoom, even in model space. They are now mounted only while a PDF is produced (`useOnDemandPublishPages`). On a real 188-object drawing with 14 layouts and 21 viewports, DOM nodes fell from 16,625 to 968, a LINE vertex click from 51 ms (3 frames) to 17 ms, and pan/zoom medians from 23 to 17 ms (`npm run bench:browser -- --file drawing.lcad`).

### Measurement notes

The synthetic fixture's text labels used an invalid text mode and no frame, so each label wrapped one character per line inside a zero-width clip: about 13 invisible SVG elements per label. They now use single-line text with a frame. The before column below was re-measured on the previous commit with this corrected fixture, so both columns are comparable.

The harness dispatches synthetic pointer events on the SVG element. With DOM picking their target was always the SVG, so hover highlighting never ran during the benchmark. Coordinate picking now exercises it: changing the hovered object costs about one extra frame at XL, and `hoverSelect` p95 includes that real work.

### Before / after, same corrected fixture

Headless Chrome 154, 1440 × 813, production bundles. Raw results: [before](./benchmarks/perf-pass-2026-10-09/before-L-XL.json), [after](./benchmarks/perf-pass-2026-10-09/after-L-XL.json), [document pipeline](./benchmarks/perf-pass-2026-10-09/document.json). Values are median / p95 / max in milliseconds.

| Measure | L before | L after | XL before | XL after |
| --- | ---: | ---: | ---: | ---: |
| Load | 853 | 678 | 1,858 | 1,232 |
| DOM nodes, overview | 71,816 | 26,660 | 178,203 | 65,657 |
| Hover, select tool | 17 / 33 / 91 | 17 / 24 / 29 | 17 / 43 / 153 | 17 / 31 / 43 |
| Hover, LINE with snaps | 17 / 30 / 203 | 17 / 19 / 86 | 17 / 45 / 482 | 17 / 25 / 311 |
| Wheel zoom | 17 / 159 / 159 | 17 / 139 / 139 | 17 / 423 / 423 | 17 / 310 / 310 |
| Pan | 17 / 55 / 153 | 17 / 38 / 134 | 18 / 393 / 475 | 17 / 86 / 293 |
| Window selection | 93 / 123 / 123 | 84 / 108 / 108 | 251 / 421 / 421 | 241 / 348 / 348 |
| Delete / undo / redo | 103 / 818 / 818 | 82 / 426 / 426 | 230 / 3,999 / 3,999 | 169 / 1,006 / 1,006 |
| History commit, one entity (`npm run bench`, median) | 12.6 | 3.0 | 35.3 | 7.1 |

The sampled JS-heap peak fell from 608 to 490 MiB at L. At XL it varied between 1,063 and 1,343 MiB across runs, so no XL memory gain is claimed. In a single S → XL document run, garbage collection inflates the XL window-selection query (about 24 ms against 9 ms when XL runs alone); the query itself is unchanged.

### Remaining findings

- The frame that settles a pan or zoom still re-lays out every visible shape when the SVG viewBox changes: about 140 ms at L and 300 ms at XL in a full overview. Further gains need fewer shapes in overview (level of detail for sub-pixel text and dimensions) or a canvas renderer for the static scene.
- Bulk restore at XL still takes about 1 s, now dominated by DOM creation and style/layout of 50,000 shapes.
- XL window-selection preview re-renders thousands of decorations per pointer move.
- Native WKWebView timings and resident memory have not been re-measured; the figures above are headless Chrome.


## Editing pass — 2026-10-10

Drafting on a large plan re-derived everything that depends on the entity list after each click, and drew the rubber band inside the drawing.

### Changes

- **Incremental spatial indexes.** `createDrawingSpatialIndex` can derive an index from the previous one when only a few entities were replaced, appended or removed (identity comparison; beyond 1/64 of the items, or 64, it rebuilds). Shared cells are copied before writing, so older indexes stay valid for history snapshots. The selection, snap, tracking and render-culling indexes use it; `createDrawingIndexCache` hands the most recent value to the builder. Entities drawn through other entities re-measure only when one of the entities they read was replaced (`drawingEntitySourcesChanged`).
- **One source map per edit.** The canvas, the selection index and annotation resolution share `getDrawingDimensionSourceMap`, which is itself derived from the previous map after small edits. Annotation resolution builds it only for annotative dimensions that need a label anchor.
- **Snap entries.** Entries of the unchanged leading entities are copied from the previous snap index instead of being expanded again.
- **Chunk-level memoization.** Each scene chunk (`drawingSceneChunks.js`) is a memoized component. An edit re-renders the chunk it touches; dimensions and associative objects re-render only when an entity they read was replaced, instead of after every edit. In an overview the render cull is skipped instead of building a set of every position.
- **Previews in the pointer overlay.** Rubber bands and move/copy/insert previews (`DrawingDraftLayer`) are drawn in the overlay SVG, so moving the pointer during a command no longer repaints the drawing.

### Before / after, same harness

Headless Chrome 154, 1440 × 813, production bundles; the before column is the previous commit with this harness. Raw results: [before](./benchmarks/perf-pass-3-2026-10-10/before-L-XL.json), [after](./benchmarks/perf-pass-3-2026-10-10/after-L-XL.json). Values are median / p95 / max in milliseconds.

| Measure | L before | L after | XL before | XL after |
| --- | ---: | ---: | ---: | ---: |
| LINE rubber band, per pointer move | 49 / 68 / 118 | 17 / 17 / 23 | 119 / 145 / 347 | 17 / 23 / 43 |
| LINE vertex click | 122 / 136 / 139 | 37 / 42 / 44 | 290 / 377 / 384 | 90 / 103 / 306 |
| Window selection | 89 / 110 / 110 | 55 / 80 / 80 | 247 / 352 / 352 | 151 / 253 / 253 |
| Delete / undo / redo | 92 / 348 / 348 | 88 / 376 / 376 | 172 / 879 / 879 | 187 / 808 / 808 |
| Wheel zoom (p95 = settle) | 17 / 147 / 147 | 17 / 154 / 154 | 17 / 300 / 300 | 17 / 282 / 282 |
| Sampled peak JS heap | 799 MiB | 262 MiB | 1,758 MiB | 880 MiB |

Document pipeline, measured back to back on the same machine ([before](./benchmarks/perf-pass-3-2026-10-10/document-before.json), [after](./benchmarks/perf-pass-3-2026-10-10/document-after.json)): the first snap after an edit fell from 12.4 to 1.8 ms at L and from 28.8 to 12.2 ms at XL (median); open, save, serialization and commits are unchanged. This machine was under memory pressure during the pass, so absolute values vary between runs; compare only columns measured together.

### Remaining findings

- An XL vertex click (about 90 ms) is now mostly native: painting and layerizing the single 65,000-node scene SVG (about 40 + 20 ms per click). SVG elements cannot get their own paint layer, so this needs several scene SVGs or a canvas renderer.
- The settle after pan or zoom is native layout: every shape uses `vector-effect: non-scaling-stroke`, so a view-scale change re-lays out each visible shape (about 150 ms at L and 280 ms at XL in a full overview). Alternatives with world-unit strokes need the same per-shape update; a canvas renderer or a level of detail that omits sub-pixel shapes would change this.
- XL window-selection preview and bulk undo remain DOM-bound (thousands of outlines or shapes created at once).

## Level of detail — 2026-10-11

### Change

In the model canvas, an entity whose render bounds are smaller than one screen pixel is drawn as a dot. The dots of one scene chunk are merged into one path per colour, transparency and lineweight, with the entity's colour and a round cap of its lineweight. Picking, snapping, selection outlines and publication are unchanged; layouts and exports never use it. An E2E test checks the dot, its selection and the return to the real shape when zooming in.

On the synthetic fixtures, 38 % (L) and 43 % (XL) of the entities are below one pixel in a full overview (the rail fixings). Overview screenshots before and after differ on 0.2 % of the pixels, without visible change.

### Results

Same harness, measured back to back. Raw results: [before](./benchmarks/level-of-detail-2026-10-11/before-L-XL.json), [after](./benchmarks/level-of-detail-2026-10-11/after-L-XL.json).

| Measure | L before | L after | XL before | XL after |
| --- | ---: | ---: | ---: | ---: |
| DOM nodes, overview | 26,652 | 19,128 | 65,649 | 43,422 |
| Sampled peak JS heap | 354 MiB | 199 MiB | 960 MiB | 552 MiB |
| Load | 628 ms | 498 ms | 1,088 ms | 1,056 ms |

Interaction timings (clicks, pan, zoom settle, selection, bulk edits) did not change beyond run-to-run noise, confirmed by alternating runs. The removed circles were the cheapest shapes; the zoom-settle layout is dominated by the panel block instances (7,808 at L, each a `use` of four shapes) and text, which are 1 to 4 px wide in the overview.

### Rejected: a 4 px threshold

Drawing everything below 4 px as a dot (measured only, not kept) brought XL load from 1,062 to 373 ms, a vertex click from about 90 to 56 ms and smooth pans, but doubled the XL zoom settle (p95 334 → 710 ms): zooming in from the overview recreates tens of thousands of shapes crossing the threshold at once, and the simplified panels and text change the drawing visibly. A renderer that does not keep one element per shape (canvas) avoids both costs.

## Linework batching — 2026-10-12

### Change

The level-of-detail measurement showed that the remaining cost follows the number of SVG elements, not their size. In the model canvas, consecutive plain linework of a scene chunk is now drawn as subpaths of one `path` per colour, lineweight and line type (`drawingLineworkBatch.js`): lines, arcs, circles (with their view-dependent geometry), axis-aligned rectangles, regular polygons and polylines made of points or of line/arc parts without their own appearance, plus block references whose visible children are all such linework (transformed into drawing coordinates, including rotated references). Each subpath reproduces the entity's own element, and any other entity ends the run, so painter order with fills, text and other objects is preserved; only crossings between different colours inside one run may change which stroke is on top.

Entities keep their own element when they are transparent (overlapping strokes of one path would not darken), use a plot-style presentation layer, have widths, fills or per-part appearance, rotated rectangles drawn alone, text, hatches, dimensions, images, splines and ellipses, clipped or unloaded references and blocks with such children. Picking, snapping, selection outlines, layouts and publication are unchanged. Unit tests compare the paths with the element geometry; E2E tests check batched lines and blocks, the dashed line type, the transparent and rotated exceptions and selecting a batched block.

### Results

Same harness, alternating runs with and without batching, both with the sub-pixel dots. Raw results: [before](./benchmarks/linework-batching-2026-10-12/before-L-XL.json), [after](./benchmarks/linework-batching-2026-10-12/after-L-XL.json), [final build](./benchmarks/linework-batching-2026-10-12/final-L-XL.json). Values are median / p95 in milliseconds.

| Measure | L before | L after | XL before | XL after |
| --- | ---: | ---: | ---: | ---: |
| DOM nodes, overview | 19,128 | 10,775 | 43,422 | 24,502 |
| Load | 488 | 330 | 835 | 560 |
| Wheel zoom (p95 = settle) | 17 / 114 | 17 / 56 | 17 / 237 | 17 / 100 |
| Pan | 17 / 30 | 17 / 20 | 17 / 51 | 17 / 22 |
| LINE vertex click | 35 / 40 | 21 / 40 | 75 / 91 | 49 / 65 |
| Window selection | 52 / 79 | 42 / 63 | 148 / 258 | 113 / 224 |
| Delete / undo / redo | 74 / 336 | 51 / 83 | 147 / 816 | 96 / 170 |

The second alternating pair reproduced these values. Cached subpath strings raise the sampled JS heap peak somewhat; with the sub-pixel dots the final build peaks at about 255 MiB (L) and 450 MiB (XL), against 199 and 552 MiB before batching. Without the dots the final build loads about 10 % slower and peaks at about 280 MiB (L) and 700 MiB (XL), with the same interaction timings, so the dots are kept.

### Remaining findings

- Text, dimensions and hatches keep one element each; a zoom settle at XL still re-lays out about 24,000 elements (about 100 ms).
- XL window-selection preview still creates one outline per selected entity.
