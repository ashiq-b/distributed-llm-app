mod common;

use std::time::{Duration, Instant};

use common::{serial, test_model, RpcServer};
use dl_engine::{EngineError, Host};

#[test]
fn split_puts_tensors_on_rpc_device() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let server = RpcServer::spawn();

    let mut progress = Vec::new();
    let host = Host::load(&model, &[server.endpoint()], None, |f| progress.push(f)).expect("load split");
    let shares = host.device_shares();
    eprintln!("{shares:#?}");

    assert_eq!(shares.len(), 2, "expected local GPU + one RPC device");
    let remote: Vec<_> = shares.iter().filter(|s| s.is_remote).collect();
    assert_eq!(remote.len(), 1);
    assert_eq!(remote[0].endpoint.as_deref(), Some(server.endpoint().as_str()));
    assert!(remote[0].buffer_mib.unwrap() > 0.0, "RPC device must hold weights");

    let local = shares.iter().find(|s| !s.is_remote).unwrap();
    assert!(local.buffer_mib.unwrap() > 0.0, "local GPU must hold weights");
    assert_eq!(local.endpoint, None);

    // Layer ranges come from llama.cpp's own assignment log, and must not overlap.
    let (r0, r1) = remote[0].layers.expect("remote layer range");
    let (l0, l1) = local.layers.expect("local layer range");
    assert!(r0 <= r1 && l0 <= l1);
    assert!(r1 < l0 || l1 < r0, "layer ranges overlap: {r0}-{r1} vs {l0}-{l1}");

    assert!(progress.last().copied().unwrap_or(0.0) >= 1.0, "progress should reach 1.0");
}

#[test]
fn load_fails_fast_on_dead_endpoint() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let start = Instant::now();
    match Host::load(&model, &["127.0.0.1:1".to_string()], None, |_| {}) {
        Err(EngineError::Connect(ep)) => assert_eq!(ep, "127.0.0.1:1"),
        other => panic!("expected Err(Connect), got {:?}", other.map(|_| ())),
    }
    assert!(start.elapsed() < Duration::from_secs(6), "took {:?}", start.elapsed());
}

#[test]
fn load_reports_missing_model_file() {
    let _g = serial();
    match Host::load(std::path::Path::new("/nonexistent/model.gguf"), &[], None, |_| {}) {
        Err(EngineError::Load(_)) => {}
        other => panic!("expected Err(Load), got {:?}", other.map(|_| ())),
    }
}

#[test]
fn split_across_two_workers_reports_each_share() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let (a, b) = (RpcServer::spawn(), RpcServer::spawn());
    let host = Host::load(&model, &[a.endpoint(), b.endpoint()], None, |_| {}).expect("load across two workers");
    let shares = host.device_shares();
    eprintln!("{shares:#?}");

    assert_eq!(shares.len(), 3, "two RPC workers + local GPU");
    for ep in [a.endpoint(), b.endpoint()] {
        let s = shares.iter().find(|s| s.endpoint.as_deref() == Some(ep.as_str())).expect("share per worker");
        assert!(s.buffer_mib.unwrap_or(0.0) > 0.0, "{ep} must report the weights it holds");
        assert!(s.layers.is_some(), "{ep} must report its layers");
    }
}
