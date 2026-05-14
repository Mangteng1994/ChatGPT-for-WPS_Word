# codex-for-wps-word

自用版 `Codex for WPS Word` 仓库（MVP 起步）。

## 当前阶段

- Phase 1（MVP）：`WPS 前端面板 + 本地 codex-bridge`，跑通读取/改写/插入/摘要闭环
- Phase 2：引入 `wps-word-mcp`（让 Codex 直接 tool calling 操作 Word）
- Phase 3：权限控制、审计日志、复杂格式与批处理能力

## 目录结构

```text
apps/wps-panel/            # WPS 插件前端
apps/wps-local-addin/      # 本地 WPS JS 加载项包装层（ribbon + taskpane）
services/codex-bridge/     # 本地 bridge（调用 codex CLI）
shared/                    # 前后端共享类型
docs/                      # 设计文档
```

## 下一步开发顺序（建议）

详见 [Development Roadmap](docs/development-roadmap.md)。

当前优先级：

1. `P1` 流式输出和停止生成（已完成核心能力）
2. `P2` 写回前 Diff 审核
3. `P3` 文档上下文选择器和预设动作
4. `P5` Word MCP / Tool Calling

## 个人使用安装（v0）

1. 安装依赖（首次）：
   - `npm install`
   - `cd apps/wps-local-addin && npm install`
2. 一键安装（根目录）：
   - `npm run install:wps-codex`
   - 或双击 `install-wps-codex.cmd`
3. 完全退出并重开 WPS，在 `Codex` 选项卡点击 `打开 Codex 面板`。

安装脚本会做三件事：
- 写入 WPS 本地加载项注册（`publish.xml`）
- 创建开机登录自启动任务（`CodexForWpsWord-AutoStart`）
- 立即拉起本地服务并执行健康检查

若朋友机器上出现“选项卡不见/面板打不开”：
- `npm run repair:wps-codex`
- 或双击 `repair-wps-codex.cmd`

卸载：
- `npm run uninstall:wps-codex`
- 或双击 `uninstall-wps-codex.cmd`

## 本地联调（本地 WPS 文档，推荐）

1. 安装依赖：
   - `npm install`
   - `cd apps/wps-local-addin && npm install`
2. 配置 bridge（两种方式任选其一）：
   - 环境变量：`CODEX_WORKING_DIR`（必填）、`CODEX_CLI_PATH`（可选）
   - 或复制 `services/codex-bridge/config.example.json` 为 `services/codex-bridge/config.local.json` 并填写
3. 启动 bridge（根目录）：
   - `npm run bridge:dev`
4. 启动面板页（根目录）：
   - `npm run panel:dev`
5. 注册并启动本地加载项静态服务（根目录）：
   - `npm run addin:register`
   - `npm run addin:host`
6. WPS 打开后，在 `Codex` 选项卡点击 `打开 Codex 面板`：
   - 默认会打开 `http://127.0.0.1:5173/index.html`
   - 面板会直接使用本地 `Application` 读写当前文档选区

## 一键启动

- 安装（首次）：
  - `npm run install:wps-codex`
- 修复：
  - `npm run repair:wps-codex`
- 卸载：
  - `npm run uninstall:wps-codex`
- 从 PowerShell 启动完整调试链路：
  - `npm run start:wps-codex`
- 从资源管理器双击启动：
  - `start-wps-codex.cmd`
- 从 PowerShell 关闭 bridge 和面板服务：
  - `npm run stop:wps-codex`
- 从资源管理器双击关闭：
  - `stop-wps-codex.cmd`
- 从 WPS 的 `Codex` 选项卡启动本地服务：
  - 点击 `启动本地服务`
  - 该按钮会拉起加载项静态服务（3889）+ bridge（32123）+ 面板 dev server（5173）
  - 前提是 WPS 加载项自身已经加载成功
- 从 WPS 的 `Codex` 选项卡关闭本地服务：
  - 点击 `关闭本地服务`
  - 该按钮会关闭 bridge 和面板 dev server，但保留 WPS 加载项调试服务

## 面板能力

- `模式`：`ask` 以只读问答为主，`agent` 允许 Codex 在工作目录内执行更完整的任务
- `模型`：从本地 `CODEX_HOME/config.toml` 或 `~/.codex/config.toml` 读取，并内置常用 Codex 模型兜底
- `思考长度`：通过 Codex CLI `-c model_reasoning_effort=...` 传入
- `Codex CLI 配置`：支持查看、保存 CLI 路径和工作目录，并自动嗅探本机 `codex/codex.cmd/codex.exe`
- `聊天框`：可直接和 Codex 对话；如果 Word 里有选区，会把选区作为上下文传入

## WebOffice 联调（仅在线文档）

- 调试地址：`http://127.0.0.1:5173/host.html`
- 需填写 `SDK URL`、`appId`、`fileId`
- 该路径只用于 WebOffice，不用于本地 WPS 文档
