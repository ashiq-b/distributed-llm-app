//! mDNS advertise and browse (`_distllm._tcp`), used on macOS (and later Android,
//! Windows, Linux). iOS uses the Bonjour plugin instead (Task 3.3).
//!
//! mDNS caches are made for long-lived services and only report a service again when
//! its records change, so a device that vanishes without saying goodbye (Wi‑Fi off,
//! sleep) would stay listed for a long time. To keep the list honest, an advertising
//! device re-announces every `HEARTBEAT` with a `seq` counter in its TXT record, and
//! a peer is dropped `PEER_TTL` after its last announcement.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mdns_sd::{RecvTimeoutError, ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};

use super::txt::{decode_txt, encode_txt, PeerInfo, PeerSource};

pub const SERVICE_TYPE: &str = "_distllm._tcp.local.";
pub const DEFAULT_RPC_PORT: u16 = 50052;
pub const HEARTBEAT: Duration = Duration::from_secs(5);
pub const PEER_TTL: Duration = Duration::from_secs(15);
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Known peers, by id. The clock is passed in so expiry can be tested.
#[derive(Default)]
pub struct PeerRegistry {
    peers: HashMap<String, PeerInfo>,
    /// mDNS instance fullname → peer id, for goodbye ("removed") events.
    fullnames: HashMap<String, String>,
}

impl PeerRegistry {
    /// Add or refresh a peer. Returns true if the visible list changed.
    pub fn upsert(&mut self, fullname: Option<&str>, peer: PeerInfo) -> bool {
        if let Some(fullname) = fullname {
            self.fullnames.insert(fullname.to_string(), peer.id.clone());
        }
        let changed = match self.peers.get(&peer.id) {
            Some(old) => PeerInfo { last_seen: old.last_seen, ..peer.clone() } != *old,
            None => true,
        };
        self.peers.insert(peer.id.clone(), peer);
        changed
    }

    /// The peer said goodbye. Returns true if it was listed.
    pub fn remove_fullname(&mut self, fullname: &str) -> bool {
        self.fullnames.remove(fullname).is_some_and(|id| self.peers.remove(&id).is_some())
    }

    /// Drop announced peers not heard from within `PEER_TTL`. Manual peers stay.
    pub fn expire(&mut self, now: Instant) -> bool {
        let before = self.peers.len();
        self.peers.retain(|_, p| p.source == PeerSource::Manual || now.saturating_duration_since(p.last_seen) <= PEER_TTL);
        let peers = &self.peers;
        self.fullnames.retain(|_, id| peers.contains_key(id));
        self.peers.len() != before
    }

    /// All peers, sorted by name.
    pub fn list(&self) -> Vec<PeerInfo> {
        let mut peers: Vec<PeerInfo> = self.peers.values().cloned().collect();
        peers.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.id.cmp(&b.id)));
        peers
    }
}

/// Check that something accepts TCP at `addr` ("192.168.1.4" or "192.168.1.4:50052")
/// within `PROBE_TIMEOUT`, and describe it as a manual peer. Only the address and
/// port are known; everything else stays `None`.
pub fn probe_manual_peer(addr: &str) -> Result<PeerInfo, String> {
    let addr = addr.trim();
    let sock = addr
        .parse::<SocketAddr>()
        .or_else(|_| addr.parse::<IpAddr>().map(|ip| SocketAddr::new(ip, DEFAULT_RPC_PORT)))
        .map_err(|_| format!("not an IP address: {addr:?} (expected e.g. 192.168.1.4 or 192.168.1.4:50052)"))?;
    TcpStream::connect_timeout(&sock, PROBE_TIMEOUT).map_err(|e| format!("cannot reach {sock}: {e}"))?;
    Ok(PeerInfo {
        id: format!("manual:{sock}"),
        name: sock.to_string(),
        platform: None,
        app_ver: None,
        proto: None,
        rpc_port: sock.port(),
        free_mem_mb: None,
        role: None,
        addr: sock.ip(),
        source: PeerSource::Manual,
        last_seen: Instant::now(),
    })
}

/// A resolved announcement → peer. Prefers an IPv4 LAN address (what RPC connects to).
fn peer_from(svc: &ResolvedService) -> Option<PeerInfo> {
    let txt: Vec<(String, String)> =
        svc.txt_properties.iter().map(|p| (p.key().to_string(), p.val_str().to_string())).collect();
    let addrs: Vec<IpAddr> = svc.addresses.iter().map(|a| a.to_ip_addr()).collect();
    let addr = addrs
        .iter()
        .find(|a| a.is_ipv4() && !a.is_loopback())
        .or_else(|| addrs.iter().find(|a| a.is_ipv4()))
        .or_else(|| addrs.first())?;
    decode_txt(&txt, *addr).ok()
}

/// Advertising and browsing on one mDNS daemon.
pub struct Mdns {
    daemon: ServiceDaemon,
    registry: Arc<Mutex<PeerRegistry>>,
    browsing: AtomicBool,
    advertising: Mutex<Option<Arc<AtomicBool>>>,
}

impl Mdns {
    /// `registry` is shared so manual peers live in the same list.
    pub fn new(registry: Arc<Mutex<PeerRegistry>>) -> Result<Mdns, String> {
        Ok(Mdns {
            daemon: ServiceDaemon::new().map_err(|e| format!("mDNS unavailable: {e}"))?,
            registry,
            browsing: AtomicBool::new(false),
            advertising: Mutex::new(None),
        })
    }

    /// Start browsing (once). `on_change` gets the full list whenever it changes.
    pub fn browse(&self, on_change: impl Fn(Vec<PeerInfo>) + Send + 'static) -> Result<(), String> {
        if self.browsing.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let events = self.daemon.browse(SERVICE_TYPE).map_err(|e| {
            self.browsing.store(false, Ordering::SeqCst);
            format!("mDNS browse failed: {e}")
        })?;
        let registry = self.registry.clone();
        std::thread::Builder::new()
            .name("mdns-browse".into())
            .spawn(move || loop {
                let event = events.recv_timeout(Duration::from_secs(1));
                let mut reg = registry.lock().unwrap();
                let mut changed = match event {
                    Ok(ServiceEvent::ServiceResolved(svc)) => {
                        peer_from(&svc).is_some_and(|peer| reg.upsert(Some(&svc.fullname), peer))
                    }
                    Ok(ServiceEvent::ServiceRemoved(_, fullname)) => reg.remove_fullname(&fullname),
                    Ok(_) | Err(RecvTimeoutError::Timeout) => false,
                    Err(RecvTimeoutError::Disconnected) => break,
                };
                changed |= reg.expire(Instant::now());
                if changed {
                    let peers = reg.list();
                    drop(reg);
                    on_change(peers);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Announce this device now and every `HEARTBEAT`. `me` is called each time, so the
    /// record carries current values (free memory, role). Replaces any earlier advert.
    pub fn advertise(&self, me: impl Fn() -> PeerInfo + Send + 'static) -> Result<(), String> {
        let stop = Arc::new(AtomicBool::new(false));
        if let Some(previous) = self.advertising.lock().unwrap().replace(stop.clone()) {
            previous.store(true, Ordering::SeqCst);
        }
        let daemon = self.daemon.clone();
        std::thread::Builder::new()
            .name("mdns-advertise".into())
            .spawn(move || {
                let mut fullname = None;
                for seq in 0u64.. {
                    if stop.load(Ordering::SeqCst) {
                        break;
                    }
                    let peer = me();
                    let mut txt = encode_txt(&peer);
                    txt.push(("seq".into(), seq.to_string()));
                    // The id doubles as the instance and host name: unique, and plain ASCII.
                    match ServiceInfo::new(SERVICE_TYPE, &peer.id, &format!("{}.local.", peer.id), (), peer.rpc_port, &txt[..]) {
                        Ok(info) => {
                            fullname = Some(info.get_fullname().to_string());
                            if let Err(e) = daemon.register(info.enable_addr_auto()) {
                                eprintln!("mDNS announce failed: {e}");
                            }
                        }
                        Err(e) => eprintln!("mDNS record invalid: {e}"),
                    }
                    let next = Instant::now() + HEARTBEAT;
                    while Instant::now() < next && !stop.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(200));
                    }
                }
                // Say goodbye, so browsers drop us at once rather than after PEER_TTL.
                if let Some(fullname) = fullname {
                    let _ = daemon.unregister(&fullname);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::txt::DeviceRole;

    fn peer(id: &str, ip: &str) -> PeerInfo {
        PeerInfo {
            id: id.into(),
            name: format!("device {id}"),
            platform: Some("macos".into()),
            app_ver: Some("0.1.0".into()),
            proto: Some("10.0.0".into()),
            rpc_port: DEFAULT_RPC_PORT,
            free_mem_mb: Some(8000),
            role: Some(DeviceRole::Worker),
            addr: ip.parse().unwrap(),
            source: PeerSource::Mdns,
            last_seen: Instant::now(),
        }
    }

    #[test]
    fn advertise_then_browse_finds_self() {
        let id = format!("test-{}", std::process::id());
        let mdns = Mdns::new(Arc::default()).unwrap();
        let me = peer(&id, "127.0.0.1");
        mdns.advertise(move || me.clone()).unwrap();

        let (tx, rx) = std::sync::mpsc::channel();
        mdns.browse(move |peers| { let _ = tx.send(peers); }).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let found = loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(left) {
                Ok(peers) => if let Some(p) = peers.into_iter().find(|p| p.id == id) { break p },
                Err(_) => panic!("own advert not found within 5 s"),
            }
        };
        assert_eq!(found.name, format!("device {id}"));
        assert_eq!(found.rpc_port, DEFAULT_RPC_PORT);
        assert_eq!(found.free_mem_mb, Some(8000));
        assert_eq!(found.source, PeerSource::Mdns);
    }

    #[test]
    fn heartbeat_refreshes_last_seen() {
        // mDNS only reports a service again when its records change; the `seq` counter
        // in each heartbeat is what keeps a live peer from expiring.
        let id = format!("hb-{}", std::process::id());
        let registry: Arc<Mutex<PeerRegistry>> = Arc::default();
        let mdns = Mdns::new(registry.clone()).unwrap();
        let me = peer(&id, "127.0.0.1");
        mdns.advertise(move || me.clone()).unwrap();
        mdns.browse(|_| {}).unwrap();

        let seen = || registry.lock().unwrap().list().into_iter().find(|p| p.id == id).map(|p| p.last_seen);
        let deadline = Instant::now() + Duration::from_secs(5);
        let first = loop {
            if let Some(t) = seen() { break t }
            assert!(Instant::now() < deadline, "own advert not found within 5 s");
            std::thread::sleep(Duration::from_millis(100));
        };
        std::thread::sleep(HEARTBEAT + Duration::from_secs(2));
        let later = seen().expect("peer expired while still announcing");
        assert!(later > first, "last_seen was not refreshed by the heartbeat");
    }

    #[test]
    fn peer_expires_after_ttl() {
        let t0 = Instant::now();
        let mut reg = PeerRegistry::default();
        assert!(reg.upsert(Some("a._distllm._tcp.local."), PeerInfo { last_seen: t0, ..peer("a", "192.168.1.4") }));
        let manual = PeerInfo { source: PeerSource::Manual, last_seen: t0, ..peer("manual:192.168.1.9:50052", "192.168.1.9") };
        assert!(reg.upsert(None, manual));

        // A heartbeat with the same values refreshes it without changing the list.
        assert!(!reg.upsert(Some("a._distllm._tcp.local."), PeerInfo { last_seen: t0 + Duration::from_secs(10), ..peer("a", "192.168.1.4") }));
        assert!(!reg.expire(t0 + Duration::from_secs(20)), "refreshed at 10 s, so still alive at 20 s");
        assert_eq!(reg.list().len(), 2);

        assert!(reg.expire(t0 + Duration::from_secs(26)));
        let left = reg.list();
        assert_eq!(left.len(), 1, "manual peers don't expire");
        assert_eq!(left[0].source, PeerSource::Manual);
    }

    #[test]
    fn goodbye_removes_peer_and_changed_values_are_a_change() {
        let mut reg = PeerRegistry::default();
        reg.upsert(Some("a._distllm._tcp.local."), peer("a", "192.168.1.4"));
        assert!(reg.upsert(Some("a._distllm._tcp.local."), PeerInfo { free_mem_mb: Some(7000), ..peer("a", "192.168.1.4") }));
        assert!(reg.upsert(Some("a._distllm._tcp.local."), peer("a", "192.168.1.7")), "a new IP is a change");
        assert!(reg.remove_fullname("a._distllm._tcp.local."));
        assert!(!reg.remove_fullname("a._distllm._tcp.local."));
        assert!(reg.list().is_empty());
    }

    #[test]
    fn manual_peer_dead_endpoint_errors_within_5s() {
        // Refused at once (nothing listens on port 1).
        assert!(probe_manual_peer("127.0.0.1:1").is_err());
        // No reply at all (TEST-NET-1, never routed): must give up on time, not hang.
        let t = Instant::now();
        let err = probe_manual_peer("192.0.2.1:50052").unwrap_err();
        assert!(t.elapsed() < Duration::from_millis(5500), "took {:?}", t.elapsed());
        assert!(err.contains("192.0.2.1:50052"), "{err}");
        assert!(probe_manual_peer("not an address").is_err());
    }

    #[test]
    fn manual_peer_reports_only_what_is_known() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let p = probe_manual_peer(&format!("127.0.0.1:{port}")).unwrap();
        assert_eq!(p.name, format!("127.0.0.1:{port}"));
        assert_eq!((p.addr, p.rpc_port), ("127.0.0.1".parse().unwrap(), port));
        assert_eq!(p.source, PeerSource::Manual);
        assert_eq!((p.free_mem_mb, p.proto, p.app_ver, p.platform, p.role), (None, None, None, None, None));
    }
}
