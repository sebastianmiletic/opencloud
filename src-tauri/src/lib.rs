use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{
    utils::config::BackgroundThrottlingPolicy,
    webview::{NewWindowResponse, PageLoadEvent, WebviewWindowBuilder},
    Emitter, Manager, State, WebviewUrl,
};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

const BLOCKER_INIT_SCRIPT: &str = include_str!("blocker_init.js");
const MIGRATION_FILE_NAME: &str = "tauri-migration-v1.json";
static PROVIDER_HEALTH_CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();

#[cfg(any(all(target_os = "linux", target_arch = "aarch64"), test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinuxWebkitRenderer {
    Accelerated,
    Compatible,
    Software,
}

#[cfg(any(all(target_os = "linux", target_arch = "aarch64"), test))]
impl LinuxWebkitRenderer {
    fn from_override(value: Option<&str>) -> Option<Self> {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            Some("accelerated" | "dmabuf") => Some(Self::Accelerated),
            Some("compatible" | "compat") => Some(Self::Compatible),
            Some("software") => Some(Self::Software),
            _ => None,
        }
    }
}

#[cfg(any(all(target_os = "linux", target_arch = "aarch64"), test))]
fn is_oneplus_sdm845_device(identity: &str) -> bool {
    let identity = identity.to_ascii_lowercase();
    identity.contains("oneplus,enchilada")
        || identity.contains("oneplus,oneplus6")
        || identity.contains("oneplus 6")
}

#[cfg(any(all(target_os = "linux", target_arch = "aarch64"), test))]
fn select_linux_webkit_renderer(
    requested: Option<&str>,
    is_oneplus_sdm845: bool,
) -> LinuxWebkitRenderer {
    LinuxWebkitRenderer::from_override(requested).unwrap_or(if is_oneplus_sdm845 {
        LinuxWebkitRenderer::Compatible
    } else {
        LinuxWebkitRenderer::Accelerated
    })
}

#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
fn configure_linux_arm64_webkit() -> LinuxWebkitRenderer {
    if std::env::var_os("GDK_BACKEND").is_none() {
        // Prefer native Wayland on Hyprland, while retaining GTK's X11 fallback.
        std::env::set_var("GDK_BACKEND", "wayland,x11");
    }

    let device_identity = ["/proc/device-tree/compatible", "/proc/device-tree/model"]
        .iter()
        .filter_map(|path| fs::read(path).ok())
        .flatten()
        .map(|byte| if byte == 0 { b' ' } else { byte })
        .map(char::from)
        .collect::<String>();
    let requested = std::env::var("OPEN_CLOUD_WEBKIT_RENDERER").ok();
    let renderer = select_linux_webkit_renderer(
        requested.as_deref(),
        is_oneplus_sdm845_device(&device_identity),
    );

    match renderer {
        LinuxWebkitRenderer::Accelerated => {}
        LinuxWebkitRenderer::Compatible => {
            if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
        }
        LinuxWebkitRenderer::Software => {
            if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
            }
            if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
                std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
            }
        }
    }

    renderer
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
struct PublicConfig {
    tmdb_bearer_token: &'static str,
    omdb_api_key: &'static str,
    supabase_url: &'static str,
    supabase_anon_key: &'static str,
    app_version: &'static str,
    app_platform: &'static str,
    app_architecture: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockerPolicy {
    enabled: bool,
    block_all_tabs: bool,
    block_all_windows: bool,
    allow_self_pages: bool,
    allow_extension_pages: bool,
}

impl Default for BlockerPolicy {
    fn default() -> Self {
        Self {
            enabled: true,
            block_all_tabs: true,
            block_all_windows: true,
            allow_self_pages: false,
            allow_extension_pages: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockerLog {
    url: String,
    source_url: String,
    reason: String,
    time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockerSnapshot {
    initialized: bool,
    #[serde(flatten)]
    policy: BlockerPolicy,
    counter: u64,
    logs: Vec<BlockerLog>,
}

impl Default for BlockerSnapshot {
    fn default() -> Self {
        Self {
            initialized: false,
            policy: BlockerPolicy::default(),
            counter: 0,
            logs: Vec::new(),
        }
    }
}

struct BlockerService {
    path: PathBuf,
    snapshot: Mutex<BlockerSnapshot>,
}

impl BlockerService {
    fn load(path: PathBuf) -> Self {
        let snapshot = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            snapshot: Mutex::new(snapshot),
        }
    }

    fn snapshot(&self) -> BlockerSnapshot {
        self.snapshot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn save_snapshot(&self, snapshot: &BlockerSnapshot) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let payload = serde_json::to_vec_pretty(snapshot).map_err(|error| error.to_string())?;
        fs::write(&temporary, payload).map_err(|error| error.to_string())?;
        fs::rename(temporary, &self.path).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn set_policy(&self, policy: BlockerPolicy) -> Result<BlockerSnapshot, String> {
        let snapshot = {
            let mut guard = self
                .snapshot
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.policy = policy;
            guard.initialized = true;
            guard.clone()
        };
        self.save_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    fn replace_activity(
        &self,
        counter: u64,
        logs: Vec<BlockerLog>,
    ) -> Result<BlockerSnapshot, String> {
        let snapshot = {
            let mut guard = self
                .snapshot
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.counter = counter;
            guard.logs = logs.into_iter().take(500).collect();
            guard.initialized = true;
            guard.clone()
        };
        self.save_snapshot(&snapshot)?;
        Ok(snapshot)
    }

    fn record(
        &self,
        url: impl Into<String>,
        source_url: impl Into<String>,
        reason: impl Into<String>,
    ) -> BlockerLog {
        let log_entry = BlockerLog {
            url: url.into(),
            source_url: source_url.into(),
            reason: reason.into(),
            time: Utc::now().to_rfc3339(),
        };
        let snapshot = {
            let mut guard = self
                .snapshot
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.counter = guard.counter.saturating_add(1);
            guard.logs.insert(0, log_entry.clone());
            guard.logs.truncate(500);
            guard.clone()
        };
        if let Err(error) = self.save_snapshot(&snapshot) {
            log::error!("failed to persist blocker event: {error}");
        }
        log_entry
    }

    fn should_block_new_window(&self, url: &Url) -> bool {
        let policy = self.snapshot().policy;
        if !policy.enabled || (!policy.block_all_tabs && !policy.block_all_windows) {
            return false;
        }
        if policy.allow_self_pages && is_app_url(url) {
            return false;
        }
        if policy.allow_extension_pages && matches!(url.scheme(), "tauri" | "ipc") {
            return false;
        }
        true
    }
}

#[derive(Default)]
struct MigrationState {
    pending_path: Mutex<Option<PathBuf>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyMigration {
    version: u8,
    exported_at: String,
    storage: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    version: String,
    body: Option<String>,
    date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProbe {
    reachable: bool,
    latency_ms: u64,
    status: Option<u16>,
}

fn is_app_url(url: &Url) -> bool {
    matches!(url.scheme(), "tauri" | "ipc")
        || matches!(
            url.host_str(),
            Some("tauri.localhost") | Some("127.0.0.1") | Some("localhost")
        )
}

fn is_allowed_navigation(url: &Url) -> bool {
    if matches!(url.scheme(), "about" | "data" | "blob") {
        return true;
    }
    if is_app_url(url) {
        return true;
    }
    is_provider_host(url.host_str())
        || matches!(
            url.host_str(),
            Some("image.tmdb.org")
                | Some("www.themoviedb.org")
                | Some("api.themoviedb.org")
                | Some("www.omdbapi.com")
        )
}

fn is_provider_host(host: Option<&str>) -> bool {
    matches!(
        host,
        Some("vidsrc.cc")
            | Some("player.videasy.net")
            | Some("player.videasy.to")
            | Some("vsembed.ru")
            | Some("cloudorchestranova.com")
            | Some("vidsrc.me")
            | Some("vidsrc.to")
            | Some("moviesapi.club")
            | Some("vidsrc.su")
            | Some("vidlink.pro")
            | Some("vidphantom.com")
            | Some("vidphantom.live")
            | Some("vidphantom.online")
            | Some("vidphantom.site")
            | Some("vidphantom.website")
            | Some("vidphantom.xyz")
            | Some("vidcore.org")
            | Some("www.vidcore.org")
            | Some("embedmaster.link")
            | Some("embdmstrplayer.com")
            | Some("vixsrc.to")
            | Some("moviesapi.to")
            | Some("vidsrc.sh")
            | Some("vidfast.pro")
            | Some("vidfast.vc")
            | Some("cdn.vidspark.to")
            | Some("player.moviesapi.vip")
            | Some("cinesrc.st")
            | Some("a.cineflix.st")
            | Some("a2.cineflix.st")
            | Some("fembox.aether.bar")
            | Some("1414.hexa.su")
            | Some("play.xpass.top")
            | Some("vidlux.top")
            | Some("vidlux.xyz")
            | Some("vidlux.online")
            | Some("vidsrc.mov")
            | Some("vidzee.wtf")
            | Some("player.vidzee.wtf")
            | Some("vidnest.fun")
            | Some("player.vidplus.to")
            | Some("player.smashy.stream")
            | Some("rivestream.net")
            | Some("spencerdevs.xyz")
            | Some("www.2embed.cc")
            | Some("www.2embed.skin")
            | Some("vidsrcme.ru")
            | Some("vidsrc-me.ru")
            | Some("vidsrc-embed.ru")
            | Some("vsrc.su")
            | Some("multiembed.mov")
            | Some("movish.to")
            | Some("vidcore.liveblog365.com")
            | Some("ji1pfnerysxkina0.fstream.app")
    )
}

fn provider_health_client() -> Result<reqwest::Client, String> {
    PROVIDER_HEALTH_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(4))
                .timeout(Duration::from_secs(8))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() >= 2 {
                        return attempt.error("too many provider redirects");
                    }
                    if attempt.url().scheme() == "https"
                        && is_provider_host(attempt.url().host_str())
                    {
                        attempt.follow()
                    } else {
                        attempt.stop()
                    }
                }))
                .user_agent("OpenCloud/3 provider-health")
                .build()
                .map_err(|error| error.to_string())
        })
        .clone()
}

#[tauri::command]
fn get_public_config() -> PublicConfig {
    PublicConfig {
        tmdb_bearer_token: option_env!("TMDB_BEARER_TOKEN").unwrap_or(""),
        omdb_api_key: option_env!("OMDB_API_KEY").unwrap_or(""),
        supabase_url: option_env!("SUPABASE_URL").unwrap_or(""),
        supabase_anon_key: option_env!("SUPABASE_ANON_KEY").unwrap_or(""),
        app_version: env!("CARGO_PKG_VERSION"),
        app_platform: std::env::consts::OS,
        app_architecture: std::env::consts::ARCH,
    }
}

#[tauri::command]
fn get_blocker_state(state: State<'_, Arc<BlockerService>>) -> BlockerSnapshot {
    state.snapshot()
}

#[tauri::command]
fn set_blocker_policy(
    state: State<'_, Arc<BlockerService>>,
    policy: BlockerPolicy,
) -> Result<BlockerSnapshot, String> {
    state.set_policy(policy)
}

#[tauri::command]
fn set_blocker_activity(
    state: State<'_, Arc<BlockerService>>,
    counter: u64,
    logs: Vec<BlockerLog>,
) -> Result<BlockerSnapshot, String> {
    state.replace_activity(counter, logs)
}

#[tauri::command]
fn record_blocked_event(
    app: tauri::AppHandle,
    state: State<'_, Arc<BlockerService>>,
    url: String,
    source_url: String,
    reason: String,
) -> BlockerLog {
    let entry = state.record(url, source_url, reason);
    let _ = app.emit("opencloud:blocker-event", &entry);
    entry
}

fn migration_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OPEN_CLOUD_MIGRATION_PATH") {
        candidates.push(PathBuf::from(path));
    }
    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("OpenCloud").join(MIGRATION_FILE_NAME));
        candidates.push(data_dir.join("opencloud").join(MIGRATION_FILE_NAME));
    }
    candidates
}

#[tauri::command]
fn load_legacy_migration(
    state: State<'_, MigrationState>,
) -> Result<Option<LegacyMigration>, String> {
    for candidate in migration_candidates() {
        if !candidate.is_file() || candidate.with_extension("json.imported").exists() {
            continue;
        }
        let raw = fs::read_to_string(&candidate).map_err(|error| error.to_string())?;
        let migration: LegacyMigration =
            serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        if migration.version != 1 {
            return Err(format!(
                "unsupported Electron migration version {}",
                migration.version
            ));
        }
        *state
            .pending_path
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(candidate);
        return Ok(Some(migration));
    }
    Ok(None)
}

#[tauri::command]
fn complete_legacy_migration(state: State<'_, MigrationState>) -> Result<(), String> {
    let path = state
        .pending_path
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(path) = path {
        let imported_marker = path.with_extension("json.imported");
        fs::write(imported_marker, Utc::now().to_rfc3339()).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
    let permitted = parsed.scheme() == "https"
        && matches!(
            parsed.host_str(),
            Some("www.themoviedb.org") | Some("github.com")
        );
    if !permitted {
        return Err("external URL is outside the Open Cloud allowlist".into());
    }
    open::that(parsed.as_str()).map_err(|error| error.to_string())
}

#[tauri::command]
async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    Ok(update.map(|update| UpdateInfo {
        current_version: update.current_version,
        version: update.version,
        body: update.body,
        date: update.date.map(|date| date.to_string()),
    }))
}

fn valid_release_tag(tag: &str) -> bool {
    let Some(version) = tag.strip_prefix('v') else { return false };
    let parts: Vec<_> = version.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty()
        && part.len() <= 6 && part.bytes().all(|b| b.is_ascii_digit()))
}

#[tauri::command]
async fn list_past_versions(page: u32) -> Result<serde_json::Value, String> {
    if page == 0 || page > 1000 { return Err("invalid release page".into()); }
    let response = reqwest::Client::builder().timeout(Duration::from_secs(20))
        .user_agent("OpenCloud release history").build().map_err(|e| e.to_string())?
        .get(format!("https://api.github.com/repos/sebastianmiletic/opencloud/releases?per_page=100&page={page}"))
        .send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?;
    let releases: Vec<serde_json::Value> = serde_json::from_str(&response.text().await.map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let has_more = releases.len() == 100;
    let items: Vec<_> = releases.into_iter().filter(|r| r["draft"] != true && r["prerelease"] != true)
        .filter_map(|r| {
            let tag = r["tag_name"].as_str()?;
            if !valid_release_tag(tag) { return None; }
            Some(serde_json::json!({"tag": tag, "date": r["published_at"],
                "signed": r["assets"].as_array().is_some_and(|assets| assets.iter().any(|a| a["name"] == "latest.json"))}))
        }).collect();
    Ok(serde_json::json!({"items": items, "hasMore": has_more, "currentVersion": env!("CARGO_PKG_VERSION")}))
}

#[tauri::command]
async fn downgrade_version(app: tauri::AppHandle, tag: String) -> Result<(), String> {
    if !valid_release_tag(&tag) { return Err("invalid release tag".into()); }
    let endpoint = Url::parse(&format!("https://github.com/sebastianmiletic/opencloud/releases/download/{tag}/latest.json"))
        .map_err(|e| e.to_string())?;
    let update = app.updater_builder().endpoints(vec![endpoint]).map_err(|e| e.to_string())?
        .version_comparator(|current, remote| remote.version < current)
        .build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
        .ok_or("This release is not older than the installed version.")?;
    if format!("v{}", update.version) != tag {
        return Err("Release manifest does not match the selected version.".into());
    }
    let prefix = format!("https://github.com/sebastianmiletic/opencloud/releases/download/{tag}/");
    if !update.download_url.as_str().starts_with(&prefix) {
        return Err("Release download is outside the selected official release.".into());
    }
    update.download_and_install(move |chunk_length, content_length| {
        let _ = app.emit("opencloud:update-progress", serde_json::json!({
            "chunkLength": chunk_length, "contentLength": content_length
        }));
    }, || {}).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "no update is currently available".to_string())?;

    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = progress_app.emit(
                    "opencloud:update-progress",
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length
                    }),
                );
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn probe_provider(url: String) -> Result<ProviderProbe, String> {
    let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || !is_provider_host(parsed.host_str()) {
        return Err("provider health probe URL is outside the allowlist".into());
    }

    let client = provider_health_client()?;
    let started = Instant::now();
    let response = client
        .get(parsed)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await;
    let latency_ms = started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    Ok(match response {
        Ok(response) => {
            let status = response.status().as_u16();
            ProviderProbe {
                reachable: status < 500,
                latency_ms,
                status: Some(status),
            }
        }
        Err(error) => {
            log::warn!("provider health probe failed: {error}");
            ProviderProbe {
                reachable: false,
                latency_ms,
                status: None,
            }
        }
    })
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
fn set_player_fullscreen(window: tauri::WebviewWindow, fullscreen: bool) -> Result<bool, String> {
    window
        .set_simple_fullscreen(fullscreen)
        .map_err(|error| error.to_string())?;
    Ok(fullscreen)
}

fn ensure_parent(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    let linux_arm64_renderer = configure_linux_arm64_webkit();

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Debug)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_public_config,
            get_blocker_state,
            set_blocker_policy,
            set_blocker_activity,
            record_blocked_event,
            load_legacy_migration,
            complete_legacy_migration,
            open_external,
            check_for_updates,
            install_update,
            list_past_versions,
            downgrade_version,
            probe_provider,
            restart_app,
            set_player_fullscreen
        ])
        .setup(move |app| {
            let config_dir = app.path().app_config_dir()?;
            let blocker_path = config_dir.join("blocker-state.json");
            ensure_parent(&blocker_path)?;

            let blocker = Arc::new(BlockerService::load(blocker_path));
            app.manage(blocker.clone());
            app.manage(MigrationState::default());

            let blocker_for_window = blocker.clone();
            let event_app = app.handle().clone();

            let main_window_builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Open Cloud")
                    .inner_size(1480.0, 920.0);

            #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
            let main_window_builder = main_window_builder.min_inner_size(320.0, 568.0);

            #[cfg(not(all(target_os = "linux", target_arch = "aarch64")))]
            let main_window_builder = main_window_builder.min_inner_size(1024.0, 640.0);

            let _main_window = main_window_builder
                .background_color(tauri::webview::Color(0, 0, 0, 255))
                // HTTPS custom origins apply on Windows/Android only. macOS and
                // Linux retain custom schemes, which can leave document.referrer
                // empty in embeds. This is not a cross-platform referrer fix.
                .use_https_scheme(true)
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                .visible(false)
                .initialization_script_for_all_frames(BLOCKER_INIT_SCRIPT)
                .on_navigation(|url| {
                    let allowed = is_allowed_navigation(url);
                    if !allowed {
                        log::warn!("blocked navigation to {url}");
                    }
                    allowed
                })
                .on_new_window(move |url, _features| {
                    if blocker_for_window.should_block_new_window(&url) {
                        let entry = blocker_for_window.record(
                            url.to_string(),
                            "native-webview",
                            "native new-window request blocked",
                        );
                        let _ = event_app.emit("opencloud:blocker-event", &entry);
                        NewWindowResponse::Deny
                    } else {
                        NewWindowResponse::Allow
                    }
                })
                .on_page_load(|window, payload| {
                    if payload.event() == PageLoadEvent::Finished && is_app_url(payload.url()) {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build()?;

            #[cfg(target_os = "linux")]
            let _ = _main_window.maximize();

            #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
            log::info!("Linux ARM64 WebKit renderer profile: {linux_arm64_renderer:?}");

            log::info!("Open Cloud Tauri shell initialized");
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running Open Cloud");
}

#[cfg(test)]
mod tests {
    #[test]
    fn downgrade_tags_cannot_escape_official_release_paths() {
        for tag in ["v3.9.16", "v2.2.11"] {
            assert!(super::valid_release_tag(tag));
        }
        for tag in ["../latest", "v3.9.16/evil", "v3.9.16?x=1", "https://evil.test", "v3..1", "v3.9.16-beta"] {
            assert!(!super::valid_release_tag(tag));
        }
    }

    use super::*;

    fn test_service(name: &str) -> BlockerService {
        let path = std::env::temp_dir().join(format!(
            "opencloud-{name}-{}-blocker.json",
            std::process::id()
        ));
        let _ = fs::remove_file(&path);
        BlockerService::load(path)
    }

    #[test]
    fn default_policy_blocks_new_windows() {
        let service = test_service("default");
        let url = Url::parse("https://ads.example.invalid/popup").unwrap();
        assert!(service.should_block_new_window(&url));
    }

    #[test]
    fn disabled_policy_allows_new_windows() {
        let service = test_service("disabled");
        service
            .set_policy(BlockerPolicy {
                enabled: false,
                ..BlockerPolicy::default()
            })
            .unwrap();
        let url = Url::parse("https://ads.example.invalid/popup").unwrap();
        assert!(!service.should_block_new_window(&url));
    }

    #[test]
    fn self_pages_can_be_allowed_without_allowing_ads() {
        let service = test_service("self-pages");
        service
            .set_policy(BlockerPolicy {
                allow_self_pages: true,
                ..BlockerPolicy::default()
            })
            .unwrap();
        assert!(
            !service.should_block_new_window(&Url::parse("tauri://localhost/settings").unwrap())
        );
        assert!(
            service.should_block_new_window(&Url::parse("https://ads.example.invalid/").unwrap())
        );
    }

    #[test]
    fn navigation_allowlist_includes_verified_provider_redirect() {
        assert!(is_allowed_navigation(
            &Url::parse("https://player.videasy.to/tv/4194/1/1").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("https://ads.example.invalid/redirect").unwrap()
        ));
    }

    #[test]
    fn provider_probe_allowlist_rejects_arbitrary_hosts() {
        assert!(is_provider_host(Some("player.videasy.net")));
        assert!(is_provider_host(Some("vsembed.ru")));
        assert!(is_provider_host(Some("cloudorchestranova.com")));
        assert!(is_provider_host(Some("vidphantom.com")));
        assert!(is_provider_host(Some("www.vidcore.org")));
        assert!(is_provider_host(Some("embdmstrplayer.com")));
        assert!(is_provider_host(Some("vidsrc.sh")));
        assert!(is_provider_host(Some("vidfast.vc")));
        assert!(is_provider_host(Some("cdn.vidspark.to")));
        assert!(is_provider_host(Some("player.moviesapi.vip")));
        assert!(is_provider_host(Some("cinesrc.st")));
        assert!(is_provider_host(Some("a.cineflix.st")));
        assert!(is_provider_host(Some("fembox.aether.bar")));
        assert!(is_provider_host(Some("play.xpass.top")));
        assert!(is_provider_host(Some("1414.hexa.su")));
        assert!(is_provider_host(Some("ji1pfnerysxkina0.fstream.app")));
        assert!(!is_provider_host(Some("ads.example.invalid")));
        assert!(!is_provider_host(Some("videasy.net.ads.example.invalid")));
    }

    #[test]
    fn oneplus_6_device_tree_selects_compatible_renderer() {
        assert!(is_oneplus_sdm845_device(
            "qcom,sdm845 oneplus,enchilada OnePlus 6"
        ));
        assert_eq!(
            select_linux_webkit_renderer(None, true),
            LinuxWebkitRenderer::Compatible
        );
    }

    #[test]
    fn renderer_override_is_respected() {
        assert_eq!(
            select_linux_webkit_renderer(Some("dmabuf"), true),
            LinuxWebkitRenderer::Accelerated
        );
        assert_eq!(
            select_linux_webkit_renderer(Some("software"), false),
            LinuxWebkitRenderer::Software
        );
    }

    #[test]
    fn unknown_arm_device_keeps_acceleration() {
        assert!(!is_oneplus_sdm845_device("generic,arm64-server"));
        assert_eq!(
            select_linux_webkit_renderer(None, false),
            LinuxWebkitRenderer::Accelerated
        );
    }
}
