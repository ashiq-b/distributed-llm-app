use tauri::Manager;

mod chat;
mod commands;
mod device_info;
mod discovery;
mod models;
mod roles;

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
            commands::role_state,
            commands::become_worker,
            commands::become_host,
            commands::leave_role,
            commands::worker_hosts,
            commands::chat_send,
            commands::chat_stop,
            commands::chat_history,
            commands::chat_reset,
            commands::discovery_start,
            commands::discovery_peers,
            commands::add_manual_peer,
            commands::catalog,
            commands::model_state,
            commands::model_download,
            commands::model_cancel_download,
            commands::model_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Say goodbye on the network so peers drop this device at once.
            if let tauri::RunEvent::Exit = event {
                app.state::<discovery::Discovery>().shutdown();
            }
        });
}
