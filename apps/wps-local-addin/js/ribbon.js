const DEFAULT_PANEL_URL = "http://127.0.0.1:5173/index.html";
const SERVICE_ACTION_PATH_PREFIX = "/__codex/service/";
const TASKPANE_KEY = "codex_taskpane_id";
const TASKPANE_URL_KEY = "codex_taskpane_url";
const PANEL_URL_KEY = "codex_panel_url";
const PANEL_START_DELAY_MS = 6000;
const SERVICE_STATUS_DELAY_MS = 9000;
let openPanelTimer = null;
let openingPanel = false;
let cachedTaskPane = null;
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

function ensurePanelUrl() {
  const current = getPanelUrl();
  if (!current || current.indexOf("127.0.0.1:3889") >= 0 || current.indexOf("about:blank") >= 0) {
    setPanelUrl(DEFAULT_PANEL_URL);
    return DEFAULT_PANEL_URL;
  }
  return current;
}

function getOrCreateTaskPane(forceRecreate) {
  const app = getApp();
  if (!app) return null;

  const panelUrl = ensurePanelUrl();
  if (!forceRecreate && cachedTaskPane) {
    return cachedTaskPane;
  }

  let taskpaneId = app.PluginStorage.getItem(TASKPANE_KEY);
  if (!forceRecreate && taskpaneId) {
    try {
      const existing = app.GetTaskPane(taskpaneId);
      if (existing) {
        cachedTaskPane = existing;
        return existing;
      }
    } catch (_error) {
      app.PluginStorage.setItem(TASKPANE_KEY, "");
      app.PluginStorage.setItem(TASKPANE_URL_KEY, "");
    }
  }

  const pane = app.CreateTaskPane(panelUrl);
  cachedTaskPane = pane;
  app.PluginStorage.setItem(TASKPANE_KEY, pane.ID);
  app.PluginStorage.setItem(TASKPANE_URL_KEY, panelUrl);
  return pane;
}

function getExistingTaskPane() {
  const app = getApp();
  if (!app) return null;
  if (cachedTaskPane) return cachedTaskPane;

  const taskpaneId = app.PluginStorage.getItem(TASKPANE_KEY);
  if (!taskpaneId) return null;
  try {
    const pane = app.GetTaskPane(taskpaneId);
    if (pane) cachedTaskPane = pane;
    return pane || null;
  } catch (_error) {
    app.PluginStorage.setItem(TASKPANE_KEY, "");
    app.PluginStorage.setItem(TASKPANE_URL_KEY, "");
    return null;
  }
}

function clearTaskPaneCache() {
  const app = getApp();
  cachedTaskPane = null;
  if (!app) return;
  try {
    app.PluginStorage.setItem(TASKPANE_KEY, "");
    app.PluginStorage.setItem(TASKPANE_URL_KEY, "");
  } catch (_error) {
  }
}

function activateTaskPane(pane) {
  const app = getApp();
  if (!app || !pane) return false;
  try {
    pane.Visible = true;
    pane.DockPosition = app.Enum ? app.Enum.msoCTPDockPositionRight : 2;
    cachedTaskPane = pane;
    return true;
  } catch (_error) {
    clearTaskPaneCache();
    return false;
  }
}

function showTaskPane() {
  const app = getApp();
  if (!app) return;
  let pane = getExistingTaskPane();
  if (!pane) {
    pane = getOrCreateTaskPane(false);
  }
  if (!pane) return;
  activateTaskPane(pane);
}

function OnAddinLoad(ribbonUI) {
  const app = getApp();
  if (!app) return true;
  if (typeof app.ribbonUI !== "object") {
    app.ribbonUI = ribbonUI;
  }
  return true;
}

function buildServiceActionUrl(action) {
  return getUrlBase() + SERVICE_ACTION_PATH_PREFIX + encodeURIComponent(action);
}

function requestServiceAction(action, callback) {
  const xhr = new XMLHttpRequest();
  xhr.open("POST", buildServiceActionUrl(action), true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;

    const status = xhr.status === 1223 ? 204 : xhr.status;
    let payload = null;
    try {
      payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
    } catch (_error) {
    }

    if (payload && payload.logDir) {
      serviceLogDir = payload.logDir;
    }

    if (status >= 200 && status < 300 && payload && payload.ok) {
      callback(null, payload);
      return;
    }

    const errorText = (payload && payload.error) || ("HTTP " + status);
    callback(new Error(errorText), payload);
  };

  try {
    xhr.send("{}");
  } catch (error) {
    callback(error, null);
  }
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
    const input = prompt("请输入面板地址（默认 http://127.0.0.1:5173/index.html）", current);
    if (input === null) return true;
    const normalized = normalizePanelUrl(input);
    if (!normalized) {
      alert("地址不能为空");
      return true;
    }
    setPanelUrl(normalized);
    cachedTaskPane = null;
    app.PluginStorage.setItem(TASKPANE_KEY, "");
    app.PluginStorage.setItem(TASKPANE_URL_KEY, "");
    alert("面板地址已更新为: " + normalized);
    return true;
  }

  if (control.Id === "btnTogglePanel") {
    const existing = getExistingTaskPane();
    if (existing && activateTaskPane(existing)) {
      return true;
    }
    if (openingPanel) {
      return true;
    }

    openingPanel = true;
    requestServiceAction("start", function (_error) {
    });
    if (openPanelTimer) {
      clearTimeout(openPanelTimer);
      openPanelTimer = null;
    }
    openPanelTimer = setTimeout(function () {
      openPanelTimer = null;
      try {
        showTaskPane();
      } catch (_error) {
      } finally {
        openingPanel = false;
      }
    }, PANEL_START_DELAY_MS);
    return true;
  }

  return true;
}

function OnGetEnabled(_control) {
  return true;
}
