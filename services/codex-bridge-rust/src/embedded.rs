//! 内嵌静态资源（`embedded-assets` feature）。
//!
//! feature 关闭时所有查询都返回空，调用点不需要写 cfg 分支；
//! 开启时由 `build.rs` 生成的表把加载项与面板资源编进可执行文件，
//! 打包出来的单文件不再依赖同目录的 `addin/` 与 `panel/`。

/// 静态资源来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetKind {
    /// WPS 加载项：`manifest.xml`、`ribbon.xml`、taskpane 等。
    Addin,
    /// 面板前端构建产物。
    Panel,
}

/// 查找内嵌资源；`relative` 用 `/` 分隔，不含前导斜杠。
pub fn lookup(kind: AssetKind, relative: &str) -> Option<&'static [u8]> {
    #[cfg(feature = "embedded-assets")]
    {
        return generated::assets(kind)
            .iter()
            .find(|(name, _)| *name == relative)
            .map(|(_, bytes)| *bytes);
    }
    #[cfg(not(feature = "embedded-assets"))]
    {
        let _ = (kind, relative);
        None
    }
}

/// 该来源是否编入了任何资源。
pub fn has_assets(kind: AssetKind) -> bool {
    #[cfg(feature = "embedded-assets")]
    {
        return !generated::assets(kind).is_empty();
    }
    #[cfg(not(feature = "embedded-assets"))]
    {
        let _ = kind;
        false
    }
}

#[cfg(feature = "embedded-assets")]
mod generated {
    include!(concat!(env!("OUT_DIR"), "/embedded_assets.rs"));

    pub fn assets(kind: super::AssetKind) -> &'static [(&'static str, &'static [u8])] {
        match kind {
            super::AssetKind::Addin => ADDIN_ASSETS,
            super::AssetKind::Panel => PANEL_ASSETS,
        }
    }
}

#[cfg(all(test, feature = "embedded-assets"))]
mod tests {
    use super::*;

    #[test]
    fn addin_manifest_is_embedded() {
        let bytes = lookup(AssetKind::Addin, "manifest.xml").expect("应内嵌加载项 manifest.xml");
        let text = std::str::from_utf8(bytes).expect("加载项清单应为 UTF-8");
        assert!(text.contains("CodexForWpsWord"), "清单内容异常: {text:?}");
    }

    #[test]
    fn panel_index_is_embedded() {
        let bytes = lookup(AssetKind::Panel, "index.html").expect("应内嵌面板 index.html");
        assert!(!bytes.is_empty());
        assert!(std::str::from_utf8(bytes).is_ok());
        assert!(has_assets(AssetKind::Panel));
    }

    #[test]
    fn missing_assets_return_none() {
        assert!(lookup(AssetKind::Panel, "missing.js").is_none());
        assert!(lookup(AssetKind::Addin, "../secret.txt").is_none());
    }
}
