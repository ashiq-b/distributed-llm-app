//! Finding other devices on the network: announced ones (mDNS; the system's Bonjour on
//! iOS) and ones typed in by hand. Loading checks them before connecting.

#[cfg(target_os = "ios")]
pub mod bonjour;
#[cfg(not(target_os = "ios"))]
pub mod mdns;
pub mod registry;
pub mod txt;

use std::hash::{BuildHasher, RandomState};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::AppHandle;

pub use txt::{compatibility, Compat, DeviceRole, PeerInfo, PeerSource};

use crate::device_info::DeviceInfo;
use registry::PeerRegistry;

#[cfg(not(target_os = "ios"))]
pub type Backend = mdns::Mdns;
#[cfg(target_os = "ios")]
pub type Backend = bonjour::Bonjour;

/// A peer as the UI sees it: what it announced, plus whether it can work with us.
#[derive(Debug, Clone, Serialize)]
pub struct PeerView {
    #[serde(flatten)]
    pub peer: PeerInfo,
    pub compat: Compat,
}

/// Discovery for this app instance. Created at startup; the backend starts on first use.
pub struct Discovery {
    /// This install's id, as announced. Used to leave ourselves out of the list.
    pub self_id: String,
    registry: Arc<Mutex<PeerRegistry>>,
    backend: Mutex<Option<Arc<Backend>>>,
}

impl Discovery {
    pub fn new(self_id: String) -> Discovery {
        Discovery { self_id, registry: Arc::default(), backend: Mutex::new(None) }
    }

    pub fn backend(&self, app: &AppHandle) -> Result<Arc<Backend>, String> {
        let mut backend = self.backend.lock().unwrap();
        if let Some(b) = backend.as_ref() {
            return Ok(b.clone());
        }
        #[cfg(target_os = "ios")]
        let b = Arc::new(Backend::new(app.clone(), self.registry.clone())?);
        #[cfg(not(target_os = "ios"))]
        let b = {
            let _ = app;
            Arc::new(Backend::new(self.registry.clone())?)
        };
        *backend = Some(b.clone());
        Ok(b)
    }

    /// Other devices (never this one), sorted by name.
    pub fn peers(&self) -> Vec<PeerInfo> {
        let peers = self.registry.lock().unwrap().list();
        self.without_self(peers)
    }

    pub fn without_self(&self, peers: Vec<PeerInfo>) -> Vec<PeerInfo> {
        peers.into_iter().filter(|p| p.id != self.self_id).collect()
    }

    pub fn add(&self, peer: PeerInfo) {
        self.registry.lock().unwrap().upsert(None, peer);
    }

    /// What this device announces about itself.
    pub fn me(&self, local: &DeviceInfo, role: DeviceRole, rpc_port: u16) -> PeerInfo {
        PeerInfo {
            id: self.self_id.clone(),
            name: local.name.clone(),
            platform: Some(local.platform.clone()),
            app_ver: Some(local.app_ver.clone()),
            proto: Some(local.proto.clone()),
            rpc_port,
            free_mem_mb: local.free_mem_mb,
            role: Some(role),
            // Not announced: receivers use the address the announcement came from.
            addr: IpAddr::V4(Ipv4Addr::UNSPECIFIED),
            source: PeerSource::Mdns,
            last_seen: Instant::now(),
        }
    }
}

pub fn views(peers: Vec<PeerInfo>, local: &DeviceInfo) -> Vec<PeerView> {
    peers.into_iter().map(|peer| PeerView { compat: compatibility(&peer, local), peer }).collect()
}

/// This install's id: random on first run, then kept in `dir/device_id`.
pub fn load_or_create_id(dir: &Path) -> std::io::Result<String> {
    let path = dir.join("device_id");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim();
        if !id.is_empty() {
            return Ok(id.to_string());
        }
    }
    // std's RandomState is seeded from the OS's random source.
    let id = format!("{:016x}{:016x}", RandomState::new().hash_one(0u8), RandomState::new().hash_one(1u8));
    std::fs::create_dir_all(dir)?;
    std::fs::write(&path, &id)?;
    Ok(id)
}

/// Refuse to load with any endpoint that belongs to a known, incompatible peer.
/// Runs before any connection is made. Endpoints no peer announced (typed in by hand)
/// can't be checked here; llama.cpp's own RPC handshake still rejects a protocol mismatch.
pub fn check_endpoints(endpoints: &[String], peers: &[PeerInfo], local: &DeviceInfo) -> Result<(), String> {
    for endpoint in endpoints {
        let Ok(sock) = endpoint.parse::<SocketAddr>() else { continue };
        let known = peers.iter().find(|p| p.addr == sock.ip() && p.rpc_port == sock.port());
        if let Some(peer) = known.filter(|p| compatibility(p, local).is_incompatible()) {
            return Err(format!("incompatible version: {}", peer.name));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local() -> DeviceInfo {
        DeviceInfo { name: "this".into(), platform: "macos".into(), free_mem_mb: Some(8000), app_ver: "0.1.0".into(), proto: "10.0.0".into() }
    }

    fn peer(name: &str, ip: &str, proto: &str) -> PeerInfo {
        PeerInfo {
            id: name.into(),
            name: name.into(),
            platform: Some("ios".into()),
            app_ver: Some("0.1.0".into()),
            proto: Some(proto.into()),
            rpc_port: 50052,
            free_mem_mb: Some(3901),
            role: Some(DeviceRole::Worker),
            addr: ip.parse().unwrap(),
            source: PeerSource::Mdns,
            last_seen: Instant::now(),
        }
    }

    #[test]
    fn host_load_refuses_incompatible_peer() {
        let peers = [peer("Good phone", "192.168.1.4", "10.0.0"), peer("Old phone", "192.168.1.5", "9.0.0")];

        assert_eq!(check_endpoints(&["192.168.1.4:50052".into()], &peers, &local()), Ok(()));
        assert_eq!(
            check_endpoints(&["192.168.1.4:50052".into(), "192.168.1.5:50052".into()], &peers, &local()),
            Err("incompatible version: Old phone".into())
        );
        // Same IP but a different port is not that peer.
        assert_eq!(check_endpoints(&["192.168.1.5:6000".into()], &peers, &local()), Ok(()));
        // Endpoints no peer announced (manual entry) are not blocked here.
        assert_eq!(check_endpoints(&["192.168.1.9:50052".into(), "my-mac.local:50052".into()], &peers, &local()), Ok(()));
    }

    #[test]
    fn device_id_is_random_then_stable() {
        let dir = std::env::temp_dir().join(format!("distllm-id-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let id = load_or_create_id(&dir).unwrap();
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(load_or_create_id(&dir).unwrap(), id);
        std::fs::remove_dir_all(&dir).unwrap();
        assert_ne!(load_or_create_id(&dir).unwrap(), id, "a fresh install gets a new id");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn own_advert_is_left_out() {
        let d = Discovery::new("me".into());
        d.add(peer("me", "192.168.1.2", "10.0.0"));
        d.add(peer("other", "192.168.1.4", "10.0.0"));
        assert_eq!(d.peers().iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["other"]);
    }
}
