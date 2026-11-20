//! Fast loading: a worker that already has the weights (in its cache, or in its own copy
//! of the model file) gets only hashes for them. One worker per process, so this file
//! has a single test that walks through the cases in order.
mod common;

use std::ops::ControlFlow;
use std::path::Path;
use std::time::Instant;

use common::{serial, test_model};
use dl_engine::{ChatMessage, ChatRole, GenParams, Host, LoadReport, Worker, WorkerConfig};

const MIB: f64 = 1024.0 * 1024.0;

fn answer(host: &Host) -> String {
    let q = [ChatMessage { role: ChatRole::User, content: "Name three primary colours.".into() }];
    let mut out = String::new();
    host.generate(&q, GenParams { max_tokens: 24, temperature: 0.0, seed: 1, think: false }, |p| {
        out.push_str(p);
        ControlFlow::Continue(())
    })
    .unwrap();
    out
}

fn load(model: &Path, endpoint: &str, label: &str) -> (Host, LoadReport) {
    let host = Host::load(model, &[endpoint.to_string()], None, |_| {}).unwrap();
    let r = host.load_report();
    eprintln!(
        "{label:<28} {:>6} ms   sent {:>7.1} MiB   already on worker {:>7.1} MiB",
        r.millis,
        r.bytes_sent as f64 / MIB,
        r.bytes_cached as f64 / MIB
    );
    (host, r)
}

#[test]
fn worker_gets_only_hashes_for_weights_it_has() {
    let _g = serial();
    let Some(model) = test_model() else { return };
    let dir = std::env::temp_dir().join(format!("distllm-fastload-{}", std::process::id()));
    let (cache, index) = (dir.join("rpc"), dir.join("index"));
    std::fs::create_dir_all(&index).unwrap();

    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let _worker = Worker::start(WorkerConfig { bind_host: "127.0.0.1".into(), port, cache_dir: Some(cache.clone()), threads: None }).unwrap();
    let endpoint = format!("127.0.0.1:{port}");

    let expected = {
        let alone = Host::load(&model, &[], None, |_| {}).unwrap();
        answer(&alone)
    };

    // 1. Cold: everything is sent, and the worker keeps a copy in its cache.
    let (host, cold) = load(&model, &endpoint, "cold (nothing on worker)");
    assert_eq!(cold.bytes_cached, 0);
    assert!(cold.bytes_sent > 0);
    assert_eq!(answer(&host), expected);
    drop(host);

    // 2. Reload: weights over 1 MiB come from the worker's cache (was: only over 10 MiB).
    let (host, warm) = load(&model, &endpoint, "reload (worker cache)");
    let total = cold.bytes_sent;
    assert!(warm.bytes_cached as f64 > 0.95 * total as f64, "only {} of {total} bytes were cached", warm.bytes_cached);
    assert!((warm.bytes_sent as f64) < 0.05 * total as f64);
    assert_eq!(answer(&host), expected);
    drop(host);

    // 3. Empty cache, but the worker has the model file: nothing large crosses the network.
    std::fs::remove_dir_all(&cache).unwrap();
    std::fs::create_dir_all(&cache).unwrap();
    let t = Instant::now();
    let n = Worker::add_model(&model, &index).unwrap();
    eprintln!("index {n} tensors: {} ms", t.elapsed().as_millis());
    let t = Instant::now();
    assert_eq!(Worker::add_model(&model, &index).unwrap(), n, "indexing again is a no-op");
    assert!(t.elapsed().as_millis() < 50);

    let before = Worker::bytes_from_models();
    let (host, own) = load(&model, &endpoint, "worker has the model file");
    assert!(own.bytes_cached as f64 > 0.95 * total as f64);
    assert_eq!(Worker::bytes_from_models() - before, own.bytes_cached, "served from the file, not the cache");
    assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 0, "no copies written to the cache");
    assert_eq!(answer(&host), expected);
    drop(host);

    let _ = std::fs::remove_dir_all(&dir);
}
