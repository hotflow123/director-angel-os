# Director Angel OS Open-Source Boundaries / Director Angel OS 开源边界

This document defines the public launch boundary for Director Angel OS.
本文件定义 Director Angel OS 开源首发时对外承诺的边界。

The goal is not to shrink contribution space. The goal is to avoid presenting unchartered capabilities as if they already exist.
目的不是压缩贡献空间，而是避免把尚未立项的能力包装成“已经支持”。

## Positioning / 对外定位

Director Angel OS is a role-driven TypeScript Agent OS for turning a defined position into a governed, session-aware, tool-using AI operator with a bounded, operator-controlled learning lane.
Director Angel OS 是一个职位驱动的 TypeScript Agent OS，用来把一个已定义的职位变成具备会话、工具、策略治理和受控学习闭环的 AI 数字执行体。

For the first public release, the concrete demonstration is the Director role. The product direction is broader: users should be able to define custom roles and responsibility boundaries, then let the runtime bind tools, memory, task routing, verification, and evolution to that position.
首发版本的具体演示是导演职责。更大的产品方向是：用户可以自定义职位和职责边界，再让运行时把工具、记忆、任务路由、验证和进化绑定到这个岗位上。

The right story is role-driven execution with hard governance boundaries.
对外口径强调的是“职位驱动执行 + 硬治理边界”。

## In Scope Today / 当前明确在边界内

Changes are in scope if they preserve all of the following:
只有同时满足下面前提的改动，才属于当前边界内：

- `worker only proposes`
- `reload-only visibility`
- `safe apply boundary`
- failures default to `degrade`
- proposal and operator paths stay behind `control-plane`

Within that boundary, the current public release can honestly accept work on:
在这个前提下，当前首发版本可以明确接受的工作包括：

- proposal review, accept, reject, preview, apply, rollback documentation and tests
- CLI, control-plane, and benchmark completion for the existing proposal lifecycle
- approved snapshot `head + history` storage and snapshot-level rollback
- audit evidence for `control.action` and `skills.*`
- Host API external tool control-plane docs and tests
- `moyin-creator` / 魔因漫创 and ComfyUI provider/adapter docs, import/export notes, diagnostics, and guarded regression checks
- in-repo plugin manifests, plugin contract tests, and sandbox boundary hardening
- golden path, failure/degrade, operator, and regression documentation

## Current Hard Boundaries / 当前硬边界

The following must not be described as "Director Angel OS already supports this":
下面这些都不应被表述为“Director Angel OS 已支持”：

- fully automatic accept or auto-apply daemons
- self-generated, self-injected, self-consumed learning inside the same turn
- workers writing approved snapshots directly
- bypassing `control-plane` to mutate proposals or snapshots
- hot injection or hot rollback of skills in the active runtime
- single-skill or partial rollback
- complex three-way merge workflows
- recursive delegation, free-form DAG execution, or agent swarms
- a stable public `plugin-sdk`
- a public plugin marketplace or arbitrary runtime plugin download/execution
- claiming ComfyUI is zero-config or guaranteed to run without a reachable local/cloud service
- claiming ComfyUI import/export is always lossless, executable, or safe without validation
- claiming `moyin-creator` / 魔因漫创 mutation or submit operations run without operator confirmation
- a heavy UI or full web console

## Re-charter Required / 必须重新立项

If a change touches any item below, it is outside the current release boundary and needs a new charter first:
如果改动触碰下面任一项，就不属于当前首发边界，必须先重新立项：

- expanding rollback from snapshot-level to skill-level
- replacing reload-only visibility with immediate runtime mutation after apply
- giving workers direct write access to approved snapshots
- bypassing `control-plane` for convenience
- changing the default failure mode from degrade to hard main-loop failure
- using this launch wave to quietly open Phase 5 scope

## Public Messaging / 对外表述口径

The most accurate public wording today is:
当前最准确的对外说法是：

- Director Angel OS already has a controlled proposal, operator, safe-apply, and reload loop.
- Director Angel OS positions the role as the runtime unit: responsibilities, tools, memory, task routing, and evolution rules should move with the role.
- The current public repository demonstrates those ideas with a Director responsibility set; Director is the first demonstration role, not the product ceiling.
- Director Angel OS has a governed external tool control plane and adapter registry.
- `moyin-creator` / 魔因漫创 and ComfyUI are represented as bounded external providers/adapters with import/export, health, policy, approval, artifact, and degrade boundaries.
- Plugin support currently means controlled in-repo plugins and governed plugin contracts, not a stable public marketplace.
- New skill visibility is still bounded by reload.
- Rollback v1 restores the whole approved snapshot, not individual skills.
- Open-source contributions are welcome around docs, tests, benchmarks, and in-boundary implementation work.
- Any cross-boundary expansion should become a new plan instead of being smuggled into the first public release.

## Naming Note / 命名说明

This release follows `brand-first, namespace-later`.
这次首发采用 `brand-first, namespace-later`。

Public-facing naming is `Director Angel OS`, but some internal names intentionally remain for stability:
对外名称统一为 `Director Angel OS`，但为了控制回归风险，部分内部命名会暂时保留：

- workspace scope remains `@hotflow/*`
- config and type names such as `HotflowConfig` may remain
- environment variables such as `HOTFLOW_*` may remain
- some internal docs, fixtures, and test names may still reference `Hotflow`

Those residual names are implementation carry-over, not the public product name.
这些残留命名属于实现层历史包袱，不代表对外产品名仍然是 Hotflow。

## Contribution Self-Check / 贡献前自检

Before sending a change, ask at least these five questions:
提交前至少自检下面五个问题：

1. Does this let a worker modify an approved snapshot directly?
1. 这个改动会不会让 worker 直接改 approved snapshot？

2. Does this make a newly applied skill take effect in the active runtime without reload?
2. 这个改动会不会让新 skill 在当前 runtime 中不经 reload 就生效？

3. Does this bypass `control-plane`?
3. 这个改动会不会绕过 `control-plane`？

4. Does this quietly introduce partial rollback or complex merge behavior?
4. 这个改动是不是在偷偷引入 partial rollback 或复杂 merge？

5. If this fails, does the system still default to degrade instead of polluting the main loop?
5. 这个改动如果失败，系统是否仍然默认 degrade，而不是污染主循环？

If any answer is "yes", the change is outside the current launch boundary.
只要有一个答案是“会”，这就不是当前首发边界内的改动。
