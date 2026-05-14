# wps-local-addin

本目录是 `Codex for WPS Word` 的本地 WPS JS 加载项包装层。

作用：

- 在 WPS 功能区新增 `Codex` 选项卡
- 点击按钮后创建/显示任务窗格
- 任务窗格默认加载 `http://127.0.0.1:5173/index.html`

## 使用

1. 在仓库根目录启动 bridge：
   - `npm run bridge:dev`
2. 在仓库根目录启动面板 dev server：
   - `npm run panel:dev`
3. 在本目录安装并启动加载项：
   - `npm install`
   - `npm run debug`
4. WPS 打开后点击 `Codex -> 打开 Codex 面板`

## 备注

- `设置面板地址` 按钮可修改任务窗格 URL。
- 地址值会写入 `Application.PluginStorage`，下次仍会使用。
