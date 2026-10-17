const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ribbonSource = fs.readFileSync(
  path.join(__dirname, "..", "apps", "wps-local-addin", "js", "ribbon.js"),
  "utf8"
);

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.get(key) || "";
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function createPane(id, options = {}) {
  const writes = [];
  const pane = { ID: id, writes };
  let dockPosition = null;
  Object.defineProperty(pane, "DockPosition", {
    get() {
      return dockPosition;
    },
    set(value) {
      writes.push("DockPosition");
      dockPosition = value;
    },
  });
  let visible = false;
  Object.defineProperty(pane, "Visible", {
    get() {
      return visible;
    },
    set(value) {
      if (options.failOnVisible) throw new Error("stale native task pane");
      writes.push("Visible");
      visible = value;
    },
  });
  return pane;
}

function loadRibbon(app, options = {}) {
  const alerts = [];
  const context = {
    alert(message) { alerts.push(message); },
    clearTimeout,
    console,
    document: { location: "http://127.0.0.1:3889/index.html" },
    setTimeout,
    window: { Application: app, location: { protocol: "http:", host: "127.0.0.1:3889" } },
    XMLHttpRequest: function XMLHttpRequest() {},
  };
  vm.createContext(context);
  vm.runInContext(ribbonSource, context, { filename: "ribbon.js" });
  context.alerts = alerts;
  if (options.runTimersImmediately) {
    context.setTimeout = (callback) => { callback(); return 1; };
  }
  return context;
}

test("reuses the registered pane without creating duplicate native panes", () => {
  const pane = createPane("pane-1");
  let createCount = 0;
  const app = {
    PluginStorage: createStorage({ codex_taskpane_id: pane.ID }),
    GetTaskPane(id) {
      assert.equal(id, pane.ID);
      return pane;
    },
    CreateTaskPane() {
      createCount += 1;
      return createPane(`created-${createCount}`);
    },
  };
  const ribbon = loadRibbon(app);

  assert.equal(ribbon.showTaskPane(), true);
  assert.equal(ribbon.showTaskPane(), true);
  assert.equal(createCount, 0);
  assert.equal(pane.Visible, true);
  assert.equal(pane.DockPosition, 2);
  assert.deepEqual(pane.writes, ["DockPosition", "Visible", "DockPosition", "Visible"]);
});

test("recreates once when a persisted pane id is no longer valid", () => {
  const replacement = createPane("pane-new");
  let createCount = 0;
  const storage = createStorage({ codex_taskpane_id: "pane-old" });
  const app = {
    PluginStorage: storage,
    GetTaskPane() {
      throw new Error("pane no longer exists");
    },
    CreateTaskPane() {
      createCount += 1;
      return replacement;
    },
  };
  const ribbon = loadRibbon(app);

  assert.equal(ribbon.showTaskPane(), true);
  assert.equal(createCount, 1);
  assert.equal(storage.getItem("codex_taskpane_id"), replacement.ID);
  assert.equal(replacement.Visible, true);
});

test("recovers when GetTaskPane returns a stale native proxy", () => {
  const stalePane = createPane("pane-stale", { failOnVisible: true });
  const replacement = createPane("pane-replacement");
  let createCount = 0;
  const storage = createStorage({ codex_taskpane_id: stalePane.ID });
  const app = {
    PluginStorage: storage,
    GetTaskPane() {
      return stalePane;
    },
    CreateTaskPane() {
      createCount += 1;
      return replacement;
    },
  };
  const ribbon = loadRibbon(app);

  assert.equal(ribbon.showTaskPane(), true);
  assert.equal(createCount, 1);
  assert.equal(storage.getItem("codex_taskpane_id"), replacement.ID);
  assert.equal(replacement.Visible, true);
});

test("resolves the pane again after the active WPS application context changes", () => {
  const paneA = createPane("pane-a");
  const paneB = createPane("pane-b");
  const appA = {
    PluginStorage: createStorage({ codex_taskpane_id: paneA.ID }),
    GetTaskPane() { return paneA; },
    CreateTaskPane() { throw new Error("unexpected create in app A"); },
  };
  const appB = {
    PluginStorage: createStorage({ codex_taskpane_id: paneB.ID }),
    GetTaskPane() { return paneB; },
    CreateTaskPane() { throw new Error("unexpected create in app B"); },
  };
  const ribbon = loadRibbon(appA);

  assert.equal(ribbon.showTaskPane(), true);
  ribbon.window.Application = appB;
  assert.equal(ribbon.showTaskPane(), true);
  assert.equal(paneA.Visible, true);
  assert.equal(paneB.Visible, true);
});

test("reports an actionable error when WPS rejects the task pane URL", () => {
  const app = {
    PluginStorage: createStorage(),
    CreateTaskPane() { return undefined; },
  };
  const ribbon = loadRibbon(app);

  assert.throws(
    () => ribbon.showTaskPane(),
    /WPS 拒绝创建面板.*127\.0\.0\.1:3889\/taskpane-loader\.html/
  );
});

test("uses the WPS InputBox API instead of the browser prompt", () => {
  const storage = createStorage();
  let inputArgs = null;
  const app = {
    PluginStorage: storage,
    InputBox(...args) {
      inputArgs = args;
      return "http://127.0.0.1:5173/index.html";
    },
  };
  const ribbon = loadRibbon(app);

  ribbon.OnAction({ Id: "btnSetPanelUrl" });

  assert.equal(inputArgs[0], "请输入面板地址");
  assert.equal(inputArgs[1], "Codex 面板地址");
  assert.equal(storage.getItem("codex_panel_url"), "http://127.0.0.1:5173/index.html");
});

test("defers task-pane creation until after the native ribbon action returns", () => {
  const storage = createStorage();
  let createCount = 0;
  let deferredOpen = null;
  const app = {
    PluginStorage: storage,
    CreateTaskPane() {
      createCount += 1;
      return createPane("pane-direct");
    },
  };
  const ribbon = loadRibbon(app);
  ribbon.XMLHttpRequest = function XMLHttpRequest() {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };
  ribbon.setTimeout = (callback) => {
    deferredOpen = callback;
    return 1;
  };

  ribbon.OnAction({ Id: "btnTogglePanel" });

  assert.equal(createCount, 0);
  assert.equal(storage.getItem("codex_taskpane_id"), "");
  assert.equal(typeof deferredOpen, "function");

  deferredOpen();

  assert.equal(createCount, 1);
  assert.equal(storage.getItem("codex_taskpane_id"), "pane-direct");
});

test("uses WPS's documented task-pane docking enum when it is available", () => {
  const pane = createPane("pane-enum");
  const app = {
    Enum: { JSKsoEnum_msoCTPDockPositionRight: 987 },
    PluginStorage: createStorage({ codex_taskpane_id: pane.ID }),
    GetTaskPane() { return pane; },
  };
  const ribbon = loadRibbon(app);

  assert.equal(ribbon.showTaskPane(), true);
  assert.equal(pane.DockPosition, 987);
  assert.equal(pane.Visible, true);
});

test("passes the panel target to a self-navigating lightweight pane", () => {
  const storage = createStorage();
  let createdUrl = "";
  const pane = createPane("pane-bootstrap");
  const app = {
    PluginStorage: storage,
    CreateTaskPane(url) {
      createdUrl = url;
      return pane;
    },
    GetTaskPane() { return pane; },
  };
  const ribbon = loadRibbon(app, { runTimersImmediately: true });

  ribbon.OnAction({ Id: "btnTogglePanel" });

  assert.equal(
    createdUrl,
    "http://127.0.0.1:3889/taskpane-loader.html?target=" +
      encodeURIComponent("http://127.0.0.1:5173/index.html")
  );
  assert.equal(storage.getItem("codex_taskpane_url"), "http://127.0.0.1:5173/index.html");
});
