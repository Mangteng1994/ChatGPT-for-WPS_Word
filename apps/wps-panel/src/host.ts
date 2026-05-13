import "./host.css";

type OfficeType = "Writer" | "Spreadsheet" | "Presentation" | "PDF";

interface WebOfficeSDKType {
  OfficeType: Record<OfficeType, string>;
  init: (options: Record<string, unknown>) => any;
}

declare global {
  interface Window {
    WebOfficeSDK?: WebOfficeSDKType;
  }
}

const sdkUrlEl = document.querySelector<HTMLInputElement>("#sdk-url");
const appIdEl = document.querySelector<HTMLInputElement>("#app-id");
const fileIdEl = document.querySelector<HTMLInputElement>("#file-id");
const officeTypeEl = document.querySelector<HTMLSelectElement>("#office-type");
const initBtn = document.querySelector<HTMLButtonElement>("#init-instance");
const statusEl = document.querySelector<HTMLDivElement>("#host-status");
const panelFrame = document.querySelector<HTMLIFrameElement>("#panel-frame");
const officeMount = document.querySelector<HTMLDivElement>("#office-mount");

let currentInstance: any = null;
let loadedSdkUrl = "";

function setStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? "1" : "0";
}

function requiredValue(input: HTMLInputElement | null, name: string): string {
  const value = String(input?.value || "").trim();
  if (!value) throw new Error(`${name} 不能为空`);
  return value;
}

async function loadSdk(umdUrl: string): Promise<WebOfficeSDKType> {
  if (window.WebOfficeSDK && loadedSdkUrl === umdUrl) {
    return window.WebOfficeSDK;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = umdUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`加载 SDK 失败: ${umdUrl}`));
    document.head.appendChild(script);
  });
  if (!window.WebOfficeSDK) {
    throw new Error("SDK 已加载但未找到 window.WebOfficeSDK");
  }
  loadedSdkUrl = umdUrl;
  return window.WebOfficeSDK;
}

async function initAndInject(): Promise<void> {
  const sdkUrl = requiredValue(sdkUrlEl, "SDK URL");
  const appId = requiredValue(appIdEl, "App ID");
  const fileId = requiredValue(fileIdEl, "File ID");
  const officeType = (officeTypeEl?.value || "Writer") as OfficeType;
  if (!panelFrame?.contentWindow) {
    throw new Error("面板 iframe 未准备好");
  }
  if (!officeMount) {
    throw new Error("office 挂载节点不存在");
  }

  setStatus("正在加载 SDK...");
  const sdk = await loadSdk(sdkUrl);

  if (currentInstance && typeof currentInstance.destroy === "function") {
    try {
      currentInstance.destroy();
    } catch {
      // ignore old instance cleanup errors
    }
  }

  setStatus("正在初始化 WebOffice 实例...");
  const resolvedType = sdk.OfficeType[officeType];
  currentInstance = sdk.init({
    officeType: resolvedType,
    appId,
    fileId,
    mount: officeMount,
  });
  await currentInstance.ready();
  panelFrame.contentWindow.instance = currentInstance;
  setStatus("实例初始化成功，已注入面板页。");
}

initBtn?.addEventListener("click", () => {
  void (async () => {
    try {
      initBtn.disabled = true;
      await initAndInject();
    } catch (error) {
      setStatus((error as Error).message, true);
    } finally {
      initBtn.disabled = false;
    }
  })();
});

setStatus("请填写配置并点击“初始化并注入”。");

