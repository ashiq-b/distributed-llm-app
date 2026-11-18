use serde::Serialize;

/// What this device tells the UI (and, later, other devices) about itself.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    /// The OS's name for this device, e.g. "Ashiq's MacBook Pro".
    pub name: String,
    /// "macos" | "ios" | "android" | "windows" | "linux"
    pub platform: String,
    /// Free memory of the default compute device (MiB), if the backend reports it.
    pub free_mem_mb: Option<u64>,
    pub app_ver: String,
    /// llama.cpp RPC protocol version; devices must match to work together.
    pub proto: String,
}

pub fn device_info() -> DeviceInfo {
    DeviceInfo {
        name: gethostname::gethostname().to_string_lossy().trim_end_matches(".local").to_string(),
        platform: std::env::consts::OS.to_string(),
        free_mem_mb: dl_engine::device_free_mb(),
        app_ver: env!("CARGO_PKG_VERSION").to_string(),
        proto: dl_engine::rpc_proto_version(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_platform_and_proto() {
        let info = device_info();
        #[cfg(target_os = "macos")]
        assert_eq!(info.platform, "macos");
        assert_eq!(info.proto, dl_engine::rpc_proto_version());
        assert!(!info.proto.is_empty());
        assert!(!info.name.is_empty(), "device name should come from the OS");
        assert_eq!(info.app_ver, env!("CARGO_PKG_VERSION"));
    }
}
