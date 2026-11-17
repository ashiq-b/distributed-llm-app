use std::net::{TcpListener, TcpStream};
use std::time::Duration;

use dl_engine::{EngineError, Worker, WorkerConfig};

/// Ask the OS for a free TCP port on loopback.
fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn config(port: u16) -> WorkerConfig {
    WorkerConfig { bind_host: "127.0.0.1".into(), port, cache_dir: None, threads: None }
}

// One RPC server per process (llama.cpp has no stop API), so both scenarios
// run in a single test, in order: port-in-use first, then a real start.
#[test]
fn worker_lifecycle() {
    worker_rejects_port_in_use();
    let port = worker_accepts_tcp();
    worker_serves_real_split(port);
}

fn worker_rejects_port_in_use() {
    let taken = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    match Worker::start(config(port)) {
        Err(EngineError::Bind(_)) => {}
        other => panic!("expected Err(Bind), got {other:?}"),
    }
}

fn worker_accepts_tcp() -> u16 {
    let port = free_port();
    let worker = Worker::start(config(port)).expect("worker should start");
    let addr = format!("127.0.0.1:{port}").parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_secs(2)).expect("worker should accept TCP");
    let status = worker.status();
    assert!(status.running);
    assert_eq!(status.endpoint, format!("127.0.0.1:{port}"));
    assert!(!status.device.is_empty(), "device name should be reported");

    // A second worker in the same process is refused, not silently ignored.
    match Worker::start(config(free_port())) {
        Err(EngineError::AlreadyRunning) => {}
        other => panic!("expected Err(AlreadyRunning), got {other:?}"),
    }
    port
}

/// The in-process worker must actually hold part of a model for a real host.
/// Uses llama.cpp's own CLI as the host (built by scripts/build-llama-cli.sh).
/// Skipped unless DL_TEST_MODEL points at a GGUF file.
fn worker_serves_real_split(port: u16) {
    let Ok(model) = std::env::var("DL_TEST_MODEL") else {
        eprintln!("skipping worker_serves_real_split: DL_TEST_MODEL not set");
        return;
    };
    let cli = concat!(env!("CARGO_MANIFEST_DIR"), "/build-cli/bin/llama-completion");
    let out = std::process::Command::new(cli)
        .args(["-m", &model, "-ngl", "99", "-c", "1024", "-v", "-no-cnv", "--temp", "0", "-n", "4"])
        .args(["-p", "The capital of France is", "--rpc", &format!("127.0.0.1:{port}")])
        .stdin(std::process::Stdio::null())
        .output()
        .expect("run llama-completion");
    let log = String::from_utf8_lossy(&out.stderr);
    assert!(out.status.success(), "host failed: {}", log.lines().rev().take(15).collect::<Vec<_>>().join("\n"));
    let rpc_mib: f64 = log
        .lines()
        .filter(|l| l.contains(&format!("RPC0[127.0.0.1:{port}] model buffer size")))
        .filter_map(|l| l.split('=').nth(1)?.trim().trim_end_matches("MiB").trim().parse().ok())
        .fold(0.0, f64::max);
    assert!(rpc_mib > 0.0, "expected model weights on the in-process worker, log had none");
    eprintln!("in-process worker held {rpc_mib} MiB of model weights");
}

#[test]
fn reports_rpc_proto_version_of_pinned_llama_cpp() {
    assert_eq!(dl_engine::rpc_proto_version(), "10.0.0");
}

#[test]
fn reports_free_memory_of_default_device() {
    let free = dl_engine::device_free_mb().expect("free memory should be known on this Mac");
    assert!(free > 0);
}
