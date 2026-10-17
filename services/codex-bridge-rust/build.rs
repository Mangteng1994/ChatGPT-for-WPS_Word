//! 打包用构建脚本：把加载项与面板静态资源编进可执行文件。
//!
//! 只在 `embedded-assets` feature 开启时工作，默认构建完全不受影响。
//! 生成的文件是 `$OUT_DIR/embedded_assets.rs`，由 `src/embedded.rs` include。

use std::{
    env, fs,
    path::{Path, PathBuf},
};

/// 加载项目录里允许内嵌的扩展名（`package.json`、sourcemap 之类不进包）。
const ADDIN_EXTENSIONS: &[&str] = &["html", "xml", "js", "css", "svg", "png", "ico"];
/// 递归时跳过的目录名（点开头的目录一律跳过）。
const SKIPPED_DIRS: &[&str] = &["node_modules", "target", ".debugTemp"];

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var_os("CARGO_FEATURE_EMBEDDED_ASSETS").is_none() {
        return;
    }

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("缺少 CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.join("..").join("..");
    let addin_dir = project_root.join("apps").join("wps-local-addin");
    let panel_dir = project_root.join("apps").join("wps-panel").join("dist");

    assert!(
        addin_dir.is_dir(),
        "内嵌加载项资源失败：{} 不存在",
        addin_dir.display()
    );
    assert!(
        panel_dir.is_dir(),
        "内嵌面板资源失败：{} 不存在，请先运行 `npm run panel:build`",
        panel_dir.display()
    );

    println!("cargo:rerun-if-changed={}", addin_dir.display());
    println!("cargo:rerun-if-changed={}", panel_dir.display());

    let addin_files = collect_files(&addin_dir, &|relative| {
        extension_of(relative).is_some_and(|ext| ADDIN_EXTENSIONS.contains(&ext.as_str()))
    });
    let panel_files = collect_files(&panel_dir, &|_| true);

    let mut source = String::from("// 由 build.rs 生成，请勿手工编辑。\n\n");
    source.push_str(&render_table("ADDIN_ASSETS", &addin_files));
    source.push_str(&render_table("PANEL_ASSETS", &panel_files));

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("缺少 OUT_DIR"));
    fs::write(out_dir.join("embedded_assets.rs"), source).expect("写入内嵌资源表失败");
}

fn collect_files(root: &Path, keep: &dyn Fn(&str) -> bool) -> Vec<(String, PathBuf)> {
    let mut files = Vec::new();
    walk(root, root, keep, &mut files);
    files.sort_by(|left, right| left.0.cmp(&right.0));
    files
}

fn walk(root: &Path, dir: &Path, keep: &dyn Fn(&str) -> bool, files: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name.starts_with('.') || SKIPPED_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk(root, &path, keep, files);
            continue;
        }

        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if keep(&relative) {
            files.push((relative, path));
        }
    }
}

/// 生成 `pub const NAME: &[(&str, &[u8])]`，键是 `/` 分隔的相对路径。
fn render_table(name: &str, files: &[(String, PathBuf)]) -> String {
    let mut source = format!("pub const {name}: &[(&str, &[u8])] = &[\n");
    for (relative, path) in files {
        let literal = path.to_string_lossy().replace('\\', "/");
        source.push_str(&format!(
            "    (\"{relative}\", include_bytes!(r\"{literal}\")),\n"
        ));
    }
    source.push_str("];\n\n");
    source
}

fn extension_of(relative: &str) -> Option<String> {
    Path::new(relative)
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
}
