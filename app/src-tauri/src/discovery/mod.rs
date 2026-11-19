//! Finding other devices on the network. Peers found by discovery (Task 3.2/3.3) are
//! kept in `PeerTable`; loading checks them before connecting.

// The encoder/decoder are used by mDNS advertise/browse (Task 3.2).
#[allow(dead_code)]
pub mod txt;

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Mutex;

pub use txt::{compatibility, Compat, PeerInfo};

use crate::device_info::DeviceInfo;

/// Known peers, by id.
#[derive(Default)]
pub struct PeerTable {
    pub peers: Mutex<HashMap<String, PeerInfo>>,
}

impl PeerTable {
    pub fn snapshot(&self) -> Vec<PeerInfo> {
        self.peers.lock().unwrap().values().cloned().collect()
    }
}

/// Refuse to load with any endpoint that belongs to a known, incompatible peer.
/// Runs before any connection is made. Endpoints no peer announced (typed in by hand)
/// can't be checked here; llama.cpp's own RPC handshake still rejects a protocol mismatch.
pub fn check_endpoints(endpoints: &[String], peers: &[PeerInfo], local: &DeviceInfo) -> Result<(), String> {
    for endpoint in endpoints {
        let Ok(sock) = endpoint.parse::<SocketAddr>() else { continue };
        let known = peers.iter().find(|p| p.addr == sock.ip() && p.rpc_port == sock.port());
        if let Some(peer) = known.filter(|p| compatibility(p, local) != Compat::Ok) {
            return Err(format!("incompatible version: {}", peer.name));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::txt::DeviceRole;
    use std::time::Instant;

    fn local() -> DeviceInfo {
        DeviceInfo { name: "this".into(), platform: "macos".into(), free_mem_mb: Some(8000), app_ver: "0.1.0".into(), proto: "10.0.0".into() }
    }

    fn peer(name: &str, ip: &str, proto: &str) -> PeerInfo {
        PeerInfo {
            id: name.into(),
            name: name.into(),
            platform: "ios".into(),
            app_ver: "0.1.0".into(),
            proto: proto.into(),
            rpc_port: 50052,
            free_mem_mb: Some(3901),
            role: DeviceRole::Worker,
            addr: ip.parse().unwrap(),
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
}
