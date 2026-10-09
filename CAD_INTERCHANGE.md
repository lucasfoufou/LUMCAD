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

- Import: planar LINE, POINT, CIRCLE, ARC, ELLIPSE, POLYLINE/LWPOLYLINE (including exact circular bulges), open clamped nonrational cubic SPLINE, basic TEXT/MTEXT and static INSERT/BLOCK definitions.
- Export: native lines, points, circles, arcs, full ellipses, point polylines, cubic splines, basic text and static blocks. Compound polylines, rectangles and polygons become separate curves when necessary, with a warning.
- Static block nesting, insertion position, rotation and nonuniform XY scale are retained. Layer-zero block children inherit the insertion layer. Sheared block transforms, attributes, dynamic blocks and external references are refused.
- Used source layers are imported separately, retaining names, colour, visibility, frozen, frozen-in-new-viewports, locked and plot flags. DXF true colour has priority over indexed colour. Indexed colour 7 (black on light backgrounds, white on dark ones) maps to LUMCAD's default ink in both directions. Objects that follow their layer colour are exported ByLayer. DWG R2000 colours are approximated by the indexed palette. Line patterns/weights and BYBLOCK appearance are not faithfully preserved; messages report approximations.
- Curve- and spline-fitted POLYLINE entities import their displayed vertices; the control frame is ignored. MTEXT long text chunks and direction vectors are read.
- Basic text remains editable, but font substitution, alignment, metrics and placement can differ. Rich DXF formatting and unsupported text transforms are refused. Layouts, constraints, groups, application metadata and other native semantics are not transferred; export reports this limitation.
- HATCH, DIMENSION, SOLID, images, leaders, tables, unsupported/proxy entities, 3D/OCS geometry, thickness, wide polylines and binary DXF are not converted yet. Partial ellipse export, rational/periodic/closed spline import, affine-framed native entities and transparency also remain unsupported.

## Paper space and unsupported objects

- **Paper space is always ignored.** Import targets model space: layout objects (viewports, title blocks, `*Paper_Space` definitions) are left out and counted in the result message.
- **By default, an unsupported model object refuses the whole import.** The message lists the blocking objects by DXF type and count (for example `HATCH ×12, DIMENSION ×3`), and nothing changes in the drawing.
- **`SKIP` imports everything else.** Supported objects are imported in one undo step; the message lists what was left out with the same type counts. Left-out objects never create layers. Inside a block definition, only the unsupported children are left out. INSERTs of external references (xrefs) are left out, as INSERT.
- Named block definitions are imported even when unused. Anonymous definitions (`*U`, `*D`…) are imported only when reachable from imported INSERTs, so dimension geometry blocks are not imported on their own.
- Malformed or binary DXF files, limits, cyclic blocks and invalid geometry (zero radius, non-finite values) still refuse the import, with or without `SKIP`.

The importer validates before committing. A refusal leaves drawing content/history untouched. File-dialog cancellation is a no-op. A drawing changed while the import dialog/read was pending must be retried. Native exports use temporary files and atomic replacement only after successful conversion; failed conversion preserves an existing destination.

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

Input/output files are limited to 64 MiB. The DXF reader limits group lines (2,000,000) and entity records; conversion additionally limits entities/expanded block instances to 100,000, imported layers to 4,096, block definitions to 1,024 combined with existing definitions, and nesting to 16 levels. Polylines are limited to 4,096 vertices. Cycles and unsupported transforms reject. Converter processes are stopped after 90 seconds or when their output exceeds the file limit. These are file/geometry/time limits, not an OS memory sandbox. Parsing/geometry conversion runs synchronously in the frontend; large-file responsiveness remains to be profiled.

Unit tests cover physical units, coordinate orientation, true colour, indexed default ink and ByLayer export, arc sweeps, bulges, POLYLINE/VERTEX sequences, MTEXT chunks, XDATA/application groups/embedded objects, block geometry/inheritance, cubic splines, unsupported input reported inside blocks, malformed containers and numbers, and text record injection. Rust tests cover converter lookup. Browser E2E covers real DXF file selection, undo/redo, actual export download and atomic unsupported-entity refusal. Native `npm run test:headless` verifies DXF export/import/undo. Set `LUMCAD_LIBREDWG_DIR` when running that script to also exercise real DWG conversion, or `LUMCAD_TEST_DWG=1` to let the application find LibreDWG itself.

The native round trip was verified on macOS Apple Silicon with LibreDWG 0.14 compiled from the official release. A mixed primitive/spline/block DWG round trip was also checked; original and returned DXF files were independently parsed/audited with ezdxf 1.4.4. The R2000 intermediate avoids a LibreDWG 0.14 name-conversion defect encountered with R2007 DXF input. Neither external tool is a JavaScript runtime dependency. Native Windows/Linux, independent AutoCAD acceptance, large customer files and more advanced entity fixtures remain unverified.
