use anyhow::{bail, Context, Result};
use std::{
    collections::VecDeque,
    env,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    process::Command,
    time::{sleep, timeout, Instant},
};

const ADDON_HOST_PORT: u16 = 3889;
const BRIDGE_PORT: u16 = 32123;
/// Legacy vite dev-server port; only killed by `stop` to clean up older installs.
const PANEL_PORT: u16 = 5173;
const LEGACY_PANEL_PORT: u16 = 5174;
const LOOPBACK_HOST: &str = "127.0.0.1";
const CREATE_NO_WINDOW: u32 = 0x08000000;
/// 用户主动停止 bridge 时写入的标记文件；宿主看护据此不再自动拉起。
const BRIDGE_PAUSE_MARKER: &str = "bridge-paused.marker";
/// 看护探活间隔。
const WATCHDOG_INTERVAL_SECONDS: u64 = 15;
/// 看护统计窗口内允许的最大重启次数，避免反复崩溃时形成重启风暴。
const WATCHDOG_MAX_RESTARTS: usize = 5;
const WATCHDOG_WINDOW_SECONDS: u64 = 600;

#[derive(Debug, Clone)]
pub struct ServiceControlContext {
    /// 运行根目录：仓库模式为仓库根，安装模式为 exe 所在目录。
    pub runtime_root: PathBuf,
    pub logs_dir: PathBuf,
}

#[derive(Debug)]
pub struct ServiceControlFailure {
    pub output: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy)]
enum HttpMethod {
    Get,
    Post,
}

#[derive(Debug, Clone, Copy)]
struct ServiceCheck {
    name: &'static str,
    port: u16,
    url: &'static str,
    method: HttpMethod,
    body: &'static str,
    expected: &'static str,
    timeout_seconds: u64,
    hint: &'static str,
}

#[derive(Debug)]
struct ServiceLogger {
    lines: Vec<String>,
    file: Option<File>,
}

#[derive(Debug)]
struct ProcessDetails {
    pid: u32,
    name: String,
    exe: String,
    cwd: String,
    command_line: String,
}

#[derive(Debug)]
struct ParsedHttpUrl {
    host: String,
    port: u16,
    path: String,
}

/// 构建服务控制上下文。`runtime_root` 在仓库模式下是仓库根目录，
/// 在安装模式下是 exe 所在目录；两种模式下的日志都放在其 `logs` 子目录。
pub fn detect_context() -> Result<ServiceControlContext> {
    let layout = crate::layout::detect_layout();
    let runtime_root = layout
        .project_root
        .clone()
        .unwrap_or_else(|| layout.exe_dir.clone());
    fs::create_dir_all(&layout.logs_dir)?;
    Ok(ServiceControlContext {
        runtime_root,
        logs_dir: layout.logs_dir.clone(),
    })
}

fn bridge_pause_marker(logs_dir: &Path) -> PathBuf {
    logs_dir.join(BRIDGE_PAUSE_MARKER)
}

/// 标记 bridge 为「用户主动停止」。
fn mark_bridge_paused(logs_dir: &Path) -> Result<()> {
    let marker = bridge_pause_marker(logs_dir);
    fs::write(&marker, b"stopped\n")
        .with_context(|| format!("写入停止标记失败: {}", marker.display()))
}

/// 清除「用户主动停止」标记，返回清除前标记是否存在。
fn clear_bridge_pause(logs_dir: &Path) -> Result<bool> {
    let marker = bridge_pause_marker(logs_dir);
    if !marker.exists() {
        return Ok(false);
    }
    fs::remove_file(&marker).with_context(|| format!("清除停止标记失败: {}", marker.display()))?;
    Ok(true)
}

pub async fn start_services(
    context: &ServiceControlContext,
    include_addon_host: bool,
) -> std::result::Result<String, ServiceControlFailure> {
    let mut logger = match ServiceLogger::with_log_file(context.logs_dir.join("start-local-services.log")) {
        Ok(logger) => logger,
        Err(error) => {
            return Err(ServiceControlFailure {
                output: String::new(),
                message: error.to_string(),
            })
        }
    };

    if let Err(error) = logger.log(format!("Start requested. root={}", context.runtime_root.display())) {
        return Err(ServiceControlFailure {
            output: logger.output(),
            message: error.to_string(),
        });
    }

    // 显式启动即代表用户恢复服务，清掉上次「手动停止」的标记，看护重新生效。
    match clear_bridge_pause(&context.logs_dir) {
        Ok(true) => {
            if let Err(error) = logger.log("已清除「用户停止」标记，恢复自动看护") {
                return Err(ServiceControlFailure {
                    output: logger.output(),
                    message: error.to_string(),
                });
            }
        }
        Ok(false) => {}
        Err(error) => {
            if let Err(log_error) = logger.log(format!("清除停止标记失败: {error}")) {
                return Err(ServiceControlFailure {
                    output: logger.output(),
                    message: log_error.to_string(),
                });
            }
        }
    }

    let addon_host = addon_host_check();
    let bridge = bridge_check();

    if include_addon_host {
        if test_port(addon_host.port).await && !test_http_content(&addon_host).await {
            if let Err(error) = clear_stale_project_process(context, &mut logger, addon_host.port, addon_host.name).await {
                return Err(ServiceControlFailure {
                    output: logger.output(),
                    message: error.to_string(),
                });
            }
        }

        if !test_http_content(&addon_host).await {
            if let Err(error) = start_self_service(context, &mut logger, "addon-host").await {
                return Err(ServiceControlFailure {
                    output: logger.output(),
                    message: error.to_string(),
                });
            }
        } else if let Err(error) = logger.log(format!(
            "{} is already healthy on port {}",
            addon_host.name, addon_host.port
        )) {
            return Err(ServiceControlFailure {
                output: logger.output(),
                message: error.to_string(),
            });
        }
    }

    if test_port(bridge.port).await && !test_http_content(&bridge).await {
        if let Err(error) = clear_stale_project_process(context, &mut logger, bridge.port, bridge.name).await {
            return Err(ServiceControlFailure {
                output: logger.output(),
                message: error.to_string(),
            });
        }
    }

    if !test_http_content(&bridge).await {
        if let Err(error) = start_self_service(context, &mut logger, "bridge").await {
            return Err(ServiceControlFailure {
                output: logger.output(),
                message: error.to_string(),
            });
        }
    } else if let Err(error) = logger.log(format!("{} is already healthy on port {}", bridge.name, bridge.port)) {
        return Err(ServiceControlFailure {
            output: logger.output(),
            message: error.to_string(),
        });
    }

    // The WPS panel is served by the add-in host as a static build, so it has no
    // process of its own to start here. `panel_check` only verifies the build is
    // present and reachable.

    let mut failed = Vec::new();
    for check in service_checks() {
        if wait_service_healthy(&check).await {
            if let Err(error) = logger.log(format!("{} is healthy at {}", check.name, check.url)) {
                return Err(ServiceControlFailure {
                    output: logger.output(),
                    message: error.to_string(),
                });
            }
            continue;
        }

        let mut failure_text = match find_port_owners(check.port).await {
            Ok(owners) if !owners.is_empty() => {
                let details = owners
                    .into_iter()
                    .filter_map(process_details)
                    .map(|process| format!("pid={}, {}", process.pid, process.name))
                    .collect::<Vec<_>>();
                if details.is_empty() {
                    format!("{} ({}, listener present)", check.name, check.port)
                } else {
                    format!("{} ({}, {})", check.name, check.port, details.join("; "))
                }
            }
            _ => format!("{} ({}, no listener)", check.name, check.port),
        };
        if !check.hint.is_empty() {
            failure_text.push_str(&format!(" | {}", check.hint));
        }
        if let Err(error) = logger.log(format!("FAILED: {} is not healthy at {}", check.name, check.url)) {
            return Err(ServiceControlFailure {
                output: logger.output(),
                message: error.to_string(),
            });
        }
        failed.push(failure_text);
    }

    if !failed.is_empty() {
        let message = format!(
            "Some local services failed to start: {}. Logs: {}",
            failed.join(", "),
            context.logs_dir.display()
        );
        if let Err(error) = logger.log(message.clone()) {
            return Err(ServiceControlFailure {
                output: logger.output(),
                message: error.to_string(),
            });
        }
        return Err(ServiceControlFailure {
            output: logger.output(),
            message,
        });
    }

    if let Err(error) = logger.log("All local services are ready") {
        return Err(ServiceControlFailure {
            output: logger.output(),
            message: error.to_string(),
        });
    }

    Ok(logger.output())
}

pub async fn stop_services(
    context: &ServiceControlContext,
) -> std::result::Result<String, ServiceControlFailure> {
    let mut failures = Vec::new();

    // 先打停止标记，避免宿主看护在关闭过程中把 bridge 重新拉起。
    if let Err(error) = mark_bridge_paused(&context.logs_dir) {
        failures.push(error.to_string());
    }

    for port in [BRIDGE_PORT, PANEL_PORT, LEGACY_PANEL_PORT] {
        match find_port_owners(port).await {
            Ok(owners) => {
                for pid in owners {
                    if let Err(error) = kill_process_tree(pid).await {
                        failures.push(format!("port {} pid {}: {}", port, pid, error));
                    }
                }
            }
            Err(error) => failures.push(format!("port {}: {}", port, error)),
        }
    }

    let output = format!(
        "Stopped local Codex bridge services on ports: {}, {}, {} (auto-restart paused)",
        BRIDGE_PORT, PANEL_PORT, LEGACY_PANEL_PORT
    );
    if failures.is_empty() {
        Ok(output)
    } else {
        Err(ServiceControlFailure {
            output,
            message: format!("停止本地服务时遇到问题: {}", failures.join("; ")),
        })
    }
}

pub async fn check_services(
    _context: &ServiceControlContext,
) -> std::result::Result<String, ServiceControlFailure> {
    let mut lines = Vec::new();
    let mut failed = Vec::new();

    for check in service_checks() {
        if test_http_content(&check).await {
            lines.push(format!("OK: {} {}", check.name, check.url));
            continue;
        }

        let mut item = format!("{} is not reachable at {}", check.name, check.url);
        if !check.hint.is_empty() {
            item.push_str(&format!(" | {}", check.hint));
        }
        failed.push(item);
    }

    if failed.is_empty() {
        lines.push("All local Codex services are healthy.".to_string());
        return Ok(lines.join("\n"));
    }

    lines.push("FAILED:".to_string());
    for item in &failed {
        lines.push(format!("- {}", item));
    }

    Err(ServiceControlFailure {
        output: lines.join("\n"),
        message: "本地服务健康检查失败".to_string(),
    })
}

pub async fn run_cli(action: &str) -> Result<()> {
    let context = detect_context()?;
    let result = match action {
        "start" => start_services(&context, true).await,
        "stop" => stop_services(&context).await,
        "check" => check_services(&context).await,
        other => bail!("Unknown services action: {other}"),
    };

    match result {
        Ok(output) => {
            if action != "start" && !output.trim().is_empty() {
                println!("{output}");
            }
            Ok(())
        }
        Err(error) => {
            if !error.output.trim().is_empty() {
                eprintln!("{}", error.output);
            }
            bail!(error.message)
        }
    }
}

fn service_checks() -> [ServiceCheck; 3] {
    [addon_host_check(), bridge_check(), panel_check()]
}

fn addon_host_check() -> ServiceCheck {
    ServiceCheck {
        name: "WPS add-in host",
        port: ADDON_HOST_PORT,
        url: "http://127.0.0.1:3889/__codex/service/ping",
        method: HttpMethod::Post,
        body: "{}",
        expected: "\"ok\":true",
        timeout_seconds: 60,
        hint: "",
    }
}

fn bridge_check() -> ServiceCheck {
    ServiceCheck {
        name: "codex bridge",
        port: BRIDGE_PORT,
        url: "http://127.0.0.1:32123/health",
        method: HttpMethod::Get,
        body: "",
        expected: "\"service\":\"codex-bridge\"",
        timeout_seconds: 60,
        hint: "",
    }
}

fn panel_check() -> ServiceCheck {
    ServiceCheck {
        name: "WPS panel",
        port: ADDON_HOST_PORT,
        url: "http://127.0.0.1:3889/panel/index.html",
        method: HttpMethod::Get,
        body: "",
        expected: "Codex for WPS Word",
        timeout_seconds: 20,
        hint: "面板静态产物由加载项宿主提供，缺失时请运行 npm run panel:build",
    }
}

/// 探活用短超时，避免 bridge 卡死时看护被拖住。
fn bridge_probe() -> ServiceCheck {
    ServiceCheck {
        timeout_seconds: 5,
        ..bridge_check()
    }
}

/// 看护日志：控制台 + `logs/supervisor.log`。
fn watchdog_log(logs_dir: &Path, message: &str) {
    println!("[watchdog] {message}");
    let path = logs_dir.join("supervisor.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{}] {}", now_millis(), message);
    }
}

/// 统计窗口内的重启预算：允许则登记本次重启并返回 `true`。
fn restart_allowed(restarts: &mut VecDeque<Instant>, now: Instant) -> bool {
    let window = Duration::from_secs(WATCHDOG_WINDOW_SECONDS);
    while matches!(restarts.front(), Some(at) if now.duration_since(*at) > window) {
        restarts.pop_front();
    }
    if restarts.len() >= WATCHDOG_MAX_RESTARTS {
        return false;
    }
    restarts.push_back(now);
    true
}

/// 宿主内建的 bridge 看护：bridge 静默退出后自动拉起。
///
/// 面板和 bridge 由同一个宿主进程托管，bridge 掉线时用户只会看到「服务不可用」，
/// 这里补上自愈，避免每次都要求用户手动点「启动本地服务」。
pub async fn run_bridge_watchdog() {
    let context = match detect_context() {
        Ok(context) => context,
        Err(error) => {
            eprintln!("[watchdog] 无法初始化看护: {error}");
            return;
        }
    };

    let marker = bridge_pause_marker(&context.logs_dir);
    let probe = bridge_probe();
    let mut restarts: VecDeque<Instant> = VecDeque::new();
    let mut pause_logged = false;

    loop {
        sleep(Duration::from_secs(WATCHDOG_INTERVAL_SECONDS)).await;

        if marker.exists() {
            if !pause_logged {
                watchdog_log(&context.logs_dir, "bridge 已被手动停止，看护暂停");
                pause_logged = true;
            }
            continue;
        }
        pause_logged = false;

        if test_http_content(&probe).await {
            continue;
        }

        // 二次确认，避免刚好撞上启动窗口。
        sleep(Duration::from_secs(3)).await;
        if test_http_content(&probe).await {
            continue;
        }

        if !restart_allowed(&mut restarts, Instant::now()) {
            watchdog_log(&context.logs_dir, "bridge 反复无法启动，本窗口内不再自动拉起");
            continue;
        }

        match start_self_service_detached(&context, "bridge").await {
            Ok(()) => watchdog_log(&context.logs_dir, "bridge 不可达，已自动重新拉起"),
            Err(error) => watchdog_log(&context.logs_dir, &format!("自动拉起 bridge 失败: {error}")),
        }
    }
}

impl ServiceLogger {
    fn with_log_file(path: PathBuf) -> Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        Ok(Self {
            lines: Vec::new(),
            file: Some(file),
        })
    }

    fn log(&mut self, message: impl AsRef<str>) -> Result<()> {
        let raw = message.as_ref().to_string();
        println!("{raw}");
        if let Some(file) = &mut self.file {
            writeln!(file, "[{}] {}", now_millis(), raw)?;
        }
        self.lines.push(raw);
        Ok(())
    }

    fn output(&self) -> String {
        self.lines.join("\n")
    }
}

/// 用当前可执行文件本身拉起子服务（`addon-host` / `bridge`）。
///
/// 这是打包后的关键路径：运行期不再依赖 Node 与 npm 脚本。
async fn start_self_service(
    context: &ServiceControlContext,
    logger: &mut ServiceLogger,
    mode_arg: &str,
) -> Result<()> {
    let (exe, args) = self_service_command(mode_arg)?;
    logger.log(format!("Starting {mode_arg}: {} {mode_arg}", exe.display()))?;
    spawn_detached_process(&context.logs_dir, mode_arg, &exe, &args, &context.runtime_root).await
}

/// 不带 logger 的自拉起，供看护在后台使用。
async fn start_self_service_detached(context: &ServiceControlContext, mode_arg: &str) -> Result<()> {
    let (exe, args) = self_service_command(mode_arg)?;
    spawn_detached_process(&context.logs_dir, mode_arg, &exe, &args, &context.runtime_root).await
}

fn self_service_command(mode_arg: &str) -> Result<(PathBuf, Vec<OsString>)> {
    let exe = env::current_exe().context("无法定位当前可执行文件")?;
    Ok((exe, vec![OsString::from(mode_arg)]))
}

async fn spawn_detached_process(
    logs_dir: &Path,
    name: &str,
    file_path: &Path,
    args: &[OsString],
    working_dir: &Path,
) -> Result<()> {
    let stdout_path = logs_dir.join(format!("{name}.out.log"));
    let stderr_path = logs_dir.join(format!("{name}.err.log"));
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_path)
        .with_context(|| format!("打开日志文件失败: {}", stdout_path.display()))?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_path)
        .with_context(|| format!("打开日志文件失败: {}", stderr_path.display()))?;

    let launcher_path = logs_dir.join(format!("{name}.cmd"));
    let launcher_content = build_launcher_script(working_dir, file_path, args, &stdout_path, &stderr_path);
    fs::write(&launcher_path, launcher_content)
        .with_context(|| format!("写入启动脚本失败: {}", launcher_path.display()))?;

    let mut command = Command::new("cmd.exe");
    command
        .args([
            OsString::from("/d"),
            OsString::from("/c"),
            OsString::from("start"),
            OsString::from(""),
            OsString::from("/min"),
            OsString::from("cmd.exe"),
            OsString::from("/d"),
            OsString::from("/c"),
            OsString::from(launcher_path.as_os_str()),
        ])
        .current_dir(working_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .with_context(|| format!("启动进程失败: {}", file_path.display()))?;
    Ok(())
}

fn build_launcher_script(
    working_dir: &Path,
    file_path: &Path,
    args: &[OsString],
    stdout_path: &Path,
    stderr_path: &Path,
) -> String {
    let mut command_line = quote_cmd_arg(file_path);
    for arg in args {
        command_line.push(' ');
        command_line.push_str(&quote_cmd_text(&arg.to_string_lossy()));
    }

    [
        "@echo off".to_string(),
        format!("cd /d {}", quote_cmd_arg(working_dir)),
        format!(
            "{} >> {} 2>> {}",
            command_line,
            quote_cmd_arg(stdout_path),
            quote_cmd_arg(stderr_path)
        ),
    ]
    .join("\r\n")
}

fn quote_cmd_arg(path: &Path) -> String {
    quote_cmd_text(&path.to_string_lossy())
}

fn quote_cmd_text(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

async fn clear_stale_project_process(
    context: &ServiceControlContext,
    logger: &mut ServiceLogger,
    port: u16,
    service_name: &str,
) -> Result<()> {
    let owners = find_port_owners(port).await?;
    for pid in owners {
        if let Some(process) = process_details(pid) {
            if belongs_to_project(&process, &context.runtime_root) {
                logger.log(format!(
                    "Stopping stale {} owner on port {}: pid={} {}",
                    service_name, port, process.pid, process.name
                ))?;
                kill_process_tree(process.pid).await?;
                sleep(Duration::from_millis(500)).await;
            } else {
                logger.log(format!(
                    "Port {} is occupied by a non-project process: pid={} {} {}",
                    port, process.pid, process.name, process.command_line
                ))?;
            }
        } else {
            logger.log(format!(
                "Port {} is occupied by pid={} but process details are unavailable",
                port, pid
            ))?;
        }
    }
    Ok(())
}

async fn kill_process_tree(pid: u32) -> Result<()> {
    let mut command = Command::new("taskkill.exe");
    command.args(["/PID", &pid.to_string(), "/T", "/F"]);
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().await?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("taskkill.exe failed for pid {}", pid)
    };
    bail!(message)
}

fn process_details(pid: u32) -> Option<ProcessDetails> {
    let refresh = RefreshKind::nothing().with_processes(ProcessRefreshKind::everything());
    let mut system = System::new_with_specifics(refresh);
    system.refresh_processes_specifics(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true, ProcessRefreshKind::everything());
    let process = system.process(Pid::from_u32(pid))?;

    let command_line = process
        .cmd()
        .iter()
        .map(|part| part.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(" ");
    let exe = process
        .exe()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let cwd = process
        .cwd()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    Some(ProcessDetails {
        pid,
        name: process.name().to_string_lossy().to_string(),
        exe,
        cwd,
        command_line,
    })
}

fn belongs_to_project(process: &ProcessDetails, project_root: &Path) -> bool {
    let root = project_root.to_string_lossy().to_string();
    contains_case_insensitive(&process.command_line, &root)
        || contains_case_insensitive(&process.exe, &root)
        || contains_case_insensitive(&process.cwd, &root)
}

fn contains_case_insensitive(haystack: &str, needle: &str) -> bool {
    haystack.to_ascii_lowercase().contains(&needle.to_ascii_lowercase())
}

async fn wait_service_healthy(check: &ServiceCheck) -> bool {
    let deadline = Instant::now() + Duration::from_secs(check.timeout_seconds);
    while Instant::now() < deadline {
        if test_http_content(check).await {
            return true;
        }
        sleep(Duration::from_millis(500)).await;
    }
    test_http_content(check).await
}

async fn test_port(port: u16) -> bool {
    timeout(
        Duration::from_millis(300),
        TcpStream::connect((LOOPBACK_HOST, port)),
    )
    .await
    .ok()
    .and_then(|result| result.ok())
    .is_some()
}

async fn test_http_content(check: &ServiceCheck) -> bool {
    match http_request(check).await {
        Ok(response) => response_status_ok(&response) && response_body(&response).contains(check.expected),
        Err(_) => false,
    }
}

async fn http_request(check: &ServiceCheck) -> Result<String> {
    let url = parse_http_url(check.url)?;
    let request_body = check.body.as_bytes();
    let method = match check.method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
    };
    let mut headers = vec![
        format!("{method} {} HTTP/1.1", url.path),
        format!("Host: {}:{}", url.host, url.port),
        "Connection: close".to_string(),
    ];
    if matches!(check.method, HttpMethod::Post) {
        headers.push("Content-Type: application/json".to_string());
        headers.push(format!("Content-Length: {}", request_body.len()));
    }
    let request = if request_body.is_empty() {
        format!("{}\r\n\r\n", headers.join("\r\n"))
    } else {
        format!("{}\r\n\r\n{}", headers.join("\r\n"), check.body)
    };

    let timeout_duration = Duration::from_secs(3);
    let mut stream = timeout(timeout_duration, TcpStream::connect((url.host.as_str(), url.port)))
        .await
        .context("HTTP connect timed out")??;
    timeout(timeout_duration, stream.write_all(request.as_bytes()))
        .await
        .context("HTTP write timed out")??;

    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut expected_total_len = None;
    loop {
        let bytes_read = timeout(timeout_duration, stream.read(&mut chunk))
            .await
            .context("HTTP read timed out")??;
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
        if expected_total_len.is_none() {
            if let Some(header_end) = find_header_end(&buffer) {
                let header = &buffer[..header_end];
                expected_total_len =
                    parse_content_length(header).map(|content_length| header_end + content_length);
                if expected_total_len.is_none() {
                    break;
                }
            }
        }
        if expected_total_len
            .map(|expected_len| buffer.len() >= expected_len)
            .unwrap_or(false)
        {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&buffer).to_string())
}

fn response_status_ok(response: &str) -> bool {
    response
        .lines()
        .next()
        .map(|line| line.contains(" 200 "))
        .unwrap_or(false)
}

fn response_body(response: &str) -> &str {
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .or_else(|| response.split_once("\n\n").map(|(_, body)| body))
        .unwrap_or(response)
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .or_else(|| buffer.windows(2).position(|window| window == b"\n\n").map(|index| index + 2))
}

fn parse_content_length(header: &[u8]) -> Option<usize> {
    let text = String::from_utf8_lossy(header);
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some(value) = lower.strip_prefix("content-length:") {
            return value.trim().parse::<usize>().ok();
        }
    }
    None
}

fn parse_http_url(url: &str) -> Result<ParsedHttpUrl> {
    let raw = url
        .strip_prefix("http://")
        .with_context(|| format!("只支持 http URL: {url}"))?;
    let (host_port, path) = match raw.split_once('/') {
        Some((host_port, path)) => (host_port, format!("/{}", path)),
        None => (raw, "/".to_string()),
    };
    let (host, port) = host_port
        .rsplit_once(':')
        .with_context(|| format!("URL 缺少端口: {url}"))?;
    Ok(ParsedHttpUrl {
        host: host.to_string(),
        port: port.parse::<u16>().with_context(|| format!("端口无效: {url}"))?,
        path,
    })
}

async fn find_port_owners(port: u16) -> Result<Vec<u32>> {
    let mut command = Command::new("netstat.exe");
    command.args(["-ano", "-p", "tcp"]);
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().await?;
    if !output.status.success() {
        bail!("netstat.exe 执行失败");
    }
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(parse_netstat_port_owners(&text, port))
}

fn parse_netstat_port_owners(output: &str, port: u16) -> Vec<u32> {
    let mut owners = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || !trimmed.to_ascii_lowercase().starts_with("tcp") {
            continue;
        }
        let parts = trimmed.split_whitespace().collect::<Vec<_>>();
        if parts.len() < 4 {
            continue;
        }
        let local_address = parts[1];
        let Some(pid_text) = parts.last() else {
            continue;
        };
        if !local_address_matches_port(local_address, port) {
            continue;
        }
        if let Ok(pid) = pid_text.parse::<u32>() {
            if pid != 0 && !owners.contains(&pid) {
                owners.push(pid);
            }
        }
    }
    owners
}

fn local_address_matches_port(local_address: &str, port: u16) -> bool {
    local_address
        .rsplit_once(':')
        .and_then(|(_, port_text)| port_text.trim_matches(']').parse::<u16>().ok())
        .map(|value| value == port)
        .unwrap_or(false)
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_http_url_supports_loopback_url() {
        let parsed = parse_http_url("http://127.0.0.1:5173/index.html").expect("parse");
        assert_eq!(parsed.host, "127.0.0.1");
        assert_eq!(parsed.port, 5173);
        assert_eq!(parsed.path, "/index.html");
    }

    #[test]
    fn local_address_match_handles_ipv4_and_ipv6() {
        assert!(local_address_matches_port("127.0.0.1:3889", 3889));
        assert!(local_address_matches_port("[::1]:3889", 3889));
        assert!(!local_address_matches_port("127.0.0.1:5173", 3889));
    }

    #[test]
    fn parse_netstat_port_owners_extracts_unique_pids() {
        let sample = "\
  TCP    127.0.0.1:5173      0.0.0.0:0      LISTENING       1234\n\
  TCP    [::1]:5173          [::]:0         LISTENING       1234\n\
  TCP    127.0.0.1:3889      0.0.0.0:0      LISTENING       5678\n";
        assert_eq!(parse_netstat_port_owners(sample, 5173), vec![1234]);
        assert_eq!(parse_netstat_port_owners(sample, 3889), vec![5678]);
    }

    #[test]
    fn parse_content_length_reads_header_value() {
        let header = b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 140\r\n\r\n";
        assert_eq!(find_header_end(header), Some(header.len()));
        assert_eq!(parse_content_length(header), Some(140));
    }

    #[test]
    fn detect_context_uses_layout_paths() {
        let context = detect_context().expect("构建服务控制上下文");
        let layout = crate::layout::detect_layout();
        assert_eq!(context.logs_dir, layout.logs_dir);
        assert_eq!(context.runtime_root, layout.project_root.expect("仓库模式应有根目录"));
    }

    #[test]
    fn launcher_script_starts_current_exe_without_npm() {
        let script = build_launcher_script(
            Path::new("E:/repo"),
            Path::new("E:/repo/service.exe"),
            &[OsString::from("bridge")],
            Path::new("E:/repo/logs/bridge.out.log"),
            Path::new("E:/repo/logs/bridge.err.log"),
        );

        assert!(script.contains("cd /d \"E:/repo\""));
        assert!(script.contains("\"E:/repo/service.exe\" \"bridge\""));
        assert!(!script.to_ascii_lowercase().contains("npm"));
    }

    #[test]
    fn bridge_pause_marker_is_marked_and_cleared() {
        let logs_dir = std::env::temp_dir().join(format!("codex-pause-{}", std::process::id()));
        std::fs::create_dir_all(&logs_dir).expect("创建日志目录");

        assert_eq!(clear_bridge_pause(&logs_dir).expect("清除未设置的标记"), false);

        mark_bridge_paused(&logs_dir).expect("写入停止标记");
        assert!(bridge_pause_marker(&logs_dir).exists());
        assert_eq!(clear_bridge_pause(&logs_dir).expect("清除停止标记"), true);
        assert!(!bridge_pause_marker(&logs_dir).exists());
        assert_eq!(clear_bridge_pause(&logs_dir).expect("重复清除"), false);

        std::fs::remove_dir_all(&logs_dir).ok();
    }

    #[test]
    fn restart_budget_limits_restarts_within_window() {
        let start = Instant::now();
        let mut restarts = VecDeque::new();

        for _ in 0..WATCHDOG_MAX_RESTARTS {
            assert!(restart_allowed(&mut restarts, start));
        }
        assert!(!restart_allowed(&mut restarts, start));

        // 窗口过期后预算恢复。
        let later = start + Duration::from_secs(WATCHDOG_WINDOW_SECONDS + 1);
        assert!(restart_allowed(&mut restarts, later));
        assert_eq!(restarts.len(), 1);
    }
}
