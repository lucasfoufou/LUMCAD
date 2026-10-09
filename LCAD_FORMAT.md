# LUMCAD `.lcad` file format

This document describes version 2 of the LUMCAD file format. Version 1 archives remain readable and are normalized to the version 2 document model when opened.

## Container

An `.lcad` file is a standard ZIP archive. Paths use `/` separators and are relative to the archive root.

```text
drawing.lcad
├── manifest.json
└── assets/
    ├── 0001-reference.png
    └── 0002-title-block-logo.svg
```

The current writer creates exactly one `manifest.json` entry and one `assets/…` entry for every embedded asset. Unknown archive entries are rejected when opening a file so that the container remains deterministic and auditable.

## `manifest.json`

The manifest is UTF-8 JSON. Writers emit compact JSON (no indentation) followed by a newline; readers accept any valid JSON whitespace, so earlier indented manifests remain readable. Its top-level structure is:

```json
{
  "format": "lumcad",
  "formatVersion": 2,
  "appVersion": "0.1.0",
  "document": {
    "id": "drawing-…",
    "name": "Drawing",
    "content": {
      "textStyles": [
        {
          "id": "text-style-standard",
          "name": "Standard",
          "fontFamily": "sans",
          "fontSize": 0.35,
          "fontWeight": 400,
          "fontStyle": "normal",
          "underline": false,
          "strikethrough": false,
          "lineHeight": 1.2
        }
      ],
      "activeTextStyleId": "text-style-standard"
    },
    "assets": [],
    "pageSetups": [
      {
        "id": "page-setup-…",
        "name": "Production",
        "format": "CUSTOM",
        "orientation": "landscape",
        "customPaperSize": { "width": 610, "height": 330 },
        "margins": { "top": 8, "right": 9, "bottom": 10, "left": 11 },
        "plotSettings": {
          "area": {
            "mode": "window",
            "window": { "x": 1, "y": 2, "width": 20, "height": 10 }
          },
          "scale": {
            "mode": "fixed",
            "denominator": 200,
            "centered": false,
            "offsetMm": { "x": 4, "y": 5 }
          },
          "style": { "colorMode": "grayscale", "plotLineweights": false },
          "quality": {
            "mode": "raster",
            "rasterDpi": 600,
            "imageDpi": 450,
            "jpegQuality": 0.8
          }
        }
      }
    ],
    "layouts": [
      {
        "id": "layout-…",
        "name": "Layout 1",
        "format": "CUSTOM",
        "orientation": "landscape",
        "customPaperSize": { "width": 610, "height": 330 },
        "margins": { "top": 8, "right": 9, "bottom": 10, "left": 11 },
        "plotSettings": {
          "area": {
            "mode": "layout",
            "window": { "x": 0, "y": 0, "width": 1, "height": 1 }
          },
          "scale": {
            "mode": "fit",
            "denominator": 1,
            "centered": true,
            "offsetMm": { "x": 0, "y": 0 }
          },
          "style": { "colorMode": "asDisplayed", "plotLineweights": true },
          "quality": {
            "mode": "vector",
            "rasterDpi": 300,
            "imageDpi": 300,
            "jpegQuality": 0.9
          }
        },
        "pageSetupId": "page-setup-…",
        "paperEntities": [],
        "viewports": [
          {
            "id": "viewport-…",
            "name": "",
            "x": 20,
            "y": 20,
            "width": 260,
            "height": 180,
            "hiddenLayerIds": ["references"],
            "locked": true,
            "viewRotation": 15,
            "clipBoundary": {
              "type": "polygon",
              "points": [
                { "x": 0, "y": 0 },
                { "x": 1, "y": 0 },
                { "x": 0.85, "y": 1 },
                { "x": 0.1, "y": 0.8 }
              ]
            },
            "visualSettings": { "style": "monochrome", "showLineweights": false },
            "annotationSettings": {
              "showText": true,
              "showDimensions": true,
              "dimensionTextSizeMm": 3
            },
            "layerOverrides": [
              { "layerId": "geometry", "color": "#000000", "lineType": "dashed", "lineWeight": 3 }
            ],
            "modelViewBox": {
              "x": -5,
              "y": -3,
              "width": 30,
              "height": 20
            }
          }
        ]
      }
    ],
    "createdAt": "…",
    "updatedAt": "…"
  }
}
```

Each layout uses one ISO A-series format (`A4`, `A3`, `A2`, `A1`, or `A0`) or `CUSTOM`, plus an `orientation` of `landscape` or `portrait`. `customPaperSize` and `margins` are expressed in paper millimetres. A reusable entry in `pageSetups` stores the same paper properties; `pageSetupId` records which profile supplied a layout's current setup. The layout retains its normalized paper values even if that profile is later removed.

Layouts and reusable page setups also store the same normalized `plotSettings` object:

- `area.mode` is `layout`, `extents`, or `window`. Because these settings belong to a paper layout, a window rectangle uses paper-space millimetres; it remains present with safe defaults when another mode is active.
- `scale.mode` is `fit` or `fixed`. A fixed scale stores an exact `1/X` `denominator` of at least `1`; `centered` controls automatic placement and `offsetMm` applies a paper-space offset in millimetres.
- `style.colorMode` is `asDisplayed`, `grayscale`, or `monochrome`; `plotLineweights` controls whether stored lineweights affect output.
- `quality.mode` is `vector` or `raster`. `rasterDpi` controls the complete page bitmap used by raster PDF and DWFx output. `imageDpi` limits embedded bitmap assets without upscaling them; vector paths and text remain vector in a vector PDF. Both DPI values are clamped from `72` through `1200` when editing finishes, while `jpegQuality` is clamped from `0.1` through `1`. Safe canvas limits can reduce the effective full-page DPI for unusually large sheets.

Missing plot settings normalize to `layout`, fit-to-paper at a nominal `1/100`, centred with zero offset, as-displayed colours, enabled lineweights, vector output, `300` DPI for raster and image content, and JPEG quality `0.9`. This is an additive version 2 field: existing version 1 and version 2 manifests without it remain readable and receive those defaults.

`paperEntities` contains text, line, rectangle annotations and native block references in paper millimetres. They use the same normalized entity/editing primitives as their model-space counterparts while remaining scoped to one layout. Viewport rectangle coordinates and dimensions also use paper millimetres. `modelViewBox` points to the visible model-space rectangle in metres; its aspect ratio is normalized to the paper viewport so printed geometry is not distorted. `hiddenLayerIds` hides layers only inside that viewport and does not change their model-space visibility.

`CHSPACE` packages model selections and their dependencies in a native paper block,
whose affine insertion maps model metres to paper millimetres. It preserves curves
and geometry outside the paper boundaries; block movement is not clamped to the
sheet. The boolean `spaceTransfer: true` marks this container for unpacking on
return to model space. Original child IDs survive unless a model ID collision
requires remapping; dependencies follow that mapping. Annotation representations
are snapshotted at the chosen viewport scale and become non-annotative. Definitions
shared by other objects are retained. Both spaces change in one history step.

Viewport `viewRotation` is stored in degrees. A polygonal `clipBoundary` uses normalized viewport coordinates from `0` through `1`. `locked` prevents accidental model-view changes. `visualSettings`, `annotationSettings`, and `layerOverrides` control only that viewport and leave model-space entities unchanged. Layer overrides may contain a colour, linetype, and/or lineweight.

The viewport display scale is derived rather than stored: its exact `1/X` denominator is `modelViewBox.width × 1000 / viewport.width`, converting model metres to paper millimetres.

## Exact curves and compound geometry

Drawing coordinates and distances are stored in metres. Circular and elliptical `startAngle` / `endAngle` values are radians; entity `rotation` values are degrees. Exact curve operations use these persistent primitives:

```json
[
  {
    "id": "ellipse-…",
    "type": "ellipse",
    "layerId": "geometry",
    "cx": 8,
    "cy": 4,
    "rx": 3,
    "ry": 1.5,
    "rotation": 25,
    "startAngle": 0,
    "endAngle": 3.141592653589793,
    "counterClockwise": true,
    "fullEllipse": false
  },
  {
    "id": "spline-…",
    "type": "spline",
    "layerId": "geometry",
    "degree": 3,
    "controlPoints": [
      { "x": 0, "y": 0 },
      { "x": 1, "y": 2 },
      { "x": 3, "y": 2 },
      { "x": 4, "y": 0 }
    ]
  }
]
```

An ellipse with `fullEllipse: true` ignores its angular interval. A spline is one exact cubic Bézier span and therefore has four control points. Ordered mixed curves are stored as a `polyline` with `parts`; each part retains its native `line`, `arc`, `circle`, `ellipse`, or `spline` geometry instead of being sampled into chords. `closed: true` means the final endpoint meets the first endpoint. A compound object may retain appearance properties on individual parts for `XPLODE`; normal `EXPLODE` applies the parent appearance.

Hatch-like boundary data uses bounded `boundaries` (or legacy `loops`) containing point loops, exact path objects, or supported curve entities. These boundaries remain exact when used by clipboard interchange and compound operations. Associative annotations reference one source through `sourceId` or several sources through `sourceIds`; block-local annotations reference child IDs inside their own definition.

## Rectangular array editing

Rectangular arrays remain exact compound `polyline` entities. Their existing `array` object stores integer `columns` and `rows` (1–100) and model-space displacement vectors `horizontal` and `vertical`. Parts are ordered by row, then column, then motif part; the first cell is the editable motif. `ARRAYEDIT` recovers that motif from the ordered parts and regenerates all cells while retaining the parent entity ID and appearance. No separate duplicate source geometry is stored.

Translation moves the parts; rotation, reflection and scaling transform both the parts and the displacement vectors. This allows an edited array to retain its transformed orientation. Existing version 2 arrays using this representation remain editable; incomplete metadata or inconsistent part counts do not enter array editing. Exploding detaches the parts into ordinary independent entities.

## Polar array editing

Polar arrays are compound `polyline` entities whose `array.kind` is `polar`. Their definition stores `count` (1–100), a nonzero signed `angle` in degrees (−360 to 360), `rotateItems`, local `center` and `basePoint`, a bounded flat `seedParts` motif, and a six-component affine `transform`. The `parts` field contains the materialized geometry used by existing rendering, selection, snapping, layouts and output. A full revolution divides the sweep by the count; partial revolutions include both endpoints. One item retains the original motif.

Transforms compose into the stored affine frame and regenerate the exact motif instances. Nonuniformly scaled circles and arcs become exact ellipses/elliptical arcs. Changing the count or sweep therefore remains possible after move, rotate, scale, mirror and archive reload. Center and angle grips map world coordinates back through the frame. Invalid definitions are detached during document normalization while their materialized geometry remains available; generation is capped at 100,000 parts. This additive version 2 metadata does not change the archive version.

## Path array editing and association

Path arrays are compound `polyline` entities with `array.kind: "path"`. They retain a flat `seedParts` motif, local `basePoint`, affine `transform`, one normalized connected `path`, `count` (1–100), `mode` (`divide` or `measure`), `spacing`, `offset`, `align`, and `reverse`. Coordinates, spacing and offset are metres. Divide mode places the requested count by accumulated curve length; measure mode derives the count from the interval. Closed paths omit a duplicate final station. Spline and ellipse stations invert integrated arc length rather than interpolating curve parameters.

A top-level `sourceId` optionally links to the original path entity, using the same dependency/remapping machinery as associative annotations. The history commit reconciles source geometry and regenerates linked array parts in the same undo step. Archive normalization also reconciles live sources. Moving an array together with its path retains the link; transforming only the array detaches `sourceId` while preserving the path snapshot and editable parameters. A missing, disconnected or unsupported source detaches the surviving cached array; normal source deletion follows the document dependency deletion rules. Invalid or oversized regeneration leaves the prior geometry intact and detaches its link.

Selection exposes one position grip for an array. Edit its parameters with `ARRAYEDIT`; use `EXPLODE` before editing individual instances as independent geometry. The array definition and materialized parts remain version 2 additive fields, subject to the existing archive size limits and the 100,000-part generation limit.

## Rich text and dimensions

Model-space and paper-space text use the same normalized text entity. `text` is the plain compatibility value, while ordered `runs` preserve rich marks such as bold, italic, underline, strikethrough, colour, font family, and font size. `textMode` is `singleLine` or `multiline`; `wrapMode` is `word`, `character`, or `none`. `textStyleId` refers to a named entry in `document.content.textStyles`. Entity-level fields remain optional overrides so later named-style edits can propagate. Optional `fitWidth: true` on single-line text fits the displayed line to its available rectangle width using SVG `textLength`/`spacingAndGlyphs`; it is removed for multiline text. PDF text import uses this with an `affineFrame` to preserve physical baselines and run widths while substituting a supported font family. Local text metrics remain in the affine frame’s coordinate system. Native storage and clipboard preserve both fields.

The persistent dimension families are `linearDimension`, `radialDimension`, `angularDimension`, `arcLengthDimension`, `ordinateDimension`, and `centerMark`. Their geometry is stored exactly in metres/radians and may be free or associative through `sourceId`/`sourceIds`. `dimensionFormat` stores precision, prefix/suffix, deviation/symmetric/limits tolerance, alternate length units, and inspection label/rate. The formatter is shared by canvas, layout, clipboard SVG, and exploded text so these representations remain consistent.

QDIM linear entities keep an editable series identity through `seriesId`, `seriesMode`, `seriesIndex`, and the normalized `seriesAxis`. `sourcePointReferences` retains the two associative stations used by each member. Baseline series additionally persist `baselineEnd` and `baselineReference`, allowing the shared editor to reverse the baseline between the first and last station without losing source associations or entity appearance.

## Native points and interval placement

A `point` entity stores `x` and `y` in metres, stable `id`/`layerId`, ordinary appearance, and a `pointStyle` snapshot. The style contains `symbol` (`dot`, `cross`, `x`, `circle`, `square`, `circle-cross`, or `square-cross`) and positive `size` in metres (0.000001–1000000). `content.settings.pointStyle` supplies creation defaults. Missing or invalid styles normalize to a 0.2 m cross. An optional `pointTransform` stores the linear affine coefficients `a`, `b`, `c`, `d` of the symbol around its location; translations affect coordinates only. This preserves the marker presentation when transformed or materialized from a scaled/rotated block. Node snaps and position grips use the location, independently of the displayed marker.

`DIVIDE` and `MEASURE` add independent native points or ordinary block references. They retain the source and do not persist an associative array. Open-path division omits endpoints; closed-path division includes its seam once. Fixed-interval measurement starts one spacing from the source origin and excludes the terminal endpoint. Each placement batch is one undoable content edit. Existing archive version 2 accommodates these entities without changing the container schema.

## Layer and object appearance

Every layer stores a color, line weight, line type, and transparency:

```json
{
  "id": "geometry",
  "name": "0",
  "color": "#172033",
  "lineWeight": 1,
  "lineType": "continuous",
  "transparency": 0,
  "visible": true,
  "locked": false
}
```

Supported line weights are `1`, `1.5`, `2`, `3`, `5`, and `10`. Supported line types are `continuous`, `dotted`, and `dashed`. Transparency is an integer percentage from `0` (opaque) through `90`; layers default to `0`.

An entity uses its layer appearance by default. A custom `color`, `lineWeight`, `lineType`, or `transparency` is stored directly on the entity only when that property overrides the layer. Removing the entity property restores ByLayer behavior, so later layer changes immediately affect every inheriting object. A custom transparency of `0` is preserved because it is a valid opaque override for an otherwise transparent layer.

## Block definitions and references

`document.content.blocks` stores reusable block definitions. Each definition has a stable ID, a display name, a local base point, local child entities, and derived local bounds. A `blockReference` entity points to one definition and applies an affine matrix to its local geometry:

```json
{
  "blocks": [
    {
      "id": "block-…",
      "name": "*U1234",
      "basePoint": { "x": 0, "y": 0 },
      "bounds": { "minX": 0, "minY": 0, "maxX": 4, "maxY": 2 },
      "entities": []
    }
  ],
  "entities": [
    {
      "id": "blockReference-…",
      "type": "blockReference",
      "layerId": "geometry",
      "blockId": "block-…",
      "transform": { "a": 1, "b": 0, "c": 0, "d": 1, "e": 10, "f": 5 },
      "definitionBounds": { "minX": 0, "minY": 0, "maxX": 4, "maxY": 2 }
    }
  ]
}
```

The matrix maps a local point `(x, y)` to `(a×x + c×y + e, b×x + d×y + f)`. Definitions may contain nested references, but recursive cycles are ignored by rendering and geometry traversal. Child entity IDs are local to their definition; associative child dimensions use those local IDs. `definitionBounds` is copied onto an anonymous reference so selection and recovery remain safe even if a referenced definition is unavailable, while a valid definition remains authoritative.

An embedded image descriptor contains its stable application ID, display metadata, and archive path:

```json
{
  "id": "asset-…",
  "name": "reference.png",
  "mimeType": "image/png",
  "width": 1920,
  "height": 1080,
  "path": "assets/0001-asset-….png"
}
```

The manifest never stores the image as a data URL. LUMCAD hydrates archive assets into in-memory data URLs only after validating the container, preserving the current renderer API without coupling the on-disk format to base64.

## Clipboard interchange

Clipboard data is not an `.lcad` archive. LUMCAD creates a versioned, bounded JSON payload as `application/x-lumcad-clipboard+json` and a complete XML/SVG representation as both `image/svg+xml` and `text/plain`. The SVG contains the JSON metadata, so the text fallback remains lossless between LUMCAD windows while applications that recognize SVG text receive vector geometry instead of raw JSON. The payload records metre units, a base point, original bounds, selected IDs, dependency-complete entities, referenced layers, embedded assets, and recursively referenced anonymous block definitions. IDs and cross-references are remapped when pasting into another drawing.

The SVG flavour contains `<metadata id="lumcad-clipboard">` with the escaped JSON payload. This clipboard rendering covers exact circular and elliptical arcs, cubic splines, compound paths, hatch boundaries, dimensions, images, and block-reference transforms; it is not an SVG file export command. External SVG paste accepts an optional XML declaration and simple SVG doctype, bounded `line`, `rect`, `circle`, `ellipse`, `polyline`, `polygon`, and path geometry using absolute or relative `M`, `L`, `H`, `V`, `C`, `A`, and `Z` commands, plus simple `translate`, `rotate`, `scale`, and affine `matrix` transforms.

Clipboard payloads inherit the 8 MiB JSON limit and additionally cap entity counts, block definitions and children, nesting, SVG path parts, transform depth, string size, and coordinate magnitude. Malformed, unsupported, cyclic, dangling, or unbounded input is rejected atomically. The macOS Tauri build writes the native types `com.lumcad.drawing-clipboard`, `public.svg-image`, `image/svg+xml`, and `public.utf8-plain-text`; it reads the custom type, both SVG identifiers, and UTF-8/plain-text variants. Browser builds only request formats reported by `ClipboardItem.supports()` and fall back to SVG text if a multi-format write is rejected as unsupported. Process memory is used only when no operating-system clipboard API exists, never as a fallback for a denied permission.

Affinity interoperability is SVG-specific: LUMCAD copy advertises native SVG and complete SVG text on macOS. In the other direction, Affinity's **Copy items as SVG** setting must be enabled so its clipboard contains SVG text (or a native SVG flavour). A normal Affinity copy that exposes only Serif-private, PDF, or bitmap flavours is not imported as editable LUMCAD geometry.

## Supported embedded assets

- PNG (`image/png`)
- JPEG (`image/jpeg`)
- GIF (`image/gif`)
- WebP (`image/webp`)
- SVG (`image/svg+xml`)
- PDF source (`application/pdf`)
- DWFx source (`model/vnd.dwfx+xps`)
- DGN source (`image/vnd.dgn`)

Assets keep their existing compressed bytes in the ZIP. The JSON manifest uses DEFLATE compression.
DGN source bytes use an `assets/*.dgn` entry with the same 25 MiB per-asset and aggregate limits. Browser and native archive storage preserve the bytes without interpreting geometry or accessing external paths. The source transport validates the bounded V7 record structure before creating its data URL; geometry compatibility remains the responsibility of the importer/attachment reader. The image attachment validator excludes this CAD source MIME type despite its `image/` prefix. DGNATTACH uses this resource type for portable vector references.
DWFx source bytes use an `assets/*.dwfx` entry, retain their original package bytes, and use the same 25 MiB per-asset and aggregate limits as other resources. The asset MIME validator accepts this source type; the image attachment MIME validator does not. Native source reading checks the extension, ZIP signature and byte limit; the bounded OPC/XPS reader must validate the package before it is attached. DWFx underlay creation is described below; the attachment command is still being integrated.

PDF source bytes use an `assets/*.pdf` entry and the same per-asset and aggregate
limits as images. Their descriptor retains positive width/height metadata; the
PDF parser determines the selected page's physical dimensions. PDF is accepted
by archive storage, not by the image attachment MIME validator.

DWFx underlays use a native block reference with a `dwfUnderlay` descriptor:
`version: 1`, `format: "dwfx"`, source `assetId`/`name`, integer
`pageNumber`/`pageCount` (1–10,000), and positive local metre `width`/`height`.
The anonymous block holds one PNG preview; the reference transform sets placement
and scale, and `blockClip` retains cropping. Clipboard and reference resource
collection retain/remap both source and preview assets. Unknown descriptor versions
or invalid dimensions/page ranges are discarded during normalization. DWFx
underlays cannot participate in dynamic/smart-block or block-constraint editing;
vector WMF materialization currently refuses them pending an explicit preview mode.

PDF underlays are native block references with a `pdfUnderlay` descriptor:
`version: 1`, source `assetId`/`name`, `pageNumber`/`pageCount`, local metre
`width`/`height`, optional-content `layers` (`id`, `name`, `visible`),
`snapsEnabled`, and bounded native `snapEntities`. The anonymous definition contains
one PNG image cache. The reference transform controls placement/scale; the shared
`blockClip` controls cropping. Source bytes remain authoritative for layer changes;
the cache supports portable display without reparsing. Clipboard resource remapping
retains both source and preview assets. Undo restores the reference and cached
geometry; unused assets may remain cached for history.

Decoding permits at most 10,000 pages, 2,048 optional-content groups and 100,000
vector segments per page, with a 25-second reader timeout and a four-million-pixel
preview. PDF JavaScript/evaluation and XFA are disabled. Fonts, character maps and
decoder resources are bundled locally; no remote resource service is used.

## Safety limits

The desktop and browser readers apply the same limits:

- manifest: 64 MiB maximum (8 MiB before 2026-10-08; LUMCAD builds from before that date refuse larger manifests);
- one asset: 25 MiB maximum;
- all assets: 200 MiB maximum;
- embedded assets: 512 maximum;
- asset paths must remain below `assets/` and cannot contain traversal components.

Duplicate paths, missing files, unreferenced entries, unsupported asset types, malformed ZIP data, and invalid manifests are rejected.

## Versioning

The current writer emits `formatVersion: 2`. Readers accept versions 1 and 2; version 1 documents receive default text-style, page-setup, paper-annotation, plot-setting, and extended viewport fields during normalization. Older version 2 documents that predate `plotSettings` receive the same plot defaults. The original IDs and all unaffected geometry are retained. Versions below 1 and future versions above 2 are rejected so later schema changes can be handled explicitly.

## Atomic writes and recovery

The desktop application creates the complete ZIP beside the target as a temporary file, flushes and synchronizes it, and atomically replaces the target. Unsaved drawings use the same ZIP structure in `recovery.lcad` inside LUMCAD's application data directory.

`EXPORTLAYOUT` writes a separate native archive using the same atomic writer. It
refuses the active drawing's path (including an existing symlink alias) and does
not clear that drawing's recovery file. Its model uses metres: paper coordinates
are divided by 1000. Each viewport is a native block insertion with a local polygon
clip and separate layer snapshot; paper annotations form another insertion.
Annotation representations are frozen at the viewport scale and external links
are replaced by their cached native geometry. Unloaded references and hidden
viewport geometry remain hidden. No archive version change is required.

### Construction lines and rays

Native `xline` and `ray` entities store `x1`, `y1`, `x2`, `y2` in metres together with the usual stable ID, layer and appearance fields. The first point is the origin; the distinct second point defines direction. `xline` extends in both directions, while `ray` extends only forward from its origin. No artificial finite length or infinity is serialized. Creation rejects coincident or non-finite defining points; invalid degenerate definitions do not render or participate in snaps.

Rendering intersects this geometry with the current view, including the inverse-transformed bounds of rotated layout viewports and block instances. Navigation bounds use the two defining points to keep Zoom Extents finite. Crossing selection uses the unbounded geometry; containment windows never wholly contain it. The origin grip translates both points, and the direction grip changes only the second. The second point is not an endpoint snap; only a ray's origin is an endpoint. Clipboard JSON and archive round trips retain the type and definition, while the SVG clipboard preview is clipped to its finite viewBox. These entities remain outside the bounded curve/path kernel; join, path-array source extraction and bounded-curve trim/extend do not convert them silently into finite segments.

### User-created ellipses

`ELLIPSE` creation writes the existing native `ellipse` representation: centre `cx`/`cy`, positive radii `rx`/`ry` in metres, rotation in degrees, `fullEllipse`, parameter-domain `startAngle`/`endAngle` in radians and `counterClockwise`. A full ellipse retains a full domain even when both stored angles are zero; an arc must have a nonzero sweep. Axis radius X need not be larger than radius Y. The interactive axis endpoint sets rotation and radius X; the third point sets its perpendicular radius. Arc direction picks are converted into ellipse parameter angles. The shared property editor exposes those parameter angles in degrees. Full ellipses have no endpoint or midpoint snap; open elliptical arcs retain endpoints and their curve midpoint.

### Elliptical-axis dimensions

A `linearDimension` may refer to an `ellipse` through `sourceId`. Its existing `edgeIndex` identifies the full axis diameter: 0 for the local X axis (`rx`), 1 for the local Y axis (`ry`). The same convention applies to an elliptical arc's supporting ellipse and to `sourcePointReferences`; `endpointIndex` selects the negative or positive axis endpoint. Geometry is resolved from the current source on every render, so radius and rotation edits update the measurement. Linear/horizontal/vertical/rotated projection and aligned measurements use the same dimension model, formatting, undo and dependency remapping as other linear dimensions.

Affine ellipse transformations choose the principal direction closest to the transformed original X axis, preserving axis order when axis-aligned scaling reverses the radius size order. Under shear these remain principal ellipse axes, rather than nonorthogonal transformed diameter vectors. No circular-radius measurement is inferred for a non-circular ellipse.

### Elliptical arc-length dimensions

The existing `arcLengthDimension` representation may use `sourceId` to refer to an open native `ellipse`. `offset` remains a distance in metres. Measurement uses adaptive integration of the source elliptical arc, shared with path-length queries, with bounded refinement near highly eccentric tips. Rendering derives a parallel annotation curve along the ellipse normals, adaptively tessellated with a model-space display tolerance of `max(1e-6, max(rx, ry) * 1e-4)` and a 4096-point work limit. No sampled annotation geometry is persisted. An offset at or beyond the inward minimum curvature radius is invalid. Extension lines, ticks and text continue through the shared model/layout/print, clipboard and explode renderers. The label sits at half the source arc length, and its grip projects onto the normal there.

### Ellipse offset results

An ellipse's constant-distance parallel is generally not another ellipse. `OFFSET` therefore writes the existing `polyline`/`parts` representation with cubic `spline` parts (four Bézier control points each), preserving appearance and destination-layer semantics. Full-ellipse results are closed with exactly matching first/last coordinates; elliptical-arc results remain open. Adjacent parts retain tangent continuity. No extra schema, external asset or source dependency is introduced.

Fitting targets 0.00001 m, using analytic normal-offset derivatives, adaptive subdivision and interior error probes with a safety factor. It is bounded to 256 parts and depth 20; failure returns no partial result. Regular inward offsets must stay above the negative minimum curvature radius over the source's actual angular domain. Singular parallels are rejected rather than storing self-intersecting cusp geometry. The stored spline geometry participates in the existing selection, control-grip editing, transforms, archive, clipboard, layout and print paths.

### User-created splines

`SPLINE` writes one existing cubic `spline` entity for a single span, or an open `polyline` with exact cubic `parts` for multiple spans. FIT creation solves a natural cubic interpolant in chord-length parameter space. CONTROL/CV creation uses a clamped uniform degree-three knot vector and exact knot insertion to obtain Bézier spans. Both are bounded to 128 input points and reject invalid/degenerate output before commit. The optional additive `splineDefinition` retains `mode` (`fit` or `control`), original world-space `points`, and normalized `knots`. FIT stores one strictly increasing parameter per point, initially normalized cumulative chord length. CONTROL stores a clamped cubic knot vector of length point-count + 4, with four 0s and four 1s and internal multiplicity at most 3. Distinct parameters differ by more than 1e-9. No new entity type or archive version is introduced.

Point/parameter edits regenerate exact Bézier spans. Parameters remain fixed through point edits and affine transforms, preserving the original curve under shear or nonuniform scale. Definition points transform with the geometry. Normalization validates the definition against the stored controls (1e-8 m); invalid or stale definitions are detached while the stored geometry remains authoritative. Direct Bézier editing and explicit BEZIER conversion detach the definition. This prevents trim/break or other native-geometry operations from resurrecting old geometry. Native storage retains metadata without interpreting it; frontend normalization validates the bounded definition.

After conversion to Bézier controls, cubic-path edits through `SPLINEDIT`, the shared coordinate panel and grips preserve connected adjacent endpoints (including closed seams). Endpoint moves translate adjacent controls; control moves at previously smooth joints preserve the opposing tangent ratio. Intentional corners and disconnected spans remain independent. This preserves geometric tangent continuity, not a stored fit-point interpolation or second-derivative constraint. Edits validate all affected native spans before a single history commit. Associative arrays must be edited with their array workflow or exploded before spline editing.

FIT definitions may also contain `startTangent` and/or `endTangent` as finite nonzero `{x, y}` derivatives with respect to the normalized parameter (components bounded to 1e12). Missing tangents mean natural second-derivative boundary conditions. The tridiagonal cubic solve combines natural and clamped boundaries and preserves C2 continuity in the fixed parameter domain. Affine transforms apply only their linear part to these vectors. CONTROL endpoint tangent edits instead change the neighboring vertex using its clamped knot interval; no tangent constraint metadata is stored for CONTROL.

Point insertion/removal rebuilds the initial FIT chord or CONTROL uniform parameters and may change shape; constraints at removed/replaced endpoints are dropped. Exact CONTROL knot insertion adds one point and knot while preserving the parameterized curve. Exact native-cubic-to-CONTROL conversion concatenates Bézier controls with triple internal knots; FIT conversion intentionally refits native span endpoints or open point-polyline vertices. POLYLINE conversion removes spline metadata and emits existing straight `points`, with a convex-hull flatness bound against each accepted chord. Its user tolerance is in metres (minimum 1e-8), with at most 4096 vertices and subdivision depth 20; an unmet bound returns no partial result. Definition operations remain capped at 128 points. Conversions preserve identity and appearance. No additional archive fields are required.

### User-created associative hatches

`hatch` entities retain `boundaries` as closed native curve paths and optional `sourceIds` for their selected source entities. Creation accepts closed curves and unbranched endpoint-connected chains, bounded to 512 native parts and 512 source entities. No curve-to-chord conversion is stored. Multiple loops use even-odd filling for islands. `pattern.name` is `solid`, `lines`, `cross`, `gradient` or `radial`; `spacing` and `origin` are in metres, `angle` in degrees. Gradient `endColor` is a six-digit hex colour; its start colour resolves through normal entity/ByLayer appearance. Whole-entity transparency applies without extra implicit opacity.

History commits and document loading refresh associated boundary snapshots from current sources. Independent hatch geometry changes detach `sourceIds` instead of snapping back; explicit DETACH does the same. Missing/open sources on reload detach while retaining the last closed snapshot. Ordinary source deletion follows the existing dependency-deletion policy. Shared source+hatch transforms retain association when their geometry agrees. Clipboard dependency remapping preserves associations and embedded JSON; its SVG flavour renders patterns, gradients and even-odd loops. The shared model/layout/print renderer uses the same paint definitions. Optional `fillRule: "nonzero"` switches a hatch from its default even-odd interior to the nonzero winding rule; optional `boundaryStroke: false` suppresses its outline. PDF solid-fill import uses these additive fields. Selection, SVG output and simple disjoint-loop area/moment measurements respect the chosen rule; nonzero area/perimeter exclude redundant same-winding inner loops. Regions retain their even-odd contract and discard these hatch-only fields. Native archives preserve these additive version-2 fields without a schema-version change.

Interior-picked hatches also store finite `boundaryPick: {x, y}` in model metres. Their `sourceIds` contain participating contours only. Refresh redetects the face at that seed; shared affine transforms transform the seed with the hatch. If the seed no longer identifies a valid face, refresh detaches the association and seed while preserving the last snapshot. A source edit that moves the intended region away from its seed therefore requires a new pick. Interior containment sampling never replaces persisted native curves.

### Planar regions

`region` entities store `id`, `layerId`, normal appearance properties and `boundaries` containing closed native polyline paths, using the same curve primitives as hatches. Loops define an even-odd interior and may include islands or disconnected closed components. Regions are independent snapshots: normalization removes hatch-only `pattern`, `sourceIds` and `boundaryPick`. They render as outlines and persist without curve tessellation. Affine transforms apply to every loop; clipboard JSON preserves the entity while SVG contains its native paths. This additive entity representation uses archive version 2.

Image entities may carry `imageAdjustments: {brightness, contrast, monochrome}`. Brightness and contrast are finite percentages clamped to 0–200, default 100; monochrome defaults false. These per-instance parameters do not modify embedded assets. In sRGB, each channel is transformed by `clamp(channel * brightness * contrast / 10000 + (1 - contrast / 100) / 2, 0, 1)`; optional grayscale then uses luminance weights 0.2126/0.7152/0.0722. Alpha is unchanged and entity opacity remains independent. These additive fields use archive version 2.

Image `imageClip` stores `{enabled, points: [{x, y}, …]}` with 3–128 simple polygon vertices in normalized fractions (0–1) of the unrotated normalized image rectangle. Missing/invalid clips show the full image; disabled clips retain their points. The image transform maps the clip into model/paper space. Source asset bytes and placement remain unchanged; rendering/export uses an SVG clipping path.

### Painter order and masking polygons

The `content.entities` sequence is the authoritative back-to-front painter order; order commands rearrange references while retaining IDs and geometry. A wipeout reuses the native closed point `polyline` representation with `wipeout: {frame: boolean}`. Its 3–128 vertices form one simple straight-edged polygon in model metres. It paints a white masking fill at its normal sequence position; its stroke is omitted when frame is false, including printing. Normal appearance transparency applies. Invalid/open mask geometry loses mask metadata during normalization. The source contours are not dependencies and remain independent. These fields are additive within archive version 2.

`imageAdjustments` additionally accepts optional `transparentColor` (`#rrggbb`) and `colorTolerance` (0–100%, default 0). Invalid colours disable keying. Matching uses each original 8-bit RGB channel before other adjustments, with maximum difference `floor(255 * colorTolerance / 100)`; matching pixels become alpha zero, other alpha values remain unchanged. SVG uses discrete channel membership tables, and export pixel processing applies the same rule before resizing. No new asset or archive version is required.

## Linked image sources

An image may additionally contain `imageSource: { mode: "linked", path: "/absolute/path/reference.png" }`. Paths are bounded to 4096 characters, without control characters; malformed metadata is removed by document normalization. The canonical absolute native path is saved on successful attachment/reload. `assetId` still points to an ordinary embedded, last-good image snapshot; version 2 archive structure and asset limits are unchanged. Opening, autosaving, clipboard interchange and printing never dereference the path. Browser and Rust archive round trips preserve source metadata and cached bytes even if the external file is missing.

Explicit Tauri attach/relink/reload reads a regular local file bounded to 25 MiB, checks supported image signatures and decodes its dimensions (at most 64 megapixels). A successful reload creates or reuses an immutable embedded asset and swaps the entity reference in one history edit. Earlier assets remain available for undo. Failure does not change the image. `IMAGE EMBED` removes only `imageSource`. Placement, rotation, crop and image adjustments are per-entity and survive all these source operations. No automatic source monitoring or relative-path resolution is performed.

Named definitions use the same representation as anonymous pasted blocks. `BLOCK` stores its chosen base point at local (0, 0) by translating child geometry; references carry the world insertion matrix. Names created through the editor are 1–128 characters, unique ignoring case, and exclude control characters and `< > / \ " : ; ? * | =`. Redefinition preserves the definition ID and refreshes derived bounds on nested and model references. The authoritative child geometry is used to rebuild caches during normalization. Definition cycles are rejected by the creation workflow; existing malformed cyclic data retains bounded traversal. Copying a different named definition into an occupied name allocates a numbered suffix.

Block-edit sessions are transient and do not introduce an archive schema change. `BSAVE` validates the local dependency graph and applies the draft entities to the existing definition ID; model reference IDs and transforms are retained and bounds are refreshed. New layers, text-style edits, nested definitions and referenced image snapshots are adopted on save. Root-only layers are retained even if removed from the isolated draft. Unsaved draft geometry/assets do not enter the archive or model autosave; `BCLOSE DISCARD` keeps the last applied definition.

The optional `content.metadata.basePoint` stores the drawing insertion base in model metres as finite `{x, y}` coordinates bounded to ±1e12. Older or malformed values normalize to `{x: 0, y: 0}`. `BASE` changes this metadata through history without translating entities. It is additive within archive version 2.

A block library is a normal version 2 `.lcad` archive with `content.metadata.blockLibrary: {version: 1, entryBlockIds: [...]}`. Each entry ID identifies a definition in `content.blocks`; model entities are identity references to the entries so the archive can also be opened as a drawing. Nested dependencies, their layers, text styles and embedded assets travel with the library. Imported entry references are discarded after resource merging; only definitions are added to the destination. Invalid entry markers, cyclic definitions and missing child dependencies reject the import. Aggregate archive limits are checked before committing. The metadata is additive and retained by native storage; it does not introduce a second archive format.

Block children whose `layerId` is `geometry` (the protected layer `0`) resolve to their enclosing reference’s layer at runtime. This rule applies at every nesting level; definitions themselves remain unchanged. Decomposition writes the resolved layer ID to the resulting entities. Explicit child layer IDs and appearance overrides are retained.

Images and text may contain `affineFrame: {a,b,c,d,e,f}` after decomposition of a nonuniformly transformed block. Local rectangle, rotation, reflection, text layout and crop coordinates remain unchanged; this outer matrix maps them into model coordinates. Coefficients are finite and bounded to ±1e12, with determinant magnitude at least 1e-12; invalid frames are removed at normalization. Move/rotate/scale/mirror compose into this matrix; grips map pointer coordinates back into the local frame. Canvas, layouts/printing and clipboard SVG apply the matrix outside the existing local transforms. This additive version 2 field is retained by native storage.

Attribute definitions reuse native `text` entities with `attributeDefinition: {tag, prompt, constant, invisible}`; the entity’s `text` is the default value. Tags normalize to uppercase, start with A–Z and contain A–Z/0–9/underscore/hyphen (64 characters maximum); prompts are bounded to 256 characters. Definitions created or saved by the editor have at most 256 unique tags per block. A block reference may carry `attributeValues: {TAG: "value"}` with at most 256 string values of 16,384 characters each. Missing values fall back to the current default, constants always resolve from their definition, and ATTSYNC preserves matching values by tag while adding/removing fields. New insertions snapshot defaults. `content.settings.attributeDisplay` is `normal`, `all` or `off`, with `normal` as the backward-compatible default. Display never removes stored values. EXPLODE materializes values as ordinary text, including invisible values so their data is retained. Clipboard and library remapping leave tags intact. All fields are additive within archive version 2.

Reference `definitionBounds` caches are refreshed from resolved instance attribute values (including nested references). Long single-line values contribute their laid-out extent without changing the definition’s text frame or placement. These caches remain derived; archive normalization recomputes them when definitions are present.

### Dimension style catalog

`content.dimensionStyles` stores named styles with stable `id`, `name`, metre-valued `textSize`, `arrowSize`, `extensionGap`, `extensionOverrun`, `arrowType` (`tick`, `closed`, `open`, `none`) and the existing `dimensionFormat` structure. `activeDimensionStyleId` resolves to an existing style, falling back to `dimension-style-standard`. Dimensions may store `dimensionStyleId`, resolved appearance snapshots and `dimensionStyleOverrides`; snapshots keep their appearance portable when the source catalog is unavailable. Catalog normalization rejects duplicate IDs/names and supplies a standard fallback. Clipboard payloads and block libraries carry referenced dimension styles. Import remaps conflicting IDs and names without changing resolved appearance, per-dimension overrides or the destination active style; imports exceeding the 128-style catalog limit fail atomically. Older clipboard payloads without a catalog retain appearance snapshots and discard unresolved style links. Copies of legacy dimensions without a style link materialize all appearance defaults before history assigns the current style, retaining these values as overrides. Document replacement does not apply creation styles to imported entities. The catalog is additive in archive version 2. UI/command and rendering integration is tracked in TOOL_ROADMAP.md.

### Detached dimensions

After DIMDISASSOCIATE, linear/angular/ordinate dimensions retain their defining points without dependency IDs. Radius, arc-length and centre-mark entities may store `detachedSource`, a bounded native circle/arc/ellipse primitive containing only geometry fields (no IDs, assets, nested content or appearance). It is authoritative only when the dimension has no source dependencies. Translation, rotation, reflection and affine scale transform this local primitive with the dimension. Nonuniform scale/shear retains an exact ellipse or elliptical arc. Detached radial dimensions then measure the centre-to-contour distance along their transformed direction (twice that distance in diameter mode), not an ellipse radius of curvature; centre marks follow the transformed centre. Associative radial creation still requires a circle/arc. Reassociation removes the snapshot and restores explicit dependency IDs. These additive fields retain archive version 2.

Dimensions may carry `dimensionTextOverride`, a string of at most 16,384 characters. Absence means automatic formatting; an empty string suppresses the measurement label. Each `<>` placeholder expands to the live formatted measurement. Inspection labels/rates remain independent. The field is additive in archive version 2 and is preserved by clipboard and native storage.

Optional `dimensionTextPosition` is a finite world-coordinate point in metres and `dimensionTextAngle` is a finite angle in radians. They override label presentation only, follow entity transformations, and do not change measurement geometry or label content. DIMTEDIT HOME removes both overrides. These fields are additive in archive version 2.

Linear dimensions may store `dimensionExtensionAngle`, a finite world angle in radians, for oblique extension lines. The measured value remains the projection of source points onto the measurement axis. Absence means perpendicular extensions. Rotation, reflection and affine transforms map this direction with the dimension. Parallel extension/measurement directions have no valid intersection and command edits reject them atomically.

`dimensionBreaks` stores up to 128 manual display gaps as `{kind: "line"|"arc", index, start, end}`. `index` addresses the raw dimension primitive (0–10000); finite `start`/`end` are normalized into ascending fractions of its styled length in [0,1]. Overlapping intervals are merged for rendering. Gaps follow the same relative primitive positions after geometric changes and transforms. They do not affect the measured value, sources, arrowheads or label. Unknown/invalid entries are discarded. DIMBREAK REMOVE clears them. This is additive in archive version 2.

`dimensionAutoBreak` stores a positive metre-valued `gap` (at most 1e6) and up to 1000 unique curve `sourceIds`. Automatic gaps are derived at presentation time and are not persisted as manual intervals. Missing sources contribute no intersections; dependency remapping updates IDs when available. These are display references, not measurement dependencies. A calculation exceeding 128 gaps or 100000 curve pairs produces no automatic gaps; commands reject that state at creation. Manual gaps remain visible. The field is additive in archive version 2.

Automatic-break sources may also be native dimensions: their styled lines/arcs, including manual gaps, are used as obstacles. Their automatic gaps, labels and markers are excluded, so mutual automatic-break references have deterministic finite evaluation.

Automatic-break source IDs may identify block references. Their transformed curve children and local dimensions are evaluated lazily through the document block catalog; nested references are bounded to depth 16 and cycles terminate. Hidden child layers are excluded when layer context is available. No exploded copies are persisted.

Block-obstacle extraction also caps the total inspected child occurrences at 10,000 per root reference, including empty nested branches. Exhausting that budget or nesting depth suspends automatic gaps; the selected dimension properties report the condition and allow disabling automatic gaps. The configuration and manual gaps remain intact.

### Centre-line annotations

`centerLine` is an additive dimension-family entity in archive version 2. `sourceIds` contains two line-segment IDs; the annotation follows their midline (parallel sources) or angle bisector (intersecting sources). `alternateBisector` selects the perpendicular bisector for intersecting lines. Extents project the four source endpoints onto the annotation axis; `extension` adds a nonnegative metre distance at both ends (default 0.25, maximum 1e6). Detached annotations retain unextended world endpoints in `p1`/`p2`. Source endpoint reversal preserves the chosen bisector. Invalid or missing sources produce no geometry. There is no measurement label. The shared dimension rendering, bounds, copy/remapping and transform paths apply.

### Named selection groups

`content.groups` is an optional array of `{ id, name, entityIds, selectable }` records. Names are unique ignoring case and limited to 256 characters; up to 10,000 groups are normalized. Membership refers to stable model entity IDs without owning or transforming geometry. Overlapping selectable groups expand selection transitively over visible members. Empty groups, duplicate IDs/names and dangling members are removed at normalization boundaries. Groups are drawing-local (not block definitions or clipboard payloads). Existing files without groups load with an empty catalog. Group edits use document undo/redo; deleting a member and undoing restores its membership.

### Named model views

`content.namedViews` stores up to 256 `{ id, name, x, y, width, height }` records. Coordinates are the view centre in metres and width/height are positive model extents. Names are case-insensitively unique and limited to 128 characters; extents are finite and bounded to 1e9 metres with spans of at least 1e-6 metres. Invalid or duplicate records are discarded on load. Restoring a view preserves its centre and includes the saved extent at the current canvas aspect ratio. Import from another `.lcad` regenerates only imported view IDs and suffixes colliding names. Catalog edits participate in undo/redo; viewport navigation does not alter geometry history.

### Saved selection filters

`content.selectionFilters` contains up to 128 `{ id, name, criteria }` records with unique IDs and case-insensitively unique names (1–128 characters). Each filter has 1–16 `{ field, operator, value }` predicates. Supported fields are TYPE, LAYER, COLOR, LINETYPE, WEIGHT, TRANSPARENCY, BLOCK and LOCKED. String predicates support equality/inequality; weight/transparency also support ordered numeric comparisons. Invalid entries are discarded on normalization. Filters store criteria, not stale object IDs. Static count schedules consist solely of ordinary grouped text and line entities and require no new entity schema.

### Leader annotations

A leader is a native `blockReference` with optional validated `leader` metadata: version 1, 1–32 local-coordinate branches (2–128 points each, at most 1024 total), and a style snapshot (`textSize`, `arrowSize`, `landingLength`, `arrowType`: closed/open/none). Its anonymous definition contains ordinary line/hatch geometry followed by a text or nested block annotation. Content and arrow editing regenerate that definition with copy-on-write isolation. General affine transforms remain on the reference. Invalid metadata is discarded without deleting its native geometry. `content.leaderStyles` stores up to 128 case-insensitively unique named presets (names up to 128 characters); absent catalogs default to empty. Presets do not create live style associations. Clipboard and library dependency remapping use the existing nested block graph; metadata contains no definition IDs.

### Layer states and flags

Layers optionally carry `frozen` and `newViewportFrozen` (default false), and `plot` (default true). Frozen layers retain geometry but do not participate in display, selection or snapping. New-viewport freeze initializes the new viewport’s existing `hiddenLayerIds`; it never retroactively changes saved windows. Non-plot layers remain visible in editing and are hidden in publication.

`content.layerStates` contains up to 128 unique named snapshots, each with `name` (128 characters maximum), `activeLayerId` and up to 2048 layer records keyed by stable `id`. Snapshots retain visibility, freeze, locking, plotting and appearance. Restoration updates surviving layer IDs only, preserving new layers and geometry. Layer merging remaps model/nested/paper geometry and viewport hidden-layer references atomically with the existing document history. Source appearance overrides in viewports are dropped in favor of target-layer settings.

### Plot styles and output profiles

`content.plotStyles` contains up to 256 unique named rules (`name` up to 128 characters, optional `sourceColor`, output `color`, `lineWeight`, `lineType`, and `screening` 0–100). `content.settings.plotStyleMode` is `off`, `color`, or `named`; entities/layers may carry `plotStyleName`. These are drawing-native CTB/STB-like tables, not binary Autodesk CTB/STB files. Mapping resolves effective layer/instance appearance only during publication; stored model appearance is unchanged.

Normalized layout/page-setup `plotSettings` may include `deviceProfile` (`pdfVector`, `pdfRaster`, `systemPrint`) and `stamp` (`enabled`, single-line `text` up to 512 characters, `sizeMm` 1–10). Profiles initialize rendering quality and retain normal explicit publication controls; physical-printer selection remains in the system dialog. Stamps expand `{layout}`, `{date}` (UTC publication date), and `{scale}` (fixed plot scale or a dash for fit), are placed in paper millimetres, and are fitted to printable width. Existing page-setup archive/import paths retain these fields.

### Units, UCS and drawing limits

Internal coordinates, lengths and `.lcad` geometry remain metres. `content.settings.units` optionally defines display/alternate/insertion units (`mm`, `cm`, `m`, `km`, `in`, `ft`, `yd`), 0–8 digit precision, angle format (`degrees`, `radians`, `gradians`), angle precision, base angle in degrees and clockwise input direction. The insertion unit is metadata for unitless interchange; known-metre native drawings are not rescaled. Bare length input retains metre semantics, and explicit suffixes are converted by the existing expression parser.

`settings.ucs` stores finite world origin `x`, `y` and normalized degree `rotation`; absent values mean world origin/zero rotation. `content.namedUcs` stores up to 128 case-insensitively unique named frames. `settings.ucsIcon` defaults true. `settings.limits` is null or finite ordered world bounds `minX/minY/maxX/maxY` plus `enabled`. Origins/bounds are limited to ±1e9 metres. These affect coordinate entry/display and drafting aids, never rewrite entity coordinates. The stored Y axis remains screen-down.

### Annotative objects

Text, dimensions, hatches and block references may carry
`annotation: { baseScale, scales: [{ scale, offset: { x, y } }] }`.
Denominators are finite numbers from 0.001 to 1,000,000. Each object has 1–64
unique representations; the ratio to `baseScale` is bounded to 1e-6–1e6.
Offsets are finite world-metre coordinates bounded to ±1e9. Optional
`content.annotationScales` is a unique sorted catalog of at most 128 denominators;
`settings.annotationScale` chooses the model context (default 100), and
`settings.annotationShowAll` exposes otherwise unlisted model representations.

Canonical geometry is stored at the base denominator. Contextual geometry is derived
for model interaction and for each viewport's actual scale. Symbols used to invert
live edits never enter the archive. Text/block geometry scales about its insertion;
dimensions scale their presentation without moving witness geometry; hatch spacing
scales without moving its boundary. Representation offsets move text/block insertions,
dimension labels, or hatch origins. Leaders derive text/arrow/landing geometry while
preserving their arrow targets, including when the content offset changes. Temporary
leader definitions are discarded when edits return to canonical storage. Their bounded
expansion permits at most 1,024 derived definitions and 100,000 generated children;
excessive contexts are hidden with an editor warning. Explicit OFF/rebase operations
retain the required native snapshot definitions within normal document limits.

Native archives, clipboard payloads and shared geometry edits retain scale metadata.
Clipboard SVG uses the source model annotation scale while the embedded native payload
retains canonical geometry. Tiny text representations use native affine frames so
font validation does not distort paper size. Paper annotations remain in millimetres
and do not acquire model annotation scaling.


### Block clipping and reference storage foundation

A block reference may contain `blockClip: { enabled, points }`, with 3–128
simple polygon vertices in definition-local coordinates. Coordinates are finite
and bounded to ±1e9. Normalization drops degenerate or self-crossing contours.
Rendering, SVG publication, selection bounds and recursive native-curve snapping
respect the same transformed contour. EXPLODE refuses an enabled clipped reference
until its clip is disabled, avoiding silently revealing discarded geometry. A
clip may alternatively carry `paths` (1–1024 closed contours, at most 4096 line or
four-control-point cubic `spline` parts in total) and `rule: "evenodd" | "nonzero"`.
These definition-local native curves use the same ±1e9 coordinate bound. The
renderer and SVG retain exact curves and winding holes; bounds use cubic extrema,
while snapping intersects native curves and classifies intervals with bounded
boundary sampling. The alternative is additive in archive version 2. XCLIP
ON/OFF/DELETE also operates on imported curve clips; RECT/POLYGON replaces them.

Native reference reads return a canonical source path and a SHA-256 file revision,
with a 300 MiB input limit. Reference writes require that revision and check it
immediately before atomic replacement. They do not clear the host recovery file.
This detects stale edits; it is an optimistic check, not a filesystem transaction
against writes from other processes. Source editing uses an explicit revision-checked save from a separate editor draft.

External drawing reference snapshots use ordinary block definitions and assets.
Their root insertion carries bounded `externalReference` version 1 metadata:
source path/name/document ID, `attach` or `overlay` mode, loaded flag, revision,
source base point, source-to-host resource maps and imported resource ownership.
Unloaded snapshots stay in the archive but have no rendered geometry, bounds or
snaps. Overlay insertions are omitted when their host drawing is attached elsewhere.
Reload preserves the host insertion ID, transform and clip; orphaned owned resources
are reclaimed while shared definitions and catalog assignments remain. Binding
removes reference metadata, retaining the cached native geometry. Linked insertions
must be bound before EXPLODE. Native source editing preserves the full source document (including layouts, groups and unused resources), edits it in source coordinates with faded host context, and writes only on REFSAVE or REFCLOSE SAVE. Host undo restores its cached insertion, never the external file. Browser snapshots can be relinked in the desktop application for source editing.

Nested reload follows attached sources up to 8 levels and 32 files, with an aggregate 300 MiB serialized-cache budget. Missing nested files retain cached geometry and report a warning; cycles and budget overflow refuse the reload. Clipboard remaps reference resource mappings and ownership, retaining source child IDs and protecting pre-existing destination resources. XCOMPARE compares native entities and referenced resources without updating the cache.

Image entities may set `imageRendering: "pixelated"` to retain nearest-pixel sampling (notably for PDF images with interpolation disabled). Missing or invalid values use normal browser interpolation. The field is preserved by native storage, clipboard SVG and shared model/paper rendering; it is additive in archive version 2.


### Editable linework definitions

An optional additive `linework` descriptor accompanies cached native `hatch` or `polyline` geometry. `kind: donut` stores inner/outer diameters and a nonsingular affine `transform` (`a,b,c,d,e,f`); zero inner diameter makes a disc. `kind: multiline` stores 2–512 local centreline points (at least 3 when closed), `closed`, positive `scale`, `justification` (`zero`, `top`, `bottom`), and a style snapshot with 2–16 distinct offset elements, optional element colour/linetype, end caps (`none`, `line`, `arc`) and fill. `kind: wide` stores the same local centreline and one `{start,end}` width pair per segment. Diameters and widths are in metres and bounded to 1000000. Valid definitions regenerate the cached geometry during normalization; invalid optional metadata is discarded while retaining the native geometry. Transform and grip edits update the definition and materialization together. No new archive version is introduced. Commands and shared property fields edit these descriptors through the normal history path.

`content.multilineStyles` stores up to 128 normalized styles, unique by case-insensitive name, with Standard supplied by default. Existing objects retain their style snapshots when a catalogue entry is changed or removed.

Wide linework also retains one signed `bulges` value per segment (`tan(sweep/4)`, zero for a line). Missing bulges normalize to zero. Curved ribbon contours use bounded subdivision with a 0.0001 m world-space interpolation tolerance and retain their analytic centreline parameters for editing. Inner-radius collapse and subdivision-budget overflow reject the edit. Zero-width circular segments materialize as exact ellipse arcs.

Curved wide ribbons use consistently wound segment and bevel-join contours in a single `nonzero` solid hatch so overlapping joins do not punch holes or compound opacity. Straight-only paths retain miter joins with a bounded bevel fallback.

### Revision symbol definitions

Native polylines may retain `revisionSymbol` metadata. A `cloud` stores its closed native source path, positive `arcLength`, `reverse`, and an affine transform; regeneration places up to 2048 connected native ellipse arcs along the source. A `break` stores local `start`/`end`, positive zigzag `size`, nonnegative endpoint `extension`, fractional `position` and affine transform. Invalid optional definitions are discarded while cached geometry is retained. Shared properties and source-based grip edits regenerate the cached symbol; polygon cloud grips preserve connected source edges.

### Editable tables

A native compound polyline may retain a `table` descriptor containing a rectangular `cells` array of source strings/formulas, style snapshot, row heights, column widths, non-overlapping merge rectangles and affine transform. Limits are 256 rows, 64 columns and 4096 cells. Formula results are derived and not substituted into the stored cell source. Text and grid parts have deterministic IDs derived from the table ID and cell/grid coordinates; normalization regenerates them. Internal grid rules are omitted across merged cells, whose hidden values remain available on unmerge. Invalid optional metadata falls back to the cached native geometry. The cell editor, named style snapshots and CSV snapshot import/export use this descriptor. `content.tableStyles` holds up to 128 named styles, including Standard. Count schedules now use this table representation; older text/line schedules remain readable. Optional per-cell `style` contains only explicit fontSize, padding, color, alignment and bold overrides; omitted values inherit from the table snapshot. `table.dataLink` optionally stores `{ name, path, delimiter }`: a CSV filename, an absolute native CSV path (null for browser-selected sources), and comma/semicolon/tab. Invalid link metadata is discarded without losing cached cells. Links survive archive/clipboard operations but perform no external reads until explicit DATALINKUPDATE. Refresh preserves placement and surviving formatting/dimensions, extends dimensions with table-style defaults and removes out-of-bounds merges. Detach preserves values. No archive-version change is required.


### Linked text fields

Model and paper text entities may store an optional `field` definition while `text`/`runs` retain the cached display. Normalization validates the descriptor without evaluating it; invalid optional definitions are dropped and cached text remains readable. Field kinds are `metadata` (`key`), `document` (`property`), `object` (`entityId`, whitelisted `property`), `table` (`entityId`, A1 `address`), `field` (`entityId`), `date` (`format`), `page` (`property`, optional `layoutId`), and `formula` (`expression`, named `bindings` of field definitions). Optional `prefix` and `suffix` are each limited to 512 characters; numeric `precision` is an integer 0–8. Expressions are limited to 512 characters, 32 bindings each and eight nested definition levels. Entity/layout IDs are nonempty strings of at most 256 characters. Reserved prototype keys and arbitrary object paths are rejected.

UPDATEFIELD evaluates a document/time snapshot, detects field-reference cycles, bounds traversal depth and limits output to 4096 characters per field. Geometry and table formula sources reuse shared evaluators. Date values use UTC. Paper page fields infer the containing layout; explicit layout IDs remain stable through renaming/reordering. Cached display updates preserve the field definition, stable text ID and appearance; they are ordinary document-history edits. Detached fields retain cached text. Archive version 2 remains unchanged.

Clipboard dependency closure and ID remapping cover object/table/field sources and nested formula bindings. Source deletion keeps dependent field text rather than cascading deletion; the next explicit update displays a missing-reference error. No field evaluation loads files or invokes scripts. CSV reads remain explicit DATALINKUPDATE operations on table sources.

### Geometric tolerances

Compound polylines may store an optional `tolerance` descriptor: `rows` (one to four), `style` (shared table-style snapshot), nonsingular affine `transform`, optional string `projectedHeight` and `datumIdentifier`. Each row stores a whitelisted `symbol`, one or two `values` (`value` numeric string, `diameter` boolean, `material` empty/M/L/S), and up to three `datums` (`label`, `material`). Numeric labels retain lexical precision and decimal dot/comma; values must be finite and nonnegative, projected heights strictly positive. Datum labels are uppercase alphanumeric/hyphen identifiers starting with a letter, at most eight characters.

Normalization regenerates native line/ellipse/text parts with deterministic IDs from valid descriptors; invalid optional tolerance metadata is removed while cached geometry remains available. Labels are single-line text, symbols native vectors, and frame transformations compose into the retained affine matrix. Style snapshots use `content.tableStyles`; they do not establish live catalogue links. EXPLODE removes the descriptor and emits independent primitives. Archive version 2 is unchanged; no external font or file dependency is introduced.

### Dynamic block definitions

A block definition may retain optional `dynamic` metadata with `parameters`, ordered `actions`, `visibility` and `lookups`. The catalogue is limited to 64 uniquely named parameters (distance, angle, number, point, flip, choice), with typed defaults, numeric intervals/steps and bounded choices. Up to 128 actions target stable local entity IDs: move, rotate, scale, flip, stretch or array. Actions retain their local direction/origin/axis/window/spacing. An instance evaluation starts from definition geometry; no evaluated geometry is written back to the source. Array output is bounded to 10,000 entities and 1,024 occurrences per action.

Visibility maps every choice of its selector to explicit visible local IDs. Up to 64 lookup tables map selector choices to typed parameter assignments. Every row supplies the same output columns. Multiple writers and cyclic selector dependencies are rejected; tables normalize into dependency order. Optional malformed dynamic metadata is discarded during archive normalization without losing the static definition geometry. Definition copying remaps action targets and visibility membership with the same local ID map as native entities. Block references retain optional `dynamicValues` keyed by parameter name. Instance geometry is shared by canvas/print rendering, bounds, snapping, materialization, nested counts and SVG output. Invalid saved overrides recover to parameter defaults; explicit edits validate the whole selection and reject invalid or lookup-driven assignments. Reset removes overrides and retains identity/placement. BEDIT retains its dynamic definition in the isolated `blockDynamicDraft` content field; saving validates it against the current local entities and writes it onto the block definition. BPARAMETER/BACTION and instance reset are implemented; lookup/visibility authoring and instance-panel visual verification are implemented. Parameter/action authoring panels are implemented and browser-verified; smart detection/conversion/replacement use the existing block and reference schemas without additional archive fields. Conversion is explicit and atomic; outside dependencies, partial group membership and interleaved painter order are rejected.


### Geometric constraint catalog (P2 integration in progress)

`content.geometricConstraints` is an optional array of at most 256 relationships. Its absence remains equivalent to no constraints and does not add a field to older drawings. Each entry contains a unique stable `id` (1–256 characters), a `type`, and one to three `refs`. Supported relation names are `coincident`, `collinear`, `concentric`, `equal`, `fix`, `horizontal`, `parallel`, `perpendicular`, `symmetric`, `tangent`, `vertical` and `smooth`.

A reference contains an existing model `entityId`, optionally a zero-based `part` (0–4095) for a segment in a single native outline, and optionally a named `point`. Point selectors reuse native grip names (for example `start`, `end`, `center`, `node`, `vertex-0`); cubic endpoints also accept `start`/`end`. Segment point selectors are `start`/`end`. Relation/reference compatibility is validated against native geometry. The current adapters cover points, lines, circles, arcs, ellipses, rectangles, individual cubic spans, point polylines, native mixed-curve polylines and fit/control spline definitions. Composite part selectors use stable stored span indices, including during solver trial steps. Connected adjacent spans and the existing closing joint of a closed contour are retained as intrinsic equations. Joint detection for an edit uses its pre-edit geometry, so moving one side of a join does not silently detach it. Defined splines solve their source points and optional derivative vectors, then regenerate exact native spans with the same knots and mode. Affine-frame and generated array/linework adapters remain in development.

A `fix` entry adds `values`, a finite snapshot of the referenced point `[x,y]` or the native scalar coordinates of the whole object. Snapshots are bounded to 128 numbers with absolute value at most 1e12. Whole-object scalar order is x/y for points; x1/y1/x2/y2 for lines; cx/cy/r for circles; cx/cy/r/startAngle/endAngle for arcs; cx/cy/rx/ry followed by present rotation/startAngle/endAngle fields for ellipses; x/y/width/height followed by present rotation for rectangles; interleaved x/y coordinates for cubic controls and polyline vertices; concatenated native scalar vectors in stored order for mixed-path parts; definition point x/y values followed by present start/end tangent x/y values for defined splines. Translating a fixation snapshot moves position coordinates while preserving radii, angles and derivative vectors. Distances use metres and angle fields retain their native units. Tangent relations may add boolean `internal` for internal circular tangency.

Normalization validates the entire catalog without solving: even a currently unsatisfied but structurally valid relationship preserves the saved coordinates. Unknown types, malformed values, duplicate constraint IDs, missing targets, invalid selectors and incompatible references reject the document with a localized error, rather than silently dropping relationships. Rust storage retains this optional catalog verbatim under the existing archive safety limits; JavaScript document normalization performs semantic validation. Native and browser archive round trips test that no coordinate changes occur on opening or saving.

Clipboard JSON and its embedded SVG metadata retain only relationships whose complete target set is included in the copied dependency closure; constraints do not pull unselected neighbours into that closure. Paste assigns new constraint/entity IDs, preserves selectors and translates saved fixation targets by the insertion offset without replacing them with current geometry. Original-coordinate paste retains the snapshots. Invalid catalogs and combined catalog overflow reject the whole paste. PASTEBLOCK stores relationships in the definition’s local coordinates; copied definitions remap their local references. Block definitions may carry the same strictly validated geometricConstraints catalog, retained through archive reopen. BEDIT exposes the definition catalog in its isolated draft, enforces ordinary edits and saves it back without changing the model catalog. BCONVERT transfers matching internal constraint catalogs into the shared local definition, remaps relation IDs and translates fixation snapshots. Catalog matching transforms saved fixation targets and maps horizontal/vertical axes through quarter-turn rotations; incompatible directions, differing catalogs and relations crossing occurrence boundaries reject conversion atomically. Model relationships transferred into the definition are removed in the same history entry. EXPLODE/XPLODE transfer complete visible block-local relationships into the model, transform fixation snapshots into world coordinates and assign independent entity/relation IDs. Recursive instances and evaluated dynamic arrays keep separate catalogs. Quarter-turn horizontal/vertical directions are remapped; incompatible axis directions, selectors, unsatisfied transformed relations and the combined 256-relation limit reject the entire batch. Existing constraints on a primitive whose topology would change also refuse explosion rather than silently disappearing. Dynamic instance evaluation enforces local constraints after ordered actions and before visibility filtering: changed scalar coordinates are drivers and connected un-driven coordinates may follow. Hidden members still participate. Array actions copy complete internal relationships with stable derived IDs and translated fixation snapshots; the evaluated catalog is limited to 256 relationships. Conflicts, unsupported representation changes and catalog overflow reject explicit parameter updates for the entire selected batch. Reset and successful edits retain ordinary undo/redo. Definition geometry and its catalog remain unchanged; evaluated geometry is shared by rendering, bounds, snapping and materialization. Dynamic translations retain native rectangles and their selectors. GEOMCONSTRAINT and the twelve dedicated GC commands now author, list and remove model constraints through the shared solver; syntax is documented in MCP.md. Ordinary geometry edits now pass through the shared history enforcement described below.


Constraint enforcement runs before an ordinary geometry history commit. Scalar coordinates explicitly changed by that edit become fixed drivers for the solve; other coordinates in the connected relation component may adjust. Unreferenced objects retain identity, and unrelated components are not solved. Locked/hidden source objects remain immovable. Radius parameters use an internal logarithmic representation to prevent negative trial radii; persisted coordinates stay in metres.

A failed solve keeps the entire previous content, undo/redo stacks and drag-coalescing state and produces a localized rejection message. Successful propagation shares the original edit’s history entry. Deleting an object removes its referencing relationships in that same entry; undo restores both. Changing an existing referenced object into an incompatible representation is refused rather than silently discarding its constraints. Coordinate-path signatures distinguish different representations even when their scalar vector lengths are equal. Layout-only and appearance-only edits do not solve geometry.

Explicit whole-document replacement through MCP, like opening/resetting an archive, preserves the validated snapshot without solving it. This is distinct from an ordinary edit: replacing a document may deliberately import unsatisfied relationships, and must not partially apply accompanying names/assets/layouts because a solve failed. Subsequent ordinary edits enforce affected components. BEDIT currently isolates the model catalog from the local block draft; model relations survive block save/discard. BEDIT authors local geometric and dimensional constraints while preserving the model catalogs.

Named BLOCK conversion transfers fully included geometric relationships to the definition catalog, assigns new relation IDs and translates fixation snapshots into local coordinates. The replaced model relationships are removed in the same history entry. A relationship crossing the selection boundary prevents replacement, avoiding silent loss of external associations. BLOCK KEEP leaves all model geometry/relationships intact and copies only fully included relationships into the definition. This uses the same definition schema as PASTEBLOCK and BEDIT.

COPY translation and COPYTOLAYER use the same complete-target rule as clipboard transfer. Each copy gets independent entity/relation IDs, while point and whole-object fixation snapshots follow the displacement (zero for COPYTOLAYER). Cross-selection relations stay with originals and are not attached to copies. A combined catalog beyond 256 constraints or invalid translated values rejects the entire duplication, preserving content and selection.

Rotation/scale/mirror copies remap complete internal relationships and transform point/whole-object fixation snapshots using the same geometry operation. They validate compatibility and residuals before committing: the requested copy is not re-solved into a different shape. Horizontal/vertical constraints retain their drawing-axis meaning; a conflicting rotation is refused atomically rather than dropping the relation or straightening the copy. Unsupported type/selector conversions and catalog overflow are also rejected. Original relationships and coordinates stay unchanged.

Regular polygons participate in geometric constraints through native centre, positive radius and rotation coordinates, with edge and vertex selectors shared by the editor. Side count and inscribed/circumscribed mode remain structural metadata; changing them on a constrained object is rejected. Constraint solving supports native drawing curves and points; generated/style-driven geometry may be exploded into native objects. Text/image affine frames and annotation presentation are not geometric solver variables.


## Driving dimensional constraints and parameter formulas

Model content and individual block definitions may contain optional `parameters` and `dimensionalConstraints` arrays. Each definition has its own namespace and local entity references. Their absence remains absent after normalization. Parameters retain `{name, type, expression}` with case-insensitive ASCII names (1–64 characters), type `number`, `distance` or `angle`, and a formula of at most 512 characters. Named dimension definitions share the same graph and namespace: at most 128 definitions in total, dependency depth 64, finite evaluated magnitudes at most 1e12. Constants `pi` and `e` cannot be redefined. Forward references are supported; duplicates, unknown variables, cycles and invalid formulas reject the document. Values are derived, never persisted as a stale cache.

A dimensional relationship retains `{id, name, type, expression, refs}`. Its stable ID is unique across geometric and dimensional catalogs; their combined size cannot exceed 256. Types are `linear`, `aligned`, `angular`, `radius` and `diameter`. References reuse native entity/grip/part selectors. Linear/aligned dimensions accept one line segment or two explicit points. Linear definitions additionally retain `axis: "x" | "y"` and `direction: 1 | -1`, keeping their intended signed side while the evaluated distance is nonnegative. Aligned targets are strictly above 1e-9 metres. Radius/diameter references target a circle or circular arc and require positive targets above 1e-9 metres. Angular definitions use two directed line segments, in reference order, with targets strictly between 0 and 360 degrees, including reflex angles. Length expressions use metres; angular expressions use degrees with explicit unit suffixes supported.

Archive validation evaluates formulas and checks reference compatibility without solving geometry. Geometric and dimensional residuals share one component solver for later edits. Changed geometry coordinates remain drivers; changes to evaluated parameters activate their referenced components. Successful propagation shares one undo entry, and conflicts leave content and history intact. Unrelated style/layout edits leave archived geometry unchanged. Deletion removes relationships targeting deleted entities, but is refused if remaining formulas would lose a named dependency. Root dimensions and parameters are isolated from BEDIT drafts. PARAMETERS, DIMCONSTRAINT and the five DC authoring commands now edit model catalogs through the same history path. DCCONVERT links associative annotations to driving definitions. The Parameters sidebar shares these authoring utilities. BEDIT reads and saves the local block catalogs independently. Dynamic actions solve their geometric and dimensional relationships before visibility filtering; array copies receive independent formula names and relationship IDs.


Converted driving constraints may additionally retain `dimensionId`, pointing to an existing associative linear/radial/angular annotation. Their whole-entity `refs` must match that annotation’s native measurement dependencies (at most three). Their type must agree with the annotation mode. The shared dimension renderer supplies the exact measurement residual, including rotated linear projection, ellipse-axis linear measurement, angular source-pick rays/reflex branches, angular arcs and jogged radii. Display styles, offsets and annotation identity remain unchanged. These converted linear definitions obtain their axis from the annotation instead of separate `axis`/`direction` fields. Converted angular targets use the displayed angle in degrees.

`DCCONVERT` initializes expressions from the unformatted physical measurement and skips already-linked annotations. Detached, unsupported or locked annotations reject the entire requested batch. Annotation deletion removes its linked driver in the same history entry, unless a remaining named formula requires that driver; dangling links or mismatched source catalogs reject archive loading. Measurement-affecting annotation edits activate the coupled solver, while appearance-only changes leave geometry untouched. Conversion does not bake a custom text override into the driving expression.

Ordinary clipboard payloads may include optional `parameters` and `dimensionalConstraints` catalogs. COPY/COPYTOLAYER and clipboard transfers retain complete drivers and their transitive formula dependencies. Linked annotations accompany a complete set of driving sources. Named dimensional dependencies outside the copied geometry become scalar parameter formulas; their geometry is not implicitly selected. Unused parameters are omitted. Destination name collisions receive unique bounded numeric suffixes, with parsed variable references rewritten consistently; units, functions, constants and scientific notation retain their roles. All entity/annotation/relationship IDs are remapped independently. Validation enforces graph and combined relationship limits before a paste is published. Paste-as-block retains the graph in block-local coordinates. BLOCK transfers complete internal drivers and keeps scalar formula dependencies needed by the remaining model; cross-boundary relationships reject replacement. EXPLODE/XPLODE merge block-local graphs into the model with fresh names and IDs. Transformed copies preserve prescribed dimensional values and remap compatible projected axes; incompatible geometry rejects instead of silently rescaling formulas or reshaping the copy.

### Native XY cleanup

FLATTEN does not change the archive schema or introduce 3D geometry. Native entities remain expressed in world XY. Optional residual elevation keys (`z`, `z1`, `z2`, `cz`, `elevation`, `thickness`) on selected native geometry can be set to zero explicitly, including native point lists and compound parts/boundaries. Unrelated semantic metadata is retained. Non-world OCS orientation is not interpreted or silently discarded; it rejects the operation. Shared block/reference definitions are not mutated through an instance. PURGE removes only unused definition catalog entries after tracing model, paper-space and nested resource references; binary assets remain available to historical snapshots.

### Recovery staging (in development)

The explicit recovery candidate reader shares the strict ZIP entry whitelist, version checks and declared/actual resource limits. Unlike normal opening, a missing declared asset payload can be omitted from the hydrated candidate and recorded as `missingAssetEntry` with its original ID, archive path and metadata. Referencing geometry stays present in the raw manifest so a later audit/salvage pass can report it. The candidate is intentionally not normalized and must not be treated as a validated document. Malformed JSON, unsupported versions and unsafe ZIP entries remain errors. Normal reading behavior is unchanged.

Recovery preparation now combines the raw candidate reader with copy-only salvage. Removed objects/relations are retained in a quarantine report with complete raw values and issue paths. Surviving geometry is not moved; invalid dependencies are processed in bounded passes. A candidate with unresolved dimensional parameter or block-graph defects is not marked ready. The source bytes and active document are untouched by these utilities. RECOVER now presents a candidate report before explicit opening as a separate unsaved session; The native batch manager is available; persistent metadata history is available and broader dependency repair remains in development.

Recovery verifies sequential local headers with known sizes (stored or DEFLATE data), including when the central directory is readable. Each recovered payload must match its declared length and CRC32; central-directory filtering does not inflate payloads a second time. When ZIP directory decoding fails, these verified records rebuild the entry list. Corrupt asset payloads are omitted and reported; a corrupt or missing manifest remains fatal. Original entry names, including discarded payloads, are checked against the manifest whitelist. Encrypted records, data descriptors with unknown local sizes, unsafe/duplicate paths and exceeded resource limits remain unsupported. This fallback does not repair JSON or guess missing bytes, and does not change normal archive opening.

The native `read_lcad_recovery_source` command provides bounded, read-only raw bytes for an absolute `.lcad` file (maximum 300 MiB, regular files only). The shared browser/native recovery loader prepares a separate candidate and records its source identity; it does not replace the active drawing, write to the source, or clear autosave recovery. RECOVER connects this loader to the shared Measurements report. Explicit opening retains the report in the new session, leaves its file path unset and protects the source path during Save As (including symlink aliases). A native source cannot be the currently open file. Full candidate reports remain session-only; bounded metadata summaries persist separately in Recovery Manager history.


Native batch recovery canonicalizes referenced `.lcad` paths relative to their source directory, then reads each unique source once. The raw-byte command also accepts a smaller remaining-byte budget, always capped at 300 MiB. Each candidate has an independent audit/quarantine report; missing or invalid sources do not erase valid candidates. Model, block-local, paper-space and quarantined reference insertions contribute dependencies. Paths are validated before filesystem adapters run. Cycles and traversal limits produce incomplete reports. The graph is session metadata rather than archive content; its source paths are protected during recovered-session exports. Batch inspection does not change cached reference geometry or rewrite external links. Metadata history persists separately; saved-copy locations travel with the session graph.


Recovery Manager history retains the twelve latest analysis summaries (source identity, timestamp, status and counts), without drawing geometry, assets or quarantine payloads. Desktop stores a versioned `recovery-history.json` in application data; browser uses `lumcad.recovery-history.v1` in local storage. The metadata file is limited to 256 KiB. `RECOVERYMANAGER HISTORY` displays these summaries; `RETRY n` re-reads and validates the source before preparing any candidate, while `REMOVE n` removes only the summary. Browser retries request a file again. Corrupt history is reported without overwriting it; history-save failure does not discard the current candidate.

When a candidate is explicitly opened, its cloned document pins external-reference paths to the original source directory across model, block and paper scopes. Known batch targets use their canonical source paths. Other relative paths retain parent segments, preserving native symlink traversal semantics. Cached geometry, loaded/overlay state and revision metadata remain unchanged. Browser sources without a directory retain unresolved paths and report them explicitly. The opened-session report records every changed path and unresolved location. This preserves links to original sources when Save As moves the copy; successfully saved dependencies in the same session graph substitute their new paths when a subsequent candidate is opened.

Raw audit also validates explicit block transforms (six finite numeric matrix components, or finite supplied legacy insertion/scale/rotation values) before permissive normalization. Explicit text/image affine frames must satisfy the existing bounded, nonsingular frame contract. AUDIT REPAIR reports such geometry defects without guessing replacements; copy recovery quarantines their complete raw objects and retains unaffected insertion coordinates and block definitions. Omitted legacy transform fields retain their established defaults.

Successful native Save/Save As records the recovered source-to-copy path in the session graph only after the write succeeds. Cancelled/browser saves do not create a native location. Opening another candidate resolves the graph after the current-drawing save prompt completes, so a dependency saved by that prompt is included. Existing saved parent files are not rewritten automatically, and cached geometry is not refreshed implicitly. The original candidate and quarantine evidence remain immutable; saved-copy locations appear in the manager report.

Recovered-session RELINK is an explicit undoable document edit of reference paths. It does not modify candidate/quarantine evidence, assets, geometry caches or source files. The current batch retains at most 32 previous destination aliases per source and removes conflicting destination ownership. Reopening a saved candidate reads its current archive and checks document identity; a missing/replaced file is an error rather than a fallback to the older candidate.

Raw dimension audit validates explicitly supplied point coordinates, measurement modes, offsets, radii, sizes, extension values and detached circular/elliptical source geometry for all seven dimension/centre-marker types. Omitted optional values retain the documented normalizer defaults; malformed supplied values are reported instead of silently deleted or clamped. Copy salvage retains full raw annotation evidence in quarantine and does not alter surviving annotations or source geometry.

Raw audit now checks the optional model selection-group catalog before ordinary normalization. Group and membership traversal counts against the audit object budget. AUDIT REPAIR reuses the established group normalization rules to retain the first eligible unique identity/name and surviving ordered memberships; every changed or removed record has raw `previous` and repaired `next` evidence in the repair report. Copy recovery repeats membership repair after geometry quarantine, so removed objects cannot leave stale group members. Geometry and stable IDs of surviving objects remain unchanged.

## Reusable drawing templates

Templates use the existing `.lcad` format without a new manifest version or a separate DWT codec. `SAVETEMPLATE` exports a complete drawing; `NEW TEMPLATE`, `NEW FROM` and `QNEW` instantiate a normalized independent document with a new document ID and creation/update timestamps. Entity/resource/layout IDs stay unchanged so internal relationships remain valid. The new session does not inherit the template's file path. Source-path protection and unresolved-reference warnings are session metadata, not drawing content. Relative external drawing references are pinned to the source directory before native template export or instantiation; browser sources without a directory report unresolved locations.

The optional `drawingDefaults.templatePath` application preference defaults to an empty string when absent. It stores a bounded absolute `.lcad` path for QNEW; existing settings files require no migration and documents remain unchanged.


### Saved quantity extraction definitions

Optional model `content.dataExtractions` stores up to 128 named query definitions. Each has a stable `id`, trimmed case-insensitively unique `name` (128 characters), `nested` boolean, `groupBy` field list (up to 16 distinct fields), `sums` list (`length`, `area`), and `selectedIds` (null for all roots or up to 10000 distinct source IDs). Fields use native extraction keys or `attribute:TAG`. Invalid/duplicate definitions are dropped at normalization. No output destination, cached quantity, timer or executable expression is stored. Missing selected roots remain identifiable; RUN refuses an incomplete source selection until the definition is updated. Missing attribute values group as null. Save/delete use ordinary document history. Old archives normalize a missing catalog to an empty array, with no format-version change or database migration; native and browser archives preserve valid definitions.

### Embedded drawing standards

Optional model `content.standards` is null (including legacy drawings without this field) or `{version: 1, path: null|string, standard: {...}}`. The embedded standard has `format: "lumcad-standards"`, `version: 1`, a name and six named catalogs: layers, textStyles, dimensionStyles, leaderStyles, multilineStyles and tableStyles. Each entry contains a unique case-insensitive name and normalized `values`; local drawing IDs and layer visibility/locking are deliberately excluded. Layer catalogs are limited to 2048 entries and each style catalog to 128. Names are limited to 128 characters. Unsupported versions or malformed embedded definitions reject normalization instead of silently discarding the association.

The optional original absolute source path is informational, limited to 4096 characters, and cannot contain control characters. No read or automatic reload is triggered by opening a drawing. The embedded snapshot remains usable offline or after the source is removed. Loading/replacing and detaching standards use document history and are undoable. Existing optional-field archive compatibility is retained; no format-version change or database migration is needed. Native archive storage preserves the binding, and browser/frontend normalization validates the rule schema.

### Separate sheet-set project indexes (implementation in progress)

A sheet-set index is a standalone UTF-8 JSON file, not a `.lcad` archive. Its root contains `format: "lumcad-sheet-set"`, `version: 1`, stable `id`, `name`, project `properties`, `sources` and ordered `sheets`. Each source contains its stable local `id`, native absolute or project-relative `.lcad` `path`, and expected `documentId`. Each sheet contains `id`, `sourceId`, stable `layoutId`, unique case-insensitive `number`, `title` and sheet `properties`. Sheet properties override project properties when preparing publication. Source drawings are independent files and are not modified by index edits.

Limits are 256 sources, 1000 sheets, 128 metadata fields per project/sheet, and 4 MiB for the UTF-8 index file. Loading publication sources deduplicates canonical paths and checks aggregate compressed bytes and decoded document characters, both defaulting to 300 MiB. Every used document identity and layout must resolve before a publication plan is returned. Unsupported versions, duplicate IDs/numbers and broken index references reject.

Saving the index under another name in the same directory preserves relative source paths. Saving it in a different directory pins relative sources to their previous absolute locations, retaining parent segments rather than collapsing symlink-sensitive paths. Browser downloads retain authored paths because no destination directory is available. Native Save As refuses relative sources without an established original index location. No `.lcad` version change or database migration is involved; sheet-set management commands now read/write this format; multi-drawing publication reloads saved sources without changing index or drawing data; archive/transmittal packaging remains in progress.


### Portable transmittal snapshots

The transmittal builder creates a ZIP containing `sheet-set.json`, `transmittal.json`, a localized UTF-8 `transmittal.txt` report and a flat `drawings/` directory. Generated collision-free names distinguish same-basename source files. Each copied `.lcad` retains document/entity/layout IDs, cached content and embedded assets; external-reference and CSV-link paths are rewritten relative to the copied drawing. The index uses paths relative to its own location. The JSON report contains package-relative file paths, kinds, original basenames and source byte sizes, not absolute machine paths. The plain-text report lists the same files and extraction instructions. It is bounded to 4 MiB by native validation; the package allows at most 515 entries (512 sources and three root files). Older packages without the text report remain accepted. Every declared index source is included, even if currently unused by a sheet.

Canonical aliases and circular file references share one packaged file. Source identities and referenced sheet layouts are checked before output. Missing files, changed reference identities or file/edge/byte/decoded limits abort the whole operation. Defaults are 512 files, 4096 dependency edges and 300 MiB each for input bytes, decoded envelope characters and uncompressed output entries. Existing per-drawing archive limits still apply. The originals are never rewritten.

CSV link metadata accepts native absolute paths or drawing-relative `.csv` paths; remote URLs, drive-relative Windows paths and control characters are rejected. Relative links resolve only against the saved drawing location during explicit DATALINKUPDATE, never against the process working directory. Browser-only links without a source path retain cached table cells. Native ARCHIVE/ETRANSMIT validates bounded safe ZIP entries and versioned root indexes before atomic writing. Extraction, index reopening and republication in another directory are verified; relative CSV refresh/Save As verification remains in progress.


When a native `.lcad` is loaded, relative external drawing and CSV links are anchored against that file’s directory before the editor/history/autosave session begins. This is a read-only in-memory normalization; it neither rewrites the loaded file nor refreshes cached geometry/cells. A subsequent Save As/export can therefore preserve the original target without reinterpreting its relative path in the new directory. Model, block and paper links share this rule, including template/recovery copies. Transmittal packaging writes relative paths into its separate copies again. Browser loading without a filesystem base preserves authored paths.

DGN underlays use a native block reference with `dgnUnderlay`: `version: 1`, `format: "v7"`, source `assetId`/`name` and finite positive `metresPerMaster` (1e-12 through 1e9). Unknown versions/formats or invalid source IDs/unit factors are discarded during normalization. Cached native block geometry uses metres; the reference affine transform applies placement once. Source levels remain layers. `blockClip` uses the existing local-space clip representation. Clipboard and reference resource collection/remapping include the source asset. Loading an archive never follows an external DGN path or reinterprets the embedded binary.

### Linked quantity tables

A native table may store `table.quantityLink` instead of a CSV `dataLink`. It owns a normalized extraction `definition` snapshot (`id`, `name`, `nested`, `groupBy`, `sums`, `selectedIds`) and localized `headers`. Null selected IDs means the entire model; a fixed ID list ignores later additions and drops removed sources. Root and nested table entities are excluded from quantity queries to avoid counting their own generated contents. Linked cells are derived and cannot be edited or merged until detached; placement, dimensions and cell formatting remain editable.

Model history commits refresh these tables in the same undo snapshot as the source edit. Status is `current`, `empty`, `dependency` or `limit`. Failed refreshes retain the previous cells with an explicit non-current status. Save/reopen preserves the query, cached cells and status; no external data access is involved. Clipboard resource remapping rewrites fixed source IDs when all are included; otherwise it detaches the query and retains the table snapshot. An all-model query remains an all-model query in the destination. Saved extraction definitions can be renamed/deleted without changing a table's owned query snapshot.

### Object hyperlinks

Model and block entities may carry `hyperlink: { url, label }`. The URL is an absolute HTTP/HTTPS address (maximum 4096 characters), without embedded credentials or control characters; the optional display label is normalized to a string of at most 256 characters. Frontend entity normalization removes invalid link metadata. Links are ordinary persisted entity metadata retained by archives, copy and clipboard workflows; they neither embed nor fetch the target document. Opening always requires an explicit user command/button action. Native URL opening validates the scheme and bounds again before invoking the system browser, without a shell command string.


### Arc-aligned text

An arc-text label is a generated native `polyline` with text `parts` and an optional root `sourceId` referencing a circular arc in the same entity collection. Its `arcText` definition contains `version: 1`, single-line `text` (at most 512 UTF-16 code units and 256 graphemes), an arc snapshot (`cx`, `cy`, positive `r`, radian start/end angles, direction and full-circle flag), `offset` and nonnegative `spacing` in metres, `align` (`start`, `center`, `end`), `reverse`, a normalized text-style snapshot and a nonsingular affine `transform`. Baseline radius must remain positive and the complete text must fit the available arc length. Each grapheme is an ordinary fitted text entity with an affine frame; generated parts preserve rendering and export through existing text paths.

Normalization rebuilds valid definitions; malformed definitions lose arc-text metadata and source linkage while retaining their cached ordinary geometry. Linked source edits refresh labels in the same history step. `status` is `current`, `missing`, `invalid` or `overflow`; unavailable/incompatible/too-small sources preserve the last valid layout with an explicit status. Paired translation, rotation, uniform scaling and reflection preserve linkage. Moving or transforming the label independently detaches it; nonuniform paired transforms retain transformed glyphs as an independent label if the source becomes an ellipse. DETACH also preserves an independently editable arc definition. Existing dependency remapping preserves copied source/label relationships and clipboard closure includes the source. EXPLODE produces editable ordinary text entities. No archive version change or database migration is required.
