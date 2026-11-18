//! Tauri commands: the UI's only way into the engine. Long-running engine calls
//! run on the blocking thread pool so the UI stays responsive.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use dl_engine::{ChatMessage, DeviceShare, EngineError, GenParams, GenSummary, Host, Worker, WorkerConfig, WorkerStatus};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::device_info::{device_info as read_device_info, DeviceInfo};
use crate::models;

/// Engine objects owned by the app. One worker and one host per process (engine rule).
#[derive(Default)]
pub struct EngineState {
    worker: Mutex<Option<Worker>>,
    /// `Arc` so a long generation doesn't hold the lock (cancel must get through).
    host: Mutex<Option<Arc<Host>>>,
}

#[derive(Clone, Serialize)]
struct LoadProgress {
    frac: f32,
}

#[derive(Clone, Serialize)]
struct Token {
    piece: String,
}

/// Downloaded models live in the app's data directory. `DL_MODELS_DIR` overrides it
/// (development: point it at the repo's `models/`).
fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("DL_MODELS_DIR") {
        return Ok(PathBuf::from(dir));
    }
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn device_info() -> DeviceInfo {
    read_device_info()
}

#[tauri::command]
pub async fn worker_start(app: AppHandle, port: u16) -> Result<WorkerStatus, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("rpc");
    blocking(move || {
        let state = app.state::<EngineState>();
        let mut worker = state.worker.lock().unwrap();
        if let Some(w) = worker.as_ref() {
            return Ok(w.status());
        }
        let w = Worker::start(WorkerConfig { bind_host: "0.0.0.0".into(), port, cache_dir: Some(cache_dir), threads: None })
            .map_err(|e| e.to_string())?;
        let status = w.status();
        *worker = Some(w);
        Ok(status)
    })
    .await
}

#[tauri::command]
pub fn worker_status(state: State<'_, EngineState>) -> Option<WorkerStatus> {
    state.worker.lock().unwrap().as_ref().map(Worker::status)
}

#[tauri::command]
pub async fn host_load(app: AppHandle, model_id: String, endpoints: Vec<String>) -> Result<Vec<DeviceShare>, String> {
    let path = models::model_path(&models_dir(&app)?, &model_id)?;
    blocking(move || {
        let state = app.state::<EngineState>();
        // Only one model at a time: unload the previous one before loading.
        state.host.lock().unwrap().take();
        let emitter = app.clone();
        let host = Host::load(&path, &endpoints, None, move |frac| {
            let _ = emitter.emit("load-progress", LoadProgress { frac });
        })
        .map_err(|e| e.to_string())?;
        let shares = host.device_shares();
        *state.host.lock().unwrap() = Some(Arc::new(host));
        Ok(shares)
    })
    .await
}

#[tauri::command]
pub async fn host_generate(app: AppHandle, messages: Vec<ChatMessage>) -> Result<GenSummary, String> {
    let host = app.state::<EngineState>().host.lock().unwrap().clone().ok_or("no model loaded")?;
    blocking(move || {
        let result = host.generate(&messages, GenParams::default(), |piece| {
            let _ = app.emit("token", Token { piece: piece.to_string() });
            std::ops::ControlFlow::Continue(())
        });
        if let Err(EngineError::WorkerLost(_)) = &result {
            // The model is unusable once a worker is gone; release it so it can be reloaded.
            drop(host);
            app.state::<EngineState>().host.lock().unwrap().take();
        }
        result.map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub fn host_cancel(state: State<'_, EngineState>) {
    if let Some(host) = state.host.lock().unwrap().as_ref() {
        host.cancel();
    }
}

#[tauri::command]
pub async fn host_unload(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        app.state::<EngineState>().host.lock().unwrap().take();
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn device_shares(state: State<'_, EngineState>) -> Vec<DeviceShare> {
    state.host.lock().unwrap().as_ref().map(|h| h.device_shares()).unwrap_or_default()
}
