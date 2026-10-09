# UI/UX audit

- Last reviewed: 2026-10-09
- Scope: editor shell, tool configuration surfaces, side panels, dialogs and visual consistency
- Direction agreed with the maintainer: very modern and lean; no heavy UI dependency (only small, low-level additions)

This audit is the baseline for the UI/UX overhaul. It records what exists today and the problems to solve; target designs are added here as they are validated.

## Historical baseline — before the overhaul (2026-10-08)

At the baseline, the same operation could be configured from up to five places. This inventory describes the old interface; the current implementation is recorded in Status below:

| Surface | Component | Shown when | Content |
| --- | --- | --- | --- |
| Command bar | `DrawingCommandBar` | Always (bottom centre) | Command entry, suggestions, prompt line |
| Dynamic input | `DrawingDynamicInput` | Pointer over canvas during a command | Coordinate hint (`x,y / @x,y / @d<`) |
| Tool card | `DrawingCreationControls`, portaled into `.drawing-properties-mount` | A creation tool or operation is active | Mode, options, a second "Point, value or option" field, Enter/Cancel |
| "Edit selected — …" card | `DrawingCreationControls` (edit mode) | One supported entity is selected | Collapsed geometry details |
| Selection tab | `SelectionPanel` | Selection tab active | Layer, lock, link, appearance, entity fields |

Observed consequences:

- The tool card is mounted above whichever sidebar tab is open, so the LINE options appear inside the *Layers* tab.
- The tool card duplicates the command bar (a second input with Enter/Cancel buttons).
- A selected entity shows both the "Edit selected" card and the Selection tab fields.
- `DrawingAnnotationFields` (annotation scale) is rendered above every sidebar tab.
- Drafting aids (object snaps, grid step, screen scale) live in a floating panel that covers the top-right of the canvas.

## Side panel

Nine tabs in a two-column grid (*Layers, Selection, Text styles, Dimension styles, Blocks, Plot styles, Parameters, Geometric constraints, Measurements*), plus *Block table* while editing a dynamic block. The tab grid occupies about 230 px of vertical space before any content. Selection automatically switches to the *Selection* tab.

## Visual consistency

| Topic | Finding |
| --- | --- |
| Design tokens | No CSS custom properties; 10 Sass colour variables, but 146 distinct hard-coded hex colours and 32 distinct font sizes across the stylesheets. No light/dark theming. |
| Icons | Toolbar tools use Unicode glyphs (`╱ ⌘ ⠿✎ ∿⠿ ⇲`); several are ambiguous or reused for different tools (`⧉` copy and copy-from-base, `↔` xline, dimension and stretch). The layout toolbar mixes in emoji-like glyphs. |
| Buttons | At least six button styles (`drawing-creation-action`, `drawing-secondary-button`, `lumcad-settings-button`, header actions, tool buttons) and many unstyled native buttons (for example *Apply link / Remove link / Open link* in the Selection tab). |
| Form controls | Native `<select>`/checkbox styling throughout panels; shortcut editing uses raw text such as `MOD+SHIFT+S`. |
| Dialogs | *Plot & Publish* uses a dark theme; *Settings* uses a light theme with native controls; side panels use a third light style. |
| Density | Model toolbar has about 46 buttons in a two-column strip with no labels or grouping titles. |

## Screens reviewed

Editor (model), each sidebar tab, entity selection, LINE/RECTANG active, command suggestions, Plot & Publish, Settings, Layout editor. The screenshots were captured from the `S` benchmark fixture at 1440 × 900 (see PERFORMANCE.md for the harness).

## Principles proposed for the overhaul (to validate)

1. **One configuration model per command**, declared once (command catalogue) and rendered in three coherent places: a contextual options bar for the active tool, the command line/dynamic input for keyboard entry, and MCP.
2. **The right panel shows properties of the selection only**; tool options never appear there.
3. **Drafting aids move to a status bar** (snap, grid, ortho, polar, tracking, scale) instead of a floating panel.
4. **Fewer panel tabs**: Properties, Layers, Library (blocks); styles and plot styles move to dedicated managers.
5. **Shared primitives and tokens**: colour/spacing/typography tokens with light and dark themes, an SVG icon set kept in the repository, and `Button`, `IconButton`, `Field`, `Select`, `Checkbox`, `Section` components replacing ad-hoc markup.

## Decisions — 2026-10-09

Validated by the maintainer on the interactive mockup:

- **Direction**: tool rail on the left, command line in the window header, properties panel on the right, drafting aids in a bottom status bar.
- **Theme**: dark interface only, built from design tokens; the drawing sheet stays light so entity colours keep their meaning.
- **Command line and options** (revised the same day after trying the first version, which had an options bar above the drawing and a separate command line below it): a single command line in the window header replaces the command search field; the options of the active tool or command open in a panel below it.
- **Managers** (text, dimension and plot styles, parameters, constraints, measurements): dialogs opened on demand from command search or the relevant properties section; the panel keeps three tabs (Properties, Layers, Library).
- **Tool rail**: grouped families with flyouts; it scrolls vertically only, without a visible scrollbar, and its tooltips must not be clipped by the rail.

## Status — 2026-10-09

Implemented:

- Dark design tokens (`src/style/tokens.scss`), shared control styles (`src/style/app/ui.scss`) and an in-repository SVG icon set (`src/components/ui/Icon.jsx`); every interface stylesheet uses the tokens.
- Header with drawing name, a save-state dot (details on hover), the command line (Mod+K), undo/redo and clipboard, file actions.
- Tool rail of 26 slots with families (line, rectangle/polygon, rotate/align, trim/extend, fillet/chamfer/blend, arrays, break/stretch/lengthen) opened from the slot corner, a right-click or a long press; tooltips and flyouts are positioned outside the rail, which scrolls vertically without a scrollbar.
- Command line in the header, with the current prompt before the input; a panel below it shows the full prompt, the options of the active tool or command and option chips that start the option in the command line. The drawing has no floating command box and no second text field.
- Right panel with Properties, Layers and Library tabs; editing fields for a selected object live in Properties; compact layer rows with expandable appearance; Library lists blocks first.
- Managers in a floating, non-modal window opened from command search or the Manage section.
- Status bar with model/layout tabs, snap menu, grid, ortho, polar and tracking toggles, drafting settings, screen scale and zoom.
- Settings, Plot & Publish and the layout editor restyled with the same tokens.

Follow-up implemented on 2026-10-09:

- Text mode, content, named style and size stay directly accessible; font, decoration, wrapping and alignment are grouped under “Typography and alignment”, initially collapsed in creation and selection editing.
- `src/components/ui/Controls.jsx` owns Button, Input, Select, TextArea, Field and Disclosure. All native button/input/select/textarea markup in `src/components/` goes through these primitives. Existing feature classes, native input semantics and ref access are preserved.
- `src/components/ui/Fields.jsx` owns the reusable decimal, text, multiline, checkbox and custom select fields formerly embedded in DrawingCreationControls. The custom select supports arrows, Home/End, Enter, Escape and focus departure.
- `ShortcutRecorder` captures portable key combinations, displays Cmd/Option on macOS and Ctrl/Alt elsewhere, rejects reserved/duplicate bindings, and leaves the prior value intact on Escape or Tab. Explicit focus on click is required in WKWebView and was verified natively.
- Settings and publication share `useDialogFocus`: initial focus, Tab wrapping, Escape and focus restoration. Nested controls can consume Escape.
- Above 100 selected objects, individual grips are suppressed with an explanation in Properties; selection outlines and all bulk actions remain available.
- Native macOS drawing actions have an explicit Drawing/Dessin menu; system Edit keeps text-editing semantics.

Native acceptance and platform limitations are tracked in [NATIVE_QA.md](./NATIVE_QA.md). Future specialized form components should build on these primitives; the migration does not merge controls with intentionally different numeric/validation semantics.

## Documentation reconciliation — 2026-10-09

The Claude handoff requested updates to README.md, TOOL_ROADMAP.md and this audit after moving command controls. The current code and native captures establish the final arrangement: one command line in the header, with options below it. The intermediate proposal for a bottom-anchored command area is superseded. README and the roadmap already describe the final arrangement. The inventory above is now explicitly historical. LCAD_FORMAT.md already records compact JSON and the shared 64 MiB manifest limit; AGENTS.md already links the performance and UX documents.

Remaining acceptance: real project drawings, full frontend command scenarios, Windows/Linux and macOS Intel native workflows. Shared React controls, shortcut recording, compact text options and targeted native macOS Apple Silicon acceptance are implemented, as recorded above and in NATIVE_QA.md.
