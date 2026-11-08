//! Loopback MCP for a running MathScrap window.
//!
//! The listener binds `127.0.0.1` only. The bearer token is written to a
//! user-only file and is never put in a URL, a log line, or the page's
//! localStorage. A same-user process can read that file. This is not an
//! OS-account boundary beyond the file mode and the user profile.

#![forbid(unsafe_code)]

use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const TOOLS_JSON: &str = include_str!("../../../mcp/tools.json");
const MAX_HEADER: usize = 8 * 1024;
const MAX_BODY: usize = 64 * 1024;
const MAX_RESULT: usize = 1024 * 1024;
const MAX_SESSIONS: usize = 4;
const MAX_PENDING: usize = 8;
const MAX_CONNECTIONS: usize = 32;
const DEFAULT_PORT: u16 = 47323;

pub type Dispatch = Arc<dyn Fn(Value) -> bool + Send + Sync>;

struct Pending {
    tx: Sender<Outcome>,
}

struct Outcome {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct Inner {
    token: String,
    dir: PathBuf,
    port: u16,
    tool_timeout: Duration,
    ready: AtomicBool,
    shutdown: AtomicBool,
    connections: AtomicUsize,
    pending: Mutex<HashMap<String, Pending>>,
    sessions: Mutex<VecDeque<String>>,
    dispatch: Dispatch,
}

#[derive(Clone)]
pub struct Hub {
    inner: Arc<Inner>,
    thread: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl Hub {
    /// Start nothing. The window still runs; MCP stays closed.
    pub fn disabled() -> Self {
        Self {
            inner: Arc::new(Inner {
                token: String::new(),
                dir: PathBuf::new(),
                port: 0,
                tool_timeout: Duration::from_secs(15),
                ready: AtomicBool::new(false),
                shutdown: AtomicBool::new(true),
                connections: AtomicUsize::new(0),
                pending: Mutex::new(HashMap::new()),
                sessions: Mutex::new(VecDeque::new()),
                dispatch: Arc::new(|_| false),
            }),
            thread: Arc::new(Mutex::new(None)),
        }
    }

    pub fn listening(&self) -> bool {
        !self.inner.shutdown.load(Ordering::SeqCst) && self.inner.port != 0
    }

    pub fn port(&self) -> u16 {
        self.inner.port
    }

    pub fn dir(&self) -> &Path {
        &self.inner.dir
    }

    pub fn set_ready(&self, ready: bool) {
        self.inner.ready.store(ready, Ordering::SeqCst);
        if !ready {
            self.inner.fail_all("mcp_page_offline", "The MathScrap window is not ready.");
        }
    }

    pub fn complete(&self, id: &str, ok: bool, result: Option<Value>, error: Option<String>) -> bool {
        self.inner.finish(id, Outcome { ok, result, error })
    }

    /// Bind loopback, write the session file, and serve until dropped.
    pub fn start(dispatch: Dispatch) -> Result<Self, String> {
        if mcp_disabled() {
            return Err("mcp disabled".into());
        }
        let dir = mcp_dir()?;
        let port = mcp_port()?;
        let tool_timeout = tool_timeout();
        start_in(dir, port, tool_timeout, dispatch)
    }
}

impl Drop for Hub {
    fn drop(&mut self) {
        // Only the last owner closes the listener. Clones share `thread`.
        if Arc::strong_count(&self.thread) > 1 {
            return;
        }
        self.inner.shutdown.store(true, Ordering::SeqCst);
        self.inner.fail_all("mcp_closed", "MathScrap MCP stopped.");
        if self.inner.port != 0 {
            let _ = TcpStream::connect(("127.0.0.1", self.inner.port));
        }
        if let Some(thread) = self.thread.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = thread.join();
        }
    }
}

pub fn server_version() -> &'static str {
    match option_env!("MATHSCRAP_MCP_PROFILE") {
        Some("mcptest") => "0.0.2-dev",
        _ => "0.0.1",
    }
}

pub fn mcp_disabled() -> bool {
    matches!(
        std::env::var("MATHSCRAP_MCP").ok().as_deref().map(str::trim),
        Some("off" | "0" | "false" | "OFF")
    )
}

pub fn mcp_dir() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("MATHSCRAP_MCP_DIR") {
        let path = PathBuf::from(dir);
        if path.as_os_str().is_empty() {
            return Err("MATHSCRAP_MCP_DIR is empty".into());
        }
        return Ok(path);
    }
    let folder = match option_env!("MATHSCRAP_MCP_PROFILE") {
        Some("mcptest") => "MathScrap-mcptest",
        _ => "MathScrap",
    };
    #[cfg(windows)]
    {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "LOCALAPPDATA is unset".to_string())?;
        return Ok(base.join(folder).join("mcp"));
    }
    #[cfg(not(windows))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")))
            .ok_or_else(|| "HOME is unset".to_string())?;
        Ok(base.join(folder).join("mcp"))
    }
}

fn mcp_port() -> Result<u16, String> {
    match std::env::var("MATHSCRAP_MCP_PORT") {
        Ok(text) => text
            .trim()
            .parse::<u16>()
            .map_err(|_| "MATHSCRAP_MCP_PORT is not a port".to_string()),
        Err(_) => Ok(DEFAULT_PORT),
    }
}

fn tool_timeout() -> Duration {
    let ms = std::env::var("MATHSCRAP_MCP_TOOL_MS")
        .ok()
        .and_then(|text| text.trim().parse::<u64>().ok())
        .unwrap_or(15_000);
    Duration::from_millis(ms.clamp(50, 20_000))
}

fn start_in(dir: PathBuf, port: u16, tool_timeout: Duration, dispatch: Dispatch) -> Result<Hub, String> {
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|err| format!("mcp bind failed: {err}"))?;
    listener.set_nonblocking(false).map_err(|err| format!("mcp bind failed: {err}"))?;
    let bound = listener.local_addr().map_err(|err| format!("mcp bind failed: {err}"))?;
    if !bound.ip().is_loopback() {
        return Err("mcp refused a non-loopback bind".into());
    }
    let token = new_token()?;
    write_private(&dir, &token, bound.port())?;
    let inner = Arc::new(Inner {
        token,
        dir,
        port: bound.port(),
        tool_timeout,
        ready: AtomicBool::new(false),
        shutdown: AtomicBool::new(false),
        connections: AtomicUsize::new(0),
        pending: Mutex::new(HashMap::new()),
        sessions: Mutex::new(VecDeque::new()),
        dispatch,
    });
    let accept = inner.clone();
    let thread = thread::spawn(move || accept_loop(listener, accept));
    Ok(Hub { inner, thread: Arc::new(Mutex::new(Some(thread))) })
}

fn accept_loop(listener: TcpListener, inner: Arc<Inner>) {
    let _ = listener.set_nonblocking(false);
    loop {
        if inner.shutdown.load(Ordering::SeqCst) {
            break;
        }
        match listener.accept() {
            Ok((stream, peer)) => {
                if inner.shutdown.load(Ordering::SeqCst) {
                    break;
                }
                if !peer_ok(peer) {
                    let _ = stream.shutdown(Shutdown::Both);
                    continue;
                }
                if inner.connections.load(Ordering::SeqCst) >= MAX_CONNECTIONS {
                    let body = serde_json::to_vec(&rpc_error(None, "mcp_busy", "Too many MCP connections.")).unwrap_or_default();
                    let _ = write_http(&stream, 503, &[], &body);
                    continue;
                }
                inner.connections.fetch_add(1, Ordering::SeqCst);
                let inner = inner.clone();
                thread::spawn(move || {
                    serve_one(stream, &inner);
                    inner.connections.fetch_sub(1, Ordering::SeqCst);
                });
            }
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => {
                if inner.shutdown.load(Ordering::SeqCst) {
                    break;
                }
            }
        }
    }
}

fn peer_ok(peer: SocketAddr) -> bool {
    match peer.ip() {
        IpAddr::V4(ip) => ip.is_loopback(),
        IpAddr::V6(_) => false,
    }
}

fn serve_one(mut stream: TcpStream, inner: &Inner) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(20)));
    let incoming = match read_request(&mut stream) {
        Ok(incoming) => incoming,
        Err(Fail::TooLarge) => {
            let body = serde_json::to_vec(&rpc_error(None, "mcp_too_large", "The MCP request is too large.")).unwrap_or_default();
            let _ = write_http(&stream, 413, &[], &body);
            return;
        }
        Err(_) => return,
    };
    let response = handle(inner, incoming);
    let _ = write_http(&stream, response.status, &response.headers, &response.body);
}

struct Incoming {
    method: String,
    target: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct Outgoing {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

fn handle(inner: &Inner, incoming: Incoming) -> Outgoing {
    if incoming.headers.keys().any(|key| key == "upgrade") {
        return plain(400, rpc_error(None, "mcp_bad_request", "WebSocket upgrade is refused."));
    }
    if incoming.target.chars().any(|ch| ch == '?' || ch == '#') {
        return plain(400, rpc_error(None, "mcp_bad_request", "The token must not be in the URL."));
    }
    if incoming.method == "OPTIONS" {
        return plain(403, rpc_error(None, "mcp_bad_origin", "Browser preflight is refused."));
    }
    if incoming.target != "/mcp" {
        return plain(404, rpc_error(None, "mcp_unknown_path", "Unknown MCP path."));
    }
    if incoming.method != "POST" {
        return plain(405, rpc_error(None, "mcp_bad_request", "Only POST /mcp is accepted."));
    }
    if !host_ok(&incoming.headers, inner.port) {
        return plain(403, rpc_error(None, "mcp_bad_host", "Host is not this loopback listener."));
    }
    if !origin_ok(&incoming.headers) {
        return plain(403, rpc_error(None, "mcp_bad_origin", "Origin is refused."));
    }
    if !bearer_ok(&incoming.headers, &inner.token) {
        return plain(401, rpc_error(None, "mcp_unauthorized", "Unauthorized."));
    }
    let rpc: Value = match serde_json::from_slice::<Value>(&incoming.body) {
        Ok(value) if value.is_object() => value,
        _ => return plain(400, rpc_error(None, "mcp_bad_json", "The body is not a JSON object.")),
    };
    let id = rpc.get("id").cloned();
    let method = rpc.get("method").and_then(Value::as_str).unwrap_or("");
    if method.is_empty() {
        return plain(400, rpc_error(id, "mcp_bad_json", "The JSON-RPC method is missing."));
    }
    if method == "initialize" {
        let session = new_token().unwrap_or_else(|_| "session".into());
        {
            let mut sessions = inner.sessions.lock().expect("sessions");
            sessions.push_back(session.clone());
            while sessions.len() > MAX_SESSIONS {
                sessions.pop_front();
            }
        }
        let asked = rpc
            .pointer("/params/protocolVersion")
            .and_then(Value::as_str)
            .unwrap_or("2024-11-05");
        let version = if matches!(asked, "2024-11-05" | "2025-03-26" | "2025-06-18") {
            asked
        } else {
            "2024-11-05"
        };
        let body = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "mathscrap", "version": server_version() }
            }
        });
        return Outgoing {
            status: 200,
            headers: vec![("mcp-session-id".into(), session)],
            body: serde_json::to_vec(&body).unwrap_or_default(),
        };
    }
    let session = header(&incoming.headers, "mcp-session-id");
    let known = session
        .as_deref()
        .map(|value| inner.sessions.lock().expect("sessions").iter().any(|item| item == value))
        .unwrap_or(false);
    if !known {
        let status = if session.is_none() { 400 } else { 404 };
        let code = if session.is_none() { "mcp_no_session" } else { "mcp_unknown_session" };
        return plain(status, rpc_error(id, code, "The MCP session does not match."));
    }
    if id.is_none() {
        return Outgoing { status: 202, headers: vec![], body: Vec::new() };
    }
    let body = match method {
        "tools/list" => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "tools": tool_list() }
        }),
        "tools/call" => tool_call(inner, id, rpc.get("params").cloned().unwrap_or(Value::Null)),
        "ping" => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
        _ => rpc_error(id, "mcp_unknown_method", "Unknown MCP method."),
    };
    plain(200, body)
}

fn tool_call(inner: &Inner, id: Option<Value>, params: Value) -> Value {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("");
    let tools = tool_list();
    let known = tools.as_array().map(|tools| tools.iter().any(|tool| tool["name"] == name)).unwrap_or(false);
    if !known {
        return tool_is_error(id, "mcp_unknown_tool", "Unknown tool.");
    }
    if !inner.ready.load(Ordering::SeqCst) {
        return tool_is_error(id, "mcp_page_offline", "The MathScrap window is not ready.");
    }
    let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    if !arguments.is_object() {
        return tool_is_error(id, "mcp_bad_json", "Tool arguments must be an object.");
    }
    let call_id = new_token().unwrap_or_else(|_| "call".into());
    {
        let pending = inner.pending.lock().expect("pending");
        if pending.len() >= MAX_PENDING {
            return tool_is_error(id, "mcp_busy", "Too many tool calls are waiting.");
        }
    }
    let (tx, rx) = mpsc::channel();
    inner.pending.lock().expect("pending").insert(call_id.clone(), Pending { tx });
    let job = json!({"id": call_id, "name": name, "arguments": arguments});
    let accepted = (inner.dispatch)(job);
    if !accepted {
        inner.pending.lock().expect("pending").remove(&call_id);
        return tool_is_error(id, "mcp_page_offline", "The MathScrap window is not ready.");
    }
    match rx.recv_timeout(inner.tool_timeout) {
        Ok(outcome) => {
            let _ = inner.pending.lock().expect("pending").remove(&call_id);
            if let Some(message) = outcome.error {
                return tool_is_error(id, "mcp_tool_failed", &message);
            }
            let result = outcome.result.unwrap_or(Value::Null);
            if let Some(message) = result.get("error").and_then(Value::as_str) {
                if result.get("ok").and_then(Value::as_bool) != Some(true) {
                    return tool_is_error(id, "mcp_tool_failed", message);
                }
            }
            let text = serde_json::to_string(&result).unwrap_or_else(|_| "null".into());
            if text.len() > MAX_RESULT {
                return tool_is_error(id, "mcp_too_large", "The tool result is too large.");
            }
            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{ "type": "text", "text": text }],
                    "isError": !outcome.ok
                }
            })
        }
        Err(_) => {
            let _ = inner.pending.lock().expect("pending").remove(&call_id);
            tool_is_error(id, "mcp_timeout", "The tool call timed out.")
        }
    }
}

fn tool_is_error(id: Option<Value>, code: &str, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": serde_json::to_string(&json!({"code": code, "error": message})).unwrap_or_default() }],
            "isError": true
        }
    })
}

fn tool_list() -> Value {
    serde_json::from_str(TOOLS_JSON).unwrap_or_else(|_| json!([]))
}

impl Inner {
    fn finish(&self, id: &str, outcome: Outcome) -> bool {
        let Some(pending) = self.pending.lock().expect("pending").remove(id) else {
            return false;
        };
        pending.tx.send(outcome).is_ok()
    }

    fn fail_all(&self, code: &str, message: &str) {
        let pending = std::mem::take(&mut *self.pending.lock().expect("pending"));
        for (_, item) in pending {
            let _ = item.tx.send(Outcome {
                ok: false,
                result: None,
                error: Some(format!("{code}: {message}")),
            });
        }
    }
}

fn host_ok(headers: &HashMap<String, String>, port: u16) -> bool {
    let Some(host) = header(headers, "host") else { return false };
    let host = host.trim();
    if host.contains('@') || host.contains('\\') {
        return false;
    }
    let (name, found) = match host.rsplit_once(':') {
        Some((name, port_text)) => {
            let Ok(parsed) = port_text.parse::<u16>() else { return false };
            (name, parsed)
        }
        None => return false,
    };
    found == port && (name.eq_ignore_ascii_case("127.0.0.1") || name.eq_ignore_ascii_case("localhost"))
}

fn origin_ok(headers: &HashMap<String, String>) -> bool {
    // Native clients omit Origin. Any browser Origin, including null, is refused.
    // The window uses Tauri IPC, not this port.
    header(headers, "origin").is_none()
}

fn bearer_ok(headers: &HashMap<String, String>, token: &str) -> bool {
    let Some(value) = header(headers, "authorization") else { return false };
    let mut parts = value.trim().split_whitespace();
    let Some(scheme) = parts.next() else { return false };
    let Some(presented) = parts.next() else { return false };
    if parts.next().is_some() || !scheme.eq_ignore_ascii_case("bearer") {
        return false;
    }
    tokens_match(presented, token)
}

fn tokens_match(presented: &str, token: &str) -> bool {
    if presented.len() != token.len() || presented.len() != 64 {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in presented.bytes().zip(token.bytes()) {
        diff |= left ^ right;
    }
    diff == 0
}

fn header(headers: &HashMap<String, String>, name: &str) -> Option<String> {
    headers.get(name).cloned()
}

fn plain(status: u16, body: Value) -> Outgoing {
    Outgoing {
        status,
        headers: vec![],
        body: serde_json::to_vec(&body).unwrap_or_default(),
    }
}

fn rpc_error(id: Option<Value>, code: &str, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": -32001, "message": message, "data": { "code": code } }
    })
}

fn read_request(stream: &mut TcpStream) -> Result<Incoming, Fail> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    let header_end;
    loop {
        if buf.len() > MAX_HEADER {
            return Err(Fail::TooLarge);
        }
        let n = stream.read(&mut chunk).map_err(|_| Fail::Closed)?;
        if n == 0 {
            return Err(Fail::Closed);
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_sub(&buf, b"\r\n\r\n") {
            header_end = pos;
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let Some(request) = lines.next() else { return Err(Fail::Bad) };
    let mut parts = request.split(' ');
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let version = parts.next().unwrap_or("");
    if !matches!(version, "HTTP/1.1" | "HTTP/1.0") || parts.next().is_some() {
        return Err(Fail::Bad);
    }
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else { return Err(Fail::Bad) };
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty() || headers.contains_key(&name) {
            return Err(Fail::Bad);
        }
        headers.insert(name, value.trim().to_string());
    }
    if headers.contains_key("transfer-encoding") {
        return Err(Fail::Bad);
    }
    let mut body = buf[header_end + 4..].to_vec();
    let length = if method == "POST" {
        let text = headers.get("content-length").ok_or(Fail::Bad)?;
        let length: usize = text.parse().map_err(|_| Fail::Bad)?;
        if length > MAX_BODY {
            return Err(Fail::TooLarge);
        }
        length
    } else if headers.contains_key("content-length") {
        return Err(Fail::Bad);
    } else {
        0
    };
    while body.len() < length {
        let n = stream.read(&mut chunk).map_err(|_| Fail::Closed)?;
        if n == 0 {
            return Err(Fail::Closed);
        }
        if body.len() + n > MAX_BODY {
            return Err(Fail::TooLarge);
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Ok(Incoming { method, target, headers, body })
}

enum Fail {
    Closed,
    Bad,
    TooLarge,
}

fn find_sub(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|window| window == needle)
}

fn write_http(mut stream: impl Write, status: u16, extra: &[(String, String)], body: &[u8]) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        503 => "Service Unavailable",
        _ => "Error",
    };
    let mut head = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n", body.len());
    for (name, value) in extra {
        if name.eq_ignore_ascii_case("access-control-allow-origin") || name.eq_ignore_ascii_case("location") {
            continue;
        }
        head.push_str(name);
        head.push_str(": ");
        head.push_str(value);
        head.push_str("\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    Ok(())
}

fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "the system random source failed".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn write_private(dir: &Path, token: &str, port: u16) -> Result<(), String> {
    if dir.symlink_metadata().map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
        return Err("mcp directory is a symlink".into());
    }
    fs::create_dir_all(dir).map_err(|_| "mcp directory was not created".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    write_file(&dir.join("session"), token)?;
    write_file(&dir.join("endpoint"), &format!("http://127.0.0.1:{port}/mcp"))?;
    Ok(())
}

fn write_file(path: &Path, text: &str) -> Result<(), String> {
    if path.symlink_metadata().map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
        return Err("mcp file is a symlink".into());
    }
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "mcp file was not written".to_string())?;
    file.write_all(text.as_bytes()).map_err(|_| "mcp file was not written".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Speak MCP on stdio by forwarding to the loopback listener.
/// The token is read from the session file and is not written to stdout or stderr.
pub fn stdio_main() {
    let mut session: Option<String> = None;
    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    loop {
        let frame = match read_frame(&mut input) {
            Ok(frame) => frame,
            Err(_) => break,
        };
        let message: Value = match serde_json::from_slice(&frame) {
            Ok(value) => value,
            Err(_) => {
                let _ = write_frame(&mut output, &serde_json::to_vec(&rpc_error(None, "mcp_bad_json", "The body is not JSON.")).unwrap_or_default());
                continue;
            }
        };
        let notification = message.get("id").is_none();
        match forward(&mut session, &message) {
            Ok(Some(bytes)) if !notification => {
                let _ = write_frame(&mut output, &bytes);
            }
            Ok(_) => {}
            Err(reason) => {
                if notification {
                    continue;
                }
                let id = message_id(&message);
                let _ = write_frame(&mut output, &serde_json::to_vec(&rpc_error(id, "mcp_closed", &reason)).unwrap_or_default());
            }
        }
    }
}

fn message_id(message: &Value) -> Option<Value> {
    message.get("id").cloned()
}

fn forward(session: &mut Option<String>, message: &Value) -> Result<Option<Vec<u8>>, String> {
    forward_in(&mcp_dir()?, session, message)
}

fn forward_in(dir: &Path, session: &mut Option<String>, message: &Value) -> Result<Option<Vec<u8>>, String> {
    let (port, token) = read_local_endpoint(dir)?;
    let body = serde_json::to_vec(message).map_err(|_| "The request could not be encoded.".to_string())?;
    let mut extra = String::new();
    if let Some(id) = session {
        extra = format!("Mcp-Session-Id: {id}\r\n");
    }
    let request = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n",
        body.len()
    );
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|_| "MathScrap is not running.".to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
    stream.write_all(request.as_bytes()).map_err(|_| "MathScrap is not running.".to_string())?;
    stream.write_all(&body).map_err(|_| "MathScrap is not running.".to_string())?;
    let (status, headers, response_body) = read_http_response(&mut stream)?;
    if (300..400).contains(&status) {
        return Err("MathScrap refused a redirect.".into());
    }
    if let Some(id) = headers.get("mcp-session-id") {
        *session = Some(id.clone());
    }
    if status == 202 || response_body.is_empty() {
        return Ok(None);
    }
    Ok(Some(response_body))
}

fn read_local_endpoint(dir: &Path) -> Result<(u16, String), String> {
    let endpoint = fs::read_to_string(dir.join("endpoint")).map_err(|_| "MathScrap is not running.".to_string())?;
    let token = fs::read_to_string(dir.join("session")).map_err(|_| "MathScrap is not running.".to_string())?;
    let token = token.trim();
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("MathScrap is not running.".into());
    }
    let port = parse_loopback_endpoint(endpoint.trim())?;
    Ok((port, token.to_string()))
}

fn parse_loopback_endpoint(text: &str) -> Result<u16, String> {
    let rest = text.strip_prefix("http://").ok_or_else(|| "The endpoint is not loopback HTTP.".to_string())?;
    let (host, port_and_path) = rest.split_once(':').ok_or_else(|| "The endpoint is not loopback HTTP.".to_string())?;
    if !host.eq_ignore_ascii_case("127.0.0.1") && !host.eq_ignore_ascii_case("localhost") {
        return Err("The endpoint is not loopback HTTP.".into());
    }
    let port_text = port_and_path.strip_suffix("/mcp").unwrap_or(port_and_path);
    if port_text.contains('/') || port_text.contains('?') {
        return Err("The endpoint is not loopback HTTP.".into());
    }
    let port: u16 = port_text.parse().map_err(|_| "The endpoint is not loopback HTTP.".to_string())?;
    if port == 0 {
        return Err("The endpoint is not loopback HTTP.".into());
    }
    Ok(port)
}

fn read_frame(input: &mut impl Read) -> std::io::Result<Vec<u8>> {
    let mut header = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        if header.len() > MAX_HEADER {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "header"));
        }
        if input.read(&mut byte)? == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "eof"));
        }
        header.push(byte[0]);
        if header.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8_lossy(&header);
    let mut length = None;
    for line in text.split("\r\n") {
        let Some((name, value)) = line.split_once(':') else { continue };
        if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "length"));
            }
            length = Some(value.trim().parse::<usize>().map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "length"))?);
        }
    }
    let length = length.ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "length"))?;
    if length > MAX_BODY {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "large"));
    }
    let mut body = vec![0u8; length];
    input.read_exact(&mut body)?;
    Ok(body)
}

fn write_frame(output: &mut impl Write, body: &[u8]) -> std::io::Result<()> {
    write!(output, "Content-Length: {}\r\n\r\n", body.len())?;
    output.write_all(body)?;
    output.flush()
}

fn read_http_response(stream: &mut TcpStream) -> Result<(u16, HashMap<String, String>, Vec<u8>), String> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    let started = Instant::now();
    let header_end;
    loop {
        if started.elapsed() > Duration::from_secs(20) {
            return Err("MathScrap did not answer.".into());
        }
        if buf.len() > MAX_HEADER + MAX_RESULT {
            return Err("The MCP response is too large.".into());
        }
        let n = stream.read(&mut chunk).map_err(|_| "MathScrap is not running.".to_string())?;
        if n == 0 {
            return Err("MathScrap is not running.".into());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_sub(&buf, b"\r\n\r\n") {
            header_end = pos;
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or("");
    let status: u16 = status_line.split(' ').nth(1).and_then(|text| text.parse().ok()).unwrap_or(0);
    let mut headers = HashMap::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    if headers.contains_key("location") {
        return Err("MathScrap refused a redirect.".into());
    }
    let length = headers.get("content-length").and_then(|text| text.parse::<usize>().ok()).unwrap_or(0);
    if length > MAX_RESULT {
        return Err("The MCP response is too large.".into());
    }
    let mut body = buf[header_end + 4..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).map_err(|_| "MathScrap is not running.".to_string())?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    body.truncate(length);
    Ok((status, headers, body))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let mut bytes = [0u8; 8];
        getrandom::fill(&mut bytes).unwrap();
        let name: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = std::env::temp_dir().join(format!("mathscrap-mcp-{name}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    struct Running {
        hub: Hub,
    }

    fn boot(timeout_ms: u64, dispatch: Dispatch) -> (Running, u16, String) {
        let dir = temp_dir();
        let hub = start_in(dir, 0, Duration::from_millis(timeout_ms), dispatch).expect("start");
        let token = fs::read_to_string(hub.dir().join("session")).unwrap();
        let port = hub.port();
        assert!(port != 0);
        (Running { hub }, port, token)
    }

    fn post(port: u16, token: Option<&str>, session: Option<&str>, host: &str, origin: Option<&str>, extra: &str, body: &str) -> (u16, HashMap<String, String>, Value) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        stream.set_write_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut headers = format!("POST /mcp HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n", body.len());
        if let Some(token) = token {
            headers.push_str(&format!("Authorization: Bearer {token}\r\n"));
        }
        if let Some(session) = session {
            headers.push_str(&format!("Mcp-Session-Id: {session}\r\n"));
        }
        if let Some(origin) = origin {
            headers.push_str(&format!("Origin: {origin}\r\n"));
        }
        headers.push_str(extra);
        headers.push_str("\r\n");
        stream.write_all(headers.as_bytes()).unwrap();
        stream.write_all(body.as_bytes()).unwrap();
        let (status, response_headers, response_body) = read_http_response(&mut stream).unwrap();
        let value = if response_body.is_empty() { Value::Null } else { serde_json::from_slice(&response_body).unwrap_or(Value::Null) };
        (status, response_headers, value)
    }

    fn init(port: u16, token: &str) -> String {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#;
        let (status, headers, value) = post(port, Some(token), None, &format!("127.0.0.1:{port}"), None, "", body);
        assert_eq!(status, 200, "{value}");
        assert!(headers.get("access-control-allow-origin").is_none());
        assert_eq!(value["result"]["serverInfo"]["name"], "mathscrap");
        assert!(value["result"]["capabilities"]["tools"].is_object());
        headers.get("mcp-session-id").cloned().expect("session")
    }

    #[test]
    fn protocol_page_roundtrip_and_rejections() {
        let sheet = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sheet_add = sheet.clone();
        let hub_slot: Arc<Mutex<Option<Hub>>> = Arc::new(Mutex::new(None));
        let slot = hub_slot.clone();
        let (running, port, token) = boot(400, Arc::new(move |job| {
            let id = job["id"].as_str().unwrap().to_string();
            let name = job["name"].as_str().unwrap();
            let args = job["arguments"].clone();
            let result = match name {
                "page_read" => json!({"formulas": *sheet_add.lock().unwrap(), "strokes": 0}),
                "page_add_formula" => {
                    let card = json!({"id": format!("c{}", sheet_add.lock().unwrap().len() + 1), "text": args["text"], "x": 0, "y": 0});
                    sheet_add.lock().unwrap().push(card.clone());
                    card
                }
                "page_update_formula" => {
                    let mut cards = sheet_add.lock().unwrap();
                    if let Some(card) = cards.iter_mut().find(|card| card["id"] == args["id"]) {
                        card["text"] = args["text"].clone();
                    }
                    json!({"ok": true, "id": args["id"], "text": args["text"]})
                }
                "solve_analyze" => json!({"dim": 2, "texts": args["texts"], "sections": [], "errors": []}),
                "ink_read" => json!({"total": 0, "matched": 0, "returned": 0, "strokes": []}),
                "plot_open" | "plot_set_view" => json!({"ok": true}),
                _ => json!({"error": "unknown"}),
            };
            slot.lock().unwrap().as_ref().unwrap().complete(&id, true, Some(result), None);
            true
        }));
        *hub_slot.lock().unwrap() = Some(running.hub.clone());
        assert!(running.hub.listening());
        let bound = TcpListener::bind(("127.0.0.1", port));
        assert!(bound.is_err(), "the listener must own 127.0.0.1:{port}");

        let (status, _, _) = post(port, None, None, &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 401);
        let (status, _, _) = post(port, Some("ab"), None, &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 401);
        let (status, _, value) = post(port, Some(&token), None, "evil.example:47323", None, "", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 403, "{value}");
        assert_eq!(value["error"]["data"]["code"], "mcp_bad_host");
        let (status, _, value) = post(port, Some(&token), None, &format!("127.0.0.1:{port}"), Some("null"), "", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 403);
        assert_eq!(value["error"]["data"]["code"], "mcp_bad_origin");
        let (status, _, _) = post(port, Some(&token), None, &format!("127.0.0.1:{port}"), Some("https://evil.example"), "X-Forwarded-For: 1.2.3.4\r\n", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 403);
        let (status, _, _) = post(port, Some(&token), None, &format!("127.0.0.1:{port}"), None, "Upgrade: websocket\r\n", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 400);
        let (status, _, value) = post(port, Some(&token), None, &format!("127.0.0.1:{port}"), None, "", "not-json");
        assert_eq!(status, 400);
        assert_eq!(value["error"]["data"]["code"], "mcp_bad_json");

        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let huge = format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Length: 999999\r\nConnection: close\r\n\r\n");
        stream.write_all(huge.as_bytes()).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let (status, headers, _) = read_http_response(&mut stream).unwrap();
        assert_eq!(status, 413);
        assert!(headers.get("access-control-allow-origin").is_none());
        assert!(headers.get("location").is_none());

        let session = init(port, &token);
        let note = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        let (status, _, _) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", note);
        assert_eq!(status, 202);
        let (status, _, _) = post(port, Some(&token), None, &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert_eq!(status, 400);
        let (status, _, _) = post(port, Some(&token), Some("deadbeef"), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert_eq!(status, 404);

        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert_eq!(status, 200, "{value}");
        let names: Vec<&str> = value["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["page_read", "page_add_formula", "page_update_formula", "solve_analyze", "plot_open", "plot_set_view", "ink_read"]);
        assert!(value["result"]["tools"][1]["inputSchema"]["required"].as_array().unwrap().iter().any(|item| item == "text"));

        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"page_read","arguments":{}}}"#);
        assert_eq!(status, 200);
        let text = value["result"]["content"][0]["text"].as_str().unwrap();
        assert_eq!(value["result"]["isError"], true);
        assert!(text.contains("mcp_page_offline"), "{text}");

        running.hub.set_ready(true);
        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"page_add_formula","arguments":{"text":"y = x"}}}"#);
        assert_eq!(status, 200, "{value}");
        assert_eq!(value["result"]["isError"], false);
        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"page_read","arguments":{}}}"#);
        assert_eq!(status, 200, "{value}");
        let read = serde_json::from_str::<Value>(value["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(read["formulas"][0]["text"], "y = x");
        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"page_update_formula","arguments":{"id":"c1","text":"y = 2"}}}"#);
        assert_eq!(status, 200, "{value}");
        assert_eq!(value["result"]["isError"], false);
        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"solve_analyze","arguments":{"texts":["y = 2"]}}}"#);
        assert_eq!(status, 200, "{value}");
        let solved = serde_json::from_str::<Value>(value["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(solved["dim"], 2);
        assert_eq!(solved["texts"][0], "y = 2");
        let _ = sheet;
    }

    #[test]
    fn timeout_busy_shutdown_and_stdio() {
        let (running, port, token) = boot(200, Arc::new(|_job| true));
        running.hub.set_ready(true);
        let session = init(port, &token);
        let started = Instant::now();
        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"page_read","arguments":{}}}"#);
        assert_eq!(status, 200, "{value}");
        assert_eq!(value["result"]["isError"], true);
        assert!(value["result"]["content"][0]["text"].as_str().unwrap().contains("mcp_timeout"));
        assert!(started.elapsed() < Duration::from_secs(3));
        drop(running);

        let entered = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(AtomicBool::new(false));
        let (running, port, token) = boot(2_000, {
            let entered = entered.clone();
            let release = release.clone();
            Arc::new(move |_job| {
                entered.fetch_add(1, Ordering::SeqCst);
                while !release.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(5));
                }
                false
            })
        });
        running.hub.set_ready(true);
        let session = init(port, &token);
        let mut handles = Vec::new();
        for _ in 0..MAX_PENDING {
            let session = session.clone();
            let token = token.clone();
            handles.push(thread::spawn(move || {
                post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"ink_read","arguments":{}}}"#)
            }));
        }
        let wait_until = Instant::now() + Duration::from_secs(2);
        while entered.load(Ordering::SeqCst) < MAX_PENDING && Instant::now() < wait_until {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(entered.load(Ordering::SeqCst), MAX_PENDING);
        let (status, _, value) = post(port, Some(&token), Some(&session), &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ink_read","arguments":{}}}"#);
        assert_eq!(status, 200, "{value}");
        assert!(value["result"]["content"][0]["text"].as_str().unwrap().contains("mcp_busy"), "{value}");
        release.store(true, Ordering::SeqCst);
        for handle in handles {
            let _ = handle.join();
        }
        let old = token.clone();
        let port = running.hub.port();
        drop(running);
        let refused = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(200));
        assert!(refused.is_err() || refused.unwrap().write_all(b"GET / HTTP/1.1\r\n\r\n").is_err());

        let (running, port, token) = boot(500, Arc::new(|_job| true));
        let (status, _, _) = post(port, Some(&old), None, &format!("127.0.0.1:{port}"), None, "", r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#);
        assert_eq!(status, 401);
        let mut session = None;
        let response = forward_in(running.hub.dir(), &mut session, &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}}})).unwrap().unwrap();
        let value: Value = serde_json::from_slice(&response).unwrap();
        assert_eq!(value["result"]["protocolVersion"], "2025-03-26");
        assert!(session.is_some());
        assert_ne!(token, old);
        let listed = forward_in(running.hub.dir(), &mut session, &json!({"jsonrpc":"2.0","id":2,"method":"tools/list"})).unwrap().unwrap();
        let listed: Value = serde_json::from_slice(&listed).unwrap();
        assert_eq!(listed["result"]["tools"][0]["name"], "page_read");
        assert!(parse_loopback_endpoint("http://169.254.169.254/mcp").is_err());
        assert!(parse_loopback_endpoint("https://127.0.0.1:1/mcp").is_err());
        let mode = fs::metadata(running.hub.dir().join("session")).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(mode.mode() & 0o077, 0);
        }
        let _ = mode;
    }
}
