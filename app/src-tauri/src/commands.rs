//! Tauri commands: the UI's only way into the engine. Long-running engine calls
//! run on the blocking thread pool so the UI stays responsive.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use dl_engine::{ChatMessage, DeviceShare, EngineError, GenParams, GenSummary, Host, Worker, WorkerConfig};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::device_info::{device_info as read_device_info, DeviceInfo};
use crate::discovery::{self, registry, Discovery, PeerView};
use crate::chat::ChatSession;
use crate::models::{self, download, ModelEntry, ModelState};
use crate::roles::{self, RoleState, Roles};

/// Engine objects owned by the app. One worker and one host per process (engine rule),
/// and one role at a time (`roles.rs`).
#[derive(Default)]
pub struct EngineState {
    worker: Mutex<Option<Worker>>,
    /// `Arc` so a long generation doesn't hold the lock (cancel must get through).
    host: Mutex<Option<Arc<Host>>>,
    roles: Mutex<Roles>,
    chat: Mutex<ChatSession>,
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
struct PeersChanged {
    peers: Vec<PeerView>,
}

/// Peers whose heartbeat just arrived (every few seconds while they're on the network).
#[derive(Clone, Serialize)]
struct PeersHeard {
    ids: Vec<String>,
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

/// What this build is, for the About sheet.
#[derive(Clone, Serialize)]
pub struct About {
    app_ver: String,
    llama_cpp_tag: String,
    llama_cpp_commit: String,
    rpc_proto: String,
}

#[tauri::command]
pub fn about() -> About {
    let (tag, commit) = dl_engine::llama_cpp_pin();
    About {
        app_ver: env!("CARGO_PKG_VERSION").into(),
        llama_cpp_tag: tag.into(),
        llama_cpp_commit: commit.into(),
        rpc_proto: dl_engine::rpc_proto_version(),
    }
}

/// The current role and what goes with it.
#[tauri::command]
pub fn role_state(state: State<'_, EngineState>) -> RoleState {
    state.roles.lock().unwrap().state().clone()
}

/// Run a role change, then tell the UI (`role-changed`) and the network (re-announce).
fn change_role<T>(app: &AppHandle, f: impl FnOnce(&mut Roles) -> T) -> T {
    let state = app.state::<EngineState>();
    let mut roles = state.roles.lock().unwrap();
    let out = f(&mut roles);
    let _ = app.emit("role-changed", roles.state().clone());
    drop(roles);
    app.state::<Discovery>().announce_now();
    out
}

/// Become a worker on `port` (default 50052); the next announcement says so.
/// `leave_role` stops it again.
#[tauri::command]
pub async fn become_worker(app: AppHandle, port: Option<u16>) -> Result<RoleState, String> {
    let port = port.unwrap_or(registry::DEFAULT_RPC_PORT);
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("rpc");
    blocking(move || {
        let state = app.state::<EngineState>();
        // Held throughout, so a concurrent become_host can't slip in.
        let mut roles = state.roles.lock().unwrap();
        roles.can_become_worker()?;
        let mut worker = state.worker.lock().unwrap();
        if worker.is_none() {
            let w = Worker::start(WorkerConfig { bind_host: "0.0.0.0".into(), port, cache_dir: Some(cache_dir), threads: None })
                .map_err(|e| e.to_string())?;
            roles.set_worker(w.status());
            *worker = Some(w);
            index_local_models(&app);
        }
        let now = roles.state().clone();
        drop((worker, roles));
        let _ = app.emit("role-changed", now.clone());
        app.state::<Discovery>().announce_now();
        update_keep_awake(&app);
        Ok(now)
    })
    .await
}

/// Load `model_id` split across this device and the chosen peers (by id; none = alone).
/// Refused before any connection if a peer is incompatible or the devices together
/// don't have the memory the model needs.
#[tauri::command]
pub async fn become_host(app: AppHandle, model_id: String, peer_ids: Vec<String>) -> Result<Vec<DeviceShare>, String> {
    let model = models::catalog().iter().find(|m| m.id == model_id).ok_or_else(|| format!("unknown model: {model_id}"))?;
    let path = models::model_path(&models_dir(&app)?, &model_id)?;
    let local = read_device_info();
    let known = app.state::<Discovery>().peers();
    let mut chosen = Vec::new();
    for id in &peer_ids {
        chosen.push(known.iter().find(|p| &p.id == id).cloned().ok_or_else(|| format!("device no longer available: {id}"))?);
    }
    discovery::check_workers(&chosen)?;
    let endpoints: Vec<String> = chosen.iter().map(|p| SocketAddr::new(p.addr, p.rpc_port).to_string()).collect();
    discovery::check_endpoints(&endpoints, &chosen, &local)?;
    let peers_free: Vec<Option<u64>> = chosen.iter().map(|p| p.free_mem_mb).collect();
    roles::memory_guard(model.min_free_mb, local.free_mem_mb, &peers_free)?;

    change_role(&app, |r| r.begin_loading(&model_id))?;
    blocking(move || {
        let state = app.state::<EngineState>();
        // One model at a time: stop and unload the previous one first.
        if let Some(old) = state.host.lock().unwrap().take() {
            old.cancel();
        }
        let progress_app = app.clone();
        let loaded = Host::load(&path, &endpoints, None, move |frac| {
            let state = progress_app.state::<EngineState>();
            let mut roles = state.roles.lock().unwrap();
            if roles.set_progress(frac) {
                let _ = progress_app.emit("role-changed", roles.state().clone());
            }
        });
        match loaded {
            Ok(host) => {
                let shares = host.device_shares();
                let load = host.load_report();
                *state.host.lock().unwrap() = Some(Arc::new(host));
                state.chat.lock().unwrap().model_loaded(&model_id);
                change_role(&app, |r| r.finish_loading(Ok((shares.clone(), load))));
                update_keep_awake(&app);
                Ok(shares)
            }
            Err(e) => {
                change_role(&app, |r| r.finish_loading(Err(())));
                update_keep_awake(&app);
                Err(e.to_string())
            }
        }
    })
    .await
}

/// Back to Idle: unload the model, or stop the worker (ending any host's session on it).
#[tauri::command]
pub async fn leave_role(app: AppHandle) -> Result<RoleState, String> {
    blocking(move || {
        let state = app.state::<EngineState>();
        if matches!(state.roles.lock().unwrap().state(), RoleState::Worker { .. }) {
            let mut worker = state.worker.lock().unwrap();
            if let Some(w) = worker.as_ref() {
                w.stop().map_err(|e| e.to_string())?;
            }
            *worker = None;
        }
        change_role(&app, |r| r.leave())?;
        if let Some(host) = app.state::<EngineState>().host.lock().unwrap().take() {
            host.cancel();
        }
        update_keep_awake(&app);
        Ok(app.state::<EngineState>().roles.lock().unwrap().state().clone())
    })
    .await
}

/// Hosts using this device as a worker right now (0 if it isn't one). Leaving the worker
/// role ends their session, so the UI asks first when this is above 0.
#[tauri::command]
pub fn worker_hosts(app: AppHandle) -> usize {
    app.state::<EngineState>().worker.lock().unwrap().as_ref().map_or(0, |w| w.clients())
}

/// Send a message in the current conversation. The answer streams as `token` events,
/// reasoning included (inside `<think>…</think>`) when `think` is on.
#[tauri::command]
pub async fn chat_send(app: AppHandle, text: String, think: bool) -> Result<GenSummary, String> {
    let state = app.state::<EngineState>();
    let host = state.host.lock().unwrap().clone().ok_or("no model loaded")?;
    let messages = state.chat.lock().unwrap().begin_turn(&text)?;
    blocking(move || {
        let mut answer = String::new();
        let result = host.generate(&messages, GenParams { think, ..GenParams::default() }, |piece| {
            answer.push_str(piece);
            let _ = app.emit("token", Token { piece: piece.to_string() });
            std::ops::ControlFlow::Continue(())
        });
        let state = app.state::<EngineState>();
        match &result {
            Ok(_) => state.chat.lock().unwrap().end_turn(&answer),
            Err(e) => {
                state.chat.lock().unwrap().fail_turn();
                if let EngineError::WorkerLost(_) = e {
                    // The model is unusable once a worker is gone; release it so it can be
                    // reloaded. The conversation is kept for when the same model returns.
                    drop(host);
                    state.host.lock().unwrap().take();
                    change_role(&app, |r| r.host_lost());
                    update_keep_awake(&app);
                }
            }
        }
        result.map_err(|e| e.to_string())
    })
    .await
}

/// Stop the answer being written (it is kept as far as it got).
#[tauri::command]
pub fn chat_stop(state: State<'_, EngineState>) {
    if let Some(host) = state.host.lock().unwrap().as_ref() {
        host.cancel();
    }
}

#[tauri::command]
pub fn chat_history(state: State<'_, EngineState>) -> Vec<ChatMessage> {
    state.chat.lock().unwrap().history().to_vec()
}

/// Start a new conversation with the same model.
#[tauri::command]
pub fn chat_reset(state: State<'_, EngineState>) -> Result<(), String> {
    state.chat.lock().unwrap().reset()
}

/// Let this worker serve weights from the models this device has downloaded, so a host
/// loading one of them sends only hashes (see `Worker::add_model`). Runs in the background:
/// the worker is usable meanwhile, and a model already indexed is skipped at once.
/// `DL_WORKER_NO_MODEL_FILES=1` turns this off, to measure a load that sends everything.
fn index_local_models(app: &AppHandle) {
    if std::env::var_os("DL_WORKER_NO_MODEL_FILES").is_some() {
        eprintln!("worker: not serving from its own model files (DL_WORKER_NO_MODEL_FILES)");
        return;
    }
    let (Ok(dir), Ok(cache)) = (models_dir(app), app.path().app_cache_dir()) else { return };
    let index_dir = cache.join("model-index");
    std::thread::spawn(move || {
        for m in models::catalog() {
            if let ModelState::Ready { path } = models::model_state(&dir, m) {
                let started = Instant::now();
                match Worker::add_model(&path, &index_dir) {
                    Ok(n) => eprintln!("worker: {} ready to serve from its own file ({n} tensors, {} ms)", m.id, started.elapsed().as_millis()),
                    Err(e) => eprintln!("worker: {} not indexed: {e}", m.id),
                }
            }
        }
    });
}

/// Keep the screen on while this device is a worker or has a model loaded: a locked
/// phone suspends the app and drops its connections. Desktop: nothing to do.
/// Never call it on the main thread (the mobile plugin calls wait for the main thread).
fn update_keep_awake(app: &AppHandle) {
    let state = app.state::<EngineState>();
    let busy = state.worker.lock().unwrap().is_some() || state.host.lock().unwrap().is_some();
    #[cfg(target_os = "ios")]
    discovery::bonjour::set_keep_awake(app, busy);
    #[cfg(target_os = "android")]
    {
        use tauri_plugin_multicast_android::MulticastExt;
        if let Err(e) = app.multicast().call::<serde_json::Value>("setKeepAwake", serde_json::json!({ "enabled": busy })) {
            eprintln!("keep-awake failed: {e}");
        }
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let _ = busy;
}

// ---- Discovery ---------------------------------------------------------------

/// What this device announces, read fresh on each heartbeat (role, free memory).
fn announcement(app: &AppHandle) -> discovery::PeerInfo {
    let (role, port) = app.state::<EngineState>().roles.lock().unwrap().announced();
    app.state::<Discovery>().me(&read_device_info(), role, port.unwrap_or(registry::DEFAULT_RPC_PORT))
}

fn emit_peers(app: &AppHandle, peers: Vec<discovery::PeerInfo>) {
    let peers = discovery::views(app.state::<Discovery>().without_self(peers), &read_device_info());
    let _ = app.emit("peers-changed", PeersChanged { peers });
}

/// Start looking for other devices and announcing this one, whatever its role (once).
/// Emits `peers-changed` whenever the list changes, and `peers-heard` as heartbeats arrive.
/// Async: on iOS the plugin call needs the main thread free.
#[tauri::command]
pub async fn discovery_start(app: AppHandle) -> Result<Vec<PeerView>, String> {
    blocking(move || {
        let discovery = app.state::<Discovery>();
        // Android drops incoming multicast (mDNS) unless the app holds a multicast lock.
        // Discovery runs for the app's whole life, so the lock is held from here on.
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_multicast_android::MulticastExt;
            app.multicast().call::<serde_json::Value>("setMulticast", serde_json::json!({ "enabled": true }))?;
        }
        let backend = discovery.backend(&app)?;
        let emitter = app.clone();
        backend.browse(move |peers, heard| {
            if let Some(peers) = peers {
                emit_peers(&emitter, peers);
            }
            let self_id = &emitter.state::<Discovery>().self_id;
            let ids: Vec<String> = heard.into_iter().filter(|id| id != self_id).collect();
            if !ids.is_empty() {
                let _ = emitter.emit("peers-heard", PeersHeard { ids });
            }
        })?;
        if discovery.start_announcing() {
            let me = app.clone();
            backend.advertise(move || announcement(&me))?;
        }
        Ok(discovery::views(discovery.peers(), &read_device_info()))
    })
    .await
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
        let peer = registry::probe_manual_peer(&addr)?;
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
        if app.state::<EngineState>().worker.lock().unwrap().is_some() {
            index_local_models(&app);
        }
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
