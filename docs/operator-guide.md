# Operator Guide / 操作员指南

This guide explains the smallest safe operator path for reviewing, accepting, applying, and rolling back skill proposals in `Director Angel OS`.
这份指南只讲 `Director Angel OS` 当前已经实现的最小 operator 路径：怎么查看 proposal、怎么人工决策、怎么 safe apply、怎么必要时 rollback。

It does not replace the benchmark suite, and it does not describe features that do not exist yet.
它不替代 benchmark，也不假装系统已经有尚未实现的能力。

## Scope / 适用范围

- proposal 由 worker 或学习链路生成，operator 负责查看、决策、safe apply、必要时 rollback。
- proposal 生命周期通过 CLI 的 runtime control-plane 入口执行，不靠手改文件。
- approved skill 的可见性保持 `reload-only`；当前运行中的 runtime 不热更新。

Example commands assume you run them from the repository root.
示例命令默认从仓库根目录执行：

```bash
pnpm --dir apps/cli dev -- task <action> <sessionId> ...
```

If you want CLI and `worker-jobs` to operate on the same proposal lane, point them at the same session DB.
如果要把 CLI 和 `worker-jobs` 串成同一条 proposal/operator 路径，本地开发时必须显式对齐 session DB：

```bash
export HOTFLOW_CLI_SESSION_DB_PATH="$PWD/.hotflow/sessions/shared.sqlite"
export HOTFLOW_WORKER_SESSION_DB_PATH="$HOTFLOW_CLI_SESSION_DB_PATH"
```

不对齐时，常见现象是：worker 已经生成 proposal，但 CLI `proposal-list` 看到的仍然是 `0`。

## Minimal Path / 最小操作路径

### 1. Find The Proposal / 找到 proposal

先定位当前 session 下的 proposal：

```bash
pnpm --dir apps/cli dev -- task proposal-list <sessionId> --limit 10
```

需要看单条原始记录时：

```bash
pnpm --dir apps/cli dev -- task proposal-get <sessionId> --proposal-id <proposalId>
```

### 2. Review The Proposal / 审核 proposal

先看 review 结论，再看 explain 说明：

```bash
pnpm --dir apps/cli dev -- task proposal-review <sessionId> --proposal-id <proposalId>
pnpm --dir apps/cli dev -- task proposal-explain <sessionId> --proposal-id <proposalId>
```

如果不接受，直接拒绝：

```bash
pnpm --dir apps/cli dev -- task proposal-reject <sessionId> --proposal-id <proposalId> --decision-note "<reason>"
```

### 3. Accept The Proposal / 接受 proposal

只有接受后的 proposal 才能进入 safe apply：

```bash
pnpm --dir apps/cli dev -- task proposal-accept <sessionId> --proposal-id <proposalId> --decision-note "<reason>"
```

### 4. Preview Before Safe Apply / safe apply 前先 preview

`proposal-preview` 只用于支持 safe apply 的 skill proposal。它给出 head 版本变化和字段 diff 计划：

```bash
pnpm --dir apps/cli dev -- task proposal-preview <sessionId> --proposal-id <proposalId>
```

最小检查点：

- `Head version: N -> N+1`
- `Changed fields`
- `Summary`

### 5. Apply Safely / 执行 safe apply

确认 preview 后再 apply：

```bash
pnpm --dir apps/cli dev -- task proposal-apply <sessionId> --proposal-id <proposalId>
```

预期结果：

- proposal 状态变成 `applied`
- approved snapshot head 已更新
- 当前 runtime 里的旧 skill 仍保持不变

### 6. Reload Before Expecting New Skills / reload 后再观察新 skill

`proposal-apply` 不会热注入当前 runtime。要看到新的 approved head，必须重新启动一个新的 CLI/runtime 进程，再执行后续任务或查询。

最小原则：

- apply 成功后，当前进程继续跑旧 runtime
- 重新 bootstrap / reload 后，新 skill 才进入 prompt 读路径

### 7. Roll Back If Needed / 必要时 rollback

第一版 rollback 固定为 `snapshot-level rollback`。默认回到上一份 approved snapshot，也可以显式指定版本：

```bash
pnpm --dir apps/cli dev -- task proposal-rollback <sessionId>
pnpm --dir apps/cli dev -- task proposal-rollback <sessionId> --version <n>
```

rollback 后同样遵守 reload 边界：

- approved head 已恢复
- 当前 runtime 不热回退
- 需要下一次 bootstrap / reload 才能看到恢复后的 skill 集合

## Do Not Do This / 不要这样做

- 不要手改 `approved-skills.json`
- 不要让 worker 直接写 approved snapshot
- 不要试图用 `proposal-transition --status applied` 代替 `proposal-apply`
- 不要把 rollback 理解成单 skill 精细回退；当前只支持整份 snapshot 回退

## Minimum Audit Surface / 最小审计面

每次 proposal/operator 操作至少应有 `control.action` 审计。skill safe apply / rollback 额外应看到：

- `skills.proposal_apply`
- `skills.snapshot_write`
- `skills.rollback`

## Minimum Verification / 最小验证

文档对应的回归基线：

```bash
pnpm --dir benchmarks bench:wave28
pnpm --dir benchmarks bench:wave29
pnpm verify
```
