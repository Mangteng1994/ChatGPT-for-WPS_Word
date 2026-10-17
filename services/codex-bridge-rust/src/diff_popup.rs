use crate::protocol::{DiffPopupOpenRequest, DiffPopupOpenResponse, DiffPopupVersionResponse};
use anyhow::Result;
use std::{
    collections::HashMap,
    process::Command,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct DiffPopupEntry {
    pub data: DiffPopupOpenRequest,
    pub expires_at: Instant,
    pub version: u64,
}

#[derive(Debug, Clone, Default)]
pub struct DiffPopupStore {
    pub active_token: Option<String>,
    pub entries: HashMap<String, DiffPopupEntry>,
}

#[derive(Debug, Clone)]
pub struct DiffPopupSnapshot {
    pub data: DiffPopupOpenRequest,
    pub version: u64,
}

const DIFF_POPUP_TTL_MS: u64 = 10 * 60 * 1000;

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn generate_token() -> String {
    Uuid::new_v4().to_string().replace('-', "")
}

fn open_system_browser(url: &str) {
    #[cfg(windows)]
    {
        let result = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "Start-Process",
                url,
            ])
            .spawn();
        if let Err(error) = result {
            eprintln!("[diff-popup] Failed to open browser: {error}");
        }
        return;
    }

    #[cfg(target_os = "macos")]
    {
        let result = Command::new("open").arg(url).spawn();
        if let Err(error) = result {
            eprintln!("[diff-popup] Failed to open browser: {error}");
        }
        return;
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let result = Command::new("xdg-open").arg(url).spawn();
        if let Err(error) = result {
            eprintln!("[diff-popup] Failed to open browser: {error}");
        }
    }
}

fn cleanup_store(store: &mut DiffPopupStore) {
    let now = Instant::now();
    let mut expired = Vec::new();
    for (token, entry) in &store.entries {
        if now > entry.expires_at {
            expired.push(token.clone());
        }
    }

    for token in expired {
        store.entries.remove(&token);
        if store.active_token.as_deref() == Some(token.as_str()) {
            store.active_token = None;
        }
    }
}

fn default_expiry() -> Instant {
    Instant::now() + Duration::from_millis(DIFF_POPUP_TTL_MS)
}

fn build_diff_popup_html(data: &DiffPopupOpenRequest, token: &str, version: u64) -> String {
    let default_view = match data.default_view.as_str() {
        "side" => "side",
        "merged" => "merged",
        "comprehensive" => "comprehensive",
        _ => "comprehensive",
    };
    let title = "段落差异对比";
    let mut html = DIFF_POPUP_TEMPLATE
        .replace("__TITLE__", &escape_html(title))
        .replace("__DEFAULT_VIEW_JSON__", &serde_json::to_string(default_view).unwrap())
        .replace("__TOKEN_JSON__", &serde_json::to_string(token).unwrap())
        .replace("__VERSION__", &version.to_string())
        .replace("__COPY_TEXT_JSON__", &serde_json::to_string(&data.copy_text).unwrap())
        .replace("__SIDE_HIDDEN__", if default_view == "side" { "" } else { " hidden" })
        .replace("__MERGED_HIDDEN__", if default_view == "merged" { "" } else { " hidden" })
        .replace(
            "__COMPREHENSIVE_HIDDEN__",
            if default_view == "comprehensive" { "" } else { " hidden" },
        )
        .replace("__SIDE_ACTIVE__", if default_view == "side" { " is-active" } else { "" })
        .replace("__MERGED_ACTIVE__", if default_view == "merged" { " is-active" } else { "" })
        .replace(
            "__COMPREHENSIVE_ACTIVE__",
            if default_view == "comprehensive" { " is-active" } else { "" },
        )
        .replace("__SIDE_HTML__", &data.side_html)
        .replace("__MERGED_HTML__", &data.merged_html)
        .replace("__COMPREHENSIVE_HTML__", &data.comprehensive_html);
    html.shrink_to_fit();
    html
}

const DIFF_POPUP_TEMPLATE: &str = r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;font-size:14px;color:#1a1a1a;background:#fff;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.cw-diff-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #ddd;background:#fafafa}
.cw-diff-toolbar__label{font-size:12px;color:#888}
.cw-diff-toolbar__btn{height:28px;padding:0 12px;border:1px solid #ccc;border-radius:5px;background:#fff;color:#333;font-size:12px;cursor:pointer}
.cw-diff-toolbar__btn.is-active{background:#1d7f63;color:#fff;border-color:#1d7f63}
.cw-diff-toolbar__spacer{flex:1}
.cw-diff-main{flex:1 1 auto;min-height:0}
.cw-diff-view{flex:1 1 auto;min-height:0;height:100%}
.cw-diff-view[hidden]{display:none!important}
.cw-diff-view--side{overflow:hidden}
.cw-diff-view--merged{overflow:auto}
.cw-diff-view--comprehensive{overflow:auto;padding:12px}
.cw-diff-columns{flex:1 1 auto;min-height:0;display:flex;flex-direction:row;overflow:hidden;height:100%}
.cw-diff-column{flex:1 1 50%;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.cw-diff-column--left{border-right:1px solid #ddd}
.cw-diff-column__title{flex:0 0 auto;padding:8px 14px;font-size:11px;font-weight:600;color:#888;border-bottom:1px solid #ddd;background:#f8f8f8}
.cw-diff-column__body{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;background:#fcfcfc}
.cw-diff-paragraph{margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.85;font-size:14px}
.cw-diff-merged{flex:1 1 auto;min-height:0;overflow:auto;padding:14px;background:#fcfcfc}
.cw-diff-merged-paragraph{margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.85;font-size:14px}
.cw-diff-added{display:inline;background:#d4edda;color:#1a5c34;border-radius:2px;padding:1px 2px}
.cw-diff-removed{display:inline;background:#fde2e2;color:#9b2525;text-decoration:line-through;border-radius:2px;padding:1px 2px}
.cw-diff-nochange-message{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;color:#888}
.cw-diff-section{border:1px solid #ddd;border-radius:8px;overflow:hidden;background:#fff}
.cw-diff-section+.cw-diff-section{margin-top:12px}
.cw-diff-section h3{margin:0;padding:8px 14px;font-size:12px;color:#666;background:#f8f8f8;border-bottom:1px solid #ddd}
.cw-diff-section--side .cw-diff-columns{height:260px}
@media(max-width:800px){.cw-diff-columns{flex-direction:column}.cw-diff-column--left{border-right:none;border-bottom:1px solid #ddd}}
</style>
</head>
<body>
<div class="cw-diff-toolbar">
<span class="cw-diff-toolbar__label">视图：</span>
<button class="cw-diff-toolbar__btn__SIDE_ACTIVE__" data-view="side" id="btn-side" type="button">左右视图</button>
<button class="cw-diff-toolbar__btn__MERGED_ACTIVE__" data-view="merged" id="btn-merged" type="button">合并视图</button>
<button class="cw-diff-toolbar__btn__COMPREHENSIVE_ACTIVE__" data-view="comprehensive" id="btn-comprehensive" type="button">综合视图</button>
<span class="cw-diff-toolbar__spacer"></span>
<button class="cw-diff-toolbar__btn" id="btn-copy" type="button">复制对比结果</button>
<button class="cw-diff-toolbar__btn" id="btn-close" type="button">关闭</button></div>
<main class="cw-diff-main">
<div id="side-view" class="cw-diff-view cw-diff-view--side__SIDE_HIDDEN__">__SIDE_HTML__</div>
<div id="merged-view" class="cw-diff-view cw-diff-view--merged__MERGED_HIDDEN__">__MERGED_HTML__</div>
<div id="comprehensive-view" class="cw-diff-view cw-diff-view--comprehensive__COMPREHENSIVE_HIDDEN__">__COMPREHENSIVE_HTML__</div>
</main>
<script>
(function(){
var TOKEN=__TOKEN_JSON__;
var CURRENT_VERSION=__VERSION__;
var POLL_INTERVAL=2000;
var defaultView=__DEFAULT_VIEW_JSON__;
function setHidden(id,h){var e=document.getElementById(id);if(e)e.hidden=h;}
function setActive(id,a){var e=document.getElementById(id);if(e)e.classList.toggle("is-active",a);}
function switchView(v){if(v!=="side"&&v!=="merged"&&v!=="comprehensive")v="comprehensive";setHidden("side-view",v!=="side");setHidden("merged-view",v!=="merged");setHidden("comprehensive-view",v!=="comprehensive");setActive("btn-side",v==="side");setActive("btn-merged",v==="merged");setActive("btn-comprehensive",v==="comprehensive");}
function copyResult(){var t=__COPY_TEXT_JSON__;if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){var b=document.getElementById("btn-copy");if(!b)return;var o=b.textContent;b.textContent="已复制！";setTimeout(function(){b.textContent=o;},1500)}).catch(function(){})}}
function pollVersion(){
fetch('/diff-popup/version/'+TOKEN).then(function(r){return r.json();}).then(function(d){
if(d.expired){window.location.reload();return;}
if(d.version>CURRENT_VERSION){window.location.reload();}
}).catch(function(){});
}
setInterval(pollVersion,POLL_INTERVAL);
document.addEventListener("DOMContentLoaded",function(){
var btns=document.querySelectorAll("[data-view]");
for(var i=0;i<btns.length;i+=1){btns[i].addEventListener("click",function(){switchView(this.getAttribute("data-view")||"comprehensive");});}
var cb=document.getElementById("btn-copy");if(cb)cb.addEventListener("click",copyResult);
var cl=document.getElementById("btn-close");if(cl)cl.addEventListener("click",function(){window.close();});
switchView(defaultView);
});
})();
</script>
</body>
</html>"#;

pub async fn open_diff_popup(
    store: &Mutex<DiffPopupStore>,
    bind_host: &str,
    bind_port: u16,
    payload: DiffPopupOpenRequest,
) -> Result<DiffPopupOpenResponse> {
    if payload.default_view.trim().is_empty()
        || payload.side_html.trim().is_empty()
        || payload.merged_html.trim().is_empty()
        || payload.comprehensive_html.trim().is_empty()
    {
        return Ok(DiffPopupOpenResponse {
            ok: false,
            url: None,
            error: Some(
                "Missing required fields: defaultView, sideHtml, mergedHtml, comprehensiveHtml".to_string(),
            ),
        });
    }

    let mut state = store.lock().await;
    cleanup_store(&mut state);

    let url = if let Some(token) = state.active_token.clone() {
        if let Some(entry) = state.entries.get_mut(&token) {
            entry.data = payload.clone();
            entry.version += 1;
            entry.expires_at = default_expiry();
            format!("http://{bind_host}:{bind_port}/diff-popup/{token}")
        } else {
            let token = generate_token();
            state.active_token = Some(token.clone());
            state.entries.insert(
                token.clone(),
                DiffPopupEntry {
                    data: payload.clone(),
                    expires_at: default_expiry(),
                    version: 1,
                },
            );
            format!("http://{bind_host}:{bind_port}/diff-popup/{token}")
        }
    } else {
        let token = generate_token();
        state.active_token = Some(token.clone());
        state.entries.insert(
            token.clone(),
            DiffPopupEntry {
                data: payload.clone(),
                expires_at: default_expiry(),
                version: 1,
            },
        );
        format!("http://{bind_host}:{bind_port}/diff-popup/{token}")
    };
    let token = state.active_token.clone().unwrap_or_default();
    let should_open = state
        .entries
        .get(&token)
        .map(|entry| entry.version == 1)
        .unwrap_or(false);
    drop(state);

    if should_open {
        open_system_browser(&url);
    }

    Ok(DiffPopupOpenResponse {
        ok: true,
        url: Some(url),
        error: None,
    })
}

pub async fn diff_popup_snapshot(
    store: &Mutex<DiffPopupStore>,
    token: &str,
) -> Option<DiffPopupSnapshot> {
    let mut state = store.lock().await;
    cleanup_store(&mut state);
    state.entries.get(token).map(|entry| DiffPopupSnapshot {
        data: entry.data.clone(),
        version: entry.version,
    })
}

pub async fn diff_popup_version(
    store: &Mutex<DiffPopupStore>,
    token: &str,
) -> DiffPopupVersionResponse {
    let mut state = store.lock().await;
    cleanup_store(&mut state);
    if let Some(entry) = state.entries.get(token) {
        return DiffPopupVersionResponse {
            version: entry.version,
            expired: false,
        };
    }
    DiffPopupVersionResponse {
        version: 0,
        expired: true,
    }
}

pub async fn diff_popup_html(
    store: &Mutex<DiffPopupStore>,
    token: &str,
) -> Option<String> {
    diff_popup_snapshot(store, token)
        .await
        .map(|snapshot| build_diff_popup_html(&snapshot.data, token, snapshot.version))
}

pub fn expired_page_html() -> String {
    "<!doctype html><html><body><p style=\"text-align:center;padding:48px;color:#888\">对比数据已过期，请从 WPS 面板重新触发对比。</p></body></html>".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_replaces_token_and_default_view() {
        let data = DiffPopupOpenRequest {
            default_view: "merged".to_string(),
            side_html: "<p>left</p>".to_string(),
            merged_html: "<p>merged</p>".to_string(),
            comprehensive_html: "<p>full</p>".to_string(),
            copy_text: "copy".to_string(),
            original: None,
            updated: None,
        };
        let html = build_diff_popup_html(&data, "token123", 2);
        assert!(html.contains("token123"));
        assert!(html.contains("merged"));
        assert!(html.contains("copy"));
    }
}
