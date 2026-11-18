//! Resumable, checksum-verified downloads. Bytes go to `<file>.part` (resumed with an
//! HTTP Range request); the file is renamed to its final name only after its SHA-256
//! matches the catalog. A final-named file is therefore always a verified model.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::ModelEntry;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ModelState {
    NotDownloaded,
    /// Some bytes are on disk (`<file>.part`); downloading again resumes from here.
    Partial { bytes: u64 },
    /// Downloaded and checksum-verified.
    Ready { path: PathBuf },
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("download cancelled")]
    Cancelled,
    #[error("checksum mismatch")]
    ChecksumMismatch,
    #[error("server returned HTTP {0}")]
    Http(u16),
    #[error("network error: {0}")]
    Network(String),
    #[error("file error: {0}")]
    Io(String),
}

pub fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    dest.with_file_name(name)
}

/// State of a model file on disk. Only verified downloads get their final name.
pub fn file_state(dest: &Path) -> ModelState {
    if dest.is_file() {
        return ModelState::Ready { path: dest.to_path_buf() };
    }
    match std::fs::metadata(part_path(dest)) {
        Ok(m) => ModelState::Partial { bytes: m.len() },
        Err(_) => ModelState::NotDownloaded,
    }
}

pub fn model_state(models_dir: &Path, entry: &ModelEntry) -> ModelState {
    file_state(&models_dir.join(&entry.file))
}

const CHUNK: usize = 1 << 20;

/// No bytes for this long (e.g. Wi-Fi dropped) fails the download; the partial file is kept.
pub const READ_TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Download `url` to `dest`, resuming any `<dest>.part`. `progress(done, total)` is
/// called as bytes arrive. Partial bytes are kept on network errors and cancel.
pub fn download_file(
    url: &str,
    dest: &Path,
    sha256: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), DownloadError> {
    download_file_with(url, dest, sha256, cancel, progress, READ_TIMEOUT)
}

fn download_file_with(
    url: &str,
    dest: &Path,
    sha256: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
    read_timeout: Duration,
) -> Result<(), DownloadError> {
    let io = |e: std::io::Error| DownloadError::Io(e.to_string());
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(io)?;
    }
    let part = part_path(dest);

    // Re-hash what we already have so the final checksum covers the whole file.
    let mut hasher = Sha256::new();
    let mut have = 0u64;
    if let Ok(mut f) = File::open(&part) {
        let mut buf = vec![0u8; CHUNK];
        loop {
            let n = f.read(&mut buf).map_err(io)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            have += n as u64;
        }
    }

    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(CONNECT_TIMEOUT))
        .timeout_per_read(Some(read_timeout))
        .build()
        .into();
    let mut req = agent.get(url);
    if have > 0 {
        req = req.header("Range", &format!("bytes={have}-"));
    }
    let mut resp = req.call().map_err(|e| DownloadError::Network(e.to_string()))?;
    let status = resp.status().as_u16();

    let mut file = match status {
        206 => OpenOptions::new().append(true).open(&part).map_err(io)?,
        200 => {
            // The server ignored the range: start over.
            hasher = Sha256::new();
            have = 0;
            File::create(&part).map_err(io)?
        }
        416 if have > 0 => return finish(dest, &part, hasher, sha256), // already complete
        code => return Err(DownloadError::Http(code)),
    };
    let total = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok()?.parse::<u64>().ok())
        .map(|len| len + have)
        .unwrap_or(0);

    let mut body = resp.body_mut().as_reader();
    let mut buf = vec![0u8; CHUNK];
    let mut done = have;
    progress(done, total);
    loop {
        if cancel.load(Ordering::SeqCst) {
            file.flush().map_err(io)?;
            return Err(DownloadError::Cancelled);
        }
        let n = match body.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                file.flush().map_err(io)?;
                return Err(DownloadError::Network(e.to_string()));
            }
        };
        file.write_all(&buf[..n]).map_err(io)?;
        hasher.update(&buf[..n]);
        done += n as u64;
        progress(done, total);
    }
    file.sync_all().map_err(io)?;
    if total > 0 && done < total {
        return Err(DownloadError::Network(format!("connection closed after {done} of {total} bytes")));
    }
    drop(file);
    finish(dest, &part, hasher, sha256)
}

fn finish(dest: &Path, part: &Path, hasher: Sha256, sha256: &str) -> Result<(), DownloadError> {
    if format!("{:x}", hasher.finalize()) != sha256.to_ascii_lowercase() {
        let _ = std::fs::remove_file(part);
        return Err(DownloadError::ChecksumMismatch);
    }
    std::fs::rename(part, dest).map_err(|e| DownloadError::Io(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Mutex};

    use sha2::{Digest, Sha256};

    fn fixture() -> Vec<u8> {
        (0..200_000u32).map(|i| (i % 251) as u8).collect()
    }
    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    #[derive(Clone, Copy)]
    enum Mode {
        /// Honors Range requests.
        Honest,
        /// Announces the full length but closes the connection after n bytes.
        DropAfter(usize),
        /// Always answers with this HTTP status and no body.
        Status(u16),
        /// Sends n bytes, then goes silent without closing (like a dropped Wi-Fi link).
        StallAfter(usize),
    }

    /// A minimal HTTP/1.1 server over real sockets, serving `body` (test fixture).
    struct TestServer {
        url: String,
        ranges: Arc<Mutex<Vec<Option<String>>>>,
    }

    fn serve(body: Vec<u8>, mode: Mode) -> TestServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let mut stream = stream.unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.strip_prefix("Range: ").or_else(|| line.strip_prefix("range: ")) {
                        range = Some(v.trim().to_string());
                    }
                }
                seen.lock().unwrap().push(range.clone());
                let start = range
                    .as_deref()
                    .and_then(|r| r.strip_prefix("bytes="))
                    .and_then(|r| r.trim_end_matches('-').parse::<usize>().ok())
                    .unwrap_or(0);
                let _ = match mode {
                    Mode::Status(code) => write!(stream, "HTTP/1.1 {code} Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                    Mode::Honest if start > 0 => {
                        let part = &body[start..];
                        write!(stream, "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                            part.len(), start, body.len() - 1, body.len()).and_then(|_| stream.write_all(part))
                    }
                    Mode::Honest => write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                        .and_then(|_| stream.write_all(&body)),
                    Mode::DropAfter(n) => write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                        .and_then(|_| stream.write_all(&body[..n])),
                    Mode::StallAfter(n) => {
                        let r = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                            .and_then(|_| stream.write_all(&body[..n]))
                            .and_then(|_| stream.flush());
                        std::thread::sleep(std::time::Duration::from_secs(30));
                        r
                    }
                };
            }
        });
        TestServer { url, ranges }
    }

    fn tmp_dest(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("distllm-dl-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("model.gguf")
    }

    fn fetch(server: &TestServer, dest: &PathBuf, sha256: &str) -> Result<(), DownloadError> {
        download_file(&server.url, dest, sha256, &AtomicBool::new(false), &mut |_, _| {})
    }

    #[test]
    fn resumes_from_partial_file() {
        let body = fixture();
        let dest = tmp_dest("resume");
        std::fs::write(part_path(&dest), &body[..1000]).unwrap();
        let server = serve(body.clone(), Mode::Honest);

        fetch(&server, &dest, &sha(&body)).unwrap();

        assert_eq!(server.ranges.lock().unwrap()[0].as_deref(), Some("bytes=1000-"));
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(!part_path(&dest).exists());
    }

    #[test]
    fn rejects_checksum_mismatch() {
        let dest = tmp_dest("mismatch");
        let server = serve(fixture(), Mode::Honest);
        let err = fetch(&server, &dest, &"0".repeat(64)).unwrap_err();
        assert!(matches!(err, DownloadError::ChecksumMismatch), "{err:?}");
        assert!(!dest.exists() && !part_path(&dest).exists());
    }

    #[test]
    fn partial_is_not_ready() {
        let dest = tmp_dest("state");
        assert_eq!(file_state(&dest), ModelState::NotDownloaded);
        std::fs::write(part_path(&dest), [1u8; 1234]).unwrap();
        assert_eq!(file_state(&dest), ModelState::Partial { bytes: 1234 });
        std::fs::write(&dest, b"verified").unwrap();
        assert_eq!(file_state(&dest), ModelState::Ready { path: dest.clone() });
    }

    #[test]
    fn server_error_keeps_partial_for_resume() {
        let body = fixture();
        let dest = tmp_dest("drop");

        // Connection drops mid-transfer: an error, and the bytes so far are kept.
        let flaky = serve(body.clone(), Mode::DropAfter(70_000));
        assert!(matches!(fetch(&flaky, &dest, &sha(&body)), Err(DownloadError::Network(_))));
        assert_eq!(file_state(&dest), ModelState::Partial { bytes: 70_000 });

        // A server error keeps them too.
        let broken = serve(body.clone(), Mode::Status(500));
        assert!(matches!(fetch(&broken, &dest, &sha(&body)), Err(DownloadError::Http(500))));
        assert_eq!(file_state(&dest), ModelState::Partial { bytes: 70_000 });

        // The next attempt resumes from there and completes.
        let good = serve(body.clone(), Mode::Honest);
        fetch(&good, &dest, &sha(&body)).unwrap();
        assert_eq!(good.ranges.lock().unwrap()[0].as_deref(), Some("bytes=70000-"));
        assert_eq!(std::fs::read(&dest).unwrap(), body);
    }

    #[test]
    fn stalled_connection_times_out_and_keeps_partial() {
        let body = fixture();
        let dest = tmp_dest("stall");
        let server = serve(body.clone(), Mode::StallAfter(50_000));
        let start = std::time::Instant::now();
        let err = download_file_with(&server.url, &dest, &sha(&body), &AtomicBool::new(false), &mut |_, _| {},
            std::time::Duration::from_secs(1))
        .unwrap_err();
        assert!(matches!(err, DownloadError::Network(_)), "{err:?}");
        assert!(start.elapsed() < std::time::Duration::from_secs(10), "took {:?}", start.elapsed());
        assert_eq!(file_state(&dest), ModelState::Partial { bytes: 50_000 });
    }

    #[test]
    fn cancel_keeps_partial() {
        let body = fixture();
        let dest = tmp_dest("cancel");
        let server = serve(body.clone(), Mode::Honest);
        let cancel = AtomicBool::new(false);
        let err = download_file(&server.url, &dest, &sha(&body), &cancel, &mut |done, _| {
            if done > 0 {
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        })
        .unwrap_err();
        assert!(matches!(err, DownloadError::Cancelled), "{err:?}");
        assert!(matches!(file_state(&dest), ModelState::Partial { .. }));
        assert!(!dest.exists());
    }

    #[test]
    fn reports_progress_up_to_total() {
        let body = fixture();
        let dest = tmp_dest("progress");
        let server = serve(body.clone(), Mode::Honest);
        let mut last = (0, 0);
        download_file(&server.url, &dest, &sha(&body), &AtomicBool::new(false), &mut |d, t| last = (d, t)).unwrap();
        assert_eq!(last, (body.len() as u64, body.len() as u64));
    }
}

/// Real network check against Hugging Face (redirect to CDN, HTTPS, Range resume).
/// Run on purpose: `cargo test -p distllm-app real_huggingface -- --ignored --nocapture`
#[cfg(test)]
mod network_tests {
    use super::*;

    #[test]
    #[ignore = "downloads ~830 MB from Hugging Face"]
    fn real_huggingface_download_cancels_resumes_and_verifies() {
        let m = crate::models::catalog().iter().find(|m| m.id == "qwen3.5-0.8b").unwrap();
        let dir = std::env::temp_dir().join("distllm-real-download");
        let _ = std::fs::remove_dir_all(&dir);
        let dest = dir.join(&m.file);

        // Cancel after ~40 MB.
        let cancel = AtomicBool::new(false);
        let err = download_file(&m.url, &dest, &m.sha256, &cancel, &mut |done, _| {
            if done > 40_000_000 {
                cancel.store(true, Ordering::SeqCst);
            }
        })
        .unwrap_err();
        assert!(matches!(err, DownloadError::Cancelled));
        let ModelState::Partial { bytes } = file_state(&dest) else { panic!("expected partial") };
        eprintln!("cancelled with {bytes} bytes on disk");

        // Resume to the end; the final file must match the catalog SHA-256 and size.
        let mut first = None;
        download_file(&m.url, &dest, &m.sha256, &AtomicBool::new(false), &mut |done, total| {
            first.get_or_insert((done, total));
        })
        .unwrap();
        let (start, total) = first.unwrap();
        eprintln!("resumed at {start} of {total}");
        assert_eq!(start, bytes, "must resume where it stopped");
        assert_eq!(total, m.size_bytes);
        assert_eq!(file_state(&dest), ModelState::Ready { path: dest.clone() });
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), m.size_bytes);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
