import {
  createAgentDelegateModelTool,
  createRunSubagentModelTool,
  createSpawnSubagentModelTool,
} from "./agent-delegate-tool.js";
import type { ConversationRuntimeModelToolDefinition } from "./model-tool-loop.js";
import { createConversationRuntimeToolRegistry } from "./tool-registry.js";

export type DirectorConversationRuntimeToolName =
  | "web_search"
  | "web_extract"
  | "web_extract_artifact_read"
  | "agent.delegate"
  | "run_subagent"
  | "spawn_subagent"
  | "browser_navigate"
  | "browser_snapshot"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_back"
  | "browser_press"
  | "browser_get_images"
  | "browser_console"
  | "tool.search"
  | "director.capabilities.inspect"
  | "director.learning.query"
  | "director.learning.url"
  | "director.learning.admit"
  | "director.learning.media_understand"
  | "director.experience.candidates.list"
  | "director.knowledge.recall"
  | "director.memory.status"
  | "director.memory.recall"
  | "director.skills.list"
  | "director.skills.view"
  | "director.skills.use"
  | "director.skills.set_enabled"
  | "director.skills.curator.guard"
  | "director.moyin.project_readiness"
  | "director.opencli.list"
  | "director.opencli.invoke"
  | "director.mcp.servers.list"
  | "director.mcp.server.upsert"
  | "director.mcp.server.test"
  | "director.mcp.refresh"
  | "director.comfyui.open"
  | "director.comfyui.create_workflow"
  | "director.comfyui.run"
  | "director.comfyui.lifecycle"
  | "director.comfyui.install"
  | "director.comfyui.fix_dependencies";

export function createDirectorConversationRuntimeToolRegistry() {
  return createConversationRuntimeToolRegistry({
    directorTools: createDirectorLegacyConversationRuntimeTools(),
  });
}

export function createDirectorConversationRuntimeTools(): ConversationRuntimeModelToolDefinition[] {
  return [...createDirectorConversationRuntimeToolRegistry().listModelTools()];
}

function createDirectorLegacyConversationRuntimeTools(): ConversationRuntimeModelToolDefinition[] {
  return [
    createAgentDelegateModelTool(),
    createRunSubagentModelTool(),
    createSpawnSubagentModelTool(),
    {
      name: "director.capabilities.inspect",
      description:
        "读取 Director Angel 当前真实启用的能力概览，包括经验/知识、Skill、记忆、外部工具和通道状态。用户问你会什么、能调用什么、是否具备某能力时调用。",
      readOnly: true,
      inputSchema: emptyObjectSchema(),
      metadata: {
        capability: "capabilities",
      },
    },
    {
      name: "director.learning.query",
      description:
        "把资料搜索结果进一步沉淀为待审经验候选。只有用户明确要求学习沉淀、收录为经验、生成经验候选、放进经验库、以后制作要复用时调用。用户只是要求查资料、搜索、找资料、看看网页、最新信息时，不要调用本工具。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "要搜索和学习的主题，去掉客套话，保留核心关键词。",
          },
          maxResultsPerQuery: {
            type: "integer",
            description: "每个主题最多抓取结果数，默认 5。",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      metadata: {
        capability: "learning",
        reviewGated: true,
      },
    },
    {
      name: "director.learning.url",
      description:
        "抓取用户给出的 URL 并生成待审经验候选。只有用户明确要求学习、吸收、沉淀、收录为经验时调用。不要把普通读取网页升级成经验候选。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要学习的 http/https URL。",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
      metadata: {
        capability: "learning",
        reviewGated: true,
      },
    },
    {
      name: "director.learning.admit",
      description:
        "把已经取得的来源正文显式准入为待审经验候选。只在用户明确要求沉淀/收录为经验时调用；只创建待审候选/隔离记录，不自动收录、不自动发布。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          source_id: {
            type: "string",
            description: "本次准入来源标识；可省略，运行时会生成。",
          },
          privacy: {
            type: "string",
            enum: ["public", "internal", "confidential", "restricted"],
            description: "经验隐私等级，默认 public。",
          },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string", description: "来源 URL 或 sourceRef。" },
                title: { type: "string", description: "来源标题。" },
                body: { type: "string", description: "来源正文。" },
                content_type: { type: "string", description: "可选内容类型。" },
                contentType: { type: "string", description: "可选内容类型，兼容驼峰字段。" },
                quality: {
                  type: "object",
                  description:
                    "web_extract 给出的正文质量信号；publishable=false 或 status=blocked 时不能准入学习。",
                  additionalProperties: true,
                },
                source_snapshot: {
                  type: "object",
                  description:
                    "web_extract 给出的来源快照；access_status/source_access_limited 表示没有可信正文。",
                  additionalProperties: true,
                },
                sourceSnapshot: {
                  type: "object",
                  description: "来源快照，兼容驼峰字段。",
                  additionalProperties: true,
                },
              },
              required: ["body"],
              additionalProperties: false,
            },
            description: "已经抓到正文的来源列表；不能只传搜索结果。",
          },
        },
        required: ["sources"],
        additionalProperties: false,
      },
      metadata: {
        capability: "learning.admit",
        reviewGated: true,
      },
    },
    {
      name: "director.learning.media_understand",
      description:
        "在用户明确授权媒体处理范围和预算后，对待审学习工件里的图片/视频/音频执行媒体理解证据回填。当前内置 runner 只做低成本元数据/容器理解，不会假装完成完整视觉、视频或音频语义理解；不自动发布、不自动长期入库。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          artifact_id: {
            type: "string",
            description: "可选学习工件 ID；省略时选择最近一个包含未处理媒体的待审学习工件。",
          },
          candidate_id: {
            type: "string",
            description: "可选经验候选 ID，用于定位相关学习工件。",
          },
          source_ref: {
            type: "string",
            description: "可选来源 URL 或 sourceRef，用于定位相关学习工件。",
          },
          mode: {
            type: "string",
            enum: ["media_inventory", "low_cost", "deep_multimodal"],
            description: "授权的媒体处理模式；默认使用系统推荐模式。",
          },
          user_authorized: {
            type: "boolean",
            description: "必须为 true，表示用户已经明确授权本次媒体处理范围。",
          },
          token_budget: {
            type: "integer",
            description: "用户授权的 token 预算上限；会记录到审计证据中。",
          },
          max_assets: {
            type: "integer",
            description: "本次最多处理多少个媒体资源，默认按授权模式保守选择。",
          },
        },
        required: ["user_authorized"],
        additionalProperties: false,
      },
      metadata: {
        capability: "learning.media_understand",
        reviewGated: true,
        requiresApproval: true,
      },
    },
    {
      name: "director.experience.candidates.list",
      description:
        "读取待审经验候选列表和摘要。用户在学习之后说“发来看看”“给我看”“什么意思”“看详情”“收录哪条”等自然追问时调用；不要只解释命令。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "accepted", "rejected", "all"],
            description: "候选状态过滤，默认 pending。",
          },
          maxItems: {
            type: "integer",
            description: "最多返回几条，默认 5。",
          },
          candidateIds: {
            type: "array",
            items: { type: "string" },
            description: "可选：只读取当前证据帧绑定的候选 id。",
          },
          sourceUrls: {
            type: "array",
            items: { type: "string" },
            description: "可选：只读取当前证据帧绑定的来源 URL。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "experience.candidates",
      },
    },
    {
      name: "director.knowledge.recall",
      description:
        "按主题、标签或项目预览已发布经验/知识召回。用户问能否调用经验、需要找已有经验、需要按当前任务查经验时调用。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "召回主题或任务描述。",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "可选标签，如 comfyui、script、video。",
          },
          projectId: { type: "string" },
          groupId: { type: "string" },
          maxHits: {
            type: "integer",
            description: "最多返回命中数，默认 3。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "knowledge.recall",
      },
    },
    {
      name: "director.memory.status",
      description:
        "读取运行记忆/长期记忆状态。用户问系统是否有长期记忆、记忆是否开启、记忆是否会污染时调用。",
      readOnly: true,
      inputSchema: emptyObjectSchema(),
      metadata: {
        capability: "memory",
      },
    },
    {
      name: "director.memory.recall",
      description:
        "按当前主题预览运行记忆召回。用户要求参考过去对话、历史任务、上次结果或长期上下文时调用。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "召回主题或任务描述。" },
          projectId: { type: "string" },
          groupId: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
          },
          maxHits: { type: "integer" },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "memory.recall",
      },
    },
    {
      name: "director.skills.list",
      description:
        "列出当前已安装/已批准/待审 Skill 索引，可按用户任务 query 筛选。用户问能调用哪些 Skill、Skill 是否可用、后续制作会不会用 Skill，或需要先发现可用 Skill 时调用。只返回索引，并可带 runtimeContract 条件加载/guard 摘要；需要具体操作方法、参数或流程时继续调用 director.skills.view，不要把 list 当作已经使用 Skill。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "可选。用户当前任务或想找的能力，用来筛选 Skill 索引。",
          },
          limit: {
            type: "integer",
            description: "可选。最多返回多少个 Skill，默认由宿主决定。",
          },
          includeDisabled: {
            type: "boolean",
            description: "可选。是否同时显示已关闭 Skill；默认 false。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "skill.index",
      },
    },
    {
      name: "director.skills.view",
      description:
        "按 Skill id 或标题读取某个已批准 Skill 的完整内容。用户要求调用/使用某个 Skill，或需要根据 Skill 里的具体步骤、工具参数、外部工具流程来回答/执行时调用。宿主可返回 runtimeContract、setupOnLoad、fallback 和 guard；若 contract 阻断，不要假装已加载。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "Skill id、标题或列表中返回的 Skill 标识。",
          },
          reason: {
            type: "string",
            description: "为什么需要查看这个 Skill，例如：需要 ComfyUI 工作流步骤。",
          },
        },
        required: ["skillId"],
        additionalProperties: false,
      },
      metadata: {
        capability: "skill.view",
      },
    },
    {
      name: "director.skills.use",
      description:
        "把一个已启用、已读取或已定位的 Skill 明确应用到当前回答/任务计划中。它不会替代外部工具执行；如果 Skill 需要浏览器、ComfyUI、MCP 等工具，调用本工具后还要继续调用对应工具。用户要求“按这个 Skill 做/调用这个 Skill/用这个经验流程继续”时调用；禁用、不存在、needs-setup、fallback 或 guard blocked 的 Skill 必须返回失败，不能假装已执行。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "Skill id、标题或列表中返回的 Skill 标识。",
          },
          objective: {
            type: "string",
            description: "当前要用这个 Skill 处理的用户目标或任务。",
          },
          reason: {
            type: "string",
            description: "为什么本轮需要应用这个 Skill。",
          },
        },
        required: ["skillId"],
        additionalProperties: false,
      },
      metadata: {
        capability: "skill.use",
      },
    },
    {
      name: "director.moyin.project_readiness",
      description:
        "只读检查 Moyin 项目是否具备继续执行 S-Class/生产工作流的条件。用户要求检查某个 Moyin 项目、项目是否可以执行、是否能继续 workflow-run、是否具备模型/API key/项目绑定条件时调用。此工具只做 readiness gate：不会创建项目、不会创建 workflow-run、不会提交生成任务。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description: "可选。Moyin projectId；如果已知 id，优先传入。",
          },
          projectName: {
            type: "string",
            description: "可选。用户提供的 Moyin 项目名；宿主会尽量映射到 projectId。",
          },
          reason: {
            type: "string",
            description: "为什么要检查该项目，例如：按 S 级 Skill 检查项目是否可以执行。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "moyin.project_readiness",
      },
    },
    {
      name: "director.skills.set_enabled",
      description:
        "启用或停用一个已批准 Skill。用户明确要求开启/关闭某个已有 Skill、某类能力（如浏览互联网、ComfyUI、外部工具流程）时，先用 director.skills.list 或能力上下文定位 Skill，再调用本工具。禁用 Skill 不应被当作已可执行；启用后通常从下一轮能力刷新/任务开始进入可召回上下文。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            description: "已批准 Skill 的 id、标题或列表中返回的 Skill 标识。",
          },
          enabled: {
            type: "boolean",
            description: "true 表示开启，false 表示关闭。",
          },
          reason: {
            type: "string",
            description: "用户为什么要求修改启用状态；会写入管理记录，避免无来源改配置。",
          },
        },
        required: ["skillId", "enabled"],
        additionalProperties: false,
      },
      metadata: {
        capability: "skill.management",
        reviewGated: true,
        risk: "capability-configuration",
      },
    },
    {
      name: "director.skills.curator.guard",
      description:
        "只检查 Skill curator 的 patch/archive/merge 写操作是否满足 contract guard 和 operator scope；不会执行 patch、archive 或 merge。用户要求远程修补、归档、合并 Skill 时先调用它，并根据 guard 结果说明需要回到桌面 Review/Ops。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["patch", "archive", "merge"],
            description: "要检查的 curator 写操作类型。",
          },
          skillId: {
            type: "string",
            description: "curator 建议指向的 Skill id。",
          },
          canonicalSkillId: {
            type: "string",
            description: "merge 操作的保留 Skill id。",
          },
          duplicateSkillIds: {
            type: "array",
            items: { type: "string" },
            description: "merge 操作中要合并/归档的重复 Skill ids。",
          },
          reason: {
            type: "string",
            description: "用户为什么要求检查这个 curator 写动作。",
          },
        },
        required: ["action", "skillId"],
        additionalProperties: false,
      },
      metadata: {
        capability: "skill.curator.guard",
        guardOnly: true,
        risk: "skill-curator-write-boundary",
      },
    },
    {
      name: "director.opencli.list",
      description:
        "查询本机 OpenCLI 已接入的受控命令索引。用户要求使用 OpenCLI、打开已登录网站、查某个平台是否有稳定 adapter、或需要从 OpenCLI 能力里选择命令时调用；只列命令，不执行。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "可选。按平台、命令名或描述筛选，例如 twitter、weixin、hackernews。",
          },
          site: {
            type: "string",
            description: "可选。只看某个 OpenCLI site。",
          },
          access: {
            type: "string",
            enum: ["read", "write"],
            description: "可选。只看 read 或 write 命令；默认优先 read。",
          },
          limit: {
            type: "integer",
            description: "最多返回多少条，默认 20。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.opencli.list",
        source: "opencli",
      },
    },
    {
      name: "director.opencli.invoke",
      description:
        "调用已接入的 OpenCLI 只读命令。必须先通过 director.opencli.list 或能力上下文确认 operationId；只能执行 access=read 的命令，write/post/send/delete/follow/like/publish/download/install/plugin 命令一律不在这里执行。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          operationId: {
            type: "string",
            description: "OpenCLI capability id，例如 opencli.hackernews.top。",
          },
          args: {
            type: "object",
            additionalProperties: true,
            description: "命令参数，必须匹配 OpenCLI manifest。",
          },
          reason: {
            type: "string",
            description: "为什么本轮需要调用这个 OpenCLI 命令。",
          },
        },
        required: ["operationId"],
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.opencli.invoke-read",
        source: "opencli",
        risk: "external-navigation",
      },
    },
    {
      name: "director.mcp.servers.list",
      description:
        "列出当前已配置 MCP server、连接状态和可用工具概览。用户问 MCP 是否可用、装了哪些 MCP、某个 MCP 有没有连上、能调用哪些外部工具时调用。",
      readOnly: true,
      inputSchema: emptyObjectSchema(),
      metadata: {
        capability: "mcp.management",
      },
    },
    {
      name: "director.mcp.server.upsert",
      description:
        "安装或更新一个 MCP server 配置。用户明确要求安装/接入/更新某个 MCP，并提供了必要的命令或 URL 时调用；本工具会写入项目 .mcp.json，必须先取得用户确认。不要把密钥明文写入回复。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          serverName: {
            type: "string",
            description: "MCP server 名称，只能包含英文字母、数字、- 和 _。",
          },
          transport: {
            type: "string",
            enum: ["stdio", "http", "sse", "streamable-http"],
            description: "连接方式。stdio 使用本地命令；http/streamable-http/sse 使用 URL。",
          },
          command: {
            type: "string",
            description: "stdio MCP 启动命令，例如 npx、uvx、node。",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "stdio MCP 启动参数。",
          },
          url: {
            type: "string",
            description: "http/sse MCP endpoint URL。",
          },
          env: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "可选环境变量。密钥类值会在结果中脱敏。",
          },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "可选 HTTP headers。Authorization 等敏感值会在结果中脱敏。",
          },
          auth: {
            type: "string",
            enum: ["none", "oauth", "header"],
            description: "认证方式。OAuth 需要后续登录授权。",
          },
          enabled: {
            type: "boolean",
            description: "是否启用，默认启用。",
          },
          reason: {
            type: "string",
            description: "用户为什么要求安装/更新这个 MCP。",
          },
        },
        required: ["serverName"],
        additionalProperties: false,
      },
      metadata: {
        capability: "mcp.management",
        reviewGated: true,
        risk: "capability-configuration",
      },
    },
    {
      name: "director.mcp.server.test",
      description:
        "测试一个已配置 MCP server 的连接和工具列表。用户要求测试 MCP、刷新某个 MCP、检查为什么不能调用外部工具时调用。",
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {
          serverName: {
            type: "string",
            description: "要测试的 MCP server 名称。",
          },
        },
        required: ["serverName"],
        additionalProperties: false,
      },
      metadata: {
        capability: "mcp.management",
      },
    },
    {
      name: "director.mcp.refresh",
      description:
        "刷新并重新读取 MCP 配置与工具列表。用户说重新加载 MCP、刷新外部工具、安装后看看是否生效时调用。",
      readOnly: true,
      inputSchema: emptyObjectSchema(),
      metadata: {
        capability: "mcp.management",
      },
    },
    {
      name: "director.comfyui.open",
      description:
        "打开或返回 ComfyUI Web 界面地址。用户要求打开 ComfyUI 界面、看工作流画布、连接 ComfyUI 页面时调用。",
      readOnly: true,
      inputSchema: emptyObjectSchema(),
      metadata: {
        capability: "external-tools.comfyui",
      },
    },
    {
      name: "director.comfyui.create_workflow",
      description:
        "由 Angel 先生成脚本、场景、图片/视频提示词和参数，再创建可见 ComfyUI 工作流。用户要求 /ComfyUI 脚本、脚本+图片、脚本+视频、脚本+图片+视频或搭工作流时调用。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          objective: {
            type: "string",
            description: "用户目标，例如：一个小猪学习游泳的30秒故事。",
          },
          workflowKind: {
            type: "string",
            enum: ["script", "copywriting", "image", "video"],
          },
          workflowModes: {
            type: "array",
            items: { type: "string", enum: ["script", "image", "video"] },
            description: "组合能力，例如 ['script','image','video']。",
          },
        },
        required: ["objective"],
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.comfyui.workflow",
        reviewGated: true,
      },
    },
    {
      name: "director.comfyui.run",
      description:
        "向已配置的可执行 ComfyUI API workflow 提交任务。只有用户明确要求执行/生成，且已有可执行 workflow 时调用；不要把连通性验证当生成结果。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "要提交给 ComfyUI workflow 的提示词。" },
          workflowPath: { type: "string" },
          outputDir: { type: "string" },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.comfyui.run",
        risk: "external-execution",
      },
    },
    {
      name: "director.comfyui.lifecycle",
      description:
        "通过 comfy-cli 控制本机 ComfyUI 生命周期：status/start/stop/restart。用户要求启动、停止、重启、查看本机 ComfyUI 服务时调用；Cloud 模式不执行本机命令。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["status", "start", "stop", "restart"],
            description: "生命周期动作。",
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.comfyui.lifecycle",
        risk: "external-process",
        requiresApproval: true,
      },
    },
    {
      name: "director.comfyui.install",
      description:
        "为本机 ComfyUI 生成或执行安装计划。默认 dryRun=true 只返回命令计划；只有用户明确确认执行时才 dryRun=false。Cloud 模式不执行本地安装。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          gpuFlag: {
            type: "string",
            enum: ["--nvidia", "--amd", "--m-series", "--cpu"],
            description: "comfy-cli 安装用 GPU 标记；不确定时省略，由本机平台默认推断。",
          },
          skipLaunch: {
            type: "boolean",
            description: "true 只安装不启动；false 或省略则安装后尝试后台启动。",
          },
          dryRun: {
            type: "boolean",
            description: "true 只生成计划；false 执行安装命令。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.comfyui.install",
        risk: "external-install",
        requiresApproval: true,
      },
    },
    {
      name: "director.comfyui.fix_dependencies",
      description:
        "为已配置的 ComfyUI workflow 生成或执行依赖修复：安装缺失 custom nodes，按明确 URL 下载缺失模型/embedding。没有 URL 时必须拒绝猜测。",
      readOnly: false,
      inputSchema: {
        type: "object",
        properties: {
          workflowPath: { type: "string" },
          modelSources: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "模型文件名到下载 URL 的映射。没有明确 URL 时不要猜。",
          },
          dryRun: {
            type: "boolean",
            description: "true 只生成计划；false 执行可修复项。",
          },
        },
        additionalProperties: false,
      },
      metadata: {
        capability: "external-tools.comfyui.deps",
        risk: "external-install",
        requiresApproval: true,
      },
    },
  ];
}

function emptyObjectSchema() {
  return {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
}
