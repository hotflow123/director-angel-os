# External Tools, Adapters, and Plugins / 外部工具、适配器与插件

Director Angel OS is role-driven, but roles do not work in isolation.
A real digital operator needs a governed way to reach models, tools, media systems, workflow engines, and local plugins.

Director Angel OS 是职位驱动的，但职位不能只停在对话里。
真正能上岗的数字执行体，需要用可治理的方式连接模型、工具、媒体系统、工作流引擎和本地插件。

## Integration Model / 集成模型

```text
role
  -> responsibility boundary
  -> model adapters
  -> external tool control plane
  -> media / execution adapters
  -> evidence and artifacts
  -> review and policy gates
```

The important part is not "the agent can call anything."
The important part is: each external capability is represented by a manifest, policy, health check, approval boundary, runtime status, and evidence trail.

重点不是“Agent 什么都能调用”。
重点是：每个外部能力都要有 manifest、策略、健康检查、审批边界、运行状态和证据链。

## Operator, Not Tool Factory / 操作者，不是工具工厂

Director Angel is not trying to rebuild every creative tool.
It is the operator layer above creative tools.

Director Angel 不是要重造每一个创作工具。
它是创作工具上方的操作者层。

The system can learn production experience:

- which prompt patterns work on a platform
- which workflow shape produces usable assets
- which failures are common
- which review notes should change the next run
- which tool should be used for a specific responsibility

系统可以学习生产经验：

- 哪些提示词模式在某个平台有效
- 哪种工作流更容易产出可用素材
- 哪些失败会反复出现
- 哪些审查意见应该影响下一轮
- 某个职责场景下应该选哪个工具

Then it operates external tools through a governed boundary:

```text
experience
  -> bounded operating memory
  -> role decision
  -> approved adapter / browser / Host API / handoff
  -> external creative tool
  -> evidence
  -> review
```

然后它通过受治理边界操作外部工具：

```text
经验
  -> 有边界的岗位记忆
  -> 职位判断
  -> 受批准的 adapter / 浏览器 / Host API / handoff
  -> 外部创作工具
  -> 证据
  -> 复查
```

Named examples of external creative surfaces can include `moyin-creator` / 魔因漫创, ComfyUI, Doubao, Jimeng, Kling, and similar web or desktop creation platforms.
Naming a surface here does not mean this repository ships an official native adapter for that platform today.
It means the OS model is designed for operating external tools when the user has authorization, an available integration surface, and a reviewable execution path.

外部创作面可以包括 `moyin-creator` / 魔因漫创、ComfyUI、豆包、即梦、可灵，以及类似网页或桌面创作平台。
这里点名某个平台，不等于当前仓库已经内置该平台的官方原生 adapter。
它表达的是：当用户具备授权、可用接入面和可复查执行链路时，Director Angel OS 的模型就是为了操作这些外部工具而设计。

## Included Integration Surfaces / 当前已经包含的集成面

### Host API External Tool Control Plane / Host API 外部工具控制面

The Host API exposes a unified tool surface instead of making every channel re-implement tool execution.

Host API 提供统一工具面，避免每个通道各自重复实现外部工具执行。

Current V1 resources include:

- `/v1/tools/catalog`
- `/v1/tools/effective`
- `/v1/tools/invoke`
- `/v1/catalog/model-adapters`
- `/v1/capabilities`

What this gives the system:

- one place to list available tools and adapters
- one place to invoke tools through policy and approval gates
- one place to inspect adapter capability and health
- one evidence path for tool results

### moyin-creator / 魔因漫创

`moyin-creator` / 魔因漫创 is represented as an external creation and production control-plane provider through the local `moyin` CLI boundary.

`moyin-creator` / 魔因漫创通过本地 `moyin` CLI 边界接入，作为外部创作与生产控制面 provider。

Current support includes:

- health and capability handshake
- adapter resolution for script, image, and video execution drafts
- project, template, provider, model, and workflow discovery
- task submit, watch, cancel, template build, and sealed package operations
- prompt, memory, artifact, workflow-run, and workflow operations
- structured error envelopes, redaction, retry guidance, and operator next actions

Boundary:

- public docs should call the product `moyin-creator` / 魔因漫创
- some internal code and scripts still use historical names such as `moyin.provider`
- read-only operations can run without operator approval
- mutation or submit-style operations are policy-gated and require operator confirmation
- source-owned artifacts remain user-controlled
- result-budget artifacts are treated as ephemeral

### ComfyUI Adapter / ComfyUI 适配器

ComfyUI is represented as a media adapter and provider bridge.

ComfyUI 通过 media adapter 和 provider bridge 接入。

Current support includes:

- local or cloud mode configuration
- health, queue, history, model folder, and workflow diagnostics
- workflow import/export and handoff flows through `moyin-creator` / 魔因漫创 production packages
- ComfyUI interop draft conversion reports and simple executable API workflow builds
- visible workflow draft export through the ComfyUI custom-node bridge
- ComfyUI API workflow import into `moyin-creator` / 魔因漫创 draft workflow packages, followed by approval-gated `workflow.import`
- workflow inspect, dependency check, workflow run, workflow watch, and artifact fetch
- lifecycle install and dependency-fix planning/execution boundaries
- text-to-image, text-to-video, and image-to-video mode declaration
- visible workflow drafts and ComfyUI custom-node bridge templates
- example workflow fixture under `examples/comfyui`

Boundary:

- ComfyUI still depends on a reachable ComfyUI service or valid local setup
- import/export and interop outputs must be validated before execution or downstream handoff
- ComfyUI-to-`moyin-creator` / 魔因漫创 imports remain draft-first and approval-gated
- workflow execution requires valid workflow nodes, output configuration, and resolved dependencies
- failed external execution should degrade with diagnostics instead of pretending success
- installation and dependency-fix execution are not silent background mutation; they stay behind explicit lifecycle operations

### Adapter Registry / 适配器注册表

Director Runtime has an adapter registry for host, media, and execution adapters.

Director Runtime 提供 adapter registry，用来管理 host、media、execution 适配器。

Current support includes:

- list all adapters
- filter by adapter kind
- build runtime capability snapshots
- expose adapter health, risk, approval mode, permissions, budget, rate limits, bridge metadata, and supported action classes
- route media work by supported modes and profiles
- support HTTP JSON bridge metadata for real external execution handoff

### Built-In Plugins / 内置插件

The repository includes a small built-in plugin surface under `internal-plugins`.

仓库在 `internal-plugins` 下包含一组受控内置插件。

Current built-ins:

- `providers/scripted`
- `tools/filesystem-read`

Each internal plugin exposes:

- `manifest.json`
- typed registration entrypoint
- catalog-level loading helpers

Boundary:

- these are static, in-repo plugins
- they are versioned with the repository
- they are not an app-store-style plugin marketplace
- they do not imply arbitrary runtime download and execution

### Plugin Contract / 插件契约

The conversation runtime also contains a plugin contract and sandboxed loading model.

conversation runtime 里已经有插件契约和沙箱加载模型。

Current contract surfaces include:

- plugin manifests for capabilities, tools, providers, memory providers, and external knowledge connectors
- source trust status
- install policy and approval boundary
- hot-load planning that can be `ready`, `requires-approval`, or `blocked`
- registry targets for tool registry, provider registry, knowledge connectors, and memory ports
- fail-closed behavior when a plugin asks for direct internal store access
- executable plugin loading only through trusted entrypoint roots

Boundary:

- this is a governed contract surface, not a stable public `plugin-sdk`
- direct internal store access is blocked
- direct code execution is not treated as generally allowed
- public plugin marketplace behavior is outside the current launch boundary

## How To Talk About This Publicly / 对外怎么说

Strong and accurate:

- Director Angel OS already has a governed external tool control plane.
- Director Angel is the operator of creative tools, not a replacement for every creative tool.
- Director Angel OS can represent external systems such as `moyin-creator` / 魔因漫创 and ComfyUI as bounded providers/adapters, including ComfyUI import/export and workflow interop.
- Web or software platforms such as Doubao, Jimeng, and Kling belong in the external creative-surface category when connected through authorized adapters, browser automation, Host API tools, or handoff workflows.
- Roles can be connected to tools, model adapters, media adapters, and plugins through policy, health, evidence, and approval boundaries.
- The plugin direction exists, but current public support is controlled contracts and in-repo plugins, not an open marketplace.

Do not overstate:

- Do not say Director Angel replaces Doubao, Jimeng, Kling, ComfyUI, or `moyin-creator` / 魔因漫创.
- Do not say this repository already ships official native adapters for every named third-party web platform.
- Do not say every third-party plugin can be installed and hot-loaded safely today.
- Do not say ComfyUI always works without local/cloud setup.
- Do not say ComfyUI import/export makes every workflow lossless or executable without validation.
- Do not say `moyin-creator` / 魔因漫创 submit or mutation paths run without operator confirmation.
- Do not describe the plugin contract as a stable public SDK yet.
