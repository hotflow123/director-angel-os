import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type {
  ExternalToolControlPlane,
  ExternalToolExecutionSnapshot,
} from "@hotflow/conversation-runtime";
import type {
  RuntimeCapabilitySnapshot,
  RuntimeHealthStatus,
} from "@hotflow/director-host-contracts";
import type { WebExperienceFetchText } from "@hotflow/director-knowledge";
import {
  type AppendOnlyFileLearningObservationSinkOptions,
  type DirectorAdapterManifest,
  DirectorAdapterRegistry,
  type DirectorApiProviderAdapter,
  type DirectorApiProviderCapability,
  type DirectorApiProviderDefaults,
  type DirectorSwitchState,
  createMockExecutionAdapter,
  createMockHostAdapter,
  createMockMediaAdapter,
  loadDirectorAdapterRegistry,
  loadDirectorApiProviderConfig,
  loadDirectorSwitchState,
} from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";

export const DEFAULT_HOST_ADAPTER_ID = "director-host-api";
export const PREVIEW_EXECUTION_ADAPTER_ID = "beta1-handoff-preview";

export interface MaterializeDirectorHostRuntimeCapabilitySnapshotOptions {
  readonly capturedAt?: string;
  readonly notes?: readonly string[];
  readonly runtimeId?: string;
  readonly status?: RuntimeHealthStatus;
}

export interface DirectorHostConfig {
  readonly workspaceRoot: string;
  readonly dataDir: string;
  readonly defaultProvider: string;
  readonly defaultModel: string;
}

export interface DirectorHostApiProviderSummary {
  readonly id: string;
  readonly platform: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly apiKeyConfigured: boolean;
  readonly modelCount: number;
  readonly metadataCount: number;
  readonly capabilities: readonly DirectorApiProviderCapability[];
  readonly defaultModels: DirectorApiProviderDefaults;
}

export interface DirectorHostSessionStore {
  close(): void;
}

export interface DirectorHostExternalToolExecutionQueue {
  list(): readonly ExternalToolExecutionSnapshot[];
}

export interface DirectorHostRuntime {
  readonly config: DirectorHostConfig;
  readonly providerIds: readonly string[];
  readonly apiProviders: readonly DirectorHostApiProviderSummary[];
  readonly internalPluginIds: readonly string[];
  readonly adapterRegistry: DirectorAdapterRegistry;
  readonly externalToolControlPlane?: ExternalToolControlPlane;
  readonly externalToolExecutionQueue?: DirectorHostExternalToolExecutionQueue;
  readonly runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot;
  readonly sessionStore: DirectorHostSessionStore;
  readonly switchPath: string;
  readonly switchState: DirectorSwitchState;
  readonly observationPath: string;
}

export interface BootstrapDirectorHostApiOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly experienceFetchText?: WebExperienceFetchText;
  readonly externalToolControlPlane?: ExternalToolControlPlane;
  readonly externalToolExecutionQueue?: DirectorHostExternalToolExecutionQueue;
  readonly internalPluginIds?: readonly string[];
  readonly now?: () => string;
  readonly providerIds?: readonly string[];
}

export function bootstrapDirectorHostApi(
  options: BootstrapDirectorHostApiOptions = {},
): DirectorHostRuntime {
  const env = options.env ?? process.env;
  const workspaceRoot = resolve(
    env.HOTFLOW_WORKSPACE_ROOT ?? detectWorkspaceRoot(options.cwd ?? process.cwd()),
  );
  const dataDir = resolve(env.HOTFLOW_DATA_DIR ?? join(workspaceRoot, ".hotflow"));
  const now = options.now ?? defaultNowIso;
  const providerIds = dedupeStrings(resolveProviderIds(env, options.providerIds));
  const internalPluginIds = dedupeStrings(options.internalPluginIds ?? []);
  const directorWorkspace = resolveDirectorWorkspace({ root: workspaceRoot });
  const switchPath = resolve(workspaceRoot, ".director-angel", "runtime", "switches.json");
  const observationPath = resolve(directorWorkspace.runtime, "observations.ndjson");
  const switchState = loadDirectorSwitchState(switchPath);
  const apiProviderConfig = loadDirectorApiProviderConfig(
    join(directorWorkspace.root, "providers"),
  );
  const apiProviders = summarizeDirectorHostApiProviders(apiProviderConfig.document.providers);
  const persistedRegistry = loadDirectorAdapterRegistry(directorWorkspace.adaptersRegistry);
  const adapterRegistry = new DirectorAdapterRegistry(
    mergeAdapterManifests([
      createMockHostAdapter({
        adapterId: DEFAULT_HOST_ADAPTER_ID,
        provider: DEFAULT_HOST_ADAPTER_ID,
        notes: [`Workspace: ${workspaceRoot}`],
      }),
      ...createApiProviderBridgeMediaAdapters(apiProviderConfig.document.providers, env),
      ...providerIds.map((providerId) =>
        createMockMediaAdapter({
          adapterId: providerId,
          provider: providerId,
          notes: [
            `Mock media adapter for provider ${providerId}.`,
            "Preview-safe Beta-1 registry entry.",
          ],
        }),
      ),
      createMockExecutionAdapter({
        adapterId: PREVIEW_EXECUTION_ADAPTER_ID,
        provider: DEFAULT_HOST_ADAPTER_ID,
        notes: ["Preview-only execution handoff adapter."],
      }),
      ...persistedRegistry.documents.map(toPersistedAdapterManifest),
    ]),
  );
  const runtimeStatus = providerIds.length > 0 ? "ready" : "degraded";

  const runtime: DirectorHostRuntime = {
    config: {
      workspaceRoot,
      dataDir,
      defaultProvider: env.HOTFLOW_DEFAULT_PROVIDER ?? "scripted",
      defaultModel: env.HOTFLOW_DEFAULT_MODEL ?? "hotflow-phase1",
    },
    providerIds,
    apiProviders,
    internalPluginIds,
    adapterRegistry,
    ...(options.externalToolControlPlane === undefined
      ? {}
      : { externalToolControlPlane: options.externalToolControlPlane }),
    ...(options.externalToolExecutionQueue === undefined
      ? {}
      : { externalToolExecutionQueue: options.externalToolExecutionQueue }),
    runtimeCapabilitySnapshot: adapterRegistry.buildRuntimeCapabilitySnapshot({
      runtimeId: DEFAULT_HOST_ADAPTER_ID,
      capturedAt: now(),
      runtimeStatus,
      switchState,
      notes: buildRuntimeNotes({
        workspaceRoot,
        providerIds,
        persistedRegistry,
        switchState,
      }),
    }),
    sessionStore: {
      close(): void {
        // Alpha host API is preflight-only, so it does not own a long-lived session store yet.
      },
    },
    switchPath,
    switchState,
    observationPath,
  };

  return runtime;
}

export function summarizeDirectorHostApiProviders(
  providers: readonly DirectorApiProviderAdapter[],
): readonly DirectorHostApiProviderSummary[] {
  return providers.map((provider) => ({
    id: provider.id,
    platform: provider.platform,
    name: provider.name,
    enabled: provider.enabled,
    apiKeyConfigured: provider.apiKeyConfigured,
    modelCount: provider.models.length,
    metadataCount: provider.modelMetadata.length,
    capabilities: [...provider.capabilities],
    defaultModels: { ...provider.defaultModels },
  }));
}

export function createDirectorObservationSinkOptions(
  runtime: DirectorHostRuntime,
): AppendOnlyFileLearningObservationSinkOptions {
  return {
    path: runtime.observationPath,
  };
}

export function materializeDirectorHostRuntimeCapabilitySnapshot(
  runtime: DirectorHostRuntime,
  options: MaterializeDirectorHostRuntimeCapabilitySnapshotOptions = {},
): RuntimeCapabilitySnapshot {
  const notes = dedupeStrings([
    ...(runtime.runtimeCapabilitySnapshot.notes ?? []),
    ...(options.notes ?? []),
  ]);

  return runtime.adapterRegistry.buildRuntimeCapabilitySnapshot({
    runtimeId: options.runtimeId ?? DEFAULT_HOST_ADAPTER_ID,
    capturedAt: options.capturedAt ?? runtime.runtimeCapabilitySnapshot.capturedAt,
    runtimeStatus: options.status ?? runtime.runtimeCapabilitySnapshot.status,
    switchState: runtime.switchState,
    notes,
  });
}

function defaultNowIso(): string {
  return new Date().toISOString();
}

function resolveProviderIds(
  env: NodeJS.ProcessEnv,
  optionProviderIds: readonly string[] | undefined,
): string[] {
  const envProviderIds = dedupeStrings(
    [
      "scripted",
      env.HOTFLOW_DEFAULT_PROVIDER,
      ...(env.DIRECTOR_HOST_API_PROVIDER_IDS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  );

  return dedupeStrings([...(optionProviderIds ?? []), ...envProviderIds]);
}

function buildRuntimeNotes(input: {
  readonly workspaceRoot: string;
  readonly providerIds: readonly string[];
  readonly persistedRegistry: ReturnType<typeof loadDirectorAdapterRegistry>;
  readonly switchState: DirectorSwitchState;
}): string[] {
  return dedupeStrings([
    input.providerIds.length > 0
      ? `Registered provider adapters: ${input.providerIds.join(", ")}.`
      : "No external providers are registered yet; runtime remains preview-only.",
    `Switch source: ${input.switchState.source}.`,
    `Switch path: ${input.switchState.path ?? "(defaults)"}.`,
    `Workspace: ${input.workspaceRoot}.`,
    ...input.persistedRegistry.notes,
    ...input.persistedRegistry.issues,
    ...input.switchState.notes,
    ...input.switchState.issues,
  ]);
}

function mergeAdapterManifests(
  manifests: readonly DirectorAdapterManifest[],
): DirectorAdapterManifest[] {
  const merged = new Map<string, DirectorAdapterManifest>();
  for (const manifest of manifests) {
    merged.set(manifest.adapterId, manifest);
  }
  return [...merged.values()];
}

function toPersistedAdapterManifest(
  document: ReturnType<typeof loadDirectorAdapterRegistry>["documents"][number],
): DirectorAdapterManifest {
  return {
    adapterId: document.adapterId,
    adapterKind: document.adapterKind,
    provider: document.provider,
    ...(document.displayName === undefined ? {} : { displayName: document.displayName }),
    ...(document.bindingId === undefined ? {} : { bindingId: document.bindingId }),
    ...(document.enabled === undefined ? {} : { enabled: document.enabled }),
    healthStatus: document.healthStatus,
    dryRunSupported: document.dryRunSupported,
    mockOnly: document.mockOnly,
    ...(document.riskLevel === undefined ? {} : { riskLevel: document.riskLevel }),
    ...(document.approvalMode === undefined ? {} : { approvalMode: document.approvalMode }),
    ...(document.permissionScopes === undefined
      ? {}
      : { permissionScopes: [...document.permissionScopes] }),
    ...(document.dataRetentionPolicy === undefined
      ? {}
      : { dataRetentionPolicy: document.dataRetentionPolicy }),
    ...(document.rateLimitPolicy === undefined
      ? {}
      : { rateLimitPolicy: document.rateLimitPolicy }),
    ...(document.budgetPolicy === undefined ? {} : { budgetPolicy: document.budgetPolicy }),
    supportedActionClasses: [...document.supportedActionClasses],
    ...(document.availableProfiles === undefined
      ? {}
      : { availableProfiles: [...document.availableProfiles] }),
    ...(document.bridge === undefined ? {} : { bridge: document.bridge }),
    ...(document.mediaCapability === undefined
      ? {}
      : { mediaCapability: document.mediaCapability }),
    notes: dedupeStrings([
      ...(document.notes ?? []),
      `Persisted adapter registry manifest v${document.version}.`,
      `Registry source: ${document.source}.`,
    ]),
    ...(document.priority === undefined ? {} : { priority: document.priority }),
  };
}

function createApiProviderBridgeMediaAdapters(
  providers: readonly DirectorApiProviderAdapter[],
  env: NodeJS.ProcessEnv,
): DirectorAdapterManifest[] {
  return providers.filter(isBridgeEligibleApiProvider).map((provider) => {
    const supportsImage = provider.capabilities.includes("image_generation");
    const supportsVideo = provider.capabilities.includes("video_generation");
    const supportedModes = [
      ...(supportsImage ? (["text_to_image"] as const) : []),
      ...(supportsVideo ? (["text_to_video"] as const) : []),
    ];
    const outputArtifactTypes = [
      ...(supportsImage ? (["image"] as const) : []),
      ...(supportsVideo ? (["video"] as const) : []),
    ];

    return {
      adapterId: provider.id,
      adapterKind: "media",
      provider: provider.id,
      bindingId: provider.id,
      displayName: `${provider.name} 执行桥`,
      enabled: true,
      healthStatus: "ready",
      dryRunSupported: true,
      mockOnly: false,
      riskLevel: "medium",
      approvalMode: "operator_approve",
      permissionScopes: [`api-provider:${provider.id}`, "network:outbound", "media:generate"],
      dataRetentionPolicy:
        "Local Director bridge forwards approved assignment prompts to the configured API provider.",
      rateLimitPolicy:
        "One bridge submission per approved assignment; provider account limits apply.",
      budgetPolicy: "Operator-approved side-effect execution; configured provider billing applies.",
      supportedActionClasses: ["generate", "route", "review"],
      mediaCapability: {
        adapterId: provider.id,
        adapterKind: "media",
        provider: provider.id,
        modelFamily: provider.platform,
        supportedModes,
        inputModalities: ["text"],
        outputArtifactTypes,
        supportsAsync: true,
        healthStatus: "ready",
      },
      bridge: {
        kind: "http-json",
        baseUrl: resolveApiProviderBridgeBaseUrl(env),
        submitPath: "/v1/bridges/api-provider/media-submit",
        timeoutMs: 120_000,
      },
      notes: [
        "Configured API provider is exposed through the local Director bridge.",
        "Bridge endpoint translates Director assignment envelopes into provider API calls.",
      ],
      priority: 90,
    };
  });
}

function isBridgeEligibleApiProvider(provider: DirectorApiProviderAdapter): boolean {
  return (
    provider.enabled &&
    provider.apiKeyConfigured &&
    (provider.capabilities.includes("image_generation") ||
      provider.capabilities.includes("video_generation"))
  );
}

function resolveApiProviderBridgeBaseUrl(env: NodeJS.ProcessEnv): string {
  const explicit = env.DIRECTOR_API_PROVIDER_BRIDGE_BASE_URL?.trim();
  if (explicit) {
    return explicit;
  }
  const host = env.DIRECTOR_HOST_API_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(env.DIRECTOR_HOST_API_PORT ?? "", 10);
  return `http://${host}:${Number.isSafeInteger(port) && port > 0 ? port : 3201}`;
}

function detectWorkspaceRoot(startCwd: string): string {
  let current = resolve(startCwd);

  while (true) {
    if (hasWorkspaceMarkers(current)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return startCwd;
    }
    current = parent;
  }
}

function hasWorkspaceMarkers(directory: string): boolean {
  return (
    existsSync(join(directory, "pnpm-workspace.yaml")) ||
    (existsSync(join(directory, "package.json")) && existsSync(join(directory, "turbo.json")))
  );
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
