use anyhow::{bail, Context, Result};
use std::{
    env,
    fs,
    io,
    path::{Path, PathBuf},
};

/// 注册到 WPS 的加载项标识。
pub const ADDON_NAME: &str = "codex-for-wps-word-local-addin";
pub const ADDON_TYPE: &str = "wps";
pub const ADDON_URL: &str = "http://127.0.0.1:3889/";

const ROOT_TAG: &str = "jsplugins";
const ITEM_TAG: &str = "jspluginonline";
const EMPTY_DOCUMENT: &str = "<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>\r\n<jsplugins>\r\n</jsplugins>\r\n";

#[derive(Debug)]
pub struct RegistryOutcome {
    pub path: PathBuf,
    /// 是否真的改动了文件（重复注册时为 false）。
    pub changed: bool,
}

/// `publish.xml` 位置：默认取 `%APPDATA%\kingsoft\wps\jsaddons\publish.xml`，
/// 可用 `CODEX_WPS_PUBLISH_XML` 覆盖（测试与多用户环境用）。
pub fn publish_xml_path() -> Result<PathBuf> {
    if let Some(path) = env::var("CODEX_WPS_PUBLISH_XML").ok().and_then(|value| non_empty(value)) {
        return Ok(PathBuf::from(path));
    }
    let appdata =
        env::var_os("APPDATA").context("环境变量 APPDATA 缺失，无法定位 WPS jsaddons 目录")?;
    Ok(PathBuf::from(appdata)
        .join("kingsoft")
        .join("wps")
        .join("jsaddons")
        .join("publish.xml"))
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// 写入我们的加载项节点；已存在时更新为最新属性。
pub fn register() -> Result<RegistryOutcome> {
    register_at(&publish_xml_path()?)
}

/// 移除我们的加载项节点；不存在时视为未改动。
pub fn unregister() -> Result<RegistryOutcome> {
    unregister_at(&publish_xml_path()?)
}

/// 判断当前 `publish.xml` 是否已注册本加载项。
pub fn is_registered() -> Result<bool> {
    is_registered_at(&publish_xml_path()?)
}

fn register_at(path: &Path) -> Result<RegistryOutcome> {
    let mut document = PublishDocument::load(path)?;
    let changed = document.upsert_addon();
    if changed {
        document.save(path)?;
    }
    Ok(RegistryOutcome {
        path: path.to_path_buf(),
        changed,
    })
}

fn unregister_at(path: &Path) -> Result<RegistryOutcome> {
    let mut document = PublishDocument::load(path)?;
    let changed = document.remove_addon()?;
    if changed {
        document.save(path)?;
    }
    Ok(RegistryOutcome {
        path: path.to_path_buf(),
        changed,
    })
}

fn is_registered_at(path: &Path) -> Result<bool> {
    let document = PublishDocument::load(path)?;
    Ok(document.find_addon_span().is_some())
}

/// publish.xml 的最小改写器。
///
/// 只替换/插入我们自己的 `<jspluginonline>` 节点，其余内容（其他插件、注释、
/// 缩进与换行风格）逐字节保留，避免破坏 WPS 自己维护的清单。
#[derive(Debug)]
struct PublishDocument {
    text: String,
}

impl PublishDocument {
    fn load(path: &Path) -> Result<Self> {
        match fs::read_to_string(path) {
            Ok(text) if !text.trim().is_empty() => {
                let mut document = Self { text };
                document.ensure_root(path)?;
                Ok(document)
            }
            Ok(_) => Ok(Self {
                text: EMPTY_DOCUMENT.to_string(),
            }),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Self {
                text: EMPTY_DOCUMENT.to_string(),
            }),
            Err(error) => Err(error).with_context(|| format!("读取失败: {}", path.display())),
        }
    }

    /// 校验根节点存在；`<jsplugins/>` 这类自闭合根会被展开成成对标签。
    fn ensure_root(&mut self, path: &Path) -> Result<()> {
        if self.find_close_tag(ROOT_TAG).is_some() {
            return Ok(());
        }

        let Some(open_at) = self.text.find(&format!("<{ROOT_TAG}")) else {
            bail!(
                "{} 不是预期的 WPS 加载项清单（缺少 <{ROOT_TAG}> 根节点）；请先让 WPS 生成该文件，或删除后重试",
                path.display()
            );
        };
        let Some((start, end)) = element_span(&self.text, open_at) else {
            bail!("{} 中 <{ROOT_TAG}> 标签格式异常", path.display());
        };
        let newline = detect_newline(&self.text);
        self.text
            .replace_range(start..end, &format!("<{ROOT_TAG}>{newline}</{ROOT_TAG}>"));
        Ok(())
    }

    fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("创建目录失败: {}", parent.display()))?;
        }
        fs::write(path, self.text.as_bytes())
            .with_context(|| format!("写入失败: {}", path.display()))
    }

    fn find_close_tag(&self, tag: &str) -> Option<usize> {
        self.text.rfind(&format!("</{tag}>"))
    }

    /// 找到我们自己的加载项节点区间。
    fn find_addon_span(&self) -> Option<(usize, usize)> {
        let needle = format!("<{ITEM_TAG}");
        let mut search = 0;
        while let Some(index) = self.text[search..].find(&needle) {
            let start = search + index;
            let Some((_, end)) = element_span(&self.text, start) else {
                break;
            };
            let element = &self.text[start..end];
            let name = attribute_value(element, "name").unwrap_or_default();
            let kind = attribute_value(element, "type").unwrap_or_default();
            if name == ADDON_NAME && kind == ADDON_TYPE {
                return Some((start, end));
            }
            search = end;
        }
        None
    }

    fn upsert_addon(&mut self) -> bool {
        let newline = detect_newline(&self.text);
        let canonical = addon_element();
        if let Some((start, end)) = self.find_addon_span() {
            let existing = &self.text[start..end];
            if existing.trim() == canonical {
                return false;
            }
            self.text.replace_range(start..end, &canonical);
            return true;
        }

        let Some(close_at) = self.find_close_tag(ROOT_TAG) else {
            return false;
        };
        let line_start = self.text[..close_at].rfind('\n').map(|at| at + 1).unwrap_or(0);
        let root_indent = &self.text[line_start..close_at];
        let child_indent = format!("{root_indent}  ");

        let single_line = line_start == 0 && !root_indent.is_empty();
        if single_line || !root_indent.chars().all(|ch| ch == ' ' || ch == '\t') {
            // 根标签与内容同行：另起一行插入，保证不破坏原结构。
            let insertion = format!("{newline}{child_indent}{canonical}{newline}{root_indent}");
            self.text.insert_str(close_at, &insertion);
        } else {
            let insertion = format!("{child_indent}{canonical}{newline}");
            self.text.insert_str(line_start, &insertion);
        }
        true
    }

    fn remove_addon(&mut self) -> Result<bool> {
        let Some((start, end)) = self.find_addon_span() else {
            return Ok(false);
        };
        let line_start = self.text[..start].rfind('\n').map(|at| at + 1).unwrap_or(0);
        let line_end = self.text[end..]
            .find('\n')
            .map(|at| end + at + 1)
            .unwrap_or(self.text.len());
        let before = &self.text[line_start..start];
        let after = &self.text[end..line_end];

        if before.trim().is_empty() && after.trim().is_empty() {
            // 整行只包含我们的节点：连行一起删除，不留空行。
            self.text.replace_range(line_start..line_end, "");
        } else {
            self.text.replace_range(start..end, "");
        }
        Ok(true)
    }
}

/// 我们写入的节点内容，属性顺序与 WPS 自身生成的一致。
fn addon_element() -> String {
    format!(
        "<{ITEM_TAG} name=\"{ADDON_NAME}\" type=\"{ADDON_TYPE}\" url=\"{ADDON_URL}\" enable=\"enable_dev\" debug=\"\" install=\"null\" customDomain=\"\" />"
    )
}

fn detect_newline(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

/// 从 `from` 处的 `<` 开始，返回该元素的完整字节区间 `[start, end)`。
fn element_span(text: &str, from: usize) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    if bytes.get(from) != Some(&b'<') || bytes.get(from + 1) == Some(&b'/') {
        return None;
    }

    let name_start = from + 1;
    let name_end = name_start
        + text[name_start..]
            .find(|ch: char| ch.is_ascii_whitespace() || ch == '>' || ch == '/')?;
    let name = &text[name_start..name_end];

    let mut index = name_end;
    let mut quote: Option<u8> = None;
    while index < bytes.len() {
        let byte = bytes[index];
        match quote {
            Some(open) => {
                if byte == open {
                    quote = None;
                }
            }
            None => match byte {
                b'"' | b'\'' => quote = Some(byte),
                b'>' => break,
                _ => {}
            },
        }
        index += 1;
    }
    if index >= bytes.len() {
        return None;
    }

    if bytes[index - 1] == b'/' {
        return Some((from, index + 1));
    }

    let close_tag = format!("</{name}>");
    let close_at = text[index + 1..].find(&close_tag)?;
    Some((from, index + 1 + close_at + close_tag.len()))
}

/// 读取标签内的属性值，要求属性名左侧有分隔符，避免子串误匹配。
fn attribute_value(element: &str, attribute: &str) -> Option<String> {
    let bytes = element.as_bytes();
    let mut search = 0;
    while let Some(index) = element[search..].find(attribute) {
        let at = search + index;
        search = at + attribute.len();

        let left_ok = at == 0
            || matches!(
                bytes[at - 1],
                b' ' | b'\t' | b'\r' | b'\n' | b'<' | b'"' | b'\''
            );
        if !left_ok {
            continue;
        }

        let rest = element[at + attribute.len()..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else {
            continue;
        };
        let rest = rest.trim_start();
        let quote = rest.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        let value_start = 1;
        let value_end = rest[value_start..].find(quote)? + value_start;
        return Some(rest[value_start..value_end].to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 每个用例用独立的临时 publish.xml，顺带覆盖 load/save 与根节点校验。
    struct Sandbox {
        dir: PathBuf,
    }

    impl Sandbox {
        fn new(tag: &str) -> Self {
            let dir = env::temp_dir().join(format!("codex-registry-{tag}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("创建临时目录");
            Self { dir }
        }

        fn path(&self) -> PathBuf {
            self.dir.join("publish.xml")
        }

        fn write(&self, text: &str) -> PathBuf {
            let path = self.path();
            fs::write(&path, text).expect("写入临时清单");
            path
        }

        fn load(&self) -> PublishDocument {
            PublishDocument::load(&self.path()).expect("加载清单")
        }

        fn read(&self) -> String {
            fs::read_to_string(self.path()).expect("读取清单")
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn upsert_inserts_addon_into_existing_document() {
        let sandbox = Sandbox::new("insert");
        sandbox.write(
            "<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>\r\n<jsplugins>\r\n  <jspluginonline name=\"other\" type=\"wps\" url=\"http://127.0.0.1:1234/\" />\r\n</jsplugins>\r\n",
        );

        let mut doc = sandbox.load();
        assert!(doc.upsert_addon());
        doc.save(&sandbox.path()).expect("保存");

        let text = sandbox.read();
        assert!(text.contains("name=\"other\""));
        assert!(text.contains(&format!("  {}\r\n</jsplugins>", addon_element())));
    }

    #[test]
    fn upsert_is_idempotent() {
        let sandbox = Sandbox::new("idempotent");
        sandbox.write(&format!(
            "<jsplugins>\r\n  {}\r\n</jsplugins>\r\n",
            addon_element()
        ));

        let mut doc = sandbox.load();
        assert!(!doc.upsert_addon());
    }

    #[test]
    fn upsert_updates_stale_addon_attributes() {
        let sandbox = Sandbox::new("stale");
        sandbox.write(
            "<jsplugins>\r\n  <jspluginonline name=\"codex-for-wps-word-local-addin\" type=\"wps\" url=\"http://127.0.0.1:5173/\" />\r\n</jsplugins>\r\n",
        );

        let mut doc = sandbox.load();
        assert!(doc.upsert_addon());

        assert!(!doc.text.contains("5173"));
        assert!(doc.text.contains(ADDON_URL));
    }

    #[test]
    fn upsert_expands_self_closing_root() {
        let sandbox = Sandbox::new("selfclosing");
        sandbox.write("<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n<jsplugins/>\r\n");

        let mut doc = sandbox.load();
        assert!(doc.upsert_addon());

        assert!(doc.text.contains("<jsplugins>"));
        assert!(doc.text.ends_with("</jsplugins>\r\n"));
        assert!(doc.text.contains(ADDON_NAME));
    }

    #[test]
    fn upsert_keeps_single_line_root_well_formed() {
        let sandbox = Sandbox::new("singleline");
        sandbox.write("<jsplugins></jsplugins>");

        let mut doc = sandbox.load();
        assert!(doc.upsert_addon());

        assert!(doc.text.starts_with("<jsplugins>"));
        assert!(doc.text.ends_with("</jsplugins>"));
        assert!(doc.text.contains(ADDON_NAME));
    }

    #[test]
    fn upsert_creates_document_when_file_missing() {
        let sandbox = Sandbox::new("missing");

        let mut doc = sandbox.load();
        assert!(doc.upsert_addon());
        doc.save(&sandbox.path()).expect("保存");

        let text = sandbox.read();
        assert!(text.starts_with("<?xml"));
        assert!(text.contains(ADDON_NAME));
        assert!(text.contains("</jsplugins>"));
    }

    #[test]
    fn remove_addon_keeps_other_plugins() {
        let sandbox = Sandbox::new("remove");
        sandbox.write(&format!(
            "<jsplugins>\r\n  {}\r\n  <jspluginonline name=\"other\" type=\"wps\" url=\"http://127.0.0.1:1234/\" />\r\n</jsplugins>\r\n",
            addon_element()
        ));

        let mut doc = sandbox.load();
        assert!(doc.remove_addon().expect("remove"));
        doc.save(&sandbox.path()).expect("保存");

        let text = sandbox.read();
        assert!(!text.contains(ADDON_NAME));
        assert!(text.contains("name=\"other\""));
        assert_eq!(text.matches("<jspluginonline").count(), 1);
    }

    #[test]
    fn remove_addon_reports_missing_node() {
        let sandbox = Sandbox::new("remove-missing");
        sandbox.write("<jsplugins>\r\n</jsplugins>\r\n");

        let mut doc = sandbox.load();
        assert!(!doc.remove_addon().expect("remove"));
    }

    #[test]
    fn register_and_unregister_round_trip_through_file() {
        let sandbox = Sandbox::new("roundtrip");
        let path = sandbox.path();

        let registered = register_at(&path).expect("注册");
        assert!(registered.changed);
        assert!(is_registered_at(&path).expect("查询注册状态"));

        let again = register_at(&path).expect("重复注册");
        assert!(!again.changed);

        let removed = unregister_at(&path).expect("取消注册");
        assert!(removed.changed);
        assert!(!is_registered_at(&path).expect("查询注册状态"));
    }

    #[test]
    fn attribute_value_requires_whole_attribute_name() {
        let element = "<jspluginonline name=\"target\" customDomain=\"\" install=\"null\" />";

        assert_eq!(attribute_value(element, "name").as_deref(), Some("target"));
        assert_eq!(attribute_value(element, "install").as_deref(), Some("null"));
        assert_eq!(attribute_value(element, "customDomain").as_deref(), Some(""));
        assert_eq!(attribute_value(element, "stall").as_deref(), None);
        assert_eq!(attribute_value(element, "custom").as_deref(), None);
    }

    #[test]
    fn element_span_handles_quoted_angle_brackets() {
        let element = "<jspluginonline name=\"a>b\" url=\"http://x/\" />";
        let text = format!("{element}rest");

        assert_eq!(element_span(&text, 0), Some((0, element.len())));
    }

    #[test]
    fn ensure_root_rejects_unexpected_document() {
        let sandbox = Sandbox::new("bad-root");
        sandbox.write("<other>\r\n</other>\r\n");

        let error = PublishDocument::load(&sandbox.path()).expect_err("应报错");
        assert!(error.to_string().contains("jsplugins"));
    }
}
