//! Android-only bridge to the Kotlin `MulticastPlugin` (android/src). Android drops
//! incoming multicast (mDNS) unless an app holds a `WifiManager.MulticastLock`, and it
//! turns the screen off and sleeps a worker unless told not to.
//! Calls block until Kotlin answers, so never call from the main thread.
#![cfg(target_os = "android")]

use serde::{de::DeserializeOwned, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

pub struct Multicast<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Multicast<R> {
    pub fn call<T: DeserializeOwned>(&self, method: &str, args: impl Serialize) -> Result<T, String> {
        self.0.run_mobile_plugin(method, args).map_err(|e| e.to_string())
    }
}

pub trait MulticastExt<R: Runtime> {
    fn multicast(&self) -> &Multicast<R>;
}

impl<R: Runtime, T: Manager<R>> MulticastExt<R> for T {
    fn multicast(&self) -> &Multicast<R> {
        self.state::<Multicast<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("multicast-android")
        .setup(|app, api| {
            app.manage(Multicast(api.register_android_plugin("com.distllm.multicast", "MulticastPlugin")?));
            Ok(())
        })
        .build()
}
