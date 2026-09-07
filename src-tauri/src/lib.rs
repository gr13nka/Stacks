// lib.rs — builder wiring only: plugins, state, the `thumb` protocol, setup
// hooks and the command handler list. Commands are thin: they hop off the
// async runtime onto a blocking thread and call one module function.

mod catalog;
mod geocode;
mod state;
mod thumbs;
mod trash;
mod volumes;
mod window;

use std::sync::Arc;

use serde::Serialize;
use tauri::async_runtime::spawn_blocking;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use catalog::{ScanEvent, ScanSummary};
use geocode::PlaceLabel;
use state::AppState;
use trash::{RestoreReport, TrashReport, TrashedFile};
use volumes::{Source, Volume};

type Shared = Arc<AppState>;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Environment {
    version: String,
    fixtures: bool,
    /// Filled in by the frontend from `navigator.userAgent`.
    user_agent: String,
}

fn join_err(e: tauri::Error) -> String {
    e.to_string()
}

#[tauri::command]
async fn list_volumes() -> Result<Vec<Volume>, String> {
    spawn_blocking(volumes::list).await.map_err(join_err)
}

#[tauri::command]
fn default_sources(app: AppHandle) -> Vec<Source> {
    volumes::default_sources(&app)
}

#[tauri::command]
async fn scan_catalog(
    state: State<'_, Shared>,
    sources: Vec<Source>,
    on_event: Channel<ScanEvent>,
) -> Result<ScanSummary, String> {
    let state = Arc::clone(state.inner());
    spawn_blocking(move || {
        catalog::scan(&sources, &state, &|event| {
            let _ = on_event.send(event);
        })
    })
    .await
    .map_err(join_err)
}

#[tauri::command]
async fn prefetch_thumbs(state: State<'_, Shared>, ids: Vec<String>, size: u32) -> Result<(), String> {
    if !thumbs::SIZES.contains(&size) {
        return Err(format!("unsupported thumbnail size {size}"));
    }
    thumbs::prefetch(Arc::clone(state.inner()), ids, size);
    Ok(())
}

#[tauri::command]
async fn label_places(points: Vec<[f64; 2]>) -> Result<Vec<Option<PlaceLabel>>, String> {
    spawn_blocking(move || geocode::label(&points)).await.map_err(join_err)
}

#[tauri::command]
async fn trash_photos(state: State<'_, Shared>, ids: Vec<String>, include_raw: bool) -> Result<TrashReport, String> {
    let state = Arc::clone(state.inner());
    spawn_blocking(move || trash::trash_photos(&state, &ids, include_raw)).await.map_err(join_err)
}

#[tauri::command]
async fn restore_trashed(items: Vec<TrashedFile>) -> Result<RestoreReport, String> {
    spawn_blocking(move || trash::restore(&items)).await.map_err(join_err)
}

#[tauri::command]
fn environment() -> Environment {
    Environment {
        version: env!("CARGO_PKG_VERSION").to_string(),
        fixtures: volumes::fixtures_root().is_some(),
        user_agent: String::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .register_asynchronous_uri_scheme_protocol("thumb", thumbs::handle)
        .setup(|app| {
            let paths = app.path();
            let state = AppState::new(paths.app_data_dir()?, paths.app_cache_dir()?);
            app.manage(Arc::new(state));
            if let Some(main) = app.get_webview_window("main") {
                window::lock_aspect(&main)?;
            }
            volumes::watch(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_volumes,
            default_sources,
            scan_catalog,
            prefetch_thumbs,
            label_places,
            trash_photos,
            restore_trashed,
            environment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
