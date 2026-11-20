//! The list of known peers, shared by every discovery backend (mDNS, or Bonjour on
//! iOS) and by manual peers. No networking here except the manual-peer probe, so the
//! rules can be tested on any machine.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use serde::Deserialize;

use super::txt::{decode_txt, PeerInfo, PeerSource};

pub const DEFAULT_RPC_PORT: u16 = 50052;
/// How often an advertising device re-announces itself.
pub const HEARTBEAT: Duration = Duration::from_secs(5);
/// A peer not heard from for this long is dropped.
pub const PEER_TTL: Duration = Duration::from_secs(15);
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Known peers, by id. The clock is passed in so expiry can be tested.
#[derive(Default)]
pub struct PeerRegistry {
    peers: HashMap<String, PeerInfo>,
    /// Announced instance name → peer id, for goodbye ("removed") events.
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

    /// Announced peers heard at or after `since` (a heartbeat arrived), for the UI's pulse.
    pub fn heard_since(&self, since: Instant) -> Vec<String> {
        self.peers.values().filter(|p| p.source != PeerSource::Manual && p.last_seen >= since).map(|p| p.id.clone()).collect()
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

/// Pick the address RPC should connect to: an IPv4 LAN address first.
pub fn preferred_addr(addrs: &[IpAddr]) -> Option<IpAddr> {
    addrs
        .iter()
        .find(|a| a.is_ipv4() && !a.is_loopback())
        .or_else(|| addrs.iter().find(|a| a.is_ipv4()))
        .or_else(|| addrs.first())
        .copied()
}

/// One service as a platform browser (iOS Bonjour) currently sees it.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
#[derive(Debug, Clone, Deserialize)]
pub struct BrowsedService {
    /// Instance name; stable for the service's lifetime.
    pub name: String,
    pub txt: Vec<(String, String)>,
    /// Numeric IPs; ones that don't parse (scoped IPv6) are skipped.
    pub addresses: Vec<String>,
}

/// Fold a browser snapshot into the registry. A service counts as announced again only
/// when its TXT record changed (the `seq` heartbeat), as with the mDNS backend. A service
/// the browser no longer lists said goodbye and is removed. Returns true if the list changed.
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub fn apply_snapshot(
    reg: &mut PeerRegistry,
    last_txt: &mut HashMap<String, Vec<(String, String)>>,
    services: &[BrowsedService],
    now: Instant,
) -> bool {
    let mut changed = false;
    let gone: Vec<String> = last_txt.keys().filter(|n| !services.iter().any(|s| &s.name == *n)).cloned().collect();
    for name in gone {
        last_txt.remove(&name);
        changed |= reg.remove_fullname(&name);
    }
    for svc in services {
        if last_txt.get(&svc.name) == Some(&svc.txt) {
            continue;
        }
        let addrs: Vec<IpAddr> = svc.addresses.iter().filter_map(|a| a.parse().ok()).collect();
        let Some(addr) = preferred_addr(&addrs) else { continue }; // not resolved yet
        let Ok(peer) = decode_txt(&svc.txt, addr) else { continue };
        last_txt.insert(svc.name.clone(), svc.txt.clone());
        changed |= reg.upsert(Some(&svc.name), PeerInfo { last_seen: now, ..peer });
    }
    changed
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::discovery::txt::{encode_txt, DeviceRole};

    pub fn peer(id: &str, ip: &str) -> PeerInfo {
        PeerInfo {
            id: id.into(),
            name: format!("device {id}"),
            platform: Some("ios".into()),
            app_ver: Some("0.1.0".into()),
            proto: Some("10.0.0".into()),
            rpc_port: DEFAULT_RPC_PORT,
            free_mem_mb: Some(3901),
            role: Some(DeviceRole::Worker),
            addr: ip.parse().unwrap(),
            source: PeerSource::Mdns,
            last_seen: Instant::now(),
        }
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

    fn browsed(name: &str, seq: u32, addresses: &[&str]) -> BrowsedService {
        let mut txt = encode_txt(&peer(name, "0.0.0.0"));
        txt.push(("seq".into(), seq.to_string()));
        BrowsedService { name: name.into(), txt, addresses: addresses.iter().map(|a| a.to_string()).collect() }
    }

    #[test]
    fn snapshot_refreshes_only_on_txt_change() {
        let t0 = Instant::now();
        let (mut reg, mut last) = (PeerRegistry::default(), HashMap::new());
        let at = |s| t0 + Duration::from_secs(s);

        // Scoped IPv6 is skipped; the IPv4 LAN address wins.
        assert!(apply_snapshot(&mut reg, &mut last, &[browsed("a", 0, &["fe80::1%en0", "192.168.1.4"])], at(0)));
        assert_eq!(reg.list()[0].addr.to_string(), "192.168.1.4");

        // Same TXT again: not a new announcement, so it expires 15 s after t0...
        assert!(!apply_snapshot(&mut reg, &mut last, &[browsed("a", 0, &["192.168.1.4"])], at(10)));
        // ...unless the heartbeat bumped seq.
        assert!(!apply_snapshot(&mut reg, &mut last, &[browsed("a", 1, &["192.168.1.4"])], at(12)));
        assert!(!reg.expire(at(20)), "seq 1 at 12 s keeps it alive at 20 s");
        assert!(reg.expire(at(28)));
    }

    #[test]
    fn snapshot_skips_unresolved_and_removes_vanished() {
        let now = Instant::now();
        let (mut reg, mut last) = (PeerRegistry::default(), HashMap::new());
        assert!(!apply_snapshot(&mut reg, &mut last, &[browsed("a", 0, &[])], now), "no address yet");
        assert!(apply_snapshot(&mut reg, &mut last, &[browsed("a", 0, &["192.168.1.4"]), browsed("b", 0, &["192.168.1.5"])], now));
        assert_eq!(reg.list().len(), 2);
        assert!(apply_snapshot(&mut reg, &mut last, &[browsed("b", 0, &["192.168.1.5"])], now));
        assert_eq!(reg.list().iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["b"]);
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
