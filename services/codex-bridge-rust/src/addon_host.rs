use crate::embedded::{self, AssetKind};
use crate::layout;
use crate::service_control::{
    check_services, detect_context, run_bridge_watchdog, start_services, stop_services,
};
use anyhow::{bail, Result};
use axum::{
    extract::{Path, State},
    http::{header, HeaderValue, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
    Json as AxumJson, Router,
};
use serde::Serialize;
use serde_json::json;
use std::{
    env, fs,
    path::{Component, Path as FsPath, PathBuf},
};
use tokio::net::TcpListener;

#[derive(Clone)]
struct AddonHostState {
    addin_root: PathBuf,
    panel_root: PathBuf,
    panel_url: String,
    logs_dir: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceActionResponse {
    ok: bool,
    action: String,
    log_dir: String,
    output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

const HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 3889;
const PANEL_URL_PREFIX: &str = "/panel";

pub async fn run() -> Result<()> {
    let port = env::var("WPS_ADDON_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_PORT);
    let layout = layout::detect_layout();
    let addin_root = layout.addin_root.clone();
    if !addin_root.is_dir() && !embedded::has_assets(AssetKind::Addin) {
        bail!(
            "WPS add-in 资源目录不存在：{}（{}）",
            addin_root.display(),
            layout.describe()
        );
    }
    let panel_root = layout.panel_root.clone();
    let panel_url = format!("http://{}:{}{}/index.html", HOST, port, PANEL_URL_PREFIX);
    let logs_dir = layout.logs_dir.clone();
    fs::create_dir_all(&logs_dir)?;

    if !panel_root.is_dir() && !embedded::has_assets(AssetKind::Panel) {
        eprintln!(
            "[wps-addon-host] WPS panel build not found at {} - run `npm run panel:build` to serve it at {}",
            panel_root.display(),
            panel_url
        );
    }

    let state = AddonHostState {
        addin_root,
        panel_root,
        panel_url: panel_url.clone(),
        logs_dir,
    };

    let app = Router::new()
        .route("/__codex/service/{action}", any(handle_service_action))
        .fallback(any(handle_static))
        .with_state(state.clone());

    let listener = TcpListener::bind((HOST, port)).await?;
    println!(
        "wps-addon-host listening on http://{}:{} ({}, addin={}, panel={})",
        HOST,
        port,
        layout.describe(),
        state.addin_root.display(),
        panel_url
    );

    // 宿主进程常驻，顺带看护 bridge：掉线且非用户主动停止时自动拉起。
    tokio::spawn(run_bridge_watchdog());

    axum::serve(listener, app).await?;
    Ok(())
}

/// Maps a request path to the asset source it belongs to.
///
/// `/panel` and `/panel/...` are served from the WPS panel build, everything
/// else from the WPS add-in directory.
fn asset_target<'a>(
    url_path: &'a str,
    addin_root: &'a FsPath,
    panel_root: &'a FsPath,
) -> (AssetKind, &'a FsPath, &'a str) {
    match url_path.strip_prefix(PANEL_URL_PREFIX) {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => {
            (AssetKind::Panel, panel_root, rest)
        }
        _ => (AssetKind::Addin, addin_root, url_path),
    }
}

/// 把 URL 路径整理成安全的相对路径：拦截 `..`、绝对路径与盘符。
fn normalize_relative(url_path: &str) -> Option<String> {
    let trimmed = url_path.trim_start_matches('/');
    let mut parts: Vec<&str> = Vec::new();
    for component in FsPath::new(trimmed).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_str()?),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if parts.is_empty() {
        // 空路径与 `/panel/` 都落到该来源的首页。
        return Some("index.html".to_string());
    }
    Some(parts.join("/"))
}

/// 磁盘上的资源文件；找不到原文件时回退到该来源的 `index.html`。
fn disk_asset(root: &FsPath, relative: &str) -> Option<PathBuf> {
    let primary = root.join(relative);
    if primary.is_file() {
        return Some(primary);
    }
    let fallback = root.join("index.html");
    fallback.is_file().then_some(fallback)
}

/// 读取静态资源：磁盘优先（开发时改完刷新即可生效），内嵌兜底（单文件分发）。
fn load_asset(kind: AssetKind, root: &FsPath, relative: &str) -> Option<(Vec<u8>, &'static str)> {
    if let Some(path) = disk_asset(root, relative) {
        match fs::read(&path) {
            Ok(data) => return Some((data, mime_type_for(&path))),
            Err(error) => eprintln!(
                "[wps-addon-host] 读取静态资源失败 {}: {error}",
                path.display()
            ),
        }
    }

    if let Some(bytes) = embedded::lookup(kind, relative) {
        return Some((bytes.to_vec(), mime_type_for(FsPath::new(relative))));
    }
    if relative != "index.html" {
        if let Some(bytes) = embedded::lookup(kind, "index.html") {
            return Some((bytes.to_vec(), "text/html; charset=utf-8"));
        }
    }
    None
}

fn mime_type_for(path: &FsPath) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "map" => "application/json; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn service_response(status: StatusCode, payload: ServiceActionResponse) -> Response {
    let mut response = (status, AxumJson(payload)).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
}

fn json_error(status: StatusCode, message: impl Into<String>) -> Response {
    let mut response = (
        status,
        AxumJson(json!({
            "ok": false,
            "error": message.into(),
        })),
    )
        .into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    response
}


async fn handle_service_action(
    State(state): State<AddonHostState>,
    method: Method,
    Path(action): Path<String>,
) -> Response {
    if action == "ping" {
        return service_response(
            StatusCode::OK,
            ServiceActionResponse {
                ok: true,
                action,
                log_dir: state.logs_dir.to_string_lossy().to_string(),
                output: "pong".to_string(),
                error: None,
            },
        );
    }

    if action == "panel-url" {
        return service_response(
            StatusCode::OK,
            ServiceActionResponse {
                ok: true,
                action,
                log_dir: state.logs_dir.to_string_lossy().to_string(),
                output: state.panel_url.clone(),
                error: None,
            },
        );
    }

    if method != Method::POST {
        return json_error(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed");
    }

    if !matches!(action.as_str(), "start" | "stop" | "check") {
        let action_name = action.clone();
        return service_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ServiceActionResponse {
                ok: false,
                action,
                log_dir: state.logs_dir.to_string_lossy().to_string(),
                output: String::new(),
                error: Some(format!("Script not found for action: {}", action_name)),
            },
        )
    }

    let context = match detect_context() {
        Ok(context) => context,
        Err(error) => {
            return service_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                ServiceActionResponse {
                    ok: false,
                    action,
                    log_dir: state.logs_dir.to_string_lossy().to_string(),
                    output: String::new(),
                    error: Some(error.to_string()),
                },
            );
        }
    };

    let result = match action.as_str() {
        "start" => start_services(&context, false).await,
        "stop" => stop_services(&context).await,
        "check" => check_services(&context).await,
        _ => unreachable!(),
    };

    match result {
        Ok(output) => service_response(
            StatusCode::OK,
            ServiceActionResponse {
                ok: true,
                action,
                log_dir: state.logs_dir.to_string_lossy().to_string(),
                output,
                error: None,
            },
        ),
        Err(error) => service_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            ServiceActionResponse {
                ok: false,
                action,
                log_dir: state.logs_dir.to_string_lossy().to_string(),
                output: error.output,
                error: Some(error.message),
            },
        ),
    }
}

async fn handle_static(State(state): State<AddonHostState>, uri: Uri) -> Response {
    let (kind, root, url_path) = asset_target(uri.path(), &state.addin_root, &state.panel_root);
    let Some(relative) = normalize_relative(url_path) else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };
    let Some((file_data, mime_type)) = load_asset(kind, root, &relative) else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(mime_type)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("no-store, max-age=0"),
            ),
        ],
        file_data,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_relative_blocks_parent_segments() {
        assert_eq!(
            normalize_relative("/js/main.js").as_deref(),
            Some("js/main.js")
        );
        assert_eq!(normalize_relative("").as_deref(), Some("index.html"));
        assert_eq!(normalize_relative("/").as_deref(), Some("index.html"));
        assert!(normalize_relative("/../secret.txt").is_none());
        assert!(normalize_relative("/C:/windows/win.ini").is_none());
    }

    #[test]
    fn mime_type_matches_expected_extensions() {
        assert_eq!(
            mime_type_for(FsPath::new("index.html")),
            "text/html; charset=utf-8"
        );
        assert_eq!(mime_type_for(FsPath::new("main.js")), "application/javascript; charset=utf-8");
        assert_eq!(mime_type_for(FsPath::new("logo.svg")), "image/svg+xml");
    }

    #[test]
    fn panel_prefix_routes_to_panel_root() {
        let addin = FsPath::new("E:/tmp/addin");
        let panel = FsPath::new("E:/tmp/panel");

        assert_eq!(
            asset_target("/panel/index.html", addin, panel),
            (AssetKind::Panel, panel, "/index.html")
        );
        assert_eq!(
            asset_target("/panel", addin, panel),
            (AssetKind::Panel, panel, "")
        );
        assert_eq!(
            asset_target("/panel/assets/index-abc.js", addin, panel),
            (AssetKind::Panel, panel, "/assets/index-abc.js")
        );
        assert_eq!(
            asset_target("/js/ribbon.js", addin, panel),
            (AssetKind::Addin, addin, "/js/ribbon.js")
        );
        assert_eq!(
            asset_target("/", addin, panel),
            (AssetKind::Addin, addin, "/")
        );
        assert_eq!(
            asset_target("/panelfoo", addin, panel),
            (AssetKind::Addin, addin, "/panelfoo")
        );
    }
}
