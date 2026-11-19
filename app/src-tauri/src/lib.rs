use tauri::Manager;

mod commands;
mod device_info;
mod discovery;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_bonjour_ios::init());
    builder
        .manage(commands::EngineState::default())
        .manage(commands::DownloadState::default())
        .setup(|app| {
            let id = discovery::load_or_create_id(&app.path().app_data_dir()?)?;
            app.manage(discovery::Discovery::new(id));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::device_info,
            commands::worker_start,
            commands::worker_status,
            commands::host_load,
            commands::host_generate,
            commands::host_cancel,
            commands::host_unload,
            commands::device_shares,
            commands::discovery_start,
            commands::discovery_peers,
            commands::add_manual_peer,
            commands::catalog,
            commands::model_state,
            commands::model_download,
            commands::model_cancel_download,
            commands::model_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
