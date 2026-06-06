[中文版](./README.zh.md) | [English](./README.md)

# Director Angel OS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml/badge.svg)](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22%20%3C25-blue.svg)](./package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange.svg)](./package.json)

> 一句话：Director Angel OS 把一个「职位」变成可治理、可执行、可成长的 AI 数字岗位。
> 改职位，就改职责图谱；改职责，就改工具、记忆、任务、审查和进化路径。它不是一个泛泛聊天助手，而是一套让 Agent 按岗位长期工作的操作系统。

[过去-现在-未来](#过去-现在-未来) · [为什么是 Director Angel OS](#为什么是-director-angel-os) · [职位驱动的-agent-os](#职位驱动的-agent-os) · [当前能力](#当前已经包含) · [快速开始](#快速开始) · [黄金路径](#30-分钟最小黄金路径) · [架构文档](./docs/architecture.md) · [更多文档](#深入阅读)

```text
职位 -> 职责 -> 会话 -> 工具/模型/策略 -> 任务执行 -> 证据 -> 记忆 -> 审查后进化
```

Director Angel OS 是一个基于 MIT 协议的 TypeScript Agent OS，用来打造真正能上岗的 AI 数字执行体：知道自己的职位，理解职责边界，通过受控工具执行任务，留下证据，沉淀记忆，并在审查后持续进化。

核心判断很简单：未来的 Agent 不应该只是一个 prompt 加几个工具。它应该有职位，有职责，有边界，有记忆，有审计，有恢复能力，也有一条可见、可回滚、可监督的自我升级通道。

注意：仓库内部目前仍然保留历史包命名 `hotflow` / `@hotflow/*`。

## 过去-现在-未来

过去：大多数 Agent 只是无状态 prompt wrapper。它能回答、能调用工具、能串几步流程，但真正有价值的工作上下文、职责边界、执行证据和经验沉淀，经常在一次会话结束后就散掉。

现在：Director Angel OS 把「职位」变成 runtime 单位。职位决定它能做什么、不能做什么、能用哪些工具、要交付什么证据、能调用哪些记忆、怎样被审查、怎样在安全边界内升级。

未来：每一个严肃岗位都可以部署成一个长期在线的数字执行体。你可以把它设成研究员、导演、运营、审核员、任务工人、行业专家；当职位改变，职责和能力随之演化，系统仍然保留治理、审计和回滚能力。

## 为什么是 Director Angel OS

真实痛点很硬：

- 只靠 prompt 的 Agent 没有岗位边界。它会漂移、越权、重复问上下文，最后变成人类不断擦屁股。
- 只会调工具的 Agent 缺少执行证据。你拿到结果，却很难确认它为什么这么做、做过什么、哪里失败过。
- 记忆如果只是大杂烩，会从资产变成污染源。经验必须可分层、可检索、可清理、可审查。
- 自我进化如果不受控，就是风险；如果只是口号，就是玩具。Director Angel OS 把它收进 proposal -> review -> safe apply -> rollback 的硬流程。
- 多 Agent 协作如果没有任务平面、委派、验证、队列和状态，就会很快变成混乱聊天群。

Director Angel OS 解决的是操作系统级问题，不是 prompt 小技巧。

## 职位驱动的 Agent OS

Director Angel OS 的 Agent 从职位开始：

- `Researcher`：搜集资料、保留来源、沉淀可复用知识
- `Director`：把意图拆成计划、镜头、场景、任务和审查循环
- `Operator`：执行流程、追踪状态、处理中断和恢复
- `Reviewer`：检查输出、审查证据、阻断不安全变更
- `Worker`：消费任务、汇报进度、返回结构化结果

职位可以随时改。职位一改，职责、工具权限、记忆访问、任务路由、验证标准和自我进化规则都可以跟着改。这才是重点：Agent 不是靠一个万能提示词装聪明，而是从岗位职责里长出能力。

## 适合谁

- 想要 AI 员工，而不是聊天窗口加按钮的团队
- 需要 session、恢复、审计、任务分发、证据链和职责边界的产品团队
- 想做岗位型 Agent、行业型 Agent、长期运行 Agent 的工程师
- 研究记忆、委派、验证、自我进化和 Agent 组织形态的人

## 当前已经包含

- 带 journal、checkpoint、resume、recovery 的 session-aware runtime
- 包含 todos、delegation、verification、proposal queue、outbox 的 task-plane 原语
- 清晰的 tools、models、policy、engine、CLI、gateway、worker-jobs 边界
- 一条受控的自我进化路径：committed trajectory -> skill proposal -> review -> safe apply -> reload visibility -> snapshot rollback
- 面向职位变化、职责演化、任务路由和成长监督的操作面
- 用于回归检查和边界验证的 benchmark 与 operator 文档

## 定位

Director Angel OS 面向的是下一阶段 Agent：不是等你一句一句喂的助手，不是跑一次就散的脚本，不是演示时惊艳、落地时失控的 demo。

它面向能长期持有岗位、跨会话工作、留下证据、接受监督、沉淀经验，并在可审查通道里持续进化的数字执行体。

## 快速开始

前置要求：

- Node.js `>=22 <25`
- `pnpm >=10`

安装并验证整个 monorepo：

```sh
pnpm install
pnpm typecheck
pnpm test
```

如果你想跑完整本地门禁，可以执行：

```sh
pnpm verify
```

## 30 分钟最小黄金路径

如果你想用最短路径从 clone 仓库走到一个真实、可恢复的 session 流程，可以按下面这组命令来。

请一条一条顺序执行，等上一条命令结束后再跑下一条。

首跑路径默认使用内置的 `scripted` provider，所以你可以先验证运行链路，再接真实模型 API。

```sh
pnpm install
pnpm --filter @hotflow/cli dev -- doctor --json
pnpm --filter @hotflow/cli dev -- run "Read README.md and summarize this project."
pnpm --filter @hotflow/cli dev -- golden-path README.md
pnpm --filter @hotflow/cli dev -- resume <sessionId>
```

最后一条 `resume` 里的 `sessionId`，就用 `golden-path` 打印出来的那个值。

预期结果：

- `doctor` 用来确认运行时启动和存储链路健康
- `run` 会通过当前 provider 返回一次真实响应
- `golden-path` 会创建 session、写入 todo，并打印 session ID
- `resume` 会证明这个 session 可以重新打开并恢复

## 示例工作区

如果你不想一上来就把 CLI 指向整个 monorepo，而是想先跑一个更小、更像真实项目的小工作区，可以用：

- [examples/minimal-director-angel-workspace](./examples/minimal-director-angel-workspace)

建议这样跑：

请顺序执行这些命令，不要并发打同一个本地工作区数据库。

这个示例路径默认也走内置的 `scripted` provider。

```sh
cd examples/minimal-director-angel-workspace
export HOTFLOW_WORKSPACE_ROOT="$PWD"
export HOTFLOW_DATA_DIR="$PWD/.hotflow"
pnpm --dir ../../apps/cli dev -- doctor --json
pnpm --dir ../../apps/cli dev -- run "Read README.md and summarize this workspace."
pnpm --dir ../../apps/cli dev -- golden-path README.md
pnpm --dir ../../apps/cli dev -- resume <sessionId>
```

`resume` 里的 `sessionId`，直接使用 `golden-path` 打印出来的值。

## CLI 入口

```sh
pnpm --filter @hotflow/cli dev -- help
pnpm --filter @hotflow/cli dev -- doctor --json
pnpm --filter @hotflow/cli dev -- onboard --json
pnpm --filter @hotflow/cli dev -- run "Summarize this repository."
pnpm --filter @hotflow/cli dev -- golden-path README.md
pnpm --filter @hotflow/cli dev -- resume <sessionId>
```

- `doctor`：检查 runtime bootstrap 和 storage 健康状态
- `onboard`：打印面向 operator 的环境报告
- `run`：通过当前 provider 执行一次 prompt
- `golden-path`：跑通本地 scripted 路径并返回 session ID
- `resume`：重新打开旧 session 并打印恢复状态

## Worker 流程

Proposal 流程：

```sh
pnpm --filter @hotflow/worker-jobs dev -- run-once --session-id <sessionId> --turn-id <turnId>
pnpm --filter @hotflow/worker-jobs dev -- review-skill-proposal --session-id <sessionId> --proposal-id <proposalId>
pnpm --filter @hotflow/worker-jobs dev -- reconcile-skill-proposal --session-id <sessionId> --proposal-id <proposalId>
```

Delegation 与 verification 流程：

```sh
pnpm --filter @hotflow/worker-jobs dev -- run-delegation --session-id <sessionId> --worker-id <workerId> --verifier-id <verifierId>
pnpm --filter @hotflow/worker-jobs dev -- run-verification --session-id <sessionId> --verifier-id <verifierId>
```

如果你希望 CLI 和 `worker-jobs` 看到同一份本地 session / proposal 状态，可以让它们指向同一个 SQLite 文件：

```sh
export HOTFLOW_CLI_SESSION_DB_PATH="$PWD/.hotflow/sessions/shared.sqlite"
export HOTFLOW_WORKER_SESSION_DB_PATH="$HOTFLOW_CLI_SESSION_DB_PATH"
```

如果你还没有验证过本地并发访问，请先顺序使用这份共享 SQLite。

常用环境变量：

- `HOTFLOW_WORKSPACE_ROOT`：默认为当前工作目录
- `HOTFLOW_DATA_DIR`：默认为 `<workspace>/.hotflow`
- `HOTFLOW_SESSION_DB_PATH`：默认为 `<dataDir>/sessions/sessions.sqlite`
- `HOTFLOW_CLI_SESSION_DB_PATH`：覆盖 CLI 专用 session 数据库路径
- `HOTFLOW_WORKER_SESSION_DB_PATH`：覆盖 worker-jobs 专用 session 数据库路径
- `HOTFLOW_DEFAULT_PROVIDER`：默认为 `scripted`
- `HOTFLOW_DEFAULT_MODEL`：默认为 `hotflow-phase1`

## 仓库结构

- `apps/cli`：组合根与当前面向 operator 的入口
- `apps/gateway`：与 session-aware runtime 对齐的最小 HTTP 入口
- `apps/worker-jobs`：proposal pipeline 与受控 worker / verifier 消费端
- `packages/*`：contracts、sessions、models、tools、policy、engine、skills 等可复用 runtime 包
- `docs/plans`：预留给公开实施计划

## 深入阅读

- [docs/architecture.md](./docs/architecture.md)
- [docs/operator-guide.md](./docs/operator-guide.md)
- [docs/failure-and-degrade-guide.md](./docs/failure-and-degrade-guide.md)
- [docs/open-source-boundaries.md](./docs/open-source-boundaries.md)
- [docs/release/v0.1.0-publish-checklist.md](./docs/release/v0.1.0-publish-checklist.md)
- [examples/minimal-director-angel-workspace/README.md](./examples/minimal-director-angel-workspace/README.md)

## License

MIT。见 [LICENSE](./LICENSE)。
