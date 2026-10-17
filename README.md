# codex-for-wps-word

自用版 `Codex for WPS Word` 仓库（MVP 起步）。

## 当前阶段

- Phase 1（MVP）：`WPS 前端面板 + Rust bridge`，跑通读取/改写/插入/摘要闭环
- Phase 2：引入 `wps-word-mcp`（让 Codex 直接 tool calling 操作 Word）
- Phase 3：权限控制、审计日志、复杂格式与批处理能力

## 目录结构

```text
apps/wps-panel/            # WPS 插件前端
apps/wps-local-addin/      # 本地 WPS JS 加载项包装层（ribbon + taskpane）
services/codex-bridge-rust/ # Rust bridge（默认 bridge:dev，负责调用 codex CLI）
services/codex-bridge/     # 旧版 Node bridge（legacy / 回退对照）
shared/                    # 前后端共享类型
docs/                      # 设计文档
```

## 运行期目录布局

打包后的 exe 不能假设自己位于源码仓库内，因此路径在启动时解析（实现见 `services/codex-bridge-rust/src/layout.rs`），可执行文件的位置决定模式：

| 模式 | 判定 | 配置 | 日志 | 静态资源 |
|---|---|---|---|---|
| `repo` | exe 位于源码仓库内 | `services/codex-bridge-rust/config.local.json` | `<仓库根>/logs` | `apps/wps-local-addin`、`apps/wps-panel/dist` |
| `installed` | exe 被拷贝到仓库外（安装目录） | `<exe 同目录>/config.json` | `<exe 同目录>/logs` | `<exe 同目录>/addin`、`<exe 同目录>/panel` |

`installed` 是打包发布的目标形态：用 `npm run package:exe` 构建时，加载项与面板静态资源会通过 `embedded-assets` feature 内嵌进 exe，运行时不再需要同目录的 `addin/` 与 `panel/`（见「单文件分发」）。两种模式都可用环境变量覆盖：`CODEX_BRIDGE_CONFIG_PATH`（配置文件）、`CODEX_CLI_PATH`、`CODEX_WORKING_DIR`。

## 服务程序子命令

`codex-for-wps-word-rust.exe` 本身就是完整入口，注册、守护、安装都在这一个文件里（`repo` 模式下位于 `services/codex-bridge-rust/target/debug/`）：

| 子命令 | 作用 |
|---|---|
| `services start` | 拉起 `addon-host`（3889）与 `bridge`（32123），并等待健康检查通过 |
| `services stop` | 停 bridge 与遗留面板端口（5173/5174），保留 3889；写入暂停标记，看护不再自动拉起 |
| `services check` | 检查三个服务端点，异常时返回非零退出码 |
| `install` | 注册 WPS 加载项 + 建立开机自启任务 + 启动本地服务 |
| `uninstall [--keep-files]` | 停服务、删自启任务、移除加载项注册；`installed` 模式下再删除安装目录 |
| `register` / `unregister` | 只操作 `publish.xml` 里的加载项注册 |
| `doctor` | 逐项体检加载项注册、自启任务、服务端点，输出 `OK` / `FAILED` |
| `addon-host` / `bridge` | 以守护进程方式运行宿主 / 桥接（由 `services start` 拉起，一般不手动调用） |

子服务由 exe 用自身拉起，以 `DETACHED_PROCESS` 脱离调用方控制台，并且只继承三个标准句柄——即使调用方把输出重定向或接进管道，也不会被长期存活的守护进程拖住。日志写入 `<日志目录>/<name>.out.log` 与 `<name>.err.log`。

`scripts/` 下的 PowerShell 脚本都是这些子命令的薄包装（共用 `scripts/wps-codex-exe.ps1` 定位 exe），方便双击或从 PowerShell 调用；逻辑只有 exe 里一份，不再有第二套实现。

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
   - 回到项目根目录执行 `npm run rust:build`，预先构建 Rust 服务（需要 Rust 工具链）。
2. 一键安装（根目录）：
   - `npm run install:wps-codex`
   - 或双击 `install-wps-codex.cmd`
3. 完全退出并重开 WPS，在 `Codex` 选项卡点击 `打开 Codex 面板`。

安装脚本会做三件事：
- 写入 WPS 本地加载项注册（`publish.xml`）
- 创建开机登录自启动任务（`CodexForWpsWord-AutoStart`）
- 立即拉起本地服务并执行健康检查

若朋友机器上出现“选项卡不见/面板打不开”：
- `npm run doctor:wps-codex` 先看体检结果（逐项列出加载项注册、自启任务、服务端点的 `OK` / `FAILED`）
- `npm run repair:wps-codex`
- 或双击 `repair-wps-codex.cmd`

日常启动直接运行已构建的 Rust 程序，不再执行 `cargo run`，避免编译或构建锁等待导致 WPS 启动时加载不到 Codex 选项卡。首次安装及修改 Rust 源码后需显式执行 `npm run rust:build`；已有服务运行时，应先结束本项目的 Rust 服务进程再重新构建。缺少构建产物时，启动命令会明确报错。

若服务启动前已打开 WPS，先运行 `npm run services:check` 确认三个服务正常，再保存文档、完全退出并重新打开 WPS。功能区自动收起是 WPS 独立的界面设置，可双击“开始”恢复常驻。

卸载：
- `npm run uninstall:wps-codex`
- 或双击 `uninstall-wps-codex.cmd`

## 本地联调（本地 WPS 文档，推荐）

1. 安装依赖：
   - `npm install`
   - `cd apps/wps-local-addin && npm install`
2. 配置 bridge（两种方式任选其一）：
   - 环境变量：`CODEX_WORKING_DIR`（必填）、`CODEX_CLI_PATH`（可选）
   - 或复制 `services/codex-bridge-rust/config.example.json` 为 `services/codex-bridge-rust/config.local.json` 并填写（仓库模式下的配置位置，见「运行期目录布局」）
3. 启动 bridge（根目录）：
   - `npm run bridge:dev`
   - 这是 Rust 版桥接服务；如果你想对照旧实现，可用 `npm run bridge:dev:legacy`
   - 首次运行及修改 Rust 源码后先执行 `npm run rust:build`（构建需要 Rust 工具链），日常启动使用已构建程序。
4. 构建面板静态产物（根目录）：
   - `npm run panel:build`
   - 产物写入 `apps/wps-panel/dist`，由加载项宿主在 `http://127.0.0.1:3889/panel/` 下提供
   - 需要热更新调试时改用 `npm run panel:dev`，再在 WPS 里用「设置面板地址」把面板指向 `http://127.0.0.1:5173/index.html`
5. 注册并启动本地加载项宿主服务（根目录）：
   - `npm run addin:register`
   - `npm run addin:host`
   - `addin:host` 现在默认启动 Rust 宿主；如需回退旧实现，可用 `npm run addin:host:legacy`
6. WPS 打开后，在 `Codex` 选项卡点击 `打开 Codex 面板`：
   - 默认会打开 `http://127.0.0.1:3889/panel/index.html`
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
  - 该入口是 exe 的薄包装：依次执行 `register` 与 `services start`
- 从资源管理器双击启动：
  - `start-wps-codex.cmd`
- 从 PowerShell 关闭 bridge 和面板服务：
  - `npm run stop:wps-codex`
  - 现在默认走 Rust `services stop` 子命令，保留 `3889` 宿主，仅关闭 bridge，并清理遗留的面板 dev server（5173/5174）
- 从 PowerShell 检查本地服务状态：
  - `npm run services:check`
- 从资源管理器双击关闭：
  - `stop-wps-codex.cmd`
- 从 WPS 的 `Codex` 选项卡启动本地服务：
  - 点击 `启动本地服务`
  - 该按钮现在由 Rust 宿主内建的 `start` 动作处理，会拉起加载项宿主服务（3889）与 Rust bridge（32123）；面板是宿主提供的静态资源，不再是独立进程
  - 子服务由可执行文件自身拉起（`exe addon-host` / `exe bridge`），脱离调用方控制台启动，运行期不再依赖 npm 脚本或 cmd 启动脚本
  - 前提是 WPS 加载项自身已经加载成功
- 从 WPS 的 `Codex` 选项卡关闭本地服务：
  - 点击 `关闭本地服务`
  - 该按钮现在由 Rust 宿主内建的 `stop` 动作处理，会关闭 bridge，并清理遗留的面板 dev server（5173/5174），但保留 WPS 加载项调试服务
  - 同时写入 `logs/bridge-paused.marker`，宿主看护在标记存在期间不会自动拉起 bridge

## 单文件分发（打包给同事）

打包方需要本机有 Node 与 Rust 工具链；**同事机器不需要** Node、npm 或 Rust。

```text
npm run package:exe
```

它依次做四件事：停掉本地服务 → `panel:build` 构建面板 → `cargo build --release --features embedded-assets`（带 `RUSTFLAGS=-C target-feature=+crt-static`）→ 把产物复制成 `dist/codex-for-wps-word.exe`。

产物是**真正的单文件**：加载项与面板资源都已内嵌，只依赖系统 DLL（`+crt-static` 去掉了 `libunwind.dll` 依赖）。

同事的安装步骤：

1. 把 `codex-for-wps-word.exe` 放到任意目录（例如 `%LOCALAPPDATA%\CodexForWpsWord`），双击或执行 `codex-for-wps-word.exe install`。
2. `install` 会注册 WPS 加载项、建立登录自启任务、拉起本地服务；配置与日志写在 exe 同目录。
3. 完全退出并重新打开 WPS，在 `Codex` 选项卡点击 `打开 Codex 面板`。

排查与卸载：

- `codex-for-wps-word.exe doctor` 逐项体检（资源来源会显示「内嵌在可执行文件中」）
- `codex-for-wps-word.exe uninstall` 停服务、删自启任务、移除注册并删除安装目录

仍然无法消除的三条前提：

- 同事需要自己安装 Codex CLI 并完成 `codex login`。
- exe 未做代码签名，首次运行会触发 SmartScreen 提示（选「更多信息」→「仍要运行」）。
- 系统需要 Windows 10 及以上（依赖 UCRT）。

开发态与打包态的取舍：默认构建（`embedded-assets` 关闭）始终从 `apps/` 目录读资源，改完面板刷新即可生效；打包时才启用内嵌，所以日常开发不受影响。

自检命令（在仓库根目录执行）：

```text
cargo test --manifest-path services/codex-bridge-rust/Cargo.toml
cargo test --manifest-path services/codex-bridge-rust/Cargo.toml --features embedded-assets
```

两条都应全绿；第二条会额外校验内嵌资源表，需要先跑过一次 `npm run panel:build`。

## 服务自愈（宿主看护）

加载项宿主（3889）常驻运行，内建 bridge 看护：

- 每 15 秒探活一次 `http://127.0.0.1:32123/health`，连续两次不可达才判定掉线（避免撞上启动窗口）。
- 判定掉线后自动重新拉起 bridge，日志写入 `logs/supervisor.log`。
- 用户主动停止时（`关闭本地服务` / `services stop`）写入 `logs/bridge-paused.marker`，看护暂停；再次启动会清除标记并恢复看护。
- 10 分钟窗口内最多自动重启 5 次，超过后暂停自动拉起，避免反复崩溃时形成重启风暴。

## 面板能力

- `模式`：`ask` 以只读问答为主，`agent` 允许 Codex 在工作目录内执行更完整的任务
- `模型`：从本地 `CODEX_HOME/config.toml` 或 `~/.codex/config.toml` 读取，并内置常用 Codex 模型兜底
- `思考长度`：通过 Codex CLI `-c model_reasoning_effort=...` 传入
- `Codex CLI 配置`：支持查看、保存 CLI 路径和工作目录，并自动嗅探本机 `codex/codex.cmd/codex.exe`
- `聊天框`：可直接和 Codex 对话；如果 Word 里有选区，会把选区作为上下文传入

## WebOffice 联调（仅在线文档）

- 先运行 `npm run panel:dev` 提供调试页，再访问：`http://127.0.0.1:5173/host.html`
- 需填写 `SDK URL`、`appId`、`fileId`
- 该路径只用于 WebOffice，不用于本地 WPS 文档
