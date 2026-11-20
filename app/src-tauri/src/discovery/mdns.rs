//! mDNS advertise and browse (`_distllm._tcp`), used on macOS (and later Android,
//! Windows, Linux). iOS uses the Bonjour plugin instead (Task 3.3).
//!
//! mDNS caches are made for long-lived services and only report a service again when
//! its records change, so a device that vanishes without saying goodbye (Wi‑Fi off,
//! sleep) would stay listed for a long time. To keep the list honest, an advertising
//! device re-announces every `HEARTBEAT` with a `seq` counter in its TXT record, and
//! a peer is dropped `PEER_TTL` after its last announcement.

use std::net::IpAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mdns_sd::{RecvTimeoutError, ResolvedService, ServiceDaemon, ServiceEvent, ServiceInfo};

use super::registry::{preferred_addr, PeerRegistry, HEARTBEAT};
use super::txt::{decode_txt, encode_txt, PeerInfo};

pub const SERVICE_TYPE: &str = "_distllm._tcp.local.";
/// A resolved announcement → peer.
fn peer_from(svc: &ResolvedService) -> Option<PeerInfo> {
    let txt: Vec<(String, String)> =
        svc.txt_properties.iter().map(|p| (p.key().to_string(), p.val_str().to_string())).collect();
    let addrs: Vec<IpAddr> = svc.addresses.iter().map(|a| a.to_ip_addr()).collect();
    decode_txt(&txt, preferred_addr(&addrs)?).ok()
}

/// Advertising and browsing on one mDNS daemon.
pub struct Mdns {
    daemon: ServiceDaemon,
    registry: Arc<Mutex<PeerRegistry>>,
    browsing: AtomicBool,
    advertising: Mutex<Option<Arc<AtomicBool>>>,
    /// Set to send the next announcement now instead of at the next heartbeat.
    announce_now: Arc<AtomicBool>,
    /// Full name of the service being announced, once registered.
    advertised: Arc<Mutex<Option<String>>>,
}

impl Mdns {
    /// `registry` is shared so manual peers live in the same list.
    pub fn new(registry: Arc<Mutex<PeerRegistry>>) -> Result<Mdns, String> {
        Ok(Mdns {
            daemon: ServiceDaemon::new().map_err(|e| format!("mDNS unavailable: {e}"))?,
            registry,
            browsing: AtomicBool::new(false),
            advertising: Mutex::new(None),
            announce_now: Arc::default(),
            advertised: Arc::default(),
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

    /// Stop announcing and send the goodbye now; waits up to a second for it to go out.
    pub fn stop_advertising(&self) {
        if let Some(stop) = self.advertising.lock().unwrap().take() {
            stop.store(true, Ordering::SeqCst);
        }
        let fullname = self.advertised.lock().unwrap().take();
        if let Some(done) = fullname.and_then(|f| self.daemon.unregister(&f).ok()) {
            let _ = done.recv_timeout(Duration::from_secs(1));
        }
    }

    /// Send the announcement now (e.g. the role changed) rather than at the next heartbeat.
    pub fn announce_now(&self) {
        self.announce_now.store(true, Ordering::SeqCst);
    }

    /// Announce this device now and every `HEARTBEAT`. `me` is called each time, so the
    /// record carries current values (free memory, role). Replaces any earlier advert.
    pub fn advertise(&self, me: impl Fn() -> PeerInfo + Send + 'static) -> Result<(), String> {
        let stop = Arc::new(AtomicBool::new(false));
        let now = self.announce_now.clone();
        if let Some(previous) = self.advertising.lock().unwrap().replace(stop.clone()) {
            previous.store(true, Ordering::SeqCst);
        }
        let daemon = self.daemon.clone();
        let advertised = self.advertised.clone();
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
                            *advertised.lock().unwrap() = fullname.clone();
                            if let Err(e) = daemon.register(info.enable_addr_auto()) {
                                eprintln!("mDNS announce failed: {e}");
                            }
                        }
                        Err(e) => eprintln!("mDNS record invalid: {e}"),
                    }
                    let next = Instant::now() + HEARTBEAT;
                    while Instant::now() < next && !stop.load(Ordering::SeqCst) && !now.swap(false, Ordering::SeqCst) {
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
    use crate::discovery::registry::DEFAULT_RPC_PORT;
    use crate::discovery::txt::{DeviceRole, PeerSource};

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
    fn goodbye_removes_peer_at_once() {
        let id = format!("bye-{}", std::process::id());
        let registry: Arc<Mutex<PeerRegistry>> = Arc::default();
        let mdns = Mdns::new(registry.clone()).unwrap();
        let me = peer(&id, "127.0.0.1");
        mdns.advertise(move || me.clone()).unwrap();
        mdns.browse(|_| {}).unwrap();

        let listed = || registry.lock().unwrap().list().iter().any(|p| p.id == id);
        let deadline = Instant::now() + Duration::from_secs(5);
        while !listed() {
            assert!(Instant::now() < deadline, "own advert not found within 5 s");
            std::thread::sleep(Duration::from_millis(100));
        }
        mdns.stop_advertising();
        let t = Instant::now();
        while listed() {
            assert!(t.elapsed() < Duration::from_secs(3), "still listed 3 s after goodbye (expiry alone takes 15 s)");
            std::thread::sleep(Duration::from_millis(100));
        }
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
    fn idle_and_host_devices_are_advertised() {
        // Every device announces itself with its current role; a role change goes out
        // at once, not at the next heartbeat.
        let id = format!("role-{}", std::process::id());
        let registry: Arc<Mutex<PeerRegistry>> = Arc::default();
        let mdns = Mdns::new(registry.clone()).unwrap();
        let role = Arc::new(Mutex::new(DeviceRole::Idle));
        let (me, now) = (peer(&id, "127.0.0.1"), role.clone());
        mdns.advertise(move || PeerInfo { role: Some(*now.lock().unwrap()), ..me.clone() }).unwrap();
        mdns.browse(|_| {}).unwrap();

        let role_of = || registry.lock().unwrap().list().into_iter().find(|p| p.id == id).and_then(|p| p.role);
        let wait_for = |want: DeviceRole, within: Duration| {
            let t = Instant::now();
            while role_of() != Some(want) {
                assert!(t.elapsed() < within, "not announced as {want:?} within {within:?} (have {:?})", role_of());
                std::thread::sleep(Duration::from_millis(50));
            }
        };
        wait_for(DeviceRole::Idle, Duration::from_secs(5));
        *role.lock().unwrap() = DeviceRole::Host;
        mdns.announce_now();
        wait_for(DeviceRole::Host, Duration::from_secs(2));
    }
}
