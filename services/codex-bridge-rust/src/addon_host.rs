use crate::service_control::{
    build_context, check_services, detect_project_root, start_services, stop_services,
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
    project_root: PathBuf,
    addin_root: PathBuf,
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

pub async fn run() -> Result<()> {
    let port = env::var("WPS_ADDON_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_PORT);
    let project_root = detect_project_root()?;
    let addin_root = project_root.join("apps").join("wps-local-addin");
    if !addin_root.is_dir() {
        bail!("WPS add-in root not found: {}", addin_root.display());
    }
    let logs_dir = project_root.join("logs");
    fs::create_dir_all(&logs_dir)?;

    let state = AddonHostState {
        project_root,
        addin_root,
        logs_dir,
    };

    let app = Router::new()
        .route("/__codex/service/{action}", any(handle_service_action))
        .fallback(any(handle_static))
        .with_state(state.clone());

    let listener = TcpListener::bind((HOST, port)).await?;
    println!(
        "wps-addon-host listening on http://{}:{} (root={})",
        HOST,
        port,
        state.addin_root.display()
    );
    axum::serve(listener, app).await?;
    Ok(())
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
    if method != Method::POST {
        return json_error(StatusCode::METHOD_NOT_ALLOWED, "Method Not Allowed");
    }

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

    let context = match build_context(state.project_root.clone()) {
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
    let Some(file_path) = resolve_file_path(&state.addin_root, path) else {
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
}
