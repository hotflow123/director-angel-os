# Director Angel 内容策略参考对齐

本文件记录本次对参考仓库的结论，用于约束后续“开发者模式 / 危险开关 / 内容策略”的实现。

## 参考仓库结论

### Hermes Agent

- `tools/approval.py` 是危险命令审批的单一来源。
- `approvals.mode=off` 和 `/yolo` 属于本地工具执行的 break-glass，不是所有策略的通用绕过。
- Tirith 扫描的 `block/warn` 会进入审批流，默认拒绝；部分危险命令可一次、会话或永久允许。
- 子代理默认隔离持久记忆，避免子代理直接污染主记忆。

### OpenClaw

- `dangerouslyAllow*` 是明确命名的窄范围 opt-in，例如 SSRF 私网访问、Docker namespace join、Host header fallback。
- 默认 fail-closed。危险开关会被 security audit 标记。
- 工具策略、沙箱策略、elevated escape hatch 是分层关系；沙箱放开不等于工具策略自动放开。

### Claude Code / Deep Dive

- 工具调用经过 schema 校验、hook、permission、analytics、MCP-aware execution pipeline。
- hook 可以返回 `allow / ask / deny`，但 hook 的 allow 不自动突破 settings deny/ask rules。
- auto/yolo classifier 出错或不可解析时倾向 block；明确用户确认才可覆盖部分阻断。

## Director Angel 落地规则

1. 内容策略结果必须带结构化字段：`floor`、`severity`、`canOverride`、`requiresApproval`、`auditEvent`。
2. 开发者可见开关只显示命中规则、原因、改写目标和审计信息，不直接放行硬底线。
3. 未来如果新增可覆盖规则，只能标为 `floor=operator-approval`，并走一次/会话/永久审批链。
4. “拐卖、买妻、强迫婚姻被包装成美满爱情”属于 `floor=hard`，`canOverride=false`，只能改写到批判、救助、追责和受害者主体性方向。
5. 桌面端、CLI、微信等所有入口必须共享同一个 evaluator，不能各自写一套判断。
