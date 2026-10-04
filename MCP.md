# LUMCAD MCP server

LUMCAD starts a local [Model Context Protocol](https://modelcontextprotocol.io/) server with the desktop application. Any MCP-compatible AI harness running on the same machine can inspect and edit the drawing that is currently open in LUMCAD.

## Connection

- Transport: Streamable HTTP
- Preferred endpoint: `http://127.0.0.1:43622/mcp`
- Preferred health endpoint: `http://127.0.0.1:43622/health`
- MCP protocol: `2026-07-28`, with compatibility for older clients supported by the official Rust SDK
- Lifetime: the server starts with LUMCAD and stops with it

LUMCAD must be open and its drawing window must have finished loading before tools that access the active document can run. `get_commands` remains self-contained, but document tools return a clear error while the window is unavailable.

Open **LUMCAD → Settings…** on macOS, or use the gear button in the Windows/Linux header, to see and copy the active endpoint. The preferred port can be changed there without restarting LUMCAD.

If the preferred port is already occupied, LUMCAD automatically tries the next available local ports and ultimately lets the operating system select a free port. The settings view then displays the endpoint that is actually running and explains that a fallback occurred. This also lets multiple LUMCAD instances start without a port conflict.

Most Streamable HTTP clients accept a configuration equivalent to the following. Replace the URL with the active endpoint shown in Settings if LUMCAD selected a fallback port:

```json
{
  "mcpServers": {
    "lumcad": {
      "type": "http",
      "url": "http://127.0.0.1:43622/mcp"
    }
  }
}
```

Some clients infer the transport and only expect the `url` property. Use the client's Streamable HTTP or remote HTTP MCP option; do not configure LUMCAD as an SSE or stdio server.

For development and managed deployments, `LUMCAD_MCP_PORT` overrides the saved preferred port for that process:

```bash
LUMCAD_MCP_PORT=43623 npm run tauri dev
```

The override still benefits from automatic fallback and must be reflected in the AI harness URL. For normal use, prefer the Settings view so the preference is persisted on the machine.

## Security model

The server binds exclusively to `127.0.0.1`; it is never exposed on the LAN. Requests without an `Origin` header are accepted for native MCP clients. Requests with an `Origin` header are accepted only from `localhost`, `127.0.0.1`, `::1`, or the Tauri origin, as required to prevent DNS-rebinding attacks.

There is no bearer token in version 0.1. Any process running in the same user session can control the active drawing, just as it can generally access that user's local files. Do not forward the MCP port, publish it through a tunnel, or bind it through a proxy.

## Recommended agent workflow

1. Call `get_state` before making changes.
2. Read entity IDs, layers, units, the current selection, and active command from the result.
3. Call `get_commands` when command semantics or aliases are needed.
4. Use `execute_command` for a complete command or to start an interactive command.
5. Use `interact` to continue a command that is already active.
6. Call `get_state` again to verify the resulting geometry.

All drawing coordinates and distances are expressed in metres.

## Tools

### `get_state`

Returns the complete active document plus editor state:

- `.lcad` document fields and drawing content;
- every layer and entity, including stable entity IDs;
- current file path and recovery state;
- current selection;
- active tool and interactive operation;
- latest command message, model viewport, active model/paper workspace, active and selected layouts, selected/maximized layout viewport, and undo/redo availability.

This is the safest starting point for every agent operation.

### `get_commands`

Returns all commands from the same manifest used by LUMCAD's command bar. Each entry includes:

- canonical internal command ID, such as `radiusDimension`;
- full English command, such as `RADIUS`;
- short alias, such as `DRA`;
- accepted alternative aliases;
- a concise MCP usage description.

The result also lists the MCP tool registry.

### `execute_command`

Starts any existing LUMCAD command. It accepts:

| Field | Type | Purpose |
| --- | --- | --- |
| `command` | string | Internal ID, full English name, or alias from `get_commands` |
| `input` | string, optional | Text appended to the initial command, such as an offset distance |
| `selection` | string[], optional | Entity IDs replacing the current selection before activation |
| `actions` | action[], optional | Ordered interactions executed after activation |

Example — draw two connected five-metre segments and finish the line command:

```json
{
  "command": "line",
  "actions": [
    { "type": "point", "x": 0, "y": 0 },
    { "type": "point", "x": 5, "y": 0 },
    { "type": "point", "x": 5, "y": 5 },
    { "type": "escape" }
  ]
}
```

Example — offset two known entities by one metre toward the upper side:

```json
{
  "command": "offset",
  "input": "1",
  "selection": ["line-123", "rectangle-456"],
  "actions": [
    { "type": "point", "x": 4, "y": -2 }
  ]
}
```

Selection-driven annotation commands such as `QDIM`, `DIMBASELINE`, `DIMCONTINUE`, and `CENTERMARK` can complete in one call. `QDIM` accepts `CONTINUOUS` or `BASELINE`, while a baseline accepts `FIRST` or `LAST` to choose its editable reference end. Interactive `TEXT`, `MTEXT`, and dimension variants accept the same ordered point actions as the canvas. Layout commands (`LAYOUT`, `PAGESETUP`, `PSETUPIN`, `PSETOUT`, `MODEL`, `PSPACE`, `MVIEW`, `VPCLIP`, `VPLAYER`, `VPMAX`, and `VPMIN`) share the command-bar implementation; commands that open native file dialogs still require the user or a desktop-automation harness to finish that dialog.

Publishing commands use the same renderer and ordered layout selection as the interface. `PLOT`/`-PLOT`, `PDF`/`EXPORTPDF`, `PDFALL`, `PDFSELECTED`, `PUBLISH`, and `DWFXOUT` open the in-application publication preview; saving the resulting PDF or DWFx then uses a native destination dialog. `AUTOPUBLISH` is the unattended variant: it requires a saved `.lcad` path and atomically writes every layout to the adjacent `.pdf` file before the MCP request returns.

### `interact`

Continues the currently active command without restarting it. This is useful when an agent deliberately works in several MCP calls, inspecting state between stages.

```json
{
  "actions": [
    { "type": "input", "value": "90" },
    { "type": "enter" }
  ]
}
```

### `replace_document`

Merges a supplied LUMCAD document object into the active document and normalizes its layers, entities, text styles, settings, metadata, layouts, page setups, and embedded assets. The replacement is added to undo history and is picked up by autosave. MCP exchanges the hydrated in-memory document; persistence converts embedded image data URLs into separate files inside the ZIP-based `.lcad` container described in [LCAD_FORMAT.md](./LCAD_FORMAT.md).

Use `get_state` first, preserve fields you do not intend to change, and prefer regular commands for localized edits. This tool is intended for AI-generated drawings or large deterministic transformations.

## Actions

`execute_command.actions` and `interact.actions` support:

### Point

```json
{
  "type": "point",
  "x": 12.5,
  "y": 4,
  "targetId": "circle-123",
  "snap": true,
  "shift": false
}
```

- `x` and `y` are required finite coordinates. Model-space drawing commands use metres; `MVIEW` and other paper-space point stages use millimetres on the active layout sheet.
- `targetId` identifies the hit entity for target-based operations such as trim/extend, break, lengthen, fillet/chamfer/blend, selection, and associative dimensions.
- `snap: true` applies the active LUMCAD object-snap settings to the supplied point.
- `shift: true` temporarily swaps `TRIM` with `EXTEND` during their target/fence stage. For other point stages it temporarily inverts persistent Ortho mode, matching the UI whenever the active command has a reference point. Use `ORTHO`, `POLAR`, and `OTRACK` to change the persisted drafting modes; `POLAR` also accepts an increment followed by optional additional angles.

### Input

```json
{ "type": "input", "value": "5" }
```

Sends text through the same quick command parser as the floating command bar. It can provide distances, angles, factors, coordinates, and operation options.

When the active stage requests a model-space point, the shared precision parser accepts:

- `x,y` for an absolute point (`#x,y` makes the absolute intent explicit);
- `@x,y` for a Cartesian offset from the preceding reference point;
- `@distance<angle` for a polar offset;
- a distance or expression, such as `2500mm` or `span / 2`, along the current pointer direction.

Arithmetic expressions support parentheses, common metric and imperial length suffixes, and case-insensitive variables assigned with `CAL name = expression` or `QUICKCALC name = expression`. Unitless model-space values are metres; unitless layout point values are paper millimetres, and explicit suffixes are converted to the active space. In the French interface, use `;` both between coordinate components containing decimal commas (`12,5;4,25`) and between function arguments (`min(2,5;1,25)`).

### Enter

```json
{ "type": "enter" }
```

Confirms the current stage. Like the UI, Enter retains the previous default value where a command supports it.

### Escape

```json
{ "type": "escape" }
```

Cancels the current command and clears the selection.

## Native-dialog commands

`SAVEAS`, `OPEN`, and `PSETOUT` intentionally open native system dialogs, just as they do from the interface. Plot and publish commands first open LUMCAD's preview/configuration dialog; PDF and DWFx destination selection is native only after the user confirms that preview. `PDFSELECTED` uses the layout tabs selected through Cmd/Ctrl-click, in their current document order. The MCP call activates an interactive dialog but cannot choose a destination on the user's behalf. Use `AUTOPUBLISH` when a saved drawing must publish without any dialog. Regular drawing persistence is handled continuously by autosave.

## Tests and command coverage

The command registry lives in `src/mcp/commands.json`. Both the command bar and the Rust MCP server consume this file.

Run the dedicated checks with:

```bash
npm run test:mcp
```

They verify that:

- the MCP manifest and editor command registry contain exactly the same commands;
- command IDs, names, and aliases are unique and resolvable;
- every command has MCP usage guidance;
- frontend MCP actions are validated and executed in order;
- the Rust registry is complete;
- Origin validation rejects non-local websites;
- an occupied preferred port automatically falls back to a free localhost port;
- a real temporary Streamable HTTP server negotiates with an official MCP client;
- `tools/list` exposes the complete MCP tool registry;
- `get_commands` returns the shared command catalog.

The Streamable HTTP integration test opens a temporary localhost port. Environments that sandbox local networking must explicitly allow localhost sockets for that test.

An optional smoke test also connects to a real, already-running LUMCAD window, reads its state, draws a temporary line through MCP, verifies it, and undoes the edit:

```bash
cargo test --manifest-path src-tauri/Cargo.toml running_lumcad_app_answers_and_edits -- --ignored
```

When using a non-default port, set `LUMCAD_MCP_ENDPOINT` for the smoke test.

The full project validation also includes these checks:

```bash
npm run check
```

When adding a new LUMCAD command, add it to `src/mcp/commands.json`. The frontend and MCP server then receive it together, and the parity tests prevent a partial implementation.

### Rectangular array interaction

`ARRAY` uses the current selection, or requests one, then immediately enters `array-edit` with automatic spacing and default counts. Use `XSPACING 3`, `YSPACING 2`, `COLUMNS 4`, `ROWS 3`, or `BASE 0,0` through command input to adjust the preview. Submit empty input to commit once, or cancel to discard. The old sequential base/spacing/count prompts are no longer used.

`ARRAYRECT` is an alias for `ARRAY`. `ARRAYEDIT` takes a selection containing one existing rectangular array and opens the same controls, including after document reload or a geometric transform. `ARRAYCLOSE` (or empty input) commits the preview. Escape discards it. The edited entity keeps its ID and occupies the same position in the drawing order.

### Polar array interaction

`ARRAYPOLAR` (`ARP`) uses the selected motif, then requests its center (point action or coordinate input). A six-item full-turn preview follows. Adjust `COUNT 8`, `ANGLE -180`, `ROTATEITEMS 0` (fixed motif orientation) or `CENTER 0,0`, then send `ARRAYCLOSE` or empty input. `ARRAYEDIT` also reopens polar definitions. Count is bounded to 1–100, and angle to nonzero −360°…360°. Full turns omit a duplicate final item; partial turns include both ends. All changes remain previews until commit and can be cancelled with Escape.

### Path array interaction

`ARRAYPATH` (`ARPATH`) first uses the motif selection, then requests a distinct connected path. Send a point action with the source `targetId`. `COUNT 6` divides its length into six stations; `SPACING 2` instead fills it at two-metre intervals. `OFFSET`, `ALIGNITEMS 0/1`, `REVERSE`, `BASE x,y`, and `PATH` adjust the preview. Enter/`ARRAYCLOSE` commits and `ARRAYEDIT` reopens it. Closed paths omit duplicate end stations. At most 100 instances are generated.

Editing the source path (for example with `LENGTHEN`) updates the linked array in the same undo step. Moving only the array detaches its live source; the stored snapshot and parameters stay editable. To reattach, use `ARRAYEDIT`, `PATH`, and a point targeting the new source. `EXPLODE` is the explicit route to independent instance geometry.

### Construction lines

`XLINE` (`XL`) and `RAY` each accept an origin and a distinct direction point through the normal point actions or typed coordinates. Two points commit one persistent entity; Escape discards an unfinished definition. A further pair creates another entity. Their IDs, layer and appearance follow ordinary drawing entities, and transforms, offset, clipboard and undo/redo retain their unbounded type. The second point defines direction, not an endpoint. `XLINE` extends both ways; `RAY` extends only forward. Selection may target their IDs or visible geometry anywhere along them.

### Ellipse creation

`ELLIPSE` (`EL`) supports `AXIS` (default), `CENTER`, `ARC`, and `CENTERARC`. AXIS takes two axis endpoints and then a point setting the perpendicular radius; CENTER takes a centre, an axis endpoint and the perpendicular-radius point. ARC and CENTERARC add start and end direction points, projected onto the ellipse. `CW` and `CCW` set the sweep without changing the chosen construction mode. An ellipse requires three points, an elliptical arc five; unfinished construction cancels without changing document content. Each completed curve is a native `ellipse` entity and one undo step. `CREATIONPANEL` reopens its common geometry editor. The second radius is the perpendicular distance to the first axis, not the distance from the centre to an arbitrary third point.

`DIM` on an ellipse creates an aligned, associative axis-diameter dimension; the picked point chooses the nearest axis endpoint pair. `DIMALIGNED`, `DIMLINEAR` and `DIMROTATED` accept an ellipse selection and dimension its local X axis, using the selected measurement/projection mode. To dimension its other axis, use a `DIM` point action near that axis with the ellipse `targetId`. These dimensions follow edits to the ellipse and retain source references through archive reload and clipboard remapping. Circular-radius commands do not apply to ellipses.

`DIMARC` also accepts open elliptical arcs, by selection or a point action with `targetId`. The persisted `arcLengthDimension` refers to the source ellipse. Its value is the integrated source-curve length and updates after source edits; changing the annotation offset does not change the measured value. Full ellipses are excluded from this arc-length command. The position grip changes the annotation's normal offset; an inward offset reaching the minimum curvature radius is rejected rather than drawing a singular parallel curve.

### Ellipse offsets

`OFFSET` accepts full ellipses and elliptical arcs with the existing distance/side, `THROUGH`, source-retention and destination-layer controls. A result is a closed or open compound `polyline` containing native cubic spline parts, approximating the true normal parallel with a 0.00001 m target tolerance. It is independent of the original ellipse. `THROUGH` requires a point on a normal within the source arc domain; points beyond an open endpoint along its tangent are rejected. Inward offsets that reach a curvature singularity and offsets exceeding the fitting/coordinate limits leave the document unchanged. Preview, commit, cancellation and undo/redo use the standard offset workflow.

### Spline creation

`execute_command` with `SPLINE` starts the same interactive creation as the toolbar. Send `FIT` (default) or `CONTROL`/`CV` as an input action, then point actions. FIT needs at least two points; CONTROL needs four. An `enter` action or input `DONE` commits the picked points without appending the cursor position. Incomplete input leaves the preview active; `escape` discards it. Creation is bounded to 128 points and commits once to history. The output is a native cubic spline or compound cubic path, with a persistent fit-point/control-vertex definition and normalized parameter/knot vector.

`SPLINEDIT` requires one selected native cubic or all-cubic path (excluding associative arrays). With no input it opens the shared coordinate editor. Input `CONTROL span control x y` edits one control in world metres; span and control indices start at 1, with controls 1–4 per span. Connected joints and existing smooth tangent ratios are maintained. Invalid spans, invalid coordinates or locked entities leave the drawing unchanged; successful edits use one undo step. `POINT index x y` edits a definition point and `KNOT index value` edits a parameter/knot in [0, 1], retaining its mode. All indices start at 1. Invalid ordering or multiplicity leaves the drawing unchanged. `BEZIER` removes the definition without changing the shape; CONTROL edits also detach it. Undo restores the definition.

`SPLINEDIT TANGENT START dx dy` and `TANGENT END dx dy` set the derivative in metres per normalized parameter. FIT persists the boundary constraint and supports `TANGENT START NATURAL` / `TANGENT END NATURAL` to remove it. CONTROL moves the adjacent control vertex using the knot interval. Zero, nonfinite and oversized derivatives are rejected without editing. The expanded shared panel exposes the same endpoint/vector controls.

`INSERT index x y` adds a definition point before the one-based index (count + 1 appends); `REMOVE index` deletes one. Both rebuild chord FIT / uniform CONTROL parameters and may change shape. `INSERTKNOT value` refines CONTROL exactly, up to internal multiplicity 3. `CONTROL` with no arguments converts connected open cubic spans to an exact clamped control definition. `FIT` refits through native span endpoints or open point-polyline vertices and may change shape. `POLYLINE tolerance` produces straight segments within a tolerance in metres (minimum 1e-8), using bounded adaptive subdivision. Definition edits/conversions are capped at 128 points, polyline conversion at 4096 vertices and depth 20; failure is atomic. Entity IDs and appearance remain stable and undo restores the prior representation.

### Hatches and fills

`HATCH` / `SOLID` / `GRADIENT` create one hatch from selected closed curves or unbranched closed chains (512 native parts maximum); selected loops define even-odd islands. HATCH input accepts `SOLID`, `LINES spacing angle`, `CROSS spacing angle`, `GRADIENT #rrggbb angle`, or `RADIAL #rrggbb`. With no selection, or input prefixed with `PICK`, the command enters an interior-point stage. Send a `point` action or an `input` action with `x,y`; pattern options can be changed before the pick. Escape cancels. Picks use raw coordinates and visible finite curves. Native intersections preserve exact curve boundaries; containment sampling uses 0.00001 m tolerance. The bounded detector rejects edge picks, open areas, duplicate overlaps and excessive complexity (256 input pieces, 2048 edges, 200000 intersection checks, 32768 samples).

`HATCHEDIT` with one selected hatch opens the shared panel or applies the same pattern input, `ORIGIN x y`, or `DETACH`. Spacing/origin use metres; pattern spacing is at least 0.02 m. Gradient start colour follows entity/ByLayer colour. Source edits refresh the hatch in the same undo step; independent geometry edits detach it. `HATCHTOBACK` reorders selected hatches, or all editable hatches when none are selected, in one undo step. Locked objects cannot be edited.

`BOUNDARY` (`BO`, `BPOLY`, `-BOUNDARY`) asks for an interior point (click or `x,y`). It creates independent closed native polylines for the outer contour and immediate islands on the current visible, unlocked layer. Source objects remain unchanged. Detection uses the same finite-curve geometry and complexity limits as HATCH PICK; ambiguous picks remain pending, Escape cancels, and one undo removes all contours from a pick.

`REGION` (`REG`) creates one independent planar region from selected closed curves or unbranched closed chains, preserving its sources. With no selection, or `REGION PICK`, click an interior point or enter `x,y`. Native outer and island loops form an even-odd area rendered as outlines; selection inside a hole does not select the region. A single centre grip moves all loops together. Standard transforms, clipboard, archive reload and `EXPLODE` retain native curves. The pick detector shares BOUNDARY limits; creation is one undo step. Boolean region operations and region mass-property inquiry are separate capabilities.

`IMAGEADJUST` (`IAD`) opens the shared editor for one unlocked reference image. Options: `BRIGHTNESS 0..200`, `CONTRAST 0..200` (neutral 100), `MONO ON/OFF`, `RESET`. Each edit is undoable and affects only that instance. Original embedded image bytes remain unchanged. The SVG renderer/clipboard use sRGB transfer filters; PDF preparation bakes the same transfer into image pixels before vector output. Existing opacity and include-in-PDF controls continue to apply.

`IMAGECLIP` (`ICL`) opens the same image editor. Its rectangular crop fields use percentages. Command options use fractions of the unrotated image (0–1): `RECT x1 y1 x2 y2`, `POLYGON x y …` (3–128 vertices), `ON`, `OFF`, `DELETE`. Self-crossing, empty and out-of-image contours are rejected. OFF preserves the contour; DELETE removes it. Crop follows image transforms, restricts visible selection/snapping, and is retained by archive, clipboard SVG and shared model/layout/print rendering. Edits preserve source image bytes and use undo history.

`DRAWORDER` (`DR`) reorders selected editable model objects: `FRONT` (default), `BACK`, `FORWARD`, `BACKWARD`, `ABOVE`, `BELOW`. ABOVE/BELOW then ask for another visible object; MCP can supply a point action with `targetId`. Relative order remains stable. `TEXTTOFRONT` (`TF`) accepts `TEXT`, `DIMENSIONS`, or `ALL` (default) and moves editable annotations. `HATCHTOBACK` uses the same ordering logic. Effective changes use one undo step and persist in the entity sequence.

`WIPEOUT` (`WI`) creates a white mask from one selected simple straight-edged closed contour, preserving the source. With no selection or `POINTS`, click/type 3–128 vertices, then Enter or `DONE`; `UNDO` removes the last vertex and Escape discards the preview. `FRAME ON/OFF` changes selected masks; the shared editor offers the same frame control. Frame visibility applies on screen and in print. Masks use normal draw order, transforms, grips, clipboard and archive persistence. Self-crossing or curved contours are rejected.

`IMAGEADJUST KEY #rrggbb [tolerance]` makes an image colour transparent; `KEY OFF` disables it. The shared editor exposes the colour and tolerance (0–100%, default exact match). A pixel is keyed only when each original RGB channel is within `floor(255 × tolerance / 100)` of the chosen colour. Keying precedes brightness/contrast/monochrome and preserves nonmatching alpha. PDF preparation keys original pixels before downsampling and uses PNG for keyed images, including JPEG sources; keyed source processing is bounded to 64 million pixels. Original assets remain unchanged.

### Linked image files

`IMAGEATTACH` accepts an absolute local image path in `input` (spaces and optional surrounding quotes are supported). `IMAGE LINK path` / `RELINK path`, `IMAGE RELOAD` and `IMAGE EMBED` operate on one selected unlocked image. Native reads are bounded to 25 MiB/64 megapixels and retain an embedded snapshot; missing/invalid sources leave document content unchanged. Without a path, attach/link/relink opens a native dialog requiring completion. `IMAGE`/`CLASSICIMAGE` without input opens the shared source/adjustment/crop panel. `CLIP` aliases `IMAGECLIP`. `TRANSPARENCY value` sets a 0–90 percent override on the unlocked selection.

Source reads occur only through explicit commands, never from `replace_document`, archive opening or rendering. As with document paths, these commands are available to trusted local clients under the localhost security model; no new network transport is introduced. Inspect `editor.message` and the image's `assetId`/`imageSource` after execution to distinguish a successful reload from a retained snapshot following an error.

### Named block creation and insertion

`BLOCK` input is `"name" [baseX baseY] [KEEP] [REDEFINE]` with a selected set of editable source objects. Without a base point, continue with a point action or coordinate input. Default creation converts sources to a reference; `KEEP` leaves them in place. All local dependencies are included and conversion that breaks outside associations is refused. `REDEFINE` preserves definition IDs and refreshes derived bounds; recursive containment is rejected.

`INSERT` input is `"name" [x y [scale [angleDegrees]]]`; the scale is positive and uniform. Without coordinates, `SCALE value` and `ROTATION degrees` update the preview, then a point action commits. Names are case-insensitive and quoted when containing spaces. `-BLOCK`, `-INSERT` and `CLASSICINSERT` are aliases. `BSEARCH [text]` opens/filters the block palette. Inspect `editor.message`, `editor.interactiveOperation`, `document.content.blocks` and resulting references to verify success. Each completed operation has one undo step.

### Block edit sessions

`BEDIT [nameOrId]` opens a local-coordinate draft; without input it uses one selected unlocked reference. `get_state.document` remains the saved model throughout the session. Inspect `editor.blockEdit.content` and `editor.blockEdit.assets` for the active draft, plus `blockId`, `name` and `dirty`. Selection IDs and drawing actions target draft children while this object is non-null. `UNDO`/`REDO` are local to that draft.

`BSAVE` validates dependencies/cycles, adopts resources and updates the named definition and all reference bounds in one model-history commit, then starts a fresh local undo baseline. `BCLOSE SAVE` (default) saves and returns to model space; `BCLOSE DISCARD` returns without applying changes since the latest save. Failed validation keeps the editor open and the saved model intact. `replace_document`, layout selection and file/session replacement are refused until closure. Escape only cancels the active drawing command. Autosave always persists `document`, not the unpublished draft.

`BASE` accepts `input: "x y"`, or no input followed by a `point` action. The result is available at `document.content.metadata.basePoint`; geometry is unchanged. Undo/redo apply normally, Escape cancels pending input, and the command is refused while BEDIT is open.

`WBLOCK` accepts a quoted definition name/ID, `LIBRARY`, or `SELECTION`, optionally followed by `TO "/absolute/library.lcad"`; omitting the destination opens Save As. `BLOCKIMPORT` accepts an optional source path and merges definitions without model placement. `INSERT FILE /absolute/library.lcad` imports and begins point placement; supply a subsequent point action to place the first entry. Import and insertion have separate history steps. No command changes the active document path; failures leave its contents unchanged.

Block attributes use `ATTDEF` with `TAG "default" x y` and optional `HEIGHT`, `PROMPT`, `CONSTANT`, `INVISIBLE` options. `ATTEDIT` receives selected reference IDs and `TAG "value"`; `ATTSYNC` accepts a block name/ID or the selected references’ definitions; `ATTDISP` accepts NORMAL/ALL/OFF. Read instance values in `document.content.entities[].attributeValues` and definition metadata in block text children. The current BEDIT draft remains in `editor.blockEdit.content`. Each command commits one history edit; constants, missing tags, duplicate definitions and locked selections are refused without partial updates.

`BATTMAN` accepts `"block name" TAG TAG|PROMPT|DEFAULT "value"`, `CONSTANT|INVISIBLE ON|OFF`, or `UP|DOWN|DELETE`. No input opens the Blocks palette. Definition edits are atomic and undoable; tag migration includes nested and locked instances to preserve their values. Existing variable values survive default changes; constants refresh. Invalid tags, duplicates and broken dependencies are rejected. The command is unavailable inside BEDIT.

`ATTEXT` accepts `[CSV|JSON] [ALL|SELECTED] [TO "absolute path.csv/json"]`. Use an absolute native output path for unattended execution; selected scope uses the supplied selection IDs and includes their nested instances. JSON contains `{version:1, units:"m", records:[{path,blockId,blockName,layerId,x,y,attributes}]}`. CSV uses fixed metadata columns followed by sorted `Attribute:TAG` columns, UTF-8 BOM and CRLF records. Formula-like strings receive an apostrophe prefix; JSON values remain exact. The export is read-only with respect to drawing/history and includes hidden/locked/invisible attributes. Native output validates extension/size and uses atomic replacement.

During interactive INSERT, an input action `ATTRIBUTE TAG "value"` sets an insertion value before the point action. Unknown or constant tags are refused. This updates the pending preview without history; the final placement commits geometry and values together. ATTDEF without input opens the shared definition form.

`DIMSTYLE` supports SAVE/CURRENT/APPLY/DELETE with a quoted name, and SET with TEXT/ARROWSIZE/GAP/OVERRUN/ARROW/PRECISION/PREFIX/SUFFIX and a value. Format options also include TOLERANCE, TOLUPPER, TOLLOWER, TOLPRECISION, ALTERNATE, ALTUNIT, ALTPRECISION, INSPECTION, INSPECTLABEL and INSPECTRATE; the shared command catalog specifies their values and limits. APPLY requires unlocked dimension selection; other actions operate on the named catalog. Style updates affect linked model and nested dimensions while preserving overrides; CURRENT seeds subsequent creation through the shared history path. Every mutation is undoable. BEDIT must be closed.

`DIMSTYLE RENAME "old" "new"` renames without changing the style ID. With no arguments DIMSTYLE opens the styles sidebar. Sidebar edits share the command validation/history path.

Dimension maintenance: `DIMUPDATE` accepts an optional quoted style name/ID and requires dimension selection; `DIMREGEN` accepts no input and defaults to all editable model dimensions when selection is empty; `DIMINSPECT` requires selection and `ON ["label" ["rate"]]` or `OFF`. Invalid or locked selections fail atomically. UPDATE resets overrides; REGEN retains them; INSPECT stores an inspection format override. Each successful operation is one history edit.

`DIMDISASSOCIATE` accepts no input and requires unlocked dimension selection. `DIMREASSOCIATE` takes one source entity ID, or two line IDs for angular dimensions, and validates compatibility for every selected dimension. Standalone radial/arc-length/centre dimensions expose bounded `detachedSource` geometry; reassociation removes it. Both commands retain IDs/styles and support undo.

`DIMEDIT` requires selected unlocked dimensions and `NEW "text"` or `HOME`. `<>` placeholders expand from the current measurement at render/export time. `dimensionTextOverride` is stored on the entity (not in the named style), bounded to 16,384 characters; HOME removes it. Geometry and associations remain unchanged.

`DIMSPACE POINT [BASE dimensionId]` offers a snapped point pick with live preview. It measures perpendicular distance to the base line or radial distance to the base arc; coordinate input, numeric spacing and AUTO finish the stage. Escape cancels. Legacy unstyled dimension copies retain complete appearance snapshots as overrides when the history path assigns the current style.

`replace_document` normalizes imported content without assigning the current dimension style to unstyled imported entities. It remains undoable. This differs from normal interactive creation, which uses the current style.

Centre-mark maintenance: `CENTERDISASSOCIATE` detaches selected unlocked centre marks, preserving native source snapshots. `CENTERREASSOCIATE` accepts a circle/arc source ID or starts an interactive source pick when input is empty; point actions use `targetId`, and Escape cancels. `CENTERRESET` restores default size/extension and current dimension-style appearance while retaining association or snapshot. Reset/detach take no arguments; mixed or locked selections fail atomically, and successful edits are undoable. Centreline creation is tracked separately in the roadmap.

`CENTERLINE` uses two selected line segments or starts source picks for missing selections. MCP point actions identify each source with `targetId`; an invalid or repeated source leaves the stage active, and Escape cancels. Optional `ALTERNATE` selects the other angle bisector. Creation commits once after both valid sources exist. CENTERREASSOCIATE supports two line sources for centre lines; CENTERRESET restores their default extension and primary bisector.
