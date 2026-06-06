# Benchmarks / 回归与验收

This directory holds the regression gates, smoke checks, and replay fixtures for `Director Angel OS`.
这里放的是 `Director Angel OS` 的回归门禁、冒烟验证和回放夹具。

If you are new to the repo, start here:
如果你是第一次接触这个仓库，先跑这几个命令就够了：

- `pnpm bench:all`
- `pnpm --dir benchmarks e2e:smoke`
- `pnpm --dir benchmarks bench:wave29`
- `pnpm --dir benchmarks bench:directorbeta5`
- `pnpm bench:director-agent-os-all`

The suite ids still use historical `wave*` names for stability.
这些 suite id 继续保留历史上的 `wave*` 命名，是为了兼容既有脚本、fixture 和报告，不代表外部用户必须理解整段内部开发编年史。

## Commands

Run the full regression pack in one shot, plus the optional `cli-run-benchmark` harness:
一键跑完整回归包，以及可选的 `cli-run-benchmark`：

```sh
pnpm --dir benchmarks bench:all
```

The repository root exposes the same aggregate command:
仓库根目录暴露了同一条聚合命令：

```sh
pnpm bench:all
```

Run the smoke E2E path:
运行最小冒烟端到端路径：

```sh
pnpm --dir benchmarks e2e:smoke
```

Run the Agent OS release gate, including smoke, synthetic, local real-provider, and local real-data tiers:
运行 Agent OS 发布总门禁，覆盖 smoke、synthetic、本地 real-provider 和本地 real-data 分层：

```sh
pnpm bench:director-agent-os-all
```

Run the desktop Review/Ops release matrix surface gate:
运行桌面 Review/Ops 发布矩阵展示门禁：

```sh
pnpm bench:director-agent-os-desktop-release-ops
```

Run the Agent OS release smoke readiness gate:
运行 Agent OS 发布 smoke 预检门禁：

```sh
pnpm bench:director-agent-os-release-smoke-readiness
```

Run the Agent OS release smoke admission gate:
运行 Agent OS 发布 smoke 准入门禁：

```sh
pnpm bench:director-agent-os-release-smoke-admission
```

Run the Agent OS release smoke execution preflight gate:
运行 Agent OS 发布 smoke 执行预检门禁：

```sh
pnpm bench:director-agent-os-release-smoke-execution-preflight
```

Run the Agent OS release smoke evidence intake gate:
运行 Agent OS 发布 smoke 证据录入门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-intake
```

Run the Agent OS release smoke evidence manifest preflight gate:
运行 Agent OS 发布 smoke 证据清单预检门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-preflight
```

Run the Agent OS release smoke evidence manifest validation gate:
运行 Agent OS 发布 smoke 证据清单校验门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-validation
```

Run the Agent OS release smoke evidence manifest path authorization gate:
运行 Agent OS 发布 smoke 证据清单路径授权门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-path-authorization
```

Run the Agent OS release smoke evidence manifest schema validator readiness gate:
运行 Agent OS 发布 smoke 证据清单 schema 校验器 readiness 门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness
```

Run the Agent OS release smoke evidence manifest schema definition binding gate:
运行 Agent OS 发布 smoke 证据清单 schema 定义绑定门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding
```

Run the Agent OS release smoke evidence manifest read authorization gate:
运行 Agent OS 发布 smoke 证据清单读取授权门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-read-authorization
```

Run the Agent OS release smoke evidence manifest audit artifact readiness gate:
运行 Agent OS 发布 smoke 证据清单审计 artifact readiness 门禁：

```sh
pnpm bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness
```

Run the Agent OS release smoke runner intent signing/revocation gate:
运行 Agent OS 发布 smoke runner intent 签发/撤销门禁：

```sh
pnpm bench:director-agent-os-release-smoke-runner-intent-signing-revocation
```

Run the Agent OS desktop smoke evidence artifact gate:
运行 Agent OS 桌面 smoke 证据 artifact 门禁：

```sh
pnpm bench:director-agent-os-desktop-smoke-evidence-artifact
```

Run the Agent OS desktop smoke manual-run artifact validator gate:
运行 Agent OS 桌面 smoke 手动运行 artifact validator 门禁：

```sh
pnpm bench:director-agent-os-desktop-smoke-manual-run-artifact-validator
```

Run the Agent OS non-voice provider smoke candidate gate:
运行 Agent OS 非语音 provider smoke 候选门禁：

```sh
pnpm bench:director-agent-os-non-voice-provider-smoke-candidate
```

Run the Agent OS real non-voice provider runner extension gate:
运行 Agent OS 真实非语音 provider runner 扩展门禁：

```sh
pnpm bench:director-agent-os-real-non-voice-provider-runner-extension
```

Run the Agent OS external provider setup guidance gate:
运行 Agent OS 外部 provider setup guidance 门禁：

```sh
pnpm bench:director-agent-os-provider-setup-guidance
```

Run the Agent OS voice runner readiness gate:
运行 Agent OS 语音 runner readiness 门禁：

```sh
pnpm bench:director-agent-os-voice-runner-readiness
```

Run the Agent OS voice evidence manifest dry-run validator gate:
运行 Agent OS 语音证据清单 dry-run validator 门禁：

```sh
pnpm bench:director-agent-os-voice-evidence-manifest-validator
```

Run the Agent OS voice provider matrix runner admission gate:
运行 Agent OS 语音 provider matrix + runner admission 门禁：

```sh
pnpm bench:director-agent-os-voice-provider-matrix-runner-admission
```

Run the Agent OS voice regression safety gate:
运行 Agent OS 语音回归安全门禁：

```sh
pnpm bench:director-agent-os-voice-regression-safety
```

Run the Agent OS runner scan migration batch gate:
运行 Agent OS runner 扫描与迁移批次门禁：

```sh
pnpm bench:director-agent-os-runner-scan-migration-batch
```

Run the Agent OS Notebook/browser automation hardening gate:
运行 Agent OS Notebook/browser automation 硬化门禁：

```sh
pnpm bench:director-agent-os-notebook-browser-automation-hardening
```

Run the Agent OS bounded scheduler executor gate:
运行 Agent OS bounded scheduler executor 门禁：

```sh
pnpm bench:director-agent-os-bounded-scheduler-executor
```

Run the Agent OS child git diff observed write-set gate:
运行 Agent OS child git diff observed write-set 门禁：

```sh
pnpm bench:director-agent-os-child-git-diff-observed-write-set
```

Run the Agent OS executable recovery workflow gate:
运行 Agent OS 可执行 recovery workflow 门禁：

```sh
pnpm bench:director-agent-os-executable-recovery-workflow
```

Run the Agent OS controlled runner intent token prototype gate:
运行 Agent OS 受控 runner intent token 签发原型门禁：

```sh
pnpm bench:director-agent-os-controlled-runner-intent-token-prototype
```

Run the desktop Review/Ops memory eval surface gate:
运行桌面 Review/Ops 记忆评估展示门禁：

```sh
pnpm bench:director-agent-os-memory-eval-ops
```

Run the MemPalace live memory eval safety preflight gate:
运行 MemPalace 真实记忆评测安全预检门禁：

```sh
pnpm bench:director-agent-os-memory-sweep-safety
```

Run the MemPalace real dataset loader anonymization gate:
运行 MemPalace 真实数据集 loader 匿名化门禁：

```sh
pnpm bench:director-agent-os-memory-dataset-loader-anonymization
```

Run the desktop memory eval dashboard maintenance gate:
运行桌面记忆评估 dashboard 维护动作门禁：

```sh
pnpm bench:director-agent-os-memory-eval-dashboard-maintenance
```

Run the desktop Skill patch editor diff confirmation gate:
运行桌面 Skill patch editor diff confirmation 门禁：

```sh
pnpm bench:director-agent-os-skill-patch-editor-diff-confirmation
```

Run the Channel adapter v2 template gate:
运行 Channel adapter v2 样板门禁：

```sh
pnpm bench:director-agent-os-channel-adapter-v2-template
```

Run the Skill failure-to-patch eval gate:
运行 Skill 失败到补丁评测门禁：

```sh
pnpm bench:director-agent-os-skill-failure-to-patch-eval
```

Run the desktop Review/Ops memory sweep safety surface gate:
运行桌面 Review/Ops 记忆评测安全预检展示门禁：

```sh
pnpm bench:director-agent-os-memory-sweep-safety-ops
```

Run the benchmark harness directly:
直接运行 benchmark harness：

```sh
pnpm --dir benchmarks bench:run
```

Control the benchmark iteration count:
控制 benchmark 迭代次数：

```sh
HF_BENCH_ITERATIONS=5 pnpm --dir benchmarks bench:run
```

Run Wave 1 quality gate (scenario + replay benchmark cases):

```sh
pnpm --dir benchmarks bench:quality
```

Run Wave 2 interrupted-turn recovery gate:

```sh
pnpm --dir benchmarks bench:recovery
```

Run Wave 3 governance and degradation gate:

```sh
pnpm --dir benchmarks bench:governance
```

Run Wave 4 task/control-plane vertical slice gate:

```sh
pnpm --dir benchmarks bench:taskplane
```

Run Wave 5 task contract gate:

```sh
pnpm --dir benchmarks bench:taskcontract
```

Run Wave 6 dynamic context gate:

```sh
pnpm --dir benchmarks bench:context
```

Run Wave 7 real provider + CLI gate:

```sh
pnpm --dir benchmarks bench:provider
```

Run Wave 8 doctor gate:

```sh
pnpm --dir benchmarks bench:doctor
```

Run Wave 9 channels contract gate:

```sh
pnpm --dir benchmarks bench:channels
```

Run Wave 10 gateway HTTP gate:

```sh
pnpm --dir benchmarks bench:gateway
```

Run Wave 11 worker-jobs proposal pipeline gate:

```sh
pnpm --dir benchmarks bench:workerjobs
```

Run Wave 12 delegation mailbox + verification gate:

```sh
pnpm --dir benchmarks bench:delegationflow
```

Run Wave 13 proposal reconcile + safe apply gate:

```sh
pnpm --dir benchmarks bench:reconcile
```

Run Wave 14 runtime failure + degradation contract gate:

```sh
pnpm --dir benchmarks bench:runtimefailures
```

Run Wave 15 skills/plugin-runtime/internal-plugins scaffold gate:

```sh
pnpm --dir benchmarks bench:skillsplugins
```

Run Wave 16 skill proposal reload gate:

```sh
pnpm --dir benchmarks bench:skillreload
```

Run Wave 17 skill proposal review gate:

```sh
pnpm --dir benchmarks bench:skillreview
```

Run Wave 18 engine runtime failure wrapping gate:

```sh
pnpm --dir benchmarks bench:enginefailures
```

Run Wave 19 runtime closure gate:

```sh
pnpm --dir benchmarks bench:runtimeclosure
```

Run Wave 20 pre-model boundary gate:

```sh
pnpm --dir benchmarks bench:premodelboundary
```

Run Wave 21 streaming boundary gate:

```sh
pnpm --dir benchmarks bench:streamingboundary
```

Run Wave 22 mempalace/doctor boundary gate:

```sh
pnpm --dir benchmarks bench:mempalaceboundary
```

Run Wave 23a operator/control-plane surface gate:

```sh
pnpm --dir benchmarks bench:wave23a
```

Run Wave 23b onboarding gate:

```sh
pnpm --dir benchmarks bench:wave23b
```

Run Wave 23c preflight gate:

```sh
pnpm --dir benchmarks bench:wave23c
```

Run Wave 25 learning input / digest gate:

```sh
pnpm --dir benchmarks bench:wave25
```

Run Wave 26 proposal generator gate:

```sh
pnpm --dir benchmarks bench:wave26
```

Run Wave 27 operator surface smoke gate:

```sh
pnpm --dir benchmarks bench:wave27
```

Run Wave 28 safe apply gate:

```sh
pnpm --dir benchmarks bench:wave28
```

Run Wave 29 Phase 4 golden path gate:

```sh
pnpm --dir benchmarks bench:wave29
```

Run Director Angel Beta-2 execution-lane golden path gate:

```sh
pnpm --dir benchmarks bench:directorbeta2
```

Run Director Angel Beta-5 published knowledge recall gate:

```sh
pnpm --dir benchmarks bench:directorbeta5
```

Run Director Angel Phase P2 Wave 1 real execution handoff gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave1
```

Run Director Angel Phase P2 Wave 2 dual execution chain gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave2
```

Run Director Angel Phase P2 Wave 3 retryable bridge failure gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave3
```

Run Director Angel Phase P2 Wave 4 non-retryable bridge failure gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave4
```

Run Director Angel Phase P2 Wave 5 retry policy boundary gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave5
```

Run Director Angel Phase P2 Wave 6 failover boundary gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave6
```

Run Director Angel Phase P2 Wave 7 route recovery audit closure gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave7
```

Run Director Angel Phase P2 Wave 8 chain route health snapshot gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave8
```

Run Director Angel Phase P2 Wave 9 chain route doctor visibility gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave9
```

Run Director Angel Phase P2 Wave 10 worker once operator entry gate:

```sh
pnpm --dir benchmarks bench:director-phase-p2-wave10
```

The canonical list of suites, commands, and descriptions lives in `benchmarks/scripts/wave-suite-manifest.mjs`.
规范来源是 `benchmarks/scripts/wave-suite-manifest.mjs`。如果你改了下面这张表，也要同步更新 manifest，以及所有依赖这套顺序的脚本或文档。

| Suite | Command | Description |
| --- | --- | --- |
| wave1-quality-gate | `pnpm --dir benchmarks bench:quality` | Wave 1 quality gate scenario + replay benchmark cases. |
| wave2-recovery-gate | `pnpm --dir benchmarks bench:recovery` | Wave 2 interrupted-turn recovery gate. |
| wave3-governance-gate | `pnpm --dir benchmarks bench:governance` | Wave 3 governance and degradation coverage. |
| wave4-task-control-plane-gate | `pnpm --dir benchmarks bench:taskplane` | Wave 4 task/control-plane vertical slice gate. |
| wave5-task-contract-gate | `pnpm --dir benchmarks bench:taskcontract` | Wave 5 contract coverage for task events and recovery boundaries. |
| wave6-dynamic-context-gate | `pnpm --dir benchmarks bench:context` | Wave 6 dynamic context, tool injection, budget omission, and memory degrade coverage. |
| wave7-provider-run-gate | `pnpm --dir benchmarks bench:provider` | Wave 7 real provider run gate. |
| wave8-doctor-gate | `pnpm --dir benchmarks bench:doctor` | Wave 8 doctor diagnostics coverage. |
| wave9-channels-gate | `pnpm --dir benchmarks bench:channels` | Wave 9 direct/thread routing contract gate. |
| wave10-gateway-gate | `pnpm --dir benchmarks bench:gateway` | Wave 10 gateway HTTP contract gate. |
| wave11-worker-jobs-gate | `pnpm --dir benchmarks bench:workerjobs` | Wave 11 worker jobs proposal pipeline gate. |
| wave12-delegation-flow-gate | `pnpm --dir benchmarks bench:delegationflow` | Wave 12 delegation mailbox + verification coverage. |
| wave13-proposal-reconcile-gate | `pnpm --dir benchmarks bench:reconcile` | Wave 13 proposal reconcile + safe apply gate. |
| wave14-runtime-failure-gate | `pnpm --dir benchmarks bench:runtimefailures` | Wave 14 runtime failure + degradation contract gate. |
| wave15-skills-plugins-gate | `pnpm --dir benchmarks bench:skillsplugins` | Wave 15 skills/plugin-runtime/internal-plugins scaffold gate. |
| wave16-skill-reload-gate | `pnpm --dir benchmarks bench:skillreload` | Wave 16 skill reload gate. |
| wave17-skill-review-gate | `pnpm --dir benchmarks bench:skillreview` | Wave 17 skill review gate. |
| wave18-engine-runtime-failure-gate | `pnpm --dir benchmarks bench:enginefailures` | Wave 18 engine runtime failure wrapping gate. |
| wave19-runtime-closure-gate | `pnpm --dir benchmarks bench:runtimeclosure` | Wave 19 runtime closure coverage for memory degrade -> provider failure. |
| wave20-pre-model-boundary-gate | `pnpm --dir benchmarks bench:premodelboundary` | Wave 20 pre-model boundary gate. |
| wave21-streaming-boundary-gate | `pnpm --dir benchmarks bench:streamingboundary` | Wave 21 streaming boundary gate. |
| wave22-mempalace-boundary-gate | `pnpm --dir benchmarks bench:mempalaceboundary` | Wave 22 mempalace/doctor boundary gate. |
| wave23a-operator-surface-gate | `pnpm --dir benchmarks bench:wave23a` | Wave 23a operator/control-plane surface gate. |
| wave23b-onboarding-gate | `pnpm --dir benchmarks bench:wave23b` | Wave 23b onboarding gate. |
| wave23c-preflight-gate | `pnpm --dir benchmarks bench:wave23c` | Wave 23c preflight gate for the compact operator-only readiness surface, recommended command selection, and control-plane probe routing. |
| wave25-learning-input-gate | `pnpm --dir benchmarks bench:wave25` | Wave 25 learning input / digest boundary gate. |
| wave26-proposal-generator-gate | `pnpm --dir benchmarks bench:wave26` | Wave 26 proposal generator, duplicate detection, and low-evidence degradation gate. |
| wave27-operator-surface-gate | `pnpm --dir benchmarks bench:wave27` | Wave 27 operator surface smoke gate for proposal lifecycle actions, control-plane audit evidence, and learning lane doctor checks. |
| wave28-safe-apply-gate | `pnpm --dir benchmarks bench:wave28` | Wave 28 safe apply gate for preview, apply, reload-only visibility, rollback, and audit evidence. |
| wave29-phase4-golden-path-gate | `pnpm --dir benchmarks bench:wave29` | Wave 29 Phase 4 golden path gate for committed trajectory, worker proposal, operator review, safe apply, and reload visibility. |
| director-beta1-golden-path-gate | `pnpm --dir benchmarks bench:directorbeta1` | Director Angel Beta-1 control-kernel golden path gate for runtime, clarification, blueprint handoff, outcome capture, and observation visibility. |
| director-beta2-golden-path-gate | `pnpm --dir benchmarks bench:directorbeta2` | Director Angel Beta-2 execution-lane golden path gate for reviewed blueprint materialization, operator run control, mock worker completion, and run-report evidence. |
| director-beta5-published-knowledge-recall-gate | `pnpm --dir benchmarks bench:directorbeta5` | Director Angel Beta-5 published knowledge recall gate for accepted proposal publish, bounded recall preview, doctor visibility, and recall-aware planning. |
| director-phase-p1-platform-entry-gate | `pnpm --dir benchmarks bench:director-platform-entry` | Director Angel Phase P1 platform-entry gate for raw entry golden path, clarification hold, and terminal failure/retry guard visibility. |
| director-phase-p2-wave1-real-execution-adapter-handoff-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave1` | Director Angel Phase P2 Wave 1 gate for reviewed script-planner selection, worker-only real execution handoff, preview fallback, and report-to-memory closure. |
| director-phase-p2-wave2-dual-execution-chain-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave2` | Director Angel Phase P2 Wave 2 gate for `script-planner -> shot-planner` dual execution handoff, worker-only real bridge, preview fallback, and report-to-memory closure. |
| director-phase-p2-wave3-retryable-bridge-failure-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave3` | Director Angel Phase P2 Wave 3 gate for `shot-planner` retryable bridge failure, operator-visible retry guidance, assignment-scoped retry, and recovery back to `completed`. |
| director-phase-p2-wave4-non-retryable-bridge-failure-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave4` | Director Angel Phase P2 Wave 4 gate for `invalid_response` and `http_error 422` non-retryable bridge failures, retry rejection, and `http_error 502` retryable control coverage. |
| director-phase-p2-wave5-retry-policy-boundary-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave5` | Director Angel Phase P2 Wave 5 gate for bounded manual retry budget, retry-budget exhaustion guidance, and second-retry rejection across service, worker host-api, and CLI surfaces. |
| director-phase-p2-wave6-failover-boundary-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave6` | Director Angel Phase P2 Wave 6 gate for operator-controlled reroute, per-route retry reset, and approved-adapter failover guidance across contracts, service, worker host-api, and CLI surfaces. |
| director-phase-p2-wave7-route-recovery-audit-closure-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave7` | Director Angel Phase P2 Wave 7 gate for structured route recovery event evidence, operator-facing audit closure, and acceptance coverage across execution service and CLI surfaces. |
| director-phase-p2-wave8-chain-route-health-snapshot-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave8` | Director Angel Phase P2 Wave 8 gate for chain-wide route health snapshot visibility across director status, run explain, and acceptance surfaces. |
| director-phase-p2-wave9-chain-route-doctor-visibility-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave9` | Director Angel Phase P2 Wave 9 gate for chain route doctor visibility across director doctor classification, CLI rendering, and acceptance surfaces. |
| director-phase-p2-wave10-worker-once-operator-entry-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave10` | Director Angel Phase P2 Wave 10 gate for main-CLI worker-once operator entry, local run execution, and acceptance-surface evidence. |
| director-phase-p2-wave11-run-once-preflight-guidance-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave11` | Director Angel Phase P2 Wave 11 gate for onboarding/preflight surfacing the bounded run-once command when the latest execution chain is healthy and has ready work. |
| director-phase-p2-wave12-run-once-exit-surface-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave12` | Director Angel Phase P2 Wave 12 gate for operator-readable run-once exit status, follow-up guidance, and acceptance-surface evidence. |
| director-phase-p2-wave13-run-once-holding-state-taxonomy-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave13` | Director Angel Phase P2 Wave 13 gate for classifying created/paused holding states after run-once execution, while preserving worker-once and acceptance-surface evidence. |
| director-phase-p2-wave14-run-state-surface-alignment-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave14` | Director Angel Phase P2 Wave 14 gate for aligning run report and run explain with created/paused holding-state taxonomy, while preserving worker-once and acceptance-surface evidence. |
| director-phase-p2-wave15-run-state-visibility-closeout-gate | `pnpm --dir benchmarks bench:director-phase-p2-wave15` | Director Angel Phase P2 Wave 15 gate for closing director status and run audit onto the shared holding-state surface, while preserving acceptance coverage. |
| director-agent-os-kernel-contracts-gate | `pnpm --dir benchmarks bench:director-agent-os-kernel` | Director Angel Agent OS Phase A.0 gate proving turn envelopes, policy/sandbox projection, timeline append-only behavior, memory evidence, and subagent non-escalation contracts stay green. |
| director-agent-os-runtime-mapping-gate | `pnpm --dir benchmarks bench:director-agent-os-runtime-mapping` | Director Angel Agent OS Phase A.1 gate proving existing channel transports, ConversationRuntime results, and session journal evidence project into Agent OS turn envelopes and append-only timelines. |
| director-agent-os-operator-surface-gate | `pnpm --dir benchmarks bench:director-agent-os-operator-surface` | Director Angel Agent OS Phase A.2 gate proving projected Agent OS timeline summaries surface through CLI/operator status without new persistence. |
| director-agent-os-entry-projection-gate | `pnpm --dir benchmarks bench:director-agent-os-entry-projection` | Director Angel Agent OS Phase A.3 gate proving Host API entry/session responses expose optional Agent OS projections through director-entry-contracts while staying read-only and non-voice. |
| director-agent-os-extension-matrix-gate | `pnpm --dir benchmarks bench:director-agent-os-extension-matrix` | Director Angel Agent OS Phase B gate proving extension manifests project into the external tools runtime/control-plane matrix with health, capability, install, sandbox, and doctor evidence. |
| director-agent-os-media-understanding-runner-gate | `pnpm --dir benchmarks bench:director-agent-os-media-understanding` | Director Angel Agent OS Phase B.3 gate proving the built-in media-understanding provider runner invokes through the external tool queue, readonly sandbox admission, trace, and extension matrix projection. |
| director-agent-os-desktop-extension-control-plane-gate | `pnpm --dir benchmarks bench:director-agent-os-desktop-extension-control-plane` | Director Angel Agent OS Phase B.4 gate proving desktop Tools/Settings expose the runtime extension matrix with health, capability, sandbox, source trust, and tool-id evidence. |
| director-agent-os-host-cli-extension-matrix-gate | `pnpm --dir benchmarks bench:director-agent-os-host-cli-extension-matrix` | Director Angel Agent OS Phase B.5 gate proving Host API runtime snapshots and CLI operator output expose the extension matrix with contract guards intact. |
| director-agent-os-mempalace-real-eval-fixture-gate | `pnpm --dir benchmarks bench:director-agent-os-mempalace-real-eval` | Director Angel Agent OS Phase G gate proving MemPalace recall evaluation can run from local real-eval style fixtures with verbatim/provenance evidence and threshold diagnostics. |
| director-phase-g2-agent-os-memory-eval-ops-gate | `pnpm --dir benchmarks bench:director-agent-os-memory-eval-ops` | Director Angel Agent OS Phase G.2 gate proving desktop Review/Ops surfaces the latest local MemPalace fixture eval status, thresholds, quality averages, and diagnostic failures without reading live user datasets. |
| director-phase-g3-agent-os-memory-sweep-safety-gate | `pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety` | Director Angel Agent OS Phase G.3 gate proving future live MemPalace memory eval sweeps require operator approval, anonymization, retention, dry-run, read-only, and network-disabled safety preflight before any real user dataset can be touched. |
| director-phase-g4-agent-os-memory-sweep-safety-ops-gate | `pnpm --dir benchmarks bench:director-agent-os-memory-sweep-safety-ops` | Director Angel Agent OS Phase G.4 gate proving desktop Review/Ops surfaces live memory eval safety preflight blocked/ready plans without reading live user datasets. |
| director-phase-gnext-agent-os-memory-dataset-loader-anonymization-gate | `pnpm --dir benchmarks bench:director-agent-os-memory-dataset-loader-anonymization` | Director Angel Agent OS G.next gate proving approved local public-benchmark memory dataset manifests become anonymized recall fixtures with no raw identifier leakage, no raw content storage, TTL, dry-run, read-only, and network-disabled constraints. |
| director-phase-gnext-agent-os-memory-eval-dashboard-maintenance-gate | `pnpm --dir benchmarks bench:director-agent-os-memory-eval-dashboard-maintenance` | Director Angel Agent OS G.next gate proving desktop Review/Ops surfaces a local-only memory eval dashboard with recall trend, dataset-loader safety state, and maintenance-due actions without reading live user datasets. |
| director-agent-os-sandbox-preflight-gate | `pnpm --dir benchmarks bench:director-agent-os-sandbox-preflight` | Director Angel Agent OS Phase C gate proving approved mutating model-tool calls fail closed unless an Agent OS sandbox preflight allows execution. |
| director-agent-os-sandbox-runtime-gate | `pnpm --dir benchmarks bench:director-agent-os-sandbox-runtime` | Director Angel Agent OS Phase C gate proving sandbox execution plans fail closed on denied preflight, disabled backends, cwd scope, and network escalation. |
| director-agent-os-non-voice-release-safety-gate | `pnpm --dir benchmarks bench:director-agent-os-non-voice-release-safety` | Director Angel Agent OS Phase C.27 release safety gate proving active non-voice runtime source does not grow unreviewed process runners, open-url side doors, legacy prefix APIs, or premature TTS/STT runner work. |
| director-phase-cnext-agent-os-runner-scan-migration-batch-gate | `pnpm --dir benchmarks bench:director-agent-os-runner-scan-migration-batch` | Director Angel Agent OS C.next gate scanning active media/browser/Notebook runner surfaces for unreviewed OS process runners, Playwright/Chromium/ffmpeg/local media server drift, legacy prefix APIs, and missing sandbox/process-ledger evidence. |
| director-phase-browsernext-agent-os-notebook-browser-automation-hardening-gate | `pnpm --dir benchmarks bench:director-agent-os-notebook-browser-automation-hardening` | Director Angel Agent OS Browser.next gate proving browser.desktop remains an Electron BrowserWindow runner, Notebook/browser providers require operator scope for credential/profile access, and unmanaged Playwright/Chromium/Puppeteer processes remain blocked. |
| director-phase-dnext-agent-os-channel-adapter-v2-template-gate | `pnpm --dir benchmarks bench:director-agent-os-channel-adapter-v2-template` | Director Angel Agent OS D.next gate proving a second non-desktop/non-weixin channel adapter v2 template binds to the shared runtime contract and forbids channel-specific tool side doors. |
| director-phase-uxnext-agent-os-provider-setup-guidance-gate | `pnpm --dir benchmarks bench:director-agent-os-provider-setup-guidance` | Director Angel Agent OS UX.next gate proving desktop Settings/Tools surfaces external tool/provider setup guidance for needs-auth, install, reconnect, and last-known-good states without reading or displaying SecretRef/Keychain secret values. |
| director-phase-voicenext-agent-os-voice-runner-readiness-gate | `pnpm --dir benchmarks bench:director-agent-os-voice-runner-readiness` | Director Angel Agent OS Voice.next gate proving speech-to-text and text-to-speech live runner readiness stays fail-closed until operator evidence exists. |
| director-phase-voicenext-agent-os-voice-evidence-manifest-validator-gate | `pnpm --dir benchmarks bench:director-agent-os-voice-evidence-manifest-validator` | Director Angel Agent OS Voice.next gate proving speech-to-text and text-to-speech evidence manifests validate only in local dry-run mode. |
| director-phase-voicenext-agent-os-voice-provider-matrix-runner-admission-gate | `pnpm --dir benchmarks bench:director-agent-os-voice-provider-matrix-runner-admission` | Director Angel Agent OS Voice.next gate proving STT/TTS provider matrix and runner admission stay fail-closed without credentials, network, audio devices, Whisper, provider SDKs, or live runners. |
| director-phase-voicenext-agent-os-voice-regression-safety-gate | `pnpm --dir benchmarks bench:director-agent-os-voice-regression-safety` | Director Angel Agent OS Voice.next regression gate proving STT, TTS, Whisper, realtime Talk, and multi-channel voice input stay fail-closed without microphone autostart, raw audio reads, provider credentials, naked local processes, autoplay, or channel-specific side doors. |
| director-agent-os-skill-evolution-gate | `pnpm --dir benchmarks bench:director-agent-os-skill-evolution` | Director Angel Agent OS Phase E.1 gate proving accepted experience candidates are promoted through one shared Skill proposal bridge with provenance, privacy, model-invocation, operator-review, and entry-surface delegation invariants intact. |
| director-phase-enext-agent-os-skill-patch-editor-diff-confirmation-gate | `pnpm --dir benchmarks bench:director-agent-os-skill-patch-editor-diff-confirmation` | Director Angel Agent OS E.next gate proving desktop Skill curator patches use a visible patch editor, explicit diff confirmation, bounded Skill patch payloads, local operator scope, and guarded auto apply while remote curator write execution remains disabled. |
| director-phase-enext-agent-os-skill-failure-to-patch-eval-gate | `pnpm --dir benchmarks bench:director-agent-os-skill-failure-to-patch-eval` | Director Angel Agent OS E.next gate proving repeated Skill failures generate review-gated patch proposals, dangerous proposals are rejected, and no Skill promotion happens without accepted review. |
| director-agent-os-subagents-gate | `pnpm --dir benchmarks bench:director-agent-os-subagents` | Director Angel Agent OS Phase F gate proving AgentTool/SubagentProfile contracts, bounded non-escalating child envelopes, parent-visible results, task-backed subagent projection, Host API/CLI operator visibility, conversation-runtime agent.delegate scheduling, desktop task-plane binding, Weixin remote fail-closed behavior, and worker-route hardening stay green without voice or new OS runner work. |
| director-phase-fnext-agent-os-bounded-scheduler-executor-gate | `pnpm --dir benchmarks bench:director-agent-os-bounded-scheduler-executor` | Director Angel Agent OS F.next gate proving the bounded local scheduler executor consumes scheduler tick dispatch intents through task-plane run-delegation without direct process runners, remote writes, or scheduler bypasses. |
| director-phase-fnext-agent-os-child-git-diff-observed-write-set-gate | `pnpm --dir benchmarks bench:director-agent-os-child-git-diff-observed-write-set` | Director Angel Agent OS F.next gate proving child-run observed write-set evidence can be collected from bounded workspace git index metadata without spawning git, staging, committing, resetting, or rolling back user changes. |
| director-phase-fnext-agent-os-executable-recovery-workflow-gate | `pnpm --dir benchmarks bench:director-agent-os-executable-recovery-workflow` | Director Angel Agent OS F.next gate proving scheduler recovery actions execute as a bounded local workflow with dry-run default, operator-confirmed observed-drift cancellation, and no process runners or remote writes. |
| director-agent-os-release-suite-coverage-gate | `pnpm --dir benchmarks bench:director-agent-os-release-suite` | Director Angel Agent OS Phase H.1 gate proving the release eval suite covers required smoke, synthetic, real-provider, and real-data Agent OS gates and keeps live-only checks explicit. |
| director-agent-os-all-gate | `pnpm --dir benchmarks bench:director-agent-os-all` | Director Angel Agent OS Phase H.1 aggregate release gate running CI-safe smoke, synthetic, local real-provider, and local real-data tiers while recording skip reasons for live desktop, Weixin, provider-account, and real-user-data checks. |
| director-phase-h2-agent-os-desktop-release-ops-gate | `pnpm --dir benchmarks bench:director-agent-os-desktop-release-ops` | Director Angel Agent OS Phase H.2 gate proving desktop Review/Ops surfaces the latest aggregate release gate tier matrix and live-only skipped checks as an operator checklist. |
| director-phase-h3-agent-os-release-smoke-readiness-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-readiness` | Director Angel Agent OS Phase H.3 gate proving live-only release smoke checks become read-only readiness plans before any real desktop, Weixin, provider, browser auth, or user-memory smoke can run. |
| director-phase-h4-agent-os-release-smoke-admission-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-admission` | Director Angel Agent OS Phase H.4 gate proving live-only release smoke readiness plans remain blocked by explicit admission verdicts until operator scope, auth, environment isolation, audit evidence, and data policy are satisfied. |
| director-phase-h5-agent-os-release-smoke-execution-preflight-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-execution-preflight` | Director Angel Agent OS Phase H.5 gate proving live-only release smoke admission verdicts produce explicit execution preflight evidence packets before any execution intent or live runner can start. |
| director-phase-h6-agent-os-release-smoke-evidence-intake-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-intake` | Director Angel Agent OS Phase H.6 gate proving live-only release smoke execution preflight packets stay blocked behind local operator evidence manifests without remote intake, user-data reads, or runner unlocks. |
| director-phase-h7-agent-os-release-smoke-evidence-manifest-preflight-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-preflight` | Director Angel Agent OS Phase H.7 gate proving local operator evidence manifests stay blocked behind schema preflight without reading manifest content, remote manifests, or runner unlocks. |
| director-phase-h8-agent-os-release-smoke-evidence-manifest-validation-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-validation` | Director Angel Agent OS Phase H.8 gate proving local operator evidence manifests stay blocked behind schema-only validation without manifest reads, audit artifact readiness, or runner unlocks. |
| director-phase-h9-agent-os-release-smoke-evidence-manifest-path-authorization-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-path-authorization` | Director Angel Agent OS Phase H.9 gate proving local operator evidence manifests stay blocked until an operator-owned local path authorization contract is satisfied without reading manifest content or unlocking runners. |
| director-phase-h10-agent-os-release-smoke-evidence-manifest-schema-validator-readiness-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-validator-readiness` | Director Angel Agent OS Phase H.10 gate proving local schema validator readiness stays blocked until schema binding, path authorization, manifest read authorization, and audit artifact readiness are satisfied without reading manifest content or unlocking runners. |
| director-phase-h11-agent-os-release-smoke-evidence-manifest-schema-definition-binding-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-schema-definition-binding` | Director Angel Agent OS Phase H.11 gate proving schema definition binding stays blocked until a local schema definition reference, schema loader, validator readiness, manifest read authorization, and audit artifact readiness are satisfied without reading manifest content or unlocking runners. |
| director-phase-h12-agent-os-release-smoke-evidence-manifest-read-authorization-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-read-authorization` | Director Angel Agent OS Phase H.12 gate proving manifest read authorization stays blocked until operator read scope, local path authorization, schema definition binding, audit artifact readiness, and runner intent controls are satisfied without reading manifest content or unlocking runners. |
| director-phase-h13-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-evidence-manifest-audit-artifact-readiness` | Director Angel Agent OS Phase H.13 gate proving audit artifact readiness stays blocked until local audit artifact path, write authorization, manifest read authorization, manifest content read state, and runner intent controls are satisfied without writing audit artifacts, reading manifest content, or unlocking runners. |
| director-phase-h14-agent-os-release-smoke-runner-intent-signing-revocation-gate | `pnpm --dir benchmarks bench:director-agent-os-release-smoke-runner-intent-signing-revocation` | Director Angel Agent OS Phase H.14 gate proving runner intent signing and revocation stay fail-closed until signing key, signature, revocation record, audit artifact readiness, and manifest content read state are satisfied without issuing runner tokens, starting live runners, or reading manifest content. |
| director-phase-i1-agent-os-desktop-smoke-evidence-artifact-gate | `pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-evidence-artifact` | Director Angel Agent OS Phase I.1 gate proving the desktop smoke evidence artifact writer only emits local operator-owned dry-run metadata without reading user data, starting desktop/Weixin/provider/browser automation, issuing runner tokens, or starting live runners. |
| director-phase-i2-agent-os-desktop-smoke-manual-run-artifact-validator-gate | `pnpm --dir benchmarks bench:director-agent-os-desktop-smoke-manual-run-artifact-validator` | Director Angel Agent OS Phase I.2 gate proving the desktop smoke manual-run artifact validator checks schema, path, signing, and revocation state without automatic desktop clicks, manifest content reads beyond the explicit dry-run artifact, runner tokens, or live runners. |
| director-phase-i3-agent-os-non-voice-provider-smoke-candidate-gate | `pnpm --dir benchmarks bench:director-agent-os-non-voice-provider-smoke-candidate` | Director Angel Agent OS Phase I.3 gate proving the non-voice provider smoke candidate uses media-understanding.local as a local metadata dry-run path with readonly sandbox admission, no credentials, no network, no live runner, and fail-closed runner intent state. |
| director-phase-bnext-agent-os-real-non-voice-provider-runner-extension-gate | `pnpm --dir benchmarks bench:director-agent-os-real-non-voice-provider-runner-extension` | Director Angel Agent OS B.next gate proving a sandbox-owned real non-voice provider runner extension uses media-analysis.local through sandbox preflight, execution plan, backend admission, command execution evidence, process ledger, no credentials, no network, no live runner, and fail-closed runner intent controls. |
| director-phase-i4-agent-os-controlled-runner-intent-token-prototype-gate | `pnpm --dir benchmarks bench:director-agent-os-controlled-runner-intent-token-prototype` | Director Angel Agent OS Phase I.4 gate proving the controlled runner intent token prototype only issues a local dry-run envelope with TTL, revocation record, operator scope, artifact hash bundle, and no-user-data guarantee while refusing live runner tokens. |
| cli-e2e-smoke | `pnpm --dir benchmarks e2e:smoke` | CLI smoke end-to-end scenario. |
| cli-run-benchmark | `pnpm --dir benchmarks bench:run` | CLI benchmark harness runner (optional). |

## Fixtures

- `fixtures/cli-run-scenarios.json` defines CLI run scenarios.
- `fixtures/wave1-quality-gate.json` defines fixed Wave 1 regression cases.
- `fixtures/wave2-recovery-gate.json` defines interrupted-turn recovery cases.
- `fixtures/wave3-governance-gate.json` defines governance and degradation cases.
- `fixtures/wave4-task-control-plane-gate.json` defines task/control-plane vertical slice cases.
- `fixtures/wave5-task-contract-gate.json` defines task event contract and recovery-boundary cases.
- `fixtures/wave6-dynamic-context-gate.json` defines dynamic context, tool injection, budget omission, and memory degrade coverage.
- `fixtures/wave7-provider-run-gate.json` defines real provider roundtrip, config-missing, transient, and fatal provider cases.
- `fixtures/wave8-doctor-gate.json` defines doctor coverage for structured diagnostics, provider selection failures, and session DB openability.
- `fixtures/wave9-channels-gate.json` defines direct/thread routing, invalid hint validation, and delivery/envelope contract coverage.
- `fixtures/wave10-gateway-gate.json` defines health, direct/thread HTTP delivery, validation failure, and method rejection coverage.
- `fixtures/wave11-worker-jobs-gate.json` defines worker-generated skill proposal coverage for committed snapshot read, proposal queue/outbox isolation, safe reconcile, and reload-only visibility.
- `fixtures/wave12-delegation-flow-gate.json` defines one-hop coordinator -> worker -> verifier coverage for mailbox claim + verification verdict persistence.
- `fixtures/wave13-proposal-reconcile-gate.json` defines accepted proposal -> safe apply coverage for the bounded reconcile boundary.
- `fixtures/wave14-runtime-failure-gate.json` defines provider transient/fatal + memory degrade runtime contract coverage.
- `fixtures/wave15-skills-plugins-gate.json` defines skills/plugin-runtime/internal-plugins scaffold and strict-when-ready contract coverage.
- `fixtures/wave16-skill-reload-gate.json` defines worker skill proposal -> safe apply -> reload visibility coverage.
- `fixtures/wave17-skill-review-gate.json` defines skill proposal review accept/reject and pre-reconcile invisibility coverage.
- `fixtures/wave18-engine-runtime-failure-gate.json` defines engine-level provider failure wrapping + runtime.failed journal/evidence coverage.
- `fixtures/wave19-runtime-closure-gate.json` defines cross-layer runtime closure coverage for memory degrade -> provider failure and tool degraded/failed terminal semantics.
- `fixtures/wave20-pre-model-boundary-gate.json` defines pre-model recovery-anchor persistence and internal checkpoint error boundary coverage.
- `fixtures/wave21-streaming-boundary-gate.json` defines stream interruption/resume closure, provider failure closure, and resumed-turn continuation coverage.
- `fixtures/wave22-mempalace-boundary-gate.json` defines optional mempalace doctor health visibility and non-blocking engine degradation coverage.
- `fixtures/wave25-learning-input-gate.json` defines deterministic digest, single-turn scope, and no-proposal-side-effect coverage for the learning input boundary.
- `fixtures/wave26-proposal-generator-gate.json` defines rich proposal payload generation, duplicate detection, and low-evidence degradation coverage for Proposal Generator v1.
- `fixtures/wave29-phase4-golden-path-gate.json` defines the minimal Phase 4 golden path: committed trajectory -> worker proposal -> operator review/apply -> reload visibility.
- `fixtures/director-beta1-golden-path-gate.json` defines the Director Angel Beta-1 dual-snapshot golden path: clarification-needed preview -> ready-for-blueprint preview -> outcome capture -> observation visibility.
- `fixtures/director-beta2-golden-path-gate.json` defines the Director Angel Beta-2 execution-lane golden path: reviewed blueprint -> execution run -> pause/resume operator control -> mock worker completion -> run report evidence.
- `fixtures/director-beta5-published-knowledge-recall-gate.json` defines accepted proposal publish, published knowledge recall, doctor visibility, and recall-aware planning coverage.
- `fixtures/director-phase-p1-platform-entry-gate.json` defines the Director Angel Phase P1 platform-entry acceptance cases: raw entry golden path, clarification hold, and terminal failure/retry guard visibility.
- `fixtures/director-phase-p2-wave1-real-execution-adapter-handoff-gate.json` defines the Director Angel Phase P2 Wave 1 acceptance cases: reviewed script-planner execution selection, worker-only real bridge handoff, and forced preview fallback.
- `fixtures/director-phase-p2-wave2-dual-execution-chain-gate.json` defines the Director Angel Phase P2 Wave 2 acceptance cases: reviewed `script-planner -> shot-planner` dual execution selection, worker-only real bridge chain, and forced preview fallback.
- `fixtures/director-phase-p2-wave3-retryable-bridge-failure-gate.json` defines the Director Angel Phase P2 Wave 3 acceptance case: `shot-planner` timeout failure, operator-visible retry guidance, assignment-scoped retry, and recovery back to `completed`.
- `fixtures/director-phase-p2-wave4-non-retryable-bridge-failure-gate.json` defines the Director Angel Phase P2 Wave 4 acceptance cases: `invalid_response`, `http_error 422` non-retryable retry rejection, and `http_error 502` retryable control coverage.
- `scripts/director-phase-p2-wave5-retry-policy-boundary-gate.mjs` defines the Director Angel Phase P2 Wave 5 acceptance evidence run: bounded retry budget, retry-budget exhaustion guidance, and second-retry rejection across contracts, service, worker host-api, and CLI surfaces.
- `scripts/director-phase-p2-wave6-failover-boundary-gate.mjs` defines the Director Angel Phase P2 Wave 6 acceptance evidence run: operator-controlled reroute, approved-adapter enforcement, per-route retry reset, and CLI/operator-surface failover guidance.
- `scripts/director-phase-p2-wave7-route-recovery-audit-closure-gate.mjs` defines the Director Angel Phase P2 Wave 7 acceptance evidence run: structured route recovery event payloads, operator-facing audit closure, and acceptance coverage for the execution adapter recovery trail.
- `scripts/director-phase-p2-wave8-chain-route-health-snapshot-gate.mjs` defines the Director Angel Phase P2 Wave 8 acceptance evidence run: chain-wide route health snapshot visibility across director status, run explain, and acceptance coverage.
- `scripts/director-phase-p2-wave9-chain-route-doctor-visibility-gate.mjs` defines the Director Angel Phase P2 Wave 9 acceptance evidence run: chain route doctor classification, CLI visibility, and acceptance coverage.
- `scripts/director-phase-p2-wave10-worker-once-operator-entry-gate.mjs` defines the Director Angel Phase P2 Wave 10 acceptance evidence run: main-CLI worker-once operator entry, local execution closure, and acceptance coverage.
- `scripts/director-phase-p2-wave11-run-once-preflight-guidance-gate.mjs` defines the Director Angel Phase P2 Wave 11 acceptance evidence run: onboarding/preflight surfacing the bounded run-once command when the latest execution chain is healthy and has ready work.
- `scripts/director-phase-p2-wave12-run-once-exit-surface-gate.mjs` defines the Director Angel Phase P2 Wave 12 acceptance evidence run: operator-readable run-once exit status, follow-up guidance, and acceptance coverage.
- `scripts/director-phase-p2-wave13-run-once-holding-state-taxonomy-gate.mjs` defines the Director Angel Phase P2 Wave 13 acceptance evidence run: created/paused holding-state taxonomy after bounded run-once execution, with worker-once and acceptance coverage preserved.
- `scripts/director-phase-p2-wave14-run-state-surface-alignment-gate.mjs` defines the Director Angel Phase P2 Wave 14 acceptance evidence run: run-report and run-explain alignment onto the shared holding-state taxonomy.
- `scripts/director-phase-p2-wave15-run-state-visibility-closeout-gate.mjs` defines the Director Angel Phase P2 Wave 15 acceptance evidence run: director status + run audit alignment onto the shared holding-state surface, plus acceptance closure.

## Outputs

Generated reports are written under `benchmarks/results/`:

- `cli-e2e-smoke-latest.json`
- `cli-run-latest.json`
- `wave1-quality-gate-latest.json`
- `wave2-recovery-gate-latest.json`
- `wave3-governance-gate-latest.json`
- `wave4-task-control-plane-gate-latest.json`
- `wave5-task-contract-gate-latest.json`
- `wave6-dynamic-context-gate-latest.json`
- `wave7-provider-run-gate-latest.json`
- `wave8-doctor-gate-latest.json`
- `wave9-channels-gate-latest.json`
- `wave10-gateway-gate-latest.json`
- `wave11-worker-jobs-gate-latest.json`
- `wave12-delegation-flow-gate-latest.json`
- `wave13-proposal-reconcile-gate-latest.json`
- `wave14-runtime-failure-gate-latest.json`
- `wave15-skills-plugins-gate-latest.json`
- `wave16-skill-reload-gate-latest.json`
- `wave17-skill-review-gate-latest.json`
- `wave18-engine-runtime-failure-gate-latest.json`
- `wave19-runtime-closure-gate-latest.json`
- `wave20-pre-model-boundary-gate-latest.json`
- `wave21-streaming-boundary-gate-latest.json`
- `wave22-mempalace-boundary-gate-latest.json`
- `wave23a-operator-surface-gate-latest.json`
- `wave23b-onboarding-gate-latest.json`
- `wave23c-preflight-gate-latest.json`
- `wave25-learning-input-gate-latest.json`
- `wave26-proposal-generator-gate-latest.json`
- `wave27-operator-surface-gate-latest.json`
- `wave28-safe-apply-gate-latest.json`
- `wave29-phase4-golden-path-gate-latest.json`
- `director-beta1-golden-path-gate-latest.json`
- `director-beta2-golden-path-gate-latest.json`
- `director-beta5-published-knowledge-recall-gate-latest.json`
- `director-phase-p1-platform-entry-gate-latest.json`
- `director-phase-p2-wave1-real-execution-adapter-handoff-gate-latest.json`
- `director-phase-p2-wave2-dual-execution-chain-gate-latest.json`
- `director-phase-p2-wave3-retryable-bridge-failure-gate-latest.json`
- `director-phase-p2-wave4-non-retryable-bridge-failure-gate-latest.json`
- `director-phase-p2-wave5-retry-policy-boundary-gate-latest.json`
- `director-phase-p2-wave6-failover-boundary-gate-latest.json`
- `director-phase-p2-wave7-route-recovery-audit-closure-gate-latest.json`
- `director-phase-p2-wave8-chain-route-health-snapshot-gate-latest.json`
- `director-phase-p2-wave9-chain-route-doctor-visibility-gate-latest.json`
- `director-phase-p2-wave10-worker-once-operator-entry-gate-latest.json`
- `bench-all-latest.json` (machine-readable aggregate report)
- `bench-all-latest.md` (human-readable aggregate report)

`HOTFLOW_CLI_SESSION_DB_PATH` is set to `benchmarks/.tmp/cli-bench.sqlite` for isolated benchmark sessions.

Wave 24 closure status is signed off in `docs/plans/wave24-acceptance-checklist.md`.
