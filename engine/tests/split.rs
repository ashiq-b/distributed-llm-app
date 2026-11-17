use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use dl_engine::{EngineError, Host};

/// A real llama.cpp RPC worker in a separate process (built by scripts/build-llama-cli.sh).
struct RpcServer {
    child: Child,
    port: u16,
}

impl RpcServer {
    fn spawn() -> RpcServer {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let bin = concat!(env!("CARGO_MANIFEST_DIR"), "/build-cli/bin/ggml-rpc-server");
        let child = Command::new(bin)
            .args(["-H", "127.0.0.1", "-p", &port.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn ggml-rpc-server (run scripts/build-llama-cli.sh)");
        let deadline = Instant::now() + Duration::from_secs(10);
        while TcpStream::connect(("127.0.0.1", port)).is_err() {
            assert!(Instant::now() < deadline, "ggml-rpc-server did not start");
            std::thread::sleep(Duration::from_millis(100));
        }
        RpcServer { child, port }
    }
    fn endpoint(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }
}

impl Drop for RpcServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn test_model() -> Option<PathBuf> {
    match std::env::var("DL_TEST_MODEL") {
        Ok(p) => Some(PathBuf::from(p)),
        Err(_) => {
            eprintln!("skipping: DL_TEST_MODEL not set");
            None
        }
    }
}

#[test]
fn split_puts_tensors_on_rpc_device() {
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
    match Host::load(std::path::Path::new("/nonexistent/model.gguf"), &[], None, |_| {}) {
        Err(EngineError::Load(_)) => {}
        other => panic!("expected Err(Load), got {:?}", other.map(|_| ())),
    }
}
