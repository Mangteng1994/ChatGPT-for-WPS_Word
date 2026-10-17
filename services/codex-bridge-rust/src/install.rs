use crate::{
    addon_registry, config,
    layout::{self, LayoutMode},
    service_control,
};
use anyhow::{bail, Context, Result};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Stdio,
};
use tokio::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const AUTOSTART_TASK_NAME: &str = "CodexForWpsWord-AutoStart";

/// 只注册加载项（安装与修复流程复用）。
pub fn register() -> Result<()> {
    let outcome = addon_registry::register()?;
    if outcome.changed {
        println!(
            "已注册 WPS 加载项: {} => {}",
            addon_registry::ADDON_NAME,
            addon_registry::ADDON_URL
        );
    } else {
        println!("WPS 加载项注册已是最新: {}", addon_registry::ADDON_NAME);
    }
    println!("清单文件: {}", outcome.path.display());
    Ok(())
}

/// 只取消注册。
pub fn unregister() -> Result<()> {
    let outcome = addon_registry::unregister()?;
    if outcome.changed {
        println!("已移除 WPS 加载项注册: {}", addon_registry::ADDON_NAME);
    } else {
        println!("WPS 加载项未注册，跳过");
    }
    println!("清单文件: {}", outcome.path.display());
    Ok(())
}

/// 完整安装：注册加载项 + 建立开机自启 + 启动本地服务。
pub async fn install() -> Result<()> {
    let layout = layout::detect_layout();
    println!("运行模式: {}", layout.describe());
    println!("程序目录: {}", layout.exe_dir.display());

    register()?;

    create_autostart_task().await?;
    println!("已设置开机自启任务: {AUTOSTART_TASK_NAME}");

    let context = service_control::detect_context()?;
    if let Err(error) = service_control::start_services(&context, true).await {
        if !error.output.trim().is_empty() {
            eprintln!("{}", error.output);
        }
        bail!("启动本地服务失败: {}", error.message);
    }

    println!();
    println!("安装完成。");
    println!("配置目录: {}", layout.config_file.display());
    println!("日志目录: {}", layout.logs_dir.display());
    println!("提示: 需要本机已安装 Codex CLI 并完成 `codex login`");
    println!("提示: 在 WPS 中完全退出并重新打开后，`Codex` 选项卡即可使用");
    Ok(())
}

/// 卸载：停止服务 + 删除自启任务 + 取消注册（按需清理安装目录）。
pub async fn uninstall(keep_files: bool) -> Result<()> {
    let layout = layout::detect_layout();
    let context = service_control::detect_context()?;

    match service_control::stop_all_services(&context).await {
        Ok(output) => println!("{output}"),
        Err(error) => {
            if !error.output.trim().is_empty() {
                eprintln!("{}", error.output);
            }
            eprintln!("停止本地服务时遇到问题: {}", error.message);
        }
    }

    if delete_autostart_task().await? {
        println!("已删除开机自启任务: {AUTOSTART_TASK_NAME}");
    } else {
        println!("开机自启任务不存在，跳过");
    }

    unregister()?;

    match layout.mode {
        LayoutMode::Repo => {
            println!("源码仓库模式，保留文件: {}", layout.exe_dir.display());
        }
        LayoutMode::Installed if keep_files => {
            println!("按 --keep-files 保留安装目录: {}", layout.exe_dir.display());
        }
        LayoutMode::Installed => {
            schedule_directory_removal(&layout.exe_dir)?;
            println!(
                "已安排删除安装目录（程序退出后执行）: {}",
                layout.exe_dir.display()
            );
        }
    }

    println!();
    println!("卸载完成。");
    Ok(())
}

/// 环境自检：把「能让 WPS 面板正常问答」的必要条件逐条列出来。
pub async fn doctor() -> Result<()> {
    let layout = layout::detect_layout();
    let mut problems: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    println!("运行模式: {}", layout.describe());
    println!("程序目录: {}", layout.exe_dir.display());
    println!("配置路径: {}", layout.config_file.display());

    // 配置本身：CLI 路径与工作目录
    let runtime = config::load_runtime_config();
    if layout.config_file.is_file() {
        println!("配置文件: 存在");
    } else {
        warnings.push(format!(
            "配置文件不存在（{}），将使用环境变量与默认值",
            layout.config_file.display()
        ));
    }

    let cli_path = runtime.cli_path.trim().to_string();
    if cli_path.is_empty() || !Path::new(&cli_path).exists() {
        let detected = config::detect_cli_paths();
        if detected.is_empty() {
            problems.push("未找到 Codex CLI，请安装后执行 `codex login`".to_string());
        } else {
            warnings.push(format!(
                "配置的 Codex CLI 不可用（{cli_path}），检测到候选: {}",
                detected.join(", ")
            ));
        }
    } else {
        println!("Codex CLI: {cli_path}");
    }

    if runtime.working_dir.is_dir() {
        println!("工作目录: {}", runtime.working_dir.display());
    } else {
        problems.push(format!(
            "工作目录不存在: {}（面板保存的 Codex CLI 配置里修改）",
            runtime.working_dir.display()
        ));
    }

    match addon_registry::is_registered() {
        Ok(true) => println!("WPS 加载项注册: 已注册"),
        Ok(false) => problems.push(format!(
            "WPS 加载项未注册，执行 `{} install` 或 `{} register`",
            exe_name(),
            exe_name()
        )),
        Err(error) => warnings.push(format!("无法读取 WPS 加载项清单: {error}")),
    }

    if autostart_task_exists().await {
        println!("开机自启任务: {AUTOSTART_TASK_NAME}");
    } else {
        warnings.push(format!("开机自启任务缺失: {AUTOSTART_TASK_NAME}（执行 `{} install` 修复）", exe_name()));
    }

    if layout.panel_root.is_dir() {
        println!("面板资源: {}", layout.panel_root.display());
    } else {
        warnings.push(format!(
            "面板资源目录缺失: {}（仓库模式请运行 npm run panel:build）",
            layout.panel_root.display()
        ));
    }

    let context = service_control::detect_context()?;
    match service_control::check_services(&context).await {
        Ok(output) => {
            for line in output.lines() {
                println!("{line}");
            }
        }
        Err(error) => {
            for line in error.output.lines() {
                println!("{line}");
            }
            problems.push("本地服务未全部就绪，可执行 `services start` 或查看上表".to_string());
        }
    }

    println!();
    for warning in &warnings {
        println!("警告: {warning}");
    }
    if problems.is_empty() {
        println!("自检通过：环境满足运行条件。");
        return Ok(());
    }
    for problem in &problems {
        println!("问题: {problem}");
    }
    bail!("自检发现 {} 项问题", problems.len());
}

/// `schtasks` 自启任务：登录后调用 `exe services start`。
pub async fn create_autostart_task() -> Result<()> {
    let user = current_user()?;
    let command_line = format!("\"{}\" services start", current_exe()?.display());
    let (ok, text) = run_schtasks(&[
        "/Create",
        "/TN",
        AUTOSTART_TASK_NAME,
        "/SC",
        "ONLOGON",
        "/IT",
        "/RL",
        "LIMITED",
        "/RU",
        &user,
        "/TR",
        &command_line,
        "/F",
    ])
    .await?;
    if !ok {
        bail!("创建开机自启任务失败: {}", text.trim());
    }
    Ok(())
}

/// 删除自启任务；任务本来就不存在时返回 `false`。
pub async fn delete_autostart_task() -> Result<bool> {
    let (ok, _) = run_schtasks(&["/Delete", "/TN", AUTOSTART_TASK_NAME, "/F"]).await?;
    Ok(ok)
}

pub async fn autostart_task_exists() -> bool {
    run_schtasks(&["/Query", "/TN", AUTOSTART_TASK_NAME])
        .await
        .map(|(ok, _)| ok)
        .unwrap_or(false)
}

async fn run_schtasks(args: &[&str]) -> Result<(bool, String)> {
    let mut command = Command::new("schtasks.exe");
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().await.context("执行 schtasks.exe 失败")?;
    let mut text = String::from_utf8_lossy(&output.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok((output.status.success(), text))
}

fn current_user() -> Result<String> {
    let name = env::var("USERNAME").context("环境变量 USERNAME 缺失，无法创建自启任务")?;
    let domain = env::var("USERDOMAIN").unwrap_or_default();
    if domain.trim().is_empty() {
        Ok(name)
    } else {
        Ok(format!("{domain}\\{name}"))
    }
}

fn current_exe() -> Result<PathBuf> {
    env::current_exe().context("无法定位当前可执行文件")
}

fn exe_name() -> String {
    current_exe()
        .ok()
        .and_then(|path| path.file_name().map(|name| name.to_string_lossy().to_string()))
        .unwrap_or_else(|| "codex-for-wps-word-rust.exe".to_string())
}

/// 删除安装目录：当前进程还占着目录里的 exe，只能交给后台 cmd 等自己退出后再删。
///
/// 清理命令写成独立的 .cmd 文件执行：`cmd /c` 对带内层引号的整条命令解析不可靠，
/// 而单个（可能含空格的）脚本路径不存在这个歧义。
fn schedule_directory_removal(dir: &Path) -> Result<()> {
    let home = env::var_os("USERPROFILE").map(PathBuf::from);
    if dir.parent().is_none() || home.as_deref() == Some(dir) {
        bail!("拒绝删除不安全的目标目录: {}", dir.display());
    }

    let script_path = env::temp_dir().join("codex-for-wps-word-cleanup.cmd");
    let log_path = env::temp_dir().join("codex-for-wps-word-cleanup.log");
    // `timeout` 在 stdin 重定向时会失败，这里用 ping 做延时。
    let script = format!(
        "@echo off\r\nping 127.0.0.1 -n 4 >nul\r\nrmdir /s /q \"{}\" >> \"{}\" 2>&1\r\ndel \"%~f0\" >nul 2>&1\r\n",
        dir.display(),
        log_path.display()
    );
    fs::write(&script_path, script)
        .with_context(|| format!("写入清理脚本失败: {}", script_path.display()))?;

    let mut command = Command::new("cmd.exe");
    command
        .arg("/d")
        .arg("/c")
        .arg(&script_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command.spawn().context("启动安装目录清理进程失败")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule_removal_refuses_drive_root() {
        let error = schedule_directory_removal(Path::new("C:\\")).expect_err("根目录必须被拒绝");
        assert!(error.to_string().contains("不安全"));
    }

    #[test]
    fn current_user_includes_domain_when_available() {
        let user = current_user().expect("读取当前用户");
        if let Ok(domain) = env::var("USERDOMAIN") {
            if !domain.trim().is_empty() {
                assert!(user.starts_with(&domain));
            }
        }
        assert!(user.contains(&env::var("USERNAME").expect("USERNAME")));
    }
}
