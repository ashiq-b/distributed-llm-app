//! Builds engine/cpp (the pinned llama.cpp + our C wrapper) with CMake and links
//! every resulting static library into this crate.
use std::path::{Path, PathBuf};

/// Minimum iOS version, matching llama.cpp's build-xcframework.sh.
const IOS_MIN_VERSION: &str = "16.4";
/// Minimum Android API level (Android 9).
const ANDROID_MIN_API: u32 = 28;

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
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    let mut cfg = cmake::Config::new("cpp");
    cfg.profile("Release").build_target("dl_engine");
    match target_os.as_str() {
        "macos" => {
            println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
            if let Ok(v) = std::env::var("MACOSX_DEPLOYMENT_TARGET") {
                cfg.define("CMAKE_OSX_DEPLOYMENT_TARGET", v);
            }
        }
        "ios" => {
            // Same settings as llama.cpp's own build-xcframework.sh (device build).
            let simulator = std::env::var("TARGET").unwrap().ends_with("-sim");
            cfg.define("CMAKE_SYSTEM_NAME", "iOS")
                .define("IOS", "ON")
                .define("CMAKE_OSX_SYSROOT", if simulator { "iphonesimulator" } else { "iphoneos" })
                .define("CMAKE_OSX_ARCHITECTURES", "arm64")
                .define("CMAKE_OSX_DEPLOYMENT_TARGET", IOS_MIN_VERSION)
                .define("GGML_METAL_TARGET_OS", "ios")
                .define("GGML_NATIVE", "OFF")
                .define("GGML_OPENMP", "OFF");
        }
        "android" => {
            // The NDK's own CMake toolchain; CPU backend only (no Metal, no Vulkan).
            println!("cargo:rerun-if-env-changed=NDK_HOME");
            let ndk = std::env::var("NDK_HOME")
                .or_else(|_| std::env::var("ANDROID_NDK_HOME"))
                .expect("set NDK_HOME to the Android NDK to build for Android");
            let abi = match std::env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
                "aarch64" => "arm64-v8a",
                "arm" => "armeabi-v7a",
                "x86_64" => "x86_64",
                "x86" => "x86",
                other => panic!("no Android ABI for {other}"),
            };
            cfg.define("CMAKE_TOOLCHAIN_FILE", Path::new(&ndk).join("build/cmake/android.toolchain.cmake"))
                .define("ANDROID_ABI", abi)
                .define("ANDROID_PLATFORM", format!("android-{ANDROID_MIN_API}"))
                .define("GGML_NATIVE", "OFF")
                .define("GGML_OPENMP", "OFF");
            if abi == "arm64-v8a" {
                // Dot-product and fp16 arithmetic: every arm64 phone from the last several years.
                cfg.define("GGML_CPU_ARM_ARCH", "armv8.2-a+dotprod+fp16");
            }
        }
        _ => {}
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

    if target_os == "macos" || target_os == "ios" {
        for fw in ["Foundation", "Metal", "MetalKit", "Accelerate"] {
            println!("cargo:rustc-link-lib=framework={fw}");
        }
        println!("cargo:rustc-link-lib=c++");
    }
    if target_os == "android" {
        // The NDK's shared C++ runtime would need shipping beside the app; link it statically.
        println!("cargo:rustc-link-lib=c++_static");
        println!("cargo:rustc-link-lib=c++abi");
        println!("cargo:rustc-link-lib=log");
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
