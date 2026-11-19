//! The TXT record a device announces about itself (mDNS / Bonjour), and the rules for
//! whether two devices can work together.

use std::net::IpAddr;
use std::time::Instant;

use serde::Serialize;

use crate::device_info::DeviceInfo;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DeviceRole {
    Idle,
    Worker,
    Host,
}

impl DeviceRole {
    fn as_str(self) -> &'static str {
        match self {
            DeviceRole::Idle => "idle",
            DeviceRole::Worker => "worker",
            DeviceRole::Host => "host",
        }
    }
}

/// Another device on the network, as it describes itself.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PeerInfo {
    /// Stable per-install id, so a peer that changes IP is still the same peer.
    pub id: String,
    pub name: String,
    pub platform: String,
    pub app_ver: String,
    pub proto: String,
    pub rpc_port: u16,
    /// `None` when the peer didn't report it: shown as unknown, never as 0.
    pub free_mem_mb: Option<u64>,
    pub role: DeviceRole,
    pub addr: IpAddr,
    #[serde(skip)]
    pub last_seen: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Compat {
    Ok,
    AppVersionMismatch,
    ProtoMismatch,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum TxtError {
    #[error("TXT record is missing `{0}`")]
    Missing(&'static str),
    #[error("TXT record has an invalid `{0}`: {1:?}")]
    Invalid(&'static str, String),
}

pub fn encode_txt(peer: &PeerInfo) -> Vec<(String, String)> {
    let mut txt = vec![
        ("id", peer.id.clone()),
        ("name", peer.name.clone()),
        ("platform", peer.platform.clone()),
        ("app_ver", peer.app_ver.clone()),
        ("proto", peer.proto.clone()),
        ("rpc_port", peer.rpc_port.to_string()),
        ("role", peer.role.as_str().to_string()),
    ];
    if let Some(mb) = peer.free_mem_mb {
        txt.push(("free_mem_mb", mb.to_string()));
    }
    txt.into_iter().map(|(k, v)| (k.to_string(), v)).collect()
}

/// Decode a peer's TXT record. Unknown keys are ignored, so newer versions can add keys.
pub fn decode_txt(txt: &[(String, String)], addr: IpAddr) -> Result<PeerInfo, TxtError> {
    let get = |key: &'static str| txt.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str());
    let req = |key: &'static str| get(key).filter(|v| !v.is_empty()).map(str::to_string).ok_or(TxtError::Missing(key));

    let rpc_port = req("rpc_port")?;
    let rpc_port = rpc_port.parse::<u16>().ok().filter(|p| *p != 0).ok_or(TxtError::Invalid("rpc_port", rpc_port))?;
    let free_mem_mb = match get("free_mem_mb") {
        None | Some("") => None,
        Some(v) => Some(v.parse::<u64>().map_err(|_| TxtError::Invalid("free_mem_mb", v.to_string()))?),
    };
    let role = match req("role")?.as_str() {
        "idle" => DeviceRole::Idle,
        "worker" => DeviceRole::Worker,
        "host" => DeviceRole::Host,
        other => return Err(TxtError::Invalid("role", other.to_string())),
    };

    Ok(PeerInfo {
        id: req("id")?,
        name: req("name")?,
        platform: req("platform")?,
        app_ver: req("app_ver")?,
        proto: req("proto")?,
        rpc_port,
        free_mem_mb,
        role,
        addr,
        last_seen: Instant::now(),
    })
}

/// Devices work together only on the same RPC protocol and the same app version.
/// A protocol mismatch is reported first: it is the one that would break the split.
pub fn compatibility(peer: &PeerInfo, local: &DeviceInfo) -> Compat {
    if peer.proto != local.proto {
        Compat::ProtoMismatch
    } else if peer.app_ver != local.app_ver {
        Compat::AppVersionMismatch
    } else {
        Compat::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local() -> DeviceInfo {
        DeviceInfo { name: "this".into(), platform: "macos".into(), free_mem_mb: Some(8000), app_ver: "0.1.0".into(), proto: "10.0.0".into() }
    }

    fn peer() -> PeerInfo {
        PeerInfo {
            id: "a1b2".into(),
            name: "iPhone15,4".into(),
            platform: "ios".into(),
            app_ver: "0.1.0".into(),
            proto: "10.0.0".into(),
            rpc_port: 50052,
            free_mem_mb: Some(3901),
            role: DeviceRole::Worker,
            addr: "192.168.1.4".parse().unwrap(),
            last_seen: Instant::now(),
        }
    }

    fn same(a: &PeerInfo, b: &PeerInfo) -> bool {
        PeerInfo { last_seen: b.last_seen, ..a.clone() } == *b
    }

    #[test]
    fn roundtrip_txt() {
        let p = peer();
        let back = decode_txt(&encode_txt(&p), p.addr).unwrap();
        assert!(same(&back, &p), "{back:?} != {p:?}");
    }

    #[test]
    fn missing_free_mem_is_none_not_zero() {
        let p = PeerInfo { free_mem_mb: None, ..peer() };
        let txt = encode_txt(&p);
        assert!(!txt.iter().any(|(k, _)| k == "free_mem_mb"));
        assert_eq!(decode_txt(&txt, p.addr).unwrap().free_mem_mb, None);

        let mut empty = encode_txt(&peer());
        empty.retain(|(k, _)| k != "free_mem_mb");
        empty.push(("free_mem_mb".into(), String::new()));
        assert_eq!(decode_txt(&empty, p.addr).unwrap().free_mem_mb, None);
    }

    #[test]
    fn proto_mismatch_is_incompatible() {
        let p = PeerInfo { proto: "9.0.0".into(), ..peer() };
        assert_eq!(compatibility(&p, &local()), Compat::ProtoMismatch);
        // Reported even when the app version differs too.
        let p = PeerInfo { proto: "9.0.0".into(), app_ver: "0.2.0".into(), ..peer() };
        assert_eq!(compatibility(&p, &local()), Compat::ProtoMismatch);
        assert_eq!(compatibility(&peer(), &local()), Compat::Ok);
    }

    #[test]
    fn app_ver_mismatch_is_incompatible() {
        let p = PeerInfo { app_ver: "0.2.0".into(), ..peer() };
        assert_eq!(compatibility(&p, &local()), Compat::AppVersionMismatch);
    }

    #[test]
    fn unknown_keys_ignored() {
        let mut txt = encode_txt(&peer());
        txt.push(("future_key".into(), "whatever".into()));
        assert!(same(&decode_txt(&txt, peer().addr).unwrap(), &peer()));
    }

    #[test]
    fn missing_or_bad_required_keys_are_errors() {
        let addr = peer().addr;
        let mut txt = encode_txt(&peer());
        txt.retain(|(k, _)| k != "proto");
        assert_eq!(decode_txt(&txt, addr), Err(TxtError::Missing("proto")));

        let mut txt = encode_txt(&peer());
        txt.retain(|(k, _)| k != "rpc_port");
        txt.push(("rpc_port".into(), "0".into()));
        assert_eq!(decode_txt(&txt, addr), Err(TxtError::Invalid("rpc_port", "0".into())));

        let mut txt = encode_txt(&peer());
        txt.retain(|(k, _)| k != "role");
        txt.push(("role".into(), "boss".into()));
        assert_eq!(decode_txt(&txt, addr), Err(TxtError::Invalid("role", "boss".into())));
    }
}
