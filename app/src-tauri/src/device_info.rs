use serde::Serialize;

/// What this device tells the UI (and, later, other devices) about itself.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceInfo {
    /// The device's user-visible name (macOS: the Computer Name from Settings), else the
    /// hostname, else the hardware model (e.g. "iPhone15,4").
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
        name: display_name(
            computer_name().as_deref(),
            &gethostname::gethostname().to_string_lossy(),
            hardware_model().as_deref(),
        ),
        platform: std::env::consts::OS.to_string(),
        free_mem_mb: dl_engine::device_free_mb(),
        app_ver: env!("CARGO_PKG_VERSION").to_string(),
        proto: dl_engine::rpc_proto_version(),
    }
}

/// The computer name if the OS has one; else the hostname, unless it is hidden (iOS apps
/// only see "localhost") or one a router made up from the network card's hardware
/// address ("Unknown_1a:50:…"); then the hardware model. Never a made-up name.
pub fn display_name(computer_name: Option<&str>, hostname: &str, hardware_model: Option<&str>) -> String {
    if let Some(name) = computer_name.map(str::trim).filter(|n| !n.is_empty()) {
        return name.to_string();
    }
    let host = hostname.trim().trim_end_matches(".local");
    let router_made = host.starts_with("Unknown_") || host.matches(':').count() >= 5;
    if !host.is_empty() && host != "localhost" && !router_made {
        return host.to_string();
    }
    hardware_model.filter(|m| !m.is_empty()).unwrap_or("unknown").to_string()
}

/// macOS's Computer Name (System Settings → General → About → Name).
#[cfg(target_os = "macos")]
fn computer_name() -> Option<String> {
    use std::ffi::{c_char, c_void, CStr};
    #[link(name = "SystemConfiguration", kind = "framework")]
    unsafe extern "C" {
        fn SCDynamicStoreCopyComputerName(store: *const c_void, encoding: *mut u32) -> *const c_void;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringGetCString(s: *const c_void, buf: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFRelease(cf: *const c_void);
    }
    const UTF8: u32 = 0x0800_0100; // kCFStringEncodingUTF8
    unsafe {
        let name = SCDynamicStoreCopyComputerName(std::ptr::null(), std::ptr::null_mut());
        if name.is_null() {
            return None;
        }
        let mut buf = [0 as c_char; 256];
        let ok = CFStringGetCString(name, buf.as_mut_ptr(), buf.len() as isize, UTF8) != 0;
        CFRelease(name);
        ok.then(|| CStr::from_ptr(buf.as_ptr()).to_string_lossy().into_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn computer_name() -> Option<String> {
    None
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

/// Maker and model from the system properties ("Google Pixel 8"); the maker is left off
/// when the model already starts with it ("samsung SM-S911B" stays as is).
#[cfg(target_os = "android")]
fn hardware_model() -> Option<String> {
    fn prop(key: &std::ffi::CStr) -> Option<String> {
        let mut buf = [0 as libc::c_char; 92]; // PROP_VALUE_MAX
        let n = unsafe { libc::__system_property_get(key.as_ptr(), buf.as_mut_ptr()) };
        if n <= 0 {
            return None;
        }
        let s = unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().trim().to_string();
        (!s.is_empty()).then_some(s)
    }
    let model = prop(c"ro.product.model")?;
    Some(match prop(c"ro.product.manufacturer") {
        Some(maker) if !model.to_lowercase().starts_with(&maker.to_lowercase()) => format!("{maker} {model}"),
        _ => model,
    })
}

#[cfg(not(any(target_os = "ios", target_os = "macos", target_os = "android")))]
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
        assert_eq!(display_name(None, "localhost", Some("iPhone15,4")), "iPhone15,4");
        assert_eq!(display_name(None, "", Some("iPhone15,4")), "iPhone15,4");
        assert_eq!(display_name(None, "Studio-Mac.local", Some("Mac16,12")), "Studio-Mac");
        assert_eq!(display_name(None, "localhost", None), "unknown");
    }

    #[test]
    fn name_prefers_computer_name_and_skips_router_made_hostnames() {
        assert_eq!(display_name(Some("Studio Mac"), "Unknown_1a:50:31:c3:25:31", Some("Mac16,12")), "Studio Mac");
        assert_eq!(display_name(Some("  "), "Studio-Mac", None), "Studio-Mac");
        // A DHCP name built from the network card's address is neither friendly nor private.
        assert_eq!(display_name(None, "Unknown_1a:50:31:c3:25:31", Some("Mac16,12")), "Mac16,12");
    }
}
