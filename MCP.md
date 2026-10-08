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

### Point creation and interval placement

`POINT` activates one-point creation; follow it with a point action or typed coordinates. `DDPTYPE circle-cross 0.25` sets the default symbol/size and updates selected editable points, or all editable model points when the selection is empty. Individual points expose the same style and coordinate controls in Properties. The canonical `POINT` token is used because `PO` is already assigned to `PASTEORIG`.

`DIVIDE 4` with one source ID in `selection` creates three equally spaced points on an open path. `MEASURE 2.5 REVERSE` starts from the other end and uses physical arc length in metres. Without preselection, send a point action with the source `targetId`; without initial parameters, send an input action after that pick. `BLOCK "Marker" ALIGN ON SCALE 2` places ordinary block insertions instead of points. Alignment follows the source tangent (the outgoing segment at corners). Counts are bounded to 10000 placements; disconnected paths and unbounded construction lines are rejected. Sources are retained, failures are atomic, Escape cancels pending input, and Undo removes the whole batch.

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

### Named selection groups

`GROUP "name"` creates a drawing-local group from the supplied selection; `GROUP LIST` reports names and member counts. `GROUPEDIT "name" ADD|REMOVE` edits membership from the current selection, `RENAME "new name"` renames it, `ON|OFF` controls collective picking, and `SELECT` selects visible members. `UNGROUP "name"` removes the group only; without a name it removes groups touching the selection. Group commands are disabled inside BEDIT. Canvas point actions and window selection expand selectable overlapping groups, while an explicit MCP selection remains exact for membership editing.

### Property and layer transfer

`MATCHPROP` copies layer and explicit/ByLayer colour, line weight, line type and transparency from a picked source to the preselection. Without preselection, pick the source then a target. An optional source entity ID skips the first pick. `LAYMCH` uses the same workflow for layer only. `LAYMCUR` makes the selected/picked source layer current. `COPYTOLAYER "layer name"` duplicates the selection in place with independent IDs and remapped copied dependencies. Hidden/locked destination layers and locked targets are protected. Each successful operation is one undo step; Escape cancels unfinished picking.

### Named model views

`VIEW SAVE "name"` saves or updates the current model extent. `VIEW RESTORE "name"` / `VIEWGO "name"` restores it; `VIEW LIST`, `VIEW RENAME "name" "new name"` and `VIEW DELETE "name"` manage the persistent catalog. `VIEW IMPORT` opens the existing native/browser `.lcad` chooser and imports its catalog without replacing drawing contents. These commands require model space and are unavailable within BEDIT.

### Temporary object visibility

`HIDEOBJECTS` hides the selected model objects and `ISOLATEOBJECTS` hides the others, accumulating earlier temporary hides. `UNISOLATEOBJECTS` clears this session state without changing layer visibility. Hidden objects are excluded from model rendering, picking, group expansion, snaps, boundary detection and zoom extents. The transient state is reported as `editor.hiddenObjectIds`; it is excluded from document history, archives, layouts and publication. Explicit MCP selection skips temporarily hidden objects.

### Measurement and inquiry

`DIST` / `MEASUREGEOM DISTANCE`, `MEASUREGEOM ANGLE` (vertex second), and `ID` accept snapped/typed point actions; DIST and ID also accept complete space-separated numeric coordinates in their initial input. `AREA` measures selected closed objects or polygon points finished by Enter/DONE. During interactive picking, use the normal coordinate grammar (`x,y`, `x;y`, relative/polar expressions). `MEASUREGEOM RADIUS` and `LENGTH`/`PERIMETER` inspect selected or picked native curves; `MASSPROP` reports area, centroid and centroidal planar moments at unit density. Regions/hatches respect even-odd islands. Intersecting, degenerate or excessive contours are rejected; native Green-integral quadrature computes areas/moments while bounded 0.01 mm sampling determines loop nesting.

`MEASUREGEOM ADD`/`SUBTRACT` accumulates the selected areas (arithmetic sums, not Boolean unions), `RESET` clears the accumulator, and `COPY` copies the result. `LIST [ALL]` reports selected/all visible entity data; `STATUS` reports drawing counts. Results appear in the shared Measurements sidebar panel and `editor.inquiryResult`; they do not create geometry or undo entries. The panel includes localized values, units, full structured data and a copy button.

### Selection queries and counts

`QSELECT TYPE line LAYER "name" COLOR != #ff0000 WEIGHT >= 1` replaces selection with visible objects matching every predicate. TYPE/LAYER/COLOR/LINETYPE/WEIGHT/TRANSPARENCY/BLOCK/LOCKED are supported, using effective ByLayer appearance. `FILTER SAVE "name" predicates`, `APPLY "name"`, `DELETE "name"` and `LIST` manage a persistent predicate catalog. `SELECTSIMILAR [fields...]` matches any selected source, defaulting to TYPE/LAYER/BLOCK.

`SELECTCOUNT`, `COUNT [ALL]`, `COUNTAREA` (two corners or x1 y1 x2 y2) and `BCOUNT [ALL]` report grouped totals and select/highlight the counted objects. BCOUNT includes nested occurrences with inherited layers and bounded graph traversal. `COUNT TABLE x y` inserts the most recent report as a static editable table in a selectable group, limited to 200 rows, in one history entry. The Measurements panel and `editor.inquiryResult` expose rows and totals. Selection query commands are model-space tools and require closing BEDIT first.

`COUNT DUPLICATES [ALL] [NESTED] [TOLERANCE metres]` is a read-only model-root diagnosis (current selection, or visible objects when empty; ALL forces visible objects). Default tolerance is 0.000001 m, bounded to 0..1 m. It compares supported native curves/point polylines/compound paths using the shared cleanup equivalence rules, and same-definition block instances with identical linear transforms/state and nearby insertion points. Layers, locks and appearance do not suppress suspect matches. Point positions ignore marker styles. Rectangle/polygon outlines reuse closed-path comparison. Even-odd hatch/region boundaries retain holes. Text/image candidates require matching content or asset state and corresponding frame corners within tolerance; mirrored images remain distinct. Generated/special entities (including nonzero-filled paths) use exact semantic geometry/definition signatures, retaining dependency references; `exactOnlyIds` explicitly identifies this stricter comparison. Connected matching pairs form suspect groups; tolerance is not transitive, so not every pair within a group necessarily matches. `editor.inquiryResult` exposes mode `countDuplicates`, groups of root IDs, matching pair count, tolerance, examined count and `unsupportedIds`. Suspect roots are selected; no geometry is removed and no history entry is added. Unsupported geometry is explicitly reported, not counted as verified. Work-limit exhaustion rejects the whole report. `COUNT DUPLICATES NEXT|PREVIOUS|GROUP n` selects and centers one suspect group, with wrapping next/previous navigation and one-based explicit group numbers. The report exposes zero-based `activeGroup` and the currently highlighted `selectedIds`. The Measurements panel offers the same navigation. Navigation refuses stale reports after drawing changes; rerun diagnosis first. NESTED expands evaluated ordinary blocks (up to 10,000 visited objects and 32 nesting levels), compares geometry in model coordinates and retains occurrence paths. `groups` then contains JSON-encoded path IDs; `occurrencePaths`, `groupRootIds` and `groupBounds` preserve navigation identity and geometry. Selection targets containing model roots while the view centers matching subgeometry. Cycles/missing definitions and exhausted budgets reject the entire diagnosis. `unsupportedPaths` explicitly lists clipped/underlay/external interiors omitted from traversal. Root-only mode remains the default. Linked quantity tables are documented below.

### Leaders

`MLEADER` (also `LEADER`/`QLEADER`) accepts text or `BLOCK "name"`, followed by point actions for the arrow and bends, `DONE`, then a content anchor. `UNDO` removes the last pending point; Escape cancels. `MLEADEREDIT TEXT`, `BLOCK`, `ADD` (two picked points) and `REMOVE index` edit one selected leader. `MLEADERALIGN X|Y [gap]` aligns selected content anchors while retaining arrow points; `MLEADERCOLLECT [gap]` collects contents and branches. `MLEADERSTYLE SAVE "name" textSize arrowSize landingLength closed|open|none`, `USE`, `APPLY`, `DELETE`, `LIST` manage persistent presets. All dimensions are metres. Geometry commits are atomic and undoable; generated definitions require MLEADEREDIT or EXPLODE rather than BEDIT.

### Advanced layers

`LAYERSTATE LIST|SAVE|RESTORE|DELETE` and `LAYERSTATESAVE "name"` manage bounded persistent states. `LAYISO` and `LAYWALK` accept layer names (or current selection layers); `LAYUNISO`/`LAYWALK END` restore the first captured session state. `LAYMRG sources… target` and `LAYTRANS source target …` atomically remap document layers, rejecting protected system sources and locked layers. `LAYER "name" FREEZE|NEWVPFREEZE|PLOT|LOCK|VISIBLE ON|OFF` controls flags. `LAYERFILTER` sets the shared panel’s session name/flag filter; an empty input clears it. Changes except filtering participate in undo/redo.

### Plot-style mappings

`STYLESMANAGER` opens the reusable style panel. `PLOTSTYLE SAVE "name" sourceColor|- outputColor|- weight|- screening lineType|-` defines a rule; `APPLY "name"`, `LAYER "layer" "name"`, `DELETE` and `LIST` manage assignments/catalogs. `CONVERTPSTYLES COLOR|NAMED|OFF` changes publication mode; `CONVERTCTB` assigns matching drawing-native colour rules as named styles. This is not binary CTB import. Model colours are preserved. Output profiles and field-based plot stamps use the normal PLOT/PAGESETUP preview, persistence and publication workflow.

### Units and 2D UCS

`UNITS` accepts option/value pairs for display and alternate units, precisions, angle format/base/direction and insertion metadata. `UCS SET x y degrees`, `WORLD`, `SAVE/RESTORE/DELETE "name"`, `LIST` manage frames; `UCSMAN` is an alias. Typed coordinates passed through command input follow the current UCS, while MCP point actions are always world coordinates. `ID` reports local coordinates and retains `world` and `coordinateSystem` in its structured result. `UCSICON ON|OFF` toggles the orientation indicator, which stays in the lower-left corner during pan and zoom and follows UCS rotation. Its screen position does not mark the drawing origin. `LIMITS minX minY maxX maxY` enables checked world bounds; `LIMITS ON|OFF` toggles them. All geometry remains metres; `UNITS DISPLAY` changes inquiry presentation rather than numeric document geometry.

### Paper annotation commands

In an active paper layout, `LINE`, `RECTANGLE`/`RECTANG`, `TEXT` and `MTEXT` create native paper annotations through two point actions or typed coordinates. Values use paper millimetres, independently of model UCS/units. Text commands optionally accept initial text. `MOVE` acts on the selected paper annotation using two points; `TEXTEDIT` opens the shared rich editor. One paper annotation may be selected by its ID in the active layout, and state selection reports its ID. Escape cancels preview without inserting geometry; deletion and document undo/redo use existing history. Snap-enabled points include visible clipped/rotated viewport geometry.

### Annotation scales and shared properties

`PROPERTIES` is an alias of `CREATIONPANEL`; single-object geometry and multiple-object
appearance editing use the shared sidebar. Paper fields reuse the controls with mm labels.
`OBJECTSCALE ON|OFF|ADD n|DELETE n|OFFSET n x y|LIST` operates atomically on editable
selected text, dimensions, hatches and block references (including leaders). OFF keeps
the current representation's appearance. `SCALELISTEDIT LIST|ADD n|DELETE n|RESET|CURRENT n|ALLVISIBLE ON/OFF`
manages the denominator catalog/model context; viewport contexts always use their actual
scale and normal scale-list visibility. Deleting the final object representation or a
used/current catalog denominator is rejected. `ANNOUPDATE` rebases selected annotation
geometry to the current denominator; ordinary edits already synchronize representations.
`ANNORESET` resets their position offsets. All changes participate in document undo.
MCP model geometry/picking uses the same resolved context as pointer input, while saved
`.lcad` geometry remains canonical. Catalogue and expansion limits are in LCAD_FORMAT.md.


### External drawing references

`XREF`/`EXTERNALREFERENCES` reports cached references in `editor.inquiryResult`.
`XATTACH [ATTACH|OVERLAY] ["path.lcad" [worldX worldY]]` attaches a native drawing;
omitted paths open the shared file picker. `XREF RELOAD|UNLOAD|DETACH|BIND [id]`
uses the selected reference when the ID is omitted. `PATH id ["path"]` relinks;
`MODE id ATTACH|OVERLAY` changes nesting; `SELECT id` can recover a hidden or
unloaded insertion for management. Locked insertion layers refuse edits.

`XCLIP RECT x1 y1 x2 y2`, `POLYGON x1 y1 ...`, `ON`, `OFF` and `DELETE` use
definition-local metres on one selected block/reference. `XBIND [id]` keeps the
cached native block and clip while removing its external link.

`REFEDIT [id]` reads a native linked source into an independent editor draft.
`editor.blockEdit.referenceSource` exposes its path/revision/reference ID;
`editor.blockEdit.content` exposes the editable source geometry. The host is shown
faded in source coordinates. `REFSAVE` or `REFCLOSE SAVE` explicitly writes the
source with optimistic revision validation, then reloads the host cache.
`REFCLOSE DISCARD` discards only the unsaved draft. A changed source refuses save
and leaves the draft open. Host undo cannot undo an external source-file write.

`XCOMPARE [id ["path"]]` reports added, removed and changed source entity IDs and
resource changes in the shared result panel/`editor.inquiryResult`, without
committing a drawing edit. Reloads follow attached nested paths within documented
limits, skip overlays, retain missing-source caches and refuse cycles.


### Model/paper viewport alignment

`CHSPACE ["viewport name"|viewportId] ["layout name"|layoutId]` transfers selected
model objects to paper, or the selected paper annotation to model, depending on
the current workspace. Omitted arguments use the active layout and selected or
sole viewport. A paper selection must belong to the active layout. The viewport
may remain locked because its view does not change. Native block containers keep
curves and dependencies editable; returning a transfer container restores its
native objects. Annotation appearance is frozen at that viewport scale. The
command refuses locked selections and dependencies left dangling in model space;
one undo restores both spaces. Transferred paper blocks use the shared annotation
selector, properties, grips and move workflow.

`ALIGNSPACE` requires one selected unlocked viewport in the active layout. Numeric
input is `modelX1 modelY1 modelX2 modelY2 paperX1 paperY1 paperX2 paperY2`: model
coordinates in metres, paper coordinates in millimetres. The command solves uniform
scale, rotation and translation while retaining the frame, clipping and layer
overrides. Empty input starts four point actions, all expressed in paper mm: first
two displayed model features in that viewport, then their two paper targets. Pointer
picks use paper/model snaps. Escape cancels; a valid fourth point commits one undo
step. Coincident pairs, locked viewports and excessive scales are refused.

`EXPORTLAYOUT ["layout name"|layoutId]` exports the specified layout, or the active
layout when input is omitted, through the normal save dialog/browser download.
Each viewport becomes a clipped native block with its current rotation, annotation
representation and layer appearance. Paper annotations become native geometry;
paper millimetres are converted to model metres. The new drawing is independent
of linked sources and retains editable definitions. Export does not switch the
active document or create a document-history step. Native export refuses to replace
the active file and preserves its recovery archive.

### PDF underlays

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


Linework commands in P2 development: `DONUT inner outer` then centre point actions; `MLINE [STYLE "name"] [SCALE factor] [JUSTIFY zero|top|bottom]` then vertex point actions and input `END`/`CLOSE` (`UNDO` removes the last vertex). `MLSTYLE` manages named style snapshots with LIST, SET and DELETE; `MLEDIT` edits selected linework parameters atomically. The shared command catalogue documents the full grammar. `ML` retains its existing MLEADER meaning. Native point actions and undo restoration have been verified; broader linework UI/interoperability validation is still in progress.

`PLINE [startWidth endWidth]` starts a straight variable-width path. Point actions append vertices; `WIDTH start end` changes the next segment, `UNDO` removes the last vertex, and `END`/`CLOSE` commits. Widths are metres (0–1000000); zero width retains thin line segments. `ARC signed-angle-degrees` sets the next circular sweep (absolute value 0.001–359); `LINE` restores straight segments. The definition retains its circular parameters; wide boundaries use bounded 0.1 mm interpolation and reject collapsed inner radii.

`SKETCH [incrementMetres] [POLYLINE|LINES]` records distance-resampled freehand strokes (default 0.01 m). Mouse drag/release commits; MCP point actions accumulate a stroke and input RECORD/END commits. An empty Enter ends the command; Escape discards uncommitted samples. Each stroke is one history entry, max 8192 points. The output uses ordinary native line/polyline entities.

`REVCLOUD [RECT|POLYGON|OBJECT] [arcLength] [REVERSE]` creates native arc clouds from two rectangle corners, polygon vertices followed by END/CLOSE, or one selected/picked closed source. OBJECT retains the source ID. `REVCLOUDPROPERTIES arcLength [NORMAL|REVERSE]` updates selected clouds atomically. `BREAKLINE [size [extension]]` takes two endpoints; size, extension and fractional break position are editable in the shared property panel. Source-based grips and ordinary transforms retain definitions; creation and edits are undoable.


### Editable tables and CSV

`TABLE` / `-TABLE rows columns [rowHeight columnWidth]` starts placement of an editable table. The default is 3 × 3 cells, with 0.6 m rows and 2 m columns. Point actions place the table; Escape cancels without committing. `TABLE CSV [DELIMITER COMMA|SEMICOLON|TAB] [FROM "absolute/path.csv"]` loads a UTF-8 CSV snapshot before the same placement interaction. Without FROM, use the native/browser file picker. Limits: 4 MiB, 256 rows, 64 columns, 4096 cells, 4096 characters per cell; malformed quoting and invalid UTF-8 are rejected.

`TABLEDIT` operates on one selected editable table: `CELL A1 "value or =formula"`, `MERGE A1 B2`, `UNMERGE A1`, `ROWHEIGHT row metres`, `COLWIDTH column metres`. Formulas support A1 references, arithmetic, and SUM/AVERAGE/MIN/MAX/COUNT ranges, with explicit dependency and cycle errors. Merging preserves covered values. All edits commit once and undo normally.

`TABLESTYLE LIST`, `SET "name"` with FONT/PADDING/ROWHEIGHT/COLWIDTH/LINEWEIGHT/HEADERS/COLOR/GRIDCOLOR/ALIGN/BOLD options, `APPLY "name"`, and `DELETE "name"` manage up to 128 named snapshots. Applying a style changes the selected table; catalogue changes do not retroactively change existing tables. Standard cannot be deleted.

`TABLEEXPORT [VALUES|FORMULAS] [DELIMITER COMMA|SEMICOLON|TAB] [TO "absolute/path.csv"]` exports one selected table, including a locked table, without editing it. Default output contains calculated values, comma-separated, UTF-8 with BOM. FORMULAS retains expression sources. Covered merged values are included. Desktop exports use atomic file replacement; browser exports download table.csv and refuse explicit filesystem paths. Dialog cancellation leaves the drawing unchanged.


`TABLEDIT FORMAT A1 [FONT metres] [PADDING metres] [COLOR #rrggbb] [ALIGN left|center|right] [BOLD ON|OFF]` adds cell-level overrides; `FORMAT A1 RESET` resumes inheritance from the table style. These controls are also exposed in the cell editor. Unspecified properties continue following the table style, including after named-style changes. SVG interchange reuses the text layout for wrapping, alignment, clipping and run formatting.

`DATALINK LIST` lists table CSV sources. `DATALINK ATTACH [FROM "absolute/path.csv"] [DELIMITER COMMA|SEMICOLON|TAB]` reads a CSV into one selected editable table and records its source. `DATALINK DETACH` removes source metadata from selected tables while preserving cached values and geometry. `DATALINKUPDATE` refreshes selected linked tables; `DATALINKUPDATE ALL` refreshes all model-space linked tables. Every target must be editable. Reads are grouped by source; all must succeed before a single history commit. Cancellation, invalid/missing files or a changed document abort the batch. Refresh replaces values, preserves placement and cell formatting at surviving addresses, retains existing row/column sizes, uses style defaults for growth, and removes merges that no longer fit. Native source paths are persistent; browser sources prompt for file selection again. Loading a drawing or pasting a table never reads an external source automatically. Source CSV files are not modified by these commands.


### Linked fields

`FIELD` attaches a declarative field to one selected text entity. With no selection in model space, it starts text placement (point action, typed coordinates, live preview, Escape). In paper space, create/select a text annotation first; FIELD preserves its frame and formatting. Supported sources:

- `META projectName`: a scalar drawing metadata key (including numeric custom keys).
- `DOCUMENT name`, `DOCUMENT createdAt`, `DOCUMENT updatedAt`.
- `OBJECT "entity-id" length|perimeter|area|radius|diameter|width|height|x|y|type|layer|text`. Geometry uses existing inquiry utilities; x/y are bounds minima, widths/heights are bounds extents, and distances are metres. Unsupported measurements display an error.
- `CELL "table-id" B1`: a calculated value from a table, including one refreshed from a linked CSV. Run DATALINKUPDATE before UPDATEFIELD to reread the file.
- `REF "field-text-id"`: another field’s raw value, usable in formulas even when its display has a prefix/suffix.
- `DATE iso|datetime|year|dmy|mdy`: one UTC timestamp shared by an update batch.
- `PAGE number|count|name [LAYOUT "layout-id"]`: one-based document layout numbering. Paper text uses its containing layout by default; model PAGE insertion binds the active layout. Numbering follows the document’s layout order, not a temporary publishing subset.
- `FORMULA "length * rate" BIND length "OBJECT line-id length" BIND rate "META rate"`: bounded arithmetic using the existing calculator. BIND sources use the same grammar; up to 32 bindings per expression and eight nested definition levels. No JavaScript execution or arbitrary object-property access.

Optional `PREFIX "text"`, `SUFFIX "text"`, and `PRECISION 0..8` control display. `FIELD SHOW` reports the selected definition; `FIELD REMOVE` detaches it while preserving the displayed text. `UPDATEFIELD ALL` (default) updates model and paper field text in one undo step; `UPDATEFIELD SELECTED` updates selected field text in the current workspace. Locked/uneditable targets reject the batch. Unchanged values do not create a new history entry. Sources are reevaluated explicitly through UPDATEFIELD; archives, clipboard and publication retain cached text and never reread external files implicitly. Missing references, nonnumeric operands, invalid formulas and dependency cycles display `#REF!`, `#VALUE!`, `#FORMULA!` or `#CYCLE!`.

Copying a field includes its model-source dependency closure and remaps field references to the copied IDs, including formula bindings. Deleting a source does not cascade-delete its field text: UPDATEFIELD exposes the missing reference. Fields in block definitions are not created by FIELD; close BEDIT to use these commands.

### Geometric tolerance commands

`TOLERANCE <characteristic> <value> [DIAMETER] [MATERIAL M|L|S] [SECOND value ...] [DATUM A[:M|L|S] ...] [<characteristic> <value> ...] [PROJECTED height] [IDENTIFIER A] [STYLE "name"]` starts model-space insertion. Complete it with a point action or typed coordinates; Escape cancels without creating an entity. Limits are four rows, two values and three datums per row. Characteristics: straightness, flatness, circularity, cylindricity, lineProfile, surfaceProfile, angularity, perpendicularity, parallelism, position, concentricity, symmetry, runout, totalRunout.

`TOLERANCE EDIT <definition>` requires exactly one editable frame, retaining its ID, affine placement and style unless explicitly replaced. `TOLERANCE STYLE LIST|SET|DELETE` shares TABLESTYLE's named catalogue and options; `TOLERANCE STYLE APPLY "name"` applies a snapshot to one selected frame. Close BEDIT and use model space for these commands. Invalid definitions or locked targets leave the drawing unchanged. Each successful edit is one undo operation. EXPLODE preserves independent native symbol and text geometry.

### Dynamic block parameters and actions (P2 in progress)

Inside BEDIT, `BPARAMETER SET name distance|angle|number default [MIN n] [MAX n] [STEP n]` adds or replaces a numeric parameter. Point syntax is `SET name point x y`; flip is `SET name flip ON|OFF`; choice is `SET name choice "default" "choice 1" "choice 2" ...`. DELETE name refuses parameters still used by actions; LIST reports the draft definition. The isolated draft participates in local undo and only updates model instances on BSAVE/BCLOSE SAVE. Saving refuses definitions whose targets were deleted without removing their actions.

Select local source objects, then use `BACTION SET id MOVE parameter dx dy`, `STRETCH parameter dx dy minX minY maxX maxY`, `ROTATE|SCALE parameter originX originY`, `FLIP parameter originX originY axisEndX axisEndY`, or `ARRAY parameter offsetX offsetY`. Point-parameter MOVE/STRETCH omit direction dx/dy. DELETE id removes an action; LIST reports the draft. Action types and parameter types must agree, and all targets must exist.

Outside BEDIT, select one dynamic instance and use `BPARAMETER SET name value` (point: x y; flip: ON/OFF; choice: quoted label). Invalid values and directly edited lookup-driven outputs are rejected. `RESETBLOCK` resets selected dynamic instances to definition defaults in one atomic undoable operation; locked or invalid targets refuse the whole batch. IDs, placement and attributes remain unchanged. The instance selection panel provides typed fields with explicit Apply and Reset. Lookup/visibility authoring is available as described below; smart detection/replacement commands are described below.

`BLOOKUPTABLE SET "table" selector "choice" output value [output value ...]` adds or updates a variant row in BEDIT. BTABLE accepts the same authoring syntax. Selectors are choice parameters; output values use their declared types (point: x y; flip: ON/OFF). Every choice receives a row; newly added columns initialize other rows from parameter defaults. DELETE "table" removes a lookup and LIST reports the definition. Cycles, multiple tables writing the same output and invalid values reject the edit. Outside BEDIT, `BTABLE APPLY "table" "choice"` updates one selected instance through the selector.

`BVSTATE SET selector "choice"` assigns the current local selection as the visible membership of that state. An empty selection creates an empty state; other states initially contain all local entities. DELETE removes the visibility mapping; LIST reports it. Change the selector on an instance to switch states. BEDIT's Block variants tab exposes row editing and visibility membership using the same atomic command operations.

The BEDIT Block variants tab also exposes collapsible parameter/action editors. Parameter types, defaults, bounds, increments and choice lists use the same validation as BPARAMETER. Action fields adapt to the selected type; existing targets are retained when editing unless “Use current selection as targets” is enabled. Save parameter/action updates the isolated draft, then Save and close applies it to the model. Referenced parameters cannot be deleted before dependent actions/tables are removed.


### Repeated motifs and block replacement

In model space outside BEDIT, select the native objects composing a motif and run `BLOCKDETECT` (`BDETECT`). Detection reports disjoint occurrences including the selection without editing the document. It compares geometry, appearance and metadata after translation; line, arc and point-polyline anchors (including rectangle/polygon outlines) also support rotation and uniform scaling; circles support scale matching. Both sides use the shared affine representation, so a transformed rectangle can match its polyline representation. Locked objects and dependency-bearing sources are excluded. Detection is bounded to 128 selected objects, 10,000 model objects and a comparison budget; exceeding a limit produces an error rather than a partial match list.

`BCONVERT "new block name"` recomputes the matches and converts them into instances of one new definition in a single history commit. At least two occurrences are required. Conversion preserves placement and painter order, maps complete groups to their new references, and rejects interleaved drawing order, partial groups or dependencies on the replaced source IDs. Undo restores the original objects and groups.

`BLOCKREPLACE "existing block name"` (`BREPLACE`) changes the definition of selected native block references atomically. It preserves reference IDs and transforms, matches attributes by tag and recovers compatible dynamic parameter values. Locked references, external references, PDF underlays, leaders and model/paper transfer containers reject the selection. Detection/conversion and definition replacement are distinct operations; neither runs automatically on opening a drawing.

The Blocks palette shares these operations: select a motif, Detect repeated motifs, enter a New block name, then Convert repeated motifs to blocks. Each definition also offers Replace block instances for the current selection. Detection counts are invalidated by content or selection changes.


### Geometric constraint authoring (P2 integration in progress)

`GEOMCONSTRAINT type [references]` creates a persistent relationship in model space or the active BEDIT draft. Types are `coincident`, `collinear`, `concentric`, `equal`, `fix`, `horizontal`, `parallel`, `perpendicular`, `symmetric`, `tangent`, `vertical` and `smooth`. Their dedicated `GC…` commands accept the same references without the type token, for example `GCHORIZONTAL`, `GCCOINCIDENT` and `GCSMOOTH`. Authoring solves the affected component before one history commit; an invalid selection or unsuccessful solve applies no partial relationship or geometry.

Without explicit references, the current selection supplies whole objects. Explicit targets are an entity ID or a one-based selection index; append `@point` for a named grip and `@part:point` for a zero-based native outline segment endpoint. Examples:

- Select one line, then `GCHORIZONTAL`.
- Select two curves, then `GCCOINCIDENT 1@end 2@start`.
- `GCFIX 1@start` snapshots a point; bare `GCFIX` snapshots each selected whole object.
- `GCPERPENDICULAR 1 2` relates two selected lines.
- `GCHORIZONTAL 1@0:` relates the first outline segment of a selected rectangle or point polyline.
- `GCSMOOTH 1@end 2@start` enforces endpoint position, tangent direction and intrinsic G2 curvature.
- `GCTANGENT 1 2 INTERNAL` requests internal circular tangency (`EXTERNAL` is the default).

`GEOMCONSTRAINT LIST` returns the current catalog without editing. `GEOMCONSTRAINT DELETE id`, `DELETE SELECTED` (all relationships touching selected objects) and `DELETE ALL` remove relationships without moving geometry, in one undo entry. Object deletion removes its relationships through the same history path. Later geometry edits keep their explicitly changed scalar coordinates as drivers and solve the affected connected component. Conflicting edits retain the previous drawing and undo/redo stacks and display a rejection message. Whole-document replacement preserves a validated snapshot, as documented in LCAD_FORMAT.md.

`AUTOCONSTRAIN [PREVIEW] [TOLERANCE metres] [ANGLE degrees] [TYPES comma-list]` detects nearby relations on the current selection. PREVIEW reports candidate definitions as JSON without solving or changing content. Otherwise the whole proposal list is solved and committed atomically. The default distance tolerance is 0.0001 m and angle tolerance is 0.1°; both must be positive, with maxima of 1 m and 10°. TYPES filters `coincident,horizontal,vertical,collinear,concentric,parallel,perpendicular,tangent,smooth,equal`. Fixing and symmetry remain explicit GC commands. Detection includes endpoint joins, axes, circular centers/radii and finite line/circle tangency; it excludes remote line extensions. Existing definitions are retained and identical proposals are skipped. Detection is bounded to 64 objects, 128 curve parts and 256 total relationships; unsuccessful solving or exceeded limits produce no partial changes. Example: `AUTOCONSTRAIN PREVIEW TYPES horizontal,vertical,coincident TOLERANCE 0.001`.

Clipboard transfer preserves complete relationships and translated fixation snapshots, including local catalogs in PASTEBLOCK definitions. BEDIT enforces and preserves definition constraints and accepts the same GC/AUTOCONSTRAIN authoring commands. Mixed native paths and fit/control spline definitions accept segment and definition-point selectors (for example `1@0:start` and `1@spline-point-0`). Their existing joins, knots and definition modes are retained. BPARAMETER instance edits enforce definition-local constraints, including hidden members, before committing the selected batch. Changed coordinates act as drivers; connected geometry follows or the complete edit is rejected. Dynamic arrays retain complete internal relationships and translated fixation targets with deterministic IDs (256 relations maximum). Native propagation, RESETBLOCK, fixed-conflict refusal and undo/redo are verified. BCONVERT transfers matching internal constraint catalogs into the shared local definition, remaps relation IDs and translates fixation snapshots. Catalog matching transforms saved fixation targets and maps horizontal/vertical axes through quarter-turn rotations; incompatible directions, differing catalogs and relations crossing occurrence boundaries reject conversion atomically. Model relationships transferred into the definition are removed in the same history entry. EXPLODE/XPLODE transfer complete visible block-local catalogs into world coordinates with independent IDs, including recursive instances and evaluated dynamic arrays. Unsupported transformed relations and catalog overflow reject the whole operation with a localized constraint error. Primitive topology changes with existing constraints are refused. Constraint references support native points, lines, circles/arcs, ellipses, rectangles, regular polygons, cubic/mixed polylines and fit/control splines. Polygon centre/vertex/edge references preserve native regularity; side-count or construction-mode changes reject while constrained. Generated objects require native geometry from EXPLODE; annotation and text/image affine-frame variables are unsupported.

The Geometric constraints sidebar uses the same command engine. It offers all twelve relation types, selected-object/point/segment reference pickers, internal tangency, a filtered relation list with satisfaction status, related-object selection and removal. The automatic section exposes distance/angle tolerances and relation-type filters, previews proposed relations and applies them in one undo entry. Changing selection or content invalidates the preview. Point/segment labels share the canvas grip translations.

BLOCK preserves complete internal geometric constraints in its local definition. Conversion refuses constraints crossing the selected/dependency boundary; include the other targets or use KEEP. KEEP copies complete relationships and preserves all source model relations. Undo/redo covers geometry and both catalogs together.

COPY and COPYTOLAYER preserve complete internal geometric relationships with new IDs. COPY translates saved fixation targets with the objects; COPYTOLAYER preserves them in place. Both refuse invalid or over-budget constraint catalogs atomically. Relationships to unselected objects remain only on the originals.

ROTATE/SCALE in COPY mode and MIRROR copy retain compatible internal constraints and transform saved fixation targets. Axis constraints remain global: for example, rotating a horizontally constrained line by 30° in COPY mode refuses the operation, without removing the constraint or moving the originals. A refusal leaves the active operation available for correction or Escape.


## Driving dimensions and named parameters

`PARAMETERS LIST` (or `PARAMETERS` alone) reports the model parameter/dimension graph and evaluated values. `PARAMETERS SET name number|distance|angle "expression"` creates or updates a parameter. `PARAMETERS DELETE name` removes it only when no remaining formula requires it. Names are case-insensitive, and shared with named driving dimensions; constants `pi` and `e` are reserved. A successful update solves affected geometry and forms one undo entry. Cycles, invalid formulas, unknown names and conflicting constraints leave the drawing unchanged.

`DCALIGNED name "expression" [references]`, `DCRADIUS name "expression" [references]`, `DCDIAMETER name "expression" [references]` and `DCANGULAR name "expression" [references]` create named driving relationships. `DCLINEAR name "expression" X|Y [references]` creates a projected distance with the initial direction retained. Omitted references use selected whole objects; explicit references share GC syntax (`1`, `entityId`, `1@start`, `1@0:end`). Linear/aligned accepts one native line/segment or two explicit points. Radius/diameter targets a circle or circular arc. Angular uses two directed lines, in reference order, with targets between 0 and 360 degrees excluding endpoints. Lengths use metres; angular values use degrees; explicit unit suffixes are supported.

`DIMCONSTRAINT linear|aligned|angular|radius|diameter name "expression" [X|Y for linear] [references]` is the generic creation form. `DIMCONSTRAINT LIST` reports definitions and values. `DIMCONSTRAINT SET name|id "expression"` modifies a driving expression. `DIMCONSTRAINT DELETE name|id|SELECTED|ALL` removes definitions without moving geometry, unless a remaining formula would lose a dependency. Parameter/dimension names may reference each other in formulas, for example `width * 2` or `d1 + 25cm`.

These commands operate in model space and ordinary BEDIT drafts; REFEDIT must be closed. Limits: 128 graph definitions, 64 dependency depth, 512 characters per formula, 256 combined geometric/dimensional relationships, bounded shared solver. The Parameters sidebar uses the same command utilities to create/edit/delete named formulas and driving dimensions, display evaluated values/dependencies, select related geometry and convert associative annotations. COPY/COPYTOLAYER preserve complete dimensional relationships with independently renamed formula dependencies; linked annotations travel with their source geometry. Clipboard paste uses the same transfer helpers. BLOCK/PASTEBLOCK carry local formula graphs; BEDIT saves them independently of model parameters. EXPLODE/XPLODE restore independent model catalogs. Transformed copies preserve prescribed values, map compatible projected axes and reject incompatible geometry without reshaping the copy. BCONVERT accepts compatible occurrences whose dimensional graphs match after identifier remapping, including dependency sharing. Equal current values alone are insufficient: formulas and unit-significant syntax must match. Cross-boundary relationships and incompatible prescribed geometry reject atomically.


`DCCONVERT [prefix]` converts selected associative linear, radial and angular annotations to named driving definitions while retaining their presentation. The default prefix is `d`; unique suffixes produce names such as `d1`, `d2`. A custom prefix must be an ASCII identifier of at most 50 characters. Initial expressions use the actual measurement in metres/degrees, including rotated projections, reflex angles and circular-arc angular measurements. Use `DIMCONSTRAINT SET name "expression"` afterwards to drive the geometry. Repeating conversion skips existing links. One detached, unsupported or locked annotation rejects the complete batch. Available in model space and ordinary BEDIT drafts, with REFEDIT closed; conversion and subsequent edits share ordinary undo/redo.

## Point-polyline editing

`PEDIT` (`PE`) opens the shared vertex panel for one selected editable ordinary point polyline. `VERTEX index x y`, `INSERT index x y` (before the index; count+1 appends), `REMOVE index`, `OPEN`, `CLOSE` and `REVERSE` edit it in one undo step. Indices start at one; coordinates use world metres. Open paths require two vertices, closed paths three; the limit is 8192. Consecutive coincident points, invalid coordinates and incompatible constrained topology reject. Generated linework uses MLEDIT and cubic paths use SPLINEDIT.

TABLEDIT and MLEDIT without arguments open the existing shared property editor for one selected editable table or linework object. Argument-based edits retain their existing batch and undo semantics. Locked objects, incorrect selections and paper-space invocation are refused.

PEDIT also accepts connected native-curve polylines: `SPLIT segment parameter` (one-based segment, parameter strictly between 0 and 1), `REVERSE`, `CLOSE`, and `OPEN`. Subdivision preserves exact line, circular arc, elliptical arc and cubic definitions and per-part appearance. CLOSE adds a straight closing segment when endpoints differ; OPEN creates a seam at the first vertex without removing geometry. Native paths are bounded to 4096 parts. The shared panel offers segment selection and subdivision at parameter 0.5. Vertex insertion/removal/coordinate commands remain specific to point polylines; spline controls retain SPLINEDIT.

The MLEDIT shared panel exposes local vertex coordinates and open/close for multiline and wide paths, using the same validated edits as command input. Closure maintains segment-width and bulge counts. Donuts retain their diameter fields.

### Cleanup preview and application

`OVERKILL [ALL] [PREVIEW] [TOLERANCE metres] [MERGE ON|OFF]` cleans the current model selection unless ALL is explicit. The default tolerance is 1e-9 m (range 0..1), merging enabled. PREVIEW returns the same count report without a history change. Applying a proposal creates one undo entry. Exact duplicate objects, reversed/tolerance-equivalent lines and point polylines, degenerate line/point paths and continuous collinear line unions are supported. Distinct metadata/appearance never compare approximately. Generated, locked and referenced identities remain protected; dash-pattern lines are not merged. Exceeding 250000 comparisons rejects the entire proposal. The editor message reports duplicates, degenerate objects, merges and protected objects.

OVERKILL curve equivalence also recognizes reversed circular/elliptical/cubic primitives and closed point/native paths with shifted starting vertices. Native curve types and survivor geometry remain unchanged. Minor and complementary major arcs stay distinct even when endpoints are within tolerance. Nested sequence comparisons count toward the same atomic work limit.

`PURGE` and `-PURGE` accept `[ALL|BLOCKS|LAYERS|STYLES] [PREVIEW]`. The default scope is ALL. Reachability includes model and paper-space entities, nested blocks, active/default resources and saved layer-state references. Unselected resource catalogs remain roots, so LAYERS alone retains layers used by unused but unpurged blocks. Removable catalogs are blocks, layers, text styles, dimension styles, multiline styles, table styles and leader styles. Binary assets remain available for undo; plot-style mappings are retained. PREVIEW reports counts without mutation. Application uses one history commit; close BEDIT/REFEDIT first. Traversal is bounded to 500000 visits and fails atomically.

`FLATTEN [ALL] [PREVIEW]` projects selected native geometry onto XY by zeroing optional residual `z`, `z1`, `z2`, `cz`, `elevation` and `thickness` data. It traverses native compound boundaries/parts and source points while retaining XY coordinates, identities, appearance and 2D relationships. Already-planar drawings are no-ops. Locked objects and shared block/reference instances are protected; edit definition geometry explicitly in BEDIT. Non-world `normal`/`extrusion` orientations reject atomically because LUMCAD has no 3D OCS importer. The report distinguishes projected, already-planar and protected objects. PREVIEW never commits; application uses one undo entry.

### Integrity audit

`AUDIT` or `AUDIT CHECK` reports raw document defects without committing or saving. The shared Measurements panel lists localized issues, affected entity IDs and exact source paths; `editor.inquiryResult` exposes `{ mode: "audit", valid, examined, issues }`, where each issue contains `code`, `path`, `entityId` and `reference`. Model, block-local and paper-space scopes are inspected. Close BEDIT/REFEDIT first. Traversal/issue limits reject partial success. Repair/recovery commands are still under development.

`AUDIT REPAIR` currently repairs missing layer definitions and invalid layer ownership across model, block-local and paper entities. Existing valid layer IDs are preserved by recreating definitions; invalid/missing IDs map to layer 0. Geometry is retained. The report adds `repairs` and `beforeIssues` while `issues`/`valid` describe the re-audited result. Unresolved defects remain reported, never silently removed. A changed proposal is one document-history entry; repeated repair is a no-op. Source files are never overwritten automatically.


`RECOVER` reads a selected damaged `.lcad`, or accepts `FROM "absolute/file.lcad"` in native Tauri. It prepares a candidate and shows `editor.inquiryResult` with `mode: "recovery"`, source identity, archive issues, repairs, unresolved issues, and quarantined raw objects. The active document is unchanged by inspection. `RECOVER REPORT` displays the latest candidate again. `RECOVER OPEN` (or the panel button) explicitly opens a ready candidate as an unsaved copy, after the ordinary current-document save prompt; the report follows the new session. A failed/cancelled read clears the previous opening candidate. Sources with unresolved graph defects cannot open. Close BEDIT/REFEDIT first.

The native reader refuses the currently open file as a recovery source, including symlink aliases. The recovered session starts with no file path and protects the original source during Save As; no automatic write targets the source. The batch Recovery Manager is available; persistent metadata history is available and broader dependency repair remains in development.


`RECOVERALL [FROM "absolute/root.lcad"]` is a native, read-only dependency inspection. It follows external drawing paths across model entities, block definitions, paper entities and quarantined insertions, including unloaded/overlay references. Native canonicalization resolves relative paths beside the referring file and deduplicates aliases. Traversal is limited to 32 source attempts, eight levels, 2048 reference edges, 300 MiB input bytes and 300×1024×1024 serialized JSON characters retained in candidates. Missing files, invalid candidates, cycles (including cycles through shared branches), and exceeded limits remain visible; partial batches never report complete success. Cached host geometry is not reloaded automatically.

`RECOVERYMANAGER` (alias `DRAWINGRECOVERY`) or `RECOVERALL REPORT` shows `editor.inquiryResult.mode = "recoveryManager"`. The compact report has `entries` with stable batch IDs, paths, status and counts, plus dependency `edges`, `complete`, `limited` and `bytesRead`. `RECOVERYMANAGER SELECT n` displays the full report for a one-based file number; `OPEN n` explicitly opens a ready unsaved copy. The graph and all source-path protections follow that session, so Save As refuses overwriting any original in the batch, including aliases. A new recovery read replaces the current batch. Browser file-system traversal, automatic relinking of saved copies and fuller document repair remain unfinished.


Recovery Manager history retains the twelve latest analysis summaries (source identity, timestamp, status and counts), without drawing geometry, assets or quarantine payloads. Desktop stores a versioned `recovery-history.json` in application data; browser uses `lumcad.recovery-history.v1` in local storage. The metadata file is limited to 256 KiB. `RECOVERYMANAGER HISTORY` displays these summaries; `RETRY n` re-reads and validates the source before preparing any candidate, while `REMOVE n` removes only the summary. Browser retries request a file again. Corrupt history is reported without overwriting it; history-save failure does not discard the current candidate.

Opened recovery reports also include `referencePaths` (entity ID, scope, original path and pinned target) and `unresolvedReferencePaths`. Opening clones the candidate and anchors references to their original source directory, using known canonical batch targets when available. This affects model, block and paper references while preserving cached geometry and load state. Successfully saved dependencies in the same recovery session supply their saved paths when opening a subsequent candidate. Manager entries expose `savedPath`; already saved parent files are not rewritten automatically.

`RECOVERYMANAGER RELINK` acts only in a recovered session whose source belongs to the current graph, and is refused during BEDIT. It returns `editor.inquiryResult.mode = "recoveryRelink"` with `changes` and `unresolved` path records. Changes to model, block and paper references share one document-history commit; an unchanged result adds no undo step. Saved destinations retain at most 32 prior aliases per source, enabling relinking after repeated Save As; reusing a destination for another source invalidates its previous mapping. No file reads or geometry reload occur during RELINK. Opening a candidate that has a saved location re-reads and validates that saved file after the current-session save prompt, refuses a changed document ID and preserves its saved edits.

## Drawing templates

`NEW` creates a blank drawing. `NEW TEMPLATE` selects an ordinary `.lcad` drawing as a template; `NEW FROM "/absolute/template.lcad"` reads it natively. Both retain model content, catalogs, assets, layouts and page setups while assigning fresh document identity/dates, a localized untitled name and no destination path. Internal object IDs remain stable within the independent document. Template selection and validation precede replacement; the normal save prompt still applies, and native sources are reread after it.

`QNEW` takes no arguments and uses `drawingDefaults.templatePath` from Settings, falling back to blank creation when it is empty. Browser mode requests the file again. Invalid or missing native files leave the current session in place.

`SAVETEMPLATE` (alias `DWT`) exports the whole drawing through Save As/download without changing the current file path. Native callers can use `SAVETEMPLATE TO "absolute/path.lcad"` to choose an explicit destination under the same source-protection checks. The output is a standard LUMCAD `.lcad` archive, not Autodesk DWT. Native relative drawing references are pinned before the template is relocated; unresolved browser locations are reported. Instantiated templates pin references in the same way, and native Save As protects their template source. Template export protects the active file and any protected recovery/template sources. Close BEDIT/REFEDIT before these file operations.

## Reusable content browser

`ADCENTER` (`ADC`, `DESIGNCENTER`, `TOOLPALETTES`) opens the content browser inside the existing Blocks palette. `OPEN ["absolute/source.lcad"]` chooses/reloads a source; omitted paths use the file picker. With no arguments, an existing source remains visible. Ordinary drawings list their whole model and named definitions; exported libraries list their declared roots. Inspection and SELECT are read-only. The source is a cached snapshot until the next OPEN.

`SELECT n`, `IMPORT n` and `INSERT n` use one-based positions from `editor.contentBrowser.entries`. Import carries the chosen entry's transitive resources through the same conflict resolution and undo path as BLOCKIMPORT; INSERT then enters normal interactive block placement. `CLOSE` releases the browser snapshot. The palette provides search, a DrawingScene preview, and import/insert actions. `editor.contentBrowser` includes name, native path (or null), entries, selectedKey and unresolved reference locations, not the source's complete drawing/asset payload. Native source-relative references are pinned when read. Existing active/recovery/template sources are also protected when WBLOCK exports, including explicitly supplied destinations and canonical aliases.


### Model quantity extraction

`DATAEXTRACTION` (alias `EATTEXT`) accepts `[LIST|CSV|JSON|XLS|TABLE x y] [ALL|SELECTED] [NESTED] [GROUP field,...|NONE] [SUM length,area|NONE] [TO "absolute/path.csv/json"]`. Defaults are LIST ALL, grouping by `type,layer,block`, summing `length,area`. Field names are case-sensitive: `id`, `rootId`, `type`, `layerId`, `layer`, `blockId`, `block`, `length`, `area`, and `attribute:TAG`. GROUP NONE produces a grand total; SUM NONE produces counts only. The scope includes hidden/locked objects; SELECTED restricts model roots. NESTED includes evaluated children for each occurrence, with inherited layer 0 and measurements after the full world transformation. Block insertion records have no geometric quantity themselves, preventing a second sum of their children. Length is perimeter/path length in metres; area is square metres. Unknown measurements are null, with per-field measured counts to distinguish partial totals from zero. Existing curve measurement limits apply.

LIST shows at most 30 groups in the command message; `editor.dataExtraction` exposes the complete last report snapshot (it is not automatically refreshed after edits). CSV exports typed values and protects text against spreadsheet formulas; JSON preserves nulls, grouping and source root IDs. Exports do not change history. TABLE inserts a native editable table at model coordinates in one undo step, subject to normal layer and table limits. `COUNTLIST` shares this flow with no sums by default. `COUNTTABLE x y [ALL|SELECTED] [NESTED] [GROUP field,...|NONE]` recomputes current counts and inserts their table. Close BEDIT/REFEDIT and use model space. XLS produces a binary Excel 97–2004 workbook (BIFF8), with numeric measurements, empty unknown values and literal text cells. The desktop exporter validates the absolute .xls destination, CFB signature and 64 MiB limit before atomic replacement. The codec is lazy-loaded.


Saved extraction queries: `DATAEXTRACTION SAVE "name" [ALL|SELECTED] [NESTED] [GROUP fields|NONE] [SUM fields|NONE]` creates or replaces a definition (retaining its ID on replacement). `DEFINITIONS` lists names; `DELETE "name"` removes one. These edits are undoable and stored in `.lcad`. `RUN "name" [LIST|CSV|JSON|XLS|TABLE x y] [TO "path"]` recomputes current quantities using its saved query; output options are not persisted. SELECTED saves concrete root IDs, ALL includes newly created objects on each run. Missing selected roots refuse the run; update the saved selection explicitly rather than receiving a partial quantity report. GROUP attribute:TAG remains valid even if no current source has that tag, yielding null values. Scope/group/sum overrides on RUN are rejected; use SAVE to change them.


### Drawing comparison

`COMPARE` opens a `.lcad` source through the usual file picker; native callers can use `COMPARE FROM "absolute/file.lcad"`. The active drawing stays unchanged. `COMPARE REPORT` reopens the snapshot in Measurements; `COMPARE CLOSE` clears both the comparison and report. Loading is refused if the current document changes during the asynchronous read. Use model space with BEDIT/REFEDIT closed.

`editor.comparison` exposes the source path, counts and immutable differences with `scope`, `key`, `kind`, `before`, `after`. Entity/resource identities use IDs (or names for named catalogs); common-item reorderings are separate `order` changes. Save timestamps and cached geometry bounds are ignored; assets/layouts/page setups and other document metadata are compared. The Measurements panel lists the differences without the full before/after payload. `COMPAREIMPORT ALL` imports every reported difference, or `COMPAREIMPORT 1 3 5` imports selected one-based report entries. The import is a single whole-document undo step, including name, embedded assets, layouts and content. Unrelated current edits are preserved. Stale targets, locked/hidden model objects, duplicate/invalid indexes and incomplete resource/order selections reject atomically. Snapshot numbering remains stable until another COMPARE. The Measurements panel includes before/after model previews at the same world scale, highlighting changed roots and affected resource users through the existing renderer. Visibility settings remain respected. `COMPARE CLOUDS [padding arcLength]` creates native editable revision clouds around the union of affected old/new model-root bounds. Defaults are 0.25 m padding and 0.5 m arc length; both must be positive. Creation is atomic in one undo step and respects active-layer visibility/locking. Empty/unsupported bounds, more than 256 affected roots, excessive cloud complexity or a changed comparison baseline refuse creation. After importing differences, start a fresh comparison before generating clouds. Standards workflows remain in development.

### Drawing standards

`STANDARDS SAVE ["absolute/file.json"]` exports the current layer and text/dimension/leader/multiline/table style catalogs as a portable `lumcad-standards` version 1 JSON file. `LOAD ["absolute/file.json"]` embeds such a file in the current drawing; omitted paths open native/browser file selection or export. Explicit paths require Tauri. This JSON format is independent of Autodesk DWS. Reads are bounded to 4 MiB and exports reuse atomic native JSON writing.

`STANDARDS REPORT` and `CHECKSTANDARDS` recompute numbered name-based discrepancies in Measurements and `editor.standards`. `CHECKSTANDARDS FIX ALL` or `FIX 1 3` repairs accepted property differences and missing definitions in one document undo step. Existing local IDs, layer visibility/locks and dimension overrides are retained. Dimension snapshots and block bounds are refreshed. Stale accepted issues, invalid selections and locked dimension edits reject without partial changes. `CHECKSTANDARDS REPLACE 2 "approved name"` explicitly replaces a reported nonstandard definition. If the target is absent locally, its source ID is retained under the approved name; otherwise references merge onto the target ID. The target properties are brought into compliance. Protected built-in definitions cannot be replaced. Layer mapping reuses LAYTRANS merge semantics and remaps saved layer filters; text/dimension references and active styles are updated across model, blocks and paper entities. Table/leader/multiline catalogs are presets; existing independent entity snapshots are not rebound by a catalog update.

`STANDARDS DETACH` removes the embedded association. LOAD and DETACH are undoable document changes. The binding and source snapshot persist in `.lcad`; reopening uses the embedded rules without reading the original source path. Use these commands in model space outside BEDIT.

Comparison imports and standards corrections also check indirect block-definition effects: a shared or nested definition change cannot modify a locked/hidden insertion through its referenced children. Model, block and paper collections are checked before the candidate is committed; cached bounds alone do not trigger this guard.


### Sheet-set project commands

`NEWSHEETSET "project name"` creates an independent project index. `OPENSHEETSET ["absolute/index.json"]` loads one (omitting the path opens a file chooser). `SHEETSET` or `SHEETSET REPORT` exposes the ordered sheets, source identities, project properties, path, dirty state and last preflight status in Measurements and `editor.sheetSet`.

- `SHEETSET ADD CURRENT|"absolute/source.lcad" "layout name or id" "sheet number" "title"` adds a presentation from a saved drawing. External paths require Tauri. Layout IDs remain stable; names must resolve unambiguously.
- `SHEETSET REMOVE index`, `NUMBER index "number"`, `TITLE index "title"` and `ORDER 2 1 ...` edit one-based positions in the current report. ORDER must contain every position exactly once.
- `SHEETSET PROPERTY PROJECT|ALL|index "key" "value"` edits metadata on the project, every sheet, or one sheet.
- `SHEETSET UNDO` and `REDO` use separate project history; ordinary drawing UNDO is unchanged.
- `SHEETSET SAVE ["absolute/index.json"]` writes the index, using its existing path or a save chooser when omitted. Save As rebases source paths and clears project history to avoid restoring paths relative to the previous index directory.
- `SHEETSET CHECK` reads all referenced source files and verifies identities/layouts before marking the report checked. Rechecking an unavailable source clears the previous checked status. Checking uses saved files, not unsaved edits in the active drawing.
- `SHEETSET CLOSE` refuses unsaved changes; `CLOSE DISCARD` explicitly discards them. NEW/OPEN similarly refuse to replace a dirty project.

The project session survives switching drawings but is not retained after application exit unless saved explicitly. Index edits never alter source drawings. `PUBLISH SHEETSET [PDF|DWFX] ["absolute/output path"]` (default PDF) or `SHEETSET PUBLISH PDF|DWFX ["absolute/output path"]` reloads all saved sources, preflights them together, and renders in report order. Each presentation retains its own paper dimensions and plot settings. Repeated layout IDs across sources or repeated presentations are supported. Explicit destinations use native atomic publication; omitted destinations open Save As. Source reading currently requires Tauri. The active drawing remains unchanged. A drawing switch before file writing cancels pending rendering; `editor.sheetSet.publicationError` contains bounded diagnostics on failure. The report’s checked flag describes source resolution, not export success. Transmittal commands are described below; final relative-link refresh and Save As verification remain.


`ETRANSMIT ["absolute/output.zip"]` and its alias `ARCHIVE` package the currently open sheet set. Equivalent forms are `SHEETSET ETRANSMIT [path]` and `SHEETSET ARCHIVE [path]`. An omitted destination opens native Save As after collection. These desktop commands package all declared drawings, nested external drawing references, linked CSV files and embedded assets. They never upload or send files. Source files remain unchanged; copied paths are rewritten to portable package-relative names. Missing/replaced sources or exceeded limits abort rather than producing a partial archive. The ZIP contains `sheet-set.json`, `transmittal.json` and `drawings/`; extract it, open the index, and use CHECK/PUBLISH normally. Source cells/geometry remain cached until explicit refresh.

### WMF vector import

`WMFIN` accepts an absolute `.wmf` path with optional `AT x y` (metres) and positive `SCALE factor`. It preflights the entire supported graphics stream, then commits one model-space history entry. Supported embedded DIB copies become PNG assets, including indexed/RGB pixels, 16/32-bit RGB bitfields and RLE4/RLE8 compression and SETDIBTODEV uncompressed scan bands; text and clipped geometry follow the same atomic import. Locked layers, unsupported records, invalid placement and context changes reject the import. Unsupported appearance details are reported; this is not yet a complete WMF codec. Native input is limited to 64 MiB.


### WMF vector export

`WMFOUT ["absolute/file.wmf"]` builds a snapshot of supported visible model geometry without editing the drawing or adding an undo entry. An omitted path opens native Save As, or downloads a WMF in the browser. Explicit paths require desktop mode. Native saving validates the bounded WMF container and atomically replaces the destination. Export covers linework, supported native ellipses/arcs, solid and regular patterned hatches, ordinary nested blocks, loaded drawing references and supported cached PDF previews, supported dimension linework/arrows/localized labels, supported single-byte text and opaque axis-aligned embedded PNG/JPEG/BMP/WebP images. Embedded pixels retain brightness/contrast/monochrome adjustments, quarter-turn rotations and axis reflections. Rectangular clips follow the image transform and restore the graphics context before subsequent objects; source decoding is shared and bounded to 16 million pixels. Model and assets are snapshotted before asynchronous image decoding. The result reports source origin in metres and fidelity warnings; WMF coordinates are shifted to that local origin. Unsupported visible entities, transparency, nonrectangular block clips and unsupported text variants reject the entire candidate. Arbitrary image rotations, polygon clips and zero-alpha pixels use bounded colored pixel polygons instead of a bitmap record. Equal pixel runs merge horizontally and vertically; simple concave clips are triangulated, with a shared 8,192-region export budget and explicit edge-smoothing warning. Partial alpha/entity opacity, gradients and full external interoperability remain unfinished.

WMF dimension conversion uses the shared styled presentation, including extension gaps/overruns, arrow types, breaks, current associative source geometry and moved/rotated text. Each source dimension counts once in the export report. Text uses the active locale and existing WMF font/code-page limits; unavailable glyphs (including the default arc-length symbol) and translucent inspection frames currently reject. The canvas white text outline is not reproduced and is reported explicitly.

WMFOUT exports loaded drawing references from their cached host definitions/assets, including inherited placement and source layer visibility. It does not reopen or refresh the referenced file; unloaded references remain excluded. Cycles, missing definitions and unsupported descendants abort the candidate. Reference metadata and host resources are unchanged. Axis-aligned rectangular clips, including nested and quarter-turn-transformed clips, intersect in world space and apply to every descendant primitive. Nonrectangular/oblique block clips remain unsupported.

WMF placeable extents include a stroke margin so readers with exclusive lower/right bounds do not cut border geometry. The reported source origin includes that margin; adding it to decoded WMF coordinates restores world placement.

PDF underlays export their embedded page preview at its stored pixel resolution, with a localized warning. Native page placement, nested transforms and supported block clips apply normally. Source PDF bytes, optional-content metadata and snap-only curves are preserved in the drawing; snap-only geometry is not painted into the WMF. Opaque/binary-alpha previews use the existing raster export path. Previews with partial alpha (including antialiased transparent edges) still reject until compositing is supported; original PDF vectors are not reinterpreted by WMFOUT.

`WMFOUT [file.wmf] RASTER [WIDTH 64..4096] [BACKGROUND #RRGGBB]` explicitly exports a composited snapshot of the model scene, including partial transparency and gradients. The default is 2048 pixels wide on white; aspect ratio is preserved with a 4096-pixel side and 16-million-pixel ceiling. The WMF contains one opaque bitmap, with a localized warning that objects are no longer individually editable. Default WMFOUT remains vector output and never silently switches modes. Rendering reuses the editor scene and publication resource preparation, preserving pixel-space stroke weights and adapting image resolution. Bitmap SVGs use a pixel viewport and flatten neutral groups to avoid native small-coordinate rendering loss; compositing, clipping and referenced groups retain their boundaries.

Raster WMF framing includes non-scaling stroke cap/join margins. A requested width too small to contain those margins is rejected; increase `WIDTH` rather than accepting clipped output. Empty rendered scenes do not create a file.


### DWFx underlay attachment

`DWFATTACH ["absolute/file.dwfx"] [PAGE n] [AT x y] [SCALE factor]` reads a bounded local DWFx snapshot (25 MiB maximum), selects a one-based page and attaches it in model space. Placement uses metres and a positive uniform scale. Omit the path for the native/browser picker. The original source package and a bounded PNG page preview are embedded in the drawing; attachment creates one undo entry. Unsupported XPS visuals, malformed packages, missing pages, locked layers or a document change during decoding reject the operation before commit. Legacy DWF6 is not supported yet.

`DWFCLIP` requires one selected editable DWFx underlay and accepts `RECT x1 y1 x2 y2`, `POLYGON x1 y1 x2 y2 x3 y3 [...]`, `ON`, `OFF` or `DELETE`. Coordinates are metres in the page's local frame, before insertion/scale. Clipping reuses block clipping and creates one undo entry; it does not alter embedded source bytes.

DWFx visual `RenderTransform` accepts an inline six-number matrix, an explicit `MatrixTransform` property element, or a typed static resource from the nearest dictionary scope. Unsupported transform/paint resource types reject the attachment. This follows the [XPS positioning model](https://www.ecma-international.org/wp-content/uploads/XPS-Standard.pdf); additional resource types remain in development.

DWFx geometry also accepts `Path.Data`, `Path.Clip` and `Canvas.Clip` property elements and typed `PathGeometry` resources. `Figures` attributes and expanded line/cubic/quadratic/arc figures share the bounded curve parser and preserve fill rules. Geometry transforms apply to curve coordinates before stroking, retaining the path stroke thickness. Visual, geometry and gradient/image-brush matrices share attribute/property/static-resource decoding; dictionary definitions can use earlier matrix entries. Unfilled figures retain their strokes but do not contribute to fill or clip areas, including image fills. Unstroked segments retain fill/clip geometry while creating gaps in the outline; open-figure dash phase restarts after each gap. Closed figures with stroke gaps support bounded native-curve dash subdivision, retaining original-start phase and joins. Zero-length gaps remain continuous; zero-length ink supports round dots and invisible flat caps. Singular geometry transforms and square zero-length dots in this closed-gap case currently reject explicitly rather than alter appearance.

DWFx `Glyphs` currently supports embedded TrueType and CFF 1 text in either horizontal direction and sideways glyph runs, including composite outlines, Unicode lookup and explicit glyph IDs, advances and offsets in hundredths of an em. Explicit UTF-16 cluster mappings preserve ligatures, one-to-many mappings and supplementary characters; malformed groups or split surrogate pairs reject the page. Glyph runs use the shared fill, transform, opacity and clip renderer. No operating-system font substitution or font-instruction execution is used. BidiLevel accepts integer levels 0–61: even levels advance right and odd levels advance left, using the intrinsic glyph advance to anchor each outline without mirroring it. Producers supply shaped glyph order and clusters; the reader does not rerun Unicode shaping. IsSideways uses per-glyph vertical metrics (vhea/vmtx plus glyf bounds), falling back to OS/2 typography metrics or hhea. It rotates outlines counterclockwise about their top-center origin; a page transform can then produce upright vertical columns. Odd BidiLevel with IsSideways rejects as invalid XPS. TrueType collections (TTC versions 1 and 2) support zero-based FontUri face fragments, shared tables and XPS obfuscation, within the existing byte limits and a 256-face directory limit. Invalid face indices and overlapping or out-of-bounds directories reject. ItalicSimulation applies the prescribed 20-degree contour shear before sideways rotation, retaining glyph advances, baseline origins and explicit offsets. BoldSimulation expands the filled outlines by 1% em on each side and adds 2% em to omitted advances; explicit advances remain authoritative. BoldItalicSimulation applies that expansion before the italic shear. Bounded outline masks reuse the shared brush renderer so overlapping fill/stroke coverage does not double opacity. CFF 1 Type 2 outlines share this placement/rendering pipeline, with checked FontMatrix-to-em conversion and VORG vertical origins. CID-keyed CFF uses validated FDSelect format 0/3 mappings, per-dictionary private subroutines and concatenated dictionary matrices. CFF2 and deprecated composite endchar remain unsupported; unsupported pages reject before attachment.

DWFx ImageBrush accepts PNG and 8-bit grayscale/RGB JPEG resources, with bounded dimensions and marker traversal. JPEG source units use EXIF resolution first, JFIF second and 96 dpi otherwise; inch and centimetre density units are supported. The shared viewbox, tile, transform, clipping and paint pipeline renders JPEG pixels through the image codec. XPS brush placement uses raw pixel orientation: valid EXIF orientation tags (1–8) are neutralized only in an owned preview copy to prevent browser auto-rotation. The embedded source package is preserved unchanged. CMYK JPEG and JPEG XR remain unsupported.


DWFx TIFF image brushes decode the first TIFF 6.0 directory with bounded field/strip/pixel budgets. Supported storage is chunky strips, uncompressed, PackBits, LZW or bilevel CCITT (compression 2, Group 3 and Group 4); supported pixels are bilevel/grayscale (1/2/4/8/16 bits), indexed palettes (1/2/4/8 bits), and RGB/RGBA (8/16 bits), including associated or straight alpha and both byte orders. PackBits honors scanline boundaries and FillOrder before decompression. LZW uses bounded per-strip dictionaries, 9–12-bit early-change codes and explicit clear/end codes; horizontal prediction restores same-channel samples modulo their bit depth, resetting on every row. The preview uses a shared lossless RGBA PNG encoder; 16-bit samples are reduced to 8-bit preview channels. Per [XPS §9.1.5.3](https://www.ecma-international.org/wp-content/uploads/XPS-Standard.pdf), subsequent directories and image orientation are ignored, and unitless resolution is interpreted as pixels per inch. Centimetre density is converted to inch density. Original TIFF/package bytes stay intact. CCITT supports byte-aligned 1D rows, Group 3 mixed 1D/2D and EOL fill alignment, and Group 4 reference rows with independent strip resets and either FillOrder. Run lengths, input reads and operations are bounded. Optional CCITT uncompressed extension modes, other TIFF compression (including JPEG), floating-point prediction, planar/tiled storage, CMYK and ICC-profile conversion remain unsupported and reject the page atomically.

WMFIN solid physical pens on standalone circular paths now become native filled outlines: full circles retain an inner hole (or a disk when the pen covers the centre), while circular arcs retain round, flat or square caps. Circular ellipse records are recognized within floating-point roundoff. Width scales with placement and persists through LCAD archives. Paths mixing lines and circular arcs also retain exact solid outlines when joins are round and open ends have round caps; closed paths ignore the end-cap setting. Round-capped arcs support widths reaching or exceeding the radius through a bounded union of a circular sector and endpoint disks. Noncircular ellipses, other mixed-path joins/caps, dashed curves and centre-crossing open arcs with flat/square caps retain the existing explicit approximation warnings.


`DGNIMPORT [file.dgn] [UNIT mm|cm|m|km|in|ft|yd|us-ft] [AT x y] [SCALE factor] [CELLS BLOCKS|EXPLODE]` imports supported 2D V7 lines, polylines, shapes, ellipses and arcs as editable model objects in one undo entry. Omit the path for the native/browser picker; explicit paths require the desktop app. Source levels become distinct layers and graphic groups retain membership. Known units convert to metres; unknown or inconsistent source units require UNIT. Palette colors and supported solid fills are preserved; omitted metadata and stroke approximations are reported. Native/browser input is bounded to 64 MiB. Printable ASCII text imports as editable text, with original placement, rotation and character proportions; font substitution and metric approximations are reported. Connected complex chains/shapes, including nested open chains, with matching member levels and graphic groups become exact native polylines, including elliptical arcs, header solid fills and individual member colors/weights/styles. Member database links and locks produce the same omission warnings as standalone objects. Sub-resolution gaps caused by integer coordinates or quantized angles are reconciled with an explicit warning: adjacent line endpoints move to the arc endpoint, or a short connector preserves both arcs; larger gaps reject. Other encodings, nested closed shapes, differing member levels/groups and other unsupported complex elements, 3D and V8 reject the entire import. Destination locks and document changes during reading also reject the import.  Supported cells become linked block instances by default (CELLS BLOCKS), preserving nested definitions, member order, source levels and insertion origins. Named and graphic selection groups select the containing model instance. CELLS EXPLODE retains independent editable members with selection groups and reusable definitions. Names are collision-safe. Each source cell has an independent definition; identical source names are not assumed to imply identical geometry. Source metadata omissions are reported. Grouped-hole cells with one closed solid and disjoint internal holes retain an exact even-odd hatch plus editable outlines. Outside, touching, crossing or nested holes and ambiguous multiple solids reject atomically. DGN reference attachment and clipping are described below; export remains in development.

`DGNATTACH [file.dgn] [UNIT mm|cm|m|km|in|ft|yd|us-ft] [AT x y] [SCALE factor]` attaches supported 2D V7 geometry as a portable vector reference. It retains the complete source bytes (25 MiB maximum), cached native geometry, nested blocks and source levels; geometry compatibility and fidelity warnings match DGNIMPORT. Omit the file for the native/browser picker. No external source is read automatically on load. Attachment validates archive limits before one history commit and rejects stale document contexts. `DGNCLIP ON|OFF|DELETE|RECT x1 y1 x2 y2|POLYGON x1 y1 x2 y2 x3 y3 [...]` edits one selected unlocked reference using the shared block clip; coordinates are local metres before attachment scale/translation. Source, metadata, placement, clips and cached geometry survive archives and clipboard remapping. DGN export and broader format support remain open.

`COUNTTABLE x y LINKED [ALL|SELECTED] [NESTED] [GROUP fields] [SUM length,area]` and `DATAEXTRACTION TABLE x y LINKED ...` create native tables with owned query snapshots. Model edits update their cells in the same undo step; table entities are excluded from queries. `entity.table.quantityLink.status` reports current/empty/dependency/limit, with failed queries retaining marked cached values. `TABLEDIT DETACHQUANTITIES` turns the selected linked table into an ordinary editable table. Fixed selected scopes retain their original object IDs; additions only affect all-model scopes, and deletions remove missing sources from the count.

After `COUNT`, `COUNTAREA`, `SELECTCOUNT` or `BCOUNT`, `COUNT NEXT`, `COUNT PREVIOUS` and `COUNT ITEM n` navigate the last count with wrapping next/previous steps and one-based direct access. `editor.inquiryResult` has mode `countObjects`, `occurrences` (root ID, full instance path, type/layer/block and model-space bounds) and a zero-based `activeOccurrence` after navigation. The Measurements panel exposes the same controls. Navigation selects the containing model object while centering nested occurrence bounds, without a history entry. A changed drawing requires a new count. Count rows remain the aggregate quantities; selecting one occurrence does not change their totals.


### PNG, JPEG and SVG model export

`PNGOUT`, `JPGOUT` (or `JPEGOUT`) and `SVGOUT` export the visible model without changing the drawing or undo history. `EXPORT PNG|JPG|JPEG|SVG` accepts the same options. Run these commands in model space, outside block editing.

- `WIDTH 64..4096` sets the requested pixel width (default 2048); aspect ratio is retained within a 4096-pixel side limit, with margins for strokes.
- `BACKGROUND #RRGGBB|TRANSPARENT` chooses the background. PNG and SVG default to transparent; JPEG defaults to white and requires an opaque colour.
- JPEG additionally accepts `QUALITY 0.1..1` (default 0.92).
- `TO "absolute/path/file.png"` chooses a desktop destination with the corresponding extension (`.jpg` or `.jpeg` for JPEG). Without TO, desktop mode opens Save As and browser mode downloads the file with a retry link. Native writes validate format signatures and replace atomically; output is bounded to 64 MiB.

For example: `JPGOUT WIDTH 1600 BACKGROUND #ffffff QUALITY 0.9` or `EXPORT SVG WIDTH 2048 BACKGROUND TRANSPARENT`. SVG retains vector artwork and text, while images and cached underlay previews remain embedded raster content. Export uses the loaded scene; it does not refresh external references. A document/content change during preparation cancels stale output.

`ALIASEDIT SET alias command` and `ALIASEDIT REMOVE alias` update personal command aliases in application settings, without editing the drawing or its undo history. `ALIASEDIT` without arguments opens settings. Targets resolve against the shared command catalog, not another personal alias. Built-in names and aliases cannot be shadowed. Personal aliases are accepted through raw command entry; structured MCP commands continue to use canonical catalog IDs.

`HYPERLINK` (`ATTACHURL`) without arguments shows the single selected object's link fields. `SET "https://host/path" ["label"]` adds/replaces links on the selected editable model objects; `REMOVE` removes them. Each actual change is one undo step; empty, missing or locked selections reject atomically. `OPEN` opens one selected object's saved HTTP/HTTPS link in the default browser, without changing the drawing or history. Credentials and executable/file URL schemes are not supported. Model/block editing uses the existing history; paper-space commands are refused. Links are retained as `entity.hyperlink` through normalization, archive and clipboard workflows.

`SHEETSET INVENTORY` runs the same bounded recursive collection and validation as ETRANSMIT, without writing an archive. Measurements and `editor.sheetSet.transmittal` expose the last snapshot: source/package paths, kinds, source byte sizes and collected flags. Failure reports the first blocking path and a localized error code; undiscovered dependencies are not claimed checked. The snapshot is cleared on sheet-set changes; exporting always rereads sources. Successful archives also include a localized `transmittal.txt` with portable filenames and extraction instructions, without absolute source paths.


`ARCTEXT` creates a linked label from one circular arc in `selection` and input `"text" [HEIGHT metres] [OFFSET metres] [SPACING metres] [ALIGN START|CENTER|END] [DIRECTION FORWARD|REVERSE]`. Without preselection, follow it with a point action containing the arc's `targetId`; Escape cancels. `ARCTEXT EDIT "text"` with the same options edits a selected unlocked label. `ARCTEXT DETACH` removes only the association. The result is a generated polyline carrying `arcText` and `sourceId`; source changes refresh its native text parts in the same undo step. Invalid text/size/spacing/arc fit is atomic. Available in model space, including local block editing; file exports use the normal native export commands.
