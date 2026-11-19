//! Tauri commands: the UI's only way into the engine. Long-running engine calls
//! run on the blocking thread pool so the UI stays responsive.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dl_engine::{ChatMessage, DeviceShare, EngineError, GenParams, GenSummary, Host, Worker, WorkerConfig, WorkerStatus};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::device_info::{device_info as read_device_info, DeviceInfo};
use crate::discovery::{self, mdns, DeviceRole, Discovery, PeerView};
use crate::models::{self, download, ModelEntry, ModelState};

/// Engine objects owned by the app. One worker and one host per process (engine rule).
#[derive(Default)]
pub struct EngineState {
    worker: Mutex<Option<Worker>>,
    /// `Arc` so a long generation doesn't hold the lock (cancel must get through).
    host: Mutex<Option<Arc<Host>>>,
}

/// In-flight downloads, by model id, with their cancel flags.
#[derive(Default)]
pub struct DownloadState {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Clone, Serialize)]
pub struct ModelView {
    #[serde(flatten)]
    entry: ModelEntry,
    status: ModelState,
    downloading: bool,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    id: String,
    bytes: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
struct LoadProgress {
    frac: f32,
}

#[derive(Clone, Serialize)]
struct PeersChanged {
    peers: Vec<PeerView>,
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
        // Announce ourselves as a worker. Discovery failing must not stop the worker:
        // others can still add this device by address.
        let discovery = app.state::<Discovery>();
        let announced = discovery.mdns().and_then(|m| {
            let me = discovery.me(&read_device_info(), DeviceRole::Worker, port);
            m.advertise(move || discovery_me_now(&me))
        });
        if let Err(e) = announced {
            eprintln!("worker is not announced on the network: {e}");
        }
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
    discovery::check_endpoints(&endpoints, &app.state::<Discovery>().peers(), &read_device_info())?;
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

// ---- Discovery ---------------------------------------------------------------

/// Refresh the announced values that change (free memory) on each heartbeat.
fn discovery_me_now(me: &discovery::PeerInfo) -> discovery::PeerInfo {
    discovery::PeerInfo { free_mem_mb: read_device_info().free_mem_mb, ..me.clone() }
}

fn emit_peers(app: &AppHandle, peers: Vec<discovery::PeerInfo>) {
    let peers = discovery::views(app.state::<Discovery>().without_self(peers), &read_device_info());
    let _ = app.emit("peers-changed", PeersChanged { peers });
}

/// Start looking for other devices (once). Emits `peers-changed` whenever the list changes.
#[tauri::command]
pub fn discovery_start(app: AppHandle) -> Result<Vec<PeerView>, String> {
    let discovery = app.state::<Discovery>();
    let emitter = app.clone();
    discovery.mdns()?.browse(move |peers| emit_peers(&emitter, peers))?;
    Ok(discovery::views(discovery.peers(), &read_device_info()))
}

#[tauri::command]
pub fn discovery_peers(app: AppHandle) -> Vec<PeerView> {
    discovery::views(app.state::<Discovery>().peers(), &read_device_info())
}

/// Add a device by address ("192.168.1.4" or "192.168.1.4:50052") after checking it
/// accepts connections (within 5 s).
#[tauri::command]
pub async fn add_manual_peer(app: AppHandle, addr: String) -> Result<PeerView, String> {
    blocking(move || {
        let peer = mdns::probe_manual_peer(&addr)?;
        let discovery = app.state::<Discovery>();
        discovery.add(peer.clone());
        emit_peers(&app, discovery.peers());
        Ok(discovery::views(vec![peer], &read_device_info()).remove(0))
    })
    .await
}

// ---- Models ----------------------------------------------------------------

fn entry(id: &str) -> Result<&'static ModelEntry, String> {
    models::catalog().iter().find(|m| m.id == id).ok_or_else(|| format!("unknown model: {id}"))
}

#[tauri::command]
pub fn catalog(app: AppHandle, downloads: State<'_, DownloadState>) -> Result<Vec<ModelView>, String> {
    let dir = models_dir(&app)?;
    let active = downloads.active.lock().unwrap();
    Ok(models::catalog()
        .iter()
        .map(|m| ModelView { entry: m.clone(), status: models::model_state(&dir, m), downloading: active.contains_key(&m.id) })
        .collect())
}

#[tauri::command]
pub fn model_state(app: AppHandle, id: String) -> Result<ModelState, String> {
    Ok(models::model_state(&models_dir(&app)?, entry(&id)?))
}

/// Download (or resume) a catalog model. Emits `download-progress` about every 250 ms.
#[tauri::command]
pub async fn model_download(app: AppHandle, id: String) -> Result<ModelState, String> {
    let m = entry(&id)?;
    let dest = models_dir(&app)?.join(&m.file);
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<DownloadState>();
        let mut active = state.active.lock().unwrap();
        if active.contains_key(&id) {
            return Err(format!("{} is already downloading", m.name));
        }
        active.insert(id.clone(), cancel.clone());
    }
    blocking(move || {
        let mut last = Instant::now() - Duration::from_secs(1);
        let result = download::download_file(&m.url, &dest, &m.sha256, &cancel, &mut |bytes, total| {
            if last.elapsed() >= Duration::from_millis(250) || (total > 0 && bytes == total) {
                last = Instant::now();
                let _ = app.emit("download-progress", DownloadProgress { id: m.id.clone(), bytes, total });
            }
        });
        app.state::<DownloadState>().active.lock().unwrap().remove(&m.id);
        result.map_err(|e| e.to_string())?;
        Ok(download::file_state(&dest))
    })
    .await
}

#[tauri::command]
pub fn model_cancel_download(downloads: State<'_, DownloadState>, id: String) {
    if let Some(flag) = downloads.active.lock().unwrap().get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Delete a model's file and any partial download.
#[tauri::command]
pub fn model_delete(app: AppHandle, downloads: State<'_, DownloadState>, id: String) -> Result<ModelState, String> {
    let m = entry(&id)?;
    if downloads.active.lock().unwrap().contains_key(&id) {
        return Err(format!("{} is downloading; cancel it first", m.name));
    }
    let dest = models_dir(&app)?.join(&m.file);
    for path in [dest.clone(), download::part_path(&dest)] {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("cannot delete {}: {e}", path.display()))?;
        }
    }
    Ok(download::file_state(&dest))
}
