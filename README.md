# codex-for-wps-word

自用版 `Codex for WPS Word` 仓库（MVP 起步）。

## 当前阶段

- Phase 1（MVP）：`WPS 前端面板 + 本地 codex-bridge`，跑通读取/改写/插入/摘要闭环
- Phase 2：引入 `wps-word-mcp`（让 Codex 直接 tool calling 操作 Word）
- Phase 3：权限控制、审计日志、复杂格式与批处理能力

## 目录结构

```text
apps/wps-panel/            # WPS 插件前端
services/codex-bridge/     # 本地 bridge（调用 codex CLI）
shared/                    # 前后端共享类型
docs/                      # 设计文档
```

## 下一步开发顺序（建议）

1. 完成 `codex-bridge` 的 HTTP 接口与 `codex exec --json` 事件透传
2. 完成 WPS 前端面板中的“读取选区 -> 调 bridge -> 写回替换”
3. 增加“插入内容”“摘要”两个动作
4. 加入会话 threadId 续聊与基础日志

