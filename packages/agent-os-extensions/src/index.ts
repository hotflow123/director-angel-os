export type AgentOsExtensionKind = "channel" | "provider" | "skill" | "tool-source";

export type AgentOsExtensionSourceTrustStatus =
  | "built-in"
  | "trusted-local-config"
  | "trusted-plugin"
  | "user-configured"
  | "unverified";

export type AgentOsExtensionHealthStatus =
  | "disabled"
  | "needs-auth"
  | "needs-setup"
  | "problem"
  | "ready";

export type AgentOsExtensionSandboxMode =
  | "disabled"
  | "docker"
  | "host"
  | "network-limited"
  | "readonly"
  | "ssh"
  | "workspace-write";

export type AgentOsExtensionNetworkPolicy = "full" | "limited" | "none";

export type AgentOsExtensionUiSurface =
  | "approval-card"
  | "review"
  | "settings"
  | "tools"
  | "workspace";

export interface AgentOsExtensionCapability {
  readonly id: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
  readonly risk?: "high" | "low" | "medium";
}

export interface AgentOsExtensionTool {
  readonly name: string;
  readonly capabilityId: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
}

export interface AgentOsExtensionSourceTrust {
  readonly status: AgentOsExtensionSourceTrustStatus;
  readonly label?: string;
  readonly reason?: string;
}

export interface AgentOsExtensionProviderAccount {
  readonly id: string;
  readonly authType: "oauth" | "secret-ref" | "session" | "none";
  readonly required: boolean;
  readonly scopes?: readonly string[];
}

export interface AgentOsExtensionSecret {
  readonly id: string;
  readonly required: boolean;
  readonly allowedSources: readonly ("env" | "exec" | "file" | "inline")[];
}

export interface AgentOsExtensionInstallPolicy {
  readonly supported: boolean;
  readonly defaultMode: "manual" | "none" | "plan";
  readonly requiresExplicitExecute?: boolean;
}

export interface AgentOsExtensionSandboxPolicy {
  readonly defaultMode: AgentOsExtensionSandboxMode;
  readonly networkPolicy: AgentOsExtensionNetworkPolicy;
  readonly requiresCommandPattern?: boolean;
}

export interface AgentOsExtensionHealth {
  readonly status: AgentOsExtensionHealthStatus;
  readonly checkedAt?: string;
  readonly checkFn?: string;
  readonly message?: string;
}

export interface AgentOsExtensionManifest {
  readonly id: string;
  readonly version: string;
  readonly kind: AgentOsExtensionKind;
  readonly displayName: string;
  readonly providerId?: string;
  readonly sourceTrust: AgentOsExtensionSourceTrust;
  readonly capabilities: readonly AgentOsExtensionCapability[];
  readonly tools: readonly AgentOsExtensionTool[];
  readonly providerAccounts: readonly AgentOsExtensionProviderAccount[];
  readonly secrets: readonly AgentOsExtensionSecret[];
  readonly installPolicy: AgentOsExtensionInstallPolicy;
  readonly sandboxPolicy: AgentOsExtensionSandboxPolicy;
  readonly health: AgentOsExtensionHealth;
  readonly uiSurfaces: readonly AgentOsExtensionUiSurface[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentOsExtensionMatrixEntry {
  readonly id: string;
  readonly kind: AgentOsExtensionKind;
  readonly displayName: string;
  readonly providerId?: string;
  readonly capabilityIds: readonly string[];
  readonly capabilities: readonly AgentOsExtensionCapability[];
  readonly tools: readonly AgentOsExtensionTool[];
  readonly providerAccounts: readonly AgentOsExtensionProviderAccount[];
  readonly secrets: readonly AgentOsExtensionSecret[];
  readonly installPolicy: AgentOsExtensionInstallPolicy;
  readonly health: AgentOsExtensionHealth;
  readonly sandbox: AgentOsExtensionSandboxPolicy;
  readonly sourceTrust: AgentOsExtensionSourceTrust;
  readonly uiSurfaces: readonly AgentOsExtensionUiSurface[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentOsExtensionMatrixSummary {
  readonly total: number;
  readonly ready: number;
  readonly needsAuth: number;
  readonly needsSetup: number;
  readonly disabled: number;
  readonly problem: number;
}

export interface AgentOsExtensionMatrix {
  readonly summary: AgentOsExtensionMatrixSummary;
  readonly entries: readonly AgentOsExtensionMatrixEntry[];
  readonly byCapability: Readonly<Record<string, readonly AgentOsExtensionMatrixEntry[]>>;
}

export interface AgentOsExtensionFactoryInput {
  readonly id?: string;
  readonly displayName?: string;
  readonly providerId?: string;
  readonly health?: AgentOsExtensionHealth;
}

export interface AgentOsMcpExtensionFactoryInput extends AgentOsExtensionFactoryInput {
  readonly serverCount?: number;
  readonly toolCount?: number;
}

const DEFAULT_VERSION = "0.1.0";

export function createComfyUiExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "comfyui.local",
    version: DEFAULT_VERSION,
    kind: "provider",
    displayName: input.displayName ?? "ComfyUI",
    providerId: input.providerId ?? "comfyui",
    sourceTrust: { status: "trusted-local-config", label: "Trusted local config" },
    capabilities: [
      capability("comfyui.lifecycle", "ComfyUI lifecycle", false, true, "medium"),
      capability("comfyui.install", "ComfyUI install", false, true, "high"),
      capability("comfyui.workflow.inspect", "Workflow inspect", true),
      capability("comfyui.workflow.invoke", "Workflow invoke", false, true, "medium"),
      capability("media.generate_image", "Generate image", false, true, "medium"),
      capability("media.generate_video", "Generate video", false, true, "medium"),
      capability("artifact.output", "Output artifact", true),
    ],
    tools: [
      tool("comfyui.status", "comfyui.lifecycle", true),
      tool("comfyui.start", "comfyui.lifecycle", false, true),
      tool("comfyui.stop", "comfyui.lifecycle", false, true),
      tool("comfyui.install", "comfyui.install", false, true),
      tool("comfyui.workflow.invoke", "comfyui.workflow.invoke", false, true),
    ],
    providerAccounts: [],
    secrets: [],
    installPolicy: {
      supported: true,
      defaultMode: "plan",
      requiresExplicitExecute: true,
    },
    sandboxPolicy: {
      defaultMode: "host",
      networkPolicy: "none",
      requiresCommandPattern: true,
    },
    health: input.health ?? { status: "needs-setup", checkFn: "comfyui.health" },
    uiSurfaces: ["settings", "tools", "approval-card", "review"],
  };
}

export function createWebExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "web.builtin",
    version: DEFAULT_VERSION,
    kind: "tool-source",
    displayName: input.displayName ?? "Web",
    providerId: input.providerId ?? "web",
    sourceTrust: { status: "built-in", label: "Built-in" },
    capabilities: [
      capability("web.search", "Web search", true),
      capability("web.extract", "Web extract", true),
    ],
    tools: [tool("web_search", "web.search", true), tool("web_extract", "web.extract", true)],
    providerAccounts: [],
    secrets: [],
    installPolicy: { supported: false, defaultMode: "none" },
    sandboxPolicy: { defaultMode: "network-limited", networkPolicy: "limited" },
    health: input.health ?? { status: "ready" },
    uiSurfaces: ["tools", "review"],
  };
}

export function createBrowserExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "browser.desktop",
    version: DEFAULT_VERSION,
    kind: "tool-source",
    displayName: input.displayName ?? "Desktop Browser",
    providerId: input.providerId ?? "browser",
    sourceTrust: { status: "trusted-local-config", label: "Trusted local config" },
    capabilities: [
      capability("browser.navigate", "Browser navigate", false, true, "medium"),
      capability("browser.snapshot", "Browser snapshot", true),
      capability("browser.click", "Browser click", false, true, "medium"),
      capability("browser.type", "Browser type", false, true, "medium"),
      capability("browser.scroll", "Browser scroll", false, undefined, "low"),
      capability("browser.back", "Browser back", false, undefined, "low"),
      capability("browser.press", "Browser press", false, true, "medium"),
      capability("browser.images", "Browser images", true),
      capability("browser.console", "Browser console", true),
    ],
    tools: [
      tool("browser_navigate", "browser.navigate", false, true),
      tool("browser_snapshot", "browser.snapshot", true),
      tool("browser_click", "browser.click", false, true),
      tool("browser_type", "browser.type", false, true),
      tool("browser_scroll", "browser.scroll", false),
      tool("browser_back", "browser.back", false),
      tool("browser_press", "browser.press", false, true),
      tool("browser_get_images", "browser.images", true),
      tool("browser_console", "browser.console", true),
    ],
    providerAccounts: [],
    secrets: [],
    installPolicy: { supported: false, defaultMode: "none" },
    sandboxPolicy: { defaultMode: "network-limited", networkPolicy: "limited" },
    health: input.health ?? { status: "ready" },
    uiSurfaces: ["tools", "approval-card", "review"],
    metadata: {
      automationHardening: {
        runnerImplementation: "electron-browser-window",
        externalProcessRunner: false,
        credentialProfileAccess: "operator-scope-required",
        unmanagedPlaywrightChromiumProcess: false,
        requiresOperatorScopeForProfileAccess: true,
        processLedgerRequiredForExternalRunner: true,
      },
    },
  };
}

export function createMcpExtensionManifest(
  input: AgentOsMcpExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "mcp.local",
    version: DEFAULT_VERSION,
    kind: "tool-source",
    displayName: input.displayName ?? "MCP Local",
    providerId: input.providerId ?? "mcp",
    sourceTrust: { status: "trusted-local-config", label: "Trusted local config" },
    capabilities: [
      capability("mcp.tool", "MCP tool", false, true, "medium"),
      capability("mcp.oauth", "MCP OAuth", false, true, "medium"),
      capability("mcp.resource", "MCP resource", true),
    ],
    tools: [
      tool("mcp.tool.invoke", "mcp.tool", false, true),
      tool("mcp.oauth.login", "mcp.oauth", false, true),
    ],
    providerAccounts: [
      { id: "mcp-oauth", authType: "oauth", required: false, scopes: ["mcp.oauth"] },
    ],
    secrets: [],
    installPolicy: {
      supported: true,
      defaultMode: "manual",
      requiresExplicitExecute: true,
    },
    sandboxPolicy: {
      defaultMode: "host",
      networkPolicy: "none",
      requiresCommandPattern: true,
    },
    health: input.health ?? { status: "problem", message: "No connected MCP servers" },
    uiSurfaces: ["settings", "tools", "approval-card", "review"],
    metadata: {
      serverCount: input.serverCount ?? 0,
      toolCount: input.toolCount ?? 0,
    },
  };
}

export function createXTwitterExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "x-twitter",
    version: DEFAULT_VERSION,
    kind: "provider",
    displayName: input.displayName ?? "X/Twitter",
    providerId: input.providerId ?? "x-twitter",
    sourceTrust: { status: "user-configured", label: "User configured" },
    capabilities: [
      capability("x.search", "X search", true),
      capability("social.search", "Social search", true),
    ],
    tools: [tool("x_search", "x.search", true)],
    providerAccounts: [
      { id: "bearer-token", authType: "secret-ref", required: true, scopes: ["x.search"] },
    ],
    secrets: [
      {
        id: "bearerToken",
        required: true,
        allowedSources: ["env", "exec", "file", "inline"],
      },
    ],
    installPolicy: { supported: false, defaultMode: "none" },
    sandboxPolicy: { defaultMode: "network-limited", networkPolicy: "limited" },
    health: input.health ?? { status: "needs-auth", checkFn: "x-twitter.auth" },
    uiSurfaces: ["settings", "tools", "review"],
  };
}

export function createMemefastExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "memefast.api",
    version: DEFAULT_VERSION,
    kind: "provider",
    displayName: input.displayName ?? "MemeFast API",
    providerId: input.providerId ?? "memefast-api",
    sourceTrust: { status: "user-configured", label: "User configured" },
    capabilities: [
      capability("model.chat", "Chat completions", false, true, "medium"),
      capability("model.vision", "Vision model", false, true, "medium"),
      capability("media.generate_image", "Generate image", false, true, "medium"),
      capability("media.generate_video", "Generate video", false, true, "medium"),
      capability("provider.memefast", "MemeFast provider metadata", true, undefined, "low"),
    ],
    tools: [
      tool("api_provider.chat", "model.chat", false, true),
      tool("api_provider.vision", "model.vision", false, true),
      tool("api_provider.image", "media.generate_image", false, true),
      tool("api_provider.video", "media.generate_video", false, true),
    ],
    providerAccounts: [
      {
        id: "api-key",
        authType: "secret-ref",
        required: true,
        scopes: ["model.chat", "media.generate_image", "media.generate_video"],
      },
    ],
    secrets: [
      {
        id: "apiKey",
        required: true,
        allowedSources: ["env", "exec", "file", "inline"],
      },
    ],
    installPolicy: { supported: false, defaultMode: "none" },
    sandboxPolicy: {
      defaultMode: "network-limited",
      networkPolicy: "limited",
      requiresCommandPattern: false,
    },
    health: {
      status: "needs-auth",
      checkFn: "memefast.auth",
      ...(input.health ?? {}),
    },
    uiSurfaces: ["settings", "tools", "approval-card", "review"],
    metadata: {
      baseUrl: "https://memefast.top",
      apiKeyEnvVar: "MEMEFAST_API_KEY",
      endpointFamilies: [
        "openai_chat",
        "openai_images",
        "openai_official",
        "volc",
        "wan",
        "kling",
        "happyhorse",
        "unified",
      ],
      providerCredentialsUsed: false,
      liveRunnerStarted: false,
      ttsSttProvider: false,
    },
  };
}

export function createVoiceLiveAudioExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "voice.live-audio",
    version: DEFAULT_VERSION,
    kind: "provider",
    displayName: input.displayName ?? "Live Audio",
    providerId: input.providerId ?? "voice-live-audio",
    sourceTrust: { status: "built-in", label: "Built-in fail-closed voice scaffold" },
    capabilities: [
      capability("audio.capture", "Audio capture", false, true, "high"),
      capability("audio.transcribe", "Audio transcription", false, true, "high"),
      capability("audio.synthesize", "Speech synthesis", false, true, "high"),
      capability("audio.realtime.transcribe", "Realtime audio transcription", false, true, "high"),
      capability("audio.realtime.talk", "Realtime talk", false, true, "high"),
    ],
    tools: [
      tool("voice.capture", "audio.capture", false, true),
      tool("voice.transcribe", "audio.transcribe", false, true),
      tool("voice.synthesize", "audio.synthesize", false, true),
      tool("voice.realtime_transcribe", "audio.realtime.transcribe", false, true),
      tool("voice.realtime_talk", "audio.realtime.talk", false, true),
    ],
    providerAccounts: [
      {
        id: "voice-provider",
        authType: "secret-ref",
        required: false,
        scopes: ["audio.transcribe", "audio.synthesize", "audio.realtime.talk"],
      },
    ],
    secrets: [
      {
        id: "providerApiKey",
        required: false,
        allowedSources: ["env", "exec", "file"],
      },
    ],
    installPolicy: {
      supported: true,
      defaultMode: "plan",
      requiresExplicitExecute: true,
    },
    sandboxPolicy: {
      defaultMode: "host",
      networkPolicy: "none",
      requiresCommandPattern: true,
    },
    health: input.health ?? {
      status: "disabled",
      message:
        "真实语音 runner 默认关闭：需要 operator evidence 后才能启用麦克风、Whisper、TTS/STT 或 live audio runner。",
      checkFn: "voice.live-audio.fail-closed",
    },
    uiSurfaces: ["settings", "tools", "approval-card", "review"],
    metadata: {
      failClosed: true,
      providerRuntimeConfigured: false,
      microphonePermissionGranted: false,
      speakerPermissionGranted: false,
      rawAudioStoragePolicyAccepted: false,
      audioBytesRead: false,
      microphoneAccessed: false,
      speakerAccessed: false,
      rawAudioPersisted: false,
      speechTranscribed: false,
      speechSynthesized: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      localProcessStarted: false,
      whisperStarted: false,
      liveRunnerStarted: false,
      preferredTransport: "gateway-relay",
      providerSecretBoundary: "host-only",
      rawAudioDefaultStorage: "forbidden",
    },
  };
}

export function createMediaUnderstandingExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "media-understanding.local",
    version: DEFAULT_VERSION,
    kind: "provider",
    displayName: input.displayName ?? "Media Understanding",
    providerId: input.providerId ?? "media-understanding",
    sourceTrust: { status: "built-in", label: "Built-in" },
    capabilities: [
      capability("media.understand_image", "Understand image", true, undefined, "low"),
      capability("media.understand_video", "Understand video", true, undefined, "low"),
      capability("media.understand_audio", "Understand audio", true, undefined, "low"),
      capability("artifact.metadata.inspect", "Inspect artifact metadata", true, undefined, "low"),
    ],
    tools: [
      tool("media_understanding.inspect", "media.understand_image", true),
      tool("media_understanding.inspect_video", "media.understand_video", true),
      tool("media_understanding.inspect_audio", "media.understand_audio", true),
    ],
    providerAccounts: [],
    secrets: [],
    installPolicy: { supported: false, defaultMode: "none" },
    sandboxPolicy: {
      defaultMode: "readonly",
      networkPolicy: "none",
      requiresCommandPattern: false,
    },
    health: input.health ?? { status: "ready", checkFn: "media-understanding.local" },
    uiSurfaces: ["review", "tools"],
    metadata: {
      runnerKind: "local-metadata",
      supportedContainers: ["mp4", "webm", "wav", "flac"],
      semanticTranscription: "unsupported",
    },
  };
}

export function createMediaAnalysisExtensionManifest(
  input: AgentOsExtensionFactoryInput = {},
): AgentOsExtensionManifest {
  return {
    id: input.id ?? "media-analysis.local",
    version: DEFAULT_VERSION,
    kind: "provider",
    displayName: input.displayName ?? "Media Analysis",
    providerId: input.providerId ?? "media-analysis",
    sourceTrust: { status: "built-in", label: "Built-in" },
    capabilities: [
      capability(
        "media.analysis.local_dry_run",
        "Local media analysis dry run",
        false,
        true,
        "medium",
      ),
      capability("media.analyze_image", "Analyze image", true, undefined, "low"),
      capability("media.analyze_video", "Analyze video", true, undefined, "low"),
      capability("media.analyze_audio", "Analyze audio", true, undefined, "low"),
      capability("artifact.metadata.inspect", "Inspect artifact metadata", true, undefined, "low"),
    ],
    tools: [
      tool("media_analysis.run", "media.analysis.local_dry_run", false, true),
      tool("media_analysis.inspect_image", "media.analyze_image", true),
      tool("media_analysis.inspect_video", "media.analyze_video", true),
      tool("media_analysis.inspect_audio", "media.analyze_audio", true),
    ],
    providerAccounts: [],
    secrets: [],
    installPolicy: { supported: false, defaultMode: "none" },
    sandboxPolicy: {
      defaultMode: "host",
      networkPolicy: "none",
      requiresCommandPattern: true,
    },
    health: input.health ?? { status: "ready", checkFn: "media-analysis.local" },
    uiSurfaces: ["review", "tools"],
    metadata: {
      runnerKind: "local-media-analysis-provider-runner",
      supportedModes: ["local-command-dry-run"],
      supportedContainers: ["png", "jpeg", "gif", "webp", "mp4", "webm", "wav", "flac"],
      semanticTranscription: "unsupported",
      defaultSandboxCommand: "media-analysis-runner inspect --fixture dry-run",
      defaultSandboxArgv: ["inspect", "--fixture", "dry-run"],
      sandboxCommandOperationId: "media.analysis.local_dry_run",
      providerCredentialsUsed: false,
      networkUsed: false,
      liveRunnerStarted: false,
    },
  };
}

export function createBuiltInAgentOsExtensionManifests(): readonly AgentOsExtensionManifest[] {
  return [
    createBrowserExtensionManifest(),
    createComfyUiExtensionManifest(),
    createMemefastExtensionManifest(),
    createMediaUnderstandingExtensionManifest(),
    createMcpExtensionManifest(),
    createVoiceLiveAudioExtensionManifest(),
    createWebExtensionManifest(),
    createXTwitterExtensionManifest(),
  ];
}

export function createAgentOsExtensionMatrix(
  manifests: readonly AgentOsExtensionManifest[],
): AgentOsExtensionMatrix {
  const entries = [...dedupeManifests(manifests)]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(toMatrixEntry);
  return {
    summary: summarize(entries),
    entries,
    byCapability: groupByCapability(entries),
  };
}

function capability(
  id: string,
  label: string,
  readOnly: boolean,
  requiresApproval?: boolean,
  risk?: "high" | "low" | "medium",
): AgentOsExtensionCapability {
  return {
    id,
    label,
    readOnly,
    ...(requiresApproval === undefined ? {} : { requiresApproval }),
    ...(risk === undefined ? {} : { risk }),
  };
}

function tool(
  name: string,
  capabilityId: string,
  readOnly: boolean,
  requiresApproval?: boolean,
): AgentOsExtensionTool {
  return {
    name,
    capabilityId,
    readOnly,
    ...(requiresApproval === undefined ? {} : { requiresApproval }),
  };
}

function dedupeManifests(
  manifests: readonly AgentOsExtensionManifest[],
): readonly AgentOsExtensionManifest[] {
  const byId = new Map<string, AgentOsExtensionManifest>();
  for (const manifest of manifests) {
    if (!byId.has(manifest.id)) {
      byId.set(manifest.id, normalizeManifest(manifest));
    }
  }
  return [...byId.values()];
}

function normalizeManifest(manifest: AgentOsExtensionManifest): AgentOsExtensionManifest {
  return {
    ...manifest,
    capabilities: dedupeById(manifest.capabilities),
    tools: dedupeByName(manifest.tools),
    uiSurfaces: [...new Set(manifest.uiSurfaces)].sort(),
  };
}

function dedupeById(
  capabilities: readonly AgentOsExtensionCapability[],
): readonly AgentOsExtensionCapability[] {
  return [...new Map(capabilities.map((capability) => [capability.id, capability])).values()];
}

function dedupeByName(tools: readonly AgentOsExtensionTool[]): readonly AgentOsExtensionTool[] {
  return [...new Map(tools.map((toolEntry) => [toolEntry.name, toolEntry])).values()];
}

function toMatrixEntry(manifest: AgentOsExtensionManifest): AgentOsExtensionMatrixEntry {
  return {
    id: manifest.id,
    kind: manifest.kind,
    displayName: manifest.displayName,
    ...(manifest.providerId === undefined ? {} : { providerId: manifest.providerId }),
    capabilityIds: manifest.capabilities.map((capability) => capability.id),
    capabilities: manifest.capabilities,
    tools: manifest.tools,
    providerAccounts: manifest.providerAccounts,
    secrets: manifest.secrets,
    installPolicy: manifest.installPolicy,
    health: manifest.health,
    sandbox: manifest.sandboxPolicy,
    sourceTrust: manifest.sourceTrust,
    uiSurfaces: manifest.uiSurfaces,
    ...(manifest.metadata === undefined ? {} : { metadata: manifest.metadata }),
  };
}

function summarize(entries: readonly AgentOsExtensionMatrixEntry[]): AgentOsExtensionMatrixSummary {
  return {
    total: entries.length,
    ready: countHealth(entries, "ready"),
    needsAuth: countHealth(entries, "needs-auth"),
    needsSetup: countHealth(entries, "needs-setup"),
    disabled: countHealth(entries, "disabled"),
    problem: countHealth(entries, "problem"),
  };
}

function countHealth(
  entries: readonly AgentOsExtensionMatrixEntry[],
  status: AgentOsExtensionHealthStatus,
): number {
  return entries.filter((entry) => entry.health.status === status).length;
}

function groupByCapability(
  entries: readonly AgentOsExtensionMatrixEntry[],
): Readonly<Record<string, readonly AgentOsExtensionMatrixEntry[]>> {
  const grouped: Record<string, AgentOsExtensionMatrixEntry[]> = {};
  for (const entry of entries) {
    for (const capabilityId of entry.capabilityIds) {
      grouped[capabilityId] = [...(grouped[capabilityId] ?? []), entry];
    }
  }
  return Object.fromEntries(
    Object.entries(grouped).map(([capabilityId, capabilityEntries]) => [
      capabilityId,
      capabilityEntries.sort((left, right) => left.id.localeCompare(right.id)),
    ]),
  );
}
