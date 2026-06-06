import type {
  ActionClass,
  DirectorRuntimeCapabilities,
  RuntimeHealthStatus,
} from "@hotflow/director-core";
import type {
  DirectorActionClass,
  MediaCapabilityProfile,
  MediaExecutionMode,
  RuntimeCapabilityAdapter,
  RuntimeCapabilityAdapterBridge,
  RuntimeCapabilitySnapshot,
} from "@hotflow/director-host-contracts";

import { matchMediaRouteFromManifests } from "./matcher.js";
import { isDirectorAdapterEnabled, isDirectorFeatureEnabled } from "./switches.js";
import type {
  DirectorAdapterManifest,
  DirectorAdapterRegistryPort,
  DirectorCoreRuntimeOptions,
  DirectorMediaRouteMatch,
  DirectorMediaRouteRequest,
  DirectorRuntimeSnapshotOptions,
  DirectorSwitchState,
} from "./types.js";

function bindingIdOf(manifest: DirectorAdapterManifest): string {
  return manifest.bindingId ?? manifest.adapterId;
}

function mapActionClass(actionClass: ActionClass): DirectorActionClass {
  if (actionClass === "read") {
    return "read";
  }
  if (actionClass === "generate") {
    return "generate";
  }
  if (actionClass === "publish") {
    return "publish";
  }
  return "write";
}

function adapterEnabled(
  manifest: DirectorAdapterManifest,
  switchState: DirectorSwitchState | undefined,
): boolean {
  if (manifest.enabled === false) {
    return false;
  }

  if (switchState === undefined) {
    return true;
  }

  if (!isDirectorFeatureEnabled(switchState, "director.enabled")) {
    return false;
  }

  if (
    manifest.adapterKind === "host" &&
    !isDirectorFeatureEnabled(switchState, "hostAdapters.enabled")
  ) {
    return false;
  }

  if (
    manifest.adapterKind === "media" &&
    !isDirectorFeatureEnabled(switchState, "mediaAdapters.enabled")
  ) {
    return false;
  }

  return isDirectorAdapterEnabled(switchState, manifest.adapterId);
}

function supportsVideo(manifest: DirectorAdapterManifest): boolean {
  const modes = manifest.mediaCapability?.supportedModes ?? [];
  return modes.includes("text_to_video") || modes.includes("image_to_video");
}

function buildBridgeHeaderKeys(headers: Readonly<Record<string, string>> | undefined): string[] {
  if (headers === undefined) {
    return [];
  }

  return Object.keys(headers).sort((left, right) => left.localeCompare(right));
}

function resolveBridgeAuthMode(
  manifest: DirectorAdapterManifest,
): RuntimeCapabilityAdapterBridge["authMode"] {
  if (manifest.bridge?.authEnvVar !== undefined) {
    return "env";
  }

  if (buildBridgeHeaderKeys(manifest.bridge?.headers).length > 0) {
    return "static";
  }

  return "none";
}

function toRuntimeCapabilityAdapterBridge(
  manifest: DirectorAdapterManifest,
): RuntimeCapabilityAdapterBridge | undefined {
  if (manifest.bridge?.kind !== "http-json") {
    return undefined;
  }

  const endpoint = new URL(manifest.bridge.submitPath, manifest.bridge.baseUrl);
  const headerKeys = buildBridgeHeaderKeys(manifest.bridge.headers);

  return {
    kind: "http-json",
    endpointOrigin: endpoint.origin,
    endpointPath: endpoint.pathname,
    authMode: resolveBridgeAuthMode(manifest),
    timeoutMs: manifest.bridge.timeoutMs ?? 30_000,
    ...(headerKeys.length === 0 ? {} : { headerKeys }),
  };
}

function deriveRuntimeStatus(
  manifests: readonly DirectorAdapterManifest[],
  switchState: DirectorSwitchState | undefined,
  statusHint: RuntimeHealthStatus | undefined,
): RuntimeHealthStatus {
  const active = manifests.filter((manifest) => adapterEnabled(manifest, switchState));
  if (statusHint === "offline") {
    return "offline";
  }
  if (active.length === 0) {
    return statusHint ?? "degraded";
  }
  if (active.every((manifest) => manifest.healthStatus === "offline")) {
    return "offline";
  }
  if (
    statusHint === "degraded" ||
    active.some((manifest) => manifest.healthStatus === "degraded")
  ) {
    return "degraded";
  }
  return statusHint ?? "ready";
}

function toRuntimeCapabilityAdapter(
  manifest: DirectorAdapterManifest,
  switchState: DirectorSwitchState | undefined,
): RuntimeCapabilityAdapter {
  const bridge = toRuntimeCapabilityAdapterBridge(manifest);

  return {
    adapterId: manifest.adapterId,
    adapterKind: manifest.adapterKind,
    provider: manifest.provider,
    enabled: adapterEnabled(manifest, switchState),
    healthStatus: manifest.healthStatus,
    dryRunSupported: manifest.dryRunSupported,
    mockOnly: manifest.mockOnly,
    ...(manifest.riskLevel === undefined ? {} : { riskLevel: manifest.riskLevel }),
    ...(manifest.approvalMode === undefined ? {} : { approvalMode: manifest.approvalMode }),
    ...(manifest.permissionScopes === undefined
      ? {}
      : { permissionScopes: [...manifest.permissionScopes] }),
    ...(manifest.dataRetentionPolicy === undefined
      ? {}
      : { dataRetentionPolicy: manifest.dataRetentionPolicy }),
    ...(manifest.rateLimitPolicy === undefined
      ? {}
      : { rateLimitPolicy: manifest.rateLimitPolicy }),
    ...(manifest.budgetPolicy === undefined ? {} : { budgetPolicy: manifest.budgetPolicy }),
    ...(bridge === undefined ? {} : { bridge }),
    ...(manifest.supportedActionClasses.length === 0
      ? {}
      : {
          supportedActionClasses: manifest.supportedActionClasses.map(mapActionClass),
        }),
    ...(manifest.availableProfiles === undefined
      ? {}
      : { availableProfiles: [...manifest.availableProfiles] }),
    ...(manifest.mediaCapability === undefined
      ? {}
      : { mediaCapability: manifest.mediaCapability }),
    ...(manifest.notes === undefined ? {} : { notes: [...manifest.notes] }),
  };
}

export class DirectorAdapterRegistry implements DirectorAdapterRegistryPort {
  private readonly manifests: DirectorAdapterManifest[];

  public constructor(manifests: readonly DirectorAdapterManifest[] = []) {
    this.manifests = [...manifests];
  }

  public listAll(): readonly DirectorAdapterManifest[] {
    return [...this.manifests];
  }

  public listByKind(
    kind: DirectorAdapterManifest["adapterKind"],
  ): readonly DirectorAdapterManifest[] {
    return this.manifests.filter((manifest) => manifest.adapterKind === kind);
  }

  public buildRuntimeCapabilitySnapshot(
    options: DirectorRuntimeSnapshotOptions,
  ): RuntimeCapabilitySnapshot {
    const adapterKinds = options.adapterKinds;
    const includeDisabled = options.includeDisabled ?? true;
    const includeMockOnly = options.includeMockOnly ?? true;
    const filtered = this.manifests
      .filter(
        (manifest) => adapterKinds === undefined || adapterKinds.includes(manifest.adapterKind),
      )
      .filter((manifest) => includeMockOnly || !manifest.mockOnly)
      .map((manifest) => toRuntimeCapabilityAdapter(manifest, options.switchState))
      .filter((adapter) => includeDisabled || adapter.enabled);

    const status = deriveRuntimeStatus(
      this.manifests.filter(
        (manifest) => adapterKinds === undefined || adapterKinds.includes(manifest.adapterKind),
      ),
      options.switchState,
      options.runtimeStatus,
    );

    const notes = [
      ...(options.notes ?? []),
      ...(options.switchState?.notes ?? []),
      ...(options.switchState?.issues ?? []),
    ];

    return {
      snapshotId: `capability-${options.runtimeId}`,
      runtimeId: options.runtimeId,
      capturedAt: options.capturedAt ?? new Date().toISOString(),
      status,
      adapters: filtered,
      ...(notes.length === 0 ? {} : { notes }),
    };
  }

  public deriveCoreRuntimeCapabilities(
    options: DirectorCoreRuntimeOptions,
  ): DirectorRuntimeCapabilities {
    const visibleMedia = this.manifests.filter(
      (manifest) =>
        manifest.adapterKind === "media" && adapterEnabled(manifest, options.switchState),
    );

    return {
      runtimeId: options.runtimeId,
      status: deriveRuntimeStatus(this.manifests, options.switchState, options.runtimeStatus),
      availableBindings: visibleMedia.map(bindingIdOf),
      maxPromptChars: options.maxPromptChars,
      supportsVideo: visibleMedia.some(supportsVideo),
      ...(options.deterministicMode === undefined
        ? {}
        : { deterministicMode: options.deterministicMode }),
    };
  }

  public matchMediaRoute(request: DirectorMediaRouteRequest): DirectorMediaRouteMatch {
    return matchMediaRouteFromManifests(this.manifests, request);
  }
}

export function createMockHostAdapter(
  input: {
    readonly adapterId?: string;
    readonly provider?: string;
    readonly displayName?: string;
    readonly healthStatus?: RuntimeHealthStatus;
    readonly notes?: readonly string[];
  } = {},
): DirectorAdapterManifest {
  return {
    adapterId: input.adapterId ?? "director-host-api",
    adapterKind: "host",
    provider: input.provider ?? "director-host-api",
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    enabled: true,
    healthStatus: input.healthStatus ?? "ready",
    dryRunSupported: true,
    mockOnly: true,
    supportedActionClasses: ["read", "write"],
    ...(input.notes === undefined ? {} : { notes: [...input.notes] }),
  };
}

export function createMockMediaAdapter(input: {
  readonly adapterId: string;
  readonly provider?: string;
  readonly bindingId?: string;
  readonly displayName?: string;
  readonly healthStatus?: RuntimeHealthStatus;
  readonly supportedModes?: readonly MediaExecutionMode[];
  readonly notes?: readonly string[];
  readonly priority?: number;
}): DirectorAdapterManifest {
  const supportedModes = input.supportedModes ?? ["text_to_image", "text_to_video"];
  const outputArtifactTypes = supportedModes.some(
    (mode) => mode === "text_to_video" || mode === "image_to_video",
  )
    ? (["image", "video"] as const)
    : (["image"] as const);
  const mediaCapability: MediaCapabilityProfile = {
    adapterId: input.adapterId,
    adapterKind: "media",
    provider: input.provider ?? input.adapterId,
    supportedModes: [...supportedModes],
    inputModalities: ["text"],
    outputArtifactTypes: [...outputArtifactTypes],
    supportsAsync: false,
    healthStatus: input.healthStatus ?? "ready",
  };

  return {
    adapterId: input.adapterId,
    adapterKind: "media",
    provider: input.provider ?? input.adapterId,
    ...(input.bindingId === undefined ? {} : { bindingId: input.bindingId }),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    enabled: true,
    healthStatus: input.healthStatus ?? "ready",
    dryRunSupported: true,
    mockOnly: true,
    supportedActionClasses: ["generate", "route", "review"],
    mediaCapability,
    ...(input.notes === undefined ? {} : { notes: [...input.notes] }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  };
}

export function createMockExecutionAdapter(
  input: {
    readonly adapterId?: string;
    readonly provider?: string;
    readonly displayName?: string;
    readonly healthStatus?: RuntimeHealthStatus;
    readonly notes?: readonly string[];
  } = {},
): DirectorAdapterManifest {
  return {
    adapterId: input.adapterId ?? "beta1-handoff-preview",
    adapterKind: "execution",
    provider: input.provider ?? "director-host-api",
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    enabled: true,
    healthStatus: input.healthStatus ?? "ready",
    dryRunSupported: true,
    mockOnly: true,
    supportedActionClasses: ["write"],
    ...(input.notes === undefined ? {} : { notes: [...input.notes] }),
  };
}
