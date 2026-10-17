use crate::protocol::{
    run_delta_payload, run_event_payload, run_stderr_payload, CodexChatMode, CodexStreamEvent,
};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStderr, ChildStdout, Command},
    sync::{mpsc::UnboundedSender, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct RunOptions {
    pub cli_path: String,
    pub prompt: String,
    pub working_dir: PathBuf,
    pub model: Option<String>,
    pub thread_id: Option<String>,
    pub mode: Option<CodexChatMode>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct RunState {
    output: String,
    thread_id: Option<String>,
    events: Vec<CodexStreamEvent>,
    stderr: String,
    has_delta_output: bool,
}

#[derive(Debug, Clone)]
pub struct RunOutcome {
    pub output: String,
    pub thread_id: Option<String>,
    pub events: Vec<CodexStreamEvent>,
}

fn assistant_text_from_event(event: &Value) -> String {
    let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
    let item = event.get("item");

    if matches!(event_type, "item.delta" | "item.completed") {
        if let Some(item) = item {
            let item_type = item
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            if matches!(item_type.as_str(), "assistant_message" | "agent_message") {
                return item
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
            }
        }
    }

    if let Some(delta) = event.get("delta").and_then(Value::as_str) {
        return delta.to_string();
    }

    if let Some(text) = event.get("text").and_then(Value::as_str) {
        return text.to_string();
    }

    String::new()
}

fn build_codex_args(options: &RunOptions) -> Vec<String> {
    let mut args = vec!["exec".to_string(), "--json".to_string(), "-C".to_string(), options.working_dir.to_string_lossy().to_string()];
    if let Some(model) = options.model.as_ref().map(|item| item.trim()).filter(|item| !item.is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if let Some(reasoning_effort) = options
        .reasoning_effort
        .as_ref()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
    {
        args.push("-c".to_string());
        args.push(format!(r#"model_reasoning_effort="{reasoning_effort}""#));
    }
    match options.mode {
        Some(CodexChatMode::Ask) => {
            args.push("--sandbox".to_string());
            args.push("read-only".to_string());
        }
        Some(CodexChatMode::Agent) => {
            args.push("--sandbox".to_string());
            args.push("workspace-write".to_string());
        }
        None => {}
    }
    if let Some(thread_id) = options
        .thread_id
        .as_ref()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
    {
        args.push("resume".to_string());
        args.push(thread_id.to_string());
        args.push("-".to_string());
    } else {
        args.push("-".to_string());
    }
    args
}

#[cfg(windows)]
fn spawn_command(cli_path: &str, args: &[String]) -> Command {
    let mut command = if cli_path.to_lowercase().ends_with(".cmd") || cli_path.to_lowercase().ends_with(".bat") {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C");
        cmd.arg(cli_path);
        cmd
    } else {
        Command::new(cli_path)
    };
    for arg in args {
        command.arg(arg);
    }
    if std::env::var("RUST_LOG").map(|value| value.trim().is_empty()).unwrap_or(true) {
        command.env("RUST_LOG", "warn");
    }
    command
}

#[cfg(not(windows))]
fn spawn_command(cli_path: &str, args: &[String]) -> Command {
    let mut command = Command::new(cli_path);
    for arg in args {
        command.arg(arg);
    }
    if std::env::var("RUST_LOG").map(|value| value.trim().is_empty()).unwrap_or(true) {
        command.env("RUST_LOG", "warn");
    }
    command
}

async fn consume_stdout(
    stdout: ChildStdout,
    state: std::sync::Arc<Mutex<RunState>>,
    sink: Option<UnboundedSender<Value>>,
) -> Result<()> {
    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await? {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parsed = serde_json::from_str::<Value>(trimmed);
        match parsed {
            Ok(event) => {
                let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
                let text = assistant_text_from_event(&event);
                {
                    let mut guard = state.lock().await;
                    guard.events.push(event.clone());
                    if event_type == "thread.started" {
                        if let Some(thread_id) = event.get("thread_id").and_then(Value::as_str) {
                            guard.thread_id = Some(thread_id.to_string());
                        }
                    }
                    if !text.is_empty() {
                        if event_type == "item.delta" {
                            guard.has_delta_output = true;
                            guard.output.push_str(&text);
                        } else if !guard.has_delta_output {
                            guard.output.push_str(&text);
                        }
                    }
                }

                if let Some(sender) = sink.as_ref() {
                    let _ = sender.send(run_event_payload(event.clone()));
                    if !text.is_empty() {
                        let _ = sender.send(run_delta_payload(text));
                    }
                }
            }
            Err(_) => {
                let raw_event = json!({
                    "type": "stdout.raw",
                    "text": trimmed,
                });
                {
                    let mut guard = state.lock().await;
                    guard.events.push(raw_event.clone());
                }
                if let Some(sender) = sink.as_ref() {
                    let _ = sender.send(run_event_payload(raw_event));
                }
            }
        }
    }
    Ok(())
}

async fn consume_stderr(
    stderr: ChildStderr,
    state: std::sync::Arc<Mutex<RunState>>,
    sink: Option<UnboundedSender<Value>>,
) -> Result<()> {
    let mut lines = BufReader::new(stderr).lines();
    while let Some(line) = lines.next_line().await? {
        {
            let mut guard = state.lock().await;
            if !guard.stderr.is_empty() {
                guard.stderr.push('\n');
            }
            guard.stderr.push_str(&line);
        }
        if let Some(sender) = sink.as_ref() {
            if !line.trim().is_empty() {
                let _ = sender.send(run_stderr_payload(line));
            }
        }
    }
    Ok(())
}

pub async fn run_codex_with_sink(
    options: RunOptions,
    sink: Option<UnboundedSender<Value>>,
    cancel_token: CancellationToken,
) -> Result<RunOutcome> {
    let args = build_codex_args(&options);
    let mut command = spawn_command(&options.cli_path, &args);
    command
        .current_dir(&options.working_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .with_context(|| format!("无法启动 Codex CLI：{}", options.cli_path))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Codex stdin unavailable"))?;
    stdin
        .write_all(options.prompt.as_bytes())
        .await
        .context("写入 Codex stdin 失败")?;
    stdin.write_all(b"\n").await.ok();
    stdin.shutdown().await.ok();

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("Codex stdout unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("Codex stderr unavailable"))?;

    let state = std::sync::Arc::new(Mutex::new(RunState {
        thread_id: options.thread_id.clone(),
        ..RunState::default()
    }));

    let stdout_state = state.clone();
    let stdout_sink = sink.clone();
    let stdout_task = tokio::spawn(async move { consume_stdout(stdout, stdout_state, stdout_sink).await });

    let stderr_state = state.clone();
    let stderr_sink = sink.clone();
    let stderr_task = tokio::spawn(async move { consume_stderr(stderr, stderr_state, stderr_sink).await });

    enum ExitState {
        Completed(std::process::ExitStatus),
        Aborted,
    }

    let exit_state = tokio::select! {
        _ = cancel_token.cancelled() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            ExitState::Aborted
        }
        result = child.wait() => {
            ExitState::Completed(result.context("等待 Codex 进程结束失败")?)
        }
    };

    stdout_task.await.context("读取 Codex stdout 任务失败")??;
    stderr_task.await.context("读取 Codex stderr 任务失败")??;

    let snapshot = state.lock().await.clone();

    match exit_state {
        ExitState::Aborted => bail!("Codex 执行已停止。"),
        ExitState::Completed(status) => {
            if status.success() {
                Ok(RunOutcome {
                    output: snapshot.output.trim().to_string(),
                    thread_id: snapshot.thread_id,
                    events: snapshot.events,
                })
            } else {
                let stderr = snapshot.stderr.trim();
                if stderr.is_empty() {
                    bail!("codex exited with code {}", status.code().unwrap_or(-1));
                }
                bail!("{}", stderr);
            }
        }
    }
}

pub async fn run_codex(options: RunOptions) -> Result<RunOutcome> {
    run_codex_with_sink(options, None, CancellationToken::new()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::CodexChatMode;

    #[test]
    fn build_codex_args_handles_modes_and_effort() {
        let options = RunOptions {
            cli_path: "codex".to_string(),
            prompt: "hello".to_string(),
            working_dir: PathBuf::from("E:/work"),
            model: Some("gpt-5.4".to_string()),
            thread_id: Some("thread-123".to_string()),
            mode: Some(CodexChatMode::Agent),
            reasoning_effort: Some("high".to_string()),
        };

        let args = build_codex_args(&options);
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"gpt-5.4".to_string()));
        assert!(args.contains(&"--sandbox".to_string()));
        assert!(args.contains(&"workspace-write".to_string()));
        assert!(args.contains(&"resume".to_string()));
        assert!(args.contains(&"thread-123".to_string()));
        assert!(args.contains(&"-".to_string()));
    }

    #[test]
    fn assistant_text_from_event_prefers_item_and_delta() {
        let event = json!({
            "type": "item.delta",
            "item": {
                "type": "assistant_message",
                "text": "你好"
            }
        });
        assert_eq!(assistant_text_from_event(&event), "你好");

        let event = json!({
            "type": "some.event",
            "delta": "世界"
        });
        assert_eq!(assistant_text_from_event(&event), "世界");
    }
}
