use mcpserve::Hub;

pub fn mcp_stdio() {
    mcpserve::stdio_main();
}
use tauri::{Emitter, Manager};

#[tauri::command]
fn mcp_ready(hub: tauri::State<'_, Hub>) {
    hub.set_ready(true);
}

#[tauri::command]
fn mcp_idle(hub: tauri::State<'_, Hub>) {
    hub.set_ready(false);
}

#[tauri::command]
fn mcp_result(
    hub: tauri::State<'_, Hub>,
    id: String,
    ok: bool,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> bool {
    hub.complete(&id, ok, result, error)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let dispatch = std::sync::Arc::new(move |job: serde_json::Value| handle.emit("mcp-call", job).is_ok());
            let hub = Hub::start(dispatch).unwrap_or_else(|_| Hub::disabled());
            app.manage(hub);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![mcp_ready, mcp_idle, mcp_result])
        .run(tauri::generate_context!())
        .expect("MathScrap failed to start");
}
