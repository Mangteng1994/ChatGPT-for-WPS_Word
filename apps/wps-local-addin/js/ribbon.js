const DEFAULT_PANEL_URL = "http://127.0.0.1:5173/index.html";
const TASKPANE_BOOTSTRAP_URL = "http://127.0.0.1:3889/taskpane-loader.html";
const SERVICE_ACTION_PATH_PREFIX = "/__codex/service/";
const SERVICE_ACTION_ORIGIN_FALLBACKS = ["http://127.0.0.1:3889", "http://localhost:3889"];
const TASKPANE_KEY = "codex_taskpane_id";
const TASKPANE_URL_KEY = "codex_taskpane_url";
const PANEL_URL_KEY = "codex_panel_url";
const SERVICE_STATUS_DELAY_MS = 9000;
let openingPanel = false;
let serviceLogDir = "logs";

function getApp() {
  return window.Application || window.wps || null;
}

function getPanelUrl() {
  const app = getApp();
  if (!app) return DEFAULT_PANEL_URL;
  try {
    const saved = app.PluginStorage.getItem(PANEL_URL_KEY);
    const normalized = normalizePanelUrl(saved);
    if (normalized && normalized.indexOf("127.0.0.1:5174") >= 0) {
      const migrated = normalized.replace("127.0.0.1:5174", "127.0.0.1:5173");
      setPanelUrl(migrated);
      return migrated;
    }
    return normalized || DEFAULT_PANEL_URL;
  } catch (_err) {
    return DEFAULT_PANEL_URL;
  }
}

function setPanelUrl(url) {
  const app = getApp();
  if (!app) return;
  app.PluginStorage.setItem(PANEL_URL_KEY, url);
}

function normalizePanelUrl(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(normalized)) return "";
  return normalized;
}

function ensurePanelUrl() {
  const current = getPanelUrl();
  if (!current || current.indexOf("127.0.0.1:3889") >= 0 || current.indexOf("about:blank") >= 0) {
    setPanelUrl(DEFAULT_PANEL_URL);
    return DEFAULT_PANEL_URL;
  }
  return current;
}

function clearTaskPaneCache() {
  const app = getApp();
  if (!app) return;
  try {
    app.PluginStorage.setItem(TASKPANE_KEY, "");
    app.PluginStorage.setItem(TASKPANE_URL_KEY, "");
  } catch (_error) {
  }
}

function getExistingTaskPane() {
  const app = getApp();
  if (!app) return null;

  let taskpaneId = "";
  try {
    taskpaneId = app.PluginStorage.getItem(TASKPANE_KEY);
  } catch (_error) {
    return null;
  }
  if (!taskpaneId) return null;

  try {
    const pane = app.GetTaskPane(taskpaneId);
    if (pane) return pane;
  } catch (_error) {
  }
  clearTaskPaneCache();
  return null;
}

function getOrCreateTaskPane(forceRecreate) {
  const app = getApp();
  if (!app) throw new Error("未检测到 WPS Application。");

  if (!forceRecreate) {
    const existing = getExistingTaskPane();
    if (existing) return existing;
  } else {
    clearTaskPaneCache();
  }

  const panelUrl = ensurePanelUrl();
  const bootstrapUrl = TASKPANE_BOOTSTRAP_URL + "?target=" + encodeURIComponent(panelUrl);
  let pane = null;
  try {
    // Keep CreateTaskPane lightweight. Loading the full Vite application here
    // can block the WPS ribbon callback while the embedded browser initializes.
    pane = app.CreateTaskPane(bootstrapUrl, "Codex for WPS Word");
  } catch (error) {
    throw new Error("WPS 创建面板时出错：" + getErrorMessage(error));
  }
  if (!pane) {
    throw new Error(
      "WPS 拒绝创建面板。引导地址：" + TASKPANE_BOOTSTRAP_URL +
      "。请确认在 WPS 文字的 .doc/.docx 文档中使用。"
    );
  }
  app.PluginStorage.setItem(TASKPANE_KEY, pane.ID);
  app.PluginStorage.setItem(TASKPANE_URL_KEY, panelUrl);
  return pane;
}

function activateTaskPane(pane) {
  const app = getApp();
  if (!app || !pane) return false;
  try {
    let dockPosition = 2;
    if (app.Enum && app.Enum.JSKsoEnum_msoCTPDockPositionRight !== undefined) {
      dockPosition = app.Enum.JSKsoEnum_msoCTPDockPositionRight;
    }
    pane.DockPosition = dockPosition;
    pane.Visible = true;
    return true;
  } catch (error) {
    clearTaskPaneCache();
    throw new Error("WPS 显示面板时出错：" + getErrorMessage(error));
  }
}

function showTaskPane() {
  const app = getApp();
  if (!app) return;
  let pane = getExistingTaskPane();
  if (!pane) {
    pane = getOrCreateTaskPane(false);
  }
  if (!pane) return false;
  try {
    return activateTaskPane(pane);
  } catch (firstError) {
    // WPS can retain a native pane proxy after its owner window changes.
    // Discard it and make one fresh attempt before surfacing the WPS error.
    try {
      pane = getOrCreateTaskPane(true);
      return activateTaskPane(pane);
    } catch (retryError) {
      throw new Error(
        getErrorMessage(firstError) + "；重建面板后仍失败：" + getErrorMessage(retryError)
      );
    }
  }
}

function getErrorMessage(error) {
  if (error && error.message) return String(error.message);
  return String(error || "未知错误");
}

function OnAddinLoad(ribbonUI) {
  const app = getApp();
  if (!app) return true;
  if (typeof app.ribbonUI !== "object") {
    app.ribbonUI = ribbonUI;
  }
  return true;
}

function normalizeBaseUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function getUrlBase() {
  const loc = window.location || document.location;
  if (typeof loc === "string") return loc;
  if (loc && typeof loc.href === "string") return loc.href;
  return "";
}

function getHttpOrigin() {
  const loc = window.location || document.location;
  const protocol = String((loc && loc.protocol) || "").toLowerCase();
  const host = String((loc && loc.host) || "");
  if ((protocol === "http:" || protocol === "https:") && host) {
    return protocol + "//" + host;
  }
  const match = /^(https?:\/\/[^\/]+)/i.exec(getUrlBase());
  return match ? match[1] : "";
}

function buildServiceActionUrls(action) {
  const encodedAction = encodeURIComponent(action);
  const urls = [];
  const seen = {};

  const candidates = [getHttpOrigin(), getUrlBase()].concat(SERVICE_ACTION_ORIGIN_FALLBACKS);
  for (let i = 0; i < candidates.length; i += 1) {
    const base = normalizeBaseUrl(candidates[i]);
    if (!base) continue;
    const url = base + SERVICE_ACTION_PATH_PREFIX + encodedAction;
    if (seen[url]) continue;
    seen[url] = true;
    urls.push(url);
  }

  return urls;
}

function tryParseJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const head = raw.charAt(0);
  if (head !== "{" && head !== "[") return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function looksLikeHtml(text) {
  const raw = String(text || "").toLowerCase();
  return raw.indexOf("<!doctype html") >= 0 || raw.indexOf("<html") >= 0 || raw.indexOf("codex local addin entry") >= 0;
}

function requestServiceAction(action, callback) {
  const urls = buildServiceActionUrls(action);
  if (!urls.length) {
    callback(new Error("未解析到本地服务地址。"), null);
    return;
  }

  let nextIndex = 0;
  let lastError = null;
  let sawHttp200Html = false;

  function finishWithError() {
    if (sawHttp200Html) {
      callback(new Error("服务接口未就绪（返回了网页）。请运行 repair-wps-codex.cmd 修复加载项地址后重试。"), null);
      return;
    }
    callback(lastError || new Error("本地服务接口不可用。"), null);
  }

  function requestNext() {
    if (nextIndex >= urls.length) {
      finishWithError();
      return;
    }

    const targetUrl = urls[nextIndex];
    nextIndex += 1;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", targetUrl, true);
    xhr.timeout = 8000;
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;

      const status = xhr.status === 1223 ? 204 : xhr.status;
      const payload = tryParseJson(xhr.responseText);

      if (payload && payload.logDir) {
        serviceLogDir = payload.logDir;
      }

      if (status >= 200 && status < 300 && payload && payload.ok) {
        callback(null, payload);
        return;
      }

      if (status >= 200 && status < 300 && !payload && looksLikeHtml(xhr.responseText)) {
        sawHttp200Html = true;
        requestNext();
        return;
      }

      if (payload && payload.error) {
        lastError = new Error(payload.error);
      } else {
        lastError = new Error("HTTP " + status);
      }
      requestNext();
    };

    xhr.onerror = function () {
      lastError = new Error("网络请求失败");
      requestNext();
    };

    xhr.ontimeout = function () {
      lastError = new Error("请求超时");
      requestNext();
    };

    try {
      xhr.send("{}");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "请求失败"));
      requestNext();
    }
  }

  requestNext();
}

function scheduleServiceStatusReport() {
  setTimeout(function () {
    requestServiceAction("check", function (error, payload) {
      if (error) {
        alert("读取本地服务状态失败：" + error.message + "\n日志目录: " + serviceLogDir);
        return;
      }
      const text = (payload && payload.output) || "未返回状态文本。";
      alert("Codex 本地服务状态\n\n" + text);
    });
  }, SERVICE_STATUS_DELAY_MS);
}

function OnAction(control) {
  const app = getApp();
  if (!app) {
    alert("未检测到 WPS Application。请在 WPS 本地客户端中运行。");
    return true;
  }

  if (control.Id === "btnStartServices") {
    requestServiceAction("start", function (error) {
      if (error) {
        alert("启动本地服务失败：" + error.message + "\n日志目录: " + serviceLogDir);
        return;
      }
      alert("已开始启动本地服务，稍后会显示健康检查结果。日志目录: " + serviceLogDir);
      scheduleServiceStatusReport();
    });
    return true;
  }

  if (control.Id === "btnStopServices") {
    requestServiceAction("stop", function (error) {
      if (error) {
        const message = String((error && error.message) || "");
        if (message.indexOf("网络请求失败") >= 0 || message.indexOf("HTTP 0") >= 0) {
          alert(
            "本地服务控制接口不可达，通常表示服务已经停止。\n" +
            "如需强制停止，请在项目目录执行：npm run stop:wps-codex\n" +
            "日志目录: " + serviceLogDir
          );
          return;
        }
        alert("关闭本地服务失败：" + error.message + "\n日志目录: " + serviceLogDir);
        return;
      }
      const taskpaneId = app.PluginStorage.getItem(TASKPANE_KEY);
      if (taskpaneId) {
        try {
          const pane = app.GetTaskPane(taskpaneId);
          if (pane) pane.Visible = false;
        } catch (_error) {
        }
      }
      alert("已尝试关闭 bridge 和面板服务。");
    });
    return true;
  }

  if (control.Id === "btnSetPanelUrl") {
    const current = getPanelUrl();
    let input = null;
    try {
      if (typeof app.InputBox !== "function") {
        throw new Error("当前 WPS 版本未提供 InputBox 接口");
      }
      input = app.InputBox("请输入面板地址", "Codex 面板地址", current, undefined, undefined, undefined, undefined, 2);
    } catch (error) {
      alert("无法打开 WPS 输入框：" + getErrorMessage(error) + "\n当前面板地址仍为：" + current);
      return true;
    }
    if (input === false || input === null || input === "") return true;
    const normalized = normalizePanelUrl(input);
    if (!normalized) {
      alert("地址不能为空");
      return true;
    }
    setPanelUrl(normalized);
    clearTaskPaneCache();
    alert("面板地址已更新为: " + normalized);
    return true;
  }

  if (control.Id === "btnTogglePanel") {
    if (openingPanel) {
      return true;
    }

    openingPanel = true;
    // Return from the native Ribbon mouse callback before creating or showing
    // a child window. WPS 12 can otherwise retain mouse capture on the Ribbon,
    // leaving both built-in tabs and the title-bar controls unclickable while
    // the task pane remains visible.
    setTimeout(function () {
      try {
        if (!showTaskPane()) {
          throw new Error("WPS 没有返回任务窗格对象。");
        }
      } catch (error) {
        alert("打开 Codex 面板失败：" + getErrorMessage(error) + "\n日志目录: " + serviceLogDir);
      } finally {
        openingPanel = false;
      }
    }, 0);
    return true;
  }

  return true;
}

function OnGetEnabled(_control) {
  return true;
}
