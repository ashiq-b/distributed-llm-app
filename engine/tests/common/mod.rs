#![allow(dead_code)]
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// A real llama.cpp RPC worker in a separate process (built by scripts/build-llama-cli.sh).
pub struct RpcServer {
    pub child: Child,
    pub port: u16,
}

impl RpcServer {
    pub fn spawn() -> RpcServer {
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
    pub fn endpoint(&self) -> String {
        format!("127.0.0.1:{}", self.port)
    }
}

impl Drop for RpcServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn test_model() -> Option<PathBuf> {
    match std::env::var("DL_TEST_MODEL") {
        Ok(p) => Some(PathBuf::from(p)),
        Err(_) => {
            eprintln!("skipping: DL_TEST_MODEL not set");
            None
        }
    }
}

