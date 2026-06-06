# Failure And Degrade Guide / 失败与降级指南

This guide explains the failure and degrade boundaries that already exist in `Director Angel OS`.
这份指南只解释 `Director Angel OS` 当前已经落地的失败与降级边界，不额外发明新的恢复机制。

## General Rules / 总规则

- 失败优先返回结构化 control-plane 错误，不要求 operator 手改文件。
- 失败默认 `degrade`，目标是不中断主循环、不污染当前 runtime。
- approved snapshot 的写入、恢复、可见性仍受 `safe apply boundary` 和 `reload-only visibility` 约束。

## Common Proposal And Operator Failures / proposal/operator 常见失败

### Missing Proposal / proposal 不存在

适用于 `proposal-get / review / explain / preview / apply`。

结果：

- action 失败
- approved snapshot 不变
- 当前 runtime 不变

### Preview Or Apply Before Acceptance / proposal 还没 accepted 就 preview / apply

结果：

- action 失败
- 不写 approved head
- proposal 状态不推进到 `applied`

### Worker Generated A Proposal, But CLI Cannot See It / worker 已生成 proposal，但 CLI 看不到

最常见原因不是 proposal 丢了，而是 CLI 和 `worker-jobs` 没有指向同一份 session DB。

结果：

- worker 侧显示 proposal 已入队
- CLI `proposal-list` 仍然返回 `0`
- proposal 实际上写进了另一份 SQLite 文件

处理：

- 对齐 `HOTFLOW_CLI_SESSION_DB_PATH`
- 对齐 `HOTFLOW_WORKER_SESSION_DB_PATH`
- 再重新执行 `proposal-list`

### Forcing `proposal-transition --status applied` / 直接把 proposal transition 到 applied

这条路径被显式禁止。

结果：

- `proposal-transition --status applied` 失败
- 必须改走 `proposal-apply`

### Previewing A Proposal Kind That Does Not Support Safe Apply / preview 的 proposal 不是 safe apply 支持的种类

当前 preview 只针对 skill safe apply 路径。

结果：

- action 失败
- 不生成 snapshot write
- 不改变当前 runtime

### Rollback Has No Recoverable Version / rollback 没有可恢复版本

例如：

- 还没有第一份 approved snapshot
- 当前 head 没有 previous version
- 指定的 `--version` 不存在

结果：

- action 失败
- 当前 approved head 保持原样
- 当前 runtime 保持原样

## Degrade Boundaries / 降级边界

### Apply Succeeded But The Current Runtime Has Not Reloaded / apply 成功但当前 runtime 还没 reload

这不是失败，是设计边界。

结果：

- approved head 已更新
- 当前 runtime 继续使用旧 skill 集合
- 下一次 bootstrap / reload 后才读到新 head

### Rollback Succeeded But The Current Runtime Has Not Reloaded / rollback 成功但当前 runtime 还没 reload

这也不是失败，是同一条边界。

结果：

- approved head 已恢复到目标 snapshot
- 当前 runtime 继续使用 rollback 前已经加载的 skill 集合
- 下一次 bootstrap / reload 后才读到恢复后的 head

### Proposal Generation Or Review Failed / proposal 生成或审核链路失败

如果 proposal 没有成功进入 operator surface，系统应保持：

- 没有 approved snapshot 写入
- 没有热污染当前 runtime
- 主循环仍可继续运行

## What The Operator Should Do Next / operator 看到失败时应怎么处理

最小处理顺序：

1. 先确认 proposal 是否存在、状态是否正确。
2. 对 skill proposal，先 `proposal-review` / `proposal-explain`，再 `proposal-accept`，最后 `proposal-preview` / `proposal-apply`。
3. 如果 apply 后行为不符合预期，先不要手改 snapshot，优先用 `proposal-rollback`。
4. rollback 后重新启动新的 runtime 进程，再验证恢复结果。

## Audit And Diagnosis / 审计与定位

当前审计不重造第二套通道，直接复用会话审计。

最小应观察到：

- 所有 operator 动作都有 `control.action`
- skill apply 有 `skills.proposal_apply`
- snapshot 写盘有 `skills.snapshot_write`
- rollback 有 `skills.rollback`

如果只看到 `control.action` 失败而没有 `skills.*` 事件，通常表示写盘前就已经被边界拦下。

## Not Supported In This Version / 不属于当前版本的恢复方式

- 不支持单 skill partial rollback
- 不支持当前 runtime 内热恢复
- 不支持绕过 control-plane 的人工 reconcile
- 不支持“失败后自动 accept / auto-apply”补救

## Minimum Regression Commands / 最小回归命令

```bash
pnpm --dir benchmarks bench:wave28
pnpm --dir benchmarks bench:wave29
pnpm verify
```
