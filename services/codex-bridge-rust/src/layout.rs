use std::{
    env,
    path::{Component, Path, PathBuf},
};

/// 仓库根目录的定位标识：只有真正的仓库根目录才同时包含这两级目录。
const PROJECT_MARKER: [&str; 2] = ["apps", "wps-local-addin"];
/// 向上查找的最大层数，足以覆盖 `services/<crate>/target/<profile>/` 这类嵌套位置。
const PROJECT_SEARCH_DEPTH: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayoutMode {
    /// 从源码仓库内运行：资源取自 `apps/`，日志写入仓库根目录。
    Repo,
    /// 从安装目录运行：资源、配置、日志都在可执行文件同目录。
    Installed,
}

/// 运行期目录布局。
///
/// 打包后的 exe 不能假设自己位于源码仓库内，因此所有路径都在启动时解析，
/// 而不是在编译期写死 `CARGO_MANIFEST_DIR`（那会把构建机的路径烧进产物）。
#[derive(Debug, Clone)]
pub struct Layout {
    pub mode: LayoutMode,
    pub exe_dir: PathBuf,
    pub project_root: Option<PathBuf>,
    pub logs_dir: PathBuf,
    pub config_file: PathBuf,
    pub addin_root: PathBuf,
    pub panel_root: PathBuf,
}

impl Layout {
    pub fn describe(&self) -> String {
        let mode = match self.mode {
            LayoutMode::Repo => "repo",
            LayoutMode::Installed => "installed",
        };
        format!("{mode} mode, dir={}", self.exe_dir.display())
    }
}

pub fn is_project_root(candidate: &Path) -> bool {
    candidate
        .join(PROJECT_MARKER[0])
        .join(PROJECT_MARKER[1])
        .is_dir()
}

pub fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    for _ in 0..PROJECT_SEARCH_DEPTH {
        let dir = current?;
        if is_project_root(dir) {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

pub fn detect_layout() -> Layout {
    let exe = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_layout(&exe, &cwd)
}

/// 解析布局。可执行文件的位置是决定性的：它落在仓库内才算开发模式，
/// 拷贝出去的副本（例如安装到 `%LOCALAPPDATA%`）一律走安装模式。
pub fn resolve_layout(exe_path: &Path, cwd: &Path) -> Layout {
    let exe_dir = exe_path
        .parent()
        .map(Path::to_path_buf)
        .filter(|dir| !dir.as_os_str().is_empty())
        .unwrap_or_else(|| PathBuf::from("."));
    let project_root = find_project_root(cwd).or_else(|| find_project_root(&exe_dir));

    match project_root {
        Some(root) if is_inside(&exe_dir, &root) => repo_layout(exe_dir, root),
        _ => installed_layout(exe_dir),
    }
}

fn repo_layout(exe_dir: PathBuf, root: PathBuf) -> Layout {
    Layout {
        mode: LayoutMode::Repo,
        logs_dir: root.join("logs"),
        config_file: root
            .join("services")
            .join("codex-bridge-rust")
            .join("config.local.json"),
        addin_root: root.join("apps").join("wps-local-addin"),
        panel_root: root.join("apps").join("wps-panel").join("dist"),
        project_root: Some(root),
        exe_dir,
    }
}

fn installed_layout(exe_dir: PathBuf) -> Layout {
    Layout {
        mode: LayoutMode::Installed,
        logs_dir: exe_dir.join("logs"),
        config_file: exe_dir.join("config.json"),
        addin_root: exe_dir.join("addin"),
        panel_root: exe_dir.join("panel"),
        project_root: None,
        exe_dir,
    }
}

/// 判断 `child` 是否位于 `parent` 之下。Windows 路径大小写不敏感，逐段比较。
fn is_inside(child: &Path, parent: &Path) -> bool {
    let mut child_parts = child.components();
    for parent_part in parent.components() {
        match child_parts.next() {
            Some(child_part) if component_eq(&child_part, &parent_part) => {}
            _ => return false,
        }
    }
    true
}

fn component_eq(left: &Component<'_>, right: &Component<'_>) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sandbox(tag: &str) -> PathBuf {
        env::temp_dir().join(format!("codex-layout-{}-{}", tag, std::process::id()))
    }

    fn make_repository(tag: &str) -> PathBuf {
        let root = sandbox(tag);
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("apps").join("wps-local-addin")).expect("创建加载项目录");
        std::fs::create_dir_all(root.join("apps").join("wps-panel").join("dist")).expect("创建面板目录");
        std::fs::create_dir_all(root.join("services").join("codex-bridge-rust").join("target").join("debug"))
            .expect("创建构建目录");
        root
    }

    #[test]
    fn repo_mode_when_exe_lives_inside_repository() {
        let root = make_repository("repo");
        let exe = root
            .join("services")
            .join("codex-bridge-rust")
            .join("target")
            .join("debug")
            .join("codex-for-wps-word-rust.exe");

        let layout = resolve_layout(&exe, &root.join("services").join("codex-bridge-rust"));

        assert_eq!(layout.mode, LayoutMode::Repo);
        assert_eq!(layout.project_root.as_deref(), Some(root.as_path()));
        assert_eq!(layout.logs_dir, root.join("logs"));
        assert_eq!(
            layout.config_file,
            root.join("services").join("codex-bridge-rust").join("config.local.json")
        );
        assert_eq!(layout.addin_root, root.join("apps").join("wps-local-addin"));
        assert_eq!(layout.panel_root, root.join("apps").join("wps-panel").join("dist"));

        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn installed_mode_when_exe_lives_outside_repository() {
        let repository = make_repository("install-repo");
        let install = sandbox("install-app");
        let _ = std::fs::remove_dir_all(&install);
        std::fs::create_dir_all(&install).expect("创建安装目录");
        let exe = install.join("codex-for-wps-word.exe");

        // 工作目录故意指向仓库：决定模式的是 exe 的位置，不是 cwd。
        let layout = resolve_layout(&exe, &repository);

        assert_eq!(layout.mode, LayoutMode::Installed);
        assert_eq!(layout.project_root, None);
        assert_eq!(layout.config_file, install.join("config.json"));
        assert_eq!(layout.logs_dir, install.join("logs"));
        assert_eq!(layout.addin_root, install.join("addin"));
        assert_eq!(layout.panel_root, install.join("panel"));

        std::fs::remove_dir_all(&repository).ok();
        std::fs::remove_dir_all(&install).ok();
    }

    #[test]
    fn installed_mode_when_no_repository_exists_anywhere() {
        let app_dir = sandbox("norepo");
        let _ = std::fs::remove_dir_all(&app_dir);
        std::fs::create_dir_all(&app_dir).expect("创建目录");

        let layout = resolve_layout(&app_dir.join("codex-for-wps-word.exe"), &app_dir);

        assert_eq!(layout.mode, LayoutMode::Installed);
        assert_eq!(layout.config_file, app_dir.join("config.json"));

        std::fs::remove_dir_all(&app_dir).ok();
    }

    #[test]
    fn find_project_root_walks_up_from_nested_crate() {
        let repository = make_repository("walk");
        let crate_dir = repository.join("services").join("codex-bridge-rust");

        assert_eq!(find_project_root(&crate_dir), Some(repository.clone()));
        assert_eq!(
            find_project_root(&repository.join("services")),
            Some(repository.clone())
        );
        assert_eq!(find_project_root(&sandbox("walk-none")), None);

        std::fs::remove_dir_all(&repository).ok();
    }

    #[test]
    fn detect_layout_resolves_current_repository() {
        let layout = detect_layout();
        assert_eq!(layout.mode, LayoutMode::Repo, "测试进程运行在源码仓库内");
        let root = layout.project_root.expect("仓库模式必然有 project_root");
        assert!(
            is_project_root(&root),
            "定位到的目录必须包含 apps/wps-local-addin：{}",
            root.display()
        );
        assert!(layout.config_file.ends_with("config.local.json"));
    }
}
