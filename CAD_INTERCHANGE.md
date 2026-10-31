# DXF and DWG interchange

This is a **partial 2D model-space boundary**, not lossless DWG compatibility. Keep `.lcad` as the editable master. DXF works in the browser and desktop application. DWG uses an optional external GNU LibreDWG installation in the desktop application, including headless MCP.

## Commands

| Command | Arguments | Result |
| --- | --- | --- |
| `DXFIN` | `["path.dxf"] [UNIT mm\|cm\|m\|km\|in\|ft\|yd\|us-ft] [AT x y] [SCALE factor] [SKIP]` | Append editable model objects, with one undo entry |
| `DXFOUT` | `["path.dxf"]` | Export the complete model as ASCII DXF with metre units |
| `DWGIN` | Same import options, with `.dwg` path | Convert through LibreDWG, then use the same DXF importer |
| `DWGOUT` | `["path.dwg"]` | Export through LibreDWG as experimental R2000 DWG |

Use the command bar or search palette. Omitted paths open the native/browser file picker, or download the browser export. Explicit paths require the desktop application and must be absolute with the correct extension. Headless operation requires explicit paths. Import placement uses LUMCAD model coordinates in metres; DXF Y-up coordinates are reflected into the editor's coordinate system. `UNIT` overrides `$INSUNITS`; unknown/unitless drawings require this option. Export always declares metres.

MCP example (the path is `input`, not part of `command`):

```json
{"command":"DXFIN","input":"\"/absolute/roof.dxf\" UNIT mm"}
```

Use the same `execute_command` tool with `DWGOUT` and an absolute destination to export DWG. `OPEN`/`SAVEAS` and the native document dialogs still operate on `.lcad`; these interchange commands do not change the active document path. Import leaves the existing drawing in place, selects the appended objects and creates collision-safe layer/block names. Export does not change history.

## Supported subset and fidelity

- Import: LINE, POINT, CIRCLE, ARC, ELLIPSE, POLYLINE/LWPOLYLINE (including exact circular bulges and supported variable-width ribbons), nonrational cubic SPLINE, TEXT/MTEXT, visible ATTRIB and constant ATTDEF text, and static INSERT/BLOCK definitions. Large/closed cubic splines become exact Bézier spans.
- SOLID/TRACE fills, WIPEOUT boundaries and HATCH polyline/line/arc/ellipse boundaries become native editable objects. WIPEOUT uses a closed native masking polyline, including asymmetric image-coordinate boundaries. Hatch islands are retained. Complex hatch patterns become parallel lines with a warning; gaps in boundary edges are closed and reported. Spline hatch edges remain unsupported.
- DIMENSION uses its cached block graphics, keeping lines, text and arrows editable, without dimension associations. MULTILEADER retains cached text/block content, straight branches and arrow geometry; styles and associations may differ. Legacy LEADER retains vertices but omits arrowheads/associations, with a warning.
- Static block nesting, insertion position, rotation and nonuniform XY scale are retained. Layer-zero block children inherit the insertion layer. Visible instance attributes become editable text, not native attribute associations. External references remain unsupported.
- Model and block redraw order follows SORTENTSTABLE, including LibreDWG tables linked through extension dictionaries. Fills sent to the back remain behind their linework. Equal redraw handles retain source order; redraw handle zero is drawn last.
- Used source layers retain names, colour, visibility, frozen, frozen-in-new-viewports, locked and plot flags. DXF true colour has priority over indexed colour. Indexed colour 7 maps to LUMCAD's default ink. Explicit entity transparency is retained. Line patterns/weights and BYBLOCK appearance may be approximated and are reported.
- Scoped MTEXT font, colour, height, emphasis and escaped symbols are parsed. Sub-centimetre text and individual rich-text runs use a shared scaled local frame so native minimum-font normalization cannot enlarge them, including within scaled blocks. MTEXT keeps its WCS anchor and projected glyph axes; when only a rotation is supplied, its direction is derived from the OCS axes, while absent direction and rotation retain the default WCS X axis; a zero direction in a converter cache uses the rotation fallback with a formatting warning. Fit/Aligned TEXT and attributes retain their two-point baseline, with substituted font metrics. Text remains editable; font substitution, alignment and metrics may differ. Unsupported paragraph/spacing/stacked-text formatting is approximated with a warning. Invalid UTF-8 lines in modern DXF can be recovered with the explicitly declared legacy code page, without changing valid UTF-8 lines; this is reported.
- Elevation and inclined object-coordinate planes are projected onto model XY, with a warning. ELLIPSE projects both WCS axes, retaining the side and sweep of arcs with negative normals. This is a 2D projection, not 3D support. Edge-on planes, meshes, thickness, rational/noncubic splines, images, tables, unsupported/proxy entities and binary DXF remain unsupported. Layouts, constraints and application metadata are not transferred.
- Export remains narrower than import: native lines, points, circles, arcs, full ellipses, point polylines, cubic splines, basic text and static blocks. Simple left-aligned imported text with a translated/rotated/uniformly scaled frame can export with its physical baseline and height. Compound polylines, rectangles and polygons become separate curves when necessary. Partial ellipses, other affine-framed text, fills, masks, transparency and advanced annotations can refuse DXF/DWG export: keep `.lcad` as the editable master. DWG R2000 colours are approximated by the indexed palette.

## Paper space and unsupported objects

- **Paper space is always ignored.** Import targets model space: layout objects (viewports, title blocks, `*Paper_Space` definitions) are left out and counted in the result message.
- **By default, an unsupported model object refuses the whole import.** The message lists the blocking objects by DXF type and count (for example `IMAGE ×2, 3DSOLID ×3`), and nothing changes in the drawing.
- **`SKIP` imports everything else.** Supported objects are imported in one undo step; the message lists what was left out with the same type counts. Left-out objects never create layers. Inside a block definition, only the unsupported children are left out. INSERTs of external references (xrefs) are left out, as INSERT.
- Only block definitions reachable from model INSERTs, cached dimensions or multileaders are imported. Unsupported objects in unused definitions cannot block the model import. Explicitly invisible objects and variable attribute definitions are omitted and counted; geometry on hidden layers is retained so those layers can be shown later.
- Malformed or binary DXF files, limits, cyclic blocks and invalid geometry (zero radius, non-finite values) still refuse the import, with or without `SKIP`.

The importer validates before committing. A refusal leaves drawing content/history untouched. File-dialog cancellation is a no-op. A drawing changed while the import dialog, read or worker conversion was pending must be retried. Native exports use temporary files and atomic replacement only after successful conversion; failed conversion preserves an existing destination.

## LibreDWG setup

Install `dwgread` and `dwgwrite` from [GNU LibreDWG](https://www.gnu.org/software/libredwg/). On macOS, `brew install libredwg` is enough. LUMCAD looks for the first folder containing **both** executables, in this order:

1. `LUMCAD_LIBREDWG_DIR`, when set before launching LUMCAD;
2. the folder entered in **Settings › DWG and DXF** (desktop application). When a folder is entered, it is the only one searched: a wrong folder reports LibreDWG as missing rather than silently using another installation;
3. otherwise, the application's `PATH`;
4. then standard install folders: `/opt/homebrew/bin`, `/usr/local/bin` and `/opt/local/bin` on macOS; `/usr/local/bin`, `/usr/bin` and `~/.local/bin` on Linux; `%ProgramFiles%\LibreDWG[\bin]` and `%LOCALAPPDATA%\Programs\LibreDWG[\bin]` on Windows.

Applications started from Finder or a desktop menu do not inherit the shell `PATH`, which is why standard folders and the Settings field exist. Headless runs use default settings, so they rely on the variable, `PATH` or standard folders:

```sh
LUMCAD_LIBREDWG_DIR=/absolute/libredwg/bin ./src-tauri/target/debug/lumcad --headless
```

Windows PowerShell:

```powershell
$env:LUMCAD_LIBREDWG_DIR = 'C:\Tools\LibreDWG\bin'
.\lumcad.exe --headless
```

The Windows directory must contain `dwgread.exe`, `dwgwrite.exe` and their required runtime dependencies. No converter download, installation or bundling is performed by LUMCAD. LibreDWG is not included with LUMCAD: the Settings section states this, shows whether it was found and where, and gives install instructions per platform when it is missing. Missing executables produce a localized diagnostic pointing to that section. Settings only check that the files exist; nothing is executed until a DWG command runs.

The adapter launches executables directly, without a shell, inside an isolated temporary directory. It uses `dwgread -O DXF` for import and `dwgwrite --as=r2000` for export. LibreDWG conversion remains experimental and does not guarantee compatibility with arbitrary real-world DWG files or AutoCAD. The intermediate DXF must still satisfy the supported subset above. GUI converter configuration, packaged converters and broader version/fidelity acceptance are follow-up work.

## Limits and verification

DXF is read by the in-repository reader `src/utils/drawingDxfReader.js` in one pass: no third-party DXF parser is used, and every graphical record is either converted or explicitly refused. DXF writing uses the maintained `@tarikjabiri/dxf` writer.

DWG files are limited to 64 MiB; DXF input/output and intermediate conversion files to 128 MiB. The streaming DXF reader limits group lines to 16,000,000 and graphical records to 500,000. Conversion limits stored entities (including block children) to 500,000, expanded instances to 2,000,000 (500,000 per definition), imported layers to 4,096, combined block definitions to 4,096, and nesting to 16 levels. Polylines are limited to 4,096 vertices. Cycles and unsupported transforms reject. Converter processes stop after 90 seconds or when output exceeds its file limit. Parsing/geometry conversion runs in a dedicated worker with a 90-second timeout, terminated on completion or error; the final history commit still occurs on the UI thread. These are bounded file/geometry/time limits, not an OS memory sandbox. `.lcad` manifests allow 128 MiB on both native and browser paths; older builds may refuse these larger drawings.

Unit tests cover physical units, coordinate orientation, true colour, indexed default ink and ByLayer export, arc sweeps, bulges, POLYLINE/VERTEX sequences, MTEXT chunks, XDATA/application groups/embedded objects, block geometry/inheritance, cubic splines, unsupported input reported inside blocks, malformed containers and numbers, and text record injection. Rust tests cover converter lookup. Browser E2E covers real DXF file selection, undo/redo, actual export download and atomic unsupported-entity refusal. Native `npm run test:headless` verifies DXF export/import/undo. Set `LUMCAD_LIBREDWG_DIR` when running that script to also exercise real DWG conversion, or `LUMCAD_TEST_DWG=1` to let the application find LibreDWG itself.

The native round trip was verified on macOS Apple Silicon with LibreDWG 0.14 compiled from the official release. A mixed primitive/spline/block DWG round trip was also checked; original and returned DXF files were independently parsed/audited with ezdxf 1.4.4. The R2000 intermediate avoids a LibreDWG 0.14 name-conversion defect encountered with R2007 DXF input. Neither external tool is a JavaScript runtime dependency. Native Windows/Linux and independent AutoCAD acceptance remain unverified. Real customer corpus checks are described below.


## Real DWG corpus — 2026-10-30

Six private drawings (DWG AC1024, AC1027 and AC1032, 0.4–15 MB) exercise the importer with LibreDWG 0.14. Converted DXFs reach 106 MB, and one imported document contains over 258,000 block children. The source drawings and generated artifacts are deliberately outside the repository.

Two files do not declare units. Matching terrace geometry differs by exactly 100 between them: corpus verification uses centimetres for `4427_TOITURE` and metres for `SGdB PRO TT`. This is a geometric inference, not a source declaration; the application continues to require an explicit `UNIT` for unitless drawings. The template drawing references two external logo images absent from the supplied corpus: its verification uses `SKIP`, reporting exactly two IMAGE records. Other supported model geometry is retained. Paper-space content remains excluded.

All six passed the native macOS cycle: DWGIN, explicit `.lcad` save, browser archive decoding, one-step undo/redo, native reopen and state comparison. Entity/layer/block IDs and structure match; numeric comparisons allow relative rounding of 1e-10 between WebKit and V8. Import plus the full MCP state response took approximately 1–44 seconds across corpus and review regression runs, some concurrent with other validation; this is not a converter-only benchmark. The largest documents contain 43–73 MB of uncompressed JSON. Model rendering batches opaque curves inside nested blocks, and ordinary native open/save avoids redundant geometry copies. Recovered copies still retain independent source evidence. MCP open retires the old editor synchronously before acknowledging session replacement; vector import likewise commits before its command promise resolves.

Review regression checks compare 3,837 imported ellipses at five parameter positions and all 212 native mask boundaries with independent ezdxf WCS coordinates from the corpus. Synthetic tests also cover inclined axes, MTEXT WCS anchors, tiny local rich-text heights, Fit/Aligned baselines and simple imported text re-export. Native integration repeats a 12,000-object worker import and checks the geometry in the command response itself, immediate state and undo; a later state read alone could hide a premature acknowledgement.

This establishes the supported model-space workflow on this corpus, not pixel-identical AutoCAD output. Large nested plans still consume substantial memory and may take tens of seconds to save/reopen. Some source drawings place other floors' annotations far from the roof, so fitting the complete model makes the roof small; zoom into the relevant area. See [PERFORMANCE.md](./PERFORMANCE.md) for measured limitations.
