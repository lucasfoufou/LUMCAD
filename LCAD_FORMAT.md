# LUMCAD `.lcad` file format

This document describes version 1 of the LUMCAD file format.

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
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "document": {
    "id": "drawing-…",
    "name": "Drawing",
    "content": {},
    "assets": [],
    "layouts": [
      {
        "id": "layout-…",
        "name": "Layout 1",
        "format": "A3",
        "orientation": "landscape",
        "viewports": [
          {
            "id": "viewport-…",
            "name": "",
            "x": 20,
            "y": 20,
            "width": 260,
            "height": 180,
            "hiddenLayerIds": ["references"],
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

Each layout uses one ISO A-series format (`A4`, `A3`, `A2`, `A1`, or `A0`) and an `orientation` of `landscape` or `portrait`. Viewport rectangle coordinates and dimensions are expressed in paper millimetres. `modelViewBox` points to the visible model-space rectangle in metres; its aspect ratio is normalized to the paper viewport so printed geometry is not distorted. `hiddenLayerIds` hides layers only inside that viewport and does not change their model-space visibility.

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

Hatch-like boundary data uses bounded `boundaries` (or legacy `loops`) containing point loops, exact path objects, or supported curve entities. These boundaries remain exact when used by clipboard interchange and compound operations. Associative dimensions continue to reference their source through `sourceId`; block-local dimensions reference child IDs inside their own definition.

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

## Anonymous block definitions and references

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

## Supported embedded images

- PNG (`image/png`)
- JPEG (`image/jpeg`)
- GIF (`image/gif`)
- WebP (`image/webp`)
- SVG (`image/svg+xml`)

Assets keep their existing compressed bytes in the ZIP. The JSON manifest uses DEFLATE compression.

## Safety limits

The desktop and browser readers apply the same limits:

- manifest: 8 MiB maximum;
- one asset: 25 MiB maximum;
- all assets: 200 MiB maximum;
- embedded assets: 512 maximum;
- asset paths must remain below `assets/` and cannot contain traversal components.

Duplicate paths, missing files, unreferenced entries, unsupported image types, malformed ZIP data, and invalid manifests are rejected.

## Versioning

Version 1 archives require `formatVersion: 1` in `manifest.json`. Files with another format version are rejected so future schema changes can be handled explicitly.

## Atomic writes and recovery

The desktop application creates the complete ZIP beside the target as a temporary file, flushes and synchronizes it, and atomically replaces the target. Unsaved drawings use the same ZIP structure in `recovery.lcad` inside LUMCAD's application data directory.
