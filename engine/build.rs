//! Builds engine/cpp (the pinned llama.cpp + our C wrapper) with CMake and links
//! every resulting static library into this crate.
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=cpp");
    println!("cargo:rerun-if-changed=../patches/llama.cpp");

    // Our documented llama.cpp patches (patches/llama.cpp/README.md); idempotent.
    let status = std::process::Command::new("../scripts/apply-llama-patches.sh")
        .status()
        .expect("run scripts/apply-llama-patches.sh");
    assert!(status.success(), "applying llama.cpp patches failed");
    println!("cargo:rerun-if-changed=LLAMA_CPP_VERSION");

    // llama.cpp in Debug is far too slow to be useful, so always build Release.
    let mut cfg = cmake::Config::new("cpp");
    cfg.profile("Release").build_target("dl_engine");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
        if let Ok(v) = std::env::var("MACOSX_DEPLOYMENT_TARGET") {
            cfg.define("CMAKE_OSX_DEPLOYMENT_TARGET", v);
        }
    }
    let dst = cfg.build();

    let mut libs = Vec::new();
    collect_static_libs(&dst.join("build"), &mut libs);
    assert!(
        libs.iter().any(|(_, n)| n == "dl_engine") && libs.iter().any(|(_, n)| n == "llama"),
        "CMake build did not produce libdl_engine.a / libllama.a"
    );
    for (dir, name) in &libs {
        println!("cargo:rustc-link-search=native={}", dir.display());
        println!("cargo:rustc-link-lib=static={name}");
    }

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    if target_os == "macos" || target_os == "ios" {
        for fw in ["Foundation", "Metal", "MetalKit", "Accelerate"] {
            println!("cargo:rustc-link-lib=framework={fw}");
        }
        println!("cargo:rustc-link-lib=c++");
    }
}

/// Every `lib<name>.a` under `dir`, as (directory, name).
fn collect_static_libs(dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_static_libs(&path, out);
        } else if let Some(file) = path.file_name().and_then(|f| f.to_str()) {
            if let Some(name) = file.strip_prefix("lib").and_then(|f| f.strip_suffix(".a")) {
                out.push((dir.to_path_buf(), name.to_string()));
            }
        }
    }
}
