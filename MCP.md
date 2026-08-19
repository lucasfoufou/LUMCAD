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

`SAVEAS`, `OPEN`, `PSETOUT`, `PDF`, `PDFALL`, and `PDFSELECTED` intentionally open native system dialogs, just as they do from the interface. `PDFSELECTED` uses the layout tabs selected through Cmd/Ctrl-click, in their current document order. The MCP call activates the command, but the user or a desktop-automation harness must finish the native dialog. Regular persistence is handled continuously by autosave.

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
