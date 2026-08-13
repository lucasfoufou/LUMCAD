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

## Layer and object appearance

Every layer stores a color, line weight, and line type:

```json
{
  "id": "geometry",
  "name": "0",
  "color": "#172033",
  "lineWeight": 1,
  "lineType": "continuous",
  "visible": true,
  "locked": false
}
```

Supported line weights are `1`, `1.5`, `2`, `3`, `5`, and `10`. Supported line types are `continuous`, `dotted`, and `dashed`.

An entity uses its layer appearance by default. A custom `color`, `lineWeight`, or `lineType` is stored directly on the entity only when that property overrides the layer. Removing the entity property restores ByLayer behavior, so later layer changes immediately affect every inheriting object.

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
