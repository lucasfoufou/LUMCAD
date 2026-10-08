use std::{
    collections::{HashMap, HashSet},
    env, io,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use axum::{
    extract::{Request, State},
    http::{header::ORIGIN, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock},
    schemars, tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData as McpError, ServerHandler,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State as TauriState};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;
use url::Url;

const DEFAULT_MCP_PORT: u16 = 43_622;
const MCP_FALLBACK_SCAN: u16 = 20;
const MCP_REQUEST_EVENT: &str = "lumcad://mcp-request";
const MCP_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MCP_PROTOCOL_VERSION: &str = "2026-07-28";

pub const MCP_TOOL_NAMES: &[&str] = &[
    "get_state",
    "get_commands",
    "execute_command",
    "interact",
    "replace_document",
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDefinition {
    command: String,
    name: String,
    alias: String,
    label_key: String,
    alternatives: Vec<String>,
    description: String,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum McpAction {
    /// Submit an exact drawing point in metres. targetId identifies an entity for selection, trim, or dimensions.
    Point {
        x: f64,
        y: f64,
        #[serde(default)]
        target_id: Option<String>,
        #[serde(default)]
        shift: bool,
        #[serde(default)]
        snap: bool,
    },
    /// Submit text or a numeric value through the LUMCAD quick command bar.
    Input { value: String },
    /// Confirm the current command stage, retaining its previous default value when applicable.
    Enter,
    /// Cancel the current command and clear the selection.
    Escape,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ExecuteCommandParams {
    /// Canonical command ID, English command name, or command alias returned by get_commands.
    command: String,
    /// Optional text appended to the initial command, such as an offset distance or zoom factor.
    #[serde(default)]
    input: Option<String>,
    /// Optional entity IDs that replace the current selection before starting the command.
    #[serde(default)]
    selection: Option<Vec<String>>,
    /// Ordered point/input/enter/escape actions performed after command activation.
    #[serde(default)]
    actions: Vec<McpAction>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct InteractParams {
    /// Ordered actions applied to the command that is already active in LUMCAD.
    actions: Vec<McpAction>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
struct ReplaceDocumentParams {
    /// LUMCAD document fields to merge into the active document. The content is normalized before use.
    document: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontendRequestPayload {
    id: String,
    request: Value,
}

#[derive(Default)]
struct McpBridgeInner {
    ready_clients: Mutex<HashSet<String>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    serial: AsyncMutex<()>,
    next_id: AtomicU64,
}

#[derive(Clone, Default)]
pub struct McpBridge(Arc<McpBridgeInner>);

impl McpBridge {
    fn set_frontend_ready(&self, client_id: String, ready: bool) {
        if let Ok(mut clients) = self.0.ready_clients.lock() {
            if ready {
                clients.insert(client_id);
            } else {
                clients.remove(&client_id);
            }
        }
    }

    fn complete(&self, id: &str, result: Value) -> bool {
        self.0
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(id))
            .is_some_and(|sender| sender.send(result).is_ok())
    }

    async fn dispatch(&self, app: &AppHandle, request: Value) -> Result<Value, String> {
        let _serial = self.0.serial.lock().await;
        let ready = self
            .0
            .ready_clients
            .lock()
            .map_err(|_| "The LUMCAD MCP frontend registry is unavailable.".to_string())?
            .is_empty();
        if ready {
            return Err(
                "The LUMCAD drawing window is not ready. Keep LUMCAD open and try again.".into(),
            );
        }

        let id = format!(
            "{}-{}",
            std::process::id(),
            self.0.next_id.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = oneshot::channel();
        self.0
            .pending
            .lock()
            .map_err(|_| "The LUMCAD MCP request registry is unavailable.".to_string())?
            .insert(id.clone(), sender);

        if let Err(error) = app.emit(
            MCP_REQUEST_EVENT,
            FrontendRequestPayload {
                id: id.clone(),
                request,
            },
        ) {
            if let Ok(mut pending) = self.0.pending.lock() {
                pending.remove(&id);
            }
            return Err(format!("LUMCAD could not deliver the MCP request: {error}"));
        }

        let response = match tokio::time::timeout(MCP_REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => {
                return Err(
                    "The LUMCAD drawing window closed before completing the MCP request.".into(),
                )
            }
            Err(_) => {
                if let Ok(mut pending) = self.0.pending.lock() {
                    pending.remove(&id);
                }
                return Err(
                    "The LUMCAD drawing window did not answer the MCP request within 30 seconds."
                        .into(),
                );
            }
        };

        if response.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(response.get("data").cloned().unwrap_or(Value::Null))
        } else {
            Err(response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("The LUMCAD frontend rejected the MCP request.")
                .to_string())
        }
    }
}

#[derive(Clone)]
struct McpFrontendDispatcher {
    app: AppHandle,
    bridge: McpBridge,
}

impl McpFrontendDispatcher {
    async fn dispatch(&self, request: Value) -> Result<Value, String> {
        self.bridge.dispatch(&self.app, request).await
    }
}

#[derive(Clone)]
struct LumcadMcpServer {
    dispatcher: Option<McpFrontendDispatcher>,
}

impl LumcadMcpServer {
    fn new(dispatcher: Option<McpFrontendDispatcher>) -> Self {
        Self { dispatcher }
    }

    async fn dispatch(&self, request: Value) -> CallToolResult {
        let Some(dispatcher) = &self.dispatcher else {
            return tool_error("The LUMCAD drawing window is unavailable.");
        };
        match dispatcher.dispatch(request).await {
            Ok(value) => json_tool_result(value),
            Err(error) => tool_error(error),
        }
    }
}

#[tool_router]
impl LumcadMcpServer {
    #[tool(
        description = "Return the complete active LUMCAD document and editor state, including entity IDs, selection, active command, viewport, and file path."
    )]
    async fn get_state(&self) -> CallToolResult {
        self.dispatch(json!({ "kind": "get_state" })).await
    }

    #[tool(
        description = "List every LUMCAD command, canonical English name, alias, accepted alternatives, and usage guidance."
    )]
    async fn get_commands(&self) -> CallToolResult {
        json_tool_result(json!({ "tools": MCP_TOOL_NAMES, "commands": command_manifest() }))
    }

    #[tool(
        description = "Start any LUMCAD command, optionally replace the selection, then perform ordered point/input/enter/escape actions. Coordinates use metres."
    )]
    async fn execute_command(
        &self,
        Parameters(params): Parameters<ExecuteCommandParams>,
    ) -> Result<CallToolResult, McpError> {
        let definition = find_command(&params.command).ok_or_else(|| {
            McpError::invalid_params(
                format!("Unknown LUMCAD command: {}", params.command),
                Some(json!({ "command": params.command })),
            )
        })?;
        Ok(self
            .dispatch(json!({
                "kind": "execute_command",
                "command": definition.command,
                "input": params.input,
                "selection": params.selection,
                "actions": params.actions,
            }))
            .await)
    }

    #[tool(
        description = "Continue the currently active LUMCAD command with ordered point/input/enter/escape actions without restarting it."
    )]
    async fn interact(&self, Parameters(params): Parameters<InteractParams>) -> CallToolResult {
        self.dispatch(json!({ "kind": "interact", "actions": params.actions }))
            .await
    }

    #[tool(
        description = "Merge a document object into the active LUMCAD document, normalize it, and create an undoable content revision. Use get_state first."
    )]
    async fn replace_document(
        &self,
        Parameters(params): Parameters<ReplaceDocumentParams>,
    ) -> CallToolResult {
        self.dispatch(json!({ "kind": "replace_document", "document": params.document }))
            .await
    }
}

#[tool_handler(
    name = "lumcad",
    version = "0.1.0",
    instructions = "Control the active LUMCAD drawing. Read get_state before editing, use metres for coordinates, prefer canonical command IDs from get_commands, and use entity IDs from the current state."
)]
impl ServerHandler for LumcadMcpServer {}

struct McpRuntimeInner {
    state: Mutex<McpRuntimeData>,
}

struct McpRuntimeData {
    generation: u64,
    cancellation: Option<CancellationToken>,
    status: McpStatus,
}

#[derive(Clone)]
pub struct McpRuntimeState(Arc<McpRuntimeInner>);

impl Default for McpRuntimeState {
    fn default() -> Self {
        Self(Arc::new(McpRuntimeInner {
            state: Mutex::new(McpRuntimeData {
                generation: 0,
                cancellation: None,
                status: McpStatus::stopped(true, DEFAULT_MCP_PORT),
            }),
        }))
    }
}

impl McpRuntimeState {
    pub fn cancel(&self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.generation += 1;
            if let Some(cancellation) = state.cancellation.take() {
                cancellation.cancel();
            }
            state.status.running = false;
            state.status.starting = false;
            state.status.endpoint = None;
            state.status.health_endpoint = None;
            state.status.actual_port = None;
            state.status.fallback_used = false;
        }
    }

    fn configure(&self, enabled: bool, preferred_port: u16) -> Option<(u64, CancellationToken)> {
        let mut state = self.0.state.lock().ok()?;
        state.generation += 1;
        if let Some(cancellation) = state.cancellation.take() {
            cancellation.cancel();
        }
        state.status = McpStatus::stopped(enabled, preferred_port);
        if !enabled {
            return None;
        }
        state.status.starting = true;
        let cancellation = CancellationToken::new();
        state.cancellation = Some(cancellation.clone());
        Some((state.generation, cancellation))
    }

    fn mark_running(&self, generation: u64, preferred_port: u16, actual_port: u16) {
        if let Ok(mut state) = self.0.state.lock() {
            if state.generation != generation {
                return;
            }
            state.status.running = true;
            state.status.starting = false;
            state.status.endpoint = Some(format!("http://127.0.0.1:{actual_port}/mcp"));
            state.status.health_endpoint = Some(format!("http://127.0.0.1:{actual_port}/health"));
            state.status.actual_port = Some(actual_port);
            state.status.fallback_used = actual_port != preferred_port;
            state.status.last_error = None;
        }
    }

    fn mark_failed(&self, generation: u64, error: String) {
        if let Ok(mut state) = self.0.state.lock() {
            if state.generation != generation {
                return;
            }
            state.cancellation = None;
            state.status.running = false;
            state.status.starting = false;
            state.status.endpoint = None;
            state.status.health_endpoint = None;
            state.status.actual_port = None;
            state.status.fallback_used = false;
            state.status.last_error = Some(error);
        }
    }

    fn status(&self) -> McpStatus {
        self.0
            .state
            .lock()
            .map(|state| state.status.clone())
            .unwrap_or_else(|_| McpStatus::stopped(false, DEFAULT_MCP_PORT))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    enabled: bool,
    running: bool,
    starting: bool,
    endpoint: Option<String>,
    health_endpoint: Option<String>,
    preferred_port: u16,
    actual_port: Option<u16>,
    fallback_used: bool,
    protocol_version: &'static str,
    last_error: Option<String>,
}

impl McpStatus {
    fn stopped(enabled: bool, preferred_port: u16) -> Self {
        Self {
            enabled,
            running: false,
            starting: false,
            endpoint: None,
            health_endpoint: None,
            preferred_port,
            actual_port: None,
            fallback_used: false,
            protocol_version: MCP_PROTOCOL_VERSION,
            last_error: None,
        }
    }
}

#[tauri::command]
pub fn set_mcp_frontend_ready(bridge: TauriState<'_, McpBridge>, client_id: String, ready: bool) {
    bridge.set_frontend_ready(client_id, ready);
}

#[tauri::command]
pub fn complete_mcp_request(bridge: TauriState<'_, McpBridge>, id: String, result: Value) -> bool {
    bridge.complete(&id, result)
}

#[tauri::command]
pub fn get_mcp_status(runtime: TauriState<'_, McpRuntimeState>) -> McpStatus {
    runtime.status()
}

pub fn start(app: AppHandle) {
    restart(app);
}

pub fn restart(app: AppHandle) {
    let preferences = app
        .state::<crate::settings::AppSettingsState>()
        .snapshot()
        .mcp;
    let preferred_port = match configured_preferred_port(preferences.preferred_port) {
        Ok(port) => port,
        Err(error) => {
            let runtime = app.state::<McpRuntimeState>().inner().clone();
            if let Some((generation, cancellation)) =
                runtime.configure(true, preferences.preferred_port)
            {
                cancellation.cancel();
                runtime.mark_failed(generation, error.clone());
            }
            eprintln!("LUMCAD MCP server failed: {error}");
            return;
        }
    };
    let runtime = app.state::<McpRuntimeState>().inner().clone();
    let Some((generation, cancellation)) = runtime.configure(preferences.enabled, preferred_port)
    else {
        return;
    };
    let bridge = app.state::<McpBridge>().inner().clone();
    let task_cancellation = cancellation.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = serve(
            app,
            bridge,
            runtime.clone(),
            generation,
            preferred_port,
            task_cancellation,
        )
        .await
        {
            if cancellation.is_cancelled() {
                return;
            }
            runtime.mark_failed(generation, error.clone());
            eprintln!("LUMCAD MCP server failed: {error}");
        }
    });
}

async fn serve(
    app: AppHandle,
    bridge: McpBridge,
    runtime: McpRuntimeState,
    generation: u64,
    preferred_port: u16,
    cancellation: CancellationToken,
) -> Result<(), String> {
    let dispatcher = McpFrontendDispatcher {
        app: app.clone(),
        bridge,
    };
    let service_dispatcher = dispatcher.clone();
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_cancellation_token(cancellation.child_token());
    let service = StreamableHttpService::new(
        move || Ok(LumcadMcpServer::new(Some(service_dispatcher.clone()))),
        LocalSessionManager::default().into(),
        config,
    );
    let router = Router::new()
        .route("/health", get(health))
        .nest_service("/mcp", service)
        .layer(middleware::from_fn(validate_origin))
        .with_state(runtime.clone());
    let listener = bind_available_listener(preferred_port).await?;
    let actual_address = listener
        .local_addr()
        .map_err(|error| format!("cannot read the MCP server address: {error}"))?;
    runtime.mark_running(generation, preferred_port, actual_address.port());

    axum::serve(listener, router)
        .with_graceful_shutdown(cancellation.cancelled_owned())
        .await
        .map_err(|error| format!("MCP HTTP server stopped unexpectedly: {error}"))
}

async fn health(State(runtime): State<McpRuntimeState>) -> Json<McpStatus> {
    Json(runtime.status())
}

async fn validate_origin(request: Request, next: Next) -> Response {
    if request
        .headers()
        .get(ORIGIN)
        .is_some_and(|origin| !is_allowed_origin(origin))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

fn is_allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(url) = Url::parse(origin) else {
        return false;
    };
    matches!(url.scheme(), "http" | "https" | "tauri")
        && matches!(
            url.host_str(),
            Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
        )
}

fn configured_preferred_port(saved_port: u16) -> Result<u16, String> {
    match env::var("LUMCAD_MCP_PORT") {
        Ok(value) => value
            .parse::<u16>()
            .ok()
            .filter(|value| *value >= 1_024)
            .ok_or_else(|| {
                "LUMCAD_MCP_PORT must be an integer between 1024 and 65535.".to_string()
            }),
        Err(_) => Ok(saved_port.max(1_024)),
    }
}

async fn bind_available_listener(preferred_port: u16) -> Result<tokio::net::TcpListener, String> {
    let preferred_address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), preferred_port);
    match tokio::net::TcpListener::bind(preferred_address).await {
        Ok(listener) => return Ok(listener),
        Err(error) if error.kind() == io::ErrorKind::AddrInUse => {
            // A server we just cancelled may need a brief moment to release its
            // listener. Retry once so changing settings does not create a false
            // fallback while still recovering instantly from an external conflict.
            tokio::time::sleep(Duration::from_millis(75)).await;
            match tokio::net::TcpListener::bind(preferred_address).await {
                Ok(listener) => return Ok(listener),
                Err(retry_error) if retry_error.kind() == io::ErrorKind::AddrInUse => {}
                Err(retry_error) => {
                    return Err(format!(
                        "cannot bind MCP server to {preferred_address}: {retry_error}"
                    ))
                }
            }
        }
        Err(error) => {
            return Err(format!(
                "cannot bind MCP server to {preferred_address}: {error}"
            ))
        }
    }

    for offset in 1..=MCP_FALLBACK_SCAN {
        let Some(port) = preferred_port.checked_add(offset) else {
            break;
        };
        let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => return Ok(listener),
            Err(error) if error.kind() == io::ErrorKind::AddrInUse => continue,
            Err(error) => return Err(format!("cannot bind MCP server to {address}: {error}")),
        }
    }

    tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|error| format!("cannot select an available local MCP port: {error}"))
}

fn command_manifest() -> &'static [CommandDefinition] {
    static COMMANDS: OnceLock<Vec<CommandDefinition>> = OnceLock::new();
    COMMANDS.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/mcp/commands.json"))
            .expect("the shared LUMCAD command manifest must be valid JSON")
    })
}

fn find_command(value: &str) -> Option<&'static CommandDefinition> {
    let normalized = value.trim().to_uppercase();
    command_manifest().iter().find(|definition| {
        definition.command == value
            || definition.name == normalized
            || definition.alias == normalized
            || definition
                .alternatives
                .iter()
                .any(|alternative| alternative.to_uppercase() == normalized)
    })
}

fn json_tool_result(value: Value) -> CallToolResult {
    let text = serde_json::to_string_pretty(&value)
        .unwrap_or_else(|_| "{\"error\":\"LUMCAD could not serialize the MCP result.\"}".into());
    let mut result = CallToolResult::success(vec![ContentBlock::text(text)]);
    result.structured_content = Some(value);
    result
}

fn tool_error(error: impl Into<String>) -> CallToolResult {
    let error = error.into();
    let mut result = CallToolResult::error(vec![ContentBlock::text(error.clone())]);
    result.structured_content = Some(json!({ "error": error }));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::{
        model::{CallToolRequestParams, ClientInfo},
        transport::StreamableHttpClientTransport,
        ServiceExt,
    };

    #[test]
    fn shared_command_manifest_is_unique_and_complete() {
        let commands = command_manifest();
        assert_eq!(commands.len(), 293);
        assert_eq!(
            commands
                .iter()
                .map(|definition| definition.command.as_str())
                .collect::<HashSet<_>>()
                .len(),
            commands.len()
        );
        assert!(commands
            .iter()
            .all(|definition| !definition.description.is_empty()));
        assert_eq!(
            find_command("L").map(|value| value.command.as_str()),
            Some("line")
        );
        assert_eq!(
            find_command("PANEL").map(|value| value.command.as_str()),
            Some("creationPanel")
        );
        assert_eq!(
            find_command("saveAs").map(|value| value.name.as_str()),
            Some("SAVEAS")
        );
        assert_eq!(
            find_command("VP").map(|value| value.command.as_str()),
            Some("viewport")
        );
        assert_eq!(
            find_command("PDFALL").map(|value| value.command.as_str()),
            Some("pdfAll")
        );
        assert_eq!(
            find_command("OTRACK").map(|value| value.command.as_str()),
            Some("objectTracking")
        );
        assert!(find_command("SAVE").is_none());
    }

    #[test]
    fn mcp_tool_registry_has_no_duplicates() {
        assert_eq!(
            MCP_TOOL_NAMES.iter().copied().collect::<HashSet<_>>().len(),
            MCP_TOOL_NAMES.len()
        );
        assert_eq!(MCP_TOOL_NAMES.len(), 5);
    }

    #[test]
    fn origin_validation_allows_only_local_origins() {
        assert!(is_allowed_origin(&HeaderValue::from_static(
            "http://localhost:3000"
        )));
        assert!(is_allowed_origin(&HeaderValue::from_static(
            "http://127.0.0.1:1420"
        )));
        assert!(is_allowed_origin(&HeaderValue::from_static(
            "tauri://localhost"
        )));
        assert!(is_allowed_origin(&HeaderValue::from_static(
            "http://[::1]:1420"
        )));
        assert!(!is_allowed_origin(&HeaderValue::from_static(
            "https://example.com"
        )));
        assert!(!is_allowed_origin(&HeaderValue::from_static("null")));
    }

    #[test]
    fn saved_port_is_used_when_no_environment_override_exists() {
        if env::var_os("LUMCAD_MCP_PORT").is_none() {
            assert_eq!(configured_preferred_port(45_321).unwrap(), 45_321);
        }
    }

    #[tokio::test]
    async fn occupied_preferred_port_falls_back_to_an_available_port() {
        let occupied = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        let fallback = bind_available_listener(occupied_port).await.unwrap();
        let fallback_port = fallback.local_addr().unwrap().port();

        assert_ne!(fallback_port, occupied_port);
        assert!(fallback_port >= 1_024);
    }

    #[tokio::test]
    async fn streamable_http_exposes_the_complete_tool_registry() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let cancellation = CancellationToken::new();
        let service = StreamableHttpService::new(
            || Ok(LumcadMcpServer::new(None)),
            LocalSessionManager::default().into(),
            StreamableHttpServerConfig::default()
                .with_legacy_session_mode(false)
                .with_json_response(true)
                .with_cancellation_token(cancellation.child_token()),
        );
        let router = Router::new()
            .nest_service("/mcp", service)
            .layer(middleware::from_fn(validate_origin));
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = cancellation.clone();
        let server_task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await
                .unwrap();
        });

        let transport = StreamableHttpClientTransport::from_uri(format!("http://{address}/mcp"));
        let client = ClientInfo::default().serve(transport).await.unwrap();
        let tools = client.list_all_tools().await.unwrap();
        let names = tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<HashSet<_>>();
        assert_eq!(names, MCP_TOOL_NAMES.iter().copied().collect());

        let result = client
            .call_tool(CallToolRequestParams::new("get_commands"))
            .await
            .unwrap();
        assert!(!result.is_error.unwrap_or(false));
        assert!(result.content.iter().any(|content| {
            content
                .as_text()
                .is_some_and(|text| text.text.contains("radiusDimension"))
        }));

        client.cancel().await.unwrap();
        cancellation.cancel();
        server_task.await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires a running LUMCAD desktop application"]
    async fn running_lumcad_app_answers_and_edits_the_active_drawing() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let endpoint = env::var("LUMCAD_MCP_ENDPOINT")
            .unwrap_or_else(|_| format!("http://127.0.0.1:{DEFAULT_MCP_PORT}/mcp"));
        let client = ClientInfo::default()
            .serve(StreamableHttpClientTransport::from_uri(endpoint))
            .await
            .unwrap();

        let state = client
            .call_tool(CallToolRequestParams::new("get_state"))
            .await
            .unwrap();
        assert!(!state.is_error.unwrap_or(false));
        let original_state = tool_result_json(&state);
        let original_count = original_state["document"]["content"]["entities"]
            .as_array()
            .unwrap()
            .len();

        let line_arguments = json!({
            "command": "line",
            "actions": [
                { "type": "point", "x": 9000, "y": 9000 },
                { "type": "point", "x": 9001, "y": 9000 },
                { "type": "escape" }
            ]
        })
        .as_object()
        .unwrap()
        .clone();
        let line = client
            .call_tool(CallToolRequestParams::new("execute_command").with_arguments(line_arguments))
            .await
            .unwrap();
        assert!(
            !line.is_error.unwrap_or(false),
            "LINE failed through the live bridge: {:?}",
            line.content
        );
        assert_eq!(
            tool_result_json(&line)["document"]["content"]["entities"]
                .as_array()
                .unwrap()
                .len(),
            original_count + 1
        );

        let undo_arguments = json!({ "command": "undo" }).as_object().unwrap().clone();
        let undo = client
            .call_tool(CallToolRequestParams::new("execute_command").with_arguments(undo_arguments))
            .await
            .unwrap();
        assert!(!undo.is_error.unwrap_or(false));
        assert_eq!(
            tool_result_json(&undo)["document"]["content"]["entities"]
                .as_array()
                .unwrap()
                .len(),
            original_count
        );

        client.cancel().await.unwrap();
    }

    fn tool_result_json(result: &CallToolResult) -> Value {
        result.structured_content.clone().unwrap_or_else(|| {
            let text = result
                .content
                .iter()
                .find_map(|content| content.as_text().map(|text| text.text.as_str()))
                .expect("tool result should contain JSON text");
            serde_json::from_str(text).expect("tool result text should be valid JSON")
        })
    }
}
