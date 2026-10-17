use crate::layout;
use crate::service_control::{check_services, detect_context, start_services, stop_services};
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
    if !addin_root.is_dir() {
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

    if !panel_root.is_dir() {
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
    axum::serve(listener, app).await?;
    Ok(())
}

/// Maps a request path to the asset root that serves it.
///
/// `/panel` and `/panel/...` are served from the WPS panel build, everything
/// else from the WPS add-in directory.
fn asset_root_and_relative<'a>(
    url_path: &'a str,
    addin_root: &'a FsPath,
    panel_root: &'a FsPath,
) -> (&'a FsPath, &'a str) {
    match url_path.strip_prefix(PANEL_URL_PREFIX) {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => (panel_root, rest),
        _ => (addin_root, url_path),
    }
}

fn safe_path_from_url(addin_root: &FsPath, url_path: &str) -> Option<PathBuf> {
    let trimmed = url_path.trim_start_matches('/');
    let relative = if trimmed.is_empty() {
        FsPath::new("index.html")
    } else {
        FsPath::new(trimmed)
    };
    let mut resolved = addin_root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(resolved)
}

fn resolve_file_path(addin_root: &FsPath, url_path: &str) -> Option<PathBuf> {
    let primary = safe_path_from_url(addin_root, url_path)?;
    if primary.is_file() {
        return Some(primary);
    }
    let fallback = addin_root.join("index.html");
    fallback.is_file().then_some(fallback)
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
    let path = uri.path();
    let (root, relative) = asset_root_and_relative(path, &state.addin_root, &state.panel_root);
    let Some(file_path) = resolve_file_path(root, relative) else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    };

    let file_data = match fs::read(&file_path) {
        Ok(data) => data,
        Err(error) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                error.to_string(),
            )
                .into_response()
        }
    };

    (
        StatusCode::OK,
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static(mime_type_for(&file_path)),
            ),
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
    fn safe_path_blocks_parent_segments() {
        let root = PathBuf::from("E:/tmp/addin");
        assert!(safe_path_from_url(&root, "/js/main.js").is_some());
        assert!(safe_path_from_url(&root, "/../secret.txt").is_none());
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
            asset_root_and_relative("/panel/index.html", addin, panel),
            (panel, "/index.html")
        );
        assert_eq!(
            asset_root_and_relative("/panel", addin, panel),
            (panel, "")
        );
        assert_eq!(
            asset_root_and_relative("/panel/assets/index-abc.js", addin, panel),
            (panel, "/assets/index-abc.js")
        );
        assert_eq!(
            asset_root_and_relative("/js/ribbon.js", addin, panel),
            (addin, "/js/ribbon.js")
        );
        assert_eq!(
            asset_root_and_relative("/", addin, panel),
            (addin, "/")
        );
        assert_eq!(
            asset_root_and_relative("/panelfoo", addin, panel),
            (addin, "/panelfoo")
        );
    }
}
