# codex-for-wps-word-rust

`Codex for WPS Word` 的 Rust 版桥接服务。

## 作用

- 保持和原版 `codex-bridge` 一致的 HTTP API
- 用 Rust 接管本地 Codex CLI 调用、SSE 流式输出、资产落盘和对比弹窗
- WPS 面板和加载项前端仍然可以继续使用原来的接口

## 启动方式

在仓库根目录：

```powershell
npm run bridge:dev
```

或者直接在本目录：

```powershell
cargo run
```

## 本地配置

复制 [`config.example.json`](./config.example.json) 为 `config.local.json`，或者通过环境变量覆盖：

- `CODEX_BRIDGE_HOST`
- `CODEX_BRIDGE_PORT`
- `CODEX_CLI_PATH`
- `CODEX_WORKING_DIR`
- `CODEX_BRIDGE_CONFIG_PATH`

## 兼容范围

当前实现覆盖原桥接层的核心接口：

- `/health`
- `/config`
- `/models`
- `/run`
- `/run/stream`
- `/run/cancel`
- `/asset/illustration`
- `/asset/upload-image`
- `/asset/upload-file`
- `/diff-popup/open`
- `/diff-popup/{token}`
- `/diff-popup/version/{token}`

## 备注

根仓库仍保留旧的 Node 版本桥接实现，便于对照和回退。默认 `bridge:dev` 已切到 Rust 版本，必要时可使用旧脚本做对比。

