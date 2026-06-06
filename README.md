[中文版](./README.zh.md) | [English](./README.md)

# Director Angel OS

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml/badge.svg)](https://github.com/hotflow123/director-angel-os/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D22%20%3C25-blue.svg)](./package.json)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D10-orange.svg)](./package.json)

> Director Angel OS is a role-driven Agent OS: define a position, set its responsibility boundaries, and let the runtime bind sessions, tools, memory, evidence, review, and evolution to that job.
> This repository currently demonstrates the Director role. The larger product direction is user-defined roles: researcher, operator, reviewer, worker, domain expert, or any custom position with explicit responsibility boundaries.

[Past, Present, Future](#past-present-future) · [Why Director Angel OS](#why-director-angel-os) · [Role-Driven OS](#role-driven-agent-os) · [Capabilities](#included-today) · [Integrations](#external-tools-adapters-and-plugins) · [Quick Start](#quick-start) · [Golden Path](#30-minute-minimal-golden-path) · [Architecture](./docs/architecture.md) · [Docs](#read-more)

```text
role -> responsibility -> session -> tools/models/policy -> task execution -> evidence -> memory -> reviewed evolution
```

Director Angel OS is an MIT-licensed TypeScript Agent OS for building digital workers that know their job, keep their memory, execute through governed tools, leave evidence behind, and improve through a reviewable evolution loop.

The current public content uses a Director responsibility set as the first concrete demonstration: turning intent into plans, scenes, tasks, evidence, and review loops. Director is the demonstration role, not the product ceiling. The OS direction is broader: users should be able to define any position, lock its responsibility boundary, and let the agent develop from that job over time.

The big idea is simple: an agent should not be a prompt with a few plugins. It should have a position, a responsibility boundary, a memory model, an execution surface, an audit trail, and a disciplined way to upgrade itself after real work.

Note: the repository still uses the historical package scope `hotflow` / `@hotflow/*` in code and commands today.

## Past, Present, Future

Past: most agents were stateless prompt wrappers. They could answer, call a tool, maybe chain a few steps, then forget the operating context that made the work valuable.

Present: Director Angel OS makes the job itself the runtime unit. The current repository demonstrates that model through Director responsibilities: planning, task shaping, evidence capture, review, and controlled improvement. A role defines what the agent is allowed to do, which tools it can touch, what evidence it must produce, what memory it can reuse, and how its work is reviewed.

Future: every serious role can become a living digital operator. Users should be able to create a custom position, define its responsibility graph and hard boundaries, then let the system grow new workflows, new skill proposals, and new operating memory without losing governance.

## Why Director Angel OS?

The pain is obvious once you run agents in real work:

- Prompt-only agents do not understand job boundaries. They drift, overreach, or wait for humans to restate the same context.
- Tool agents often execute without enough evidence. You get output, but not a reliable trail of what happened and why.
- Memory turns dangerous when it is a dump. Useful experience must be scoped, recalled, reviewed, and cleaned.
- Self-improvement is usually either fake branding or unsafe auto-mutation. Director Angel OS turns it into proposal -> review -> safe apply -> rollback.
- Multi-agent work collapses when delegation, verification, queues, and status are not first-class runtime concepts.

Director Angel OS attacks those problems as an operating system problem, not a prompt-engineering trick.

## Role-Driven Agent OS

A Director Angel OS agent starts from a position:

- `Researcher`: gather sources, preserve citations, build reusable knowledge
- `Director`: turn intent into plans, shots, scenes, tasks, and review loops
- `Operator`: execute workflows, track state, recover from interruptions
- `Reviewer`: verify outputs, inspect evidence, block unsafe changes
- `Worker`: consume assignments, report progress, return structured results

Current demonstration: `Director`.

The Director role shows the system through a concrete responsibility boundary: translate intent into plans, scenes, tasks, evidence, review loops, and controlled learning proposals. That role is the public example because it makes planning, supervision, memory, and review visible in one workflow.

Future customization: users define the position.

The position can change. When it changes, responsibilities, tool permissions, memory access, task routing, verification expectations, escalation rules, and self-evolution rules can change with it. That is the point: the agent grows from a defined job, not from a vague universal prompt.

## Who It Is For

- Teams that want AI employees with operating discipline, not chatbots with extra buttons
- Product builders who need sessions, recovery, auditability, task routing, and evidence by default
- Engineers designing role-specific agents that can learn from work without becoming ungoverned
- Researchers exploring memory, delegation, verification, and self-evolution in a real TypeScript runtime

## Included Today

- Session-aware runtime with journal, checkpoints, resume, and recovery
- Task-plane primitives including todos, delegation, verification, proposal queue, and outbox
- Clear boundaries around tools, models, policy, engine, CLI, gateway, and worker jobs
- Host API external tool control plane with tool catalog, effective tools, and tool invocation endpoints
- Adapter registry for model, media, execution, and host capability routing
- `moyin-creator` / 魔因漫创 integration through the local `moyin` CLI/control-plane boundary
- ComfyUI media adapter/provider bridge for workflow import/export, interop drafts, inspection, execution, watching, artifacts, and lifecycle diagnostics
- Built-in in-repo plugins plus a governed plugin contract for tools, providers, memory, and external knowledge connectors
- A bounded self-evolution path: committed trajectory -> skill proposal -> review -> safe apply -> reload visibility -> snapshot rollback
- Director-role demonstration content for the current public release
- Role-oriented operating surface for changing duties, routing work, and supervising growth
- Benchmarks and operator-facing docs for regression checking and boundary review

## External Tools, Adapters, and Plugins

Director Angel OS is built to connect a role to real execution surfaces without turning the agent into an unbounded script runner.

Current integration surfaces include:

- `moyin-creator` / 魔因漫创: local `moyin` CLI/control-plane provider for creative production workflows, task operations, project/workflow discovery, artifacts, memory, and governed submit/watch/cancel flows
- `ComfyUI`: media adapter/provider bridge for local or cloud ComfyUI workflows, with import/export, interop draft/build, health, dependency diagnostics, run/watch, artifact fetch, and lifecycle operations
- Host API tools: `/v1/tools/catalog`, `/v1/tools/effective`, `/v1/tools/invoke`, and `/v1/catalog/model-adapters`
- Internal plugins: built-in scripted provider and filesystem read tool, loaded through in-repo manifests and typed registration
- Plugin contracts: a governed contract surface for tools, providers, memory providers, and external knowledge connectors

Boundary: this is not a public plugin marketplace yet. External tools run through manifests, health checks, policy, approval boundaries, and evidence. ComfyUI import/export and interop flows stay behind validation and handoff checks; ComfyUI execution still needs a reachable ComfyUI service or valid local setup. `moyin-creator` / 魔因漫创 mutation and submit paths stay behind operator confirmation. Some internal code and scripts still use historical names such as `moyin.provider`.

Read the full integration map: [docs/integrations.md](./docs/integrations.md).

## The Positioning

Director Angel OS is for the next phase of agents: not assistants that wait, not scripts that break, not demos that impress once and disappear.

It is for agents that hold a job, work across sessions, produce evidence, accept supervision, remember what matters, and evolve only through a visible operating lane.

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

The first-run path uses the built-in `scripted` provider, so you can validate the operating loop before wiring a real model API.

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
- [docs/integrations.md](./docs/integrations.md)
- [docs/operator-guide.md](./docs/operator-guide.md)
- [docs/failure-and-degrade-guide.md](./docs/failure-and-degrade-guide.md)
- [docs/open-source-boundaries.md](./docs/open-source-boundaries.md)
- [docs/release/v0.1.0-publish-checklist.md](./docs/release/v0.1.0-publish-checklist.md)
- [examples/minimal-director-angel-workspace/README.md](./examples/minimal-director-angel-workspace/README.md)

## License

MIT. See [LICENSE](./LICENSE).
