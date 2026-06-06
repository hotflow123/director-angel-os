import type {
  ConversationRuntimeModelToolCall,
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeModelToolMessage,
} from "./model-tool-loop.js";

export interface ConversationRuntimeSourceCapability {
  readonly id: string;
  readonly label: string;
  readonly toolName: string;
  readonly toolCapability?: string;
  readonly provider?: string;
  readonly sourceType?: string;
  readonly userIntentHints: readonly string[];
  readonly modelGuidance: string;
  readonly match: (input: ConversationRuntimeSourceMatchInput) => string | null;
  readonly buildCall: (
    input: ConversationRuntimeSourceBuildCallInput,
  ) => ConversationRuntimeModelToolCall;
  readonly fallbackCalls?: (
    input: ConversationRuntimeSourceBuildCallInput,
  ) => readonly ConversationRuntimeSourceFallbackCall[];
  readonly fallbackPolicy?: "when-primary-unavailable" | "always";
}

export interface ConversationRuntimeSourceFallbackCall {
  readonly toolName: string;
  readonly toolCapability?: string;
  readonly buildCall: (
    input: ConversationRuntimeSourceBuildCallInput,
  ) => ConversationRuntimeModelToolCall;
}

export interface ConversationRuntimeSourceMatchInput {
  readonly rawUserText: string;
  readonly conversationContext: ConversationRuntimeToolRoutingConversationContext;
  readonly runtimeContext: ConversationRuntimeToolRoutingRuntimeContext;
}

export interface ConversationRuntimeSourceBuildCallInput {
  readonly query: string;
  readonly rawUserText?: string;
  readonly runtimeContext?: RequiredConversationRuntimeToolRoutingRuntimeContext;
}

export interface ConversationRuntimeToolRoutingConversationContext {
  readonly history?: readonly ConversationRuntimeModelToolMessage[];
  readonly recentContextText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeToolRoutingRuntimeContext {
  readonly surface?: string;
  readonly channel?: string;
  readonly sessionKey?: string;
  readonly tools?: readonly ConversationRuntimeModelToolDefinition[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSourceGroundingLegacyInput {
  readonly userText: string;
  readonly history: readonly ConversationRuntimeModelToolMessage[];
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
}

export interface ConversationRuntimeSourceGroundingEnvelopeInput {
  readonly rawUserText: string;
  readonly conversationContext?: ConversationRuntimeToolRoutingConversationContext;
  readonly runtimeContext?: ConversationRuntimeToolRoutingRuntimeContext;
}

export type ConversationRuntimeSourceGroundingInput =
  | ConversationRuntimeSourceGroundingLegacyInput
  | ConversationRuntimeSourceGroundingEnvelopeInput;

interface NormalizedConversationRuntimeSourceGroundingInput {
  readonly rawUserText: string;
  readonly conversationContext: RequiredConversationRuntimeToolRoutingConversationContext;
  readonly runtimeContext: RequiredConversationRuntimeToolRoutingRuntimeContext;
}

interface RequiredConversationRuntimeToolRoutingConversationContext {
  readonly history: readonly ConversationRuntimeModelToolMessage[];
  readonly recentContextText?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface RequiredConversationRuntimeToolRoutingRuntimeContext {
  readonly surface?: string;
  readonly channel?: string;
  readonly sessionKey?: string;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSourceGroundingResolution {
  readonly calls: readonly ConversationRuntimeModelToolCall[];
  readonly matchedCapabilities: readonly ConversationRuntimeSourceCapability[];
}

type SourcePrimaryAvailability = "absent" | "ready" | "available-unknown" | "unavailable";

export type ConversationRuntimeSourceProviderMatrixRole = "primary" | "fallback";

export interface ConversationRuntimeSourceProviderMatrixInput {
  readonly tools?: readonly ConversationRuntimeModelToolDefinition[];
}

export interface ConversationRuntimeSourceProviderMatrixEntry {
  readonly sourceCapabilityId: string;
  readonly label: string;
  readonly role: ConversationRuntimeSourceProviderMatrixRole;
  readonly provider: string;
  readonly sourceType?: string;
  readonly toolName: string;
  readonly toolCapability?: string;
  readonly fallbackForSourceCapabilityId?: string;
  readonly status: SourcePrimaryAvailability;
  readonly health: string;
  readonly timeoutMs?: number;
}

interface ConversationRuntimeSourceProviderMatrixDefinition {
  readonly sourceCapabilityId: string;
  readonly label: string;
  readonly role: ConversationRuntimeSourceProviderMatrixRole;
  readonly provider: string;
  readonly sourceType?: string;
  readonly toolName: string;
  readonly toolCapability?: string;
  readonly fallbackForSourceCapabilityId?: string;
  readonly timeoutMs?: number;
}

type ExplicitUrlSiteStrategyId =
  | "static-readable"
  | "weixin-article"
  | "dynamic-social"
  | "private-local";

interface ExplicitUrlSiteStrategy {
  readonly id: ExplicitUrlSiteStrategyId;
  readonly sourceType: string;
  readonly primary: "extract" | "browser";
  readonly browserFallback: boolean;
  readonly reason: string;
  readonly explicitFullReread?: boolean;
}

interface BrowserSnapshotPlanArgs {
  readonly full: boolean;
  readonly mode: "compact" | "efficient" | "readable" | "interactive" | "full";
  readonly max_chars: number;
  readonly urls: boolean;
  readonly interactive?: boolean;
  readonly compact: boolean;
  readonly refs: boolean;
}

const SOURCE_CAPABILITIES: readonly ConversationRuntimeSourceCapability[] = [
  {
    id: "weixin.article.search",
    label: "微信公众号文章搜索",
    toolName: "web_search",
    toolCapability: "web.search",
    provider: "sogou-weixin",
    sourceType: "weixin_article",
    userIntentHints: ["微信公众号文章", "公众号文章", "微信文章", "搜狗微信"],
    modelGuidance:
      "当用户要求查找微信公众号文章、公众号文章或微信文章时，把它理解为来源意图，优先调用 web_search(provider=sogou-weixin, source_type=weixin_article)。用户不需要说出搜狗或 provider 名。",
    match: (input) => resolveSogouWeixinSearchQuery(input),
    buildCall: ({ query }) => ({
      id: "required-web-search-sogou-weixin",
      name: "web_search",
      args: {
        query,
        provider: "sogou-weixin",
        source_type: "weixin_article",
        reason: "用户要求检索微信公众号文章来源，运行时路由到 Sogou Weixin provider",
        max_results: 5,
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "weixin.article.search",
        provider: "sogou-weixin",
        sourceType: "weixin_article",
      },
    }),
  },
  {
    id: "social.x-twitter.search",
    label: "X/Twitter 搜索",
    toolName: "x_search",
    toolCapability: "x.search",
    provider: "x-twitter",
    sourceType: "social_post",
    userIntentHints: ["X/Twitter", "Twitter", "推特", "x.com"],
    modelGuidance:
      "当用户要求从 X/Twitter、Twitter、推特或 x.com 查找/学习最新内容时，优先调用 x_search；如果 provider 未配置、未授权或不可用，运行时会追加公开网页 fallback，不要停下来反问用户。",
    match: (input) => resolveXTwitterSearchQueryFromHistory(input),
    buildCall: ({ query }) => ({
      id: "required-x-search",
      name: "x_search",
      args: {
        query,
        reason:
          "用户明确要求从 X/Twitter/推特来源继续检索，运行时先调用 X/Twitter search grounding",
        max_results: 5,
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "social.x-twitter.search",
        provider: "x-twitter",
        sourceType: "social_post",
      },
    }),
    fallbackPolicy: "when-primary-unavailable",
    fallbackCalls: ({ query, rawUserText, runtimeContext }) => [
      ...createXTwitterBrowserFallbackCalls({
        query,
        rawUserText: rawUserText ?? "",
        tools: runtimeContext?.tools ?? [],
      }),
      {
        toolName: "web_search",
        toolCapability: "web.search",
        buildCall: () => ({
          id: "required-web-search-x-twitter-fallback",
          name: "web_search",
          args: {
            query: `site:x.com OR site:twitter.com ${query}`,
            provider: "auto",
            source_type: "web",
            reason:
              "X/Twitter 专用 provider 未授权或可能不可用时，运行时同时用公开网页搜索做来源兜底",
            max_results: 5,
          },
          readOnly: true,
          metadata: {
            requiredGrounding: true,
            sourceCapabilityId: "social.x-twitter.search",
            fallbackForSourceCapabilityId: "social.x-twitter.search",
            provider: "auto",
            sourceType: "web",
          },
        }),
      },
    ],
  },
  {
    id: "browser.page.navigate",
    label: "浏览器页面访问",
    toolName: "browser_navigate",
    toolCapability: "browser.navigate",
    provider: "desktop-browser",
    sourceType: "browser_page",
    userIntentHints: ["浏览器", "谷歌浏览器", "Chrome", "打开网页"],
    modelGuidance:
      "当用户明确要求用浏览器、谷歌浏览器或 Chrome 打开一个 URL/网页查看时，运行时会先调用 browser_navigate。不要空口说不能打开浏览器；如果浏览器 provider 不可用，基于工具观察说明真实原因。",
    match: (input) => resolveBrowserNavigateUrlFromHistory(input),
    buildCall: ({ query }) => ({
      id: "required-browser-navigate",
      name: "browser_navigate",
      args: {
        url: query,
        reason: "用户明确要求使用浏览器打开页面查看，运行时路由到 browser_navigate",
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "browser.page.navigate",
        provider: "desktop-browser",
        sourceType: "browser_page",
      },
    }),
  },
];

const SOURCE_PROVIDER_MATRIX_DEFINITIONS: readonly ConversationRuntimeSourceProviderMatrixDefinition[] =
  [
    {
      sourceCapabilityId: "source.explicit-url.extract",
      label: "公开网页正文抽取",
      role: "primary",
      provider: "public-web-extract",
      sourceType: "web_page",
      toolName: "web_extract",
      toolCapability: "web.extract",
      timeoutMs: 45_000,
    },
    {
      sourceCapabilityId: "source.explicit-url.extract",
      label: "浏览器读取兜底",
      role: "fallback",
      provider: "desktop-browser",
      sourceType: "browser_page",
      toolName: "browser_navigate",
      toolCapability: "browser.navigate",
      fallbackForSourceCapabilityId: "source.explicit-url.extract",
      timeoutMs: 60_000,
    },
    {
      sourceCapabilityId: "social.x-twitter.search",
      label: "公开网页搜索兜底",
      role: "fallback",
      provider: "auto",
      sourceType: "web",
      toolName: "web_search",
      toolCapability: "web.search",
      fallbackForSourceCapabilityId: "social.x-twitter.search",
      timeoutMs: 30_000,
    },
    {
      sourceCapabilityId: "source.explicit-url.opencli-twitter-thread",
      label: "OpenCLI X/Twitter 线程读取",
      role: "primary",
      provider: "opencli",
      sourceType: "social_post",
      toolName: "director.opencli.invoke",
      toolCapability: "external-tools.opencli.invoke-read",
      timeoutMs: 45_000,
    },
  ];

export function listConversationRuntimeSourceCapabilities(): readonly ConversationRuntimeSourceCapability[] {
  return SOURCE_CAPABILITIES;
}

export function listConversationRuntimeSourceProviderMatrix(
  input: ConversationRuntimeSourceProviderMatrixInput = {},
): readonly ConversationRuntimeSourceProviderMatrixEntry[] {
  const tools = input.tools ?? [];
  const definitions = dedupeSourceProviderMatrixDefinitions([
    ...SOURCE_CAPABILITIES.map((capability) => ({
      sourceCapabilityId: capability.id,
      label: capability.label,
      role: "primary" as const,
      provider: capability.provider ?? "runtime",
      ...(capability.sourceType === undefined ? {} : { sourceType: capability.sourceType }),
      toolName: capability.toolName,
      ...(capability.toolCapability === undefined
        ? {}
        : { toolCapability: capability.toolCapability }),
    })),
    ...SOURCE_PROVIDER_MATRIX_DEFINITIONS,
  ]);
  return definitions.map((definition) => {
    const tool = findConversationRuntimeTool(tools, definition.toolName, definition.toolCapability);
    const status = resolveConversationRuntimeToolAvailability(
      tools,
      definition.toolName,
      definition.toolCapability,
    );
    const health = readExternalProviderStatus(tool?.metadata) ?? status;
    return {
      sourceCapabilityId: definition.sourceCapabilityId,
      label: definition.label,
      role: definition.role,
      provider: definition.provider,
      ...(definition.sourceType === undefined ? {} : { sourceType: definition.sourceType }),
      toolName: definition.toolName,
      ...(definition.toolCapability === undefined
        ? {}
        : { toolCapability: definition.toolCapability }),
      ...(definition.fallbackForSourceCapabilityId === undefined
        ? {}
        : { fallbackForSourceCapabilityId: definition.fallbackForSourceCapabilityId }),
      status,
      health,
      ...(definition.timeoutMs === undefined ? {} : { timeoutMs: definition.timeoutMs }),
    };
  });
}

function dedupeSourceProviderMatrixDefinitions(
  definitions: readonly ConversationRuntimeSourceProviderMatrixDefinition[],
): readonly ConversationRuntimeSourceProviderMatrixDefinition[] {
  const seen = new Set<string>();
  const deduped: ConversationRuntimeSourceProviderMatrixDefinition[] = [];
  for (const definition of definitions) {
    const key = [
      definition.sourceCapabilityId,
      definition.role,
      definition.provider,
      definition.toolName,
      definition.fallbackForSourceCapabilityId ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(definition);
  }
  return deduped;
}

export function renderConversationRuntimeSourceCapabilityGuidance(
  tools: readonly ConversationRuntimeModelToolDefinition[] = [],
): string {
  const toolNames = new Set(tools.map((tool) => tool.name));
  const lines = SOURCE_CAPABILITIES.map((capability) => {
    const available = toolNames.size === 0 || toolNames.has(capability.toolName);
    return `- ${capability.label}：${available ? "可用" : "当前工具未挂载"}；${capability.modelGuidance}`;
  });
  lines.push(
    "- 明确 URL：用户给出 http/https 链接并要求学习、读取、总结、看看这个链接时，先进入站点策略路由；普通文章直抽、动态网页走浏览器、本机/内网不交给公网提取器，不要把具体链接改成搜索任务。",
    "- 明确浏览器：用户明确要求用浏览器、谷歌浏览器或 Chrome 打开/读取链接时，先用浏览器打开，再抓完整页面快照；不要降级成网页搜索。",
    "- 学习追问：当用户问“你学了什么/学到了什么/总结一下/读取一下”时，先读取上一轮搜索候选来源正文，再回答学到的内容；不要把只搜到候选说成已经学习。",
  );
  return ["来源能力路由（由运行时能力表生成，不由各端各写一套）：", ...lines].join("\n");
}

export function resolveConversationRuntimeSourceGroundingToolCalls(
  input: ConversationRuntimeSourceGroundingInput,
): ConversationRuntimeSourceGroundingResolution {
  const routingInput = normalizeConversationRuntimeSourceGroundingInput(input);
  const explicitOpenCliUrlCall = resolveExplicitOpenCliUrlToolCall(routingInput);
  if (explicitOpenCliUrlCall !== undefined) {
    return {
      calls: [explicitOpenCliUrlCall],
      matchedCapabilities: [],
    };
  }
  const explicitBrowserUrlCalls = resolveExplicitBrowserUrlToolCalls(routingInput);
  if (explicitBrowserUrlCalls.length > 0) {
    return {
      calls: explicitBrowserUrlCalls,
      matchedCapabilities: SOURCE_CAPABILITIES.filter(
        (capability) => capability.id === "browser.page.navigate",
      ),
    };
  }
  const explicitUrlSiteStrategyCalls = resolveExplicitUrlSiteStrategyToolCalls(routingInput);
  if (explicitUrlSiteStrategyCalls.length > 0) {
    return {
      calls: explicitUrlSiteStrategyCalls,
      matchedCapabilities: [],
    };
  }
  const explicitUrlExtractCall = resolveExplicitUrlExtractToolCall(routingInput);
  if (explicitUrlExtractCall !== undefined) {
    return {
      calls: [explicitUrlExtractCall],
      matchedCapabilities: [],
    };
  }
  const calls: ConversationRuntimeModelToolCall[] = [];
  const matchedCapabilities: ConversationRuntimeSourceCapability[] = [];
  for (const capability of SOURCE_CAPABILITIES) {
    const query = capability.match({
      rawUserText: routingInput.rawUserText,
      conversationContext: routingInput.conversationContext,
      runtimeContext: routingInput.runtimeContext,
    });
    if (query === null) {
      continue;
    }
    const primaryAvailability = resolveConversationRuntimeToolAvailability(
      routingInput.runtimeContext.tools,
      capability.toolName,
      capability.toolCapability,
    );
    const primaryAvailable = primaryAvailability !== "absent";
    const fallbackCalls = resolveSourceCapabilityFallbackCalls({
      capability,
      input: routingInput,
      query,
      primaryAvailable,
      primaryAvailability,
    });
    if (!primaryAvailable && fallbackCalls.length === 0) {
      continue;
    }
    matchedCapabilities.push(capability);
    if (primaryAvailable) {
      calls.push(
        capability.buildCall({
          query,
          rawUserText: routingInput.rawUserText,
          runtimeContext: routingInput.runtimeContext,
        }),
      );
    }
    calls.push(...fallbackCalls);
  }

  const learningExtractCall = resolveRequiredLearningExtractToolCall(routingInput);
  if (learningExtractCall !== undefined) {
    calls.push(learningExtractCall);
  }

  return {
    calls,
    matchedCapabilities,
  };
}

function normalizeConversationRuntimeSourceGroundingInput(
  input: ConversationRuntimeSourceGroundingInput,
): NormalizedConversationRuntimeSourceGroundingInput {
  if ("rawUserText" in input) {
    const splitText = splitLegacyRoutingText(input.rawUserText);
    return {
      rawUserText: splitText.rawUserText,
      conversationContext: {
        history: input.conversationContext?.history ?? [],
        ...(input.conversationContext?.recentContextText === undefined &&
        splitText.recentContextText === undefined
          ? {}
          : {
              recentContextText:
                input.conversationContext?.recentContextText ?? splitText.recentContextText,
            }),
        ...(input.conversationContext?.metadata === undefined
          ? {}
          : { metadata: input.conversationContext.metadata }),
      },
      runtimeContext: {
        tools: input.runtimeContext?.tools ?? [],
        ...(input.runtimeContext?.surface === undefined
          ? {}
          : { surface: input.runtimeContext.surface }),
        ...(input.runtimeContext?.channel === undefined
          ? {}
          : { channel: input.runtimeContext.channel }),
        ...(input.runtimeContext?.sessionKey === undefined
          ? {}
          : { sessionKey: input.runtimeContext.sessionKey }),
        ...(input.runtimeContext?.metadata === undefined
          ? {}
          : { metadata: input.runtimeContext.metadata }),
      },
    };
  }
  const splitText = splitLegacyRoutingText(input.userText);
  return {
    rawUserText: splitText.rawUserText,
    conversationContext: {
      history: input.history,
      ...(splitText.recentContextText === undefined
        ? {}
        : { recentContextText: splitText.recentContextText }),
    },
    runtimeContext: {
      tools: input.tools,
    },
  };
}

function resolveExplicitBrowserUrlToolCalls(
  input: NormalizedConversationRuntimeSourceGroundingInput,
): readonly ConversationRuntimeModelToolCall[] {
  const url = resolveBrowserNavigateUrlFromHistory({
    rawUserText: input.rawUserText,
    conversationContext: input.conversationContext,
    runtimeContext: input.runtimeContext,
  });
  if (url === null) {
    return [];
  }
  if (
    !hasConversationRuntimeTool(input.runtimeContext.tools, "browser_navigate", "browser.navigate")
  ) {
    return [];
  }
  const requestedProfile = resolveRequestedBrowserProfile(input.rawUserText);
  const profileArgs =
    requestedProfile === undefined
      ? {}
      : {
          profile: requestedProfile,
        };
  const profileMetadata =
    requestedProfile === undefined
      ? {}
      : {
          requestedBrowserProfile: requestedProfile,
          requiresExistingBrowserSession: requestedProfile === "user",
        };
  const calls: ConversationRuntimeModelToolCall[] = [
    {
      id: "required-browser-navigate",
      name: "browser_navigate",
      args: {
        url,
        ...profileArgs,
        reason: "用户明确要求使用浏览器打开页面查看，运行时路由到 browser_navigate",
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "browser.page.navigate",
        provider: "desktop-browser",
        sourceType: "browser_page",
        sourceUrl: url,
        ...profileMetadata,
      },
    },
  ];
  if (
    hasConversationRuntimeTool(input.runtimeContext.tools, "browser_snapshot", "browser.snapshot")
  ) {
    calls.push({
      id: "required-browser-snapshot-after-navigate",
      name: "browser_snapshot",
      args: {
        full: true,
        reason: "用户要求读取浏览器页面，打开后立即抓取完整页面正文",
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "browser.page.snapshot",
        fallbackForSourceCapabilityId: "browser.page.navigate",
        provider: "desktop-browser",
        sourceType: "browser_page",
        sourceUrl: url,
        ...profileMetadata,
      },
    });
  }
  return calls;
}

function resolveExplicitUrlExtractToolCall(
  input: NormalizedConversationRuntimeSourceGroundingInput,
): ConversationRuntimeModelToolCall | undefined {
  const url = extractFirstHttpUrl(stripRecentSourceContext(input.rawUserText));
  if (url === null || !isExplicitUrlReadRequest(input.rawUserText)) {
    return undefined;
  }
  if (!hasConversationRuntimeTool(input.runtimeContext.tools, "web_extract", "web.extract")) {
    return undefined;
  }
  return createExplicitUrlExtractCall({
    url,
    strategy: resolveExplicitUrlSiteStrategyForRequest(url, input.rawUserText),
  });
}

function resolveExplicitUrlSiteStrategyToolCalls(
  input: NormalizedConversationRuntimeSourceGroundingInput,
): readonly ConversationRuntimeModelToolCall[] {
  const url = extractFirstHttpUrl(stripRecentSourceContext(input.rawUserText));
  if (url === null || !isExplicitUrlReadRequest(input.rawUserText)) {
    return [];
  }
  const strategy = resolveExplicitUrlSiteStrategyForRequest(url, input.rawUserText);
  const calls: ConversationRuntimeModelToolCall[] = [];
  if (strategy.id === "dynamic-social" && !isBrowserNavigateRequest(input.rawUserText)) {
    if (hasConversationRuntimeTool(input.runtimeContext.tools, "web_extract", "web.extract")) {
      return [createExplicitUrlExtractCall({ url, strategy })];
    }
    return [];
  }
  if (strategy.primary === "extract") {
    if (hasConversationRuntimeTool(input.runtimeContext.tools, "web_extract", "web.extract")) {
      calls.push(createExplicitUrlExtractCall({ url, strategy }));
    }
    if (
      strategy.browserFallback &&
      hasConversationRuntimeTool(input.runtimeContext.tools, "browser_navigate", "browser.navigate")
    ) {
      calls.push(
        ...createExplicitUrlBrowserCalls({
          url,
          strategy,
          rawUserText: input.rawUserText,
          idSuffix: "-fallback",
          action: "browser-fallback",
        }).filter((call) =>
          call.name === "browser_snapshot"
            ? hasConversationRuntimeTool(
                input.runtimeContext.tools,
                "browser_snapshot",
                "browser.snapshot",
              )
            : true,
        ),
      );
    }
    return calls;
  }
  if (
    !hasConversationRuntimeTool(input.runtimeContext.tools, "browser_navigate", "browser.navigate")
  ) {
    return [];
  }
  return createExplicitUrlBrowserCalls({
    url,
    strategy,
    rawUserText: input.rawUserText,
    idSuffix: "",
    action: "primary-browser",
  }).filter((call) =>
    call.name === "browser_snapshot"
      ? hasConversationRuntimeTool(
          input.runtimeContext.tools,
          "browser_snapshot",
          "browser.snapshot",
        )
      : true,
  );
}

function createExplicitUrlExtractCall(input: {
  readonly url: string;
  readonly strategy: ExplicitUrlSiteStrategy;
}): ConversationRuntimeModelToolCall {
  return {
    id: "required-web-extract-explicit-url",
    name: "web_extract",
    args: {
      url: input.url,
      mode: "auto",
      max_bytes: 120_000,
      reason: "用户给出明确 URL 并要求读取/学习，必须先读取原链接正文，不先搜索",
    },
    readOnly: true,
    metadata: {
      requiredGrounding: true,
      sourceCapabilityId: "source.explicit-url.extract",
      provider: "direct-url",
      sourceType: input.strategy.sourceType,
      sourceUrl: input.url,
      siteStrategyId: input.strategy.id,
      siteStrategyAction: "primary-extract",
      siteStrategyReason: input.strategy.reason,
      ...(input.strategy.explicitFullReread === true ? { explicitFullReread: true } : {}),
    },
  };
}

function createExplicitUrlBrowserCalls(input: {
  readonly url: string;
  readonly strategy: ExplicitUrlSiteStrategy;
  readonly rawUserText: string;
  readonly idSuffix: "" | "-fallback";
  readonly action: "primary-browser" | "browser-fallback";
}): readonly ConversationRuntimeModelToolCall[] {
  const requestedProfile = resolveRequestedBrowserProfile(input.rawUserText) ?? "angel";
  const profileMetadata = {
    requestedBrowserProfile: requestedProfile,
    requiresExistingBrowserSession: requestedProfile === "user",
  };
  return [
    {
      id: `required-browser-navigate-explicit-url${input.idSuffix}`,
      name: "browser_navigate",
      args: {
        url: input.url,
        profile: requestedProfile,
        reason:
          input.action === "primary-browser"
            ? "这个 URL 属于动态/本机类页面，运行时直接用浏览器打开后读取页面快照"
            : "直抽这类 URL 容易遇到登录态/反爬验证，运行时准备浏览器兜底读取页面快照",
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "source.explicit-url.browser",
        provider: "desktop-browser",
        sourceType: input.strategy.sourceType,
        sourceUrl: input.url,
        siteStrategyId: input.strategy.id,
        siteStrategyAction: input.action,
        siteStrategyReason: input.strategy.reason,
        ...(input.strategy.explicitFullReread === true ? { explicitFullReread: true } : {}),
        ...profileMetadata,
      },
    },
    {
      id: `required-browser-snapshot-explicit-url${input.idSuffix}`,
      name: "browser_snapshot",
      args: {
        ...createBrowserSnapshotPlanArgs(input.strategy),
        reason: "页面打开后立即抓取完整可见正文和结构快照，再基于真实页面回答",
      },
      readOnly: true,
      metadata: {
        requiredGrounding: true,
        sourceCapabilityId: "source.explicit-url.browser-snapshot",
        fallbackForSourceCapabilityId: "source.explicit-url.browser",
        provider: "desktop-browser",
        sourceType: input.strategy.sourceType,
        sourceUrl: input.url,
        siteStrategyId: input.strategy.id,
        siteStrategyAction: input.action,
        siteStrategyReason: input.strategy.reason,
        ...(input.strategy.explicitFullReread === true ? { explicitFullReread: true } : {}),
        ...profileMetadata,
      },
    },
  ];
}

function createBrowserSnapshotPlanArgs(strategy: ExplicitUrlSiteStrategy): BrowserSnapshotPlanArgs {
  if (strategy.explicitFullReread === true) {
    return {
      full: true,
      mode: "readable",
      max_chars: 16_000,
      urls: true,
      compact: true,
      refs: true,
    };
  }
  if (strategy.id === "weixin-article") {
    return {
      full: true,
      mode: "readable",
      max_chars: 16_000,
      urls: true,
      compact: true,
      refs: true,
    };
  }
  if (strategy.id === "dynamic-social" || strategy.id === "private-local") {
    return {
      full: false,
      mode: "efficient",
      max_chars: 12_000,
      urls: true,
      interactive: true,
      compact: true,
      refs: true,
    };
  }
  return {
    full: true,
    mode: "readable",
    max_chars: 16_000,
    urls: true,
    compact: true,
    refs: true,
  };
}

function resolveExplicitUrlSiteStrategyForRequest(
  url: string,
  rawUserText: string,
): ExplicitUrlSiteStrategy {
  const strategy = resolveExplicitUrlSiteStrategy(url);
  if (strategy.id !== "dynamic-social" || !isExplicitFullUrlRereadRequest(rawUserText)) {
    return strategy;
  }
  return {
    ...strategy,
    sourceType: "social_post",
    primary: "extract",
    browserFallback: true,
    explicitFullReread: true,
    reason:
      "用户明确要求完整/全文/二次提取后回答，先用正文提取器读取并生成全文 artifact，浏览器只作为登录态兜底",
  };
}

function resolveExplicitUrlSiteStrategy(url: string): ExplicitUrlSiteStrategy {
  const host = parseUrlHostname(url);
  if (host === null) {
    return {
      id: "static-readable",
      sourceType: "web_page",
      primary: "extract",
      browserFallback: false,
      reason: "无法识别为特殊站点，按普通公开网页直抽",
    };
  }
  if (isPrivateOrLocalHostname(host)) {
    return {
      id: "private-local",
      sourceType: "private_page",
      primary: "browser",
      browserFallback: false,
      reason: "本机/内网页面不能交给公网提取器，只能走受控浏览器读取",
    };
  }
  if (isWeixinArticleHostname(host)) {
    return {
      id: "weixin-article",
      sourceType: "weixin_article",
      primary: "extract",
      browserFallback: true,
      reason: "微信公众号文章先直抽原文，遇到验证/登录态残缺时用 Angel Chrome 兜底",
    };
  }
  if (isDynamicSocialHostname(host)) {
    return {
      id: "dynamic-social",
      sourceType: "social_post_browser",
      primary: "browser",
      browserFallback: false,
      reason:
        "动态社交页优先走 OpenCLI 深读；没有 OpenCLI 时只能做有限公开正文提取，除非用户明确要求用浏览器/Chrome 打开",
    };
  }
  return {
    id: "static-readable",
    sourceType: "web_page",
    primary: "extract",
    browserFallback: false,
    reason: "普通公开网页默认走正文提取器",
  };
}

function isExplicitFullUrlRereadRequest(text: string): boolean {
  const sourceText = stripRecentSourceContext(text);
  if (extractFirstHttpUrl(sourceText) === null) {
    return false;
  }
  return (
    /(?:重新|再次|继续|二次|完整|全文|全部|详细|直接|只).{0,24}(?:读取|提取|抽取|打开|总结|学习|学到|学到了|回答)/iu.test(
      sourceText,
    ) ||
    /(?:读取|提取|抽取|打开|总结|学习|学到|学到了|回答).{0,24}(?:全文|完整|全部|详细|这个链接|该链接|链接|正文预览截断)/iu.test(
      sourceText,
    ) ||
    /(?:正文预览截断|预览截断|8000\s*字符|完整学到了什么|完整学到什么)/iu.test(sourceText)
  );
}

function parseUrlHostname(value: string): string | null {
  try {
    return new URL(value).hostname.toLocaleLowerCase();
  } catch {
    return null;
  }
}

function isWeixinArticleHostname(host: string): boolean {
  return host === "mp.weixin.qq.com";
}

function isDynamicSocialHostname(host: string): boolean {
  return (
    host === "x.com" ||
    host === "twitter.com" ||
    host === "mobile.twitter.com" ||
    host.endsWith(".x.com") ||
    host.endsWith(".twitter.com")
  );
}

function isPrivateOrLocalHostname(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/gu, "");
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".lan") ||
    normalized.endsWith(".internal")
  ) {
    return true;
  }
  if (/^127\./u.test(normalized) || /^10\./u.test(normalized)) {
    return true;
  }
  if (/^192\.168\./u.test(normalized)) {
    return true;
  }
  const match = /^172\.(\d{1,2})\./u.exec(normalized);
  if (match !== null) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

function isExplicitUrlReadRequest(text: string): boolean {
  const sourceText = stripRecentSourceContext(text);
  if (extractFirstHttpUrl(sourceText) === null) {
    return false;
  }
  if (isBrowserNavigateRequest(sourceText)) {
    return false;
  }
  return /学习|读取|读一下|读这个|读取一下|提取|总结|整理|看看|看一下|分析|了解|打开/iu.test(
    sourceText,
  );
}

function hasConversationRuntimeTool(
  tools: readonly ConversationRuntimeModelToolDefinition[],
  toolName: string,
  capability?: string,
): boolean {
  return findConversationRuntimeTool(tools, toolName, capability) !== undefined;
}

function findConversationRuntimeTool(
  tools: readonly ConversationRuntimeModelToolDefinition[],
  toolName: string,
  capability?: string,
): ConversationRuntimeModelToolDefinition | undefined {
  return tools.find((tool) => {
    if (tool.name === toolName) {
      return true;
    }
    return capability !== undefined && tool.metadata?.capability === capability;
  });
}

function resolveConversationRuntimeToolAvailability(
  tools: readonly ConversationRuntimeModelToolDefinition[],
  toolName: string,
  capability?: string,
): SourcePrimaryAvailability {
  const tool = findConversationRuntimeTool(tools, toolName, capability);
  if (tool === undefined) {
    return "absent";
  }
  const status = readExternalProviderStatus(tool.metadata);
  if (status === undefined) {
    return "available-unknown";
  }
  return status === "ready" ? "ready" : "unavailable";
}

function readExternalProviderStatus(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const status = metadata?.externalProviderStatus;
  return typeof status === "string" && status.trim().length > 0 ? status.trim() : undefined;
}

function resolveSourceCapabilityFallbackCalls(input: {
  readonly capability: ConversationRuntimeSourceCapability;
  readonly input: NormalizedConversationRuntimeSourceGroundingInput;
  readonly query: string;
  readonly primaryAvailable: boolean;
  readonly primaryAvailability: SourcePrimaryAvailability;
}): readonly ConversationRuntimeModelToolCall[] {
  const fallbackCalls =
    input.capability.fallbackCalls?.({
      query: input.query,
      rawUserText: input.input.rawUserText,
      runtimeContext: input.input.runtimeContext,
    }) ?? [];
  if (fallbackCalls.length === 0) {
    return [];
  }
  if (
    input.capability.fallbackPolicy === "when-primary-unavailable" &&
    input.primaryAvailability === "ready"
  ) {
    return [];
  }
  return fallbackCalls
    .filter((fallback) =>
      hasConversationRuntimeTool(
        input.input.runtimeContext.tools,
        fallback.toolName,
        fallback.toolCapability,
      ),
    )
    .map((fallback) =>
      fallback.buildCall({
        query: input.query,
        rawUserText: input.input.rawUserText,
        runtimeContext: input.input.runtimeContext,
      }),
    );
}

function resolveExplicitOpenCliUrlToolCall(
  input: NormalizedConversationRuntimeSourceGroundingInput,
): ConversationRuntimeModelToolCall | undefined {
  const url =
    readRoutingString(input.conversationContext.metadata, "url") ??
    readRoutingString(input.runtimeContext.metadata, "url") ??
    extractFirstHttpUrl(stripRecentSourceContext(input.rawUserText));
  if (url === null || !isExplicitUrlReadRequest(input.rawUserText)) {
    return undefined;
  }
  if (!shouldPreferOpenCliForExplicitUrl(input, url)) {
    return undefined;
  }
  if (!isDynamicSocialHostname(parseUrlHostname(url) ?? "")) {
    return undefined;
  }
  if (
    !hasConversationRuntimeTool(
      input.runtimeContext.tools,
      "director.opencli.invoke",
      "external-tools.opencli.invoke-read",
    )
  ) {
    return undefined;
  }
  return {
    id: "required-opencli-twitter-thread-explicit-url",
    name: "director.opencli.invoke",
    args: {
      operationId: "opencli.twitter.thread",
      args: {
        "tweet-id": url,
      },
      reason: "用户明确要求用 OpenCLI/登录态读取 X/Twitter 链接，运行时优先调用只读 thread 命令。",
    },
    readOnly: true,
    metadata: {
      requiredGrounding: true,
      sourceCapabilityId: "source.explicit-url.opencli-twitter-thread",
      provider: "opencli",
      sourceType: "social_post",
      sourceUrl: url,
      operationId: "opencli.twitter.thread",
      capability: "external-tools.opencli.invoke-read",
    },
  };
}

function shouldPreferOpenCliForExplicitUrl(
  input: NormalizedConversationRuntimeSourceGroundingInput,
  url: string,
): boolean {
  const preferred =
    readRoutingString(input.conversationContext.metadata, "preferredToolProvider") ??
    readRoutingString(input.runtimeContext.metadata, "preferredToolProvider");
  if (preferred === "opencli") {
    return true;
  }
  if (
    isDynamicSocialHostname(parseUrlHostname(url) ?? "") &&
    !isBrowserNavigateRequest(input.rawUserText)
  ) {
    return true;
  }
  const text = stripRecentSourceContext(input.rawUserText);
  return (
    isDynamicSocialHostname(parseUrlHostname(url) ?? "") && /opencli|登录态|simon/iu.test(text)
  );
}

function readRoutingString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveSogouWeixinSearchQuery(input: ConversationRuntimeSourceMatchInput): string | null {
  const sourceText = input.rawUserText;
  if (isWeixinArticleSearchRequest(sourceText)) {
    return extractSogouWeixinSearchQuery(sourceText);
  }
  const recentQuery = extractRecentSogouWeixinSearchQuery(
    input.conversationContext.recentContextText,
  );
  if (recentQuery !== null) {
    return isSourceSearchFollowUpRequest(sourceText) ? recentQuery : null;
  }
  return null;
}

function isWeixinArticleSearchRequest(text: string): boolean {
  const sourceText = stripRecentSourceContext(text);
  const normalized = normalizeSourceSearchText(sourceText);
  const hasWeixinArticleSource =
    normalized.includes("微信公众号") ||
    normalized.includes("公众号文章") ||
    normalized.includes("微信文章") ||
    normalized.includes("搜狗微信") ||
    (normalized.includes("公众号") && normalized.includes("搜狗")) ||
    normalized.includes("weixin");
  if (!hasWeixinArticleSource) {
    return false;
  }
  return /搜索|搜素|搜搜|搜一下|查找|找一下|找一找|找找|检索|查一查|去找|帮我找/iu.test(sourceText);
}

function isSourceSearchFollowUpRequest(text: string): boolean {
  return /(再|继续|重新|接着|上一轮|刚才|还是)?\s*(去|帮我)?\s*(搜索|搜素|搜搜|搜一下|查找|找一下|找一找|找找|检索|查一查|找|看看|看)/iu.test(
    text,
  );
}

function extractRecentSogouWeixinSearchQuery(text: string | undefined): string | null {
  if (text === undefined || text.trim().length === 0) {
    return null;
  }
  const context = extractRecentContext(text) ?? text.trim();
  const lines = splitRecentContextLines(context);
  const sourceLine = lines.find(
    (line) =>
      isWeixinArticleSearchRequest(line) &&
      /seedance|教程|资料|玩法|经验|案例|信息|内容/iu.test(line),
  );
  if (sourceLine !== undefined) {
    return extractSogouWeixinSearchQuery(sourceLine);
  }
  const searchLine = lines.find((line) =>
    /搜索|搜素|搜搜|搜一下|查找|找一下|找找|检索|查一查/iu.test(line),
  );
  if (searchLine !== undefined) {
    return extractSogouWeixinSearchQuery(searchLine);
  }
  const weixinLine = lines.find((line) =>
    /微信公众号|公众号文章|微信文章|搜狗微信|weixin/iu.test(line),
  );
  if (weixinLine !== undefined) {
    return extractSogouWeixinSearchQuery(weixinLine);
  }
  return null;
}

function extractSogouWeixinSearchQuery(text: string): string {
  const sourceText = stripRecentSourceContext(text);
  const query = sourceText
    .replace(
      /(?:微信公众号|公众号文章|微信文章)?搜索文章需要(?:去|用|通过)?(?:搜狗|sogou)(?:里|上|里面)?(?:找|搜)?(?:的)?/giu,
      " ",
    )
    .replace(/用?搜索引擎/giu, " ")
    .replace(/搜狗/giu, " ")
    .replace(/sogou/giu, " ")
    .replace(/去|在/giu, " ")
    .replace(/微信公众号|公众号文章|微信文章|搜狗微信/giu, " ")
    .replace(/搜索|搜素|搜搜|搜一下|查找|找一下|找一找|找找|检索|查一查|找|相关|文章/giu, " ")
    .replace(/需要|应该|主要|通过|里面|里|上面|来源|来自|使用|指定/giu, " ")
    .replace(/的/giu, " ")
    .replace(/[，。！？、,:：；;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (query.length > 0) {
    return query;
  }
  const fallback = sourceText.replace(/\s+/gu, " ").trim();
  return fallback.length === 0 ? "微信公众号文章" : fallback;
}

function resolveXTwitterSearchQuery(text: string): string | null {
  if (!isXTwitterSearchRequest(text)) {
    return null;
  }
  const recentQuery = extractRecentXTwitterSearchQuery(text);
  if (recentQuery !== null) {
    return recentQuery;
  }
  const query = extractXTwitterSearchQuery(text);
  if (isThinSourceFollowUpQuery(query)) {
    return null;
  }
  return query;
}

function isXTwitterSearchRequest(text: string): boolean {
  const sourceText = stripRecentSourceContext(text);
  if (!/(推特|twitter|x\/twitter|\bX\b|x\.com)/iu.test(sourceText)) {
    return false;
  }
  return /搜索|搜一下|查找|找一下|找一找|找找|检索|查一查|去找|帮我找|看看|看一下|学习|研究|调研|找找看/iu.test(
    sourceText,
  );
}

function extractRecentXTwitterSearchQuery(text: string): string | null {
  const context = extractRecentContext(text);
  if (context === null) {
    return null;
  }
  const lines = splitRecentContextLines(context);
  const xLine = lines.find((line) => isXTwitterSearchRequest(line));
  if (xLine !== undefined) {
    return extractXTwitterSearchQuery(xLine);
  }
  const topicLine = lines.find((line) =>
    /seedance|教程|资料|玩法|经验|案例|信息|内容|最新/iu.test(line),
  );
  if (topicLine !== undefined) {
    return extractXTwitterSearchQuery(topicLine);
  }
  return null;
}

function resolveXTwitterSearchQueryFromHistory(
  input: ConversationRuntimeSourceMatchInput,
): string | null {
  if (!isXTwitterSearchRequest(input.rawUserText)) {
    return null;
  }
  const directQuery = extractXTwitterSearchQuery(input.rawUserText);
  if (!isThinSourceFollowUpQuery(directQuery)) {
    return directQuery;
  }
  const recentTopic = findLatestSourceSearchTopic(input.conversationContext.history ?? []);
  return recentTopic ?? directQuery;
}

function extractXTwitterSearchQuery(text: string): string {
  const sourceText = stripRecentSourceContext(text);
  const query = sourceText
    .replace(
      /谷歌浏览器|google\s*chrome|chrome|我的浏览器|真实\s*chrome|登录态|浏览器|browser/giu,
      " ",
    )
    .replace(/x\/twitter|twitter|推特|x\.com/giu, " ")
    .replace(/去|用|在|从|到|上面|里面|里|看一下|看看|找找看/giu, " ")
    .replace(
      /搜索|搜一下|查找|找一下|找一找|找找|检索|查一查|找|相关|学习|研究|调研|资料|内容/giu,
      " ",
    )
    .replace(/有没有|是否|看看|一下|继续|不是/giu, " ")
    .replace(/[，。！？、,:：；;]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (query.length > 0) {
    return query;
  }
  const fallback = sourceText.replace(/\s+/gu, " ").trim();
  return fallback.length === 0 ? "X/Twitter 最新内容" : fallback;
}

function createXTwitterBrowserFallbackCalls(input: {
  readonly query: string;
  readonly rawUserText: string;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
}): readonly ConversationRuntimeSourceFallbackCall[] {
  if (!shouldUseBrowserForXTwitterRequest(input.rawUserText)) {
    return [];
  }
  const requestedProfile = resolveRequestedBrowserProfile(input.rawUserText) ?? "angel";
  const profileMetadata = {
    requestedBrowserProfile: requestedProfile,
    requiresExistingBrowserSession: requestedProfile === "user",
  };
  const calls: ConversationRuntimeSourceFallbackCall[] = [
    {
      toolName: "browser_navigate",
      toolCapability: "browser.navigate",
      buildCall: ({ query }) => ({
        id: "required-browser-navigate-x-twitter",
        name: "browser_navigate",
        args: {
          url: createXTwitterBrowserSearchUrl(query),
          profile: requestedProfile,
          reason:
            requestedProfile === "user"
              ? "用户明确要求使用真实 Chrome/谷歌浏览器访问 X/Twitter，运行时先用 user profile 打开搜索页"
              : "用户明确要求通过浏览器访问 X/Twitter，运行时先用 Angel 专用 Chrome 打开搜索页",
        },
        readOnly: true,
        metadata: {
          requiredGrounding: true,
          sourceCapabilityId: "social.x-twitter.browser-search",
          fallbackForSourceCapabilityId: "social.x-twitter.search",
          provider: "desktop-browser",
          sourceType: "social_post_browser",
          browserUrl: createXTwitterBrowserSearchUrl(query),
          ...profileMetadata,
        },
      }),
    },
  ];
  if (hasConversationRuntimeTool(input.tools, "browser_snapshot", "browser.snapshot")) {
    calls.push({
      toolName: "browser_snapshot",
      toolCapability: "browser.snapshot",
      buildCall: () => ({
        id: "required-browser-snapshot-x-twitter",
        name: "browser_snapshot",
        args: {
          full: true,
          reason: "X/Twitter 搜索页打开后立即抓取完整页面快照，再基于真实页面回答",
        },
        readOnly: true,
        metadata: {
          requiredGrounding: true,
          sourceCapabilityId: "social.x-twitter.browser-snapshot",
          fallbackForSourceCapabilityId: "social.x-twitter.search",
          provider: "desktop-browser",
          sourceType: "social_post_browser",
          ...profileMetadata,
        },
      }),
    });
  }
  return calls;
}

function shouldUseBrowserForXTwitterRequest(text: string): boolean {
  const sourceText = stripRecentSourceContext(text);
  return /浏览器|谷歌浏览器|google\s*chrome|chrome|我的浏览器|真实\s*chrome|登录态|x\.com|打开/iu.test(
    sourceText,
  );
}

function createXTwitterBrowserSearchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

function isThinSourceFollowUpQuery(query: string): boolean {
  const normalized = query.replace(/\s+/gu, "").replace(/的/giu, "");
  if (normalized.length === 0) {
    return true;
  }
  return /^(这|这个|这些|那|那个|那些)?(不是)?(最新|相关|资料|内容|信息)?$/iu.test(normalized);
}

function normalizeInheritedSourceTopic(value: string): string | null {
  const topic = value
    .replace(/site:x\.com\s+OR\s+site:twitter\.com/giu, " ")
    .replace(/微信公众号文章|公众号文章|微信文章|搜狗微信/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (topic.length === 0 || isThinSourceFollowUpQuery(topic)) {
    return null;
  }
  return topic;
}

function resolveBrowserNavigateUrlFromHistory(
  input: ConversationRuntimeSourceMatchInput,
): string | null {
  const directUrl = resolveBrowserNavigateUrl(input.rawUserText);
  if (directUrl !== null) {
    return directUrl;
  }
  if (!isBrowserNavigateRequest(input.rawUserText)) {
    return null;
  }
  return findLatestHttpUrl(input.conversationContext.history ?? []);
}

function resolveBrowserNavigateUrl(text: string): string | null {
  const sourceText = stripRecentSourceContext(text);
  if (!isBrowserNavigateRequest(sourceText)) {
    return null;
  }
  const url = extractFirstHttpUrl(sourceText);
  if (url === null) {
    return null;
  }
  return url;
}

function isBrowserNavigateRequest(text: string): boolean {
  const sourceText = stripRecentSourceContext(text);
  if (!/(浏览器|谷歌浏览器|chrome|browser|打开网页|打开页面)/iu.test(sourceText)) {
    return false;
  }
  return /(打开|访问|进入|看一下|看看|浏览|读取|去看|看呀)/iu.test(sourceText);
}

function resolveRequestedBrowserProfile(text: string): string | undefined {
  const sourceText = stripRecentSourceContext(text);
  return /(谷歌浏览器|google\s*chrome|chrome|我的浏览器|真实\s*chrome|登录态)/iu.test(sourceText)
    ? "user"
    : undefined;
}

function extractFirstHttpUrl(text: string): string | null {
  const match = /https?:\/\/[^\s"'<>，。！？、；;]+/iu.exec(text);
  const rawUrl = match?.[0]?.trim();
  return normalizeHttpUrl(rawUrl);
}

function findLatestHttpUrl(history: readonly ConversationRuntimeModelToolMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const url = extractLastHttpUrl(history[index]?.content ?? "");
    if (url !== null) {
      return url;
    }
  }
  return null;
}

function extractLastHttpUrl(text: string): string | null {
  let latest: string | null = null;
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>，。！？、；;]+/giu)) {
    const url = normalizeHttpUrl(match[0]?.trim());
    if (url !== null) {
      latest = url;
    }
  }
  return latest;
}

function normalizeHttpUrl(rawUrl: string | undefined): string | null {
  if (rawUrl === undefined || rawUrl.length === 0) {
    return null;
  }
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function resolveRequiredLearningExtractToolCall(
  input: NormalizedConversationRuntimeSourceGroundingInput,
): ConversationRuntimeModelToolCall | undefined {
  if (!isLearningFollowUpRequest(input.rawUserText)) {
    return undefined;
  }
  if (!hasConversationRuntimeTool(input.runtimeContext.tools, "web_extract", "web.extract")) {
    return undefined;
  }
  const candidate = findLatestExtractableSearchCandidate(input.conversationContext.history);
  if (candidate === undefined) {
    return undefined;
  }
  return {
    id: "required-web-extract-learning-1",
    name: "web_extract",
    args: {
      url: candidate.url,
      mode: "auto",
      max_bytes: 120_000,
      reason: `用户追问上一轮搜索到底学到了什么，先读取候选源：${candidate.title}`,
    },
    readOnly: true,
    metadata: {
      requiredGrounding: true,
      sourceCapabilityId: "source.learning.extract-latest-candidate",
      learningFollowUp: true,
      sourceUrl: candidate.url,
      sourceTitle: candidate.title,
    },
  };
}

function isLearningFollowUpRequest(text: string): boolean {
  const normalized = normalizeSourceSearchText(text);
  if (
    /你学了什么|学到了什么|吸收了什么|总结一下|整理一下|继续学习|学一下|读取一下|提取一下/iu.test(
      text,
    )
  ) {
    return true;
  }
  return (
    (normalized.includes("学") || normalized.includes("学习")) &&
    /(什么|哪些|结果|内容|要点|总结|整理)/iu.test(text)
  );
}

interface SourceSearchCandidate {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

interface SourceToolObservation {
  readonly status: string;
  readonly query: string;
  readonly provider: string;
  readonly sourceType: string;
  readonly results: readonly SourceSearchCandidate[];
  readonly nextActions: readonly string[];
}

function findLatestExtractableSearchCandidate(
  history: readonly ConversationRuntimeModelToolMessage[],
): SourceSearchCandidate | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "tool") {
      continue;
    }
    const observation = parseSourceToolObservation(message.content, message.metadata);
    if (observation === undefined || observation.results.length === 0) {
      continue;
    }
    if (!isSearchCandidateObservation(observation)) {
      continue;
    }
    const bestCandidate = observation.results.find((candidate) => isExtractableUrl(candidate.url));
    if (bestCandidate !== undefined) {
      return bestCandidate;
    }
  }
  return undefined;
}

function findLatestSourceSearchTopic(
  history: readonly ConversationRuntimeModelToolMessage[],
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "tool") {
      continue;
    }
    const observation = parseSourceToolObservation(message.content, message.metadata);
    if (observation === undefined || !isSearchCandidateObservation(observation)) {
      continue;
    }
    const queryTopic = normalizeInheritedSourceTopic(observation.query);
    if (queryTopic !== null) {
      return queryTopic;
    }
    const candidateTopic = normalizeInheritedSourceTopic(
      observation.results
        .map((candidate) => [candidate.title, candidate.snippet].filter(Boolean).join(" "))
        .join(" "),
    );
    if (candidateTopic !== null) {
      return candidateTopic;
    }
  }
  return null;
}

function parseSourceToolObservation(
  content: string,
  metadata: Readonly<Record<string, unknown>> | undefined,
): SourceToolObservation | undefined {
  const fields = parseSourceObservationContent(content);
  const query = fields.query ?? "";
  const provider = fields.provider ?? "";
  const sourceType = fields.sourceType ?? "";
  const results = parseSourceObservationResults(content);
  const nextActions = fields.nextActions ?? [];
  if (provider.length === 0 && sourceType.length === 0 && results.length === 0) {
    return undefined;
  }
  return {
    status:
      fields.status ??
      (metadata?.ok === false ? "error" : results.length > 0 ? "success" : "warning"),
    query,
    provider,
    sourceType,
    results,
    nextActions,
  };
}

function parseSourceObservationContent(content: string): {
  readonly status?: string;
  readonly query?: string;
  readonly provider?: string;
  readonly sourceType?: string;
  readonly nextActions?: readonly string[];
} {
  const fields = new Map<string, string>();
  for (const line of content.split(/\r?\n/u)) {
    const match = /^(status|query|provider|source_type|next_actions)\s*:\s*(.*)$/iu.exec(
      line.trim(),
    );
    if (match === null) {
      continue;
    }
    const key = match[1]?.toLowerCase();
    if (key !== undefined) {
      fields.set(key, match[2]?.trim() ?? "");
    }
  }
  const parsed: {
    status?: string;
    query?: string;
    provider?: string;
    sourceType?: string;
    nextActions?: readonly string[];
  } = {};
  const status = fields.get("status");
  if (status !== undefined) parsed.status = status;
  const query = fields.get("query");
  if (query !== undefined) parsed.query = query;
  const provider = fields.get("provider");
  if (provider !== undefined) parsed.provider = provider;
  const sourceType = fields.get("source_type");
  if (sourceType !== undefined) parsed.sourceType = sourceType;
  const nextActions = fields.get("next_actions");
  if (nextActions !== undefined) parsed.nextActions = splitSourceList(nextActions);
  return parsed;
}

function parseSourceObservationResults(content: string): readonly SourceSearchCandidate[] {
  const results: SourceSearchCandidate[] = [];
  for (const line of content.split(/\r?\n/u)) {
    const match = /^result_\d+\s*:\s*(.+)$/iu.exec(line.trim());
    if (match !== null) {
      const parts = (match[1] ?? "").split(/\s+\|\s+/u);
      const title = parts[0]?.trim() ?? "";
      const url = readSourcePart(parts, "url");
      const snippet = readSourcePart(parts, "snippet");
      if (title.length > 0 || url.length > 0) {
        results.push({ title, url, snippet });
      }
      continue;
    }
    const legacyMatch = /^\d+\.\s*(.+?)\s+-\s+(https?:\/\/\S+)/iu.exec(line.trim());
    if (legacyMatch !== null) {
      results.push({
        title: legacyMatch[1]?.trim() ?? "",
        url: legacyMatch[2]?.trim() ?? "",
        snippet: "",
      });
    }
  }
  return results;
}

function readSourcePart(parts: readonly string[], key: string): string {
  const prefix = `${key}=`;
  return (
    parts
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length)
      .trim() ?? ""
  );
}

function isSearchCandidateObservation(observation: SourceToolObservation): boolean {
  return (
    observation.status === "success" &&
    observation.results.length > 0 &&
    (observation.provider.length > 0 ||
      observation.sourceType.length > 0 ||
      observation.nextActions.some((action) => /extract|提取|读取|web_extract/iu.test(action)))
  );
}

function isExtractableUrl(value: string): boolean {
  if (!/^https?:\/\//iu.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractRecentContext(text: string): string | null {
  const context = splitLegacyRoutingText(text).recentContextText;
  return context === undefined || context.length === 0 ? null : context;
}

function splitLegacyRoutingText(text: string): {
  readonly rawUserText: string;
  readonly recentContextText?: string;
} {
  const match = /(?:。|\n)?\s*近期对话上下文[:：]?\s*(.+)$/su.exec(text);
  const recentContextText = match?.[1]?.trim();
  const rawUserText = text
    .replace(/(?:。|\n)?\s*近期对话(?:上下文|（[^）]*）|\([^)]*\))?[:：]?.*$/su, "")
    .trim();
  return {
    rawUserText,
    ...(recentContextText === undefined || recentContextText.length === 0
      ? {}
      : { recentContextText }),
  };
}

function splitRecentContextLines(context: string): readonly string[] {
  return context
    .split(/[；;\n]+/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeSourceSearchText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/gu, "");
}

function stripRecentSourceContext(text: string): string {
  return splitLegacyRoutingText(text).rawUserText;
}

function splitSourceList(value: string): readonly string[] {
  return value
    .split(/\s*;\s*/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== "none");
}
