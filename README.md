# LUMCAD

LUMCAD is an open-source, AI-enabled 2D CAD application. Its goal is to make everyday 2D CAD operations simpler through a lightweight, local-first, multi-platform desktop application that can also be controlled by AI tools.

> LUMCAD is in early development. The `.lcad` format and user-facing workflows may evolve before the first stable release.

## Why LUMCAD?

LUMCAD was originally created to simplify 2D plan generation for our company, **LUMÉOL**. Repetitive drawing work should be fast to perform manually and straightforward to automate, without requiring a heavyweight or proprietary CAD environment.

The project is now open source so that this foundation can grow into a useful general-purpose 2D CAD tool: free to inspect, use, improve, and adapt, with AI integration designed into the application from the start.

## Project goals

- provide a responsive 2D drawing experience on macOS, Windows, and Linux;
- keep drawings portable and locally owned through the documented `.lcad` file format;
- cover common CAD operations with both visual tools and command aliases;
- expose the active drawing through a local MCP server so compatible AI clients can inspect and edit it;
- remain lightweight, transparent, and useful without an online account or cloud service.

## Current capabilities

- `DGNIMPORT [file.dgn] [UNIT mm|cm|m|km|in|ft|yd|us-ft] [AT x y] [SCALE factor] [CELLS BLOCKS|EXPLODE]` imports supported 2D V7 lines, polylines, shapes, ellipses and arcs as editable model objects in one undo entry. Omit the path for the native/browser picker; explicit paths require the desktop app. Source levels become distinct layers and graphic groups retain membership. Known units convert to metres; unknown or inconsistent source units require UNIT. Palette colors and supported solid fills are preserved; omitted metadata and stroke approximations are reported. Native/browser input is bounded to 64 MiB. Printable ASCII text imports as editable text, with original placement, rotation and character proportions; font substitution and metric approximations are reported. Connected complex chains/shapes, including nested open chains, with matching member levels and graphic groups become exact native polylines, including elliptical arcs, header solid fills and individual member colors/weights/styles. Member database links and locks produce the same omission warnings as standalone objects. Sub-resolution gaps caused by integer coordinates or quantized angles are reconciled with an explicit warning: adjacent line endpoints move to the arc endpoint, or a short connector preserves both arcs; larger gaps reject. Other encodings, nested closed shapes, differing member levels/groups and other unsupported complex elements, 3D and V8 reject the entire import. Destination locks and document changes during reading also reject the import.  Supported cells become linked block instances by default (CELLS BLOCKS), preserving nested definitions, member order, source levels and insertion origins. Named and graphic selection groups select the containing model instance. CELLS EXPLODE retains independent editable members with selection groups and reusable definitions. Names are collision-safe. Each source cell has an independent definition; identical source names are not assumed to imply identical geometry. Source metadata omissions are reported. Grouped-hole cells with one closed solid and disjoint internal holes retain an exact even-odd hatch plus editable outlines. Outside, touching, crossing or nested holes and ambiguous multiple solids reject atomically. DGN reference attachment and clipping are described below; export remains in development.

- `DWFATTACH [file.dwfx] [PAGE n] [AT x y] [SCALE factor]` attaches a supported DWFx page as a portable underlay, retaining the original package and a cached PNG preview. `DWFCLIP` crops the selected underlay with the shared rectangle/polygon clip controls. Attachment and clipping support undo/redo. The reader currently supports a subset of XPS paths, transforms, clips, resource dictionaries, solid/gradient/PNG, JPEG and supported TIFF image brushes and horizontal text in either direction and vertical text using embedded TrueType or CFF 1 outlines (including CID-keyed fonts) (including indexed collection faces) and explicit glyph clusters (including ligatures), plus simulated bold, italic and bold-italic styles; JPEG EXIF orientation does not override XPS brush placement, and the original source bytes are preserved; unsupported artwork rejects the attachment. Legacy DWF6 and full XPS compatibility remain in development.

- `WMFIN [file.wmf] [AT x y] [SCALE factor]` imports supported WMF vector records into editable model geometry in one undo entry. Transparent text with explicit character height imports as editable text with a font-substitution warning; explicit opaque text rectangles retain their background. Explicit character spacing is preserved using separate editable characters, also reported at import. Text-specific clipping and intersected/offset context rectangles use editable clipped blocks. Omit the path for the browser/native picker. Supported STRETCHDIB, DIBSTRETCHBLT and DIBBITBLT bitmaps using SRCCOPY become embedded PNG images, including uncompressed indexed/RGB pixels and 16/32-bit RGB bitfields (such as RGB565), and RLE4/RLE8 compressed pixels. RLE skips remain transparent. SETDIBTODEV also imports complete images and uncompressed scan bands at their source-relative destination position. Unsupported text variants, bitmap operations, clipping or other records reject the complete import; remaining stroke approximations are reported. Full WMF compatibility is still in development.

- `WMFOUT [file.wmf]` exports supported visible model geometry to a placeable WMF through native Save As or a browser download. Supported content includes linework, native axis-aligned ellipses/arcs, solid and line/cross hatches, ordinary nested blocks, loaded drawing references and supported cached PDF previews, supported dimension linework/arrows/localized labels, supported single-byte text and opaque embedded raster images with axis-aligned placement, quarter-turn rotation, rectangular clipping and brightness/contrast/monochrome adjustments. The export reports its source origin and coordinate, stroke, curve and font approximations. Unsupported visible objects, transparency, nonrectangular block clips and unsupported text variants reject the complete export. Oblique or polygon-clipped images and binary transparency use bounded colored pixel regions (up to 8,192 regions), with an explicit edge-smoothing warning. Partial transparency, gradients and broader interoperability remain in development. Export leaves the drawing and undo history unchanged.

- `COUNTTABLE x y LINKED [ALL|SELECTED] [NESTED] [GROUP fields] [SUM length,area]` creates quantity tables that update with model edits in the same undo step. Tables are excluded from their own queries. Query scopes, cached values and update status persist in `.lcad`; source removals drop out of fixed selections. Failed updates retain an explicitly marked snapshot. `TABLEDIT DETACHQUANTITIES` makes the values editable again.

- model quantity extraction with named reusable queries, grouped counts/lengths/areas, CSV/JSON and binary Excel `.xls` reports, and editable quantity tables; the lazy-loaded Excel writer uses [SheetJS CE](https://docs.sheetjs.com/docs/api/write-options/) pinned to its official distribution;

- bounded drawing cleanup with OVERKILL preview/duplicate removal/collinear union, FLATTEN for residual XY elevation data, and dependency-aware PURGE/-PURGE for unused model/paper/block definitions; all expose count reports and undo;

- linked text fields for drawing metadata, object measurements, UTC dates, formulas, table cells and layout page numbers, with explicit batch refresh and undo;
- editable tables with merged cells, A1/range formulas, named styles and cell formatting; UTF-8 CSV import/export, explicit linked-source refresh, and count schedules sharing the table editor;
- native styled points, equal/fixed arc-length point or block placement (`POINT`, `DDPTYPE`, `DIVIDE`, `MEASURE`);
- lines, rectangles, regular polygons, circles, arcs, polylines, rich single-line/multiline text, reference images, and associative dimensions;
- layers and ByLayer/custom colors, line weights, line types, and transparency;
- object snaps, tracking helpers, grips, selection windows, and command aliases;
- named selection groups, temporary object isolation, property/layer transfer, saved model views, persistent selection filters, similar-object selection, spatial/nested-block counts and editable static count schedules;
- non-persistent distance/angle/area/perimeter/radius inquiry, coordinate/entity reports, cumulative areas and planar mass properties with a shared copyable result panel;
- ellipse and elliptical-arc creation from axis endpoints or centre, with shared parameter editing, native curve grips, associative axis/arc-length dimensions and constant-distance spline offsets;
- persistent construction lines (`XLINE`) and rays (`RAY`) with origin/direction grips, object snaps and viewport-clipped model/paper rendering;
- move, copy, rotate, scale, offset, exact native-curve trim/extend and break, crossing-window stretch, four-mode lengthen, mirror, exact mixed-curve join, explode/XPLODE, and rectangular/polar/path arrays with previews, live path associations and post-creation `ARRAYEDIT` controls;
- interactive two- or three-pair 2D alignment with optional uniform scaling, branch-aware fillet and chamfer editing with trim and whole-path modes, and endpoint-tangent cubic spline blends;
- operating-system clipboard copy/cut/paste, including picked base points, original-coordinate paste, anonymous-block paste, and LUMCAD JSON/SVG interchange;
- persistent exact ellipse, cubic-spline, mixed-path, hatch-boundary, dimension, and anonymous block-reference data used by compound operations and interchange;
- local `.lcad` files with native Open and Save As dialogs plus continuous autosave;
- atomic autosave and automatic recovery for drawings that do not yet have a file path;
- standard or custom paper layouts with margins, importable/exportable page setups, text/line/rectangle paper annotations, templates, scrollable tabs, and pointer reordering;
- `CHSPACE` model/paper transfer through native block containers, paired-point viewport alignment (`ALIGNSPACE`), and editable native layout export (`EXPORTLAYOUT`), preserving viewport scale and rotation;
- multiple transparent clipped/rotated model viewports with exact `1/X` scales, locking, maximize/minimize, annotation controls, and per-viewport layer appearance;
- plot preview and ordered current/all/Cmd-or-Ctrl-selected layout publication to direct PDF or raster XPS/ePlot DWFx (cloud conversion and portrait/landscape rendering verified in Autodesk Viewer), with mixed paper sizes, plot areas, fit/fixed scales, margins, styles, vector/raster quality, reusable page setups, sheet-only system printing, and unattended PDF output;
- a local Streamable HTTP MCP server for AI-assisted drawing workflows;
- an English and French interface, with English as the source language.

Reusable drawing templates use ordinary `.lcad` files. `SAVETEMPLATE` (`DWT`) exports a template without switching the current drawing; `NEW TEMPLATE` selects one and `NEW FROM "absolute/path.lcad"` reads one in the desktop app. `QNEW` uses the default template path in Settings, or creates a blank drawing when no template is configured. Instances have fresh document identities and save separately. The `DWT` alias does not read or write Autodesk's DWT format.

## AI and MCP

LUMCAD starts a local MCP server alongside the desktop application. Its preferred endpoint is `http://127.0.0.1:43622/mcp`; if that port is occupied, LUMCAD automatically selects another free localhost port. The active endpoint and preferred port are available from the application settings.

See [MCP.md](./MCP.md) for client configuration, available tools, action examples, the local security model, and the command-coverage tests.

## The `.lcad` format

A LUMCAD drawing is a standard ZIP container with this initial structure:

```text
drawing.lcad
├── manifest.json
└── assets/
    ├── 0001-reference.png
    └── 0002-title-block-logo.svg
```

`manifest.json` is a versioned JSON document containing the drawing geometry, layers, settings, and asset descriptors. Binary images are stored separately below `assets/`; they are not duplicated as base64 inside the manifest. This keeps reference images—and future title-block resources—portable inside one `.lcad` file while remaining easy to inspect with standard ZIP tools.

The current `.lcad` format is version 2 and always uses this ZIP structure. Version 1 files remain readable and are normalized to the current document model when opened. See [LCAD_FORMAT.md](./LCAD_FORMAT.md) for the container contract and safety limits.

Rust writes to a temporary file next to the target, synchronizes it to disk, and then replaces the target atomically. A drawing without a file path is saved as `recovery.lcad` in LUMCAD's application data directory and restored at the next startup.

For a damaged file, `RECOVER` first displays a diagnostic and prepares a separate candidate. Review the discarded-object details, then use **Open recovered copy** (or `RECOVER OPEN`) to open an unsaved drawing. Use **Save as** to create a separate file; the native source path is protected during that session. `RECOVER FROM "absolute/file.lcad"` selects a native source directly. Close the source drawing before recovering it. On desktop, `RECOVERALL` inspects the root and its referenced drawings; `RECOVERYMANAGER` lists per-file results, and `SELECT n` / `OPEN n` reviews or opens a candidate. The current batch follows recovered copies within the session. Opened desktop copies preserve source-relative reference locations when saved elsewhere; the report lists changed paths and locations still needing manual resolution. Persistent metadata history is available through `RECOVERYMANAGER HISTORY`; broader dependency repair remains in development.

## Clipboard interoperability

`COPYCLIP`, `COPYBASE`, and `CUTCLIP` write a versioned LUMCAD JSON flavour together with interoperable SVG; the plain-text fallback is the same complete SVG with embedded lossless JSON metadata. On macOS, the desktop build also advertises native `public.svg-image` and UTF-8 text pasteboard types. The payload includes selected-object dependencies plus the referenced layers, embedded assets, and anonymous block definitions. `PASTECLIP`, `PASTEORIG`, and `PASTEBLOCK` remap those resources safely when geometry crosses document boundaries; a cut deletes its source only after the operating-system write succeeds.

The SVG representation keeps exact ellipses, elliptical and circular arcs, cubic splines, hatch boundaries, dimensions, and block transforms. SVG copied from another application can be pasted when it uses bounded basic shapes or absolute/relative `M/L/H/V/C/S/Q/T/A/Z` paths with simple translate, rotate, scale, or matrix transforms. Affinity-to-LUMCAD paste requires Affinity's **Copy items as SVG** setting; ordinary Affinity clipboard data that contains only proprietary, PDF, or bitmap flavours is outside this geometry importer. The embedded LUMCAD metadata remains authoritative for lossless LUMCAD-to-LUMCAD copies, while malformed or unbounded external data is rejected as one atomic import.

## Downloads

Tagged versions are published on the [GitHub Releases page](https://github.com/lucasfoufou/LUMCAD/releases) for:

- macOS on Apple Silicon and Intel (`.dmg`);
- Windows x64 (NSIS installer);
- Linux x64 (`.AppImage` and `.deb`).

Each successful release also publishes a signed Tauri updater manifest. An installed updater-enabled version checks GitHub periodically, offers a newer compatible build in the header, verifies its updater signature, saves the active drawing, and installs only after confirmation. The first updater-enabled version must still be installed manually.

The release workflow uses ad-hoc signing on macOS and does not yet notarize the macOS bundle or sign the Windows installer with an identified developer certificate. Tauri updater signatures protect the update channel, but they do not replace Apple Developer ID or Windows Authenticode signing; the operating system may therefore display a security warning for manually downloaded builds.

## Development

### Requirements

- Node.js 22.13 or newer (the recommended exact version is recorded in `.nvmrc`);
- the stable Rust toolchain;
- the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

### Run locally

```bash
npm ci
npm run tauri dev
```

### Run the complete local checks

```bash
npm run check
```

This runs the frontend tests, the production frontend build, and the Rust test suite.

To create a development bundle on macOS:

```bash
npm run tauri build -- --debug
```

## Releases

Releases are built by [`.github/workflows/release.yml`](./.github/workflows/release.yml) whenever a tag matching `v*` is pushed. The workflow validates and tests the source, builds every supported desktop target sequentially into one draft GitHub release, signs the updater artifacts, verifies every installer, signature, URL, architecture, and `latest.json` entry, and publishes the release only after every platform succeeds.

The workflow requires the repository secret `TAURI_SIGNING_PRIVATE_KEY`. The matching public key is embedded in LUMCAD; never commit or lose the private key. See [RELEASING.md](./RELEASING.md) for key custody, local signed builds, the complete release sequence, expected artifacts, and end-to-end update validation.

Before creating `vX.Y.Z`, update the same version in:

- `package.json` and `package-lock.json`;
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`;
- `src/utils/lcadDocument.js`.

Then run `npm run check`, merge or push the release commit to `main`, create the matching Git tag from that published commit, and push the tag separately. `scripts/check-release-version.mjs` rejects a release if any declared version differs from the tag. Do not create the tag before the workflow and signing secret are available on `main`.

## Translations

English is the source and fallback language. See [TRANSLATING.md](./TRANSLATING.md) for the catalog conventions, the steps for adding a locale, and the validation checklist.

## Contributing

Issues and pull requests are welcome. Please keep changes focused, reuse existing components and geometry helpers where possible, and include tests for behavior that can be exercised independently of the UI. Run `npm run check` before submitting a pull request.

Translations are particularly welcome; follow [TRANSLATING.md](./TRANSLATING.md) so every locale remains complete and testable.

## License

LUMCAD is licensed under the [GNU General Public License version 3 only](./LICENSE) (`GPL-3.0-only`). Commercial use is allowed. If you distribute LUMCAD or a modified version, the GPL's source-code and copyleft requirements apply. The software is provided without warranty; consult the license text for the complete terms.

## Maintainers

LUMCAD is built and maintained by **Lucas FOUGERAS and DIGITAL CACTUS**.

### Spline construction

Use `SPLINE` (`SPL`) or the spline toolbar button. `FIT` interpolates at least two distinct successive points with a natural cubic curve using chord-length parameters. `CONTROL` / `CV` uses at least four control vertices for a clamped uniform cubic B-spline. Pick or type up to 128 points, then press Enter or type `DONE`; Escape discards the preview. Changing the construction mode starts a fresh preview.

Creation commits one undoable object with exact native Bézier spans and an editable definition. Select it and run `SPLINEDIT` (`SPE`) to edit the original fit points or B-spline vertices and their normalized parameters/knots. The same points have canvas grips. `SPLINEDIT POINT 2 5 7` moves definition point 2 to (5, 7); `SPLINEDIT KNOT 5 0.4` changes knot 5. Indices start at 1. End parameters are fixed at 0 and 1; knot order and cubic multiplicity limits are validated. Parameters stay fixed through point edits and affine transforms, so nonuniform scaling preserves the exact curve.

Use the panel's **Convert to Bézier controls** action or `SPLINEDIT BEZIER` to discard the definition while keeping the exact geometry. The panel then edits four controls per span. `SPLINEDIT CONTROL 2 1 5 7` also switches to this representation and moves a control. Connected endpoints and their adjacent controls move together; existing smooth tangent ratios are preserved and intentional corners stay independent. Conversion is undoable. The expanded geometry fields edit endpoint derivatives in metres per normalized parameter. `SPLINEDIT TANGENT START 10 0` imposes the start derivative; `TANGENT END 0 8` imposes the end derivative. FIT retains these constraints during point/knot edits; `TANGENT START NATURAL` restores its natural boundary condition. CONTROL changes its adjacent vertex using the endpoint knot interval. Use `INSERT index x y` / `REMOVE index` to add/remove definition points (indices start at 1; insertion is before the index and accepts count + 1 to append). This rebuilds chord-length FIT or uniform CONTROL parameters and can change the curve. The panel offers insertion after the selected point and removal. Moving an endpoint this way removes its previous tangent constraint; constraints at unchanged endpoints are retained. `INSERTKNOT value` refines a CONTROL spline without changing its shape.

The panel’s Conversions section and SPLINEDIT also offer `CONTROL` (exact conversion from connected open cubic spans), `FIT` (refit through span endpoints or an open point polyline, changing the curve), and `POLYLINE tolerance` (straight segments with a world-space tolerance in metres). Definition workflows are limited to 128 points; polyline conversion requires tolerance at least 1e-8 m and is bounded to 4096 vertices/depth 20. Invalid or over-limit operations leave the object unchanged. Identity and appearance survive conversions; undo restores the previous representation.

### Hatches and fills

Select closed curves (including multiple loops for islands) or an unbranched chain of lines/arcs, then use `HATCH` (`H`) or its toolbar button. `SOLID` and `GRADIENT` create their corresponding fills. Hatches retain native boundaries and follow edits to their selected sources; independently moving/editing the hatch detaches that association. `HATCHEDIT` (`HE`) opens the shared editor for solid, parallel/crossed lines, linear/radial gradients, spacing, angle, origin and detachment. The entity/layer colour supplies the primary colour; gradients have an editable end colour. Standard transparency applies to the entire fill.

Command examples: `HATCH CROSS 0.25 45`, `HATCH GRADIENT #00aacc 25`, `HATCHEDIT ORIGIN 2 3`, `HATCHEDIT DETACH`. `HATCHTOBACK` moves selected hatches behind other objects, or all editable hatches when none are selected. Creation/association refresh/edit/reordering use undo history. Boundary assembly is capped at 512 native curve parts and rejects open/branched input. With no selection, HATCH asks for an interior point; `HATCH PICK CROSS 0.25 45` explicitly enters this mode. Click or enter `x,y`. Native intersections split contours into faces, including islands and crossing dividers. Escape cancels; rejected picks leave the command active. Pick detection is bounded to 256 input curve pieces (curves are quartered), 2048 edges, 200000 intersection checks and 32768 containment samples. Open areas, coincident duplicate curves, edge picks and over-budget arrangements are rejected.

`BOUNDARY` (`BO`, `BPOLY`, `-BOUNDARY`) asks for an interior point (click or `x,y`). It creates independent closed native polylines for the outer contour and immediate islands on the current visible, unlocked layer. Source objects remain unchanged. Detection uses the same finite-curve geometry and complexity limits as HATCH PICK; ambiguous picks remain pending, Escape cancels, and one undo removes all contours from a pick.

`REGION` (`REG`) creates one independent planar region from selected closed curves or unbranched closed chains, preserving its sources. With no selection, or `REGION PICK`, click an interior point or enter `x,y`. Native outer and island loops form an even-odd area rendered as outlines; selection inside a hole does not select the region. A single centre grip moves all loops together. Standard transforms, clipboard, archive reload and `EXPLODE` retain native curves. The pick detector shares BOUNDARY limits; creation is one undo step. Boolean region operations and region mass-property inquiry are separate capabilities.

`IMAGEADJUST` (`IAD`) opens the shared editor for one unlocked reference image. Options: `BRIGHTNESS 0..200`, `CONTRAST 0..200` (neutral 100), `MONO ON/OFF`, `RESET`. Each edit is undoable and affects only that instance. Original embedded image bytes remain unchanged. The SVG renderer/clipboard use sRGB transfer filters; PDF preparation bakes the same transfer into image pixels before vector output. Existing opacity and include-in-PDF controls continue to apply.

`IMAGECLIP` (`ICL`) opens the same image editor. Its rectangular crop fields use percentages. Command options use fractions of the unrotated image (0–1): `RECT x1 y1 x2 y2`, `POLYGON x y …` (3–128 vertices), `ON`, `OFF`, `DELETE`. Self-crossing, empty and out-of-image contours are rejected. OFF preserves the contour; DELETE removes it. Crop follows image transforms, restricts visible selection/snapping, and is retained by archive, clipboard SVG and shared model/layout/print rendering. Edits preserve source image bytes and use undo history.

`DRAWORDER` (`DR`) reorders selected editable model objects: `FRONT` (default), `BACK`, `FORWARD`, `BACKWARD`, `ABOVE`, `BELOW`. ABOVE/BELOW then ask for another visible object; MCP can supply a point action with `targetId`. Relative order remains stable. `TEXTTOFRONT` (`TF`) accepts `TEXT`, `DIMENSIONS`, or `ALL` (default) and moves editable annotations. `HATCHTOBACK` uses the same ordering logic. Effective changes use one undo step and persist in the entity sequence.

`WIPEOUT` (`WI`) creates a white mask from one selected simple straight-edged closed contour, preserving the source. With no selection or `POINTS`, click/type 3–128 vertices, then Enter or `DONE`; `UNDO` removes the last vertex and Escape discards the preview. `FRAME ON/OFF` changes selected masks; the shared editor offers the same frame control. Frame visibility applies on screen and in print. Masks use normal draw order, transforms, grips, clipboard and archive persistence. Self-crossing or curved contours are rejected.

`IMAGEADJUST KEY #rrggbb [tolerance]` makes an image colour transparent; `KEY OFF` disables it. The shared editor exposes the colour and tolerance (0–100%, default exact match). A pixel is keyed only when each original RGB channel is within `floor(255 × tolerance / 100)` of the chosen colour. Keying precedes brightness/contrast/monochrome and preserves nonmatching alpha. PDF preparation keys original pixels before downsampling and uses PNG for keyed images, including JPEG sources; keyed source processing is bounded to 64 million pixels. Original assets remain unchanged.

### Linked reference images

`IMAGEATTACH` (`IAT`) attaches a local PNG, JPEG, GIF, WebP or SVG through a native dialog, or accepts an absolute path (optionally quoted). It retains a last-good embedded snapshot so the drawing remains portable and works without the source file. The toolbar's image import continues to create an embedded image.

Select an image and use `IMAGE` (`IM`, `CLASSICIMAGE`) to open its shared panel. Its **Source file** section shows the path and offers link/replace, reload and embed actions. The same commands are `IMAGE LINK [path]` / `RELINK [path]`, `IMAGE RELOAD`, and `IMAGE EMBED`. A missing or invalid source leaves the previous snapshot intact. Reloading never changes placement, rotation, aspect ratio, opacity, colour adjustment or crop. Each replacement is undoable, including its old cached bytes. Linked files are read only on an explicit attach/reload/relink request; opening a drawing or plotting uses the saved snapshot. Paths are absolute; relink after moving the source. File reads require Tauri; browser mode can inspect the cached image and remove its link.

`CLIP` aliases `IMAGECLIP`; `TRANSPARENCY` (`TRP`) applies a 0–90 percent object transparency override to the unlocked selection. Original alpha, image opacity and colour-key settings remain independent.

### Named blocks

Select editable objects and run `BLOCK` (`B`, `-BLOCK`) with `"name" [baseX baseY] [KEEP] [REDEFINE]`. Omit coordinates to pick or type the base point; omit the name to enter it first. The default replaces the selection with one block reference in place. `KEEP` retains the original objects. Source dependencies of dimensions, hatches and arrays are included; conversion is refused when it would break associations from objects outside the selection. Include those objects or choose `KEEP` instead. `REDEFINE` explicitly updates an existing definition, keeping its ID and updating all its references; recursive containment is rejected.

`INSERT` (`I`, `-INSERT`, `CLASSICINSERT`) accepts `"name" [x y [scale [angleDegrees]]]`. Without coordinates, a preview follows the picked insertion point; `SCALE value` and `ROTATION degrees` adjust it before placement. This insertion workflow uses a positive uniform scale. Existing transform commands can transform references afterwards. Each creation, redefinition and insertion is one undoable edit; Escape cancels a pending point.

The **Blocks** sidebar tab and `BSEARCH [text]` show a searchable list of named definitions, start insertion, or create a definition from the current selection. Use the palette’s edit action or `BEDIT [name]` (with no name, select one reference) to edit local child geometry. `BSAVE` applies the draft to every occurrence in one model undo step and keeps the editor open. `BCLOSE SAVE` (the default) saves and closes; `BCLOSE DISCARD` abandons only changes since the last save. The banner exposes the same actions and indicates unapplied changes. Escape cancels the active drawing command. While editing, normal drawing tools and undo/redo operate on the isolated draft; autosave continues to save the model without unpublished draft changes. File replacement, export, layouts and nested block-edit sessions require closing the editor first. New layers, nested definitions and image assets are adopted when saving; existing model-only layers are retained. External block libraries are still in progress.

`BASE x y` sets the drawing insertion base point in metres without moving objects; `BASE` alone accepts a picked or typed point. Escape cancels and undo restores the previous base point. Close the block editor before changing the document base.

`WBLOCK "name"` exports a named definition and its dependencies to a portable `.lcad` library. `WBLOCK LIBRARY` exports all named definitions; `WBLOCK SELECTION` exports the selection (or the whole drawing when nothing is selected) relative to `BASE`. Append `TO "/absolute/library.lcad"` for native direct output, or use the Save As dialog. The Blocks palette provides library import/export and per-definition export.

`BLOCKIMPORT [path]` merges a library into the palette in one undo step without adding model objects. Ordinary `.lcad` drawings can also be imported as one block using their `BASE`. `INSERT FILE [path]` imports then previews placement of the first library entry; placement is a separate undo step. Conflicting names receive numbered suffixes, IDs/resources are remapped, identical images are reused, and existing destination layers take precedence. Close BEDIT first.

Object snaps traverse visible nested block children in world coordinates, including endpoints, midpoints, nearest points and intersections; excluded instances are excluded as a whole. Expansion is bounded to 10,000 visited instances/children and nesting depth 32. Nonuniform block circle/arc decomposition retains exact native ellipses; similarity transforms preserve mirrored image frames and scale inherited/rich text sizes.

Inside blocks, children on layer `0` inherit the insertion layer recursively. Explicit child layers and object appearance overrides remain independent. Hidden resolved layers are omitted from rendering and snapping. Standard `EXPLODE` preserves resolved block-child appearance; `XPLODE` still offers explicit parent-property inheritance. The model, layout/print renderer and clipboard SVG follow the same layer rule.

Decomposing a block with nonuniform scale or shear keeps image/text geometry exact through an outer affine frame. Images retain cropping and adjustments; text retains editable content and styles. World-space grips, later transforms, in-place text editing, printing, clipboard and `.lcad` persistence preserve the frame.

`ATTDEF TAG "default" x y [HEIGHT metres] [PROMPT "label"] [CONSTANT] [INVISIBLE]` creates an attribute definition as native text in the model or a BEDIT draft. Include it when creating a block. Each insertion keeps its own values; `ATTEDIT TAG "value"` edits selected unlocked references, or use the selection panel. Constant fields take their definition value. `ATTSYNC "block name"` (or selected references) preserves values by tag, adds new defaults, removes stale fields and refreshes constants. `ATTDISP NORMAL|ALL|OFF` controls attribute visibility, including snapping and printing. Attribute tags are case-insensitive, 1–64 characters, start with a letter and contain letters, digits, underscores or hyphens. Definitions are limited to 256 unique tags per block. These edits follow normal undo/redo.

`BATTMAN` opens the Blocks palette: expand Attribute manager to edit tags, prompts, defaults, constant/invisible flags, field order or remove a definition. Command input accepts `"block" TAG TAG|PROMPT|DEFAULT "value"`, `CONSTANT|INVISIBLE ON|OFF`, or `UP|DOWN|DELETE`. Renaming migrates values in all instances, including nested and locked references. Changing a default preserves existing variable values; constant values follow the definition. Duplicate tags and deletions that break dependencies are rejected. Close BEDIT before using this manager.

`ATTEXT [CSV|JSON] [ALL|SELECTED] [TO "absolute path.csv/json"]` exports one record per attributed block occurrence, including nested instances. It includes hidden, locked, constant and invisible fields. Each record contains an instance path, block/layer IDs, world insertion coordinates in metres and current values. The default is CSV for all model insertions; omit TO for a native save dialog or browser download. SELECTED traverses only selected model roots. CSV quotes multiline fields and prefixes formula-like strings with an apostrophe; JSON preserves exact values. Extraction is bounded to 100,000 visited entities, 32 nested definitions and 64 MiB output. Missing/cyclic references fail without a partial export. No drawing or history changes occur; close BEDIT first.

`ATTDEF` without arguments opens the definition form in the Blocks palette: tag, prompt, default, metre coordinates, text height and constant/invisible flags. The same form works inside BEDIT. Each named block in the palette exposes values for its next insertion; set them before pressing Insert, then pick/type the point. While INSERT awaits a point, `ATTRIBUTE TAG "value"` updates a variable field in the preview. Values and geometry commit together, so one undo removes the whole insertion. Constants retain their definition value.

`DIMSTYLE` lists named dimension styles. `SAVE "name"` creates a style from the selected dimension (or the current style); `CURRENT "name"` selects the style for newly created dimensions; `APPLY "name"` replaces the style of selected unlocked dimensions; `DELETE "name"` removes an unused inactive custom style. Use `SET "name" TEXT|ARROWSIZE|GAP|OVERRUN metres`, `ARROW tick|closed|open|none`, `PRECISION 0..8`, or `PREFIX|SUFFIX "text"` to edit a style. Linked model and nested dimensions update together with one undo step, retaining stored overrides and geometric associations. Close BEDIT before managing styles. Shared model/print/SVG rendering supports the arrow and extension settings. The dedicated style panel also exposes tolerance, alternate-unit and inspection settings. DIMSTYLE SET supports these fields through TOLERANCE/TOLUPPER/TOLLOWER/TOLPRECISION, ALTERNATE/ALTUNIT/ALTPRECISION and INSPECTION/INSPECTLABEL/INSPECTRATE.

The Dimension styles sidebar exposes the same catalog operations as DIMSTYLE: create, rename, choose current, apply, edit parameters and delete unused styles. `DIMSTYLE` without arguments opens it. `RENAME "old" "new"` keeps the stable style ID. Manual text-size/format edits in the dimension properties panel become explicit overrides and survive later style edits; APPLY resets overrides.

Dimension creation previews use the current style before placement. Styled arrows and extension lines participate in pointer/window selection and bounds. `DIMUPDATE ["style name"]` applies the current or named style to selected unlocked dimensions and clears overrides. `DIMREGEN` refreshes selected dimensions from their linked styles, preserving overrides; without selection it processes editable model dimensions. `DIMINSPECT ON ["label" ["rate"]]` enables an inspection frame, while `DIMINSPECT OFF` hides it without discarding its label/rate. Maintenance validates the entire selection before a single undoable edit.

`DIMDISASSOCIATE` freezes the current measured geometry of selected unlocked dimensions and removes their source links. The dimension remains editable and keeps its ID/style. Native points or a bounded local curve snapshot preserve its appearance after the original source is moved/deleted. `DIMREASSOCIATE sourceId [secondSourceId]` replaces links with one compatible curve, or two intersecting lines for an angular dimension. The full selection is validated before one undoable edit. Detached radial/centre dimensions retain exact elliptical source snapshots after nonuniform transforms; a detached radial value measures the transformed centre-to-contour ray. DIMREASSOCIATE without arguments starts source picking, including a two-line angular reference; Escape cancels.

`DIMEDIT NEW "text"` replaces selected dimension labels without changing the measured geometry. Use `<>` to embed the live formatted measurement (symbols, tolerances and alternate units included), for example `DIMEDIT NEW "Opening: <>"`. `DIMEDIT HOME` restores automatic labels. The dimension properties panel exposes the same override field; inspection labels/rates remain around the result. Overrides persist through archive reload and undo/redo.

`DIMTEDIT` provides independent label placement with snapped point picking or POSITION/ANGLE/HOME input. `DIMEDIT ROTATE` changes label rotation; OBLIQUE sets the extension-line direction. `DIMSPACE` evenly spaces parallel linear or concentric angular dimensions; POINT offers interactive gap measurement, while AUTO derives spacing from text height. `DIMBREAK` accepts manual point intervals or AUTO intersection gaps, with shared model/print/SVG output and bounded obstacle processing.

`CENTERLINE [ALTERNATE]` creates an associative midline/bisector from two selected line segments or two source picks. Its properties and end grip control extension beyond source extents. `CENTERREASSOCIATE` accepts circle/arc sources for centre marks and paired line sources for centre lines, or starts interactive picking. `CENTERDISASSOCIATE` retains geometry as local snapshots; `CENTERRESET` restores default geometry settings and current dimension-style appearance. All support cancellation where interactive and one-step undo for completed edits.

### Shared creation and properties

Creation options and selected-object geometry share the right sidebar. Select one object
(or run `PROPERTIES`) to edit its supported geometry, layer and appearance; multiple
selection exposes common appearance fields. Compound objects use their position fields,
existing grips and transform commands. Leader text, arrow and landing settings are editable
there too. Paper annotations reuse these controls with millimetre labels; model values use
metres. Contextual options and point/value entry use the same draft and parser as the command
bar. Cancel/Escape discards an unfinished creation; property edits apply live and can be
undone. Continuous LINE entry remains active until cancelled. Rich text uses the shared
in-place editor with explicit apply/cancel.

### Annotation scales

The sidebar's annotation-scale section selects the model denominator independently of
screen zoom. Enable annotation on selected text, dimensions, hatches or blocks/leaders,
then add the scales needed by your layouts. A viewport shows the object's representation
only when its actual scale is listed; the model's show-all option helps inspect other
scales. Geometry edits synchronize the representations. `OBJECTSCALE OFFSET n x y`
adjusts one scale's position, `ANNORESET` clears offsets, and `ANNOUPDATE` rebases the
canonical representation. Dimension witnesses, hatch contours and leader arrow targets
remain attached to model geometry when their annotation appearance changes scale.

External `.lcad` drawings can be attached with `XATTACH` and managed with `XREF`.
Their cached geometry remains portable when source files are unavailable. `XCLIP`
clips native blocks/references, `XBIND` converts a reference to an ordinary block,
and `XCOMPARE` reports changes in the source. In the desktop application, `REFEDIT`
opens the source in the shared editor with faded host context; `REFSAVE` checks the
source revision before writing. Source writes are explicit and cannot be undone
from the host drawing. See [MCP.md](./MCP.md) for the command grammar.

## PDF underlays

`PDFATTACH ["path.pdf"] [PAGE n] [SCALE factor] [AT x y]` attaches a local page
in model space. Omitted path opens the native/browser picker; defaults are page 1,
physical paper scale and world origin. Coordinates are model metres. An absolute
path is supported by the native command/MCP entry point. The document embeds the
original PDF and a rendered cache, with native vector snapping and one undo step.

`PDFCLIP RECT x1 y1 x2 y2`, `PDFCLIP POLYGON x1 y1 …`, and `PDFCLIP ON|OFF|DELETE`
operate on one selected editable PDF reference. Clip coordinates use page-local
metres before the insertion transform. The shared block clip affects rendering,
selection and snaps.

`PDFLAYERS [LIST]` reports the selected underlay's optional-content groups in the
shared results panel. `PDFLAYERS ON|OFF "name or ID"` changes matching groups;
`*` targets all groups. It reparses embedded source bytes and updates cache/snaps
atomically, preserving insertion and cropping. One undo restores the prior view.
`PDFIMPORT GEOMETRY ["path.pdf"] [PAGE n] [SCALE factor] [AT x y]` imports
visible stroked paths as independent native lines/cubic splines on the active
editable layer. `PDFIMPORT GEOMETRY UNDERLAY` uses one selected PDF's embedded
page, current layer visibility, insertion transform and crop, retaining the source
reference. Exact curve intervals are preserved through PDF/page clipping. Colours
are retained; widths map to the nearest supported editor weight, dash arrays to
the editor's dashed style and transparency to its 0–90% range. Each import is one
undo step and the new geometry has no PDF-asset dependency.

The explicit GEOMETRY filter excludes fills, text and images. `PDFIMPORT TEXT`
accepts the same file/page/scale/placement or `UNDERLAY` arguments and imports
visible horizontal-font text as editable native text. Affine frames retain
baselines, rotation, reflection and shear; fitted widths retain each run's advance
with supported substitute font families. Original embedded fonts and exact glyph
kerning are not retained. Partially clipped text uses ordinary editable blocks
with polygon, cubic or compound clips; text entirely inside a convex polygon clip stays directly editable.
Glyph-based clips retain the available decoded font outlines and counters as native cubic contours. Type3/vertical fonts and missing glyph outlines are currently refused atomically. Invisible text is excluded. Geometry imports warn
when unsupported PDF effects are omitted. `PDFIMPORT FILLS` accepts the same source and placement arguments and creates
editable solid hatches with exact native line/cubic boundaries, implicit closing
edges and the PDF's even-odd/nonzero winding rule. It does not add outline strokes.
Selection and area/moment measurements follow the fill rule. Text and fill import
share bounded native polygon/curve/compound clipping, preserving partially clipped geometry in
editable blocks. Pattern paints and unsupported effects are reported rather than
being replaced with the previous solid colour. SHX stroke-to-text conversion is available through `PDFSHXTEXT`, described below.

`PDFIMPORT IMAGES` accepts the same file/page/placement or `UNDERLAY` arguments. It imports decoded PDF image objects as native images with embedded PNG assets, reusing identical images and preserving affine placement, pixel alpha and polygon/curve/compound clips. Images are decoded locally with bounded pixel and asset budgets. Solid-colour stencil masks retain the current PDF fill colour, inverse decoding and transparent pixels. Pattern-painted masks and unsupported graphics effects are omitted with a warning.

`PDFIMPORT` defaults to `ALL`; an explicit `ALL`, `GEOMETRY`, `TEXT`, `FILLS` or `IMAGES` category may precede the file/page/placement options or `UNDERLAY`. Combined import preserves original PDF painter order across categories and places a fill before its stroke. The entire import is committed once and undone once; unsupported text or clipping that prevents safe conversion rejects the whole operation.

`PDFSHXTEXT ["font.shx"|"font.shp"] HEIGHT cap-height-metres [ANGLE degrees] [THRESHOLD 80–100]`
recognizes selected imported model strokes using a matching local font. Omit the path to open a font picker.
Supply the known capital-letter height in drawing metres and baseline rotation in world coordinates (default 0°);
the default recognition threshold is 95. Classic SHX 1.0/1.1, Unicode SHX 1.0 and corresponding SHP sources are supported.
Complete glyphs are replaced with editable single-line text; compatible adjacent characters and gaps become text runs.
Baselines, rotation, fitted width, layer and colour are retained with a substitute technical font.
Review the recognized text: ambiguous identical outlines, incomplete glyphs, unmatched objects and locked objects are retained.
The font is decoded locally (4 MiB maximum) and is never embedded in the drawing. Recognition is bounded to 5,000 selected
objects, 200,000 sampled points and a shared work budget. Select a smaller area when the limit is reached.
BIGFONT/non-Unicode multibyte fonts, vertical text, and reflected/sheared recognition are unsupported.
One undo restores the original strokes; canceling font selection or a recognition error leaves the drawing unchanged.

### Geometric tolerance frames

`TOLERANCE position 0.02 DIAMETER MATERIAL M DATUM A DATUM B:L PROJECTED 10 IDENTIFIER C` starts insertion of a feature-control frame. Pick a model-space point or enter coordinates. The selection panel edits its characteristic, values, datum references, projection and style in one Apply operation. Escape cancels placement; undo restores each edit. `TOLERANCE EDIT flatness 0.05 DATUM A` replaces the selected frame's definition while preserving its placement.

A frame supports up to four rows, two tolerance values per row and three datum references per row. Use `SECOND value` for a second value and another characteristic/value pair for another row. Available characteristics are straightness, flatness, circularity, cylindricity, lineProfile, surfaceProfile, angularity, perpendicularity, parallelism, position, concentricity, symmetry, runout and totalRunout. `MATERIAL M|L|S` applies to the preceding value; `DATUM A:M` applies a material condition to a datum. Numeric labels retain entered decimal precision. PROJECTED is a positive numeric label; IDENTIFIER is an optional datum identifier. These are drawing annotations, not geometric constraints or a manufacturing-compliance check.

`TOLERANCE STYLE SET "Inspection" FONT 0.25 ROWHEIGHT 0.6 PADDING 0.1` defines a style in the shared table/tolerance style catalogue. LIST, DELETE and APPLY are available; `STYLE "Inspection"` in a creation command selects that snapshot. Catalogue changes do not retroactively modify existing frames. Move, rotate, scale, mirror, grips and clipboard preserve editability; EXPLODE produces independent native lines, ellipses and text.

### Driving dimensions and parameters

Use the **Parameters** sidebar in model space or BEDIT to create named distance/angle/number formulas, inspect dependencies, edit their expressions and select the affected objects. `PARAMETERS SET width distance "4m"` defines a parameter; select a line and run `DCALIGNED span "width * 2"` to drive its length. `DCLINEAR span "width" X` drives a projected distance. `DCANGULAR`, `DCRADIUS` and `DCDIAMETER` cover angles and circular sizes. Names share one formula graph; lengths use metres and angles degrees, with explicit unit suffixes supported.

`DCCONVERT` retains selected associative dimension annotations and uses their exact measurement as a driving expression. `DIMCONSTRAINT SET name "expression"` updates a driver; `DELETE SELECTED` removes drivers touching selected source objects or linked annotations while keeping their displayed geometry. Cycles, missing dependencies and conflicting constraints reject the complete edit. Every successful geometry/parameter update is one undo step. Archive loading validates definitions without silently solving stored geometry.

Copies carry complete relationships and independent formula names. BLOCK/PASTEBLOCK and BEDIT keep local graphs separate from model parameters; EXPLODE/XPLODE restore independent model catalogs. Transformations preserve prescribed values and reject incompatible copies. BCONVERT shares only compatible formula graphs, including their dependency structure, rather than comparing current values alone.


Recovery Manager history retains the twelve latest analysis summaries (source identity, timestamp, status and counts), without drawing geometry, assets or quarantine payloads. Desktop stores a versioned `recovery-history.json` in application data; browser uses `lumcad.recovery-history.v1` in local storage. The metadata file is limited to 256 KiB. `RECOVERYMANAGER HISTORY` displays these summaries; `RETRY n` re-reads and validates the source before preparing any candidate, while `REMOVE n` removes only the summary. Browser retries request a file again. Corrupt history is reported without overwriting it; history-save failure does not discard the current candidate.

Within a recovered batch, `RECOVERYMANAGER RELINK` updates the active recovered copy to the recorded saved dependency locations in one undo step. The Measurements panel exposes the same action and lists the changed paths. Reopening a candidate with a saved copy re-reads that copy to preserve saved edits; missing files or changed drawing identity fail explicitly. This updates paths only; use the reference reload workflow to refresh cached geometry.

Browser exports keep a download link visible until dismissed or replaced by another export, so a prepared file can be requested again. Native exports continue to use file dialogs and atomic writing. XLS reports and standards/sheet-set JSON delivery have been verified in the connected in-app browser from the downloaded files.

`WMFOUT [file.wmf] RASTER [WIDTH 64..4096] [BACKGROUND #RRGGBB]` explicitly exports a composited snapshot of the model scene, including partial transparency and gradients. The default is 2048 pixels wide on white; aspect ratio is preserved with a 4096-pixel side and 16-million-pixel ceiling. The WMF contains one opaque bitmap, with a localized warning that objects are no longer individually editable. Default WMFOUT remains vector output and never silently switches modes. Rendering reuses the editor scene and publication resource preparation, preserving pixel-space stroke weights and adapting image resolution. Bitmap SVGs use a pixel viewport and flatten neutral groups to avoid native small-coordinate rendering loss; compositing, clipping and referenced groups retain their boundaries.

Raster WMF framing includes non-scaling stroke cap/join margins. A requested width too small to contain those margins is rejected; increase `WIDTH` rather than accepting clipped output. Empty rendered scenes do not create a file.

`DGNATTACH [file.dgn] [UNIT mm|cm|m|km|in|ft|yd|us-ft] [AT x y] [SCALE factor]` attaches supported 2D V7 geometry as a portable vector reference. It retains the complete source bytes (25 MiB maximum), cached native geometry, nested blocks and source levels; geometry compatibility and fidelity warnings match DGNIMPORT. Omit the file for the native/browser picker. No external source is read automatically on load. Attachment validates archive limits before one history commit and rejects stale document contexts. `DGNCLIP ON|OFF|DELETE|RECT x1 y1 x2 y2|POLYGON x1 y1 x2 y2 x3 y3 [...]` edits one selected unlocked reference using the shared block clip; coordinates are local metres before attachment scale/translation. Source, metadata, placement, clips and cached geometry survive archives and clipboard remapping. DGN export and broader format support remain open.


### PNG, JPEG and SVG model export

`PNGOUT`, `JPGOUT` (or `JPEGOUT`) and `SVGOUT` export the visible model without changing the drawing or undo history. `EXPORT PNG|JPG|JPEG|SVG` accepts the same options. Run these commands in model space, outside block editing.

- `WIDTH 64..4096` sets the requested pixel width (default 2048); aspect ratio is retained within a 4096-pixel side limit, with margins for strokes.
- `BACKGROUND #RRGGBB|TRANSPARENT` chooses the background. PNG and SVG default to transparent; JPEG defaults to white and requires an opaque colour.
- JPEG additionally accepts `QUALITY 0.1..1` (default 0.92).
- `TO "absolute/path/file.png"` chooses a desktop destination with the corresponding extension (`.jpg` or `.jpeg` for JPEG). Without TO, desktop mode opens Save As and browser mode downloads the file with a retry link. Native writes validate format signatures and replace atomically; output is bounded to 64 MiB.

For example: `JPGOUT WIDTH 1600 BACKGROUND #ffffff QUALITY 0.9` or `EXPORT SVG WIDTH 2048 BACKGROUND TRANSPARENT`. SVG retains vector artwork and text, while images and cached underlay previews remain embedded raster content. Export uses the loaded scene; it does not refresh external references. A document/content change during preparation cancels stale output.

### Personal command aliases

Settings includes personal aliases with a command selector. `ALIASEDIT` opens these settings; `ALIASEDIT SET MYCOUNT COUNT` creates or replaces a personal alias and `ALIASEDIT REMOVE MYCOUNT` removes it. Aliases appear in command-bar suggestions and preserve command arguments (including quoted paths). They are application preferences, saved separately from drawings and their undo history. Built-in command names/aliases remain reserved; personal aliases must start with a letter and contain at most 32 letters, digits, underscores or hyphens. Browser preferences persist locally and desktop preferences use the native settings file.

Keyboard shortcuts can also be edited in Settings: change or remove an existing binding, add a binding to a catalog command, or restore defaults. `Mod` means Ctrl on Windows/Linux or Command on macOS; examples are `Mod+Shift+K` and `F6`. Duplicate combinations and reserved editing/system combinations are refused. Plain letters still enter commands, Escape cancels and Enter submits. Most drawing shortcuts are inactive in text fields and modal dialogs; text editing retains its standard shortcuts. Operating-system shortcuts may be intercepted before reaching the app. Preferences persist independently of the drawing; the displayed file/edit/drafting key hints follow the saved bindings.

### Clickable object links

Select one object and use **Selection → Object link** to enter an HTTP/HTTPS address and an optional label, apply or remove the link, or open its saved destination. `HYPERLINK SET "https://example.com/spec.pdf" "Technical sheet"` attaches the same link to the selected editable model objects; `HYPERLINK REMOVE` removes it and `HYPERLINK OPEN` opens the single selected object's link. `ATTACHURL` is an alias. Link edits support undo/redo and persist with the drawing, copy and clipboard. Linked pages/documents remain external; this does not embed office files or enable OLE.
