import { parseChannelSlashCommand } from "./channel-command-registry.js";
import {
  evaluateProductionContentSafety,
  extractFirstLearningAdmissionUrl,
  isAgentCapabilityQuestion,
  isChannelSearchFollowup,
  isExplicitLearningAdmissionPrompt,
  isExplicitLearningPersistencePrompt,
  isLowAdmissionText,
  isLowValueChannelChitchat,
  looksLikeNaturalLearningSearchQuery,
  parseChannelActiveSessionIntent,
  parseExplicitProductionObjective,
  parseNaturalDirectorProductionObjective,
  resolveChannelCapabilityRoute,
} from "./conversation-intent.js";
import type { ChannelContentSafetyMode } from "./conversation-intent.js";
import {
  type ConversationTurnCapabilityRouteDecision,
  type ConversationTurnInput,
  type ConversationTurnIntent,
  type ConversationTurnMemoryDecision,
  type ConversationTurnResponsePolicy,
  type ConversationTurnResult,
  type ConversationTurnTraceEvent,
  mapCommandMemoryPolicy,
  mapCommandOutputPolicy,
} from "./conversation-turn-types.js";

export function orchestrateConversationTurn(input: ConversationTurnInput): ConversationTurnResult {
  const text = input.text.trim();
  const capabilityRoute = resolveChannelCapabilityRoute(text, {
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    ...(input.textModelCapabilities === undefined
      ? {}
      : { textModelCapabilities: input.textModelCapabilities }),
  });
  const trace: ConversationTurnTraceEvent[] = [
    {
      stage: "input-normalized",
      detail: "已标准化当前渠道消息。",
      metadata: {
        surface: input.surface,
        channel: input.channel,
        hasActiveSession: Boolean(input.activeSession?.hasActiveSession),
        ...angelRoleTraceMetadata(input),
      },
    },
    {
      stage: "capability-route-decided",
      detail: capabilityRoute.reason,
      metadata: {
        capabilityRoute,
      },
    },
  ];

  if (text.length === 0) {
    return buildResult({
      intent: { kind: "ignore" },
      responsePolicy: "silent",
      userText: "",
      trace,
      memoryDecision: {
        action: "never-store",
        reason: "空消息不进入记忆、经验或任务链路。",
      },
      capabilityRoute,
      shouldInvokeRecall: false,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  const command = parseChannelSlashCommand(text);
  if (command !== null) {
    trace.push({
      stage: "slash-command-detected",
      detail: "命中统一命令注册表。",
      metadata: {
        commandId: command.commandId,
        outputPolicy: command.outputPolicy,
        memoryPolicy: command.memoryPolicy,
        activeSessionPolicy: command.activeSessionPolicy,
      },
    });
  }

  if (command === null && isSharedLearningConfirmationPrompt(text)) {
    return buildResult({
      intent: {
        kind: "learning-confirmation",
        ...mergeIntentMetadata(input),
      },
      responsePolicy: "result-first",
      userText:
        "用户可能在确认当前待保存学习候选；实际确认、过期和候选选择必须由共享 runtime store 裁决。",
      trace: traceWithIntent(trace, "学习候选确认进入共享 runtime，不绑定活跃制作任务。"),
      memoryDecision: {
        action: "transient",
        reason: "学习确认只进入共享 runtime，不在渠道层写入长期记忆。",
      },
      capabilityRoute,
      shouldInvokeRecall: false,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  const activeIntent =
    input.activeSession?.hasActiveSession === true && shouldParseActiveSessionIntent(command)
      ? parseChannelActiveSessionIntent(text)
      : null;
  if (activeIntent !== null && activeIntent.kind !== "none") {
    trace.push({
      stage: "active-session-intent-detected",
      detail: "当前消息被识别为活跃任务的确认、补充或控制指令。",
      metadata: { activeIntent },
    });
  }

  if (activeIntent?.kind === "confirm-current") {
    const objective = mergeActiveObjective(input.activeSession?.objective, activeIntent.supplement);
    const safety = evaluateProductionContentSafety(objective, contentSafetyOptions(input));
    trace.push({
      stage: "safety-evaluated",
      detail: "已对确认后的制作目标进行内容边界检查。",
      metadata: { verdict: safety.verdict, ruleId: safety.ruleId },
    });
    if (safety.verdict === "rewrite-required") {
      return buildSafetyRewriteResult({
        trace,
        objective,
        capabilityRoute,
        ...(safety.reason ? { reason: safety.reason } : {}),
        ...(safety.safeRewriteObjective
          ? { safeRewriteObjective: safety.safeRewriteObjective }
          : {}),
        ...(safety.ruleId ? { ruleId: safety.ruleId } : {}),
      });
    }

    return buildResult({
      intent: {
        kind: "production-confirm",
        objective,
        ...(activeIntent.supplement ? { supplement: activeIntent.supplement } : {}),
        safety: { verdict: "allow" },
      },
      responsePolicy: "control-reply",
      userText:
        activeIntent.supplement === undefined
          ? "已确认，我会继续推进上一条制作任务。"
          : `已确认，我会把补充内容并入上一条制作任务：${activeIntent.supplement}`,
      trace: traceWithIntent(trace, "确认不会创建新任务，会绑定上一条活跃制作任务。"),
      memoryDecision: {
        action: "transient",
        reason: "确认/补充只影响当前任务上下文，不直接进入长期记忆。",
      },
      capabilityRoute,
      shouldInvokeRecall: true,
      shouldCreateRun: false,
      shouldAttachToActiveSession: true,
    });
  }

  if (activeIntent?.kind === "supplement-current") {
    return buildResult({
      intent: {
        kind: "production-supplement",
        supplement: activeIntent.supplement,
        ...(input.activeSession?.objective ? { objective: input.activeSession.objective } : {}),
      },
      responsePolicy: "control-reply",
      userText: `我会把这句补进上一条制作任务：${activeIntent.supplement}`,
      trace: traceWithIntent(trace, "补充内容绑定当前活跃任务，不创建新制作任务。"),
      memoryDecision: {
        action: "transient",
        reason: "补充内容属于当前任务上下文，不直接沉淀为经验。",
      },
      capabilityRoute,
      shouldInvokeRecall: true,
      shouldCreateRun: false,
      shouldAttachToActiveSession: true,
    });
  }

  if (
    activeIntent?.kind === "status-current" ||
    activeIntent?.kind === "interrupt-current" ||
    activeIntent?.kind === "queue-next"
  ) {
    const commandIntent = command ?? {
      commandId: activeIntent.commandId,
      canonicalName: activeIntent.commandId,
      matchedName: activeIntent.commandId,
      args: activeIntent.args,
      outputPolicy: "control-reply" as const,
      memoryPolicy: "transient" as const,
      activeSessionPolicy:
        activeIntent.kind === "status-current"
          ? ("status-only" as const)
          : activeIntent.kind === "interrupt-current"
            ? ("interrupt-current" as const)
            : ("queue-next" as const),
    };
    return buildCommandResult({
      command: commandIntent,
      trace,
      input,
      kind: "run-control",
      userText: buildCommandUserText(commandIntent.commandId, commandIntent.args),
      shouldInvokeRecall: false,
      shouldCreateRun: false,
      shouldAttachToActiveSession: true,
    });
  }

  if (command !== null) {
    if (command.commandId === "production.start") {
      return buildProductionStartResult({
        objective: command.args,
        command,
        trace,
        input,
      });
    }
    if (command.commandId === "learning.admit" || command.commandId.startsWith("learning.")) {
      return buildCommandResult({
        command,
        trace,
        input,
        kind: "learning-admit",
        userText: "我会先整理成待审经验候选，审核通过后才会进入经验库。",
        shouldInvokeRecall: false,
        shouldCreateRun: false,
        shouldAttachToActiveSession: false,
      });
    }
    if (command.commandId === "media.comfyui.run") {
      return buildCommandResult({
        command,
        trace,
        input,
        kind: "comfyui-run",
        userText: "我会先由 Angel 生成内容、场景和参数，再交给 ComfyUI 工作流执行。",
        shouldInvokeRecall: true,
        shouldCreateRun: false,
        shouldAttachToActiveSession: false,
      });
    }

    return buildCommandResult({
      command,
      trace,
      input,
      kind: command.commandId.startsWith("run.") ? "run-control" : "management-command",
      userText: buildCommandUserText(command.commandId, command.args),
      shouldInvokeRecall: false,
      shouldCreateRun: false,
      shouldAttachToActiveSession:
        input.activeSession?.hasActiveSession === true && command.commandId.startsWith("run."),
    });
  }

  const explicitObjective = parseExplicitProductionObjective(text);
  const naturalObjective = explicitObjective ?? parseNaturalDirectorProductionObjective(text);
  if (naturalObjective !== null) {
    return buildProductionStartResult({
      objective: naturalObjective,
      command: undefined,
      trace,
      input,
    });
  }

  const directReadUrl = extractFirstLearningAdmissionUrl(text);

  if (directReadUrl !== null && looksLikeExplicitUrlLearningRequest(text)) {
    return buildResult({
      intent: {
        kind: "learning-admit",
        objective: text,
        ...mergeIntentMetadata(input, {
          sourceKind: "url",
          url: directReadUrl,
          directReadPreferred: true,
        }),
      },
      responsePolicy: "review-gated",
      userText: "我会读取这个链接并整理成待审经验候选，先审后收录。",
      trace: traceWithIntent(trace, "明确 URL 学习请求进入待审经验候选链路。"),
      memoryDecision: {
        action: "candidate-review",
        reason: "明确 URL 学习请求只能进入待审候选，不直接写成经验。",
      },
      capabilityRoute,
      shouldInvokeRecall: false,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  if (
    isExplicitLearningAdmissionPrompt(text) &&
    isExplicitLearningPersistencePrompt(text) &&
    !looksLikeNaturalLearningSearchQuery(text)
  ) {
    return buildResult({
      intent: {
        kind: "learning-admit",
        objective: text,
        ...mergeIntentMetadata(input, {
          ...(directReadUrl === null
            ? {}
            : {
                sourceKind: "url",
                url: directReadUrl,
                directReadPreferred: true,
              }),
        }),
      },
      responsePolicy: "review-gated",
      userText: "我会把这份资料整理成待审经验候选，先审后收录。",
      trace: traceWithIntent(trace, "自然语言学习入口进入待审经验候选链路。"),
      memoryDecision: {
        action: "candidate-review",
        reason: "明确学习请求只能进入待审候选，不直接写成经验。",
      },
      capabilityRoute,
      shouldInvokeRecall: false,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  if (directReadUrl !== null && !isExplicitLearningPersistencePrompt(text)) {
    return buildResult({
      intent: {
        kind: "chat",
        ...mergeIntentMetadata(input, {
          directReadPreferred: true,
          sourceKind: "url",
          url: directReadUrl,
        }),
      },
      responsePolicy: "result-first",
      userText: "用户要我读取或理解资料并直接给结果，不应先生成经验候选。",
      trace: traceWithIntent(trace, "自然语言资料读取请求进入工具化普通对话链路。"),
      memoryDecision: {
        action: "candidate-review",
        reason: "资料读取结果可被后续筛选为候选，但本轮不直接创建经验候选。",
      },
      capabilityRoute,
      shouldInvokeRecall: true,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  if (looksLikeNaturalLearningSearchQuery(text)) {
    return buildResult({
      intent: { kind: "chat" },
      responsePolicy: "result-first",
      userText: "用户希望我搜索/学习外部资料，应通过可用学习工具处理，而不是只口头回答。",
      trace: traceWithIntent(trace, "自然语言外部搜索/学习请求进入工具化普通对话链路。"),
      memoryDecision: {
        action: "candidate-review",
        reason: "外部学习请求只能生成待审候选，不直接写入经验或长期记忆。",
      },
      capabilityRoute,
      shouldInvokeRecall: true,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  if (isChannelSearchFollowup(text)) {
    return buildResult({
      intent: { kind: "chat" },
      responsePolicy: "result-first",
      userText: "用户正在延续上一轮搜索/查找任务，应结合近期上下文进入工具化普通对话链路。",
      trace: traceWithIntent(trace, "搜索类追问不绑定活跃制作任务，进入工具化普通对话链路。"),
      memoryDecision: {
        action: "transient",
        reason: "搜索追问只影响当前会话上下文，不直接写入长期记忆。",
      },
      capabilityRoute,
      shouldInvokeRecall: true,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  if (isAgentCapabilityQuestion(text)) {
    return buildResult({
      intent: { kind: "capability-intro" },
      responsePolicy: "control-reply",
      userText: buildCapabilityIntroText(input.surface),
      trace: traceWithIntent(
        trace,
        "身份/能力询问进入动态能力说明链路，需要召回真实能力上下文，但不写记忆。",
      ),
      memoryDecision: {
        action: "never-store",
        reason: "身份/能力说明是产品引导，不进入长期记忆或经验候选。",
      },
      capabilityRoute,
      shouldInvokeRecall: true,
      shouldCreateRun: false,
      shouldAttachToActiveSession: false,
    });
  }

  const lowAdmission = isLowAdmissionText(text) || isLowValueChannelChitchat(text);
  const memoryDecision: ConversationTurnMemoryDecision = lowAdmission
    ? {
        action: "never-store",
        reason: "低信号闲聊或临时表达不进入长期记忆和经验候选。",
      }
    : {
        action: "transient",
        reason: "普通对话默认只保留在会话上下文，是否沉淀需另走筛选层。",
      };
  trace.push({
    stage: "memory-admission-decided",
    detail: memoryDecision.reason,
    metadata: { action: memoryDecision.action },
  });

  return buildResult({
    intent: { kind: "chat" },
    responsePolicy: "result-first",
    userText: "",
    trace: traceWithIntent(trace, "未命中任务/学习/工具命令，进入普通对话链路。"),
    memoryDecision,
    capabilityRoute,
    shouldInvokeRecall: !lowAdmission,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
  });
}

function isSharedLearningConfirmationPrompt(text: string): boolean {
  if (extractFirstLearningAdmissionUrl(text) !== null) {
    return false;
  }
  if (looksLikeLearningConfirmationQuestion(text)) {
    return false;
  }
  if (
    /(?:不要|别|先别|暂时别|不必|不用|无需|禁止|不许).{0,16}(?:存|保存|收录|接受|通过|入库|当经验|放进经验)/u.test(
      text,
    )
  ) {
    return false;
  }
  if (/第\s*(?:[1-9]\d*|[一二两三四五六七八九十])\s*(?:条|个|项|篇|则)?/u.test(text)) {
    return /(?:保存|存起来|收录|入库|纳入|归档|记下来|记住|保留|留下|接受|通过|批准|确认)/u.test(
      text,
    );
  }
  if (!hasLearningConfirmationAction(text) || !hasLearningConfirmationReference(text)) {
    return false;
  }
  return !looksLikeNaturalLearningSearchQuery(text) || hasPriorLearningConfirmationReference(text);
}

function hasLearningConfirmationReference(text: string): boolean {
  return /(?:刚才|上一轮|上次|前面|上面|这次|最近|学到|学了|候选|经验|知识|经验库|知识库|第\s*(?:[1-9]\d*|[一二两三四五六七八九十])\s*(?:条|个|项|篇|则)?|那条|这条|这篇|待保存)/u.test(
    text,
  );
}

function hasPriorLearningConfirmationReference(text: string): boolean {
  return /(?:刚才|上一轮|上次|前面|上面|这次|最近|学到|学了|候选|经验|知识|第\s*(?:[1-9]\d*|[一二两三四五六七八九十])\s*(?:条|个|项|篇|则)?|那条|这条|这篇|待保存)/u.test(
    text,
  );
}

function hasLearningConfirmationAction(text: string): boolean {
  return /(?:保存|收录|入库|归档|记下来|记住|保留|留下|接受|通过|批准|确认|沉淀|写入|放进|存到|存入|存起来|要收录)/u.test(
    text,
  );
}

function looksLikeExplicitUrlLearningRequest(text: string): boolean {
  if (extractFirstLearningAdmissionUrl(text) === null) {
    return false;
  }
  return /(?:^|[，,。；;\s])(?:学习|学一下|吸收|研究|提炼|沉淀|收录|保存)(?:这个|这条|这篇|一下|链接|资料)?\s*https?:\/\//iu.test(
    text,
  );
}

function looksLikeLearningConfirmationQuestion(text: string): boolean {
  return (
    /[?？]/u.test(text) ||
    /(?:吗|么)$/u.test(text) ||
    /(?:如果|假如|要是|为什么|为何|怎么|如何|能不能|能否|可不可以|可以不可以|可否|是不是|是否|哪些|哪里|什么|有用吗|值得吗|要不要|该不该|有没有必要)/u.test(
      text,
    )
  );
}

function buildCapabilityIntroText(surface: ConversationTurnInput["surface"]): string {
  const prefix =
    surface === "weixin"
      ? "我是 Director Angel。"
      : "我是 Director Angel，负责把你的想法推进成可执行的制作结果。";
  return [
    prefix,
    "我能做四类事：",
    "1. 制作：把一句目标变成脚本、分镜、文案、图片/视频工作流草案，并在运行与审查里跟踪。",
    "2. 学习：从链接、文件、目录或主题里提炼经验候选，审核后发布成可被后续任务召回的知识。",
    "3. 调用能力：按任务自动召回已发布经验和已启用 Skill，也能调用外部工具，例如 ComfyUI。",
    "4. 管理：查看运行、审查候选、维护记忆、检查设置和微信网关状态。",
    "你直接说结果就行，比如：/制作 生成一个15秒短剧分镜蓝图，或 /学习 一个链接。",
  ].join("\n");
}

function buildProductionStartResult(params: {
  readonly objective: string;
  readonly command: ReturnType<typeof parseChannelSlashCommand> | undefined;
  readonly trace: ConversationTurnTraceEvent[];
  readonly input: ConversationTurnInput;
}): ConversationTurnResult {
  const { objective, command, trace, input } = params;
  const capabilityRoute = resolveCapabilityRouteFromInput(input);
  const safety = evaluateProductionContentSafety(objective, contentSafetyOptions(input));
  trace.push({
    stage: "safety-evaluated",
    detail: "已对制作目标进行内容边界检查。",
    metadata: { verdict: safety.verdict, ruleId: safety.ruleId },
  });
  if (safety.verdict === "rewrite-required") {
    return buildSafetyRewriteResult({
      trace,
      objective,
      ...(command ? { command } : {}),
      capabilityRoute,
      ...(safety.reason ? { reason: safety.reason } : {}),
      ...(safety.safeRewriteObjective ? { safeRewriteObjective: safety.safeRewriteObjective } : {}),
      ...(safety.ruleId ? { ruleId: safety.ruleId } : {}),
    });
  }

  return buildResult({
    intent: {
      kind: "production-start",
      objective,
      ...(command ? { command } : {}),
      safety: { verdict: "allow" },
      ...mergeIntentMetadata(input),
    },
    responsePolicy: command ? mapCommandOutputPolicy(command.outputPolicy) : "result-first",
    userText: `我会按这个目标制作：${objective}`,
    trace: traceWithIntent(trace, "制作任务进入统一生产链路，后续自动召回经验、Skill 和记忆。"),
    memoryDecision: command
      ? mapCommandMemoryPolicy(command.memoryPolicy)
      : {
          action: "store-result-only",
          reason: "自然语言制作任务只允许保存执行结果摘要，不保存原始闲聊。",
        },
    shouldInvokeRecall: true,
    shouldCreateRun: true,
    shouldAttachToActiveSession: false,
    capabilityRoute,
  });
}

function buildCommandResult(params: {
  readonly command: NonNullable<ReturnType<typeof parseChannelSlashCommand>>;
  readonly trace: ConversationTurnTraceEvent[];
  readonly input: ConversationTurnInput;
  readonly kind: ConversationTurnIntent["kind"];
  readonly userText: string;
  readonly shouldInvokeRecall: boolean;
  readonly shouldCreateRun: boolean;
  readonly shouldAttachToActiveSession: boolean;
}): ConversationTurnResult {
  const { command, trace, kind, userText, shouldInvokeRecall, shouldCreateRun } = params;
  const capabilityRoute = resolveCapabilityRouteFromInput(params.input);
  return buildResult({
    intent: {
      kind,
      objective: command.args,
      command,
      ...mergeIntentMetadata(params.input),
    },
    responsePolicy: mapCommandOutputPolicy(command.outputPolicy),
    userText,
    trace: traceWithIntent(trace, `命令 ${command.commandId} 已进入统一命令链路。`),
    memoryDecision: mapCommandMemoryPolicy(command.memoryPolicy),
    shouldInvokeRecall,
    shouldCreateRun,
    shouldAttachToActiveSession: params.shouldAttachToActiveSession,
    capabilityRoute,
  });
}

function buildSafetyRewriteResult(params: {
  readonly trace: ConversationTurnTraceEvent[];
  readonly objective: string;
  readonly command?: NonNullable<ReturnType<typeof parseChannelSlashCommand>>;
  readonly capabilityRoute?: ConversationTurnCapabilityRouteDecision;
  readonly reason?: string;
  readonly safeRewriteObjective?: string;
  readonly ruleId?: string;
}): ConversationTurnResult {
  const safeRewriteObjective =
    params.safeRewriteObjective ?? "请改成批判、救助、追责和受害者主体性的方向。";
  return buildResult({
    intent: {
      kind: "production-start",
      objective: params.objective,
      ...(params.command ? { command: params.command } : {}),
      safety: {
        verdict: "rewrite-required",
        safeRewriteObjective,
        ...(params.reason ? { reason: params.reason } : {}),
        ...(params.ruleId ? { ruleId: params.ruleId } : {}),
      },
    },
    responsePolicy: "result-first",
    userText: `这个方向不能按美化处理。可以改成：${safeRewriteObjective}`,
    trace: traceWithIntent(params.trace, "内容边界要求改写，未创建制作任务。"),
    memoryDecision: {
      action: "never-store",
      reason: "被安全边界拦下的原始目标不进入经验或长期记忆。",
    },
    shouldInvokeRecall: false,
    shouldCreateRun: false,
    shouldAttachToActiveSession: false,
    ...(params.capabilityRoute === undefined ? {} : { capabilityRoute: params.capabilityRoute }),
  });
}

function buildResult(params: {
  readonly intent: ConversationTurnIntent;
  readonly responsePolicy: ConversationTurnResponsePolicy;
  readonly userText: string;
  readonly trace: readonly ConversationTurnTraceEvent[];
  readonly memoryDecision: ConversationTurnMemoryDecision;
  readonly shouldInvokeRecall: boolean;
  readonly shouldCreateRun: boolean;
  readonly shouldAttachToActiveSession: boolean;
  readonly capabilityRoute?: ConversationTurnCapabilityRouteDecision;
}): ConversationTurnResult {
  const capabilityRoute =
    params.capabilityRoute ?? readCapabilityRouteFromIntent(params.intent) ?? undefined;
  return {
    intent:
      capabilityRoute === undefined
        ? params.intent
        : {
            ...params.intent,
            metadata: {
              ...(params.intent.metadata ?? {}),
              capabilityRoute,
            },
          },
    responsePolicy: params.responsePolicy,
    audience: "user",
    userText: params.userText,
    operatorTrace: params.trace,
    memoryDecision: params.memoryDecision,
    ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
    shouldInvokeRecall: params.shouldInvokeRecall,
    shouldCreateRun: params.shouldCreateRun,
    shouldAttachToActiveSession: params.shouldAttachToActiveSession,
  };
}

function traceWithIntent(
  trace: ConversationTurnTraceEvent[],
  detail: string,
): readonly ConversationTurnTraceEvent[] {
  return [
    ...trace,
    {
      stage: "intent-decided",
      detail,
    },
  ];
}

function mergeActiveObjective(
  objective: string | undefined,
  supplement: string | undefined,
): string {
  if (!supplement) {
    return objective ?? "";
  }
  if (!objective) {
    return supplement;
  }
  return `${objective}\n补充内容：${supplement}`;
}

function shouldParseActiveSessionIntent(
  command: ReturnType<typeof parseChannelSlashCommand>,
): boolean {
  return (
    command === null ||
    command.commandId.startsWith("run.") ||
    command.commandId === "production.start"
  );
}

function buildCommandUserText(commandId: string, args: string): string {
  const suffix = args.trim().length > 0 ? `：${args.trim()}` : "";
  if (commandId.startsWith("run.")) {
    return `我会处理这个运行指令${suffix}`;
  }
  if (commandId.startsWith("experience.")) {
    return `我会处理这个经验库指令${suffix}`;
  }
  if (commandId.startsWith("knowledge.")) {
    return `我会处理这个知识库指令${suffix}`;
  }
  if (commandId.startsWith("skills.")) {
    return `我会处理这个 Skill 指令${suffix}`;
  }
  if (commandId.startsWith("tools.")) {
    return `我会处理这个外部工具指令${suffix}`;
  }
  return `我会处理这个指令${suffix}`;
}

function contentSafetyOptions(input: ConversationTurnInput): {
  readonly mode?: ChannelContentSafetyMode;
} {
  return input.contentSafetyMode === undefined ? {} : { mode: input.contentSafetyMode };
}

function mergeIntentMetadata(
  input: ConversationTurnInput,
  metadata: Readonly<Record<string, unknown>> = {},
): Pick<ConversationTurnIntent, "metadata"> {
  const merged = {
    ...metadata,
    ...angelRoleTraceMetadata(input),
  };
  return Object.keys(merged).length === 0 ? {} : { metadata: merged };
}

function angelRoleTraceMetadata(input: ConversationTurnInput): Readonly<Record<string, unknown>> {
  return input.angelRoleProfile === undefined ? {} : { angelRoleProfile: input.angelRoleProfile };
}

function resolveCapabilityRouteFromInput(
  input: ConversationTurnInput,
): ConversationTurnCapabilityRouteDecision {
  return resolveChannelCapabilityRoute(input.text, {
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    ...(input.textModelCapabilities === undefined
      ? {}
      : { textModelCapabilities: input.textModelCapabilities }),
  });
}

function readCapabilityRouteFromIntent(
  intent: ConversationTurnIntent,
): ConversationTurnCapabilityRouteDecision | undefined {
  const route = intent.metadata?.capabilityRoute;
  if (!isRecord(route)) {
    return undefined;
  }
  if (
    route.abilityGroup === "text" ||
    route.abilityGroup === "vision" ||
    route.abilityGroup === "image_generation" ||
    route.abilityGroup === "video_generation"
  ) {
    return route as unknown as ConversationTurnCapabilityRouteDecision;
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
