const DEFAULT_PANEL_URL = "http://127.0.0.1:5173/index.html";
const PROJECT_ROOT = "E:\\G_Disk\\CodeTest\\codex_for_word\\codex-for-wps-word";
const TASKPANE_KEY = "codex_taskpane_id";
const TASKPANE_URL_KEY = "codex_taskpane_url";
const PANEL_URL_KEY = "codex_panel_url";
const START_SCRIPT_PATH = PROJECT_ROOT + "\\scripts\\start-local-services.ps1";
const STOP_SCRIPT_PATH = PROJECT_ROOT + "\\scripts\\stop-local-services.ps1";
const CHECK_SCRIPT_PATH = PROJECT_ROOT + "\\scripts\\check-local-services.ps1";
const SERVICE_LOG_DIR = PROJECT_ROOT + "\\logs";
const PANEL_START_DELAY_MS = 6000;
const SERVICE_STATUS_DELAY_MS = 9000;
let openPanelTimer = null;
let openingPanel = false;
let cachedTaskPane = null;

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

function runPowerShellScript(scriptPath) {
  const app = getApp();
  const command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + scriptPath + '"';
  app.OAAssist.ShellExecute(command);
}

function runPowerShellCommand(commandText) {
  const app = getApp();
  app.OAAssist.ShellExecute('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "' + commandText + '"');
}

function scheduleServiceStatusReport() {
  setTimeout(function () {
    const statusPath = SERVICE_LOG_DIR + "\\last-service-check.txt";
    const command = "Add-Type -AssemblyName System.Windows.Forms; " +
      "& '" + CHECK_SCRIPT_PATH + "' *> '" + statusPath + "'; " +
      "$text = Get-Content -LiteralPath '" + statusPath + "' -Raw; " +
      "[System.Windows.Forms.MessageBox]::Show($text, 'Codex 本地服务状态') | Out-Null";
    runPowerShellCommand(command);
  }, SERVICE_STATUS_DELAY_MS);
}

function OnAction(control) {
  const app = getApp();
  if (!app) {
    alert("未检测到 WPS Application。请在 WPS 本地客户端中运行。");
    return true;
  }

  if (control.Id === "btnStartServices") {
    runPowerShellScript(START_SCRIPT_PATH);
    alert("已开始启动本地服务，稍后会显示健康检查结果。日志目录: " + SERVICE_LOG_DIR);
    scheduleServiceStatusReport();
    return true;
  }

  if (control.Id === "btnStopServices") {
    runPowerShellScript(STOP_SCRIPT_PATH);
    const taskpaneId = app.PluginStorage.getItem(TASKPANE_KEY);
    if (taskpaneId) {
      try {
        const pane = app.GetTaskPane(taskpaneId);
        if (pane) pane.Visible = false;
      } catch (_error) {
      }
    }
    alert("已尝试关闭 bridge 和面板服务。");
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
    runPowerShellScript(START_SCRIPT_PATH);
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
