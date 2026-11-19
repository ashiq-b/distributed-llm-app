//! iOS-only bridge to the Swift `BonjourPlugin` (ios/Sources). The app's discovery code
//! (`discovery/bonjour.rs`) calls it with `app.bonjour().call(method, args)`.
//! Calls block until Swift answers on the main thread, so never call from the main thread.
#![cfg(target_os = "ios")]

use serde::{de::DeserializeOwned, Serialize};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{Manager, Runtime};

tauri::ios_plugin_binding!(init_plugin_bonjour);

pub struct Bonjour<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Bonjour<R> {
    pub fn call<T: DeserializeOwned>(&self, method: &str, args: impl Serialize) -> Result<T, String> {
        self.0.run_mobile_plugin(method, args).map_err(|e| e.to_string())
    }
}

pub trait BonjourExt<R: Runtime> {
    fn bonjour(&self) -> &Bonjour<R>;
}

impl<R: Runtime, T: Manager<R>> BonjourExt<R> for T {
    fn bonjour(&self) -> &Bonjour<R> {
        self.state::<Bonjour<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("bonjour-ios")
        .setup(|app, api| {
            app.manage(Bonjour(api.register_ios_plugin(init_plugin_bonjour)?));
            Ok(())
        })
        .build()
}
