mod commands;
mod device_info;
mod models;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(commands::EngineState::default())
        .manage(commands::DownloadState::default())
        .invoke_handler(tauri::generate_handler![
            commands::device_info,
            commands::worker_start,
            commands::worker_status,
            commands::host_load,
            commands::host_generate,
            commands::host_cancel,
            commands::host_unload,
            commands::device_shares,
            commands::catalog,
            commands::model_state,
            commands::model_download,
            commands::model_cancel_download,
            commands::model_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
