use mcpserve::Hub;

pub fn mcp_stdio() {
    mcpserve::stdio_main();
}
#[cfg(desktop)]
use tauri::Emitter;
use tauri::Manager;

fn close_mcp(app: &impl Manager<tauri::Wry>) {
    if let Some(hub) = app.try_state::<Hub>() {
        hub.close_session();
    }
}

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

// opt-in native OCR (cargo feature `native-ocr`, runtime flag `?ocr-native=1`).
// The handler registration below switches with the feature so the plain shell
// builds unchanged. The module is public so the integration test
// (tests/native_ocr.rs) can drive the exact command implementation.
#[cfg(feature = "native-ocr")]
pub mod ocr_native;
#[cfg(feature = "native-ocr")]
use ocr_native::ocr_native_recognize;

#[cfg(feature = "native-ocr")]
macro_rules! native_handler {
    ($($cmd:tt)*) => { tauri::generate_handler![$($cmd)*, ocr_native_recognize] };
}
#[cfg(not(feature = "native-ocr"))]
macro_rules! native_handler {
    ($($cmd:tt)*) => { tauri::generate_handler![$($cmd)*] };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // The loopback MCP listener is a desktop feature. iOS and Android never open it.
            #[cfg(desktop)]
            let hub = {
                let handle = app.handle().clone();
                let dispatch = std::sync::Arc::new(move |job: serde_json::Value| handle.emit("mcp-call", job).is_ok());
                Hub::start(dispatch).unwrap_or_else(|_| Hub::disabled())
            };
            #[cfg(mobile)]
            let hub = Hub::disabled();
            app.manage(hub);
            Ok(())
        })
        .invoke_handler(native_handler![mcp_ready, mcp_idle, mcp_result])
        .on_window_event(|window, event| {
            // CloseMainWindow delivers WM_CLOSE here. The runtime then calls
            // process::exit, which does not run Hub's Drop.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                close_mcp(window);
            }
        })
        .build(tauri::generate_context!())
        .expect("MathScrap failed to start")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                close_mcp(app);
            }
        });
}
