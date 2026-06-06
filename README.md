[中文版](./README.zh.md) | [English](./README.md)

# Director Angel OS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml/badge.svg)](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22%20%3C25-blue.svg)](./package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange.svg)](./package.json)

> Director Angel OS is a TypeScript AI Agent operating system skeleton.
> If the final agent product is the car, Director Angel OS is the chassis: session runtime, tool execution boundaries, control plane, memory boundaries, and a controlled learning lane.

[Why Director Angel OS](#why-director-angel-os) · [Features](#included-today) · [Quick Start](#quick-start) · [Golden Path](#30-minute-minimal-golden-path) · [Architecture](./docs/architecture.md) · [Docs](#read-more)

```text
workspace -> session -> journal/checkpoint -> tools/models/policy -> tasks/delegation/verification -> proposal/review/safe apply
```

Director Angel OS is an MIT-licensed TypeScript monorepo for building tool-using, session-aware, policy-governed agents without rebuilding the operating layer from scratch every time.

Note: the repository still uses the historical package scope `hotflow` / `@hotflow/*` in code and commands today.

## Why Director Angel OS?

- Chassis, not demo: build your own agent product on top without rebuilding the operating layer first
- Recoverable by default: sessions, journal events, checkpoints, and resume are already part of the runtime model
- Controlled learning lane: proposal -> review -> safe apply -> rollback stays inspectable and operator-governed
- Operational surface included: CLI, gateway, worker jobs, and control-plane boundaries are already part of the repo
- TypeScript-first monorepo: a practical base for teams that want structure, not a one-file experiment

## What It Is

Director Angel OS is not a finished agent product.
It is the lower-level base layer under one: session storage, journal/checkpoint recovery, a task plane, tool/model/policy boundaries, CLI and gateway entrypoints, worker jobs, and a bounded proposal -> review -> safe apply -> rollback lane.

## Who It Is For

- Teams building a serious agent runtime instead of a prompt-only demo
- Product teams that need sessions, recovery, auditability, task routing, and bounded evolution workflows
- Engineers and researchers who want a structured TypeScript base to extend

## Included Today

- Session-aware runtime with journal, checkpoints, resume, and recovery
- Task-plane primitives including todos, delegation, verification, proposal queue, and outbox
- Clear boundaries around tools, models, policy, engine, CLI, gateway, and worker jobs
- A bounded self-evolution path: committed trajectory -> skill proposal -> review -> safe apply -> reload visibility -> snapshot rollback
- Benchmarks and operator-facing docs for regression checking and boundary review

## What It Does Not Promise

- It is not a ready-made vertical agent product
- It is not an unbounded autonomous self-modifying system
- It is not yet a stable external plugin marketplace or public SDK

## Quick Start

Prerequisites:

- Node.js `>=22 <25`
- `pnpm >=10`

Install and verify the monorepo:

```sh
pnpm install
pnpm typecheck
pnpm test
```

Run the broader verification pass when you want the full local gate:

```sh
pnpm verify
```

## 30-Minute Minimal Golden Path

If you want the shortest end-to-end path from clone to a real recoverable session, use this sequence.

Run the commands sequentially. Wait for each command to finish before starting the next one.

The first-run path uses the built-in `scripted` provider, so you can validate the chassis before wiring a real model API.

```sh
pnpm install
pnpm --filter @hotflow/cli dev -- doctor --json
pnpm --filter @hotflow/cli dev -- run "Read README.md and summarize this project."
pnpm --filter @hotflow/cli dev -- golden-path README.md
pnpm --filter @hotflow/cli dev -- resume <sessionId>
```

Use the `sessionId` printed by `golden-path` in the final `resume` command.

Expected outcome:

- `doctor` confirms the runtime bootstrap is healthy
- `run` returns a model response through the configured provider
- `golden-path` creates a session, writes todo items, and prints a session ID
- `resume` proves the session can be reopened and recovered

## Example Workspace

If you want a small, purpose-built workspace instead of pointing the CLI at the whole monorepo, use:

- [examples/minimal-director-angel-workspace](./examples/minimal-director-angel-workspace)

Suggested flow:

Run these commands sequentially against the same local workspace.
Do not run multiple CLI commands against the same local SQLite file at the same time.

This example also uses the built-in `scripted` provider by default.

```sh
cd examples/minimal-director-angel-workspace
export HOTFLOW_WORKSPACE_ROOT="$PWD"
export HOTFLOW_DATA_DIR="$PWD/.hotflow"
pnpm --dir ../../apps/cli dev -- doctor --json
pnpm --dir ../../apps/cli dev -- run "Read README.md and summarize this workspace."
pnpm --dir ../../apps/cli dev -- golden-path README.md
pnpm --dir ../../apps/cli dev -- resume <sessionId>
```

Use the `sessionId` printed by `golden-path`.

## CLI Entry Point

```sh
pnpm --filter @hotflow/cli dev -- help
pnpm --filter @hotflow/cli dev -- doctor --json
pnpm --filter @hotflow/cli dev -- onboard --json
pnpm --filter @hotflow/cli dev -- run "Summarize this repository."
pnpm --filter @hotflow/cli dev -- golden-path README.md
pnpm --filter @hotflow/cli dev -- resume <sessionId>
```

- `doctor` checks runtime bootstrap and storage health
- `onboard` prints the operator-facing environment report
- `run` executes a prompt through the configured provider
- `golden-path` exercises the local scripted path and returns a session ID
- `resume` reopens a previous session and prints its recovery state

## Worker Flow

Proposal flow:

```sh
pnpm --filter @hotflow/worker-jobs dev -- run-once --session-id <sessionId> --turn-id <turnId>
pnpm --filter @hotflow/worker-jobs dev -- review-skill-proposal --session-id <sessionId> --proposal-id <proposalId>
pnpm --filter @hotflow/worker-jobs dev -- reconcile-skill-proposal --session-id <sessionId> --proposal-id <proposalId>
```

Delegation and verification flow:

```sh
pnpm --filter @hotflow/worker-jobs dev -- run-delegation --session-id <sessionId> --worker-id <workerId> --verifier-id <verifierId>
pnpm --filter @hotflow/worker-jobs dev -- run-verification --session-id <sessionId> --verifier-id <verifierId>
```

If you want the CLI and `worker-jobs` to see the same local session/proposal state, point them at the same SQLite file:

```sh
export HOTFLOW_CLI_SESSION_DB_PATH="$PWD/.hotflow/sessions/shared.sqlite"
export HOTFLOW_WORKER_SESSION_DB_PATH="$HOTFLOW_CLI_SESSION_DB_PATH"
```

Use that shared SQLite path sequentially unless you have already validated your concurrent local setup.

Useful environment overrides:

- `HOTFLOW_WORKSPACE_ROOT` defaults to the current working directory
- `HOTFLOW_DATA_DIR` defaults to `<workspace>/.hotflow`
- `HOTFLOW_SESSION_DB_PATH` defaults to `<dataDir>/sessions/sessions.sqlite`
- `HOTFLOW_CLI_SESSION_DB_PATH` overrides the CLI-only session database path
- `HOTFLOW_WORKER_SESSION_DB_PATH` overrides the worker-jobs session database path
- `HOTFLOW_DEFAULT_PROVIDER` defaults to `scripted`
- `HOTFLOW_DEFAULT_MODEL` defaults to `hotflow-phase1`

## Repository Layout

- `apps/cli`: composition root and the current operator-facing entrypoint
- `apps/gateway`: minimal HTTP ingress aligned with the session-aware runtime
- `apps/worker-jobs`: proposal pipeline and bounded worker / verifier consumers
- `packages/*`: reusable runtime packages for contracts, sessions, models, tools, policy, engine, skills, and supporting infrastructure
- `docs/plans`: reserved for public implementation plans

## Read More

- [docs/architecture.md](./docs/architecture.md)
- [docs/operator-guide.md](./docs/operator-guide.md)
- [docs/failure-and-degrade-guide.md](./docs/failure-and-degrade-guide.md)
- [docs/open-source-boundaries.md](./docs/open-source-boundaries.md)
- [docs/release/v0.1.0-publish-checklist.md](./docs/release/v0.1.0-publish-checklist.md)
- [examples/minimal-director-angel-workspace/README.md](./examples/minimal-director-angel-workspace/README.md)

## License

MIT. See [LICENSE](./LICENSE).
