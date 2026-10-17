use crate::protocol::{
    BridgeConfigUpdateRequest, CodexBridgeConfig, CodexChatMode, CodexModelsResponse, CodexRunRequest, TaskType,
};
use anyhow::Result;
use std::{
    collections::HashSet,
    env,
    fs,
    io,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub host: String,
    pub port: u16,
    pub cli_path: String,
    pub working_dir: PathBuf,
}

const DEFAULT_MODELS: &[&str] = &["gpt-5.3-codex", "gpt-5.2", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5"];

fn non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|item| {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(item)
        }
    })
}

fn config_path() -> PathBuf {
    if let Some(path) = non_empty(env::var("CODEX_BRIDGE_CONFIG_PATH").ok()) {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("config.local.json")
}

fn home_dir() -> PathBuf {
    if let Some(value) = env::var_os("CODEX_HOME") {
        return PathBuf::from(value);
    }
    if let Some(value) = env::var_os("USERPROFILE") {
        return PathBuf::from(value);
    }
    if let (Some(drive), Some(path)) = (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
        return PathBuf::from(drive).join(path);
    }
    if let Some(value) = env::var_os("HOME") {
        return PathBuf::from(value);
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn clamp_port(value: u32, fallback: u16) -> u16 {
    if value == 0 || value > u16::MAX as u32 {
        fallback
    } else {
        value as u16
    }
}

fn parse_port(value: Option<u32>, fallback: u16) -> u16 {
    value.map(|item| clamp_port(item, fallback)).unwrap_or(fallback)
}

fn resolve_working_dir(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        return path;
    }
    env::current_dir()
        .map(|cwd| cwd.join(path))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn normalize_key(value: &Path) -> String {
    #[cfg(windows)]
    {
        value.to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        value.to_string_lossy().to_string()
    }
}

fn push_unique(result: &mut Vec<PathBuf>, seen: &mut HashSet<String>, candidate: PathBuf) {
    if !candidate.exists() {
        return;
    }
    let key = normalize_key(&candidate);
    if seen.insert(key) {
        result.push(candidate);
    }
}

fn search_command_in_path(command: &str) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut seen = HashSet::new();
    let Some(path_var) = env::var_os("PATH") else {
        return results;
    };

    let mut names = Vec::new();
    #[cfg(windows)]
    {
        if Path::new(command).extension().is_some() {
            names.push(command.to_string());
        } else {
            names.push(format!("{command}.cmd"));
            names.push(format!("{command}.exe"));
            names.push(format!("{command}.bat"));
        }
    }
    #[cfg(not(windows))]
    {
        names.push(command.to_string());
    }

    for dir in env::split_paths(&path_var) {
        for name in &names {
            push_unique(&mut results, &mut seen, dir.join(name));
        }
    }

    #[cfg(windows)]
    {
        results.sort_by(|a, b| {
            let rank = |path: &PathBuf| {
                match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase().as_str() {
                    "cmd" => 0,
                    "exe" => 1,
                    "bat" => 2,
                    _ => 9,
                }
            };
            rank(a).cmp(&rank(b)).then_with(|| a.cmp(b))
        });
    }

    results
}

pub fn detect_cli_paths() -> Vec<String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();

    if let Some(value) = non_empty(env::var("CODEX_CLI_PATH").ok()) {
        push_unique(&mut result, &mut seen, PathBuf::from(value));
    }

    for candidate in search_command_in_path("codex") {
        push_unique(&mut result, &mut seen, candidate);
    }

    let home = home_dir();
    let fallback_candidates = [
        home.join("AppData").join("Roaming").join("npm").join("codex.cmd"),
        home.join("AppData").join("Local").join("OpenAI").join("Codex").join("bin").join("codex.exe"),
    ];
    for candidate in fallback_candidates {
        push_unique(&mut result, &mut seen, candidate);
    }

    result
        .into_iter()
        .map(|item| item.to_string_lossy().to_string())
        .collect()
}

pub fn resolve_cli_path(input: &str) -> String {
    let value = input.trim();
    if value.is_empty() {
        return String::new();
    }

    let candidate = PathBuf::from(value);
    if candidate.exists() {
        return value.to_string();
    }

    #[cfg(windows)]
    {
        if candidate.extension().is_none() {
            for suffix in [".cmd", ".exe", ".bat"] {
                let next = PathBuf::from(format!("{value}{suffix}"));
                if next.exists() {
                    return next.to_string_lossy().to_string();
                }
            }

            let detected = detect_cli_paths();
            let base_name = candidate
                .file_name()
                .and_then(|item| item.to_str())
                .unwrap_or("")
                .to_lowercase();
            if let Some(matched) = detected.into_iter().find(|item| {
                Path::new(item)
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .unwrap_or("")
                    .to_lowercase()
                    == base_name
            }) {
                return matched;
            }
        }
    }

    value.to_string()
}

fn load_local_config_file() -> BridgeConfigUpdateRequest {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<BridgeConfigUpdateRequest>(&content) {
            Ok(config) => config,
            Err(error) => {
                eprintln!(
                    "[codex-bridge-rust] Failed to parse local config {}: {}",
                    path.display(),
                    error
                );
                BridgeConfigUpdateRequest::default()
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => BridgeConfigUpdateRequest::default(),
        Err(error) => {
            eprintln!(
                "[codex-bridge-rust] Failed to read local config {}: {}",
                path.display(),
                error
            );
            BridgeConfigUpdateRequest::default()
        }
    }
}

pub fn save_local_config_file(config: &BridgeConfigUpdateRequest) -> Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)?;
    fs::write(path, format!("{json}\n"))?;
    Ok(())
}

pub fn load_runtime_config() -> RuntimeConfig {
    let file_config = load_local_config_file();
    let detected = detect_cli_paths();

    let host = non_empty(env::var("CODEX_BRIDGE_HOST").ok())
        .or_else(|| non_empty(file_config.host.clone()))
        .unwrap_or_else(|| "127.0.0.1".to_string());

    let port = if let Ok(value) = env::var("CODEX_BRIDGE_PORT") {
        value
            .parse::<u32>()
            .ok()
            .map(|parsed| clamp_port(parsed, 32123))
            .unwrap_or(32123)
    } else {
        parse_port(file_config.port, 32123)
    };

    let cli_source = non_empty(env::var("CODEX_CLI_PATH").ok())
        .or_else(|| non_empty(file_config.cli_path.clone()))
        .or_else(|| detected.first().cloned())
        .unwrap_or_else(|| "codex".to_string());

    let working_dir = non_empty(env::var("CODEX_WORKING_DIR").ok())
        .or_else(|| non_empty(file_config.working_dir.clone()))
        .map(PathBuf::from)
        .map(resolve_working_dir)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    RuntimeConfig {
        host,
        port,
        cli_path: resolve_cli_path(&cli_source),
        working_dir,
    }
}

fn read_codex_config_toml() -> String {
    let codex_home = non_empty(env::var("CODEX_HOME").ok())
        .map(PathBuf::from)
        .unwrap_or_else(home_dir);
    let config_path = codex_home.join("config.toml");
    match fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            eprintln!(
                "[codex-bridge-rust] Failed to read {}: {}",
                config_path.display(),
                error
            );
            String::new()
        }
    }
}

fn extract_model_value(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let (key, value) = trimmed.split_once('=')?;
    if key.trim() != "model" {
        return None;
    }
    let value = value.trim();
    let quote = value.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let remainder = &value[quote.len_utf8()..];
    let end = remainder.find(quote)?;
    let inner = remainder[..end].trim();
    if inner.is_empty() {
        return None;
    }
    Some(inner.to_string())
}

pub fn list_models() -> (Vec<String>, Option<String>) {
    let toml = read_codex_config_toml();
    let mut models = Vec::new();
    let mut seen = HashSet::new();
    let mut default_model = None;

    for line in toml.lines() {
        if let Some(model) = extract_model_value(line) {
            if default_model.is_none() {
                default_model = Some(model.clone());
            }
            if seen.insert(model.clone()) {
                models.push(model);
            }
        }
    }

    for model in DEFAULT_MODELS {
        if seen.insert((*model).to_string()) {
            models.push((*model).to_string());
        }
    }

    (models, default_model)
}

pub fn bridge_config_response() -> CodexBridgeConfig {
    let runtime = load_runtime_config();
    runtime_config_to_bridge_config(&runtime)
}

fn collect_non_empty_sections(sections: Vec<String>) -> Vec<String> {
    sections.into_iter().filter(|item| !item.is_empty()).collect()
}

pub fn build_prompt(request: &CodexRunRequest) -> String {
    let instruction = request.instruction.as_deref().unwrap_or("").trim().to_string();
    let image_hints = request
        .image_attachments
        .as_ref()
        .filter(|items| !items.is_empty())
        .map(|items| {
            let mut lines = vec![
                String::new(),
                "用户上传了图片附件，请结合图片与文字一起回答：".to_string(),
            ];
            for (index, item) in items.iter().enumerate() {
                lines.push(format!(
                    "[图片{}] {}\n本地路径：{}",
                    index + 1,
                    item.name,
                    item.path
                ));
            }
            lines.join("\n")
        })
        .unwrap_or_default();

    let file_hints = request
        .file_attachments
        .as_ref()
        .filter(|items| !items.is_empty())
        .map(|items| {
            let mut lines = vec![
                String::new(),
                "用户上传了文件附件。需要读取时，请使用下列本地路径：".to_string(),
            ];
            for (index, item) in items.iter().enumerate() {
                lines.push(format!(
                    "[文件{}] {}\n本地路径：{}",
                    index + 1,
                    item.name,
                    item.path
                ));
            }
            lines.join("\n")
        })
        .unwrap_or_default();

    let mut sections = Vec::new();

    match request.task {
        TaskType::Rewrite => {
            sections.push("你是文档改写助手，只输出改写后的正文，不要解释。".to_string());
            if !instruction.is_empty() {
                sections.push(format!("附加要求：{instruction}"));
            }
            sections.push(String::new());
            sections.push("原文：".to_string());
            sections.push(request.content.clone());
        }
        TaskType::Summary => {
            sections.push("请生成中文摘要，3-5条要点，只输出摘要内容。".to_string());
            if !instruction.is_empty() {
                sections.push(format!("附加要求：{instruction}"));
            }
            sections.push(String::new());
            sections.push("内容：".to_string());
            sections.push(request.content.clone());
        }
        TaskType::Chat => {
            if matches!(request.mode, Some(CodexChatMode::Agent)) {
                sections.push("你是 Codex agent。你不能直接操作 WPS 文档；如果用户要求修改、写回或替换当前选区，只输出应写入 Word 的最终正文，不要解释。若用户要求插入图片，图片由面板处理，你只需输出正文或图片说明。".to_string());
            } else {
                sections.push("你是 Codex ask 模式助手。只回答问题，不修改文件。".to_string());
            }
            if !instruction.is_empty() {
                sections.push(format!("文档选区上下文：\n{instruction}"));
            }
            if !image_hints.is_empty() {
                sections.push(image_hints);
            }
            if !file_hints.is_empty() {
                sections.push(file_hints);
            }
            sections.push(String::new());
            sections.push("用户：".to_string());
            sections.push(request.content.clone());
        }
        TaskType::Insert => {
            sections.push("你是写作助手，请根据要求生成可直接插入文档的内容，不要解释。".to_string());
            if !instruction.is_empty() {
                sections.push(format!("写作要求：{instruction}"));
            }
            sections.push(String::new());
            sections.push("上下文：".to_string());
            sections.push(request.content.clone());
        }
    }

    collect_non_empty_sections(sections).join("\n")
}

pub fn runtime_config_to_bridge_config(runtime: &RuntimeConfig) -> CodexBridgeConfig {
    CodexBridgeConfig {
        host: runtime.host.clone(),
        port: runtime.port,
        cli_path: runtime.cli_path.clone(),
        working_dir: runtime.working_dir.to_string_lossy().to_string(),
        detected_cli_paths: detect_cli_paths(),
    }
}

pub fn models_response() -> CodexModelsResponse {
    let (models, default_model) = list_models();
    CodexModelsResponse {
        ok: true,
        models,
        default_model,
        error: None,
    }
}

pub fn save_runtime_config(update: &BridgeConfigUpdateRequest) -> Result<CodexBridgeConfig> {
    let current = load_local_config_file();
    let merged = BridgeConfigUpdateRequest {
        host: update.host.clone().or(current.host),
        port: match update.port {
            Some(port) if port > 0 => Some(port),
            _ => current.port,
        },
        cli_path: update
            .cli_path
            .clone()
            .or(current.cli_path)
            .map(|value| resolve_cli_path(&value)),
        working_dir: update.working_dir.clone().or(current.working_dir),
    };
    save_local_config_file(&merged)?;
    Ok(runtime_config_to_bridge_config(&load_runtime_config()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ChatFileAttachment, ChatImageAttachment, CodexChatMode, CodexRunRequest};

    #[test]
    fn build_prompt_rewrite_includes_instruction_and_source() {
        let request = CodexRunRequest {
            task: TaskType::Rewrite,
            content: "原文内容".to_string(),
            instruction: Some("请更简洁".to_string()),
            thread_id: None,
            model: None,
            mode: None,
            reasoning_effort: None,
            image_attachments: None,
            file_attachments: None,
        };

        let prompt = build_prompt(&request);
        assert!(prompt.contains("你是文档改写助手"));
        assert!(prompt.contains("附加要求：请更简洁"));
        assert!(prompt.contains("原文："));
        assert!(prompt.contains("原文内容"));
    }

    #[test]
    fn build_prompt_chat_includes_attachments() {
        let request = CodexRunRequest {
            task: TaskType::Chat,
            content: "帮我看看".to_string(),
            instruction: Some("当前选区".to_string()),
            thread_id: None,
            model: None,
            mode: Some(CodexChatMode::Agent),
            reasoning_effort: None,
            image_attachments: Some(vec![ChatImageAttachment {
                name: "截图.png".to_string(),
                path: "C:/tmp/a.png".to_string(),
            }]),
            file_attachments: Some(vec![ChatFileAttachment {
                name: "文档.md".to_string(),
                path: "C:/tmp/b.md".to_string(),
                mime_type: None,
                size: None,
            }]),
        };

        let prompt = build_prompt(&request);
        assert!(prompt.contains("你是 Codex agent"));
        assert!(prompt.contains("文档选区上下文："));
        assert!(prompt.contains("用户上传了图片附件"));
        assert!(prompt.contains("用户上传了文件附件"));
        assert!(prompt.contains("帮我看看"));
    }
}
