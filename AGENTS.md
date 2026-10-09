# AGENTS.md

## Scope

These instructions apply to the entire LUMCAD repository.

LUMCAD is a local-first 2D CAD desktop application built with React, Vite, and Tauri 2. Before changing behavior, identify whether the concern belongs to the React editor, a reusable geometry/document utility, the `.lcad` persistence layer, or the Rust/Tauri shell.

## Read the existing documentation first

Do not duplicate the project documentation in code or in this file. Use the relevant source below before working:

- [README.md](./README.md): product goals, supported workflows, development commands, releases, and contribution overview.
- [TOOL_ROADMAP.md](./TOOL_ROADMAP.md): current CAD capability coverage, known gaps, priorities, and the rule for updating the roadmap.
- [LCAD_FORMAT.md](./LCAD_FORMAT.md): versioned `.lcad` ZIP structure, manifest semantics, assets, validation limits, and persistence guarantees.
- [MCP.md](./MCP.md): local MCP architecture, command/action contract, security model, client workflow, and MCP-specific tests.
- [TRANSLATING.md](./TRANSLATING.md): i18n conventions, locale catalogs, error localization, and translation validation.
- [PERFORMANCE.md](./PERFORMANCE.md): benchmark fixtures and commands, performance budgets, and the current baseline.
- [UX_AUDIT.md](./UX_AUDIT.md): current UI/UX inventory and the principles for the interface overhaul.
- [LICENSE](./LICENSE): GPL-3.0-only licensing terms.

Read only the documents relevant to the task, but treat them as contracts. Update the appropriate document when a change makes it inaccurate.

## Repository map

- `src/App.jsx`: application startup, document recovery/opening, and top-level settings/session lifecycle.
- `src/components/drawing/`: reusable editor, canvas, toolbar, sidebar, layout, and print UI.
- `src/components/settings/`: application settings UI.
- `src/components/ui/`: shared interface primitives such as the in-repository SVG icon set.
- `src/hooks/`: stateful editor workflows such as history, autosave, file commands, compound commands, arrays, shortcuts, image import, and the MCP frontend bridge.
- `src/dev/`: development-only tooling such as the interactive benchmark harness; excluded from production builds.
- `src/utils/`: framework-independent document normalization, entity creation, geometry, snapping, selection, transforms, trim, layouts, printing, archive, storage, and command logic.
- `src/mcp/commands.json`: shared authoritative command catalog consumed by the frontend and Rust MCP server.
- `src/i18n/`: translation provider, locale registry, and catalogs.
- `src/settings/`: settings defaults, normalization, persistence, and provider.
- `src/style/`: global Sass and feature-level styles; `tokens.scss` defines the colour, type and spacing tokens and `app/ui.scss` the shared control styles.
- `src-tauri/src/`: Rust desktop integration: application setup, native menus, settings, storage, printing, and MCP server.
- `public/`: static application assets.
- `.github/workflows/`: release automation.
- `scripts/`: project maintenance and release checks.

Generated or dependency directories such as `node_modules/`, `dist/`, `src-tauri/target/`, and `src-tauri/gen/schemas/` are not source and must not be edited manually.

## Working principles

- Reuse existing components, hooks, and utilities before adding new ones. If an existing component needs a small variation, prefer a clear prop or shared primitive over a near-duplicate component.
- Keep CAD math and document transformations in `src/utils/` whenever they can be independent of React. UI components should mainly coordinate state, input, and rendering.
- Extend the established entity factories, normalization paths, selection rules, and appearance resolution instead of creating a second representation of the same concept.
- Preserve undo/redo semantics: normal drawing edits should flow through the existing history commit path rather than mutating document content in place.
- Preserve local-first and atomic persistence guarantees. Changes to `.lcad` behavior must remain consistent between browser-side archive handling and Rust storage validation.
- Treat drawing distances and coordinates as metres unless a documented workflow explicitly uses paper millimetres, such as layout viewport rectangles.
- Use the `~` alias for imports rooted at `src/`, following existing code.
- Match the existing JavaScript style: four-space indentation, semicolons, single quotes, and small named helpers for non-trivial logic.
- Do not introduce user-facing strings directly in components. Follow [TRANSLATING.md](./TRANSLATING.md), with English as the source catalog and complete locale parity.
- Maintain keyboard, pointer, command-bar, and MCP behavior together when they are alternate entry points to the same CAD operation.
- Keep changes focused. Avoid unrelated refactors unless they are required to make the requested implementation safe and reusable.

## Change-specific guidance

### Commands and CAD tools

- Check for existing primitives in `drawingGeometry.js`, `drawingOperations.js`, `drawingCompoundOperations.js`, `drawingTrimOperations.js`, `drawingSelection.js`, and related modules before writing new geometry logic.
- Add or update focused unit tests for deterministic geometry and document operations.
- When adding a command, update `src/mcp/commands.json`; do not maintain a separate frontend-only command registry.
- Verify command names, aliases, options, interactive stages, snapping/tracking, selection, cancellation, undo/redo, persistence, and MCP execution as applicable.
- Update [TOOL_ROADMAP.md](./TOOL_ROADMAP.md) whenever a listed capability materially changes or a command/entity becomes user-creatable.

### Documents and persistence

- Normalize data at the established document/archive boundaries and preserve backward/version checks.
- Treat IDs as stable document identifiers; do not regenerate unaffected entity, layer, asset, layout, or viewport IDs.
- Changes to the archive schema, supported assets, safety limits, or layout semantics require an update to [LCAD_FORMAT.md](./LCAD_FORMAT.md) and corresponding JavaScript/Rust tests.
- Exercise both native Tauri persistence and browser-side archive utilities when a change crosses that boundary.

### UI and styling

- Search `src/components/` and `src/style/app/` for an existing pattern before creating a component or style block.
- Use the tokens from `src/style/tokens.scss` instead of literal colours, and icons from `src/components/ui/Icon.jsx` instead of Unicode glyphs. The interface is dark-only; only content drawn on the sheet keeps sheet colours. Follow the layout decisions recorded in [UX_AUDIT.md](./UX_AUDIT.md).
- Prefer shared props and feature components over page-specific copies.
- Keep canvas and layout interactions usable at the minimum supported window size and with both English and French labels.
- Preserve accessible names, tooltips, focus behavior, and keyboard shortcuts when modifying controls.

### Rust/Tauri and MCP

- Keep privileged filesystem, native dialog, print, menu, and local-server work in `src-tauri/`.
- Preserve the MCP localhost-only security assumptions documented in [MCP.md](./MCP.md).
- Run the dedicated MCP suite for changes to commands, the bridge, server transport, origin checks, or MCP behavior.

## Validation

Use the narrowest relevant checks while iterating, then run the complete suite for a finished cross-cutting change:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

The equivalent project command is:

```bash
npm run check
```

For changes to rendering, snapping, selection, history, or persistence, run `npm run bench` (and `npm run bench:browser` for interaction changes) and compare with the budgets in [PERFORMANCE.md](./PERFORMANCE.md).

For MCP-related changes, also run:

```bash
npm run test:mcp
```

When visual or interaction behavior changes, run the application with `npm run tauri dev` and verify the affected workflow manually. `npm run dev` is useful for browser-only frontend work, but it does not exercise native Tauri storage, dialogs, menus, printing, or the Rust MCP server.

Add tests near the existing `src/utils/*.test.js` suites for pure JavaScript behavior and in the relevant Rust module for native behavior. Do not weaken or remove a failing test merely to make a change pass.

## Git and release safety

- Do not commit or push unless the user explicitly asks.
- Before any requested commit or push, run the complete frontend and Rust test/build suite with `npm run check`. Run `npm run test:mcp` too when the change affects MCP.
- Use the `git` CLI for Git operations; do not use GitHub skills or plugins.
- Preserve unrelated user changes in a dirty worktree.
- For releases or version changes, follow the release checklist in [README.md](./README.md) and let `scripts/check-release-version.mjs` enforce version consistency.
