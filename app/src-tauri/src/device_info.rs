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
        name: display_name(&gethostname::gethostname().to_string_lossy(), hardware_model().as_deref()),
        platform: std::env::consts::OS.to_string(),
        free_mem_mb: dl_engine::device_free_mb(),
        app_ver: env!("CARGO_PKG_VERSION").to_string(),
        proto: dl_engine::rpc_proto_version(),
    }
}

/// The OS hostname, unless the OS hides it (iOS apps only see "localhost"); then the
/// hardware model the device reports (e.g. "iPhone15,4"). Never a made-up name.
pub fn display_name(hostname: &str, hardware_model: Option<&str>) -> String {
    let host = hostname.trim().trim_end_matches(".local");
    if !host.is_empty() && host != "localhost" {
        return host.to_string();
    }
    hardware_model.filter(|m| !m.is_empty()).unwrap_or("unknown").to_string()
}

/// `hw.machine` on iOS ("iPhone15,4"); `hw.model` on macOS ("Mac16,12").
#[cfg(any(target_os = "ios", target_os = "macos"))]
fn hardware_model() -> Option<String> {
    let key = if cfg!(target_os = "ios") { c"hw.machine" } else { c"hw.model" };
    let mut len: libc::size_t = 0;
    unsafe {
        if libc::sysctlbyname(key.as_ptr(), std::ptr::null_mut(), &mut len, std::ptr::null_mut(), 0) != 0 || len == 0 {
            return None;
        }
        let mut buf = vec![0u8; len];
        if libc::sysctlbyname(key.as_ptr(), buf.as_mut_ptr().cast(), &mut len, std::ptr::null_mut(), 0) != 0 {
            return None;
        }
        let s = String::from_utf8_lossy(&buf[..len]).trim_end_matches('\0').to_string();
        (!s.is_empty()).then_some(s)
    }
}

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
fn hardware_model() -> Option<String> {
    None
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

    #[test]
    fn name_uses_hardware_model_when_os_hides_the_hostname() {
        // iOS apps see "localhost"; never show that as a device name.
        assert_eq!(display_name("localhost", Some("iPhone15,4")), "iPhone15,4");
        assert_eq!(display_name("", Some("iPhone15,4")), "iPhone15,4");
        assert_eq!(display_name("Ashiqs-MacBook-Air.local", Some("Mac16,12")), "Ashiqs-MacBook-Air");
        assert_eq!(display_name("localhost", None), "unknown");
    }
}
