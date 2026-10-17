# Development Roadmap

本文档记录 `codex-for-wps-word` 后续开发计划，参考 `_refs/siyuan-copilot-codex` 的成熟能力，但按 WPS Word 场景重新裁剪。

## 目标

- 把当前 MVP 从“聊天 + 手动写回”推进到“可审阅、可回滚、可扩展的 WPS Word 本地 Codex 助手”。
- 保持本地优先：Codex CLI、WPS 文档读写、本地 bridge 都运行在用户机器上。
- 优先解决真实使用中的稳定性和误写风险，再扩展复杂 agent 能力。

## 当前状态

- 已有 WPS 本地加载项、面板页、Rust bridge（兼容 `codex-bridge` API）和一键启动脚本。
- 已支持会话、选区上下文、模型选择、思考长度、图片上传、插图占位、写回选区、插入回复。
- 已完成 `P1` 的核心：流式输出和停止生成。
- 已增强本地服务启动：WPS ribbon 按钮与 PowerShell 脚本都统一走 exe 子命令（`services start` / `install`），由可执行文件自身拉起 Rust 宿主与 bridge，写日志并确认端口。

## 开发顺序

### P0 稳定性基线

目标：保证本地服务能稳定启动、失败可诊断。

已完成：
- WPS ribbon 启动本地服务时使用 `powershell.exe -NoProfile -ExecutionPolicy Bypass`。
- `scripts/start-local-services.ps1` 写入 `logs/start-local-services.log`。
- 启动后轮询确认 `3889`、`32123` 端口，并确认 `3889/panel/index.html` 能返回面板页面（面板改为宿主提供的静态资源，不再占用 `5173`）。
- 解析 `npm.cmd` 的完整路径，降低 WPS 进程 PATH 不完整导致的失败概率。
- `addin:host` 保持为加载项宿主统一入口，当前默认已切到 Rust 宿主，用户操作方式保持不变。
- Rust 宿主已内建 `start/stop/check` 运行时控制逻辑，WPS 按钮不再回调旧 PowerShell 服务控制脚本。
- `npm run services:check` 与 `npm run stop:wps-codex` 已可直接走 Rust 服务控制；`scripts/` 下所有 PowerShell 脚本已改为 exe 子命令的薄包装（共用 `scripts/wps-codex-exe.ps1` 定位 exe，并补齐 gnullvm 构建所需的 `libunwind.dll` 搜索路径）。
- 子服务脱离调用方控制台启动（`DETACHED_PROCESS` + 句柄继承白名单），调用方把输出接进管道或重定向时不会被长期存活的守护进程拖住。

后续可补：
- 面板内增加 `/health` 状态展示。
- WPS ribbon 增加“查看启动日志”按钮。
- `services stop` 目前按端口停进程，可进一步校验进程映像路径，只停止本项目启动的服务，减少误杀同端口开发服务的风险。

验收标准：
1. 在 WPS 中点击“启动本地服务”后，`3889/32123` 均可监听，且 `3889/panel/index.html` 返回面板页面。
2. 失败时能在 `logs/start-local-services.log` 定位原因。
3. 重复点击启动不会重复创建同端口服务或弹出误导性成功状态。

### P1 流式输出和停止生成

目标：对话不再等待完整返回，用户可以中断长任务。

已完成：
- `services/codex-bridge-rust/src/codex_runner.rs` 新增 `run_codex_with_sink(...)`。
- `services/codex-bridge-rust/src/server.rs` 新增 `POST /run/stream` 和 `POST /run/cancel`。
- `apps/wps-panel/src/api-client.ts` 新增 `runByBridgeStream(...)` 和 `cancelBridgeRun(...)`。
- `apps/wps-panel/src/main.ts` 支持流式渲染和停止按钮。

后续可补：
- 展示 Codex 执行事件时间线：thinking、tool、search、stderr。
- 流式阶段展示“运行中”状态和错误详情。
- 断线后更明确地区分用户停止、bridge 失败、Codex CLI 失败。

验收标准：
1. 长回复能逐步显示。
2. 点击“停止”后 Codex 进程被终止，前端保留已生成内容。
3. 停止后不会触发 agent 自动写回。
4. 停止后可以继续发送下一条消息。

### P2 写回前 Diff 审核

目标：替换当前选区前先让用户看到差异，降低误写风险。

范围：
- 生成回复后，如果用户选择“写回选区”或 agent 判断需要写回，不直接替换。
- 读取原选区文本和新文本，展示 Diff 弹窗。
- 支持接受、拒绝、复制新文本。
- 首版只做纯文本 Diff，不处理复杂样式合并。

建议实现：
- 新增 `apps/wps-panel/src/diff.ts`：纯文本行级 diff 或 LCS 简化实现。
- 新增面板内 modal DOM，不引入大型 UI 框架。
- `main.ts` 中把 `replaceSelection(...)` 包一层 `confirmWriteBack(...)`。
- 参考 `_refs` 的 Diff 方向：Split/Unified 后续再做，首版先 Unified。

验收标准：
1. 写回前能看到删除/新增内容。
2. 点击接受才调用 `replaceSelection(...)`。
3. 点击拒绝不修改 Word 文档。
4. 无选区或原文为空时提示清楚。

### P3 文档上下文选择器和预设动作

目标：让用户不用每次手写提示词，快速选择文档上下文和常用写作任务。

范围：
- 上下文范围：当前选区、当前段落、当前标题下内容、全文摘要。
- 预设动作：润色、改正式、压缩、扩写、摘要、翻译、错别字检查、合同审查、会议纪要。
- 预设动作只组织 prompt，不直接增加复杂 Word 操作。

建议实现：
- 扩展 `apps/wps-panel/src/wps-adapter.ts`：
  - `getCurrentParagraphText(app)`
  - `getDocumentText(app, limit?)`
  - `getSelectionOrParagraphText(app)`
- 新增 `apps/wps-panel/src/prompt-presets.ts`。
- 面板增加“上下文范围”和“动作”两个控件。

验收标准：
1. 无选区时可自动回退到当前段落。
2. 选择预设动作后能生成稳定、可写回的正文。
3. 大文档读取有长度限制和提示，避免一次性塞爆上下文。

### P4 会话管理增强

目标：让长文档工作流可持续，不丢上下文。

范围：
- 会话重命名、删除、搜索。
- 会话按文档绑定。
- 自动命名首轮会话。
- 导出会话为 Markdown。

建议实现：
- 将 `localStorage` 会话逻辑拆到 `apps/wps-panel/src/session-store.ts`。
- 为会话增加 `documentKey` 字段，优先从 WPS 文档路径/名称获取。
- 控制图片预览存储体积，避免 base64 长期挤爆 `localStorage`。

验收标准：
1. 可以删除不需要的历史会话。
2. 同一篇 Word 文档再次打开时优先显示相关会话。
3. 会话数据损坏时能降级恢复，不影响面板加载。

### P5 Word MCP / Tool Calling

目标：让 Codex agent 通过工具精确操作 Word，而不是靠关键词判断写回。

范围：
- 设计 `wps-word-mcp` 或 bridge 内部 tool 协议。
- 工具包括：读取选区、替换选区、插入文本、插入批注、读取全文、读取标题结构、插入图片。
- 首版工具由本地 bridge 暴露，面板负责执行 WPS 对象模型调用。

建议实现：
- 先定义工具协议，不急着接完整 MCP：
  - `tool.name`
  - `tool.arguments`
  - `tool.result`
- 再迁移到 Codex CLI MCP 配置。
- 写回类工具默认走 P2 Diff 审核。

验收标准：
1. agent 不再通过“用户文本包含修改/写回”判断是否改文档。
2. 每次文档写操作都有明确工具名和参数。
3. 写操作默认需要用户确认。

### P6 批量审阅和整文工作流

目标：支持更接近 Word 助手的高价值场景。

范围：
- 批量错别字检查。
- 术语一致性检查。
- 标题层级和编号检查。
- 合同风险条款初筛。
- 摘要与正文一致性检查。

建议实现：
- 先做只读审阅报告，不直接改全文。
- 将全文分块，逐块调用 Codex，最后合并报告。
- 报告可插入到文档末尾或导出 Markdown。

验收标准：
1. 大文档不会一次性全量塞给 Codex。
2. 报告包含问题位置、原文片段、建议修改。
3. 用户可逐条选择是否应用修改。

### P7 单文件 exe 分发

目标：把「装 Node + Rust 工具链 + 手动构建」的安装流程，压缩成「双击一个 exe」。

已完成：
- 面板静态化：`npm run panel:build` 产出 `apps/wps-panel/dist`，由加载项宿主在 `3889/panel/` 提供，运行时不再依赖 vite dev server。
- 运行期布局解析（`services/codex-bridge-rust/src/layout.rs`）：区分 `repo` / `installed` 两种模式，配置与日志不再依赖编译期路径。
- 服务自举：`services start` 用可执行文件自身拉起 `addon-host` / `bridge`，运行期不再依赖 npm 脚本与 cmd 启动脚本。
- 宿主内建 bridge 看护：15 秒探活、掉线自动重启、重启限流，用户主动停止时通过 `logs/bridge-paused.marker` 暂停看护。
- 加载项注册与开机自启移植进 exe（`src/addon_registry.rs`、`src/install.rs`）：新增 `install` / `uninstall [--keep-files]` / `register` / `unregister` / `doctor`；`installed` 模式卸载会删掉安装目录，`repo` 模式永远保留源码树。
- PowerShell 脚本改为薄包装：只调用 exe 子命令，逻辑只有 exe 里一份。

待办：
- 资源内嵌（`include_dir!`）与 release 打包：新增 `package:exe`（先 `panel:build`，再 `-C target-feature=+crt-static` 出无外部依赖的单文件）。

验收标准：
1. 在没有 Node / Rust 的机器上，只放一个 exe，双击安装后 WPS 出现 Codex 选项卡且面板可问答。
2. 重启电脑后自启生效；卸载后 `publish.xml`、自启项、进程、目录均无残留。
3. 现有 JS / Rust 测试全绿。

## 模块拆分建议

短期保持原生 TypeScript + DOM，不引入前端框架。

建议逐步拆分：
- `apps/wps-panel/src/session-store.ts`：会话读写、迁移、恢复。
- `apps/wps-panel/src/document-actions.ts`：写回、插入、Diff 审核入口。
- `apps/wps-panel/src/diff.ts`：纯文本差异计算。
- `apps/wps-panel/src/prompt-presets.ts`：预设动作和 prompt 构造。
- `services/codex-bridge-rust/src/server.rs` 与 `services/codex-bridge-rust/src/config.rs`：本地环境与服务状态检查。

## 风险和原则

- 不直接做复杂格式级 Diff。Word 格式保留很容易变成深坑，先以纯文本替换和用户确认为主。
- 不默认整文改写。整文操作必须分块、可预览、可拒绝。
- 不把 agent 写权限放太开。所有 Word 写操作都应有可见确认。
- 不把所有参考项目能力都迁移过来。Git 同步、MCP 图片链路、复杂工具时间线只迁移对 Word 场景有价值的部分。

## 最近下一步

推进 `P7 单文件 exe 分发`。安装/卸载自举、看护、PS 薄包装已完成，进入「资源内嵌 + release 打包 + 无 Node 验收」阶段。

具体任务：
1. 用 `include_dir!` 内嵌面板与加载项资源（feature `embedded-assets`，默认关闭），使 exe 不再需要同目录资源。
2. 新增 `npm run package:exe`：先构建面板静态产物，停掉本地服务，再用 `+crt-static` 打 release。
3. 在无 Node 环境端到端验收（安装 → 选项卡 → 面板 → 问答 → 写回 → 重启后可用 → 卸载无残留）。
