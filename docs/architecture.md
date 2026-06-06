# Director Angel OS Architecture / Director Angel OS 架构说明

## One Sentence / 一句话

`Director Angel OS` is the chassis under an agent product: it gives you the runtime, session model, tool boundaries, control plane, and controlled learning lane so you do not have to rebuild them from scratch.

`Director Angel OS` 就像 Agent 产品下面的汽车底盘：它先把运行时、会话模型、工具边界、控制面和受控学习闭环搭好，这样你不用每次都从零重造一遍。

## Big Picture / 整体结构

```text
User / External Trigger
  -> CLI or Gateway
  -> Session + Journal + Checkpoint
  -> Engine
  -> Model Runtime + Tool Runtime + Policy Runtime
  -> Task Plane
  -> Worker Jobs
  -> Proposal / Review / Safe Apply / Reload
```

## What Each Layer Does / 每一层在干什么

### CLI and Gateway / CLI 与 Gateway

These are the entrypoints.
They receive input from a person or another system and pass it into the runtime.

这是入口层。
它们接收来自人或外部系统的输入，再把输入送进运行时。

- `apps/cli`: local operator-facing command line
- `apps/gateway`: minimal HTTP entry for channel-style traffic

### Session, Journal, Checkpoint / 会话、日志、检查点

This is the persistence spine.
Instead of treating every prompt as stateless, Director Angel OS stores session state, appends journal events, and uses checkpoints for recovery.

这是持久化主骨架。
Director Angel OS 不把每次提示词都当成无状态请求，而是保存 session、追加 journal 事件，并通过 checkpoint 支持恢复。

That is one of the reasons it feels like an operating layer instead of a one-shot demo.
这也是它更像“操作系统底盘”而不是“一次性 demo”的原因之一。

### Engine / Engine

The engine coordinates a turn.
It should not become a giant god object.
Its job is to move data between context assembly, model runtime, tool runtime, memory, and task updates.

Engine 负责协调一轮执行。
它不应该膨胀成一个巨大的神对象。
它的职责是把上下文组装、模型调用、工具调用、记忆、任务更新这些模块串起来。

### Model Runtime / 模型运行时

This layer talks to LLM providers.
It is separated from the engine so provider-specific logic does not leak into every part of the system.

这层负责调用大模型 provider。
它和 engine 分开，是为了避免 provider 逻辑污染整个系统。

### Tool Runtime / 工具运行时

This is how the agent touches the outside world.
Reading files, writing todos, and other external actions pass through a tool boundary.

这里是 Agent 接触外部世界的方式。
读文件、写待办、以及其他外部动作，都应该经过统一的工具边界。

Why it matters:
为什么重要：

- permission boundaries are clearer
- audit is easier to keep
- failures are easier to degrade safely

### Policy Runtime / 策略运行时

Policy is the rule layer.
It decides whether a tool call or action should be allowed, blocked, or constrained.

Policy 是规则层。
它决定某个工具调用或动作该被允许、拦截，还是受限执行。

### Control Plane / 控制面

The control plane is the operator surface.
It lets you inspect status, review proposals, and handle operational actions without stuffing everything into one giant run command.

Control plane 是运维和操作面。
你可以通过它查看状态、审核 proposal、处理操作动作，而不是把所有东西都塞进一个巨大 `run` 命令里。

This is one of the clearest differences between an agent chassis and a prompt demo.
这也是 Agent 底盘和 prompt demo 最明显的差别之一。

### Task Plane / 任务平面

The task plane stores todos, delegation records, verification gates, proposal queue state, and outbox events.

任务平面负责保存：

- todos
- delegation 记录
- verification gate
- proposal queue 状态
- outbox 事件

This gives the runtime a durable work surface instead of hiding everything in temporary model text.
这样系统就有了一个持久任务面，而不是把所有工作状态都藏在临时模型文本里。

### Memory / 记忆层

Memory is split into bounded layers.
The point is not “infinite memory.”
The point is controlled retrieval, explicit boundaries, and visible degrade behavior.

记忆被拆成有边界的层。
重点不是“无限记忆”，而是可控检索、明确边界，以及出错时可见的 degrade 行为。

### Worker Jobs / 后台 Worker

Worker jobs handle asynchronous or slower lanes outside the main turn path.

后台 worker 处理主路径之外、较慢或异步的工作。

Examples:
例如：

- proposal generation
- review jobs
- reconcile / apply jobs
- delegation and verification consumers

### Controlled Learning Lane / 受控学习闭环

This is the most important boundary to understand.

这是最重要的一条边界。

Director Angel OS does not say:
Director Angel OS 不主张：

- let the agent freely rewrite itself inside the hot path
- let worker processes silently mutate production behavior

Instead, it says:
相反，它的设计是：

`committed trajectory -> proposal -> review -> safe apply -> reload visibility`

也就是说，学习闭环必须经过：

1. 已提交轨迹
2. proposal 提案
3. 审核
4. safe apply
5. reload 后可见

That keeps the learning lane inspectable and reviewable.
这样学习闭环才是可检查、可审查、可回看的。

## Why This Is A Chassis / 为什么说它是“底盘”

Director Angel OS is not trying to be your final agent product.

Director Angel OS 不是你的最终 Agent 产品。

It gives you:
它先给你：

- the runtime floor
- the persistence spine
- the tool and policy boundaries
- the operator surface
- the controlled learning lane

Then you build your own upper body on top:
然后你再往上装自己的业务外壳：

- your own prompts
- your own workflows
- your own provider mix
- your own product UI
- your own business logic

## Recommended Reading Order / 建议阅读顺序

1. [README.md](../README.md)
2. [operator-guide.md](./operator-guide.md)
3. [failure-and-degrade-guide.md](./failure-and-degrade-guide.md)
4. [open-source-boundaries.md](./open-source-boundaries.md)
