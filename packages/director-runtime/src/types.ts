import type {
  ActionClass,
  ApprovalMode,
  BindingPolicy,
  CrewRole,
  DirectorRuntimeCapabilities,
  RuntimeHealthStatus,
} from "@hotflow/director-core";
import type {
  AdapterProfileRef,
  AdapterRiskLevel,
  DirectorApprovalMode,
  RuntimeCapabilitySnapshot as HostRuntimeCapabilitySnapshot,
  MediaCapabilityProfile,
  OperatorOutcome,
} from "@hotflow/director-host-contracts";

export const DIRECTOR_SWITCH_SCHEMA_ID = "director.switches.v1";
export const DIRECTOR_OBSERVATION_SCHEMA_ID = "director.observation.v1";

export const DIRECTOR_FEATURE_SWITCH_KEYS = [
  "director.enabled",
  "clarification.enabled",
  "crew.enabled",
  "memory.enabled",
  "knowledgeRecall.enabled",
  "learning.enabled",
  "heartbeat.enabled",
  "selfReflection.enabled",
  "contentSafety.developerDebug.enabled",
  "reflection.autoSuggest.enabled",
  "soul.enabled",
  "soul.autoCandidate.enabled",
  "care.enabled",
  "hostAdapters.enabled",
  "mediaAdapters.enabled",
  "autoRoute.enabled",
  "execution.enabled",
  "execution.pause_all",
  "execution.sideEffects.enabled",
  "toolApproval.autoAllowTrustedDesktop.enabled",
  "publish.enabled",
] as const;

export type DirectorFeatureSwitchKey = (typeof DIRECTOR_FEATURE_SWITCH_KEYS)[number];

export const DIRECTOR_FEATURE_SWITCH_DEFAULTS: Readonly<Record<DirectorFeatureSwitchKey, boolean>> =
  {
    "director.enabled": true,
    "clarification.enabled": true,
    "crew.enabled": true,
    "memory.enabled": false,
    "knowledgeRecall.enabled": false,
    "learning.enabled": false,
    "heartbeat.enabled": false,
    "selfReflection.enabled": false,
    "contentSafety.developerDebug.enabled": false,
    "reflection.autoSuggest.enabled": true,
    "soul.enabled": true,
    "soul.autoCandidate.enabled": true,
    "care.enabled": false,
    "hostAdapters.enabled": true,
    "mediaAdapters.enabled": true,
    "autoRoute.enabled": true,
    "execution.enabled": true,
    "execution.pause_all": false,
    "execution.sideEffects.enabled": false,
    "toolApproval.autoAllowTrustedDesktop.enabled": true,
    "publish.enabled": false,
  };

export const DIRECTOR_CREW_ROLE_DEFAULTS: Readonly<Record<CrewRole, boolean>> = {
  researcher: true,
  "script-planner": true,
  "shot-planner": true,
  "asset-router": true,
  "qc-reviewer": true,
};

export type DirectorSwitchStateSource = "defaults" | "file";
export type DirectorAdapterKind = "host" | "media" | "execution";
export type DirectorAdapterBridgeKind = "http-json";
export type DirectorAdapterRiskLevel = AdapterRiskLevel;
export type DirectorAdapterApprovalMode = DirectorApprovalMode;
export type DirectorMatchStatus = "matched" | "partial" | "blocked" | "no_match";
export type DirectorMediaRouteMode = "image" | "video";
export type DirectorObservationSource = "evaluation" | "outcome";
export type DirectorMemoryRecallStatus = "disabled" | "miss" | "hit" | "degraded";
export type DirectorMemoryRecallHitStatus = "completed" | "failed" | "aborted";

export interface DirectorHttpJsonAdapterBridge {
  readonly kind: "http-json";
  readonly baseUrl: string;
  readonly submitPath: string;
  readonly timeoutMs?: number;
  readonly authEnvVar?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type DirectorAdapterBridge = DirectorHttpJsonAdapterBridge;

export interface DirectorSwitchDocument {
  readonly schemaId: typeof DIRECTOR_SWITCH_SCHEMA_ID;
  readonly features?: Partial<Record<DirectorFeatureSwitchKey, boolean>>;
  readonly roleOverrides?: Partial<Record<CrewRole, boolean>>;
  readonly adapterOverrides?: Record<string, boolean>;
}

export interface DirectorSwitchState {
  readonly schemaId: typeof DIRECTOR_SWITCH_SCHEMA_ID;
  readonly source: DirectorSwitchStateSource;
  readonly path?: string;
  readonly features: Readonly<Record<DirectorFeatureSwitchKey, boolean>>;
  readonly roleOverrides: Readonly<Record<CrewRole, boolean>>;
  readonly adapterOverrides: Readonly<Record<string, boolean>>;
  readonly notes: readonly string[];
  readonly issues: readonly string[];
}

export interface DirectorSwitchOverrides {
  readonly source?: DirectorSwitchStateSource;
  readonly path?: string;
  readonly features?: Partial<Record<DirectorFeatureSwitchKey, boolean>>;
  readonly roleOverrides?: Partial<Record<CrewRole, boolean>>;
  readonly adapterOverrides?: Record<string, boolean>;
  readonly notes?: readonly string[];
  readonly issues?: readonly string[];
}

export interface DirectorAdapterManifest {
  readonly adapterId: string;
  readonly adapterKind: DirectorAdapterKind;
  readonly provider: string;
  readonly displayName?: string;
  readonly bindingId?: string;
  readonly enabled?: boolean;
  readonly healthStatus: RuntimeHealthStatus;
  readonly dryRunSupported: boolean;
  readonly mockOnly: boolean;
  readonly riskLevel?: DirectorAdapterRiskLevel;
  readonly approvalMode?: DirectorAdapterApprovalMode;
  readonly permissionScopes?: readonly string[];
  readonly dataRetentionPolicy?: string;
  readonly rateLimitPolicy?: string;
  readonly budgetPolicy?: string;
  readonly supportedActionClasses: readonly ActionClass[];
  readonly availableProfiles?: readonly AdapterProfileRef[];
  readonly mediaCapability?: MediaCapabilityProfile;
  readonly bridge?: DirectorAdapterBridge;
  readonly notes?: readonly string[];
  readonly priority?: number;
}

export interface DirectorRuntimeSnapshotOptions {
  readonly runtimeId: string;
  readonly capturedAt?: string;
  readonly runtimeStatus?: RuntimeHealthStatus;
  readonly switchState?: DirectorSwitchState;
  readonly adapterKinds?: readonly DirectorAdapterKind[];
  readonly includeDisabled?: boolean;
  readonly includeMockOnly?: boolean;
  readonly notes?: readonly string[];
}

export interface DirectorCoreRuntimeOptions {
  readonly runtimeId: string;
  readonly maxPromptChars: number;
  readonly deterministicMode?: DirectorRuntimeCapabilities["deterministicMode"];
  readonly runtimeStatus?: RuntimeHealthStatus;
  readonly switchState?: DirectorSwitchState;
}

export interface DirectorMediaRouteRequest {
  readonly mode: DirectorMediaRouteMode;
  readonly bindingPolicy: BindingPolicy;
  readonly requiredBinding?: string;
  readonly preferredBinding?: string;
  readonly fallbackBindings?: readonly string[];
  readonly actionClass?: ActionClass;
  readonly switchState?: DirectorSwitchState;
  readonly allowDegraded?: boolean;
  readonly allowedAdapterIds?: readonly string[];
}

export interface DirectorMediaRouteMatch {
  readonly status: DirectorMatchStatus;
  readonly selectedAdapterId: string | null;
  readonly selectedBindingId: string | null;
  readonly eligibleAdapterIds: readonly string[];
  readonly eligibleBindings: readonly string[];
  readonly partialAdapterIds: readonly string[];
  readonly reasons: readonly string[];
  readonly missingCapabilities: readonly string[];
}

export interface DirectorAdapterRegistryPort {
  listAll(): readonly DirectorAdapterManifest[];
  buildRuntimeCapabilitySnapshot(
    options: DirectorRuntimeSnapshotOptions,
  ): HostRuntimeCapabilitySnapshot;
  deriveCoreRuntimeCapabilities(options: DirectorCoreRuntimeOptions): DirectorRuntimeCapabilities;
  matchMediaRoute(request: DirectorMediaRouteRequest): DirectorMediaRouteMatch;
}

export interface DirectorKnowledgePackRef {
  readonly knowledgePackId: string;
  readonly title?: string;
  readonly version?: number;
  readonly tags?: readonly string[];
  readonly reason?: string;
}

export interface DirectorWorkingContext {
  readonly snapshotId: string;
  readonly runtimeId: string;
  readonly operatorId: string | null;
  readonly goal?: string;
  readonly projectLabel?: string;
  readonly projectId?: string;
  readonly groupId?: string;
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly sceneCount?: number;
  readonly continuityPriority?: string;
  readonly anchorIds: readonly string[];
}

export interface DirectorRecallHints {
  readonly preferredBindings: readonly string[];
  readonly requiredBindings: readonly string[];
  readonly fallbackBindings: readonly string[];
  readonly continuityAnchorIds: readonly string[];
  readonly knowledgeSignalTags: readonly string[];
  readonly deliverables: readonly string[];
}

export interface DirectorMemoryRecallRequest {
  readonly workingContext: DirectorWorkingContext;
  readonly recallHints: DirectorRecallHints;
}

export interface DirectorMemoryRecallHitProvenance {
  readonly runId: string;
  readonly reportId: string;
  readonly observationIds: readonly string[];
}

export interface DirectorMemoryRecallHit {
  readonly recordId: string;
  readonly summary: string;
  readonly status: DirectorMemoryRecallHitStatus;
  readonly recordedAt: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly selectedAdapters: readonly string[];
  readonly provenance: DirectorMemoryRecallHitProvenance;
}

export interface DirectorMemoryRecallResult {
  readonly status: DirectorMemoryRecallStatus;
  readonly knowledgePacks: readonly DirectorKnowledgePackRef[];
  readonly hits: readonly DirectorMemoryRecallHit[];
  readonly notes: readonly string[];
}

export interface DirectorObservationEvaluation {
  readonly decision: "pass" | "warn" | "block";
  readonly actionGraphReadiness: "ready" | "review_required" | "blocked";
  readonly selectedAdapters: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly warnings: readonly string[];
}

export interface DirectorObservationEnvelope {
  readonly schemaId: typeof DIRECTOR_OBSERVATION_SCHEMA_ID;
  readonly observationId: string;
  readonly recordedAt: string;
  readonly source: DirectorObservationSource;
  readonly snapshotId: string;
  readonly runtimeId: string;
  readonly blueprintId?: string;
  readonly handoffId?: string;
  readonly workingContext?: DirectorWorkingContext;
  readonly recallHints?: DirectorRecallHints;
  readonly recalledKnowledgePacks: readonly DirectorKnowledgePackRef[];
  readonly recallStatus: DirectorMemoryRecallStatus;
  readonly recallNotes: readonly string[];
  readonly evaluation?: DirectorObservationEvaluation;
  readonly outcome?: OperatorOutcome;
  readonly notes?: readonly string[];
}

export type { HostRuntimeCapabilitySnapshot };
