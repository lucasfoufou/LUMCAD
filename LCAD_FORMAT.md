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

The manifest is UTF-8 JSON. Its top-level structure is:

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

Assets keep their existing compressed bytes in the ZIP. The JSON manifest uses DEFLATE compression.
PDF source bytes use an `assets/*.pdf` entry and the same per-asset and aggregate
limits as images. Their descriptor retains positive width/height metadata; the
PDF parser determines the selected page's physical dimensions. PDF is accepted
by archive storage, not by the image attachment MIME validator.

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

- manifest: 8 MiB maximum;
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
