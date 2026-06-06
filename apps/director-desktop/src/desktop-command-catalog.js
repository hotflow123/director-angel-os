import { resolveChannelCommandDefinition } from "@hotflow/channels-core";
import { DESKTOP_ACTIONS } from "./desktop-contract.js";

const EMPTY_ARGS = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({}),
  required: Object.freeze([]),
});

const STRING_ARG = Object.freeze({ type: "string" });
const BOOLEAN_ARG = Object.freeze({ type: "boolean" });
const INTEGER_ARG = Object.freeze({ type: "integer", minimum: 1 });
const STRING_LIST_ARG = Object.freeze({ type: "array", items: STRING_ARG });

const SHARED_CHANNEL_COMMAND_ID_BY_DESKTOP_COMMAND_ID = Object.freeze({
  "workspace.status": "workspace.status",
  "workspace.doctor": "settings.doctor",
  "workspace.settings": "workspace.settings",
  "workspace.switches": "settings.switches",
  "settings.providers": "settings.providers",
  "settings.textModel": "settings.textModel",
  "settings.imageModel": "settings.imageModel",
  "heartbeat.status": "heartbeat.status",
  "selfReflection.daily": "selfReflection.daily",
  "heartbeat.start": "heartbeat.start",
  "heartbeat.stop": "heartbeat.stop",
  "comfyui.open": "media.comfyui.run",
  "comfyui.run": "media.comfyui.run",
  "comfyui.createWorkflow": "media.comfyui.run",
  "apiProvider.set": "settings.provider.set",
  "apiProvider.syncModels": "settings.provider.test",
  "apiProvider.test": "settings.provider.test",
  "production.start": "production.start",
  "learning.admit": "learning.admit",
  "learning.directory": "learning.directory",
  "learning.query": "learning.query",
  "learning.url": "learning.url",
  "learning.mediaUnderstand": "learning.mediaUnderstand",
  "experience.list": "experience.list",
  "experience.explain": "experience.view",
  "experience.accept": "experience.accept",
  "experience.reject": "experience.reject",
  "experience.promote": "experience.promote",
  "experience.classificationSave": "experience.classify",
  "experience.tagSave": "experience.tag",
  "experience.fromRunReport": "experience.fromRunReport",
  "experience.fromTraceProposal": "experience.fromTraceProposal",
  "knowledge.candidates": "knowledge.candidates",
  "knowledge.accept": "knowledge.accept",
  "knowledge.reject": "knowledge.reject",
  "knowledge.publish": "knowledge.publish",
  "knowledge.recallPreview": "knowledge.recallPreview",
  "knowledge.explain": "knowledge.explain",
  "knowledge.diff": "knowledge.diff",
  "knowledge.rollback": "knowledge.rollback",
  "director.plan": "director.plan",
  "director.planAccept": "director.planAccept",
  "director.planIgnore": "director.planIgnore",
  "director.planRerun": "director.planRerun",
  "run.status": "run.status",
  "run.start": "run.start",
  "run.once": "run.once",
  "run.pause": "run.pause",
  "run.resume": "run.resume",
  "run.abort": "run.abort",
  "run.report": "run.report",
  "run.explain": "run.explain",
  "run.audit": "run.audit",
  "run.retry": "run.retry",
  "run.approve": "run.approve",
  "run.approvePending": "run.approvePending",
  "run.confirm": "run.confirm",
  "run.continue": "run.continue",
  "run.delegations": "run.review",
  "run.reroute": "run.reroute",
  "run.reflect": "run.reflect",
  "run.review": "run.review",
  "memory.status": "memory.status",
  "memory.publications": "memory.status",
  "memory.publicationRetract": "memory.status",
  "memory.publicationDemote": "memory.status",
  "memory.publicationQuarantine": "memory.status",
  "memory.publicationRestore": "memory.status",
  "evidence.list": "memory.status",
  "evidence.view": "memory.status",
  "evidence.content": "memory.status",
  "task.proposalList": "skills.list",
  "skill.proposeFromExperience": "skills.proposeFromExperience",
  "skill.proposalAccept": "skills.accept",
  "skill.proposalReject": "skills.reject",
  "skill.proposalApply": "skills.apply",
  "skill.classificationSave": "skills.classify",
  "skill.tagSave": "skills.tag",
  "adapter.list": "tools.list",
  "adapter.register": "tools.register",
  "adapter.enable": "tools.enable",
  "adapter.disable": "tools.disable",
  "platform.capabilities": "tools.capabilities",
  "soul.status": "soul.status",
  "soul.view": "soul.view",
});

const COMMAND_GROUPS = Object.freeze([
  group("workspace", "工作区", "workspace", [
    cliCommand(
      "workspace.bootstrap",
      "初始化工作区",
      "workspace",
      "创建或修复 Director Angel 工作区布局。",
      ["director", "bootstrap"],
    ),
    cliCommand("workspace.status", "工作区状态", "workspace", "读取 Director Angel 本地状态。", [
      "director",
      "status",
    ]),
    cliCommand(
      "workspace.doctor",
      "运行诊断",
      "workspace",
      "诊断 runtime、bridge、memory 和 operator lane。",
      ["director", "doctor"],
      hostJsonArgs(),
    ),
    cliCommand(
      "workspace.acceptance",
      "验收门禁",
      "workspace",
      "汇总最新 Director benchmark gate。",
      ["director", "acceptance"],
      jsonArgs(),
    ),
    cliCommand(
      "workspace.runtime",
      "Runtime 能力",
      "workspace",
      "读取 runtime capability snapshot。",
      ["director", "runtime"],
      hostArgs(),
    ),
    cliCommand(
      "workspace.switches",
      "功能开关",
      "workspace",
      "展示 Director runtime feature switches。",
      ["director", "switches", "show"],
      hostArgs(),
    ),
    desktopAction(
      "desktop.snapshot",
      "桌面快照",
      "workspace",
      "刷新桌面端聚合状态。",
      DESKTOP_ACTIONS.SNAPSHOT,
    ),
    desktopAction(
      "workspace.settings",
      "设置总览",
      "settings",
      "打开桌面端设置总览，聚合功能开关、模型供应方和本地运行参数。",
      DESKTOP_ACTIONS.SNAPSHOT,
    ),
    desktopAction(
      "heartbeat.status",
      "心跳状态",
      "workspace",
      "执行一次安全心跳扫描，写入 heartbeat 事件和 latest 快照。",
      DESKTOP_ACTIONS.HEARTBEAT_STATUS,
    ),
    desktopAction(
      "selfReflection.daily",
      "每日反省",
      "workspace",
      "聚合现有心跳、运行、经验、知识、记忆和维护状态，生成只读每日自省报告。",
      DESKTOP_ACTIONS.SELF_REFLECTION_DAILY,
      selfReflectionArgs(),
    ),
    desktopAction(
      "heartbeat.start",
      "开启心跳模式",
      "workspace",
      "打开 heartbeat.enabled，让后台心跳可参与安全扫描和整理。",
      DESKTOP_ACTIONS.SETTINGS_SET,
      EMPTY_ARGS,
      { parameterId: "feature:heartbeat.enabled", value: true },
    ),
    desktopAction(
      "heartbeat.stop",
      "关闭心跳模式",
      "workspace",
      "关闭 heartbeat.enabled，保留手动心跳状态检查。",
      DESKTOP_ACTIONS.SETTINGS_SET,
      EMPTY_ARGS,
      { parameterId: "feature:heartbeat.enabled", value: false },
    ),
    desktopAction(
      "maintenance.preview",
      "维护预览",
      "workspace",
      "预览会归档的旧日志、已处理经验候选、隔离记录和低信号资料；不会移动文件。",
      DESKTOP_ACTIONS.MAINTENANCE_PREVIEW,
      maintenanceArgs(),
    ),
    desktopAction(
      "maintenance.apply",
      "执行维护",
      "workspace",
      "按预览规则归档旧日志和低价值经验资料，并写入维护审计报告。",
      DESKTOP_ACTIONS.MAINTENANCE_APPLY,
      maintenanceArgs(),
    ),
    desktopAction(
      "soul.status",
      "Soul 状态",
      "workspace",
      "查看当前已发布 Director Soul。",
      DESKTOP_ACTIONS.SOUL_VIEW,
    ),
    desktopAction(
      "soul.view",
      "查看 Soul",
      "workspace",
      "打开当前已发布的 SOUL 文档。",
      DESKTOP_ACTIONS.SOUL_VIEW,
    ),
    desktopAction(
      "desktop.pickDirectory",
      "选择目录",
      "workspace",
      "打开系统目录选择器。",
      DESKTOP_ACTIONS.DESKTOP_PICK_DIRECTORY,
    ),
    desktopAction(
      "settings.set",
      "设置参数",
      "settings",
      "写入 Director runtime 功能开关、角色开关或 adapter override。",
      DESKTOP_ACTIONS.SETTINGS_SET,
      objectArgs(
        {
          parameterId: { ...STRING_ARG, description: "参数 id，例如 feature:learning.enabled。" },
          value: { ...BOOLEAN_ARG, description: "开启或关闭。" },
        },
        ["parameterId", "value"],
      ),
    ),
    desktopAction(
      "settings.providers",
      "API 供应方",
      "settings",
      "查看当前 API 供应方配置、模型列表和启用状态。",
      DESKTOP_ACTIONS.SNAPSHOT,
    ),
    desktopAction(
      "settings.openRecommendedPurchase",
      "打开 memefast.top",
      "settings",
      "打开推荐的 API 购买/开通入口；只跳转外部页面，不保存支付信息。",
      DESKTOP_ACTIONS.SETTINGS_OPEN_RECOMMENDED_PURCHASE,
    ),
    desktopAction(
      "gateway.weixin.status",
      "微信网关状态",
      "settings",
      "查看个人微信网关的登录、常驻服务、运行状态和最近日志。",
      DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      EMPTY_ARGS,
      { operation: "status" },
    ),
    desktopAction(
      "gateway.weixin.start",
      "启动微信网关",
      "settings",
      "安装或刷新本机 LaunchAgent，并启动个人微信消息网关。",
      DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      EMPTY_ARGS,
      { operation: "start" },
    ),
    desktopAction(
      "gateway.weixin.stop",
      "停止微信网关",
      "settings",
      "停止个人微信消息网关，并关闭常驻运行。",
      DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      EMPTY_ARGS,
      { operation: "stop" },
    ),
    desktopAction(
      "gateway.weixin.restart",
      "重启微信网关",
      "settings",
      "刷新 LaunchAgent 配置并重启个人微信消息网关。",
      DESKTOP_ACTIONS.WEIXIN_GATEWAY_CONTROL,
      EMPTY_ARGS,
      { operation: "restart" },
    ),
    desktopAction(
      "apiProvider.set",
      "设置 API 供应方",
      "settings",
      "写入 API 供应方配置，例如 memefast baseUrl、apiKey、默认模型或启用状态。",
      DESKTOP_ACTIONS.API_PROVIDER_SET,
      objectArgs(
        {
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          key: {
            ...STRING_ARG,
            description: "参数名，例如 apiKey、baseUrl、models、enabled、defaultVideoModel。",
          },
          value: { ...STRING_ARG, description: "参数值；密钥会写入本地配置但 snapshot 只脱敏。" },
        },
        ["providerId", "key", "value"],
      ),
    ),
    desktopAction(
      "settings.textModel",
      "设置文本模型",
      "settings",
      "设置指定供应方的默认文本模型。",
      DESKTOP_ACTIONS.API_PROVIDER_SET,
      objectArgs(
        {
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          value: { ...STRING_ARG, description: "默认文本模型 id。" },
        },
        ["providerId", "value"],
      ),
      { key: "defaultTextModel" },
    ),
    desktopAction(
      "settings.imageModel",
      "设置图片模型",
      "settings",
      "设置指定供应方的默认图片模型。",
      DESKTOP_ACTIONS.API_PROVIDER_SET,
      objectArgs(
        {
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          value: { ...STRING_ARG, description: "默认图片模型 id。" },
        },
        ["providerId", "value"],
      ),
      { key: "defaultImageModel" },
    ),
    desktopAction(
      "apiProvider.test",
      "测试 API Key",
      "settings",
      "用当前供应方 Base URL 和 API Key 调用 models endpoint，确认密钥可用。",
      DESKTOP_ACTIONS.API_PROVIDER_TEST,
      objectArgs(
        {
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          apiKey: { ...STRING_ARG, description: "临时测试用 API Key；不会写入配置。" },
          baseUrl: { ...STRING_ARG, description: "临时测试用 Base URL；不会写入配置。" },
        },
        ["providerId"],
      ),
    ),
    desktopAction(
      "apiProvider.syncModels",
      "同步模型池",
      "settings",
      "同步供应方公开模型元数据和账号可见模型，更新本地模型池。",
      DESKTOP_ACTIONS.API_PROVIDER_SYNC_MODELS,
      objectArgs(
        {
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          apiKey: { ...STRING_ARG, description: "临时同步用 API Key；不会写入配置。" },
          baseUrl: { ...STRING_ARG, description: "临时同步用 Base URL；会作为同步后的供应方 URL 保存。" },
        },
        ["providerId"],
      ),
    ),
    desktopAction(
      "apiProvider.image",
      "生成图片",
      "production",
      "用已配置 API 供应方调用图片生成 POST 路径。",
      DESKTOP_ACTIONS.API_PROVIDER_IMAGE,
      objectArgs(
        {
          prompt: { ...STRING_ARG, description: "图片生成提示词。" },
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          model: { ...STRING_ARG, description: "临时指定图片模型。" },
          size: { ...STRING_ARG, description: "图片尺寸，例如 1024x1024。" },
        },
        ["prompt"],
      ),
    ),
    desktopAction(
      "apiProvider.video",
      "生成视频",
      "production",
      "用已配置 API 供应方调用视频生成任务路径，并进入任务运行中心。",
      DESKTOP_ACTIONS.API_PROVIDER_VIDEO,
      objectArgs(
        {
          prompt: { ...STRING_ARG, description: "视频生成提示词。" },
          providerId: { ...STRING_ARG, description: "供应方 id，例如 memefast-api。" },
          model: { ...STRING_ARG, description: "临时指定视频模型。" },
          duration: { type: "number", description: "视频秒数，例如 5。" },
          aspectRatio: { ...STRING_ARG, description: "画幅比例，例如 9:16。" },
          size: { ...STRING_ARG, description: "视频尺寸或分辨率，例如 1080x1920。" },
        },
        ["prompt"],
      ),
    ),
    desktopAction(
      "comfyui.open",
      "打开 ComfyUI",
      "production",
      "打开已配置的 ComfyUI Web 界面；不会提交 workflow。",
      DESKTOP_ACTIONS.COMFYUI_OPEN,
    ),
    desktopAction(
      "comfyui.createWorkflow",
      "ComfyUI 完整工作流",
      "production",
      "Angel 先生成内容和参数，再保存真实 ComfyUI 节点画布；支持脚本、脚本+图片、脚本+视频、脚本+图片+视频。",
      DESKTOP_ACTIONS.COMFYUI_CREATE_WORKFLOW,
      objectArgs(
        {
          objective: { ...STRING_ARG, description: "工作流目标。" },
          workflowKind: {
            ...STRING_ARG,
            description: "工作流类型：script、copywriting、image 或 video。",
          },
          workflowModes: {
            ...STRING_ARG,
            description: "工作流组合：script、script+image、script+video、script+image+video。",
          },
        },
        ["objective"],
      ),
    ),
    desktopAction(
      "comfyui.run",
      "ComfyUI 工作流",
      "production",
      "通过已配置 ComfyUI 外部工具提交真实 workflow；无提示词节点时只作为连通性验证。",
      DESKTOP_ACTIONS.COMFYUI_RUN,
      objectArgs(
        {
          prompt: { ...STRING_ARG, description: "要注入 workflow 的提示词。" },
          workflowPath: { ...STRING_ARG, description: "临时指定 workflow JSON 文件。" },
          outputDir: { ...STRING_ARG, description: "临时指定产物保存目录。" },
        },
        ["prompt"],
      ),
    ),
    desktopAction(
      "production.start",
      "制作任务",
      "production",
      "从工作台目标创建 Director 制作蓝图，自动召回已发布知识和相关 Skill，并物化本地 run。",
      DESKTOP_ACTIONS.PRODUCTION_START,
      objectArgs(
        {
          prompt: { ...STRING_ARG, description: "制作目标或交付物说明。" },
          createRun: { ...BOOLEAN_ARG, description: "是否创建本地 execution run。" },
          workflowType: {
            ...STRING_ARG,
            enum: ["storyboard", "script", "copywriting"],
            description: "制作工作流类型。",
          },
        },
        ["prompt"],
      ),
    ),
  ]),
  group("learning", "自学习", "learning", [
    desktopAction(
      "learning.admit",
      "学习资料",
      "learning",
      "从工作台输入的链接、路径、主题或粘贴文本进入 review-gated 学习入口。",
      DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
      objectArgs(
        {
          text: { ...STRING_ARG, description: "要学习的文本、链接、路径或主题。" },
          title: { ...STRING_ARG, description: "资料标题。" },
          sourceRef: { ...STRING_ARG, description: "可选来源引用。" },
          privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
        },
        ["text"],
      ),
    ),
    desktopAction(
      "learning.directory",
      "从本地资料学习",
      "learning",
      "从本地目录或文件生成 review-gated 经验候选。",
      DESKTOP_ACTIONS.EXPERIENCE_LEARN_DIRECTORY,
      objectArgs(
        {
          directory: { ...STRING_ARG, description: "本地目录或文件路径。" },
          privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
          maxDepth: { ...INTEGER_ARG, description: "目录递归深度。" },
        },
        ["directory"],
      ),
    ),
    desktopAction(
      "learning.query",
      "从网页主题学习",
      "learning",
      "从搜索主题生成 review-gated 经验候选。",
      DESKTOP_ACTIONS.EXPERIENCE_LEARN_QUERY,
      objectArgs(
        {
          query: { ...STRING_ARG, description: "学习主题。" },
          privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
          maxResultsPerQuery: { ...INTEGER_ARG, description: "最多搜索结果。" },
        },
        ["query"],
      ),
    ),
    desktopAction(
      "learning.url",
      "从 URL 学习",
      "learning",
      "从指定 URL 生成 review-gated 经验候选。",
      DESKTOP_ACTIONS.EXPERIENCE_LEARN_URL,
      objectArgs(
        {
          url: { ...STRING_ARG, description: "URL。" },
          privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
        },
        ["url"],
      ),
    ),
    desktopAction(
      "learning.text",
      "从粘贴文本学习",
      "learning",
      "从工作台粘贴的长文本生成 review-gated 经验候选，并保留原文快照。",
      DESKTOP_ACTIONS.EXPERIENCE_LEARN_TEXT,
      objectArgs(
        {
          text: { ...STRING_ARG, description: "粘贴的原文资料。" },
          title: { ...STRING_ARG, description: "资料标题。" },
          sourceRef: { ...STRING_ARG, description: "可选来源引用。" },
          privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
        },
        ["text"],
      ),
    ),
    desktopAction(
      "learning.mediaUnderstand",
      "理解学习媒体",
      "learning",
      "在用户明确授权和预算约束下，处理学习工件里发现的图片、视频或音频，并把证据回填到待审学习工件。",
      DESKTOP_ACTIONS.LEARNING_MEDIA_UNDERSTAND,
      objectArgs(
        {
          artifactId: { ...STRING_ARG, description: "学习工件 id。" },
          candidateId: { ...STRING_ARG, description: "关联经验候选 id。" },
          sourceRef: { ...STRING_ARG, description: "来源 URL 或引用。" },
          mode: {
            ...STRING_ARG,
            enum: ["media_inventory", "low_cost", "deep_multimodal"],
            description: "媒体处理模式。",
          },
          userAuthorized: { ...BOOLEAN_ARG, description: "用户是否已明确授权媒体处理。" },
          tokenBudget: { ...INTEGER_ARG, description: "本次媒体理解 token 预算上限。" },
          maxAssets: { ...INTEGER_ARG, description: "本次最多处理的媒体数量。" },
        },
        ["userAuthorized"],
      ),
    ),
    desktopAction(
      "experience.list",
      "经验候选列表",
      "experience",
      "列出经验候选和审查状态。",
      DESKTOP_ACTIONS.EXPERIENCE_LIST,
    ),
    desktopAction(
      "experience.edit",
      "编辑提炼经验",
      "experience",
      "在经验通过审核前，更新提炼摘要、适用场景、风险或标签。",
      DESKTOP_ACTIONS.EXPERIENCE_UPDATE,
      objectArgs(
        {
          candidateId: { ...STRING_ARG, description: "经验候选 id。" },
          summary: { ...STRING_ARG, description: "更新后的提炼经验摘要。" },
          applicability: { ...STRING_ARG, description: "更新后的适用场景。" },
          risks: STRING_LIST_ARG,
          tags: STRING_LIST_ARG,
        },
        ["candidateId"],
      ),
    ),
    cliCommand(
      "experience.explain",
      "解释经验候选",
      "experience",
      "查看一个经验候选的来源、风险和证据。",
      ["director", "knowledge", "experience-explain"],
      objectArgs({ candidateId: { ...STRING_ARG, description: "经验候选 id。" } }, ["candidateId"]),
      flagMap({ candidateId: "--candidate-id" }),
    ),
    desktopAction(
      "experience.accept",
      "接受经验候选",
      "experience",
      "通过人工审查，允许候选晋升。",
      DESKTOP_ACTIONS.EXPERIENCE_ACCEPT,
      candidateReviewArgs(),
    ),
    desktopAction(
      "experience.reject",
      "拒绝经验候选",
      "experience",
      "拒绝不应进入知识 lane 的经验候选。",
      DESKTOP_ACTIONS.EXPERIENCE_REJECT,
      candidateReviewArgs(),
    ),
    desktopAction(
      "experience.promote",
      "晋升知识候选",
      "experience",
      "把已接受经验晋升为知识候选。",
      DESKTOP_ACTIONS.EXPERIENCE_PROMOTE,
      candidateReviewArgs(),
    ),
    desktopAction(
      "experience.fromRunReport",
      "从运行沉淀经验",
      "experience",
      "把一次制作运行的结果、反馈和复盘转成待审经验候选。",
      DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_RUN_REPORT,
      runOutputExperienceArgs(),
    ),
    desktopAction(
      "experience.fromTraceProposal",
      "从轨迹沉淀经验",
      "experience",
      "从执行轨迹中提取可复用做法，生成待审经验候选。",
      DESKTOP_ACTIONS.EXPERIENCE_CREATE_FROM_TRACE_PROPOSAL,
      traceProposalExperienceArgs(),
    ),
    desktopAction(
      "experience.tagSave",
      "保存经验标签",
      "experience",
      "只更新经验候选的自定义标签，不改变分类。",
      DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
      objectArgs(
        {
          candidateId: { ...STRING_ARG, description: "经验候选 id。" },
          tagIds: { ...STRING_LIST_ARG, description: "标签 id，逗号分隔也可以。" },
          note: { ...STRING_ARG, description: "说明。" },
        },
        ["candidateId", "tagIds"],
      ),
    ),
    desktopAction(
      "experience.classificationSave",
      "保存分类标签",
      "experience",
      "把经验候选绑定到自定义分类和标签，晋升知识时会带入召回。",
      DESKTOP_ACTIONS.EXPERIENCE_CLASSIFICATION_SAVE,
      experienceTaxonomyArgs(),
    ),
    desktopAction(
      "experience.categoryCreate",
      "新建经验分类",
      "experience",
      "创建或更新经验库分类。",
      DESKTOP_ACTIONS.EXPERIENCE_CATEGORY_CREATE,
      taxonomyCategoryArgs(),
    ),
    desktopAction(
      "experience.tagCreate",
      "新建经验标签",
      "experience",
      "创建或更新经验库自定义标签。",
      DESKTOP_ACTIONS.EXPERIENCE_TAG_CREATE,
      taxonomyTagArgs(),
    ),
  ]),
  group("knowledge", "知识", "knowledge", [
    cliCommand("knowledge.status", "知识状态", "knowledge", "读取知识 lane 状态。", [
      "director",
      "knowledge",
      "status",
    ]),
    cliCommand("knowledge.list", "已发布知识", "knowledge", "列出已发布知识包。", [
      "director",
      "knowledge",
      "list",
    ]),
    cliCommand(
      "knowledge.explain",
      "解释知识包",
      "knowledge",
      "查看已发布知识包详情。",
      ["director", "knowledge", "explain"],
      packIdArgs(),
      flagMap({ packId: "--pack-id" }),
    ),
    cliCommand(
      "knowledge.sync",
      "从 proposal 同步知识候选",
      "knowledge",
      "从已接受 trace proposal 同步知识候选。",
      ["director", "knowledge", "sync"],
      proposalReviewArgs(),
      flagMap({ proposalId: "--proposal-id", author: "--author", note: "--note" }),
    ),
    desktopAction(
      "knowledge.candidates",
      "知识候选列表",
      "knowledge",
      "列出待审查知识候选。",
      DESKTOP_ACTIONS.KNOWLEDGE_CANDIDATE_LIST,
    ),
    cliCommand(
      "knowledge.candidateExplain",
      "解释知识候选",
      "knowledge",
      "查看一个知识候选的 method、diff 和证据。",
      ["director", "knowledge", "candidate-explain"],
      packIdArgs(),
      flagMap({ packId: "--pack-id" }),
    ),
    cliCommand(
      "knowledge.diff",
      "查看知识 diff",
      "knowledge",
      "查看候选相对当前发布版本的变更。",
      ["director", "knowledge", "diff"],
      packIdArgs(),
      flagMap({ packId: "--pack-id" }),
    ),
    cliCommand(
      "knowledge.review",
      "审查知识候选",
      "knowledge",
      "输出知识候选审查摘要。",
      ["director", "knowledge", "review"],
      packIdArgs(),
      flagMap({ packId: "--pack-id" }),
    ),
    desktopAction(
      "knowledge.accept",
      "接受知识候选",
      "knowledge",
      "接受知识候选，等待发布。",
      DESKTOP_ACTIONS.KNOWLEDGE_ACCEPT,
      packReviewArgs(),
    ),
    cliCommand(
      "knowledge.reject",
      "拒绝知识候选",
      "knowledge",
      "拒绝一个知识候选。",
      ["director", "knowledge", "reject"],
      packReviewArgs(),
      flagMap({ packId: "--pack-id", author: "--author", note: "--note" }),
    ),
    desktopAction(
      "knowledge.publish",
      "发布知识",
      "knowledge",
      "发布已接受知识包，允许运行时召回。",
      DESKTOP_ACTIONS.KNOWLEDGE_PUBLISH,
      packReviewArgs(),
    ),
    cliCommand(
      "knowledge.rollback",
      "回滚知识",
      "knowledge",
      "回滚已发布知识到指定版本。",
      ["director", "knowledge", "rollback"],
      objectArgs(
        {
          packId: { ...STRING_ARG, description: "知识包 id。" },
          version: { ...INTEGER_ARG, description: "目标版本。" },
          author: { ...STRING_ARG, description: "操作者。" },
          note: { ...STRING_ARG, description: "说明。" },
        },
        ["packId", "version"],
      ),
      flagMap({ packId: "--pack-id", version: "--version", author: "--author", note: "--note" }),
    ),
    desktopAction(
      "knowledge.recallPreview",
      "知识召回预览",
      "knowledge",
      "按项目、分组、标签预览已发布知识召回。",
      DESKTOP_ACTIONS.KNOWLEDGE_RECALL_PREVIEW,
      recallArgs(),
    ),
  ]),
  group("director", "导演评估", "director", [
    desktopAction(
      "director.plan",
      "生成前总导演",
      "director",
      "用当前桌面 snapshot 运行 Director Core，生成推荐模式、推荐模型、审核门和人工确认计划。",
      DESKTOP_ACTIONS.DIRECTOR_PLAN,
      objectArgs(
        {
          prompt: { ...STRING_ARG, description: "生成目标或当前组说明。" },
          projectId: { ...STRING_ARG, description: "项目 id。" },
          groupId: { ...STRING_ARG, description: "分组 id。" },
          preferredImageBinding: { ...STRING_ARG, description: "偏好的图片模型绑定。" },
          preferredVideoBinding: { ...STRING_ARG, description: "偏好的视频模型绑定。" },
        },
        ["prompt"],
      ),
    ),
    desktopAction(
      "director.planAccept",
      "接受总导演计划",
      "director",
      "接受当前总导演计划；可只接受模式/模型，也可继续进入现有制作链路。",
      DESKTOP_ACTIONS.DIRECTOR_PLAN_ACCEPT,
      directorPlanDecisionArgs(),
    ),
    desktopAction(
      "director.planIgnore",
      "忽略总导演计划",
      "director",
      "忽略当前总导演建议并回到旧链路，不自动生成制作任务。",
      DESKTOP_ACTIONS.DIRECTOR_PLAN_IGNORE,
      objectArgs({ note: { ...STRING_ARG, description: "忽略原因或操作备注。" } }),
    ),
    desktopAction(
      "director.planRerun",
      "重跑总导演",
      "director",
      "重新运行 Director Core，刷新推荐模式、模型路由和审核门。",
      DESKTOP_ACTIONS.DIRECTOR_PLAN_RERUN,
      objectArgs(
        {
          prompt: { ...STRING_ARG, description: "新的生成目标；不填则复用当前总导演目标。" },
          projectId: { ...STRING_ARG, description: "项目 id。" },
          groupId: { ...STRING_ARG, description: "分组 id。" },
          preferredImageBinding: { ...STRING_ARG, description: "偏好的图片模型绑定。" },
          preferredVideoBinding: { ...STRING_ARG, description: "偏好的视频模型绑定。" },
        },
      ),
    ),
    cliCommand(
      "director.intake",
      "Intake",
      "director",
      "规范化 snapshot 并汇报缺失信息。",
      ["director", "intake"],
      inputHostArgs(),
      flagMap({ input: "--input", host: "--host" }),
    ),
    cliCommand(
      "director.clarify",
      "Clarify",
      "director",
      "调用 host API 生成澄清问题。",
      ["director", "clarify"],
      inputHostArgs(),
      flagMap({ input: "--input", host: "--host" }),
    ),
    cliCommand(
      "director.evaluate",
      "Evaluate",
      "director",
      "调用 Director host API 评估 snapshot。",
      ["director", "evaluate"],
      inputHostArgs(),
      flagMap({ input: "--input", host: "--host" }),
    ),
    cliCommand(
      "director.blueprint",
      "Blueprint",
      "director",
      "从 snapshot 生成 preview 和 handoff。",
      ["director", "blueprint"],
      inputHostArgs(),
      flagMap({ input: "--input", host: "--host" }),
    ),
    cliCommand(
      "director.outcome",
      "Outcome",
      "director",
      "记录 operator outcome JSON。",
      ["director", "outcome"],
      inputHostArgs(),
      flagMap({ input: "--input", host: "--host" }),
    ),
  ]),
  group("run", "运行控制", "run", [
    cliCommand(
      "run.create",
      "创建 run",
      "run",
      "从 reviewed blueprint 物化执行 run。",
      ["director", "run", "create"],
      inputHostArgs(),
      flagMap({ input: "--input", host: "--host" }),
    ),
    cliCommand(
      "run.once",
      "Worker once",
      "run",
      "本地 worker 推进 ready assignments 一轮。",
      ["director", "run", "once"],
      objectArgs(
        {
          runId: { ...STRING_ARG, description: "Run id。" },
          workerId: { ...STRING_ARG, description: "Worker id。" },
        },
        ["runId"],
      ),
      flagMap({ runId: "--run-id", workerId: "--worker-id" }),
    ),
    ...["status", "start", "pause", "resume", "abort", "report", "explain", "audit"].map(
      (command) =>
        cliCommand(
          `run.${command}`,
          runCommandLabel(command),
          "run",
          `执行 director run ${command}。`,
          ["director", "run", command],
          runIdArgs(),
          flagMap({ runId: "--run-id", host: "--host" }),
        ),
    ),
    cliCommand(
      "run.retry",
      "重试 assignment",
      "run",
      "重试 failed 或 blocked assignment。",
      ["director", "run", "retry"],
      assignmentArgs(),
      flagMap({ runId: "--run-id", assignmentId: "--assignment-id", host: "--host" }),
    ),
    desktopAction(
      "run.approve",
      "批准待审 assignment",
      "run",
      "批准 pending operator_approve assignment，让它进入 ready 或等待依赖。",
      DESKTOP_ACTIONS.RUN_APPROVE_ASSIGNMENT,
      objectArgs(
        {
          runId: { ...STRING_ARG, description: "Run id。" },
          assignmentId: { ...STRING_ARG, description: "Assignment id。" },
        },
        ["runId", "assignmentId"],
      ),
    ),
    desktopAction(
      "run.approvePending",
      "批准全部待审 assignment",
      "run",
      "一次批准当前 run 里所有 pending operator_approve assignment。",
      DESKTOP_ACTIONS.RUN_APPROVE_PENDING_ASSIGNMENTS,
      runIdArgs(),
    ),
    desktopAction(
      "run.confirm",
      "确认继续",
      "run",
      "确认或继续当前待审制作运行；桌面端复用同一套 run continue 控制链。",
      DESKTOP_ACTIONS.RUN_CONTINUE,
      runIdArgs(),
    ),
    desktopAction(
      "run.continue",
      "继续推进 run",
      "run",
      "按当前状态批准待审项、启动 run，并用本地安全 worker 推进到完成或下一个卡点。",
      DESKTOP_ACTIONS.RUN_CONTINUE,
      runIdArgs(),
    ),
    desktopAction(
      "run.delegations",
      "协作角色",
      "run",
      "查看这个 run 已拆给哪些 worker / verifier，以及每个角色当前执行状态。",
      DESKTOP_ACTIONS.RUN_DELEGATIONS,
      runIdArgs(),
    ),
    desktopAction(
      "run.schedulerExecutor",
      "执行后台子代理",
      "run",
      "按当前调度计划消费 ready 的后台子代理 delegation，并把完成结果写回协作状态。",
      DESKTOP_ACTIONS.RUN_SCHEDULER_EXECUTOR,
      objectArgs(
        {
          runId: { ...STRING_ARG, description: "Run id。" },
          maxDispatches: {
            ...INTEGER_ARG,
            description: "本次最多执行几个 ready 子代理，默认 1。",
          },
        },
        ["runId"],
      ),
    ),
    desktopAction(
      "run.schedulerRecovery",
      "后台恢复检查",
      "run",
      "检查后台子代理调度恢复建议；默认只做 dry-run，确认后才取消观测漂移相关排队项。",
      DESKTOP_ACTIONS.RUN_SCHEDULER_RECOVERY,
      objectArgs(
        {
          runId: { ...STRING_ARG, description: "Run id。" },
          actionId: { ...STRING_ARG, description: "只处理某一条 recovery action。" },
          confirmCancelObservedDrift: {
            ...BOOLEAN_ARG,
            description: "确认取消观测写集漂移相关的排队子代理，默认 false。",
          },
        },
        ["runId"],
      ),
    ),
    desktopAction(
      "run.reflect",
      "运行反思",
      "run",
      "对运行结果做复盘，生成可审查改进建议或经验候选。",
      DESKTOP_ACTIONS.RUN_REFLECT,
      runIdArgs(),
    ),
    desktopAction(
      "run.review",
      "运行与审查",
      "run",
      "打开运行与审查状态，让操作者查看当前 run、待审项和报告。",
      DESKTOP_ACTIONS.SNAPSHOT,
    ),
    cliCommand(
      "run.reroute",
      "切换 adapter",
      "run",
      "把 assignment 切换到另一个 approved adapter。",
      ["director", "run", "reroute"],
      objectArgs(
        {
          runId: { ...STRING_ARG, description: "Run id。" },
          assignmentId: { ...STRING_ARG, description: "Assignment id。" },
          adapterId: { ...STRING_ARG, description: "Adapter id。" },
          host: { ...STRING_ARG, description: "Host URL。" },
        },
        ["runId", "assignmentId", "adapterId"],
      ),
      flagMap({
        runId: "--run-id",
        assignmentId: "--assignment-id",
        adapterId: "--adapter-id",
        host: "--host",
      }),
    ),
  ]),
  group("memory", "记忆", "memory", [
    cliCommand("memory.status", "记忆状态", "memory", "读取 Director memory lane 状态。", [
      "director",
      "memory",
      "status",
    ]),
    cliCommand(
      "memory.publications",
      "记忆发布列表",
      "memory",
      "列出已发布运行记忆及撤回、降权、隔离状态。",
      ["director", "memory", "publications"],
      memoryPublicationListArgs(),
      flagMap({ status: "--status", limit: "--limit" }),
    ),
    cliCommand(
      "memory.publicationRetract",
      "记忆撤回",
      "memory",
      "撤回一条已发布运行记忆，撤回后不会进入召回。",
      ["director", "memory", "publication-retract"],
      memoryPublicationGovernanceArgs(),
      flagMap({ recordId: "--record-id", note: "--note", now: "--now" }),
    ),
    cliCommand(
      "memory.publicationDemote",
      "记忆降权",
      "memory",
      "降低一条已发布运行记忆的召回权重。",
      ["director", "memory", "publication-demote"],
      memoryPublicationGovernanceArgs(),
      flagMap({ recordId: "--record-id", note: "--note", now: "--now" }),
    ),
    cliCommand(
      "memory.publicationQuarantine",
      "记忆隔离",
      "memory",
      "隔离一条已发布运行记忆，隔离后不会进入召回。",
      ["director", "memory", "publication-quarantine"],
      memoryPublicationGovernanceArgs(),
      flagMap({ recordId: "--record-id", note: "--note", now: "--now" }),
    ),
    cliCommand(
      "memory.publicationRestore",
      "记忆恢复",
      "memory",
      "把撤回、降权或隔离的运行记忆恢复为可正常召回。",
      ["director", "memory", "publication-restore"],
      memoryPublicationGovernanceArgs(),
      flagMap({ recordId: "--record-id", note: "--note", now: "--now" }),
    ),
    cliCommand(
      "memory.recallPreview",
      "记忆召回预览",
      "memory",
      "预览 Director memory recall。",
      ["director", "memory", "recall-preview"],
      recallArgs(),
      flagMap({
        projectId: "--project-id",
        groupId: "--group-id",
        anchorId: "--anchor-id",
        adapterId: "--adapter-id",
        generationType: "--generation-type",
        generationStyle: "--generation-style",
        tags: "--tag",
        maxHits: "--max-hits",
      }),
    ),
    cliCommand(
      "evidence.list",
      "Evidence 列表",
      "memory",
      "按 run、task、session、source 查统一 evidence。",
      ["director", "evidence", "list"],
      evidenceListArgs(),
      flagMap({
        sessionKey: "--session-key",
        runId: "--run-id",
        taskId: "--task-id",
        sourceRef: "--source-ref",
        sourceSnapshotId: "--source-snapshot-id",
        limit: "--limit",
      }),
    ),
    cliCommand(
      "evidence.view",
      "查看 Evidence",
      "memory",
      "查看一条 evidence 的只读摘要和来源。",
      ["director", "evidence", "view"],
      evidenceIdArgs(),
      flagMap({ evidenceId: "--evidence-id" }),
    ),
    cliCommand(
      "evidence.content",
      "Evidence 原文",
      "memory",
      "读取一条 evidence 的受限原文预览。",
      ["director", "evidence", "content"],
      evidenceContentArgs(),
      flagMap({ evidenceId: "--evidence-id", maxChars: "--max-chars" }),
    ),
    cliCommand(
      "control.memoryInspect",
      "CLI memory inspect",
      "memory",
      "通过 control-plane 检查一个 session 的 memory。",
      ["control", "memory-inspect"],
      sessionArgs(),
      { sessionId: { position: "positional" } },
    ),
    cliCommand(
      "control.memoryClear",
      "CLI memory clear",
      "memory",
      "通过 control-plane 清理一个 session 的 memory。",
      ["control", "memory-clear"],
      objectArgs(
        {
          sessionId: { ...STRING_ARG, description: "Session id。" },
          scope: { ...STRING_ARG, enum: ["working"] },
        },
        ["sessionId"],
      ),
      { sessionId: { position: "positional" }, scope: { flag: "--scope" } },
    ),
  ]),
  group("trace-proposal", "经验提案", "proposal", [
    cliCommand("traceProposal.status", "提案状态", "proposal", "读取 trace proposal lane 状态。", [
      "director",
      "trace-proposal",
      "status",
    ]),
    cliCommand(
      "traceProposal.list",
      "提案列表",
      "proposal",
      "列出 trace proposals。",
      ["director", "trace-proposal", "list"],
      objectArgs({
        status: { ...STRING_ARG, enum: ["pending", "accepted", "rejected"] },
        projectId: { ...STRING_ARG, description: "Project id。" },
        groupId: { ...STRING_ARG, description: "Group id。" },
        limit: { ...INTEGER_ARG, description: "数量限制。" },
      }),
      flagMap({
        status: "--status",
        projectId: "--project-id",
        groupId: "--group-id",
        limit: "--limit",
      }),
    ),
    ...["explain", "review", "preview", "replay"].map((command) =>
      cliCommand(
        `traceProposal.${command}`,
        traceProposalLabel(command),
        "proposal",
        `执行 trace-proposal ${command}。`,
        ["director", "trace-proposal", command],
        command === "replay"
          ? objectArgs(
              {
                proposalId: { ...STRING_ARG, description: "Proposal id。" },
                workerId: { ...STRING_ARG, description: "Worker id。" },
              },
              ["proposalId"],
            )
          : proposalIdArgs(),
        command === "replay"
          ? flagMap({ proposalId: "--proposal-id", workerId: "--worker-id" })
          : flagMap({ proposalId: "--proposal-id" }),
      ),
    ),
    ...["accept", "reject"].map((command) =>
      cliCommand(
        `traceProposal.${command}`,
        traceProposalLabel(command),
        "proposal",
        `执行 trace-proposal ${command}。`,
        ["director", "trace-proposal", command],
        proposalReviewArgs(),
        flagMap({ proposalId: "--proposal-id", note: "--note" }),
      ),
    ),
  ]),
  group("task", "任务与控制面", "task", [
    cliCommand(
      "task.status",
      "任务状态",
      "task",
      "读取 task 状态。",
      ["task", "status"],
      sessionArgs(),
      {
        sessionId: { position: "positional" },
      },
    ),
    cliCommand(
      "task.mailbox",
      "Worker mailbox",
      "task",
      "读取 worker mailbox。",
      ["task", "mailbox"],
      sessionArgs(),
      { sessionId: { position: "positional" } },
    ),
    cliCommand(
      "task.verifierMailbox",
      "Verifier mailbox",
      "task",
      "读取 verifier mailbox。",
      ["task", "verifier-mailbox"],
      sessionArgs(),
      { sessionId: { position: "positional" } },
    ),
    cliCommand(
      "task.proposalList",
      "Task proposals",
      "proposal",
      "列出 task proposal queue。",
      ["task", "proposal-list"],
      objectArgs({
        sessionId: { ...STRING_ARG, description: "Session id。" },
        status: { ...STRING_ARG, enum: ["pending", "accepted", "rejected", "applied"] },
        limit: { ...INTEGER_ARG, description: "数量限制。" },
      }),
      {
        sessionId: { position: "positional" },
        status: { flag: "--status" },
        limit: { flag: "--limit" },
      },
    ),
    ...[
      "proposal-get",
      "proposal-review",
      "proposal-accept",
      "proposal-reject",
      "proposal-explain",
      "proposal-preview",
      "proposal-apply",
    ].map((command) =>
      cliCommand(
        `task.${command}`,
        command,
        "proposal",
        `执行 task ${command}。`,
        ["task", command],
        taskProposalArgs(),
        taskProposalArgMap(command),
      ),
    ),
    desktopAction(
      "skill.proposeFromExperience",
      "从经验生成 Skill 候选",
      "proposal",
      "把已审核经验转成 review-gated Skill proposal，等待人工审核后再应用。",
      DESKTOP_ACTIONS.SKILL_PROPOSE_FROM_EXPERIENCE,
      objectArgs({ candidateId: { ...STRING_ARG, description: "Experience candidate id。" } }, [
        "candidateId",
      ]),
    ),
    desktopAction(
      "skill.proposalAccept",
      "接受 Skill 候选",
      "proposal",
      "接受桌面端默认 Skill proposal 队列中的候选。",
      DESKTOP_ACTIONS.SKILL_PROPOSAL_ACCEPT,
      proposalReviewArgs(),
    ),
    desktopAction(
      "skill.proposalReject",
      "拒绝 Skill 候选",
      "proposal",
      "拒绝桌面端默认 Skill proposal 队列中的候选。",
      DESKTOP_ACTIONS.SKILL_PROPOSAL_REJECT,
      proposalReviewArgs(),
    ),
    desktopAction(
      "skill.proposalApply",
      "应用 Skill 候选",
      "proposal",
      "把已接受 Skill proposal 安全写入 approved Skill snapshot。",
      DESKTOP_ACTIONS.SKILL_PROPOSAL_APPLY,
      proposalIdArgs(),
    ),
    desktopAction(
      "skill.classificationSave",
      "保存 Skill 分类标签",
      "proposal",
      "把 approved Skill 绑定到自定义分类和标签，运行时召回可按分类整理。",
      DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      skillTaxonomyArgs(),
    ),
    desktopAction(
      "skill.tagSave",
      "保存 Skill 标签",
      "proposal",
      "只更新 approved Skill 的自定义标签，不改变分类。",
      DESKTOP_ACTIONS.SKILL_CLASSIFICATION_SAVE,
      objectArgs(
        {
          skillId: { ...STRING_ARG, description: "Approved Skill id。" },
          tagIds: { ...STRING_LIST_ARG, description: "标签 id，逗号分隔也可以。" },
          note: { ...STRING_ARG, description: "说明。" },
        },
        ["skillId", "tagIds"],
      ),
    ),
    desktopAction(
      "skill.categoryCreate",
      "新建 Skill 分类",
      "proposal",
      "创建或更新 Skill 分类。",
      DESKTOP_ACTIONS.SKILL_CATEGORY_CREATE,
      taxonomyCategoryArgs(),
    ),
    desktopAction(
      "skill.tagCreate",
      "新建 Skill 标签",
      "proposal",
      "创建或更新 Skill 自定义标签。",
      DESKTOP_ACTIONS.SKILL_TAG_CREATE,
      taxonomyTagArgs(),
    ),
    cliCommand(
      "task.proposalRollback",
      "proposal-rollback",
      "proposal",
      "回滚已应用 proposal 版本。",
      ["task", "proposal-rollback"],
      objectArgs(
        {
          sessionId: { ...STRING_ARG, description: "Session id。" },
          version: { ...INTEGER_ARG, description: "Version。" },
        },
        ["sessionId", "version"],
      ),
      { sessionId: { position: "positional" }, version: { flag: "--version" } },
    ),
  ]),
  group("adapters", "适配器与平台", "adapter", [
    cliCommand(
      "adapter.list",
      "Adapter 列表",
      "adapter",
      "列出 runtime adapters。",
      ["director", "adapters", "list"],
      hostArgs(),
    ),
    cliCommand(
      "adapter.register",
      "注册 adapter manifest",
      "adapter",
      "注册持久化 adapter manifest。",
      ["director", "adapters", "register"],
      objectArgs({ manifest: { ...STRING_ARG, description: "Manifest path。" } }, ["manifest"]),
      flagMap({ manifest: "--manifest" }),
    ),
    ...["enable", "disable", "explain"].map((command) =>
      cliCommand(
        `adapter.${command}`,
        adapterLabel(command),
        "adapter",
        `执行 adapters ${command}。`,
        ["director", "adapters", command],
        objectArgs({ adapterId: { ...STRING_ARG, description: "Adapter id。" } }, ["adapterId"]),
        flagMap({ adapterId: "--adapter-id" }),
      ),
    ),
    cliCommand(
      "platform.capabilities",
      "平台能力视图",
      "platform",
      "读取 Host API V1 capability resource 清单。",
      ["director", "capabilities"],
      hostArgs(),
    ),
    cliCommand(
      "binding.list",
      "Client Binding 列表",
      "platform",
      "列出 Host API V1 client bindings。",
      ["director", "binding", "list"],
      hostArgs(),
    ),
    cliCommand(
      "binding.create",
      "创建 Client Binding",
      "platform",
      "创建或更新 Host API V1 client binding。",
      ["director", "binding", "create"],
      objectArgs(
        {
          bindingId: { ...STRING_ARG, description: "Binding id。" },
          clientId: { ...STRING_ARG, description: "Client id。" },
          channel: { ...STRING_ARG, description: "Channel。" },
          hostId: { ...STRING_ARG, description: "Host id。" },
          agentId: { ...STRING_ARG, description: "Agent id。" },
        },
        ["bindingId"],
      ),
      flagMap({
        bindingId: "--binding-id",
        clientId: "--client-id",
        channel: "--channel",
        hostId: "--host-id",
        agentId: "--agent-id",
      }),
    ),
    cliCommand(
      "binding.delete",
      "删除 Client Binding",
      "platform",
      "删除 Host API V1 client binding。",
      ["director", "binding", "delete"],
      objectArgs({ bindingId: { ...STRING_ARG, description: "Binding id。" } }, ["bindingId"]),
      flagMap({ bindingId: "--binding-id" }),
    ),
    cliCommand(
      "session.create",
      "创建 V1 Session",
      "platform",
      "创建 Host API V1 session。",
      ["director", "session", "create"],
      objectArgs(
        {
          bindingId: { ...STRING_ARG, description: "Binding id。" },
          peerId: { ...STRING_ARG, description: "Peer id。" },
          title: { ...STRING_ARG, description: "Session title。" },
        },
        ["peerId"],
      ),
      flagMap({ bindingId: "--binding-id", peerId: "--peer-id", title: "--title" }),
    ),
    cliCommand(
      "task.submit",
      "提交 V1 Task",
      "platform",
      "向 Host API V1 task surface 提交任务。",
      ["director", "task", "submit"],
      objectArgs(
        {
          sessionId: { ...STRING_ARG, description: "Session id。" },
          text: { ...STRING_ARG, description: "任务文本。" },
          messageId: { ...STRING_ARG, description: "Message id。" },
        },
        ["sessionId", "text"],
      ),
      flagMap({ sessionId: "--session-id", text: "--text", messageId: "--message-id" }),
    ),
    cliCommand(
      "task.events",
      "Task Events",
      "platform",
      "读取 Host API V1 task SSE event stream。",
      ["director", "task", "events"],
      objectArgs({ taskId: { ...STRING_ARG, description: "Task id。" } }, ["taskId"]),
      flagMap({ taskId: "--task-id" }),
    ),
    cliCommand(
      "catalog.modelAdapters",
      "模型 Adapter 目录",
      "platform",
      "读取 Host API V1 model adapter catalog。",
      ["director", "catalog", "model-adapters"],
      hostArgs(),
    ),
    cliCommand(
      "learning.jobsRun",
      "运行 Learning Job",
      "platform",
      "运行 Host API V1 learning job。",
      ["director", "learning", "jobs", "run"],
      objectArgs({ jobId: { ...STRING_ARG, description: "Learning job id。" } }, ["jobId"]),
      flagMap({ jobId: "--job-id" }),
    ),
  ]),
]);

export function listDirectorDesktopCommandCatalog() {
  return cloneCatalog(COMMAND_GROUPS);
}

export function findDirectorDesktopCommand(commandId) {
  return flattenCommands(COMMAND_GROUPS).find((command) => command.id === commandId) ?? null;
}

export function buildDirectorDesktopCliArgv(command, inputArgs = {}) {
  if (command?.handler?.type !== "cliCommand") {
    throw new Error(`Command is not backed by CLI: ${String(command?.id)}`);
  }
  const normalizedArgs = normalizeArgs(command, inputArgs);
  const argv = [...command.handler.argv];
  for (const [key, value] of Object.entries(normalizedArgs)) {
    const map = command.handler.argMap?.[key];
    if (map?.position === "positional" && value !== undefined && value !== null && value !== "") {
      argv.push(String(value));
    }
  }
  for (const [key, value] of Object.entries(normalizedArgs)) {
    const map = command.handler.argMap?.[key] ?? { flag: toFlagName(key) };
    if (!map?.flag || value === undefined || value === null || value === "" || value === false) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== "") {
          argv.push(map.flag, String(item));
        }
      }
      continue;
    }
    argv.push(map.flag);
    if (value !== true) {
      argv.push(String(value));
    }
  }
  return argv;
}

export function buildDirectorDesktopAction(command, inputArgs = {}) {
  if (command?.handler?.type !== "desktopAction") {
    throw new Error(`Command is not backed by desktop action: ${String(command?.id)}`);
  }
  return {
    type: command.handler.action,
    ...(command.handler.staticArgs ?? {}),
    ...normalizeArgs(command, inputArgs),
  };
}

function group(id, label, domain, commands) {
  return Object.freeze({
    id,
    label,
    domain,
    commands: Object.freeze(commands),
  });
}

function desktopAction(id, label, domain, description, action, args = EMPTY_ARGS, staticArgs = {}) {
  return descriptor(id, label, domain, description, args, {
    type: "desktopAction",
    action,
    staticArgs: Object.freeze(staticArgs),
  });
}

function cliCommand(id, label, domain, description, argv, args = EMPTY_ARGS, argMap = {}) {
  return descriptor(id, label, domain, description, args, {
    type: "cliCommand",
    argv: Object.freeze(argv),
    argMap: Object.freeze(argMap),
  });
}

function descriptor(id, label, domain, description, args, handler) {
  const channelCommand = createChannelCommandMetadata(id);
  return Object.freeze({
    id,
    label,
    domain,
    description,
    args,
    handler: Object.freeze(handler),
    ...(channelCommand === null ? {} : { channelCommand }),
  });
}

function createChannelCommandMetadata(desktopCommandId) {
  const channelCommandId =
    SHARED_CHANNEL_COMMAND_ID_BY_DESKTOP_COMMAND_ID[desktopCommandId] ?? desktopCommandId;
  const command = resolveChannelCommandDefinition(channelCommandId);
  if (command === null) {
    return null;
  }
  return Object.freeze({
    id: command.id,
    canonicalName: command.canonicalName,
    aliases: [...command.aliases],
    argsHint: command.argsHint,
    outputPolicy: command.outputPolicy,
    memoryPolicy: command.memoryPolicy,
    activeSessionPolicy: command.activeSessionPolicy,
  });
}

function objectArgs(properties, required = []) {
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze(properties),
    required: Object.freeze(required),
  });
}

function flagMap(entries) {
  return Object.fromEntries(Object.entries(entries).map(([key, flag]) => [key, { flag }]));
}

function toFlagName(key) {
  return `--${key.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase()}`;
}

function jsonArgs() {
  return objectArgs({ json: { ...BOOLEAN_ARG, description: "输出 JSON。" } });
}

function hostArgs() {
  return objectArgs({ host: { ...STRING_ARG, description: "Director host URL。" } });
}

function hostJsonArgs() {
  return objectArgs({
    host: { ...STRING_ARG, description: "Director host URL。" },
    json: { ...BOOLEAN_ARG, description: "输出 JSON。" },
  });
}

function selfReflectionArgs() {
  return objectArgs({
    date: { ...STRING_ARG, description: "可选日期，格式 YYYY-MM-DD；不填则使用当天。" },
  });
}

function inputHostArgs() {
  return objectArgs(
    {
      input: { ...STRING_ARG, description: "输入 JSON 文件路径。" },
      host: { ...STRING_ARG, description: "Director host URL。" },
    },
    ["input"],
  );
}

function directorPlanDecisionArgs() {
  return objectArgs({
    decisionActionId: {
      ...STRING_ARG,
      enum: ["accept_and_generate", "accept_mode_model"],
      description: "要接受的总导演决策动作。",
    },
    note: { ...STRING_ARG, description: "人工确认备注。" },
  });
}

function sessionArgs() {
  return objectArgs({ sessionId: { ...STRING_ARG, description: "Session id。" } }, ["sessionId"]);
}

function runIdArgs() {
  return objectArgs(
    {
      runId: { ...STRING_ARG, description: "Run id。" },
      host: { ...STRING_ARG, description: "Director host URL。" },
    },
    ["runId"],
  );
}

function runOutputExperienceArgs() {
  return objectArgs(
    {
      runId: { ...STRING_ARG, description: "Run id。" },
      intent: {
        ...STRING_ARG,
        enum: ["positive-experience", "failure-lesson"],
        description: "沉淀意图。",
      },
      privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
      now: { ...STRING_ARG, format: "date-time" },
    },
    ["runId"],
  );
}

function assignmentArgs() {
  return objectArgs(
    {
      runId: { ...STRING_ARG, description: "Run id。" },
      assignmentId: { ...STRING_ARG, description: "Assignment id。" },
      host: { ...STRING_ARG, description: "Director host URL。" },
    },
    ["runId", "assignmentId"],
  );
}

function proposalIdArgs() {
  return objectArgs({ proposalId: { ...STRING_ARG, description: "Proposal id。" } }, [
    "proposalId",
  ]);
}

function traceProposalExperienceArgs() {
  return objectArgs(
    {
      proposalId: { ...STRING_ARG, description: "Proposal id。" },
      intent: {
        ...STRING_ARG,
        enum: ["positive-experience", "failure-lesson"],
        description: "沉淀意图。",
      },
      privacy: { ...STRING_ARG, enum: ["public", "internal", "confidential"] },
      now: { ...STRING_ARG, format: "date-time" },
    },
    ["proposalId"],
  );
}

function proposalReviewArgs() {
  return objectArgs(
    {
      proposalId: { ...STRING_ARG, description: "Proposal id。" },
      author: { ...STRING_ARG, description: "操作者。" },
      note: { ...STRING_ARG, description: "说明。" },
    },
    ["proposalId"],
  );
}

function taskProposalArgs() {
  return objectArgs(
    {
      sessionId: { ...STRING_ARG, description: "Session id。" },
      proposalId: { ...STRING_ARG, description: "Proposal id。" },
      note: { ...STRING_ARG, description: "说明。" },
    },
    ["sessionId", "proposalId"],
  );
}

function taskProposalArgMap(command) {
  return {
    sessionId: { position: "positional" },
    proposalId: { flag: "--proposal-id" },
    note:
      command === "proposal-accept" || command === "proposal-reject"
        ? { flag: "--decision-note" }
        : {},
  };
}

function packIdArgs() {
  return objectArgs({ packId: { ...STRING_ARG, description: "知识包 id。" } }, ["packId"]);
}

function candidateReviewArgs() {
  return objectArgs(
    {
      candidateId: { ...STRING_ARG, description: "经验候选 id。" },
      note: { ...STRING_ARG, description: "说明。" },
      now: { ...STRING_ARG, format: "date-time" },
    },
    ["candidateId"],
  );
}

function experienceTaxonomyArgs() {
  return objectArgs(
    {
      candidateId: { ...STRING_ARG, description: "经验候选 id。" },
      categoryId: { ...STRING_ARG, description: "分类 id，例如 director-shot。" },
      tagIds: { ...STRING_LIST_ARG, description: "标签 id，逗号分隔也可以。" },
      note: { ...STRING_ARG, description: "说明。" },
    },
    ["candidateId"],
  );
}

function skillTaxonomyArgs() {
  return objectArgs(
    {
      skillId: { ...STRING_ARG, description: "Approved Skill id。" },
      categoryId: { ...STRING_ARG, description: "分类 id。" },
      tagIds: { ...STRING_LIST_ARG, description: "标签 id，逗号分隔也可以。" },
      note: { ...STRING_ARG, description: "说明。" },
    },
    ["skillId"],
  );
}

function taxonomyCategoryArgs() {
  return objectArgs(
    {
      categoryId: { ...STRING_ARG, description: "分类 id；不填则按名称生成。" },
      name: { ...STRING_ARG, description: "分类名称。" },
      description: { ...STRING_ARG, description: "说明。" },
      parentId: { ...STRING_ARG, description: "父分类 id。" },
      color: { ...STRING_ARG, description: "颜色标记。" },
    },
    ["name"],
  );
}

function taxonomyTagArgs() {
  return objectArgs(
    {
      tagId: { ...STRING_ARG, description: "标签 id；不填则按名称生成。" },
      name: { ...STRING_ARG, description: "标签名称。" },
      description: { ...STRING_ARG, description: "说明。" },
      color: { ...STRING_ARG, description: "颜色标记。" },
    },
    ["name"],
  );
}

function packReviewArgs() {
  return objectArgs(
    {
      packId: { ...STRING_ARG, description: "知识候选 id。" },
      author: { ...STRING_ARG, description: "操作者。" },
      note: { ...STRING_ARG, description: "说明。" },
      now: { ...STRING_ARG, format: "date-time" },
    },
    ["packId"],
  );
}

function recallArgs() {
  return objectArgs({
    projectId: { ...STRING_ARG, description: "Project id。" },
    groupId: { ...STRING_ARG, description: "Group id。" },
    anchorId: { ...STRING_ARG, description: "Anchor id。" },
    adapterId: { ...STRING_ARG, description: "Adapter id。" },
    generationType: { ...STRING_ARG, description: "Generation type。" },
    generationStyle: { ...STRING_ARG, description: "Generation style。" },
    tags: { ...STRING_LIST_ARG, description: "标签，逗号分隔也可以。" },
    maxHits: { ...INTEGER_ARG, description: "最大命中数。" },
    maxChars: { ...INTEGER_ARG, description: "最大字符数。" },
  });
}

function memoryPublicationListArgs() {
  return objectArgs({
    status: {
      ...STRING_ARG,
      enum: ["published", "retracted", "demoted", "quarantined"],
      description: "治理状态。",
    },
    limit: { ...INTEGER_ARG, description: "数量限制。" },
  });
}

function memoryPublicationGovernanceArgs() {
  return objectArgs(
    {
      recordId: { ...STRING_ARG, description: "运行记忆 record id。" },
      note: { ...STRING_ARG, description: "治理说明。" },
      now: { ...STRING_ARG, format: "date-time" },
    },
    ["recordId"],
  );
}

function evidenceListArgs() {
  return objectArgs({
    sessionKey: { ...STRING_ARG, description: "会话 key。" },
    runId: { ...STRING_ARG, description: "Run id。" },
    taskId: { ...STRING_ARG, description: "Task id。" },
    sourceRef: { ...STRING_ARG, description: "来源引用。" },
    sourceSnapshotId: { ...STRING_ARG, description: "来源快照 id。" },
    limit: { ...INTEGER_ARG, description: "数量限制。" },
  });
}

function evidenceIdArgs() {
  return objectArgs(
    {
      evidenceId: { ...STRING_ARG, description: "Evidence id。" },
    },
    ["evidenceId"],
  );
}

function evidenceContentArgs() {
  return objectArgs(
    {
      evidenceId: { ...STRING_ARG, description: "Evidence id。" },
      maxChars: { ...INTEGER_ARG, description: "最大字符数。" },
    },
    ["evidenceId"],
  );
}

function maintenanceArgs() {
  return objectArgs({
    nowMs: { ...INTEGER_ARG, description: "维护时间戳；测试或回放时使用。" },
    logRetentionDays: { ...INTEGER_ARG, description: "旧日志归档天数。" },
    logMaxBytes: { ...INTEGER_ARG, description: "单个日志超过此字节数会归档。" },
    archivePromotedExperienceAfterDays: {
      ...INTEGER_ARG,
      description: "已晋升经验候选保留在活跃区的天数。",
    },
    archiveRejectedExperienceAfterDays: {
      ...INTEGER_ARG,
      description: "已拒绝经验候选保留在活跃区的天数。",
    },
    archiveQuarantineAfterDays: { ...INTEGER_ARG, description: "隔离记录归档天数。" },
    archiveUnreferencedArtifactsAfterDays: {
      ...INTEGER_ARG,
      description: "未被活跃经验引用的源材料归档天数。",
    },
    staleUnreviewedExperienceDays: {
      ...INTEGER_ARG,
      description: "未审低分经验候选的最大活跃天数。",
    },
    staleUnreviewedMinimumScore: {
      ...INTEGER_ARG,
      description: "低于此质量分的长期未审候选会被归档。",
    },
    archiveRejectedKnowledgeAfterDays: {
      ...INTEGER_ARG,
      description: "已拒绝知识候选保留在活跃区的天数。",
    },
    staleUnreviewedKnowledgeDays: {
      ...INTEGER_ARG,
      description: "长期未审知识候选的最大活跃天数。",
    },
    archiveOrphanKnowledgeReviewsAfterDays: {
      ...INTEGER_ARG,
      description: "无活跃候选的知识审查记录归档天数。",
    },
    knowledgeHistoryRetentionVersions: {
      ...INTEGER_ARG,
      description: "每个知识包保留的历史版本数。",
    },
    archiveKnowledgeRollbackAfterDays: {
      ...INTEGER_ARG,
      description: "知识回滚审计记录归档天数。",
    },
  });
}

function normalizeArgs(command, inputArgs) {
  const output = {};
  const properties = command.args?.properties ?? {};
  for (const [key, schema] of Object.entries(properties)) {
    const value = inputArgs[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    if (schema.type === "array") {
      output[key] = Array.isArray(value)
        ? value.map(String).filter(Boolean)
        : String(value)
            .split(/[,\n]/u)
            .map((item) => item.trim())
            .filter(Boolean);
      continue;
    }
    if (schema.type === "integer") {
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isNaN(parsed)) {
        output[key] = parsed;
      }
      continue;
    }
    if (schema.type === "boolean") {
      output[key] = value === true || value === "true" || value === "1" || value === "on";
      continue;
    }
    output[key] = String(value);
  }
  for (const key of command.args?.required ?? []) {
    if (output[key] === undefined || output[key] === null || output[key] === "") {
      throw new Error(`Command ${command.id} requires ${key}.`);
    }
  }
  return output;
}

function flattenCommands(catalog) {
  return catalog.flatMap((groupEntry) => groupEntry.commands);
}

function cloneCatalog(catalog) {
  return catalog.map((groupEntry) => ({
    ...groupEntry,
    commands: groupEntry.commands.map((command) => ({
      ...command,
      args: clonePlain(command.args),
      handler: clonePlain(command.handler),
    })),
  }));
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function runCommandLabel(command) {
  const labels = {
    status: "Run 状态",
    start: "启动 run",
    pause: "暂停 run",
    resume: "恢复 run",
    abort: "中止 run",
    report: "Run 报告",
    explain: "解释 run",
    audit: "Run 审计",
  };
  return labels[command] ?? command;
}

function traceProposalLabel(command) {
  const labels = {
    explain: "解释提案",
    review: "审查提案",
    preview: "预览提案",
    replay: "回放提案",
    accept: "接受提案",
    reject: "拒绝提案",
  };
  return labels[command] ?? command;
}

function adapterLabel(command) {
  const labels = {
    enable: "启用 adapter",
    disable: "禁用 adapter",
    explain: "解释 adapter",
  };
  return labels[command] ?? command;
}
