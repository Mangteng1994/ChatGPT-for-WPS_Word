# MVP Scope

## In Scope

- 读取当前选区文本
- 调用 Codex 生成改写文本
- 替换当前选区文本
- 在光标后插入文本
- 选区摘要
- 前端维护内存态 `threadId`，用于续聊

## Out of Scope

- 复杂样式级差异合并
- 多区域原子事务回滚
- 大文档全量一次性改写
- MCP 工具链（放到 Phase 2）

## 验收标准

1. 选中一段文字后可改写并替换成功
2. 光标位置可插入 Codex 生成内容
3. 摘要输出可回填到文档
4. 整个过程本地可见错误信息并可重试

## Bridge API Contract (MVP)

- Endpoint: `POST /run`
- Request JSON:
  - `task`: `"rewrite" | "summary" | "insert"`
  - `content`: `string`
  - `instruction?`: `string`
  - `threadId?`: `string`
  - `model?`: `string`
- Success Response (`200`):
  - `ok: true`
  - `output: string`
  - `threadId?: string`
  - `events?: object[]`
- Error Response (`500`):
  - `ok: false`
  - `output: ""`
  - `error: string`

## Runtime Config (Bridge)

- 优先级：环境变量 > `services/codex-bridge/config.local.json`
- 必填：
  - `CODEX_WORKING_DIR`（或本地配置文件 `workingDir`）
- 可选：
  - `CODEX_CLI_PATH`（默认 `codex`）
  - `CODEX_BRIDGE_HOST`（默认 `127.0.0.1`）
  - `CODEX_BRIDGE_PORT`（默认 `32123`）
