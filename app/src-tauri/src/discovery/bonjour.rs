//! iOS discovery through the system's Bonjour (NetService), via the `bonjour-ios` plugin.
//! iOS doesn't let apps send raw multicast without a special Apple entitlement, so the
//! mdns-sd backend can't run here. Behaviour matches `mdns.rs`: adverts re-announce
//! every `HEARTBEAT` with a `seq` counter, and the shared registry drops silent peers.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_bonjour_ios::BonjourExt;

use super::registry::{apply_snapshot, BrowsedService, PeerRegistry, HEARTBEAT};
use super::txt::{encode_txt, PeerInfo};

/// How often the browser's current list is read from the plugin.
const POLL: Duration = Duration::from_secs(1);

#[derive(Deserialize)]
struct Snapshot {
    services: Vec<BrowsedService>,
}

pub struct Bonjour {
    app: AppHandle,
    registry: Arc<Mutex<PeerRegistry>>,
    browsing: AtomicBool,
    advertising: Mutex<Option<Arc<AtomicBool>>>,
    /// Set to send the next announcement now instead of at the next heartbeat.
    announce_now: Arc<AtomicBool>,
}

impl Bonjour {
    pub fn new(app: AppHandle, registry: Arc<Mutex<PeerRegistry>>) -> Result<Bonjour, String> {
        Ok(Bonjour { app, registry, browsing: AtomicBool::new(false), advertising: Mutex::new(None), announce_now: Arc::default() })
    }

    /// Start browsing (once). `on_event` gets the full list when it changed, and the ids
    /// of peers whose heartbeat just arrived.
    pub fn browse(&self, on_event: impl Fn(Option<Vec<PeerInfo>>, Vec<String>) + Send + 'static) -> Result<(), String> {
        if self.browsing.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        if let Err(e) = self.app.bonjour().call::<Value>("startBrowsing", json!({})) {
            self.browsing.store(false, Ordering::SeqCst);
            return Err(format!("Bonjour browse failed: {e}"));
        }
        let (app, registry) = (self.app.clone(), self.registry.clone());
        std::thread::Builder::new()
            .name("bonjour-browse".into())
            .spawn(move || {
                let mut last_txt = HashMap::new();
                loop {
                    let snapshot = app.bonjour().call::<Snapshot>("snapshot", json!({}));
                    let mut reg = registry.lock().unwrap();
                    let now = Instant::now();
                    let mut changed = match snapshot {
                        Ok(s) => apply_snapshot(&mut reg, &mut last_txt, &s.services, now),
                        Err(e) => {
                            eprintln!("Bonjour snapshot failed: {e}");
                            false
                        }
                    };
                    changed |= reg.expire(now);
                    let heard = reg.heard_since(now);
                    if changed || !heard.is_empty() {
                        let peers = changed.then(|| reg.list());
                        drop(reg);
                        on_event(peers, heard);
                    } else {
                        drop(reg);
                    }
                    std::thread::sleep(POLL);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Send the announcement now (e.g. the role changed) rather than at the next heartbeat.
    pub fn announce_now(&self) {
        self.announce_now.store(true, Ordering::SeqCst);
    }

    /// Announce this device now and every `HEARTBEAT`. Replaces any earlier advert.
    pub fn advertise(&self, me: impl Fn() -> PeerInfo + Send + 'static) -> Result<(), String> {
        let stop = Arc::new(AtomicBool::new(false));
        let now = self.announce_now.clone();
        if let Some(previous) = self.advertising.lock().unwrap().replace(stop.clone()) {
            previous.store(true, Ordering::SeqCst);
        }
        let app = self.app.clone();
        std::thread::Builder::new()
            .name("bonjour-advertise".into())
            .spawn(move || {
                for seq in 0u64.. {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let peer = me();
                    let mut txt: HashMap<String, String> = encode_txt(&peer).into_iter().collect();
                    txt.insert("seq".into(), seq.to_string());
                    let args = json!({ "name": peer.id, "port": peer.rpc_port, "txt": txt });
                    if let Err(e) = app.bonjour().call::<Value>("publish", args) {
                        eprintln!("Bonjour announce failed: {e}");
                    }
                    let next = Instant::now() + HEARTBEAT;
                    while Instant::now() < next && !stop.load(Ordering::SeqCst) && !now.swap(false, Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(200));
                    }
                }
                let _ = app.bonjour().call::<Value>("unpublish", json!({}));
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl Bonjour {
    /// Nothing to do at app exit on iOS: the plugin call would wait for the main thread,
    /// which is the one exiting, and iOS ends a closed app's Bonjour adverts itself.
    pub fn stop_advertising(&self) {
        if let Some(stop) = self.advertising.lock().unwrap().take() {
            stop.store(true, Ordering::SeqCst);
        }
    }
}

/// Keep the screen on (the OS suspends networking when an iPhone locks).
pub fn set_keep_awake(app: &AppHandle, enabled: bool) {
    if let Err(e) = app.bonjour().call::<Value>("setKeepAwake", json!({ "enabled": enabled })) {
        eprintln!("keep-awake failed: {e}");
    }
}
