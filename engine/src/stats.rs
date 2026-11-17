use std::ffi::CStr;

use crate::ffi;

/// One device's share of a loaded model, exactly as llama.cpp reported it.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceShare {
    /// Device description, e.g. "Apple M5".
    pub name: String,
    /// "host:port" for an RPC worker; `None` for this device.
    pub endpoint: Option<String>,
    pub is_remote: bool,
    /// Inclusive layer range. An index equal to the model's layer count is the output layer.
    /// `None` if llama.cpp did not report the assignment.
    pub layers: Option<(u32, u32)>,
    /// MiB of model weights held on the device; `None` if not reported.
    pub buffer_mib: Option<f64>,
}

impl From<&ffi::dl_device_share_t> for DeviceShare {
    fn from(raw: &ffi::dl_device_share_t) -> Self {
        let text = |b: &[std::os::raw::c_char; 64]| unsafe { CStr::from_ptr(b.as_ptr()) }.to_string_lossy().into_owned();
        let endpoint = text(&raw.endpoint);
        DeviceShare {
            name: text(&raw.name),
            endpoint: (!endpoint.is_empty()).then_some(endpoint),
            is_remote: raw.is_remote != 0,
            layers: match (u32::try_from(raw.layer_first), u32::try_from(raw.layer_last)) {
                (Ok(a), Ok(b)) => Some((a, b)),
                _ => None,
            },
            buffer_mib: (raw.buffer_mib >= 0.0).then_some(raw.buffer_mib),
        }
    }
}

pub(crate) fn read_shares() -> Vec<DeviceShare> {
    const MAX: usize = 32;
    let mut raw: Vec<ffi::dl_device_share_t> = (0..MAX)
        .map(|_| ffi::dl_device_share_t { name: [0; 64], endpoint: [0; 64], is_remote: 0, layer_first: -1, layer_last: -1, buffer_mib: -1.0 })
        .collect();
    let n = unsafe { ffi::dl_stats_devices(raw.as_mut_ptr(), MAX as i32) };
    raw.iter().take(n.max(0) as usize).map(DeviceShare::from).collect()
}
