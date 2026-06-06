[中文版](./README.zh.md) | [English](./README.md)

# Director Angel OS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml/badge.svg)](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22%20%3C25-blue.svg)](./package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange.svg)](./package.json)

> 一句话：Director Angel OS 是一个用 TypeScript 写的「AI Agent 操作系统骨架」。
> 如果最终的 Agent 产品是一辆车，Director Angel OS 更像它的底盘：会话运行时、工具执行边界、控制面、记忆边界，以及一条受控学习闭环。

[为什么是 Director Angel OS](#为什么是-director-angel-os) · [当前能力](#当前已经包含) · [快速开始](#快速开始) · [黄金路径](#30-分钟最小黄金路径) · [架构文档](./docs/architecture.md) · [更多文档](#深入阅读)

```text
workspace -> session -> journal/checkpoint -> tools/models/policy -> tasks/delegation/verification -> proposal/review/safe apply
```

Director Angel OS 是一个基于 MIT 协议的 TypeScript monorepo，用来搭建真正可运行、可恢复、可治理的 Agent 底层系统，而不是每次都从空白仓库重造一遍运行底座。

注意：仓库内部目前仍然保留历史包命名 `hotflow` / `@hotflow/*`。

## 为什么是 Director Angel OS

- 它是底盘，不是 demo：你可以直接在上面装自己的 Agent 产品，而不是先重造运行底座
- 默认就是可恢复的：session、journal、checkpoint、resume 已经是运行时模型的一部分
- 学习闭环是受控的：proposal -> review -> safe apply -> rollback 这条链路天然可检查、可审查
- 操作面已经在仓库里：CLI、gateway、worker-jobs、control-plane 这些边界都不是事后补的
- TypeScript-first monorepo：适合真正想搭系统、而不是只写一个实验脚本的团队

## 它是什么

Director Angel OS 不是一个现成可用的垂直 Agent 产品。
它更像 Agent 产品下面的底层结构件：会话存储、journal/checkpoint 恢复、任务平面、工具/模型/策略边界、CLI 与 gateway 入口、worker-jobs，以及一条受控的 proposal -> review -> safe apply -> rollback 路径。

## 适合谁

- 想搭建严肃 Agent runtime，而不是只做 prompt demo 的团队
- 需要 session、恢复、审计、任务分发和受控演化边界的产品团队
- 想从一个有结构的 TypeScript 底座起步的工程师和研究者

## 当前已经包含

- 带 journal、checkpoint、resume、recovery 的 session-aware runtime
- 包含 todos、delegation、verification、proposal queue、outbox 的 task-plane 原语
- 清晰的 tools、models、policy、engine、CLI、gateway、worker-jobs 边界
- 一条受控的自我进化路径：committed trajectory -> skill proposal -> review -> safe apply -> reload visibility -> snapshot rollback
- 用于回归检查和边界验证的 benchmark 与 operator 文档

## 它不承诺什么

- 它不是一个开箱即用的垂直 Agent 产品
- 它不是一个无边界自动自我修改系统
- 它还不是稳定的外部 plugin marketplace 或 public SDK

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

首跑路径默认使用内置的 `scripted` provider，所以你可以先验证底盘跑通，再接真实模型 API。

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
