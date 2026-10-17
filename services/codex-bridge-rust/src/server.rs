use crate::{
    assets::{save_uploaded_file, save_uploaded_image},
    codex_runner::{run_codex, run_codex_with_sink, RunOptions},
    config::{
        build_prompt, bridge_config_response, load_runtime_config, models_response, save_runtime_config,
        RuntimeConfig,
    },
    diff_popup::{
        diff_popup_html, diff_popup_version, expired_page_html, open_diff_popup, DiffPopupStore,
    },
    protocol::{
        run_aborted_payload, run_completed_payload, run_error_payload, run_started_payload, BridgeConfigUpdateRequest,
        CodexRunRequest, CodexRunResponse, DiffPopupOpenRequest, FileUploadRequest, HealthResponse, ImageUploadRequest,
        IllustrationRequest, IllustrationResponse, RunCancelRequest, RunCancelResponse,
    },
};
use anyhow::Result;
use axum::{
    extract::{Json, Path, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    response::{IntoResponse, Response, Sse},
    routing::{get, post},
    Json as AxumJson, Router,
};
use async_stream::stream;
use serde_json::json;
use std::{
    collections::HashMap,
    convert::Infallible,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tokio::{
    net::TcpListener,
    sync::{mpsc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct AppState {
    pub bind_host: String,
    pub bind_port: u16,
    pub active_runs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    pub diff_popups: Arc<Mutex<DiffPopupStore>>,
}

impl AppState {
    fn new(bind_host: String, bind_port: u16) -> Self {
        Self {
            bind_host,
            bind_port,
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            diff_popups: Arc::new(Mutex::new(DiffPopupStore::default())),
        }
    }
}

#[derive(Debug, Clone)]
struct StreamAbortGuard {
    cancel: CancellationToken,
    completed: Arc<AtomicBool>,
}

impl Drop for StreamAbortGuard {
    fn drop(&mut self) {
        if !self.completed.load(Ordering::SeqCst) {
            self.cancel.cancel();
        }
    }
}

fn to_option_string(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn build_run_options(runtime: &RuntimeConfig, request: &CodexRunRequest) -> RunOptions {
    RunOptions {
        cli_path: runtime.cli_path.clone(),
        prompt: build_prompt(request),
        working_dir: runtime.working_dir.clone(),
        model: to_option_string(request.model.clone()),
        thread_id: to_option_string(request.thread_id.clone()),
        mode: request.mode.clone(),
        reasoning_effort: to_option_string(request.reasoning_effort.clone()),
    }
}

fn json_error(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        AxumJson(json!({
            "ok": false,
            "error": message.into(),
        })),
    )
        .into_response()
}

fn html_response(body: String) -> Response {
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8")),
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store, max-age=0")),
        ],
        body,
    )
        .into_response()
}

pub async fn run() -> Result<()> {
    let runtime = load_runtime_config();
    let state = AppState::new(runtime.host.clone(), runtime.port);

    let app = Router::new()
        .route("/health", get(handle_health))
        .route("/config", get(handle_config_get).post(handle_config_post))
        .route("/models", get(handle_models))
        .route("/run", post(handle_run))
        .route("/run/stream", post(handle_run_stream))
        .route("/run/cancel", post(handle_run_cancel))
        .route("/asset/illustration", post(handle_illustration))
        .route("/asset/upload-image", post(handle_upload_image))
        .route("/asset/upload-file", post(handle_upload_file))
        .route("/diff-popup/open", post(handle_diff_popup_open))
        .route("/diff-popup/version/{token}", get(handle_diff_popup_version))
        .route("/diff-popup/{token}", get(handle_diff_popup_view))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive());

    let listener = TcpListener::bind((runtime.host.as_str(), runtime.port)).await?;
    println!(
        "codex-bridge listening on http://{}:{} (workingDir={})",
        runtime.host,
        runtime.port,
        runtime.working_dir.display()
    );

    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_health() -> impl IntoResponse {
    let runtime = load_runtime_config();
    AxumJson(HealthResponse {
        ok: true,
        service: "codex-bridge".to_string(),
        host: runtime.host,
        port: runtime.port,
        working_dir: runtime.working_dir.to_string_lossy().to_string(),
    })
}

async fn handle_config_get() -> impl IntoResponse {
    AxumJson(bridge_config_response())
}

async fn handle_config_post(Json(payload): Json<BridgeConfigUpdateRequest>) -> Response {
    match save_runtime_config(&payload) {
        Ok(response) => AxumJson(response).into_response(),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_models() -> impl IntoResponse {
    AxumJson(models_response())
}

async fn handle_run(Json(request): Json<CodexRunRequest>) -> Response {
    let runtime = load_runtime_config();
    let options = build_run_options(&runtime, &request);
    match run_codex(options).await {
        Ok(outcome) => AxumJson(CodexRunResponse {
            ok: true,
            output: outcome.output,
            thread_id: outcome.thread_id,
            events: Some(outcome.events),
            error: None,
        })
        .into_response(),
        Err(error) => AxumJson(CodexRunResponse {
            ok: false,
            output: String::new(),
            thread_id: None,
            events: None,
            error: Some(error.to_string()),
        })
        .into_response(),
    }
}

async fn handle_run_stream(
    State(state): State<AppState>,
    Json(request): Json<CodexRunRequest>,
) -> Response {
    let runtime = load_runtime_config();
    let options = build_run_options(&runtime, &request);
    let run_id = format!("{}-{}", chrono_like_now(), uuid::Uuid::new_v4().to_string().replace('-', ""));
    let cancel_token = CancellationToken::new();
    {
        let mut active_runs = state.active_runs.lock().await;
        active_runs.insert(run_id.clone(), cancel_token.clone());
    }

    let (tx, mut rx) = mpsc::unbounded_channel();
    let _ = tx.send(run_started_payload(run_id.clone()));
    let completed = Arc::new(AtomicBool::new(false));
    let stream_cancel = cancel_token.clone();
    let stream_completed = completed.clone();
    let stream = stream! {
        let _guard = StreamAbortGuard {
            cancel: stream_cancel,
            completed: stream_completed,
        };
        while let Some(payload) = rx.recv().await {
            yield Ok::<_, Infallible>(
                axum::response::sse::Event::default()
                    .json_data(payload)
                    .expect("SSE JSON serialization failed"),
            );
        }
    };

    let state_for_task = state.clone();
    let tx_for_task = tx.clone();
    let run_id_for_task = run_id.clone();
    tokio::spawn(async move {
        let result = run_codex_with_sink(options, Some(tx_for_task.clone()), cancel_token.clone()).await;
        completed.store(true, Ordering::SeqCst);

        match result {
            Ok(outcome) => {
                let _ = tx_for_task.send(run_completed_payload(outcome.output, outcome.thread_id));
            }
            Err(error) => {
                let message = error.to_string();
                if cancel_token.is_cancelled() || message.contains("已停止") {
                    let _ = tx_for_task.send(run_aborted_payload(run_id_for_task.clone(), message));
                } else {
                    let _ = tx_for_task.send(run_error_payload(run_id_for_task.clone(), message));
                }
            }
        }

        state_for_task
            .active_runs
            .lock()
            .await
            .remove(&run_id_for_task);
    });

    let mut response = Sse::new(stream).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
    response
        .headers_mut()
        .insert(HeaderName::from_static("x-accel-buffering"), HeaderValue::from_static("no"));
    response
}

async fn handle_run_cancel(
    State(state): State<AppState>,
    Json(payload): Json<RunCancelRequest>,
) -> Response {
    let run_id = payload.run_id.trim().to_string();
    if run_id.is_empty() {
        return AxumJson(RunCancelResponse {
            ok: false,
            run_id: None,
            error: Some("runId is required".to_string()),
        })
        .into_response();
    }

    let token = {
        let active_runs = state.active_runs.lock().await;
        active_runs.get(&run_id).cloned()
    };

    match token {
        Some(token) => {
            token.cancel();
            AxumJson(RunCancelResponse {
                ok: true,
                run_id: Some(run_id),
                error: None,
            })
            .into_response()
        }
        None => json_error(StatusCode::NOT_FOUND, "run not found"),
    }
}

async fn handle_illustration(Json(payload): Json<IllustrationRequest>) -> Response {
    match crate::assets::create_illustration_file(&payload) {
        Ok(path) => AxumJson(IllustrationResponse {
            ok: true,
            path: path.to_string_lossy().to_string(),
            error: None,
        })
        .into_response(),
        Err(error) => AxumJson(IllustrationResponse {
            ok: false,
            path: String::new(),
            error: Some(error.to_string()),
        })
        .into_response(),
    }
}

async fn handle_upload_image(Json(payload): Json<ImageUploadRequest>) -> Response {
    match save_uploaded_image(&payload) {
        Ok(response) => AxumJson(response).into_response(),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_upload_file(Json(payload): Json<FileUploadRequest>) -> Response {
    match save_uploaded_file(&payload) {
        Ok(response) => AxumJson(response).into_response(),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_diff_popup_open(
    State(state): State<AppState>,
    Json(payload): Json<DiffPopupOpenRequest>,
) -> Response {
    match open_diff_popup(&state.diff_popups, &state.bind_host, state.bind_port, payload).await {
        Ok(response) => AxumJson(response).into_response(),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    }
}

async fn handle_diff_popup_version(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    AxumJson(diff_popup_version(&state.diff_popups, &token).await)
}

async fn handle_diff_popup_view(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> Response {
    match diff_popup_html(&state.diff_popups, &token).await {
        Some(html) => html_response(html),
        None => html_response(expired_page_html()),
    }
}

fn chrono_like_now() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}
