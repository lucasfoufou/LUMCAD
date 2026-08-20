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

- lines, rectangles, regular polygons, circles, arcs, polylines, rich single-line/multiline text, reference images, and associative dimensions;
- layers and ByLayer/custom colors, line weights, line types, and transparency;
- object snaps, tracking helpers, grips, selection windows, and command aliases;
- move, copy, rotate, scale, offset, exact native-curve trim/extend and break, crossing-window stretch, four-mode lengthen, mirror, exact mixed-curve join, explode/XPLODE, and rectangular array operations;
- interactive two- or three-pair 2D alignment with optional uniform scaling, branch-aware fillet and chamfer editing with trim and whole-path modes, and endpoint-tangent cubic spline blends;
- operating-system clipboard copy/cut/paste, including picked base points, original-coordinate paste, anonymous-block paste, and LUMCAD JSON/SVG interchange;
- persistent exact ellipse, cubic-spline, mixed-path, hatch-boundary, dimension, and anonymous block-reference data used by compound operations and interchange;
- local `.lcad` files with native Open and Save As dialogs plus continuous autosave;
- atomic autosave and automatic recovery for drawings that do not yet have a file path;
- standard or custom paper layouts with margins, importable/exportable page setups, text/line/rectangle paper annotations, templates, scrollable tabs, and pointer reordering;
- multiple transparent clipped/rotated model viewports with exact `1/X` scales, locking, maximize/minimize, annotation controls, and per-viewport layer appearance;
- plot preview and ordered current/all/Cmd-or-Ctrl-selected layout publication to direct PDF or Autodesk-compatible XPS/ePlot DWFx, with mixed paper sizes, plot areas, fit/fixed scales, margins, styles, vector/raster quality, reusable page setups, sheet-only system printing, and unattended PDF output;
- a local Streamable HTTP MCP server for AI-assisted drawing workflows;
- an English and French interface, with English as the source language.

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

## Clipboard interoperability

`COPYCLIP`, `COPYBASE`, and `CUTCLIP` write a versioned LUMCAD JSON flavour together with interoperable SVG; the plain-text fallback is the same complete SVG with embedded lossless JSON metadata. On macOS, the desktop build also advertises native `public.svg-image` and UTF-8 text pasteboard types. The payload includes selected-object dependencies plus the referenced layers, embedded assets, and anonymous block definitions. `PASTECLIP`, `PASTEORIG`, and `PASTEBLOCK` remap those resources safely when geometry crosses document boundaries; a cut deletes its source only after the operating-system write succeeds.

The SVG representation keeps exact ellipses, elliptical and circular arcs, cubic splines, hatch boundaries, dimensions, and block transforms. SVG copied from another application can be pasted when it uses bounded basic shapes or absolute/relative `M/L/H/V/C/A/Z` paths with simple translate, rotate, scale, or matrix transforms. Affinity-to-LUMCAD paste requires Affinity's **Copy items as SVG** setting; ordinary Affinity clipboard data that contains only proprietary, PDF, or bitmap flavours is outside this geometry importer. The embedded LUMCAD metadata remains authoritative for lossless LUMCAD-to-LUMCAD copies, while malformed or unbounded external data is rejected as one atomic import.

## Downloads

Tagged versions are published on the [GitHub Releases page](https://github.com/lucasfoufou/LUMCAD/releases) for:

- macOS on Apple Silicon and Intel (`.dmg`);
- Windows x64 (NSIS installer);
- Linux x64 (`.AppImage` and `.deb`).

Each successful release also publishes a signed Tauri updater manifest. An installed updater-enabled version checks GitHub periodically, offers a newer compatible build in the header, verifies its updater signature, saves the active drawing, and installs only after confirmation. The first updater-enabled version must still be installed manually.

The release workflow uses ad-hoc signing on macOS and does not yet notarize the macOS bundle or sign the Windows installer with an identified developer certificate. Tauri updater signatures protect the update channel, but they do not replace Apple Developer ID or Windows Authenticode signing; the operating system may therefore display a security warning for manually downloaded builds.

## Development

### Requirements

- Node.js 22 (the exact version is recorded in `.nvmrc`);
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
