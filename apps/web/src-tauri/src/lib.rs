mod local_api;

use local_api::{ensure_local_api, stop_child, ApiSidecarState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(ApiSidecarState(std::sync::Mutex::new(None)))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("recombyn"));
      let _ = std::fs::create_dir_all(&data_dir);

      match ensure_local_api(app.handle(), &data_dir) {
        Ok(Some(child)) => {
          if let Ok(mut guard) = app.state::<ApiSidecarState>().0.lock() {
            *guard = Some(child);
          }
        }
        Ok(None) => {}
        Err(err) => {
          log::warn!("local API sidecar: {err}");
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      if let tauri::RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<ApiSidecarState>() {
          if let Ok(mut guard) = state.0.lock() {
            stop_child(&mut guard);
          }
        }
      }
    });
}
