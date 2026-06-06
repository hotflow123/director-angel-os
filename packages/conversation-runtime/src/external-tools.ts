import type {
  AgentOsExtensionCapability,
  AgentOsExtensionHealth,
  AgentOsExtensionHealthStatus,
  AgentOsExtensionInstallPolicy,
  AgentOsExtensionKind,
  AgentOsExtensionManifest,
  AgentOsExtensionMatrix,
  AgentOsExtensionMatrixEntry,
  AgentOsExtensionProviderAccount,
  AgentOsExtensionSandboxPolicy,
  AgentOsExtensionSecret,
  AgentOsExtensionSourceTrust,
  AgentOsExtensionTool,
  AgentOsExtensionUiSurface,
} from "@hotflow/agent-os-extensions";
import {
  createAgentOsExtensionMatrix,
  createBuiltInAgentOsExtensionManifests,
} from "@hotflow/agent-os-extensions";
import type {
  AgentOsPolicyVerdict,
  AgentOsSandboxPreflight,
} from "@hotflow/agent-os-kernel-contracts";
import { isAgentOsSandboxPreflight } from "@hotflow/agent-os-kernel-contracts";
import type {
  AgentOsSandboxBackendAdmission,
  AgentOsSandboxBackendRegistry,
  AgentOsSandboxBackendRegistryOptions,
  AgentOsSandboxCommandExecutionResult,
  AgentOsSandboxExecutionPlan,
  AgentOsSandboxNetworkPolicy,
  AgentOsSandboxRuntimePolicy,
} from "@hotflow/agent-os-sandbox";
import {
  admitAgentOsSandboxExecution,
  createAgentOsSandboxBackendRegistry,
  executeAgentOsSandboxCommand,
  planAgentOsSandboxExecution,
} from "@hotflow/agent-os-sandbox";
import type {
  AgentOsSandboxPolicy,
  PolicyRuntime,
  ToolApprovalContext,
  ToolCapability,
  ToolRiskLevel,
} from "@hotflow/policy-runtime";
import { createAgentOsExecutionPolicyPreflight } from "@hotflow/policy-runtime";

import type { ConversationRuntimeApprovalLedger } from "./approval-ledger.js";
import type {
  ConversationRuntimeExternalArtifactRetention,
  ConversationRuntimeExternalArtifactSensitivity,
  ConversationRuntimeExternalArtifactStore,
  ConversationRuntimeExternalArtifactStoreWriteResult,
} from "./external-artifact-store.js";
import type { ExternalProviderManifest, ExternalProviderStatus } from "./external-provider-auth.js";
import type {
  ConversationRuntimeModelToolDefinition,
  ConversationRuntimeToolExecutionInput,
  ConversationRuntimeToolExecutionOutput,
  ConversationRuntimeToolExecutorPort,
} from "./model-tool-loop.js";
import type {
  ConversationRuntimePolicyBudget,
  ConversationRuntimePolicyDecisionEnvelope,
} from "./policy-envelope.js";
import { createConversationRuntimePolicyEnvelope } from "./policy-envelope.js";
import { hashConversationRuntimeToolArgs } from "./tool-hooks.js";

const DEFAULT_EXTERNAL_TOOL_SANDBOX_BACKEND_REGISTRY = createAgentOsSandboxBackendRegistry({
  enabledBackends: ["readonly", "workspace-write", "network-limited"],
});

export type ExternalToolSource =
  | "built-in"
  | "director"
  | "external"
  | "mcp"
  | "plugin"
  | (string & {});

export type ExternalToolKind =
  | "adapter"
  | "model-tool"
  | "provider"
  | "tool-source"
  | (string & {});

export type ExternalToolSourceTrustStatus =
  | "built-in"
  | "trusted-local-config"
  | "trusted-plugin"
  | "user-configured"
  | "unverified"
  | "unknown"
  | (string & {});

export type ExternalToolInstallDefaultMode = "execute" | "manual" | "none" | "plan" | (string & {});

export type ExternalToolApprovalBoundaryMode =
  | "none"
  | "operator-confirm"
  | "runtime-policy"
  | "trusted-auto"
  | (string & {});

export type ExternalToolDoctorStatus =
  | "ready"
  | "disabled"
  | "failed"
  | "misconfigured"
  | "missing"
  | "needs-auth"
  | "pending"
  | "unreachable";

export interface ExternalToolProviderCapability {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly readOnly: boolean;
  readonly requiresApproval?: boolean;
  readonly destructive?: boolean;
  readonly openWorld?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolSourceTrust {
  readonly status: ExternalToolSourceTrustStatus;
  readonly label?: string;
  readonly reason?: string;
  readonly sourceRef?: string;
  readonly reviewedAt?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolInstallPolicy {
  readonly supported: boolean;
  readonly defaultMode?: ExternalToolInstallDefaultMode;
  readonly requiresApproval?: boolean;
  readonly requiresExplicitExecute?: boolean;
  readonly allowedMethods?: readonly string[];
  readonly refuses?: readonly string[];
  readonly defaultInstallPath?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolApprovalBoundary {
  readonly mode: ExternalToolApprovalBoundaryMode;
  readonly summary?: string;
  readonly actionLabels?: readonly string[];
  readonly requiresOperator?: boolean;
  readonly riskLevel?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalProviderInstallPlanStatus = "manifest-required" | "planned" | "unsupported";

export interface ExternalProviderInstallPlanStep {
  readonly kind: string;
  readonly summary: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly executable: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalProviderInstallPlanInput {
  readonly toolId: string;
  readonly label?: string;
  readonly source?: ExternalToolSource;
  readonly kind?: ExternalToolKind;
  readonly sourceTrust?: ExternalToolSourceTrust | null;
  readonly installPolicy?: ExternalToolInstallPolicy | null;
  readonly approvalBoundary?: ExternalToolApprovalBoundary | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalProviderInstallPlanResult {
  readonly ok: boolean;
  readonly status: ExternalProviderInstallPlanStatus;
  readonly dryRun: true;
  readonly executed: false;
  readonly toolId: string;
  readonly label: string;
  readonly message: string;
  readonly plan: readonly ExternalProviderInstallPlanStep[];
  readonly nextActions: readonly string[];
  readonly sourceTrust?: ExternalToolSourceTrust | null;
  readonly installPolicy: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolManifest {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly source: ExternalToolSource;
  readonly kind: ExternalToolKind;
  readonly providerId?: string;
  readonly toolName?: string;
  readonly enabled?: boolean;
  readonly auth?: ExternalProviderManifest["auth"];
  readonly contracts?: ExternalProviderManifest["contracts"];
  readonly configSchema?: ExternalProviderManifest["configSchema"];
  readonly configFields?: ExternalProviderManifest["configFields"];
  readonly uiHints?: ExternalProviderManifest["uiHints"];
  readonly providerStatus?: ExternalProviderStatus;
  readonly sourceTrust?: ExternalToolSourceTrust;
  readonly installPolicy?: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly capabilities: readonly ExternalToolProviderCapability[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalToolCatalogEntry = ExternalToolManifest;

export interface ExternalToolDoctorResult {
  readonly status: ExternalToolDoctorStatus;
  readonly summary: string;
  readonly checkedAtMs?: number;
  readonly nextActions?: readonly string[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EffectiveExternalTool extends ExternalToolCatalogEntry {
  readonly status: ExternalToolDoctorStatus;
  readonly canInvoke: boolean;
  readonly doctor: ExternalToolDoctorResult;
  readonly generation: number;
  readonly lastKnownGood?: ExternalToolLastKnownGoodDoctorResult;
  readonly unavailableReason?: string;
}

export interface ExternalToolLastKnownGoodDoctorResult {
  readonly status: "ready";
  readonly summary: string;
  readonly checkedAtMs: number;
  readonly generation: number;
  readonly nextActions?: readonly string[];
  readonly details?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolTraceEntry {
  readonly stage: string;
  readonly detail: string;
  readonly occurredAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolArtifact {
  readonly id: string;
  readonly kind: string;
  readonly path?: string;
  readonly url?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolApprovalRequest {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly actionLabels: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalToolApprovalDecisionStatus = "approved" | "rejected";

export interface ExternalToolApprovalDecision {
  readonly status: ExternalToolApprovalDecisionStatus;
  readonly operatorId?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolInvokeRequest {
  readonly toolId: string;
  readonly operationId?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly command?: string;
  readonly cwd?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly dryRun?: boolean;
  readonly idempotencyKey?: string;
  readonly approval?: ExternalToolApprovalDecision;
  readonly sandboxPreflight?: AgentOsSandboxPreflight;
  readonly sandboxPolicy?: AgentOsSandboxPolicy;
  readonly sandboxRuntimePolicy?: AgentOsSandboxRuntimePolicy;
  readonly requestedNetworkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalSystemControlUserFacingProjection {
  readonly userText: string;
  readonly briefStatus?: string;
  readonly canRetry?: boolean;
  readonly suggestedNextStep?: string;
  readonly attachments?: readonly unknown[];
  readonly developerTraceRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalSystemControlEnvelope {
  readonly schemaVersion: "director.external-system-control.v1";
  readonly systemId: string;
  readonly objective: string;
  readonly toolId: string;
  readonly operationId?: string;
  readonly sessionKey?: string;
  readonly turnId?: string;
  readonly angelRoleProfile?: Readonly<Record<string, unknown>>;
  readonly userFacingProjection?: ExternalSystemControlUserFacingProjection;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CreateExternalSystemControlRequestInput {
  readonly systemId: string;
  readonly toolId: string;
  readonly operationId?: string;
  readonly objective: string;
  readonly sessionKey?: string;
  readonly turnId?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly command?: string;
  readonly cwd?: string;
  readonly dryRun?: boolean;
  readonly idempotencyKey?: string;
  readonly approval?: ExternalToolApprovalDecision;
  readonly sandboxPreflight?: AgentOsSandboxPreflight;
  readonly sandboxPolicy?: AgentOsSandboxPolicy;
  readonly sandboxRuntimePolicy?: AgentOsSandboxRuntimePolicy;
  readonly requestedNetworkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly angelRoleProfile?: Readonly<Record<string, unknown>>;
  readonly userFacingProjection?: ExternalSystemControlUserFacingProjection;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalToolInvokeStatus =
  | "approval-required"
  | "dry-run"
  | "error"
  | "not-found"
  | "permission-denied"
  | "success"
  | "unavailable";

export interface ExternalToolInvokeResult {
  readonly ok: boolean;
  readonly status: ExternalToolInvokeStatus;
  readonly toolId: string;
  readonly operationId?: string;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly artifacts?: readonly ExternalToolArtifact[];
  readonly approval?: ExternalToolApprovalRequest;
  readonly trace: readonly ExternalToolTraceEntry[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolArtifactPersistenceMetadata {
  readonly status: ConversationRuntimeExternalArtifactStoreWriteResult["status"];
  readonly artifactIds: readonly string[];
  readonly notes: readonly string[];
  readonly storeRef: "conversation-runtime.external-artifact-store";
}

export interface ExternalToolControlPlane {
  readonly listCatalog: () =>
    | readonly ExternalToolCatalogEntry[]
    | Promise<readonly ExternalToolCatalogEntry[]>;
  readonly resolveEffective: (
    options?: ResolveEffectiveExternalToolsOptions,
  ) => Promise<readonly EffectiveExternalTool[]> | readonly EffectiveExternalTool[];
  readonly invoke: (
    request: ExternalToolInvokeRequest,
  ) => Promise<ExternalToolInvokeResult> | ExternalToolInvokeResult;
}

export interface ExternalToolsRpcOptions {
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly profile?: string;
  readonly includeUnavailable?: boolean;
  readonly nowMs?: number;
}

export interface ExternalToolsCatalogRpcResult {
  readonly schemaVersion: "director.external-tools.catalog.v1";
  readonly agentId: string;
  readonly catalogCount: number;
  readonly agentOsExtensionMatrix?: AgentOsExternalToolExtensionMatrix;
  readonly groups: readonly ExternalToolsCatalogGroup[];
  readonly catalog: readonly ExternalToolsCatalogEntry[];
}

export interface ExternalToolsCatalogGroup {
  readonly id: string;
  readonly label: string;
  readonly source: ExternalToolSource;
  readonly providerId?: string;
  readonly tools: readonly ExternalToolsCatalogEntry[];
}

export interface ExternalToolsCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly source: ExternalToolSource;
  readonly kind: ExternalToolKind;
  readonly providerId?: string;
  readonly toolName?: string;
  readonly enabled: boolean;
  readonly capabilityCount: number;
  readonly capabilities: readonly ExternalToolsCapabilityEntry[];
  readonly sourceTrust?: ExternalToolSourceTrust;
  readonly installPolicy?: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly auth?: ExternalProviderManifest["auth"];
  readonly contracts?: ExternalProviderManifest["contracts"];
  readonly providerStatus?: ExternalProviderStatus;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolsCapabilityEntry {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly readOnly: boolean;
  readonly requiresApproval: boolean;
  readonly destructive: boolean;
  readonly openWorld: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolsEffectiveRpcResult {
  readonly schemaVersion: "director.external-tools.effective.v1";
  readonly agentId: string;
  readonly sessionKey?: string;
  readonly profile: string;
  readonly effectiveCount: number;
  readonly unavailableCount: number;
  readonly providerMatrix: ExternalToolsProviderCapabilityMatrix;
  readonly agentOsExtensionMatrix?: AgentOsExternalToolExtensionMatrix;
  readonly groups: readonly ExternalToolsEffectiveGroup[];
  readonly tools: readonly ExternalToolsEffectiveEntry[];
}

export interface ExternalToolsProviderCapabilityMatrix {
  readonly schemaVersion: "director.external-tools.provider-matrix.v1";
  readonly providerCount: number;
  readonly readyProviderCount: number;
  readonly providers: readonly ExternalToolsProviderCapabilityMatrixEntry[];
}

export interface ExternalToolsProviderCapabilityMatrixEntry {
  readonly providerId: string;
  readonly label: string;
  readonly source: ExternalToolSource;
  readonly status: ExternalToolDoctorStatus;
  readonly health: ExternalToolDoctorResult;
  readonly healthSummary: ExternalToolsProviderHealthSummary;
  readonly toolIds: readonly string[];
  readonly toolCount: number;
  readonly invokableToolCount: number;
  readonly capabilities: readonly ExternalToolsCapabilityEntry[];
  readonly budget?: ConversationRuntimePolicyBudget;
  readonly budgetSources?: readonly ExternalToolsProviderBudgetSource[];
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly lastKnownGood?: ExternalToolLastKnownGoodDoctorResult;
}

export interface ExternalToolsProviderHealthSummary {
  readonly readyToolCount: number;
  readonly unavailableToolCount: number;
  readonly statusCounts: Readonly<Record<string, number>>;
}

export interface ExternalToolsProviderBudgetSource {
  readonly toolId: string;
  readonly budget: ConversationRuntimePolicyBudget;
}

export interface AgentOsExternalToolExtensionMatrix {
  readonly summary: AgentOsExtensionMatrix["summary"];
  readonly entries: readonly AgentOsExternalToolExtensionMatrixEntry[];
  readonly byCapability: Readonly<
    Record<string, readonly AgentOsExternalToolExtensionMatrixEntry[]>
  >;
}

export interface AgentOsExternalToolExtensionMatrixEntry {
  readonly id: string;
  readonly kind: AgentOsExtensionKind;
  readonly displayName: string;
  readonly providerId?: string;
  readonly capabilityIds: readonly string[];
  readonly health: AgentOsExtensionHealth;
  readonly sandbox: AgentOsExtensionSandboxPolicy;
  readonly sourceTrust: AgentOsExtensionSourceTrust;
  readonly uiSurfaces: readonly AgentOsExtensionUiSurface[];
  readonly toolId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolsEffectiveGroup {
  readonly id: string;
  readonly label: string;
  readonly source: ExternalToolSource;
  readonly providerId?: string;
  readonly tools: readonly ExternalToolsEffectiveEntry[];
}

export interface ExternalToolsEffectiveEntry extends ExternalToolsCatalogEntry {
  readonly status: ExternalToolDoctorStatus;
  readonly canInvoke: boolean;
  readonly doctor: ExternalToolDoctorResult;
  readonly generation: number;
  readonly lastKnownGood?: ExternalToolLastKnownGoodDoctorResult;
  readonly unavailableReason?: string;
}

export interface ExternalToolsInvokeRpcResult {
  readonly schemaVersion: "director.external-tools.invoke.v1";
  readonly ok: boolean;
  readonly toolName: string;
  readonly toolId: string;
  readonly operationId?: string;
  readonly status: ExternalToolInvokeStatus;
  readonly output?: unknown;
  readonly content: string;
  readonly requiresApproval?: boolean;
  readonly approvalId?: string;
  readonly approval?: ExternalToolApprovalRequest;
  readonly source?: ExternalToolSource;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
  readonly trace: readonly ExternalToolTraceEntry[];
  readonly artifacts?: readonly ExternalToolArtifact[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalToolExecutionStatus =
  | "cancelled"
  | "completed"
  | "executing"
  | "failed"
  | "queued"
  | "yielded";

export interface ExternalToolExecutionTimelineEntry {
  readonly status: ExternalToolExecutionStatus;
  readonly occurredAtMs: number;
  readonly detail: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolRetryHistoryEntry {
  readonly attempt: number;
  readonly occurredAtMs: number;
  readonly result: "failed" | "succeeded";
  readonly status: ExternalToolInvokeStatus;
  readonly error?: string;
}

export interface ExternalToolExecutionSnapshot {
  readonly id: string;
  readonly toolId: string;
  readonly operationId?: string;
  readonly status: ExternalToolExecutionStatus;
  readonly queuedAtMs: number;
  readonly startedAtMs?: number;
  readonly completedAtMs?: number;
  readonly timeline: readonly ExternalToolExecutionTimelineEntry[];
  readonly result?: ExternalToolInvokeResult;
  readonly error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolExecutionQueueOptions {
  readonly registry: ExternalToolRegistry | (() => ExternalToolRegistry);
  readonly nowMs?: () => number;
  readonly onTimeline?: (event: ExternalToolExecutionTimelineNotification) => void;
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly concurrencyPolicy?: ExternalToolConcurrencyPolicy;
  readonly resourceLimits?: ExternalToolResourceLimits;
}

export interface ExternalToolEnqueueOptions {
  readonly executionId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly registry?: ExternalToolRegistry | (() => ExternalToolRegistry);
  readonly policyRuntime?: Pick<PolicyRuntime, "decide">;
  readonly timeoutMs?: number;
}

export interface ExternalToolConcurrencyPolicy {
  readonly maxActiveExecutions?: number;
  readonly maxActivePerProvider?: Readonly<Record<string, number>>;
  readonly onLimitExceeded?: "reject" | "wait" | "ask";
}

export interface ExternalToolResourceLimits {
  readonly maxMemoryMb?: number;
  readonly maxDiskMb?: number;
  readonly maxNetworkMbps?: number;
}

export interface ExternalToolExecutionTimelineNotification {
  readonly execution: ExternalToolExecutionSnapshot;
  readonly entry: ExternalToolExecutionTimelineEntry;
}

export interface ExternalToolCheckInput {
  readonly manifest: ExternalToolManifest;
  readonly nowMs: number;
  readonly generation: number;
}

export type ExternalToolCheckFunction = (
  input: ExternalToolCheckInput,
) =>
  | Promise<ExternalToolDoctorResult | ExternalToolDoctorStatus | boolean>
  | ExternalToolDoctorResult
  | ExternalToolDoctorStatus
  | boolean;

export interface ExternalToolHandlerInvokeRequest extends ExternalToolInvokeRequest {
  readonly manifest: ExternalToolManifest;
  readonly capability: ExternalToolProviderCapability;
  readonly doctor: ExternalToolDoctorResult;
}

export interface ExternalToolHandlerInvokeOutput {
  readonly ok: boolean;
  readonly status?: ExternalToolInvokeStatus;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly artifacts?: readonly ExternalToolArtifact[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalToolInvokeHandler = (
  request: ExternalToolHandlerInvokeRequest,
) => Promise<ExternalToolHandlerInvokeOutput> | ExternalToolHandlerInvokeOutput;

export interface ExternalToolSandboxCommandExecutionConfig {
  readonly enabled: boolean;
}

export interface ExternalToolRegistration {
  readonly manifest: ExternalToolManifest;
  readonly check?: ExternalToolCheckFunction;
  readonly invoke?: ExternalToolInvokeHandler;
  readonly sandboxCommandExecution?: ExternalToolSandboxCommandExecutionConfig;
  readonly allowInvokeWhenUnavailable?: boolean;
}

export interface ResolveEffectiveExternalToolsOptions {
  readonly includeUnavailable?: boolean;
}

export interface ResolveEffectiveModelToolsOptions {
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly registry?: ExternalToolRegistry;
  readonly check?:
    | ReadonlyMap<string, ExternalToolCheckFunction>
    | Readonly<Record<string, ExternalToolCheckFunction>>;
}

export interface ExternalToolRegistryOptions {
  readonly nowMs?: () => number;
  readonly doctorTtlMs?: number;
  readonly sandboxBackends?: AgentOsSandboxBackendRegistryOptions;
  readonly approvalLedger?: ConversationRuntimeApprovalLedger;
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly approvalTtlMs?: number;
}

export interface CreateExternalToolRegistryFromModelToolsOptions
  extends ExternalToolRegistryOptions {
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly executors?:
    | ReadonlyMap<string, ConversationRuntimeToolExecutorPort>
    | Readonly<Record<string, ConversationRuntimeToolExecutorPort>>;
  readonly check?:
    | ReadonlyMap<string, ExternalToolCheckFunction>
    | Readonly<Record<string, ExternalToolCheckFunction>>;
}

export interface CreateExternalToolProviderManifestFromModelToolsOptions {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly providerId?: string;
  readonly tools: readonly ConversationRuntimeModelToolDefinition[];
  readonly source?: ExternalToolSource;
  readonly sourceTrust?: ExternalToolSourceTrust;
  readonly installPolicy?: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly auth?: ExternalProviderManifest["auth"];
  readonly contracts?: ExternalProviderManifest["contracts"];
  readonly configSchema?: ExternalProviderManifest["configSchema"];
  readonly configFields?: ExternalProviderManifest["configFields"];
  readonly uiHints?: ExternalProviderManifest["uiHints"];
  readonly providerStatus?: ExternalProviderStatus;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ExternalToolProviderCapabilityPreset = "browser" | "media" | "notebook";

export interface CreateExternalToolProviderManifestOptions {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly source: ExternalToolSource;
  readonly providerId?: string;
  readonly enabled?: boolean;
  readonly capabilityPreset?: ExternalToolProviderCapabilityPreset;
  readonly capabilities?: readonly ExternalToolProviderCapability[];
  readonly sourceTrust?: ExternalToolSourceTrust;
  readonly installPolicy?: ExternalToolInstallPolicy;
  readonly approvalBoundary?: ExternalToolApprovalBoundary;
  readonly auth?: ExternalProviderManifest["auth"];
  readonly contracts?: ExternalProviderManifest["contracts"];
  readonly configSchema?: ExternalProviderManifest["configSchema"];
  readonly configFields?: ExternalProviderManifest["configFields"];
  readonly uiHints?: ExternalProviderManifest["uiHints"];
  readonly providerStatus?: ExternalProviderStatus;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ExternalToolProviderAutomationHardening {
  readonly credentialProfileAccess: "none" | "operator-scope-required";
  readonly unmanagedPlaywrightChromiumProcess: boolean;
  readonly providerRunnerStatus: "not-configured" | "sandbox-owned" | "long-lived-admitted";
  readonly operatorScopeRequired: boolean;
  readonly processLedgerRequiredForExternalRunner: boolean;
}

export interface CreateExternalToolManifestsFromAgentOsExtensionMatrixOptions {
  readonly source?: ExternalToolSource;
}

interface RegisteredExternalTool {
  readonly manifest: ExternalToolManifest;
  readonly check?: ExternalToolCheckFunction;
  readonly invoke?: ExternalToolInvokeHandler;
  readonly sandboxCommandExecution?: ExternalToolSandboxCommandExecutionConfig;
  readonly allowInvokeWhenUnavailable: boolean;
  generation: number;
}

interface DoctorCacheEntry {
  readonly generation: number;
  readonly checkedAtMs: number;
  readonly value: ExternalToolDoctorResult;
}

const DEFAULT_EXTERNAL_TOOL_DOCTOR_TTL_MS = 30_000;
const DEFAULT_EXTERNAL_TOOL_APPROVAL_TTL_MS = 5 * 60 * 1000;

export function createExternalToolCatalog(
  manifests: readonly ExternalToolManifest[],
): readonly ExternalToolCatalogEntry[] {
  const byId = new Map<string, ExternalToolCatalogEntry>();
  for (const manifest of manifests) {
    const normalized = normalizeExternalToolManifest(manifest);
    if (byId.has(normalized.id)) {
      continue;
    }
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort(compareExternalToolById);
}

export function createExternalToolManifestFromModelTool(
  tool: ConversationRuntimeModelToolDefinition,
): ExternalToolManifest {
  const metadata = tool.metadata ?? {};
  const source = readMetadataString(metadata, "source") ?? "built-in";
  const capabilityId = readMetadataString(metadata, "capability") ?? tool.name;
  const providerId =
    readMetadataString(metadata, "externalProviderId") ??
    readMetadataString(metadata, "providerId") ??
    readMetadataString(metadata, "serverName") ??
    inferExternalToolProviderIdFromModelTool(tool);
  const requiresApproval =
    metadata.requiresApproval === true ||
    metadata.reviewGated === true ||
    metadata.approvalMode === "operator_approve";
  const sourceToolName = readMetadataString(metadata, "toolName");
  return normalizeExternalToolManifest({
    id: tool.name,
    label: tool.name,
    description: tool.description,
    source,
    kind: "model-tool",
    ...(providerId === undefined ? {} : { providerId }),
    ...(sourceToolName === undefined ? {} : { toolName: sourceToolName }),
    capabilities: [
      {
        id: capabilityId,
        label: capabilityId,
        readOnly: tool.readOnly,
        ...(requiresApproval ? { requiresApproval: true } : {}),
        ...(metadata.destructive === true ? { destructive: true } : {}),
        ...(metadata.openWorld === true ? { openWorld: true } : {}),
        metadata,
      },
    ],
    metadata: {
      ...metadata,
      modelToolName: tool.name,
    },
  });
}

export function createExternalToolProviderManifestFromModelTools(
  options: CreateExternalToolProviderManifestFromModelToolsOptions,
): ExternalToolManifest {
  const capabilities = options.tools.map((tool) => {
    const metadata = tool.metadata ?? {};
    const capabilityId = readMetadataString(metadata, "capability") ?? tool.name;
    const requiresApproval =
      metadata.requiresApproval === true ||
      metadata.reviewGated === true ||
      metadata.approvalMode === "operator_approve";
    return normalizeExternalToolCapability({
      id: capabilityId,
      label: capabilityId,
      readOnly: tool.readOnly,
      ...(requiresApproval ? { requiresApproval: true } : {}),
      ...(metadata.destructive === true ? { destructive: true } : {}),
      ...(metadata.openWorld === true ? { openWorld: true } : {}),
      metadata: {
        ...metadata,
        modelToolName: tool.name,
      },
    });
  });
  return normalizeExternalToolManifest({
    id: options.id,
    label: options.label,
    description: options.description,
    source: options.source ?? "built-in",
    kind: "provider",
    providerId: options.providerId ?? options.id,
    ...(options.sourceTrust === undefined ? {} : { sourceTrust: options.sourceTrust }),
    ...(options.installPolicy === undefined ? {} : { installPolicy: options.installPolicy }),
    ...(options.approvalBoundary === undefined
      ? {}
      : { approvalBoundary: options.approvalBoundary }),
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.contracts === undefined ? {} : { contracts: options.contracts }),
    ...(options.configSchema === undefined ? {} : { configSchema: options.configSchema }),
    ...(options.configFields === undefined ? {} : { configFields: options.configFields }),
    ...(options.uiHints === undefined ? {} : { uiHints: options.uiHints }),
    ...(options.providerStatus === undefined ? {} : { providerStatus: options.providerStatus }),
    capabilities,
    metadata: {
      groupedProvider: true,
      modelToolNames: options.tools.map((tool) => tool.name),
      ...(options.metadata ?? {}),
    },
  });
}

export function createExternalToolProviderManifest(
  options: CreateExternalToolProviderManifestOptions,
): ExternalToolManifest {
  const capabilities =
    options.capabilities ??
    (options.capabilityPreset === undefined
      ? []
      : createExternalToolProviderCapabilities(options.capabilityPreset));
  return normalizeExternalToolManifest({
    id: options.id,
    label: options.label,
    description: options.description,
    source: options.source,
    kind: "provider",
    providerId: options.providerId ?? options.id,
    ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
    ...(options.sourceTrust === undefined ? {} : { sourceTrust: options.sourceTrust }),
    ...(options.installPolicy === undefined ? {} : { installPolicy: options.installPolicy }),
    ...(options.approvalBoundary === undefined
      ? {}
      : { approvalBoundary: options.approvalBoundary }),
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.contracts === undefined ? {} : { contracts: options.contracts }),
    ...(options.configSchema === undefined ? {} : { configSchema: options.configSchema }),
    ...(options.configFields === undefined ? {} : { configFields: options.configFields }),
    ...(options.uiHints === undefined ? {} : { uiHints: options.uiHints }),
    ...(options.providerStatus === undefined ? {} : { providerStatus: options.providerStatus }),
    capabilities,
    metadata: {
      providerBoundary: options.source === "built-in" ? "built-in-provider" : "external-provider",
      ...(options.capabilityPreset === undefined
        ? {}
        : { capabilityPreset: options.capabilityPreset }),
      ...(options.capabilityPreset === undefined
        ? {}
        : { automationHardening: createExternalToolProviderAutomationHardening(options) }),
      ...(options.metadata ?? {}),
    },
  });
}

export function createExternalToolProviderAutomationHardening(
  options: Pick<CreateExternalToolProviderManifestOptions, "capabilityPreset" | "source">,
): ExternalToolProviderAutomationHardening {
  switch (options.capabilityPreset) {
    case "browser":
      return {
        credentialProfileAccess: "operator-scope-required",
        unmanagedPlaywrightChromiumProcess: false,
        providerRunnerStatus: options.source === "built-in" ? "sandbox-owned" : "not-configured",
        operatorScopeRequired: true,
        processLedgerRequiredForExternalRunner: true,
      };
    case "notebook":
      return {
        credentialProfileAccess: "operator-scope-required",
        unmanagedPlaywrightChromiumProcess: false,
        providerRunnerStatus: "not-configured",
        operatorScopeRequired: true,
        processLedgerRequiredForExternalRunner: true,
      };
    default:
      return {
        credentialProfileAccess: "none",
        unmanagedPlaywrightChromiumProcess: false,
        providerRunnerStatus: "not-configured",
        operatorScopeRequired: false,
        processLedgerRequiredForExternalRunner: true,
      };
  }
}

export function createBuiltInAgentOsExtensionExternalToolManifests(): readonly ExternalToolManifest[] {
  return createExternalToolManifestsFromAgentOsExtensionMatrix(
    createAgentOsExtensionMatrix(createBuiltInAgentOsExtensionManifests()),
  );
}

export function createExternalToolManifestsFromAgentOsExtensionMatrix(
  matrix: AgentOsExtensionMatrix,
  options: CreateExternalToolManifestsFromAgentOsExtensionMatrixOptions = {},
): readonly ExternalToolManifest[] {
  return matrix.entries.map((entry) =>
    createExternalToolManifestFromAgentOsExtensionMatrixEntry(entry, {
      matrix,
      ...(options.source === undefined ? {} : { source: options.source }),
    }),
  );
}

export function createExternalToolManifestFromAgentOsExtensionManifest(
  manifest: AgentOsExtensionManifest,
  options: CreateExternalToolManifestsFromAgentOsExtensionMatrixOptions = {},
): ExternalToolManifest {
  const matrix = createAgentOsExtensionMatrix([manifest]);
  const [entry] = createExternalToolManifestsFromAgentOsExtensionMatrix(matrix, options);
  if (entry === undefined) {
    throw new Error(`Agent OS extension manifest ${manifest.id} could not be projected.`);
  }
  return entry;
}

function createExternalToolManifestFromAgentOsExtensionMatrixEntry(
  entry: AgentOsExtensionMatrixEntry,
  input: {
    readonly matrix: AgentOsExtensionMatrix;
    readonly source?: ExternalToolSource;
  },
): ExternalToolManifest {
  return normalizeExternalToolManifest({
    id: entry.id,
    label: entry.displayName,
    description: createAgentOsExtensionExternalToolDescription(entry),
    source: input.source ?? mapAgentOsExtensionSource(entry),
    kind: entry.kind,
    ...(entry.providerId === undefined ? {} : { providerId: entry.providerId }),
    enabled: entry.health.status !== "disabled",
    sourceTrust: mapAgentOsExtensionSourceTrust(entry.sourceTrust),
    installPolicy: mapAgentOsExtensionInstallPolicy(entry.installPolicy, entry.sandbox),
    approvalBoundary: mapAgentOsExtensionApprovalBoundary(entry),
    providerStatus: createAgentOsExtensionProviderStatus(entry),
    capabilities: entry.capabilityIds.map((capabilityId) =>
      createExternalToolCapabilityFromAgentOsExtensionMatrixEntry(
        entry,
        capabilityId,
        input.matrix,
      ),
    ),
    metadata: {
      ...(entry.metadata ?? {}),
      agentOsExtensionId: entry.id,
      agentOsExtensionKind: entry.kind,
      agentOsHealthStatus: entry.health.status,
      agentOsHealth: entry.health,
      agentOsSandboxPolicy: entry.sandbox,
      agentOsSourceTrust: entry.sourceTrust,
      agentOsUiSurfaces: entry.uiSurfaces,
      agentOsExtensionMatrixEntry: formatAgentOsExternalToolExtensionMatrixEntry(entry),
    },
  });
}

export function createExternalToolProviderCapabilities(
  preset: ExternalToolProviderCapabilityPreset,
): readonly ExternalToolProviderCapability[] {
  switch (preset) {
    case "browser":
      return [
        createCapability("browser.navigate", "Navigate", {
          readOnly: false,
          requiresApproval: true,
          openWorld: true,
        }),
        createCapability("browser.snapshot", "Snapshot", { readOnly: true, openWorld: true }),
        createCapability("browser.click", "Click", {
          readOnly: false,
          requiresApproval: true,
          openWorld: true,
        }),
        createCapability("browser.type", "Type", {
          readOnly: false,
          requiresApproval: true,
          openWorld: true,
        }),
        createCapability("browser.images", "Get images", {
          readOnly: true,
          openWorld: true,
        }),
        createCapability("browser.console", "Console", {
          readOnly: false,
          requiresApproval: true,
          openWorld: true,
        }),
      ];
    case "media":
      return [
        createCapability("media.generate_image", "Generate image", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("media.generate_video", "Generate video", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("audio.synthesize", "Synthesize speech", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("audio.transcribe", "Transcribe audio", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("audio.realtime.transcribe", "Realtime transcription", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("audio.realtime.talk", "Realtime talk", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("media.understand_image", "Understand image", { readOnly: true }),
        createCapability("media.understand_video", "Understand video", { readOnly: true }),
        createCapability("media.workflow", "Workflow", {
          readOnly: false,
          requiresApproval: true,
        }),
      ];
    case "notebook":
      return [
        createCapability("notebook.create", "Create notebook", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("notebook.upload_source", "Upload source", {
          readOnly: false,
          requiresApproval: true,
        }),
        createCapability("notebook.query", "Query notebook", { readOnly: true }),
        createCapability("notebook.extract_answer", "Extract answer", { readOnly: true }),
        createCapability("notebook.delete", "Delete notebook", {
          readOnly: false,
          requiresApproval: true,
          destructive: true,
        }),
      ];
  }
}

export function createExternalToolRegistryFromModelTools(
  options: CreateExternalToolRegistryFromModelToolsOptions,
): ExternalToolRegistry {
  const registry = new ExternalToolRegistry(options);
  for (const tool of options.tools) {
    const manifest = createExternalToolManifestFromModelTool(tool);
    const executor = readExternalToolMapValue(options.executors, tool.name);
    const check = readExternalToolMapValue(options.check, tool.name);
    registry.register({
      manifest,
      ...(check === undefined ? {} : { check }),
      ...(executor === undefined
        ? {}
        : {
            invoke: (request) =>
              invokeModelToolThroughExternalTool({
                request,
                tool,
                executor,
              }),
          }),
    });
  }
  return registry;
}

export async function resolveEffectiveModelTools(
  options: ResolveEffectiveModelToolsOptions,
): Promise<readonly ConversationRuntimeModelToolDefinition[]> {
  const projectedRegistry =
    options.registry ??
    createExternalToolRegistryFromModelTools({
      tools: options.tools,
      ...(options.check === undefined ? {} : { check: options.check }),
    });
  if (options.registry !== undefined && options.check !== undefined) {
    for (const tool of options.tools) {
      const check = readExternalToolMapValue(options.check, tool.name);
      projectedRegistry.register(
        check === undefined
          ? { manifest: createExternalToolManifestFromModelTool(tool) }
          : { manifest: createExternalToolManifestFromModelTool(tool), check },
      );
    }
  }
  const effective = await projectedRegistry.resolveEffective();
  const effectiveToolIds = new Set(
    effective.filter((tool) => tool.kind === "model-tool").map((tool) => tool.id),
  );
  const effectiveById = new Map(
    effective.filter((tool) => tool.kind === "model-tool").map((tool) => [tool.id, tool]),
  );
  return options.tools
    .filter((tool) => effectiveToolIds.has(tool.name))
    .map((tool) =>
      enrichModelToolWithEffectiveExternalTool(
        tool,
        effectiveById.get(tool.name),
        effectiveToolIds,
      ),
    );
}

function enrichModelToolWithEffectiveExternalTool(
  tool: ConversationRuntimeModelToolDefinition,
  effective: EffectiveExternalTool | undefined,
  effectiveToolIds: ReadonlySet<string>,
): ConversationRuntimeModelToolDefinition {
  if (effective === undefined) {
    return tool;
  }
  return {
    ...tool,
    description: createDynamicModelToolDescription(tool, effectiveToolIds),
    metadata: {
      ...(tool.metadata ?? {}),
      externalToolStatus: effective.status,
      externalToolCanInvoke: effective.canInvoke,
      externalToolGeneration: effective.generation,
      externalProviderStatus:
        typeof tool.metadata?.externalProviderStatus === "string"
          ? tool.metadata.externalProviderStatus
          : effective.doctor.status,
      ...(effective.doctor.nextActions === undefined
        ? {}
        : { externalToolNextActions: effective.doctor.nextActions }),
      ...(effective.doctor.metadata ?? {}),
    },
  };
}

function createDynamicModelToolDescription(
  tool: ConversationRuntimeModelToolDefinition,
  effectiveToolIds: ReadonlySet<string>,
): string {
  const companionTools = getAvailableCompanionTools(tool.name, effectiveToolIds);
  if (companionTools.length === 0) {
    return tool.description;
  }
  return `${tool.description} Available companion tools in this turn: ${companionTools.join(", ")}.`;
}

function getAvailableCompanionTools(
  toolName: string,
  effectiveToolIds: ReadonlySet<string>,
): readonly string[] {
  if (toolName === "web_search") {
    return filterAvailableTools(["web_extract", "director.learning.admit"], effectiveToolIds);
  }
  if (toolName === "web_extract") {
    return filterAvailableTools(
      ["web_extract_artifact_read", "director.learning.admit", "browser_snapshot"],
      effectiveToolIds,
    );
  }
  if (toolName === "web_extract_artifact_read") {
    return filterAvailableTools(["director.learning.admit"], effectiveToolIds);
  }
  if (toolName === "x_search") {
    return filterAvailableTools(["web_extract", "browser_navigate"], effectiveToolIds);
  }
  if (toolName === "browser_navigate") {
    return filterAvailableTools(
      ["web_search", "web_extract", "web_extract_artifact_read"],
      effectiveToolIds,
    );
  }
  if (toolName === "browser_snapshot") {
    return filterAvailableTools(["browser_navigate"], effectiveToolIds);
  }
  if (
    toolName === "browser_click" ||
    toolName === "browser_type" ||
    toolName === "browser_scroll" ||
    toolName === "browser_back" ||
    toolName === "browser_press" ||
    toolName === "browser_get_images" ||
    toolName === "browser_console"
  ) {
    return filterAvailableTools(["browser_navigate", "browser_snapshot"], effectiveToolIds);
  }
  if (
    toolName === "director.learning.query" ||
    toolName === "director.learning.url" ||
    toolName === "director.learning.admit" ||
    toolName === "director.learning.media_understand"
  ) {
    return filterAvailableTools(
      [
        "web_search",
        "web_extract",
        "web_extract_artifact_read",
        "browser_snapshot",
        "browser_get_images",
      ],
      effectiveToolIds,
    );
  }
  return [];
}

function filterAvailableTools(
  toolNames: readonly string[],
  effectiveToolIds: ReadonlySet<string>,
): readonly string[] {
  return toolNames.filter((toolName) => effectiveToolIds.has(toolName));
}

export function createExternalProviderInstallPlan(
  input: ExternalProviderInstallPlanInput,
): ExternalProviderInstallPlanResult {
  const toolId = normalizeRequiredString(input.toolId, "unknown-provider");
  const label = input.label?.trim() || toolId || "unknown-provider";
  const source = typeof input.source === "string" ? input.source.trim() : undefined;
  const kind = typeof input.kind === "string" ? input.kind.trim() : undefined;
  const hasManifest =
    toolId.length > 0 &&
    label.length > 0 &&
    source !== undefined &&
    source.length > 0 &&
    kind !== undefined &&
    kind.length > 0 &&
    input.installPolicy !== undefined &&
    input.installPolicy !== null;
  const installPolicy =
    input.installPolicy === undefined || input.installPolicy === null
      ? createDefaultExternalProviderInstallPolicy(source)
      : normalizeExternalToolInstallPolicy(input.installPolicy);
  const sourceTrust =
    input.sourceTrust === undefined || input.sourceTrust === null
      ? (input.sourceTrust ?? null)
      : normalizeExternalToolSourceTrust(input.sourceTrust);
  const approvalBoundary =
    input.approvalBoundary === undefined || input.approvalBoundary === null
      ? (input.approvalBoundary ?? null)
      : normalizeExternalToolApprovalBoundary(input.approvalBoundary);

  if (!hasManifest) {
    return {
      ok: false,
      status: "manifest-required",
      dryRun: true,
      executed: false,
      toolId,
      label,
      message: `${label} 缺少 provider manifest；Angel 不能为未知外部工具生成可执行安装方案。`,
      plan: [],
      nextActions: [
        "先建立 provider manifest，至少包含 sourceTrust、installPolicy 和 approvalBoundary。",
        "manifest 通过审核后，再生成只读安装计划。",
      ],
      ...(sourceTrust === undefined ? {} : { sourceTrust }),
      installPolicy,
      ...(approvalBoundary === undefined ? {} : { approvalBoundary }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
  }

  if (installPolicy.supported !== true) {
    return {
      ok: false,
      status: "unsupported",
      dryRun: true,
      executed: false,
      toolId,
      label,
      message: `${label} 当前策略不支持由 Angel 安装；不会静默安装外部工具。`,
      plan: [],
      nextActions: createUnsupportedInstallPolicyNextActions({ source, installPolicy }),
      ...(sourceTrust === undefined ? {} : { sourceTrust }),
      installPolicy,
      ...(approvalBoundary === undefined ? {} : { approvalBoundary }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
  }

  const approvalLabels =
    approvalBoundary?.actionLabels !== undefined && approvalBoundary.actionLabels.length >= 2
      ? approvalBoundary.actionLabels.slice(0, 2)
      : (["确认", "拒绝"] as const);
  const allowedMethods = installPolicy.allowedMethods ?? [];
  const refuses = installPolicy.refuses ?? [];
  return {
    ok: true,
    status: "planned",
    dryRun: true,
    executed: false,
    toolId,
    label,
    message: `${label} 安装计划已生成；当前只有计划，没有 provider 专属执行器，不会运行任何命令。`,
    plan: [
      {
        kind: "operator-review",
        summary: "真实安装前必须由可信操作员做一次简短确认。",
        command: "confirm",
        args: approvalLabels,
        executable: false,
        metadata: {
          approvalMode: approvalBoundary?.mode ?? "operator-confirm",
          requiresOperator:
            approvalBoundary?.requiresOperator ?? installPolicy.requiresApproval ?? true,
        },
      },
      {
        kind: "provider-runner-required",
        summary: "补齐 provider 专属 runner 后，才能把 allowedMethods 转成可执行步骤。",
        command: "provider-specific-runner",
        args: allowedMethods,
        executable: false,
        metadata: {
          allowedMethods,
          refuses,
          defaultInstallPath: installPolicy.defaultInstallPath ?? "",
        },
      },
    ],
    nextActions: [
      "补齐 provider 专属 runner 后，真实执行仍需回复「确认」。",
      "执行器必须复用 ExternalToolExecutionQueue、approvalBoundary 和 artifact/trace。",
    ],
    ...(sourceTrust === undefined ? {} : { sourceTrust }),
    installPolicy,
    ...(approvalBoundary === undefined ? {} : { approvalBoundary }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

export class ExternalToolRegistry {
  readonly #nowMs: () => number;
  readonly #doctorTtlMs: number;
  readonly #sandboxBackendRegistry: AgentOsSandboxBackendRegistry;
  readonly #approvalLedger: ConversationRuntimeApprovalLedger | undefined;
  readonly #artifactStore: ConversationRuntimeExternalArtifactStore | undefined;
  readonly #approvalTtlMs: number;
  readonly #entries = new Map<string, RegisteredExternalTool>();
  readonly #doctorCache = new Map<string, DoctorCacheEntry>();
  readonly #doctorInflight = new Map<string, Promise<ExternalToolDoctorResult>>();
  readonly #lastKnownGood = new Map<string, ExternalToolLastKnownGoodDoctorResult>();

  constructor(options: ExternalToolRegistryOptions = {}) {
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#doctorTtlMs = options.doctorTtlMs ?? DEFAULT_EXTERNAL_TOOL_DOCTOR_TTL_MS;
    this.#approvalLedger = options.approvalLedger;
    this.#artifactStore = options.artifactStore;
    this.#approvalTtlMs = options.approvalTtlMs ?? DEFAULT_EXTERNAL_TOOL_APPROVAL_TTL_MS;
    this.#sandboxBackendRegistry =
      options.sandboxBackends === undefined
        ? DEFAULT_EXTERNAL_TOOL_SANDBOX_BACKEND_REGISTRY
        : createAgentOsSandboxBackendRegistry(options.sandboxBackends);
  }

  register(registration: ExternalToolRegistration): this {
    const manifest = normalizeExternalToolManifest(registration.manifest);
    const existing = this.#entries.get(manifest.id);
    if (
      existing !== undefined &&
      (existing.manifest.source !== manifest.source || existing.manifest.kind !== manifest.kind)
    ) {
      throw new Error(
        `External tool registration rejected: ${manifest.id} would shadow ${existing.manifest.source}/${existing.manifest.kind}.`,
      );
    }
    const check = registration.check;
    const invoke = registration.invoke;
    const sandboxCommandExecution = registration.sandboxCommandExecution;
    const unchanged =
      existing !== undefined &&
      externalToolManifestsEqual(existing.manifest, manifest) &&
      existing.allowInvokeWhenUnavailable === (registration.allowInvokeWhenUnavailable === true);
    const generation = unchanged ? existing.generation : (existing?.generation ?? 0) + 1;
    this.#entries.set(manifest.id, {
      manifest,
      ...(check === undefined ? {} : { check }),
      ...(invoke === undefined ? {} : { invoke }),
      ...(sandboxCommandExecution === undefined ? {} : { sandboxCommandExecution }),
      allowInvokeWhenUnavailable: registration.allowInvokeWhenUnavailable === true,
      generation,
    });
    if (!unchanged) {
      this.#doctorCache.delete(manifest.id);
      this.#doctorInflight.delete(manifest.id);
    }
    return this;
  }

  unregister(toolId: string): boolean {
    const removed = this.#entries.delete(toolId);
    this.#doctorCache.delete(toolId);
    this.#doctorInflight.delete(toolId);
    return removed;
  }

  refresh(toolId?: string): void {
    if (toolId === undefined) {
      for (const id of this.#entries.keys()) {
        this.refresh(id);
      }
      return;
    }
    const entry = this.#entries.get(toolId);
    if (entry === undefined) {
      return;
    }
    entry.generation += 1;
    this.#doctorCache.delete(toolId);
    this.#doctorInflight.delete(toolId);
  }

  listCatalog(): readonly ExternalToolCatalogEntry[] {
    return createExternalToolCatalog([...this.#entries.values()].map((entry) => entry.manifest));
  }

  getRegistration(toolId: string): RegisteredExternalTool | undefined {
    return this.#entries.get(toolId);
  }

  getSandboxBackendRegistry(): AgentOsSandboxBackendRegistry {
    return this.#sandboxBackendRegistry;
  }

  persistArtifacts(input: {
    readonly request: ExternalToolInvokeRequest;
    readonly manifest: ExternalToolManifest;
    readonly capability: ExternalToolProviderCapability;
    readonly artifacts: readonly ExternalToolArtifact[];
  }): ExternalToolArtifactPersistenceMetadata | undefined {
    if (this.#artifactStore === undefined || input.artifacts.length === 0) {
      return undefined;
    }
    const metadata = input.request.metadata ?? {};
    const result = this.#artifactStore.upsertArtifacts({
      providerId: input.manifest.providerId ?? input.manifest.id,
      toolId: input.manifest.id,
      operationId: input.capability.id,
      ...(input.request.turnId === undefined ? {} : { turnId: input.request.turnId }),
      ...(input.request.sessionKey === undefined ? {} : { sessionKey: input.request.sessionKey }),
      ...optionalStringField("projectId", input.request.args?.projectId ?? metadata.projectId),
      ...optionalStringField("runId", input.request.args?.runId ?? metadata.runId),
      ...optionalStringField("stepId", input.request.args?.stepId ?? metadata.stepId),
      artifacts: input.artifacts,
      ...optionalArtifactRetentionField(metadata.retention),
      ...optionalArtifactSensitivityField(metadata.sensitivity),
      ...optionalStringField("cleanupPolicyRef", metadata.cleanupPolicyRef),
      ...optionalPositiveNumberField("ttlMs", metadata.ttlMs),
    });
    return {
      status: result.status,
      artifactIds: result.artifactIds,
      notes: result.notes,
      storeRef: "conversation-runtime.external-artifact-store",
    };
  }

  async diagnose(toolId: string): Promise<ExternalToolDoctorResult | undefined> {
    const entry = this.#entries.get(toolId);
    if (entry === undefined) {
      return undefined;
    }
    return this.#resolveDoctor(entry);
  }

  getLastKnownGood(toolId: string): ExternalToolLastKnownGoodDoctorResult | undefined {
    return this.#lastKnownGood.get(toolId);
  }

  getApprovalExpiresAtMs(): number {
    return this.#nowMs() + this.#approvalTtlMs;
  }

  verifyApprovedRequest(input: {
    readonly request: ExternalToolInvokeRequest;
    readonly capability: ExternalToolProviderCapability;
  }):
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly reason:
          | "approval-not-found"
          | "approval-not-pending"
          | "approval-expired"
          | "approval-binding-mismatch";
      } {
    if (this.#approvalLedger === undefined) {
      return { ok: true };
    }
    const result = this.#approvalLedger.resolveApproval({
      approvalId: createExternalToolApprovalId(input.request, input.capability),
      decision: "approved",
      resolvedByChannel:
        readOptionalMetadataString(input.request.metadata, "resolvedByChannel") ??
        input.request.approval?.operatorId ??
        "runtime",
      binding: {
        turnId: input.request.turnId ?? "turn",
        sessionKey: input.request.sessionKey ?? "session",
        toolCallId: createExternalToolApprovalLedgerToolCallId(input.request, input.capability),
        argsHash: hashConversationRuntimeToolArgs(input.request.args ?? {}),
      },
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }

  persistApprovalRequest(input: {
    readonly approval: ExternalToolApprovalRequest;
    readonly request: ExternalToolInvokeRequest;
    readonly capability: ExternalToolProviderCapability;
  }): void {
    if (this.#approvalLedger === undefined) {
      return;
    }
    const nowMs = this.#nowMs();
    const redactedPayloadHash = createExternalToolApprovalRedactedPayloadHash(
      input.request,
      input.capability,
    );
    this.#approvalLedger.upsertApproval({
      approval: {
        schemaVersion: "conversation-runtime.approval-ledger-record.v1",
        approvalId: input.approval.id,
        status: "pending",
        scope:
          readOptionalMetadataString(input.request.metadata, "approvalScope") ?? "single_operation",
        toolId: input.request.toolId,
        operationId: input.capability.id,
        turnId: input.request.turnId ?? "turn",
        sessionKey: input.request.sessionKey ?? "session",
        toolCallId: createExternalToolApprovalLedgerToolCallId(input.request, input.capability),
        argsHash: hashConversationRuntimeToolArgs(input.request.args ?? {}),
        redactedPayloadHash,
        requestedByChannel:
          readOptionalMetadataString(input.request.metadata, "requestedByChannel") ?? "runtime",
        requestedAtMs: nowMs,
        expiresAtMs: nowMs + this.#approvalTtlMs,
      },
    });
  }

  async resolveEffective(
    options: ResolveEffectiveExternalToolsOptions = {},
  ): Promise<readonly EffectiveExternalTool[]> {
    const entries = [...this.#entries.values()].sort((left, right) =>
      left.manifest.id.localeCompare(right.manifest.id),
    );
    const effective = await Promise.all(
      entries.map(async (entry) => {
        const doctor = await this.#resolveDoctor(entry);
        const canInvoke = doctor.status === "ready";
        if (!canInvoke && options.includeUnavailable !== true) {
          return null;
        }
        const lastKnownGood = this.#lastKnownGood.get(entry.manifest.id);
        return lastKnownGood === undefined
          ? createEffectiveExternalTool({
              manifest: entry.manifest,
              doctor,
              generation: entry.generation,
              canInvoke,
            })
          : createEffectiveExternalTool({
              manifest: entry.manifest,
              doctor,
              generation: entry.generation,
              canInvoke,
              lastKnownGood,
            });
      }),
    );
    return effective.filter((entry): entry is EffectiveExternalTool => entry !== null);
  }

  async #resolveDoctor(entry: RegisteredExternalTool): Promise<ExternalToolDoctorResult> {
    if (entry.manifest.enabled === false) {
      return normalizeDoctorResult("disabled", this.#nowMs(), "External tool is disabled.");
    }
    const now = this.#nowMs();
    const cached = this.#doctorCache.get(entry.manifest.id);
    if (
      cached !== undefined &&
      cached.generation === entry.generation &&
      now - cached.checkedAtMs < this.#doctorTtlMs
    ) {
      return cached.value;
    }
    const inflight = this.#doctorInflight.get(entry.manifest.id);
    if (inflight !== undefined) {
      return inflight;
    }
    const task = this.#runDoctor(entry);
    this.#doctorInflight.set(entry.manifest.id, task);
    try {
      return await task;
    } finally {
      this.#doctorInflight.delete(entry.manifest.id);
    }
  }

  async #runDoctor(entry: RegisteredExternalTool): Promise<ExternalToolDoctorResult> {
    const checkedAtMs = this.#nowMs();
    const raw =
      entry.check === undefined
        ? createDefaultExternalToolDoctorResult(entry.manifest, checkedAtMs)
        : await entry.check({
            manifest: entry.manifest,
            nowMs: checkedAtMs,
            generation: entry.generation,
          });
    const result = normalizeDoctorResult(raw, checkedAtMs);
    const enrichedResult = enrichDoctorResultWithLastKnownGood(
      result,
      this.#lastKnownGood.get(entry.manifest.id),
    );
    if (enrichedResult.status === "ready") {
      this.#lastKnownGood.set(
        entry.manifest.id,
        createLastKnownGoodDoctorResult(enrichedResult, entry.generation),
      );
    }
    this.#doctorCache.set(entry.manifest.id, {
      generation: entry.generation,
      checkedAtMs,
      value: enrichedResult,
    });
    return enrichedResult;
  }
}

function createExternalToolApprovalId(
  request: ExternalToolInvokeRequest,
  capability: ExternalToolProviderCapability,
): string {
  return [
    "external-tool",
    request.turnId ?? "turn",
    request.toolId,
    capability.id,
    request.idempotencyKey ?? "invoke",
  ].join(":");
}

function createExternalToolApprovalLedgerToolCallId(
  request: ExternalToolInvokeRequest,
  capability: ExternalToolProviderCapability,
): string {
  return `${request.toolId}:${capability.id}`;
}

function createExternalToolApprovalRedactedPayloadHash(
  request: ExternalToolInvokeRequest,
  capability: ExternalToolProviderCapability,
): string {
  return hashConversationRuntimeToolArgs({
    toolId: request.toolId,
    operationId: capability.id,
    command: request.command ?? "",
    cwd: request.cwd ?? "",
    dryRun: request.dryRun === true,
    idempotencyKey: request.idempotencyKey ?? "",
    args: redactExternalToolApprovalPayload(request.args ?? {}),
  });
}

function redactExternalToolApprovalPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactExternalToolApprovalPayload(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = isExternalToolApprovalSensitiveKey(key)
      ? "[redacted]"
      : redactExternalToolApprovalPayload(child);
  }
  return redacted;
}

function isExternalToolApprovalSensitiveKey(key: string): boolean {
  return /(?:api[-_]?key|authorization|credential|password|secret|token)/i.test(key);
}

function getExternalToolApprovalExpiresAtMs(
  registry: ExternalToolRegistry,
  request: ExternalToolInvokeRequest,
): number {
  const metadataValue = request.metadata?.approvalExpiresAtMs;
  return typeof metadataValue === "number" && Number.isFinite(metadataValue)
    ? metadataValue
    : registry.getApprovalExpiresAtMs();
}

function mapExternalToolApprovalLedgerError(reason: string): string {
  return reason === "approval-expired"
    ? "external-tool-approval-ledger-expired"
    : `external-tool-approval-ledger-${reason}`;
}

function readOptionalMetadataString(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  return readMetadataString(metadata, key);
}

function externalToolManifestsEqual(
  left: ExternalToolManifest,
  right: ExternalToolManifest,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function invokeExternalTool(
  registry: ExternalToolRegistry,
  request: ExternalToolInvokeRequest,
): Promise<ExternalToolInvokeResult> {
  const trace = createExternalToolTraceWriter();
  const entry = registry.getRegistration(request.toolId);
  if (entry === undefined) {
    trace.push("tool.not_found", `External tool ${request.toolId} is not registered.`);
    return createInvokeResult({
      ok: false,
      status: "not-found",
      toolId: request.toolId,
      operationId: request.operationId,
      content: `External tool ${request.toolId} is not registered.`,
      error: "external-tool-not-found",
      trace: trace.items,
    });
  }
  const doctor = await registry.diagnose(request.toolId);
  if (doctor === undefined) {
    trace.push("tool.not_found", `External tool ${request.toolId} is not registered.`);
    return createInvokeResult({
      ok: false,
      status: "not-found",
      toolId: request.toolId,
      operationId: request.operationId,
      content: `External tool ${request.toolId} is not registered.`,
      error: "external-tool-not-found",
      trace: trace.items,
    });
  }
  trace.push("tool.resolved", `Resolved external tool ${request.toolId}.`, {
    toolId: request.toolId,
    status: doctor.status,
    source: entry.manifest.source,
    kind: entry.manifest.kind,
  });
  const lastKnownGood = registry.getLastKnownGood(request.toolId);
  if (doctor.status !== "ready" && entry.allowInvokeWhenUnavailable !== true) {
    trace.push("tool.unavailable", `External tool ${request.toolId} is ${doctor.status}.`, {
      toolId: request.toolId,
      status: doctor.status,
      ...(lastKnownGood === undefined
        ? {}
        : {
            lastKnownGoodStatus: lastKnownGood.status,
            lastKnownGoodCheckedAtMs: lastKnownGood.checkedAtMs,
          }),
    });
    return createInvokeResult({
      ok: false,
      status: "unavailable",
      toolId: request.toolId,
      operationId: request.operationId,
      content: doctor.summary,
      error: `external-tool-${doctor.status}`,
      trace: trace.items,
      metadata: {
        doctorStatus: doctor.status,
        nextActions: doctor.nextActions ?? [],
        ...(lastKnownGood === undefined ? {} : { lastKnownGood }),
      },
    });
  }
  if (doctor.status !== "ready") {
    trace.push(
      "tool.doctor_warning",
      `External tool ${request.toolId} doctor reported ${doctor.status}; invoke is allowed for adapter-level diagnostics.`,
      {
        toolId: request.toolId,
        status: doctor.status,
      },
    );
  }
  const capability = resolveExternalToolCapability(entry.manifest, request.operationId);
  if (capability === undefined) {
    trace.push(
      "operation.not_found",
      `External tool ${request.toolId} does not expose the requested operation.`,
      {
        operationId: request.operationId ?? "",
        toolId: request.toolId,
      },
    );
    return createInvokeResult({
      ok: false,
      status: "not-found",
      toolId: request.toolId,
      operationId: request.operationId,
      content: `External tool ${request.toolId} does not expose operation ${request.operationId ?? "(default)"}.`,
      error: "external-tool-operation-not-found",
      trace: trace.items,
    });
  }
  const requiresApproval =
    request.dryRun !== true &&
    (capability.requiresApproval === true ||
      capability.destructive === true ||
      capability.readOnly !== true);
  if (request.approval?.status === "rejected") {
    trace.push("permission.denied", `Operator rejected ${request.toolId}.`, {
      toolId: request.toolId,
      operationId: capability.id,
      reason: request.approval.reason ?? "",
    });
    return createInvokeResult({
      ok: false,
      status: "permission-denied",
      toolId: request.toolId,
      operationId: capability.id,
      content: `External tool ${request.toolId} was rejected before execution.`,
      error: "external-tool-permission-denied",
      trace: trace.items,
    });
  }
  const policyVerdict = createExternalToolAgentOsPolicyVerdict({
    request,
    capability,
    requiresApproval,
  });
  const sandboxPreflight = resolveExternalToolSandboxPreflight({
    request,
    manifest: entry.manifest,
    capability,
  });
  if (requiresApproval && request.approval?.status !== "approved") {
    const sandboxExecutionPlan =
      sandboxPreflight.verdict === "allow"
        ? resolveExternalToolSandboxExecutionPlan({
            request,
            manifest: entry.manifest,
            capability,
            sandboxPreflight,
          })
        : undefined;
    const approval = createExternalToolApprovalRequest(entry.manifest, capability, request, {
      policyVerdict,
      sandboxPreflight,
      ...(sandboxExecutionPlan === undefined ? {} : { sandboxExecutionPlan }),
    });
    const approvalExpiresAtMs = getExternalToolApprovalExpiresAtMs(registry, request);
    registry.persistApprovalRequest({ approval, request, capability });
    trace.push("permission.required", `External tool ${request.toolId} requires approval.`, {
      toolId: request.toolId,
      operationId: capability.id,
      approvalId: approval.id,
      sandboxPreflight: sandboxPreflight.verdict,
      ...(sandboxExecutionPlan === undefined
        ? {}
        : { sandboxExecutionPlan: sandboxExecutionPlan.status }),
    });
    return createInvokeResult({
      ok: false,
      status: "approval-required",
      toolId: request.toolId,
      operationId: capability.id,
      content: approval.summary,
      error: "external-tool-approval-required",
      approval,
      trace: trace.items,
      metadata: {
        ...(request.metadata ?? {}),
        approvalExpiresAtMs,
      },
    });
  }
  if (requiresApproval) {
    const approvalVerification = registry.verifyApprovedRequest({ request, capability });
    if (!approvalVerification.ok) {
      trace.push("permission.denied", `External tool ${request.toolId} approval is not valid.`, {
        toolId: request.toolId,
        operationId: capability.id,
        reason: approvalVerification.reason,
      });
      return createInvokeResult({
        ok: false,
        status: "permission-denied",
        toolId: request.toolId,
        operationId: capability.id,
        content: `External tool ${request.toolId} approval is not valid: ${approvalVerification.reason}.`,
        error: mapExternalToolApprovalLedgerError(approvalVerification.reason),
        trace: trace.items,
      });
    }
    trace.push("permission.approved", `Operator approved ${request.toolId}.`, {
      toolId: request.toolId,
      operationId: capability.id,
      operatorId: request.approval?.operatorId ?? "",
    });
  }
  if (request.dryRun === true) {
    trace.push("tool.dry_run", `External tool ${request.toolId} dry run completed.`, {
      toolId: request.toolId,
      operationId: capability.id,
    });
    return createInvokeResult({
      ok: true,
      status: "dry-run",
      toolId: request.toolId,
      operationId: capability.id,
      content: `Dry run passed for ${request.toolId}:${capability.id}.`,
      trace: trace.items,
      ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    });
  }
  trace.push(
    "sandbox.preflight",
    sandboxPreflight.verdict === "allow"
      ? `Agent OS sandbox preflight allowed ${request.toolId}.`
      : `Agent OS sandbox preflight blocked ${request.toolId}.`,
    {
      toolId: request.toolId,
      operationId: capability.id,
      status: sandboxPreflight.verdict,
      sandboxMode: sandboxPreflight.sandboxMode,
      providerId: sandboxPreflight.providerId ?? "",
      reason: sandboxPreflight.reason ?? "",
      policyVerdict: policyVerdict.verdict,
    },
  );
  if (sandboxPreflight.verdict !== "allow") {
    return createInvokeResult({
      ok: false,
      status: "permission-denied",
      toolId: request.toolId,
      operationId: capability.id,
      content:
        sandboxPreflight.reason ??
        `External tool ${request.toolId} was blocked by Agent OS sandbox preflight.`,
      error: "external-tool-sandbox-preflight-denied",
      trace: trace.items,
      metadata: {
        agentOsPolicyVerdict: policyVerdict,
        agentOsSandboxPreflight: sandboxPreflight,
      },
    });
  }
  const sandboxExecutionPlan = resolveExternalToolSandboxExecutionPlan({
    request,
    manifest: entry.manifest,
    capability,
    sandboxPreflight,
  });
  trace.push(
    "sandbox.execution_plan",
    sandboxExecutionPlan.ok
      ? `Agent OS sandbox execution plan allowed ${request.toolId}.`
      : `Agent OS sandbox execution plan blocked ${request.toolId}.`,
    {
      toolId: request.toolId,
      operationId: capability.id,
      status: sandboxExecutionPlan.status,
      backend: sandboxPreflight.sandboxMode,
      ...(sandboxExecutionPlan.ok ? { cwd: sandboxExecutionPlan.cwd ?? "" } : {}),
      ...(!sandboxExecutionPlan.ok
        ? {
            error: sandboxExecutionPlan.error,
            reason: sandboxExecutionPlan.reason,
          }
        : {}),
    },
  );
  if (!sandboxExecutionPlan.ok) {
    return createInvokeResult({
      ok: false,
      status: "permission-denied",
      toolId: request.toolId,
      operationId: capability.id,
      content: sandboxExecutionPlan.reason,
      error: "external-tool-sandbox-plan-denied",
      trace: trace.items,
      metadata: {
        agentOsPolicyVerdict: policyVerdict,
        agentOsSandboxPreflight: sandboxPreflight,
        agentOsSandboxExecutionPlan: sandboxExecutionPlan,
      },
    });
  }
  const sandboxBackendAdmission = await admitAgentOsSandboxExecution(sandboxExecutionPlan, {
    registry: registry.getSandboxBackendRegistry(),
  });
  trace.push(
    "sandbox.backend_admission",
    sandboxBackendAdmission.ok
      ? `Agent OS sandbox backend admitted ${request.toolId}.`
      : `Agent OS sandbox backend blocked ${request.toolId}.`,
    {
      toolId: request.toolId,
      operationId: capability.id,
      status: sandboxBackendAdmission.status,
      backend: sandboxExecutionPlan.backend,
      providerId: sandboxBackendAdmission.providerId ?? "",
      ...(sandboxBackendAdmission.ok
        ? {
            cwd: sandboxBackendAdmission.cwd ?? "",
            networkPolicy: sandboxBackendAdmission.networkPolicy ?? "",
            ...(sandboxBackendAdmission.filesystem === undefined
              ? {}
              : { filesystem: sandboxBackendAdmission.filesystem }),
            ...(sandboxBackendAdmission.enforcement === undefined
              ? {}
              : { enforcement: sandboxBackendAdmission.enforcement }),
            ...(sandboxBackendAdmission.backendConfig === undefined
              ? {}
              : { backendConfig: sandboxBackendAdmission.backendConfig }),
            ...(sandboxBackendAdmission.planHash === undefined
              ? {}
              : { planHash: sandboxBackendAdmission.planHash }),
          }
        : {
            error: sandboxBackendAdmission.error ?? "",
            reason: sandboxBackendAdmission.reason ?? "",
          }),
    },
  );
  if (!sandboxBackendAdmission.ok) {
    return createInvokeResult({
      ok: false,
      status: "permission-denied",
      toolId: request.toolId,
      operationId: capability.id,
      content:
        sandboxBackendAdmission.reason ??
        `External tool ${request.toolId} was blocked by Agent OS sandbox backend admission.`,
      error: "external-tool-sandbox-backend-denied",
      trace: trace.items,
      metadata: {
        agentOsPolicyVerdict: policyVerdict,
        agentOsSandboxPreflight: sandboxPreflight,
        agentOsSandboxExecutionPlan: sandboxExecutionPlan,
        agentOsSandboxBackendAdmission: sandboxBackendAdmission,
      },
    });
  }
  if (entry.sandboxCommandExecution?.enabled === true) {
    const sandboxCommandExecution = await executeAgentOsSandboxCommand(
      sandboxExecutionPlan,
      sandboxBackendAdmission,
      {
        registry: registry.getSandboxBackendRegistry(),
      },
    );
    trace.push(
      "sandbox.command_execution",
      sandboxCommandExecution.ok
        ? `Agent OS sandbox command execution completed ${request.toolId}.`
        : `Agent OS sandbox command execution blocked ${request.toolId}.`,
      {
        toolId: request.toolId,
        operationId: capability.id,
        status: sandboxCommandExecution.status,
        backend: sandboxCommandExecution.backend ?? sandboxExecutionPlan.backend,
        providerId: sandboxCommandExecution.providerId ?? "",
        ...(sandboxCommandExecution.ok
          ? {
              exitCode: sandboxCommandExecution.exitCode ?? 0,
              ...(sandboxCommandExecution.evidence === undefined
                ? {}
                : { evidence: sandboxCommandExecution.evidence }),
            }
          : {
              error: sandboxCommandExecution.error ?? "",
              reason: sandboxCommandExecution.reason ?? "",
              ...(sandboxCommandExecution.evidence === undefined
                ? {}
                : { evidence: sandboxCommandExecution.evidence }),
            }),
      },
    );
    if (!sandboxCommandExecution.ok) {
      return createInvokeResult({
        ok: false,
        status: "permission-denied",
        toolId: request.toolId,
        operationId: capability.id,
        content:
          sandboxCommandExecution.reason ??
          `External tool ${request.toolId} was blocked by Agent OS sandbox command execution.`,
        error: sandboxCommandExecution.error ?? "external-tool-sandbox-command-denied",
        trace: trace.items,
        metadata: {
          agentOsPolicyVerdict: policyVerdict,
          agentOsSandboxPreflight: sandboxPreflight,
          agentOsSandboxExecutionPlan: sandboxExecutionPlan,
          agentOsSandboxBackendAdmission: sandboxBackendAdmission,
          agentOsSandboxCommandExecution: sandboxCommandExecution,
        },
      });
    }
    const artifacts = sandboxCommandExecution.artifacts?.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      ...(artifact.path === undefined ? {} : { path: artifact.path }),
      ...(artifact.url === undefined ? {} : { url: artifact.url }),
      ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
    }));
    const artifactPersistence =
      artifacts === undefined
        ? undefined
        : registry.persistArtifacts({
            request,
            manifest: entry.manifest,
            capability,
            artifacts,
          });
    if (artifactPersistence !== undefined) {
      trace.push("artifact.persisted", `External tool ${request.toolId} artifacts persisted.`, {
        toolId: request.toolId,
        operationId: capability.id,
        artifactIds: artifactPersistence.artifactIds,
        status: artifactPersistence.status,
      });
    }
    return createInvokeResult({
      ok: true,
      status: "success",
      toolId: request.toolId,
      operationId: capability.id,
      content:
        sandboxCommandExecution.stdout ??
        `External tool ${request.toolId} completed in Agent OS sandbox.`,
      output: {
        ...(sandboxCommandExecution.exitCode === undefined
          ? {}
          : { exitCode: sandboxCommandExecution.exitCode }),
        ...(sandboxCommandExecution.stdout === undefined
          ? {}
          : { stdout: sandboxCommandExecution.stdout }),
        ...(sandboxCommandExecution.stderr === undefined
          ? {}
          : { stderr: sandboxCommandExecution.stderr }),
      },
      ...(artifacts === undefined ? {} : { artifacts }),
      trace: trace.items,
      metadata: createExternalToolSandboxCommandExecutionMetadata({
        policyVerdict,
        sandboxPreflight,
        sandboxExecutionPlan,
        sandboxBackendAdmission,
        sandboxCommandExecution,
        ...(artifactPersistence === undefined ? {} : { artifactPersistence }),
      }),
    });
  }
  if (entry.invoke === undefined) {
    trace.push("tool.invoke_missing", `External tool ${request.toolId} has no invoke handler.`, {
      toolId: request.toolId,
      operationId: capability.id,
    });
    return createInvokeResult({
      ok: false,
      status: "error",
      toolId: request.toolId,
      operationId: capability.id,
      content: `External tool ${request.toolId} has no invoke handler configured.`,
      error: "external-tool-invoke-unavailable",
      trace: trace.items,
    });
  }
  const argAdmissionDenial = createExternalToolArgAdmissionDenial(request, capability);
  if (argAdmissionDenial !== undefined) {
    trace.push(
      "args.admission_denied",
      `External tool ${request.toolId} args were rejected by capability admission policy.`,
      argAdmissionDenial,
    );
    return createInvokeResult({
      ok: false,
      status: "permission-denied",
      toolId: request.toolId,
      operationId: capability.id,
      content: `External tool ${request.toolId} args were rejected by capability admission policy.`,
      error: "external-tool-arg-admission-denied",
      trace: trace.items,
      metadata: {
        argAdmission: argAdmissionDenial,
      },
    });
  }
  try {
    const output = await entry.invoke({
      ...request,
      operationId: capability.id,
      args: request.args ?? {},
      manifest: entry.manifest,
      capability,
      doctor,
    });
    trace.push(output.ok ? "tool.completed" : "tool.failed", output.content, {
      toolId: request.toolId,
      operationId: capability.id,
      ok: output.ok,
    });
    const artifactPersistence =
      output.artifacts === undefined
        ? undefined
        : registry.persistArtifacts({
            request,
            manifest: entry.manifest,
            capability,
            artifacts: output.artifacts,
          });
    if (artifactPersistence !== undefined) {
      trace.push("artifact.persisted", `External tool ${request.toolId} artifacts persisted.`, {
        toolId: request.toolId,
        operationId: capability.id,
        artifactIds: artifactPersistence.artifactIds,
        status: artifactPersistence.status,
      });
    }
    return createInvokeResult({
      ok: output.ok,
      status: output.status ?? (output.ok ? "success" : "error"),
      toolId: request.toolId,
      operationId: capability.id,
      content: output.content,
      ...(output.output === undefined ? {} : { output: output.output }),
      ...(output.error === undefined ? {} : { error: output.error }),
      ...(output.artifacts === undefined ? {} : { artifacts: output.artifacts }),
      trace: trace.items,
      metadata: createExternalToolInvokeSuccessMetadata({
        ...(request.metadata === undefined ? {} : { requestMetadata: request.metadata }),
        ...(output.metadata === undefined ? {} : { outputMetadata: output.metadata }),
        sandboxBackendAdmission,
        ...(artifactPersistence === undefined ? {} : { artifactPersistence }),
      }),
    });
  } catch (error) {
    const message = toErrorMessage(error);
    trace.push("tool.failed", `External tool ${request.toolId} failed: ${message}`, {
      toolId: request.toolId,
      operationId: capability.id,
    });
    return createInvokeResult({
      ok: false,
      status: "error",
      toolId: request.toolId,
      operationId: capability.id,
      content: `External tool ${request.toolId} failed: ${message}`,
      error: message,
      trace: trace.items,
      metadata: {
        ...(request.metadata ?? {}),
        agentOsSandboxBackendAdmission: sandboxBackendAdmission,
      },
    });
  }
}

export function createExternalToolControlPlane(
  registry: ExternalToolRegistry | (() => ExternalToolRegistry),
): ExternalToolControlPlane {
  const resolveRegistry = () => (typeof registry === "function" ? registry() : registry);
  return {
    listCatalog: () => resolveRegistry().listCatalog(),
    resolveEffective: (options) => resolveRegistry().resolveEffective(options),
    invoke: (request) => invokeExternalTool(resolveRegistry(), request),
  };
}

export async function createExternalToolsCatalogRpcResult(
  controlPlane: ExternalToolControlPlane,
  options: ExternalToolsRpcOptions = {},
): Promise<ExternalToolsCatalogRpcResult> {
  const catalog = createExternalToolCatalog(await controlPlane.listCatalog()).map(
    formatExternalToolsCatalogEntry,
  );
  const agentOsExtensionMatrix = createAgentOsExtensionMatrixFromExternalTools(catalog);
  return {
    schemaVersion: "director.external-tools.catalog.v1",
    agentId: normalizeExternalToolsAgentId(options.agentId),
    catalogCount: catalog.length,
    ...(agentOsExtensionMatrix === undefined ? {} : { agentOsExtensionMatrix }),
    groups: groupExternalToolsCatalogEntries(catalog),
    catalog,
  };
}

export async function createExternalToolsEffectiveRpcResult(
  controlPlane: ExternalToolControlPlane,
  options: ExternalToolsRpcOptions = {},
): Promise<ExternalToolsEffectiveRpcResult> {
  const effective = (
    await controlPlane.resolveEffective({
      includeUnavailable: options.includeUnavailable === true,
    })
  ).map(formatExternalToolsEffectiveEntry);
  const agentOsExtensionMatrix = createAgentOsExtensionMatrixFromExternalTools(effective);
  return {
    schemaVersion: "director.external-tools.effective.v1",
    agentId: normalizeExternalToolsAgentId(options.agentId),
    ...(options.sessionKey === undefined ? {} : { sessionKey: options.sessionKey }),
    profile: options.profile ?? "default",
    effectiveCount: effective.filter((tool) => tool.canInvoke).length,
    unavailableCount: effective.filter((tool) => !tool.canInvoke).length,
    providerMatrix: createExternalToolsProviderCapabilityMatrix(effective),
    ...(agentOsExtensionMatrix === undefined ? {} : { agentOsExtensionMatrix }),
    groups: groupExternalToolsEffectiveEntries(effective),
    tools: effective,
  };
}

export async function invokeExternalToolControlPlane(
  controlPlane: ExternalToolControlPlane,
  request: ExternalToolInvokeRequest,
): Promise<ExternalToolsInvokeRpcResult> {
  const result = await controlPlane.invoke(request);
  return formatExternalToolsInvokeRpcResult(result);
}

export function createExternalSystemControlRequest(
  input: CreateExternalSystemControlRequestInput,
): ExternalToolInvokeRequest {
  const envelope = createExternalSystemControlEnvelope(input);
  return {
    toolId: envelope.toolId,
    ...(envelope.operationId === undefined ? {} : { operationId: envelope.operationId }),
    args: {
      ...(input.args ?? {}),
      objective: envelope.objective,
    },
    ...(input.command === undefined ? {} : { command: input.command }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(envelope.turnId === undefined ? {} : { turnId: envelope.turnId }),
    ...(envelope.sessionKey === undefined ? {} : { sessionKey: envelope.sessionKey }),
    ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
    ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
    ...(input.sandboxRuntimePolicy === undefined
      ? {}
      : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
    ...(input.requestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
    metadata: {
      ...(input.metadata ?? {}),
      externalSystemControl: envelope,
    },
  };
}

export async function invokeExternalSystemControl(
  controlPlane: ExternalToolControlPlane,
  request: ExternalToolInvokeRequest | CreateExternalSystemControlRequestInput,
): Promise<ExternalToolsInvokeRpcResult> {
  const externalToolRequest = isExternalToolInvokeRequest(request)
    ? request
    : createExternalSystemControlRequest(request);
  const result = await controlPlane.invoke(externalToolRequest);
  return formatExternalToolsInvokeRpcResult(result);
}

export class ExternalToolExecutionQueue {
  readonly #registry: ExternalToolRegistry | (() => ExternalToolRegistry);
  readonly #nowMs: () => number;
  readonly #onTimeline: ((event: ExternalToolExecutionTimelineNotification) => void) | undefined;
  readonly #policyRuntime: Pick<PolicyRuntime, "decide"> | undefined;
  readonly #concurrencyPolicy: ExternalToolConcurrencyPolicy | undefined;
  readonly #resourceLimits: ExternalToolResourceLimits | undefined;
  readonly #items = new Map<string, MutableExternalToolExecution>();
  #tail: Promise<unknown> = Promise.resolve();
  #nextSequence = 1;

  constructor(options: ExternalToolExecutionQueueOptions) {
    this.#registry = options.registry;
    this.#nowMs = options.nowMs ?? (() => Date.now());
    this.#onTimeline = options.onTimeline;
    this.#policyRuntime = options.policyRuntime;
    this.#concurrencyPolicy = options.concurrencyPolicy;
    this.#resourceLimits = options.resourceLimits;
  }

  enqueue(
    request: ExternalToolInvokeRequest,
    options: ExternalToolEnqueueOptions = {},
  ): Promise<ExternalToolExecutionSnapshot> {
    const id = options.executionId ?? this.#createExecutionId(request);
    const now = this.#nowMs();
    const item: MutableExternalToolExecution = {
      id,
      toolId: request.toolId,
      ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
      ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
      request,
      status: "queued",
      queuedAtMs: now,
      timeline: [
        {
          status: "queued",
          occurredAtMs: now,
          detail: `External tool ${request.toolId} queued.`,
        },
      ],
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    };
    this.#items.set(id, item);
    this.#emitTimeline(item, item.timeline[0]);
    const admissionDenied = this.#denyQueueAdmissionIfNeeded(item, request);
    if (admissionDenied !== undefined) {
      return Promise.resolve(admissionDenied);
    }

    const execution = this.#tail.then(() =>
      this.#execute(id, request, options.registry, options.policyRuntime),
    );
    const task = this.#withTimeout(id, request, execution, options.timeoutMs);
    this.#tail = task.catch(() => undefined);
    return task;
  }

  #denyQueueAdmissionIfNeeded(
    item: MutableExternalToolExecution,
    request: ExternalToolInvokeRequest,
  ): ExternalToolExecutionSnapshot | undefined {
    const resourceDenial = createExternalToolResourceLimitDenial({
      request,
      resourceLimits: this.#resourceLimits,
    });
    if (resourceDenial !== undefined) {
      item.result = resourceDenial;
      if (resourceDenial.error !== undefined) {
        item.error = resourceDenial.error;
      }
      this.#mark(item, "failed", resourceDenial.content, {
        reason: "resource-limit",
        ...(resourceDenial.metadata === undefined ? {} : { metadata: resourceDenial.metadata }),
      });
      item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
      return cloneExternalToolExecution(item);
    }
    const concurrencyDenial = createExternalToolConcurrencyDenial({
      request,
      activeExecutions: this.#countInFlightExecutions(item.id),
      activePerProvider: this.#countInFlightExecutionsForProvider(request.toolId, item.id),
      concurrencyPolicy: this.#concurrencyPolicy,
    });
    if (concurrencyDenial !== undefined) {
      item.result = concurrencyDenial;
      if (concurrencyDenial.error !== undefined) {
        item.error = concurrencyDenial.error;
      }
      this.#mark(item, "failed", concurrencyDenial.content, {
        reason: "concurrency-limit",
        ...(concurrencyDenial.metadata === undefined
          ? {}
          : { metadata: concurrencyDenial.metadata }),
      });
      item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
      return cloneExternalToolExecution(item);
    }
    return undefined;
  }

  #countInFlightExecutions(excludingExecutionId: string): number {
    let active = 0;
    for (const item of this.#items.values()) {
      if (item.id !== excludingExecutionId && isExternalToolExecutionInFlight(item.status)) {
        active += 1;
      }
    }
    return active;
  }

  #countInFlightExecutionsForProvider(toolId: string, excludingExecutionId: string): number {
    let active = 0;
    for (const item of this.#items.values()) {
      if (
        item.id !== excludingExecutionId &&
        item.toolId === toolId &&
        isExternalToolExecutionInFlight(item.status)
      ) {
        active += 1;
      }
    }
    return active;
  }

  recordProgress(
    executionId: string,
    detail: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): boolean {
    const item = this.#items.get(executionId);
    if (item === undefined || isExternalToolExecutionTerminal(item.status)) {
      return false;
    }
    this.#mark(item, "yielded", detail, metadata);
    return true;
  }

  cancel(executionId: string, reason = "cancelled"): boolean {
    const item = this.#items.get(executionId);
    if (item === undefined || isExternalToolExecutionTerminal(item.status)) {
      return false;
    }
    item.error = reason;
    this.#mark(item, "cancelled", reason);
    item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
    return true;
  }

  cancelTurn(turnId: string, reason = "cancelled"): number {
    let cancelled = 0;
    for (const item of this.#items.values()) {
      if (item.turnId !== turnId || isExternalToolExecutionTerminal(item.status)) {
        continue;
      }
      item.error = reason;
      this.#mark(item, "cancelled", reason);
      item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
      cancelled += 1;
    }
    return cancelled;
  }

  list(): readonly ExternalToolExecutionSnapshot[] {
    return [...this.#items.values()].map(cloneExternalToolExecution);
  }

  get(id: string): ExternalToolExecutionSnapshot | undefined {
    const item = this.#items.get(id);
    return item === undefined ? undefined : cloneExternalToolExecution(item);
  }

  resumeWatch(
    executionId: string,
    options: ExternalToolEnqueueOptions = {},
  ): Promise<ExternalToolExecutionSnapshot> {
    const item = this.#items.get(executionId);
    if (item === undefined) {
      throw new Error(`External tool watch execution ${executionId} was not found.`);
    }
    if (!isExternalToolWatchExecution(item.request, item)) {
      throw new Error(`External tool execution ${executionId} is not an orchestrator watch.`);
    }
    if (item.status !== "yielded") {
      throw new Error(`External tool watch execution ${executionId} is not resumable.`);
    }
    return this.enqueue(createExternalToolWatchResumeRequest(item, executionId), {
      ...options,
      metadata: {
        ...(item.metadata ?? {}),
        ...(options.metadata ?? {}),
        lifecycle: "orchestrator-watch",
        resumedFromExecutionId: executionId,
      },
    });
  }

  async #execute(
    id: string,
    request: ExternalToolInvokeRequest,
    registryOverride: ExternalToolRegistry | (() => ExternalToolRegistry) | undefined,
    policyRuntimeOverride: Pick<PolicyRuntime, "decide"> | undefined,
  ): Promise<ExternalToolExecutionSnapshot> {
    const item = this.#items.get(id);
    if (item === undefined) {
      throw new Error(`External tool execution ${id} is not queued.`);
    }
    if (isExternalToolExecutionTerminal(item.status) || item.status === "cancelled") {
      return cloneExternalToolExecution(item);
    }
    this.#mark(item, "executing", `External tool ${request.toolId} executing.`);
    item.startedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
    try {
      const registry = this.#resolveRegistry(registryOverride);
      const gatedRequest = await this.#createPolicyGatedRequest({
        request,
        registry,
        executionId: id,
        ...(policyRuntimeOverride === undefined ? {} : { policyRuntimeOverride }),
      });
      if (this.#isTerminal(id)) {
        return cloneExternalToolExecution(item);
      }
      if (gatedRequest.status !== "allowed") {
        if (this.#isTerminal(id)) {
          return cloneExternalToolExecution(item);
        }
        item.result = gatedRequest.result;
        if (gatedRequest.result.error !== undefined) {
          item.error = gatedRequest.result.error;
        }
        const terminalStatus: ExternalToolExecutionStatus =
          gatedRequest.result.status === "approval-required" ? "yielded" : "failed";
        this.#mark(item, terminalStatus, gatedRequest.result.content, {
          invokeStatus: gatedRequest.result.status,
          ok: gatedRequest.result.ok,
          policyVerdict: gatedRequest.policyEnvelope.decision.verdict,
        });
        item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
        return cloneExternalToolExecution(item);
      }
      const result = await this.#invokeWithRetry({
        id,
        item,
        registry,
        request,
        policyEnvelope: gatedRequest.policyEnvelope,
      });
      if (this.#isTerminal(id)) {
        return cloneExternalToolExecution(item);
      }
      item.result = result;
      const terminalStatus: ExternalToolExecutionStatus =
        result.status === "approval-required" ? "yielded" : "completed";
      this.#mark(item, terminalStatus, result.content, {
        invokeStatus: result.status,
        ok: result.ok,
      });
      item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
      return cloneExternalToolExecution(item);
    } catch (error) {
      if (this.#isTerminal(id)) {
        return cloneExternalToolExecution(item);
      }
      item.error = toErrorMessage(error);
      this.#mark(item, "failed", `External tool ${request.toolId} failed: ${item.error}`);
      item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
      return cloneExternalToolExecution(item);
    }
  }

  #mark(
    item: MutableExternalToolExecution,
    status: ExternalToolExecutionStatus,
    detail: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): void {
    const occurredAtMs = this.#nowMs();
    item.status = status;
    item.timeline.push({
      status,
      occurredAtMs,
      detail,
      ...(metadata === undefined ? {} : { metadata }),
    });
    this.#emitTimeline(item, item.timeline[item.timeline.length - 1]);
  }

  async #invokeWithRetry(input: {
    readonly id: string;
    readonly item: MutableExternalToolExecution;
    readonly registry: ExternalToolRegistry;
    readonly request: ExternalToolInvokeRequest;
    readonly policyEnvelope: ConversationRuntimePolicyDecisionEnvelope | undefined;
  }): Promise<ExternalToolInvokeResult> {
    const baseMetadata = {
      ...(input.request.metadata ?? {}),
      executionId: input.id,
      policyEnvelope: input.policyEnvelope,
    };
    const invoke = () =>
      invokeExternalTool(input.registry, {
        ...input.request,
        metadata: baseMetadata,
      });
    let attempt = 1;
    const retryHistory: ExternalToolRetryHistoryEntry[] = [];
    let result = await invoke();
    while (true) {
      const retryPlan = resolveExternalToolRetryPlan(input.request, result);
      if (retryPlan === undefined) {
        return withExternalToolRetryMetadata(result, retryHistory);
      }
      retryHistory.push(createExternalToolRetryHistoryEntry(attempt, result, this.#nowMs()));
      if (attempt >= retryPlan.maxAttempts) {
        return withExternalToolRetryMetadata(result, retryHistory, retryPlan.stopCondition);
      }
      this.#mark(input.item, "yielded", `External tool ${input.request.toolId} retrying.`, {
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts: retryPlan.maxAttempts,
        reason: result.error ?? result.status,
        stopCondition: retryPlan.stopCondition,
      });
      const delayMs = retryPlan.delayMsForAttempt(attempt);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      attempt += 1;
      result = await invoke();
      if (result.ok) {
        retryHistory.push(createExternalToolRetryHistoryEntry(attempt, result, this.#nowMs()));
        return withExternalToolRetryMetadata(result, retryHistory, retryPlan.stopCondition);
      }
    }
  }

  #withTimeout(
    id: string,
    request: ExternalToolInvokeRequest,
    task: Promise<ExternalToolExecutionSnapshot>,
    timeoutMs: number | undefined,
  ): Promise<ExternalToolExecutionSnapshot> {
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return task;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutTask = new Promise<ExternalToolExecutionSnapshot>((resolve) => {
      timeout = setTimeout(() => {
        const item = this.#items.get(id);
        if (item === undefined) {
          resolve({
            id,
            toolId: request.toolId,
            ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
            status: "failed",
            queuedAtMs: this.#nowMs(),
            timeline: [],
            error: "external-tool-execution-timeout",
          });
          return;
        }
        if (isExternalToolExecutionTerminal(item.status)) {
          resolve(cloneExternalToolExecution(item));
          return;
        }
        const operation = request.operationId ? `/${request.operationId}` : "";
        const message = `External tool ${request.toolId}${operation} timed out after ${timeoutMs}ms.`;
        const watchExecution = isExternalToolWatchExecution(request, item);
        item.error = message;
        item.result = {
          ok: false,
          status: "error",
          toolId: request.toolId,
          ...(request.operationId === undefined ? {} : { operationId: request.operationId }),
          content: message,
          error: watchExecution ? "external-tool-watch-timeout" : "external-tool-execution-timeout",
          trace: [],
          metadata: {
            timeoutMs,
            ...(watchExecution
              ? {
                  partial: true,
                  lifecycle: "orchestrator-watch",
                }
              : {}),
          },
        };
        this.#mark(item, watchExecution ? "yielded" : "failed", message, {
          reason: "timeout",
          timeoutMs,
          ...(watchExecution ? { partial: true, lifecycle: "orchestrator-watch" } : {}),
        });
        item.completedAtMs = item.timeline.at(-1)?.occurredAtMs ?? this.#nowMs();
        resolve(cloneExternalToolExecution(item));
      }, timeoutMs);
    });
    return Promise.race([task, timeoutTask]).finally(() => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    });
  }

  #createExecutionId(request: ExternalToolInvokeRequest): string {
    const sequence = this.#nextSequence;
    this.#nextSequence += 1;
    return [
      "external-tool",
      request.turnId ?? "turn",
      request.toolId,
      request.operationId ?? "default",
      sequence,
    ].join(":");
  }

  #isTerminal(id: string): boolean {
    const status = this.#items.get(id)?.status;
    return status !== undefined && isExternalToolExecutionTerminal(status);
  }

  #resolveRegistry(
    registryOverride?: ExternalToolRegistry | (() => ExternalToolRegistry),
  ): ExternalToolRegistry {
    const registry = registryOverride ?? this.#registry;
    return typeof registry === "function" ? registry() : registry;
  }

  async #createPolicyGatedRequest(input: {
    readonly request: ExternalToolInvokeRequest;
    readonly registry: ExternalToolRegistry;
    readonly executionId: string;
    readonly policyRuntimeOverride?: Pick<PolicyRuntime, "decide">;
  }): Promise<ExternalToolPolicyGatedRequest> {
    const policyRuntime = input.policyRuntimeOverride ?? this.#policyRuntime;
    if (policyRuntime === undefined) {
      return { status: "allowed" };
    }
    const profile = resolveExternalToolPolicyProfile(input.registry, input.request);
    if (profile === undefined) {
      return { status: "allowed" };
    }
    const budget = readExternalToolPolicyBudget(input.request.metadata);
    const approval = normalizeExternalToolPolicyApproval(input.request.approval);
    const policyEnvelope = await createConversationRuntimePolicyEnvelope({
      action: "external_tool.dispatch",
      resourceRef: createExternalToolPolicyResourceRef(input.request, profile.capability),
      ...(input.request.sessionKey === undefined ? {} : { actor: input.request.sessionKey }),
      risk: {
        level: profile.riskLevel,
        capabilities: profile.capabilities,
      },
      ...(budget === undefined ? {} : { budget }),
      ...(approval === undefined ? {} : { approval }),
      evidenceRefIds: readExternalToolPolicyStringList(input.request.metadata, "evidenceRefIds"),
      sourceRefs: readExternalToolPolicyStringList(input.request.metadata, "sourceRefs"),
      metadata: {
        toolId: input.request.toolId,
        operationId: profile.capability.id,
        executionId: input.executionId,
        source: profile.manifest.source,
        kind: profile.manifest.kind,
        ...(profile.manifest.providerId === undefined
          ? {}
          : { providerId: profile.manifest.providerId }),
      },
      policyRuntime,
      nowMs: this.#nowMs,
    });
    if (policyEnvelope.decision.verdict === "allow") {
      return { status: "allowed", policyEnvelope };
    }
    const blockedStatus: ExternalToolInvokeStatus =
      policyEnvelope.decision.verdict === "ask" ? "approval-required" : "permission-denied";
    return {
      status: "blocked",
      policyEnvelope,
      result: createInvokeResult({
        ok: false,
        status: blockedStatus,
        toolId: input.request.toolId,
        operationId: profile.capability.id,
        content: `External tool ${input.request.toolId} blocked by policy: ${policyEnvelope.decision.reason}`,
        error:
          blockedStatus === "approval-required"
            ? "external-tool-policy-approval-required"
            : "external-tool-policy-denied",
        trace: [
          {
            stage: "policy.blocked",
            detail: `External tool ${input.request.toolId} dispatch blocked by policy.`,
            occurredAtMs: this.#nowMs(),
            metadata: {
              verdict: policyEnvelope.decision.verdict,
              reason: policyEnvelope.decision.reason,
            },
          },
        ],
        metadata: {
          ...(input.request.metadata ?? {}),
          executionId: input.executionId,
          policyEnvelope,
        },
      }),
    };
  }

  #emitTimeline(
    item: MutableExternalToolExecution,
    entry: ExternalToolExecutionTimelineEntry | undefined,
  ): void {
    if (entry === undefined || this.#onTimeline === undefined) {
      return;
    }
    try {
      this.#onTimeline({
        execution: cloneExternalToolExecution(item),
        entry: { ...entry },
      });
    } catch {
      // Timeline observers must never break tool execution.
    }
  }
}

function isExternalToolExecutionTerminal(status: ExternalToolExecutionStatus): boolean {
  return status === "cancelled" || status === "completed" || status === "failed";
}

function isExternalToolExecutionInFlight(status: ExternalToolExecutionStatus): boolean {
  return status === "queued" || status === "executing" || status === "yielded";
}

function isExternalToolWatchExecution(
  request: ExternalToolInvokeRequest,
  item: MutableExternalToolExecution,
): boolean {
  return (
    request.operationId === "watch" ||
    request.operationId?.endsWith(".watch") === true ||
    request.metadata?.lifecycle === "orchestrator-watch" ||
    item.metadata?.lifecycle === "orchestrator-watch"
  );
}

function createExternalToolWatchResumeRequest(
  item: MutableExternalToolExecution,
  resumedFromExecutionId: string,
): ExternalToolInvokeRequest {
  const resumeToken = readExternalToolResumeToken(item);
  return {
    ...item.request,
    args: {
      ...(item.request.args ?? {}),
      ...(resumeToken === undefined ? {} : { resumeToken }),
    },
    metadata: {
      ...(item.request.metadata ?? {}),
      lifecycle: "orchestrator-watch",
      resumedFromExecutionId,
    },
  };
}

function readExternalToolResumeToken(item: MutableExternalToolExecution): string | undefined {
  const resultMetadata = item.result?.metadata;
  const output = item.result?.output;
  const outputMetadata =
    isRecord(output) && isRecord(output.metadata) ? output.metadata : undefined;
  return (
    readMetadataString(resultMetadata ?? {}, "resumeToken") ??
    readMetadataString(outputMetadata ?? {}, "resumeToken") ??
    readMetadataString(item.request.args ?? {}, "resumeToken") ??
    readMetadataString(item.metadata ?? {}, "resumeToken")
  );
}

interface ExternalToolRetryPlan {
  readonly maxAttempts: number;
  readonly stopCondition: Readonly<Record<string, unknown>>;
  readonly delayMsForAttempt: (attempt: number) => number;
}

function resolveExternalToolRetryPlan(
  request: ExternalToolInvokeRequest,
  result: ExternalToolInvokeResult,
): ExternalToolRetryPlan | undefined {
  if (result.ok || !isSafeExternalToolRetryRequest(request)) {
    return undefined;
  }
  const retryPolicy = readExternalToolRetryPolicy(result);
  if (retryPolicy === undefined || retryPolicy.executor !== "orchestrator") {
    return undefined;
  }
  const maxAttempts = normalizeExternalToolRetryAttempts(retryPolicy.maxAttempts);
  if (maxAttempts <= 1) {
    return undefined;
  }
  const initialDelayMs = normalizeExternalToolRetryDelayMs(retryPolicy.initialDelayMs);
  const stopCondition = readExternalToolStopCondition(result) ?? {
    type: "max_attempts_reached",
    threshold: maxAttempts,
    action: "return_error_to_brain",
  };
  return {
    maxAttempts,
    stopCondition,
    delayMsForAttempt: (attempt) =>
      retryPolicy.strategy === "policy.exponential_backoff"
        ? initialDelayMs * 2 ** Math.max(0, attempt - 1)
        : initialDelayMs,
  };
}

function isSafeExternalToolRetryRequest(request: ExternalToolInvokeRequest): boolean {
  return (
    request.dryRun === true ||
    (request.approval === undefined &&
      request.command === undefined &&
      request.sandboxPolicy === undefined &&
      request.sandboxPreflight === undefined &&
      request.sandboxRuntimePolicy === undefined &&
      request.requestedNetworkPolicy === undefined)
  );
}

function readExternalToolRetryPolicy(
  result: ExternalToolInvokeResult,
): Readonly<Record<string, unknown>> | undefined {
  const metadataError = isRecord(result.metadata?.error) ? result.metadata.error : undefined;
  const nestedSafeRetry = metadataError?.safeRetry;
  if (isRecord(nestedSafeRetry)) {
    return nestedSafeRetry;
  }
  const directSafeRetry = result.metadata?.safeRetry;
  return isRecord(directSafeRetry) ? directSafeRetry : undefined;
}

function readExternalToolStopCondition(
  result: ExternalToolInvokeResult,
): Readonly<Record<string, unknown>> | undefined {
  const metadataError = isRecord(result.metadata?.error) ? result.metadata.error : undefined;
  const nestedStopCondition = metadataError?.stopCondition;
  if (isRecord(nestedStopCondition)) {
    return nestedStopCondition;
  }
  const directStopCondition = result.metadata?.stopCondition;
  return isRecord(directStopCondition) ? directStopCondition : undefined;
}

function normalizeExternalToolRetryAttempts(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 1 ? Math.floor(value) : 1;
}

function normalizeExternalToolRetryDelayMs(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function createExternalToolRetryHistoryEntry(
  attempt: number,
  result: ExternalToolInvokeResult,
  occurredAtMs: number,
): ExternalToolRetryHistoryEntry {
  return {
    attempt,
    occurredAtMs,
    result: result.ok ? "succeeded" : "failed",
    status: result.status,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

function withExternalToolRetryMetadata(
  result: ExternalToolInvokeResult,
  retryHistory: readonly ExternalToolRetryHistoryEntry[],
  stopCondition?: Readonly<Record<string, unknown>>,
): ExternalToolInvokeResult {
  if (retryHistory.length === 0) {
    return result;
  }
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      retryHistory,
      ...(stopCondition === undefined ? {} : { stopCondition }),
    },
  };
}

function createExternalToolConcurrencyDenial(input: {
  readonly request: ExternalToolInvokeRequest;
  readonly activeExecutions: number;
  readonly activePerProvider: number;
  readonly concurrencyPolicy: ExternalToolConcurrencyPolicy | undefined;
}): ExternalToolInvokeResult | undefined {
  const policy = input.concurrencyPolicy;
  if (policy === undefined) {
    return undefined;
  }
  const maxActiveExecutions = normalizePositiveInteger(policy.maxActiveExecutions);
  const providerLimit = normalizePositiveInteger(
    policy.maxActivePerProvider?.[input.request.toolId],
  );
  const globalExceeded =
    maxActiveExecutions !== undefined && input.activeExecutions >= maxActiveExecutions;
  const providerExceeded = providerLimit !== undefined && input.activePerProvider >= providerLimit;
  if (!globalExceeded && !providerExceeded) {
    return undefined;
  }
  const metadata = {
    concurrencyPolicy: {
      onLimitExceeded: policy.onLimitExceeded ?? "reject",
      activeExecutions: input.activeExecutions,
      activePerProvider: input.activePerProvider,
      ...(maxActiveExecutions === undefined ? {} : { maxActiveExecutions }),
      ...(providerLimit === undefined ? {} : { maxActivePerProvider: providerLimit }),
      exceeded: globalExceeded ? "global" : "provider",
    },
  };
  return createInvokeResult({
    ok: false,
    status: "permission-denied",
    toolId: input.request.toolId,
    operationId: input.request.operationId,
    content: `External tool ${input.request.toolId} was rejected by execution queue concurrency policy.`,
    error: "external-tool-queue-limit-exceeded",
    trace: [
      {
        stage: "queue.admission_denied",
        detail: `External tool ${input.request.toolId} exceeded queue concurrency policy.`,
        metadata,
      },
    ],
    metadata,
  });
}

function createExternalToolResourceLimitDenial(input: {
  readonly request: ExternalToolInvokeRequest;
  readonly resourceLimits: ExternalToolResourceLimits | undefined;
}): ExternalToolInvokeResult | undefined {
  const limits = input.resourceLimits;
  if (limits === undefined) {
    return undefined;
  }
  const estimate = readExternalToolResourceEstimate(input.request.metadata);
  if (estimate === undefined) {
    return undefined;
  }
  const maxMemoryMb = normalizePositiveNumber(limits.maxMemoryMb);
  const maxDiskMb = normalizePositiveNumber(limits.maxDiskMb);
  const maxNetworkMbps = normalizePositiveNumber(limits.maxNetworkMbps);
  const memoryExceeded =
    maxMemoryMb !== undefined && estimate.memoryMb !== undefined && estimate.memoryMb > maxMemoryMb;
  const diskExceeded =
    maxDiskMb !== undefined && estimate.diskMb !== undefined && estimate.diskMb > maxDiskMb;
  const networkExceeded =
    maxNetworkMbps !== undefined &&
    estimate.networkMbps !== undefined &&
    estimate.networkMbps > maxNetworkMbps;
  if (!memoryExceeded && !diskExceeded && !networkExceeded) {
    return undefined;
  }
  const metadata = {
    resourceLimits: {
      ...(maxMemoryMb === undefined ? {} : { maxMemoryMb }),
      ...(maxDiskMb === undefined ? {} : { maxDiskMb }),
      ...(maxNetworkMbps === undefined ? {} : { maxNetworkMbps }),
    },
    resourceEstimate: estimate,
    exceeded: [
      ...(memoryExceeded ? ["memory"] : []),
      ...(diskExceeded ? ["disk"] : []),
      ...(networkExceeded ? ["network"] : []),
    ],
  };
  return createInvokeResult({
    ok: false,
    status: "permission-denied",
    toolId: input.request.toolId,
    operationId: input.request.operationId,
    content: `External tool ${input.request.toolId} was rejected because resource limits would be exceeded.`,
    error: "RESOURCE_LIMIT_EXCEEDED",
    trace: [
      {
        stage: "queue.resource_denied",
        detail: `External tool ${input.request.toolId} exceeded resource policy.`,
        metadata,
      },
    ],
    metadata,
  });
}

function readExternalToolResourceEstimate(metadata: Readonly<Record<string, unknown>> | undefined):
  | {
      readonly memoryMb?: number;
      readonly diskMb?: number;
      readonly networkMbps?: number;
    }
  | undefined {
  if (!isRecord(metadata?.resourceEstimate)) {
    return undefined;
  }
  const memoryMb = normalizePositiveNumber(metadata.resourceEstimate.memoryMb);
  const diskMb = normalizePositiveNumber(metadata.resourceEstimate.diskMb);
  const networkMbps = normalizePositiveNumber(metadata.resourceEstimate.networkMbps);
  if (memoryMb === undefined && diskMb === undefined && networkMbps === undefined) {
    return undefined;
  }
  return {
    ...(memoryMb === undefined ? {} : { memoryMb }),
    ...(diskMb === undefined ? {} : { diskMb }),
    ...(networkMbps === undefined ? {} : { networkMbps }),
  };
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const normalized = normalizePositiveNumber(value);
  return normalized === undefined ? undefined : Math.floor(normalized);
}

function normalizePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeExternalToolManifest(manifest: ExternalToolManifest): ExternalToolManifest {
  return {
    ...manifest,
    id: manifest.id.trim(),
    label: manifest.label.trim() || manifest.id.trim(),
    description: manifest.description.trim(),
    ...(manifest.sourceTrust === undefined
      ? {}
      : { sourceTrust: normalizeExternalToolSourceTrust(manifest.sourceTrust) }),
    ...(manifest.installPolicy === undefined
      ? {}
      : { installPolicy: normalizeExternalToolInstallPolicy(manifest.installPolicy) }),
    ...(manifest.approvalBoundary === undefined
      ? {}
      : { approvalBoundary: normalizeExternalToolApprovalBoundary(manifest.approvalBoundary) }),
    capabilities: manifest.capabilities.map(normalizeExternalToolCapability),
  };
}

function createAgentOsExtensionExternalToolDescription(entry: AgentOsExtensionMatrixEntry): string {
  const capabilityText =
    entry.capabilityIds.length === 0
      ? "no declared capabilities"
      : `${entry.capabilityIds.length} declared capabilities`;
  return `${entry.displayName} Agent OS extension projection with ${capabilityText}.`;
}

function mapAgentOsExtensionSource(entry: AgentOsExtensionMatrixEntry): ExternalToolSource {
  if (entry.sourceTrust.status === "built-in") {
    return "built-in";
  }
  if (entry.kind === "tool-source" && entry.providerId === "mcp") {
    return "mcp";
  }
  return "external";
}

function mapAgentOsExtensionSourceTrust(
  sourceTrust: AgentOsExtensionSourceTrust,
): ExternalToolSourceTrust {
  return {
    status: sourceTrust.status,
    ...(sourceTrust.label === undefined ? {} : { label: sourceTrust.label }),
    ...(sourceTrust.reason === undefined ? {} : { reason: sourceTrust.reason }),
  };
}

function mapAgentOsExtensionInstallPolicy(
  installPolicy: AgentOsExtensionInstallPolicy,
  sandbox: AgentOsExtensionSandboxPolicy,
): ExternalToolInstallPolicy {
  return {
    supported: installPolicy.supported,
    defaultMode: installPolicy.defaultMode,
    requiresApproval: installPolicy.requiresExplicitExecute === true,
    requiresExplicitExecute: installPolicy.requiresExplicitExecute === true,
    allowedMethods: installPolicy.supported ? [sandbox.defaultMode] : [],
    refuses: installPolicy.supported ? ["silent-install"] : [],
  };
}

function mapAgentOsExtensionApprovalBoundary(
  entry: AgentOsExtensionMatrixEntry,
): ExternalToolApprovalBoundary {
  const requiresOperator =
    entry.capabilities.some((capability) => capability.requiresApproval === true) ||
    entry.installPolicy.requiresExplicitExecute === true ||
    entry.sandbox.requiresCommandPattern === true;
  return {
    mode: requiresOperator ? "operator-confirm" : "runtime-policy",
    summary: `${entry.displayName} follows Agent OS extension policy.`,
    actionLabels: ["确认", "拒绝"],
    requiresOperator,
    riskLevel: createAgentOsExtensionRiskLevel(entry),
    metadata: {
      agentOsExtensionId: entry.id,
      agentOsUiSurfaces: entry.uiSurfaces,
      agentOsSandboxPolicy: entry.sandbox,
    },
  };
}

function createAgentOsExtensionRiskLevel(entry: AgentOsExtensionMatrixEntry): string {
  if (
    entry.capabilities.some((capability) => capability.risk === "high") ||
    entry.sandbox.defaultMode === "host" ||
    entry.sandbox.defaultMode === "ssh" ||
    entry.sandbox.defaultMode === "docker"
  ) {
    return "high";
  }
  if (
    entry.capabilities.some((capability) => capability.risk === "medium") ||
    entry.capabilities.some((capability) => capability.readOnly !== true)
  ) {
    return "medium";
  }
  return "low";
}

function createAgentOsExtensionProviderStatus(
  entry: AgentOsExtensionMatrixEntry,
): ExternalProviderStatus {
  const configuredSecret = entry.secrets.some((secret) => secret.required);
  const firstSecret = entry.secrets.find((secret) => secret.required);
  return {
    id: entry.providerId ?? entry.id,
    label: entry.displayName,
    enabled: entry.health.status !== "disabled",
    status: mapAgentOsExtensionHealthStatus(entry.health.status),
    summary: entry.health.message ?? createAgentOsExtensionHealthSummary(entry),
    checkedAtMs:
      entry.health.checkedAt === undefined ? Date.now() : Date.parse(entry.health.checkedAt),
    capabilities: entry.capabilityIds,
    configuredSecret,
    ...(firstSecret === undefined || firstSecret.allowedSources.length === 0
      ? {}
      : { configuredSecretRefSource: firstSecret.allowedSources[0] }),
    activeSurface: entry.health.status === "ready",
    diagnostics: createAgentOsExtensionDiagnostics(entry),
    missingEnvVars: [],
    nextActions: createAgentOsExtensionNextActions(entry),
    metadata: {
      agentOsExtensionId: entry.id,
      agentOsHealth: entry.health,
      agentOsProviderAccounts: entry.providerAccounts,
      agentOsSecrets: entry.secrets,
      agentOsInstallPolicy: entry.installPolicy,
      agentOsSandboxPolicy: entry.sandbox,
    },
  };
}

function mapAgentOsExtensionHealthStatus(
  status: AgentOsExtensionHealthStatus,
): ExternalToolDoctorStatus {
  switch (status) {
    case "ready":
      return "ready";
    case "disabled":
      return "disabled";
    case "needs-auth":
      return "needs-auth";
    case "needs-setup":
      return "missing";
    case "problem":
      return "failed";
  }
}

function createAgentOsExtensionHealthSummary(entry: AgentOsExtensionMatrixEntry): string {
  switch (entry.health.status) {
    case "ready":
      return `${entry.displayName} extension is ready.`;
    case "disabled":
      return `${entry.displayName} extension is disabled.`;
    case "needs-auth":
      return `${entry.displayName} extension needs authentication.`;
    case "needs-setup":
      return `${entry.displayName} extension needs setup.`;
    case "problem":
      return `${entry.displayName} extension has a problem.`;
  }
}

function createAgentOsExtensionDiagnostics(entry: AgentOsExtensionMatrixEntry): readonly string[] {
  return [
    `extension:${entry.id}`,
    `health:${entry.health.status}`,
    `sandbox:${entry.sandbox.defaultMode}`,
    ...(entry.health.checkFn === undefined ? [] : [`check:${entry.health.checkFn}`]),
  ];
}

function createAgentOsExtensionNextActions(entry: AgentOsExtensionMatrixEntry): readonly string[] {
  switch (entry.health.status) {
    case "ready":
      return [];
    case "needs-auth":
      return ["配置 provider account 或 SecretRef 后重新检查。"];
    case "needs-setup":
      return entry.installPolicy.supported
        ? ["先执行安装/启动计划，再重新检查 extension health。"]
        : ["按 provider 文档完成本机配置后重新检查。"];
    case "problem":
      return ["查看 extension health/check_fn 诊断并修复 provider 配置。"];
    case "disabled":
      return ["启用 extension 后重新检查。"];
  }
}

function createExternalToolCapabilityFromAgentOsExtensionMatrixEntry(
  entry: AgentOsExtensionMatrixEntry,
  capabilityId: string,
  matrix: AgentOsExtensionMatrix,
): ExternalToolProviderCapability {
  const capability =
    entry.capabilities.find((candidate) => candidate.id === capabilityId) ??
    findAgentOsExtensionCapabilityById(matrix, capabilityId);
  const tools = entry.tools.filter((toolEntry) => toolEntry.capabilityId === capabilityId);
  return {
    id: capabilityId,
    label: capability?.label ?? capabilityId,
    readOnly: capability?.readOnly ?? true,
    ...(capability?.requiresApproval === undefined
      ? {}
      : { requiresApproval: capability.requiresApproval }),
    metadata: {
      agentOsExtensionId: entry.id,
      agentOsCapabilityRisk: capability?.risk ?? "low",
      agentOsTools: tools,
    },
  };
}

function findAgentOsExtensionCapabilityById(
  matrix: AgentOsExtensionMatrix,
  capabilityId: string,
): AgentOsExtensionCapability | undefined {
  for (const entry of matrix.entries) {
    const capability = entry.capabilities.find((candidate) => candidate.id === capabilityId);
    if (capability !== undefined) {
      return capability;
    }
  }
  return undefined;
}

function createCapability(
  id: string,
  label: string,
  options: {
    readonly readOnly: boolean;
    readonly requiresApproval?: boolean;
    readonly destructive?: boolean;
    readonly openWorld?: boolean;
    readonly description?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  },
): ExternalToolProviderCapability {
  return {
    id,
    label,
    ...(options.description === undefined ? {} : { description: options.description }),
    readOnly: options.readOnly,
    ...(options.requiresApproval === undefined
      ? {}
      : { requiresApproval: options.requiresApproval }),
    ...(options.destructive === undefined ? {} : { destructive: options.destructive }),
    ...(options.openWorld === undefined ? {} : { openWorld: options.openWorld }),
    ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
  };
}

async function invokeModelToolThroughExternalTool(input: {
  readonly request: ExternalToolHandlerInvokeRequest;
  readonly tool: ConversationRuntimeModelToolDefinition;
  readonly executor: ConversationRuntimeToolExecutorPort;
}): Promise<ExternalToolHandlerInvokeOutput> {
  const executionInput: ConversationRuntimeToolExecutionInput = {
    turnId: input.request.turnId ?? "external-tool-turn",
    sessionKey: input.request.sessionKey ?? "external-tool-session",
    call: {
      id: input.request.idempotencyKey ?? `${input.tool.name}:external-tool-call`,
      name: input.tool.name,
      args: input.request.args ?? {},
      readOnly: input.tool.readOnly,
      ...(input.tool.metadata === undefined ? {} : { metadata: input.tool.metadata }),
    },
    ...(input.request.metadata === undefined ? {} : { metadata: input.request.metadata }),
  };
  const result = await input.executor(executionInput);
  return convertModelToolExecutionOutput(result);
}

function convertModelToolExecutionOutput(
  output: ConversationRuntimeToolExecutionOutput,
): ExternalToolHandlerInvokeOutput {
  return {
    ok: output.ok,
    content: output.content,
    ...(output.output === undefined ? {} : { output: output.output }),
    ...(output.error === undefined ? {} : { error: output.error }),
    ...(output.metadata === undefined ? {} : { metadata: output.metadata }),
  };
}

function inferExternalToolProviderIdFromModelTool(
  tool: ConversationRuntimeModelToolDefinition,
): string | undefined {
  if (tool.name === "web_search" || tool.name === "web_extract") {
    return "web";
  }
  if (tool.name.startsWith("browser_")) {
    return "browser";
  }
  return undefined;
}

function normalizeExternalToolCapability(
  capability: ExternalToolProviderCapability,
): ExternalToolProviderCapability {
  return {
    ...capability,
    id: capability.id.trim(),
    label: capability.label.trim() || capability.id.trim(),
  };
}

function normalizeExternalToolSourceTrust(
  sourceTrust: ExternalToolSourceTrust,
): ExternalToolSourceTrust {
  return {
    ...sourceTrust,
    status: normalizeRequiredString(sourceTrust.status, "unknown"),
    ...optionalStringField("label", sourceTrust.label),
    ...optionalStringField("reason", sourceTrust.reason),
    ...optionalStringField("sourceRef", sourceTrust.sourceRef),
    ...optionalStringField("reviewedAt", sourceTrust.reviewedAt),
  };
}

function normalizeExternalToolInstallPolicy(
  installPolicy: ExternalToolInstallPolicy,
): ExternalToolInstallPolicy {
  return {
    ...installPolicy,
    ...optionalStringField("defaultMode", installPolicy.defaultMode, "none"),
    ...(installPolicy.allowedMethods === undefined
      ? {}
      : { allowedMethods: normalizeStringList(installPolicy.allowedMethods) }),
    ...(installPolicy.refuses === undefined
      ? {}
      : { refuses: normalizeStringList(installPolicy.refuses) }),
    ...optionalStringField("defaultInstallPath", installPolicy.defaultInstallPath),
  };
}

function normalizeExternalToolApprovalBoundary(
  approvalBoundary: ExternalToolApprovalBoundary,
): ExternalToolApprovalBoundary {
  return {
    ...approvalBoundary,
    mode: normalizeRequiredString(approvalBoundary.mode, "runtime-policy"),
    ...optionalStringField("summary", approvalBoundary.summary),
    ...(approvalBoundary.actionLabels === undefined
      ? {}
      : { actionLabels: normalizeStringList(approvalBoundary.actionLabels) }),
    ...optionalStringField("riskLevel", approvalBoundary.riskLevel),
  };
}

function normalizeRequiredString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalStringField<K extends string>(
  key: K,
  value: unknown,
  fallback?: string,
): Partial<Record<K, string>> {
  if (typeof value !== "string") {
    return {};
  }
  const normalized = value.trim() || fallback;
  return normalized === undefined || normalized.length === 0
    ? {}
    : ({ [key]: normalized } as Partial<Record<K, string>>);
}

function optionalArtifactRetentionField(value: unknown): {
  readonly retention?: ConversationRuntimeExternalArtifactRetention;
} {
  return typeof value === "string" && value.trim().length > 0
    ? { retention: value.trim() as ConversationRuntimeExternalArtifactRetention }
    : {};
}

function optionalArtifactSensitivityField(value: unknown): {
  readonly sensitivity?: ConversationRuntimeExternalArtifactSensitivity;
} {
  return typeof value === "string" && value.trim().length > 0
    ? { sensitivity: value.trim() as ConversationRuntimeExternalArtifactSensitivity }
    : {};
}

function optionalPositiveNumberField<K extends string>(
  key: K,
  value: unknown,
): { readonly [P in K]?: number } {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? ({ [key]: value } as { readonly [P in K]?: number })
    : {};
}

function createDefaultExternalProviderInstallPolicy(
  source: string | undefined,
): ExternalToolInstallPolicy {
  return {
    supported: false,
    defaultMode: source === "built-in" ? "none" : "manual",
    requiresApproval: source !== "built-in",
    requiresExplicitExecute: source !== "built-in",
    allowedMethods: [],
    refuses: source === "built-in" ? [] : ["silent-install"],
  };
}

function createUnsupportedInstallPolicyNextActions(input: {
  readonly source: string | undefined;
  readonly installPolicy: ExternalToolInstallPolicy;
}): readonly string[] {
  if (input.source === "built-in") {
    return ["内置工具由运行时提供，不需要安装。"];
  }
  if (input.installPolicy.defaultMode === "manual") {
    return ["按 provider 文档手动安装或先补可审查的 provider 专属安装 runner。"];
  }
  return ["先补 provider manifest、sourceTrust、installPolicy 和 approvalBoundary，再开放执行。"];
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

function createEffectiveExternalTool(input: {
  readonly manifest: ExternalToolManifest;
  readonly doctor: ExternalToolDoctorResult;
  readonly generation: number;
  readonly canInvoke: boolean;
  readonly lastKnownGood?: ExternalToolLastKnownGoodDoctorResult;
}): EffectiveExternalTool {
  return {
    ...input.manifest,
    status: input.doctor.status,
    canInvoke: input.canInvoke,
    doctor: input.doctor,
    generation: input.generation,
    ...(input.lastKnownGood === undefined ? {} : { lastKnownGood: input.lastKnownGood }),
    ...(input.canInvoke ? {} : { unavailableReason: input.doctor.summary }),
  };
}

function createLastKnownGoodDoctorResult(
  result: ExternalToolDoctorResult,
  generation: number,
): ExternalToolLastKnownGoodDoctorResult {
  return {
    status: "ready",
    summary: result.summary,
    checkedAtMs: result.checkedAtMs ?? Date.now(),
    generation,
    ...(result.nextActions === undefined ? {} : { nextActions: result.nextActions }),
    ...(result.details === undefined ? {} : { details: result.details }),
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
  };
}

function enrichDoctorResultWithLastKnownGood(
  result: ExternalToolDoctorResult,
  lastKnownGood: ExternalToolLastKnownGoodDoctorResult | undefined,
): ExternalToolDoctorResult {
  if (lastKnownGood === undefined || result.status === "ready") {
    return result;
  }
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      lastKnownGoodStatus: lastKnownGood.status,
      lastKnownGoodCheckedAtMs: lastKnownGood.checkedAtMs,
      lastKnownGoodGeneration: lastKnownGood.generation,
    },
  };
}

function normalizeDoctorResult(
  raw: ExternalToolDoctorResult | ExternalToolDoctorStatus | boolean,
  checkedAtMs: number,
  fallbackSummary?: string,
): ExternalToolDoctorResult {
  if (typeof raw === "boolean") {
    return {
      status: raw ? "ready" : "failed",
      summary: raw ? "External tool is ready." : "External tool check failed.",
      checkedAtMs,
    };
  }
  if (typeof raw === "string") {
    return {
      status: raw,
      summary: fallbackSummary ?? createDoctorSummaryFromStatus(raw),
      checkedAtMs,
    };
  }
  return {
    ...raw,
    checkedAtMs: raw.checkedAtMs ?? checkedAtMs,
  };
}

function createDefaultExternalToolDoctorResult(
  manifest: ExternalToolManifest,
  checkedAtMs: number,
): ExternalToolDoctorResult | "ready" {
  if (
    manifest.metadata?.agentOsExtensionId === undefined ||
    manifest.providerStatus === undefined
  ) {
    return "ready";
  }
  return {
    status: manifest.providerStatus.status,
    summary: manifest.providerStatus.summary,
    checkedAtMs,
    nextActions: manifest.providerStatus.nextActions,
    details: {
      diagnostics: manifest.providerStatus.diagnostics,
      activeSurface: manifest.providerStatus.activeSurface,
    },
    metadata: {
      ...(manifest.providerStatus.metadata ?? {}),
      agentOsExtensionId: manifest.metadata.agentOsExtensionId,
      agentOsExtensionHealthStatus: manifest.metadata.agentOsHealthStatus,
    },
  };
}

function createDoctorSummaryFromStatus(status: ExternalToolDoctorStatus): string {
  switch (status) {
    case "ready":
      return "External tool is ready.";
    case "disabled":
      return "External tool is disabled.";
    case "failed":
      return "External tool check failed.";
    case "misconfigured":
      return "External tool is misconfigured.";
    case "missing":
      return "External tool is not installed.";
    case "needs-auth":
      return "External tool needs authentication.";
    case "pending":
      return "External tool is pending.";
    case "unreachable":
      return "External tool is unreachable.";
  }
}

function resolveExternalToolCapability(
  manifest: ExternalToolManifest,
  operationId: string | undefined,
): ExternalToolProviderCapability | undefined {
  if (operationId === undefined) {
    return manifest.capabilities[0];
  }
  return manifest.capabilities.find((capability) => capability.id === operationId);
}

function createExternalToolApprovalRequest(
  manifest: ExternalToolManifest,
  capability: ExternalToolProviderCapability,
  request: ExternalToolInvokeRequest,
  agentOsPreview?: {
    readonly policyVerdict: AgentOsPolicyVerdict;
    readonly sandboxPreflight: AgentOsSandboxPreflight;
    readonly sandboxExecutionPlan?: AgentOsSandboxExecutionPlan;
  },
): ExternalToolApprovalRequest {
  const approvalId = [
    "external-tool",
    request.turnId ?? "turn",
    manifest.id,
    capability.id,
    request.idempotencyKey ?? "invoke",
  ].join(":");
  const actionLabels =
    manifest.approvalBoundary?.actionLabels !== undefined &&
    manifest.approvalBoundary.actionLabels.length >= 2
      ? manifest.approvalBoundary.actionLabels
      : (["确认", "拒绝"] as const);
  const baseSummary =
    manifest.approvalBoundary?.summary ??
    `${manifest.label} 将执行 ${capability.label}，需要确认后继续。`;
  const sandboxSummary =
    agentOsPreview?.sandboxExecutionPlan === undefined
      ? undefined
      : formatExternalToolApprovalSandboxSummary(agentOsPreview.sandboxExecutionPlan);
  return {
    id: approvalId,
    title: `确认使用 ${manifest.label}`,
    summary: sandboxSummary === undefined ? baseSummary : [baseSummary, sandboxSummary].join("\n"),
    actionLabels,
    metadata: {
      toolId: manifest.id,
      operationId: capability.id,
      source: manifest.source,
      kind: manifest.kind,
      providerId: manifest.providerId ?? "",
      ...(agentOsPreview === undefined
        ? {}
        : {
            agentOsPolicyVerdict: agentOsPreview.policyVerdict,
            agentOsSandboxPreflight: agentOsPreview.sandboxPreflight,
            ...(sandboxSummary === undefined
              ? {}
              : { agentOsSandboxApprovalSummary: sandboxSummary }),
            ...(agentOsPreview.sandboxExecutionPlan === undefined
              ? {}
              : { agentOsSandboxExecutionPlan: agentOsPreview.sandboxExecutionPlan }),
          }),
      ...(manifest.sourceTrust === undefined ? {} : { sourceTrust: manifest.sourceTrust }),
      ...(manifest.installPolicy === undefined ? {} : { installPolicy: manifest.installPolicy }),
      ...(manifest.approvalBoundary === undefined
        ? {}
        : { approvalBoundary: manifest.approvalBoundary }),
    },
  };
}

type ExternalToolPolicyGatedRequest =
  | {
      readonly status: "allowed";
      readonly policyEnvelope?: ConversationRuntimePolicyDecisionEnvelope;
    }
  | {
      readonly status: "blocked";
      readonly policyEnvelope: ConversationRuntimePolicyDecisionEnvelope;
      readonly result: ExternalToolInvokeResult;
    };

interface ExternalToolPolicyProfile {
  readonly manifest: ExternalToolManifest;
  readonly capability: ExternalToolProviderCapability;
  readonly riskLevel: ToolRiskLevel;
  readonly capabilities: readonly ToolCapability[];
}

function resolveExternalToolPolicyProfile(
  registry: ExternalToolRegistry,
  request: ExternalToolInvokeRequest,
): ExternalToolPolicyProfile | undefined {
  const entry = registry.getRegistration(request.toolId);
  if (entry === undefined) {
    return undefined;
  }
  const capability = resolveExternalToolCapability(entry.manifest, request.operationId);
  if (capability === undefined) {
    return undefined;
  }
  const capabilityIds = normalizeStringList([
    capability.id,
    readExternalToolCapabilityName(capability),
    `external_tool.${entry.manifest.kind}`,
    capability.openWorld === true ? "external_tool.open_world" : "",
    capability.readOnly === true ? "external_tool.read" : "external_tool.write",
  ]);
  return {
    manifest: entry.manifest,
    capability,
    riskLevel: resolveExternalToolRiskLevel(capability),
    capabilities: [...new Set(capabilityIds)],
  };
}

function createExternalToolPolicyResourceRef(
  request: ExternalToolInvokeRequest,
  capability: ExternalToolProviderCapability,
): string {
  return `external-tool://${request.toolId}/${capability.id}`;
}

function normalizeExternalToolPolicyApproval(
  approval: ExternalToolApprovalDecision | undefined,
): ToolApprovalContext | undefined {
  if (approval === undefined) {
    return undefined;
  }
  return {
    status: approval.status,
    ...(approval.operatorId === undefined ? {} : { approver: approval.operatorId }),
    ...(approval.reason === undefined ? {} : { note: approval.reason }),
    ...(approval.metadata === undefined ? {} : { metadata: { ...approval.metadata } }),
  };
}

function readExternalToolPolicyBudget(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ConversationRuntimePolicyBudget | undefined {
  if (metadata === undefined || !isRecord(metadata.budget)) {
    return undefined;
  }
  const budget = metadata.budget;
  return {
    ...optionalFiniteNumber("tokenLimit", budget.tokenLimit),
    ...optionalFiniteNumber("fileCountLimit", budget.fileCountLimit),
    ...optionalFiniteNumber("videoMinuteLimit", budget.videoMinuteLimit),
    ...optionalFiniteNumber("audioMinuteLimit", budget.audioMinuteLimit),
    ...(typeof budget.estimatedCostTier === "string"
      ? { estimatedCostTier: budget.estimatedCostTier }
      : {}),
    ...optionalFiniteNumber("estimatedCostUsd", budget.estimatedCostUsd),
  };
}

function readExternalToolPolicyStringList(
  metadata: Readonly<Record<string, unknown>> | undefined,
  key: string,
): readonly string[] {
  if (metadata === undefined) {
    return [];
  }
  const value = metadata[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return normalizeStringList(value.filter((item): item is string => typeof item === "string"));
}

function readExternalToolCapabilityName(capability: ExternalToolProviderCapability): string {
  const namedCapability = capability.metadata?.capability;
  return typeof namedCapability === "string" ? namedCapability : "";
}

function optionalFiniteNumber<K extends string>(
  key: K,
  value: unknown,
): { readonly [P in K]?: number } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {};
  }
  return { [key]: value } as { readonly [P in K]?: number };
}

function formatExternalToolApprovalSandboxSummary(plan: AgentOsSandboxExecutionPlan): string {
  const riskSummary = plan.riskSummary;
  if (riskSummary === undefined) {
    return plan.ok
      ? `沙箱风险摘要：后端=${formatAgentOsSandboxMode(plan.backend)}；后端准入=${formatPlannedSandboxBackendAdmission(plan.backend)}。`
      : `沙箱风险摘要：沙箱计划已拦截；原因=${formatSandboxPlanError(plan.error)}。`;
  }
  const commandSummary =
    riskSummary.command === undefined
      ? ""
      : `；命令=${truncateSandboxSummaryValue(riskSummary.command)}`;
  if (!plan.ok) {
    return [
      "沙箱风险摘要：沙箱计划已拦截",
      `后端=${formatAgentOsSandboxMode(riskSummary.sandboxMode)}`,
      `目录=${riskSummary.filesystem.cwd ?? "未指定"}`,
      `网络=${formatAgentOsSandboxNetworkPolicy(riskSummary.networkPolicy)}`,
      `原因=${formatSandboxPlanError(plan.error)}${commandSummary}`,
    ].join("；");
  }
  return [
    "沙箱风险摘要：",
    `后端=${formatAgentOsSandboxMode(plan.backend)}`,
    `目录=${plan.cwd ?? riskSummary.filesystem.cwd ?? "未指定"}`,
    `可读=${formatSandboxPathList(plan.readableRoots)}`,
    `可写=${formatSandboxPathList(plan.writableRoots)}`,
    `网络=${formatAgentOsSandboxNetworkPolicy(plan.networkPolicy)}`,
    `后端准入=${formatPlannedSandboxBackendAdmission(plan.backend)}${commandSummary}`,
  ].join("；");
}

function formatPlannedSandboxBackendAdmission(backend: string): string {
  switch (backend) {
    case "readonly":
      return "确认后要求本地只读后端接纳";
    case "workspace-write":
      return "确认后要求本地工作区写入后端接纳";
    case "network-limited":
      return "确认后要求本地受限网络后端接纳";
    case "docker":
    case "ssh":
    case "host":
      return "当前没有默认后端，确认后仍会被准入门禁拦截";
    default:
      return "确认后继续校验后端准入";
  }
}

function formatAgentOsSandboxMode(mode: string): string {
  switch (mode) {
    case "readonly":
      return "只读";
    case "workspace-write":
      return "工作区写入";
    case "network-limited":
      return "受限网络";
    case "docker":
      return "Docker";
    case "ssh":
      return "SSH";
    case "host":
      return "宿主机";
    case "disabled":
      return "禁用";
    default:
      return mode;
  }
}

function formatAgentOsSandboxNetworkPolicy(policy: AgentOsSandboxNetworkPolicy): string {
  switch (policy) {
    case "none":
      return "不联网";
    case "limited":
      return "受限联网";
    case "full":
      return "完全联网";
  }
}

function formatSandboxPlanError(error: string): string {
  switch (error) {
    case "sandbox-backend-disabled":
      return "后端未启用";
    case "sandbox-cwd-outside-scope":
      return "执行目录超出允许范围";
    case "sandbox-disabled":
      return "沙箱已禁用";
    case "sandbox-network-escalation":
      return "请求网络权限超过策略";
    case "sandbox-preflight-denied":
      return "沙箱预检未通过";
    default:
      return "沙箱计划未放行";
  }
}

function formatSandboxPathList(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "无";
  }
  const visible = paths.slice(0, 2).map(truncateSandboxSummaryValue);
  const suffix = paths.length > visible.length ? ` 等 ${paths.length} 项` : "";
  return `${visible.join(", ")}${suffix}`;
}

function truncateSandboxSummaryValue(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function createExternalToolAgentOsPolicyVerdict(input: {
  readonly request: ExternalToolInvokeRequest;
  readonly capability: ExternalToolProviderCapability;
  readonly requiresApproval: boolean;
}): AgentOsPolicyVerdict {
  const isApproved = input.requiresApproval && input.request.approval?.status === "approved";
  return {
    verdict: input.requiresApproval && !isApproved ? "needs_approval" : "allow",
    reason: isApproved
      ? "Operator approved the external tool invocation; sandbox preflight still gates execution."
      : "External tool invocation admitted by runtime policy.",
    decidedAt: new Date().toISOString(),
    policyId: "conversation-runtime.external-tool-permission",
    ...(isApproved
      ? {
          approvalId: [
            "external-tool",
            input.request.turnId ?? "turn",
            input.request.toolId,
            input.capability.id,
            input.request.idempotencyKey ?? "invoke",
          ].join(":"),
        }
      : {}),
  };
}

function resolveExternalToolSandboxPreflight(input: {
  readonly request: ExternalToolInvokeRequest;
  readonly manifest: ExternalToolManifest;
  readonly capability: ExternalToolProviderCapability;
}): AgentOsSandboxPreflight {
  if (input.request.sandboxPreflight !== undefined) {
    return normalizeExternalToolSandboxPreflight(input.request.sandboxPreflight);
  }
  const command = resolveExternalToolSandboxCommand(input.request);
  return createAgentOsExecutionPolicyPreflight({
    toolName: input.request.toolId,
    providerId: input.manifest.providerId ?? input.manifest.id,
    readOnly: input.capability.readOnly === true,
    capabilityIds: [input.capability.id],
    riskLevel: resolveExternalToolRiskLevel(input.capability),
    ...(command === undefined ? {} : { command }),
    ...(input.request.sandboxPolicy === undefined
      ? {}
      : { sandboxPolicy: input.request.sandboxPolicy }),
  });
}

function normalizeExternalToolSandboxPreflight(
  preflight: AgentOsSandboxPreflight,
): AgentOsSandboxPreflight {
  if (isAgentOsSandboxPreflight(preflight)) {
    return preflight;
  }
  return {
    verdict: "deny",
    sandboxMode: "disabled",
    checkedAt: new Date().toISOString(),
    providerId: "conversation-runtime",
    reason: "Agent OS sandbox preflight returned an invalid result",
  };
}

function resolveExternalToolSandboxExecutionPlan(input: {
  readonly request: ExternalToolInvokeRequest;
  readonly manifest: ExternalToolManifest;
  readonly capability: ExternalToolProviderCapability;
  readonly sandboxPreflight: AgentOsSandboxPreflight;
}): AgentOsSandboxExecutionPlan {
  const command = resolveExternalToolSandboxCommand(input.request);
  return planAgentOsSandboxExecution({
    toolName: input.request.toolId,
    operationId: input.capability.id,
    providerId: input.manifest.providerId ?? input.manifest.id,
    preflight: input.sandboxPreflight,
    ...(input.request.cwd === undefined ? {} : { cwd: input.request.cwd }),
    ...(command === undefined ? {} : { command }),
    ...(input.request.requestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: input.request.requestedNetworkPolicy }),
    policy: resolveExternalToolSandboxRuntimePolicy(input),
  });
}

function resolveExternalToolSandboxRuntimePolicy(input: {
  readonly request: ExternalToolInvokeRequest;
  readonly capability: ExternalToolProviderCapability;
  readonly sandboxPreflight: AgentOsSandboxPreflight;
}): AgentOsSandboxRuntimePolicy {
  if (input.request.sandboxRuntimePolicy !== undefined) {
    return input.request.sandboxRuntimePolicy;
  }
  if (input.request.sandboxPolicy !== undefined) {
    const filesystemScope = input.request.sandboxPolicy.filesystemScope ?? [];
    return {
      enabledBackends: [input.sandboxPreflight.sandboxMode],
      readableRoots: filesystemScope,
      writableRoots: input.capability.readOnly === true ? [] : filesystemScope,
      ...(input.request.sandboxPolicy.networkAccess === undefined
        ? {}
        : { networkPolicy: input.request.sandboxPolicy.networkAccess }),
    };
  }
  if (input.capability.readOnly === true) {
    return {
      enabledBackends: ["readonly"],
    };
  }
  return {};
}

function resolveExternalToolRiskLevel(capability: ExternalToolProviderCapability): ToolRiskLevel {
  const metadataRiskLevel = capability.metadata?.riskLevel;
  if (
    metadataRiskLevel === "low" ||
    metadataRiskLevel === "medium" ||
    metadataRiskLevel === "high" ||
    metadataRiskLevel === "critical"
  ) {
    return metadataRiskLevel;
  }
  if (capability.destructive === true) {
    return "critical";
  }
  if (capability.openWorld === true || capability.readOnly !== true) {
    return "high";
  }
  return "low";
}

function createExternalToolArgAdmissionDenial(
  request: ExternalToolInvokeRequest,
  capability: ExternalToolProviderCapability,
): Readonly<Record<string, unknown>> | undefined {
  const blockedPatterns = readExternalToolBlockedArgPatterns(capability.metadata);
  if (blockedPatterns.length === 0) {
    return undefined;
  }
  const stringArgs = flattenExternalToolStringArgs(request.args ?? {});
  for (const arg of stringArgs) {
    for (const pattern of blockedPatterns) {
      const regex = createSafeRegExp(pattern);
      if (regex?.test(arg.value) === true) {
        return {
          path: arg.path,
          pattern,
          valuePreview: arg.value.slice(0, 120),
        };
      }
    }
  }
  return undefined;
}

function readExternalToolBlockedArgPatterns(
  metadata: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  if (!isRecord(metadata?.argAdmission)) {
    return [];
  }
  const value = metadata.argAdmission.blockedStringPatterns;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function flattenExternalToolStringArgs(
  value: unknown,
  path = "",
): readonly { readonly path: string; readonly value: string }[] {
  if (typeof value === "string") {
    return [{ path, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenExternalToolStringArgs(item, path.length === 0 ? String(index) : `${path}.${index}`),
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) =>
      flattenExternalToolStringArgs(item, path.length === 0 ? key : `${path}.${key}`),
    );
  }
  return [];
}

function createSafeRegExp(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "u");
  } catch {
    return undefined;
  }
}

function resolveExternalToolSandboxCommand(request: ExternalToolInvokeRequest): string | undefined {
  if (request.command !== undefined) {
    return request.command;
  }
  const argsCommand = request.args?.command;
  return typeof argsCommand === "string" ? argsCommand : undefined;
}

function createExternalToolInvokeSuccessMetadata(input: {
  readonly requestMetadata?: Readonly<Record<string, unknown>>;
  readonly outputMetadata?: Readonly<Record<string, unknown>>;
  readonly sandboxBackendAdmission: AgentOsSandboxBackendAdmission;
  readonly artifactPersistence?: ExternalToolArtifactPersistenceMetadata;
}): Readonly<Record<string, unknown>> {
  return {
    ...(input.requestMetadata ?? {}),
    ...(input.outputMetadata ?? {}),
    ...(input.artifactPersistence === undefined
      ? {}
      : { artifactPersistence: input.artifactPersistence }),
    agentOsSandboxBackendAdmission: input.sandboxBackendAdmission,
  };
}

function createExternalToolSandboxCommandExecutionMetadata(input: {
  readonly policyVerdict: AgentOsPolicyVerdict;
  readonly sandboxPreflight: AgentOsSandboxPreflight;
  readonly sandboxExecutionPlan: AgentOsSandboxExecutionPlan;
  readonly sandboxBackendAdmission: AgentOsSandboxBackendAdmission;
  readonly sandboxCommandExecution: AgentOsSandboxCommandExecutionResult;
  readonly artifactPersistence?: ExternalToolArtifactPersistenceMetadata;
}): Readonly<Record<string, unknown>> {
  return {
    agentOsPolicyVerdict: input.policyVerdict,
    agentOsSandboxPreflight: input.sandboxPreflight,
    agentOsSandboxExecutionPlan: input.sandboxExecutionPlan,
    agentOsSandboxBackendAdmission: input.sandboxBackendAdmission,
    agentOsSandboxCommandExecution: input.sandboxCommandExecution,
    ...(input.artifactPersistence === undefined
      ? {}
      : { artifactPersistence: input.artifactPersistence }),
  };
}

function createInvokeResult(input: {
  readonly ok: boolean;
  readonly status: ExternalToolInvokeStatus;
  readonly toolId: string;
  readonly operationId?: string | undefined;
  readonly content: string;
  readonly output?: unknown;
  readonly error?: string;
  readonly artifacts?: readonly ExternalToolArtifact[];
  readonly approval?: ExternalToolApprovalRequest;
  readonly trace: readonly ExternalToolTraceEntry[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ExternalToolInvokeResult {
  return {
    ok: input.ok,
    status: input.status,
    toolId: input.toolId,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    content: input.content,
    ...(input.output === undefined ? {} : { output: input.output }),
    ...(input.error === undefined ? {} : { error: input.error }),
    ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    trace: input.trace,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function formatExternalToolsCatalogEntry(
  tool: ExternalToolCatalogEntry,
): ExternalToolsCatalogEntry {
  return {
    id: tool.id,
    label: tool.label,
    description: tool.description,
    source: tool.source,
    kind: tool.kind,
    ...(tool.providerId === undefined ? {} : { providerId: tool.providerId }),
    ...(tool.toolName === undefined ? {} : { toolName: tool.toolName }),
    enabled: tool.enabled !== false,
    capabilityCount: tool.capabilities.length,
    capabilities: tool.capabilities.map(formatExternalToolsCapabilityEntry),
    ...(tool.sourceTrust === undefined ? {} : { sourceTrust: tool.sourceTrust }),
    ...(tool.installPolicy === undefined ? {} : { installPolicy: tool.installPolicy }),
    ...(tool.approvalBoundary === undefined ? {} : { approvalBoundary: tool.approvalBoundary }),
    ...(tool.auth === undefined ? {} : { auth: tool.auth }),
    ...(tool.contracts === undefined ? {} : { contracts: tool.contracts }),
    ...(tool.providerStatus === undefined ? {} : { providerStatus: tool.providerStatus }),
    ...(tool.metadata === undefined ? {} : { metadata: tool.metadata }),
  };
}

function formatExternalToolsEffectiveEntry(
  tool: EffectiveExternalTool,
): ExternalToolsEffectiveEntry {
  return {
    ...formatExternalToolsCatalogEntry(tool),
    status: tool.status,
    canInvoke: tool.canInvoke,
    doctor: tool.doctor,
    generation: tool.generation,
    ...(tool.lastKnownGood === undefined ? {} : { lastKnownGood: tool.lastKnownGood }),
    ...(tool.unavailableReason === undefined ? {} : { unavailableReason: tool.unavailableReason }),
  };
}

function formatExternalToolsCapabilityEntry(
  capability: ExternalToolProviderCapability,
): ExternalToolsCapabilityEntry {
  return {
    id: capability.id,
    label: capability.label,
    ...(capability.description === undefined ? {} : { description: capability.description }),
    readOnly: capability.readOnly,
    requiresApproval: capability.requiresApproval === true,
    destructive: capability.destructive === true,
    openWorld: capability.openWorld === true,
    ...(capability.metadata === undefined ? {} : { metadata: capability.metadata }),
  };
}

function createAgentOsExtensionMatrixFromExternalTools(
  tools: readonly ExternalToolsCatalogEntry[],
): AgentOsExternalToolExtensionMatrix | undefined {
  const entries = tools
    .map(readAgentOsExternalToolExtensionMatrixEntry)
    .filter((entry): entry is AgentOsExternalToolExtensionMatrixEntry => entry !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (entries.length === 0) {
    return undefined;
  }
  return {
    summary: {
      total: entries.length,
      ready: countAgentOsExtensionMatrixStatus(entries, "ready"),
      needsAuth: countAgentOsExtensionMatrixStatus(entries, "needs-auth"),
      needsSetup: countAgentOsExtensionMatrixStatus(entries, "needs-setup"),
      disabled: countAgentOsExtensionMatrixStatus(entries, "disabled"),
      problem: countAgentOsExtensionMatrixStatus(entries, "problem"),
    },
    entries,
    byCapability: groupAgentOsExtensionMatrixEntriesByCapability(entries),
  };
}

function readAgentOsExternalToolExtensionMatrixEntry(
  tool: ExternalToolsCatalogEntry,
): AgentOsExternalToolExtensionMatrixEntry | undefined {
  const entry = tool.metadata?.agentOsExtensionMatrixEntry;
  if (!isAgentOsExternalToolExtensionMatrixEntry(entry)) {
    return undefined;
  }
  return {
    ...entry,
    toolId: tool.id,
  };
}

function isAgentOsExternalToolExtensionMatrixEntry(
  value: unknown,
): value is AgentOsExternalToolExtensionMatrixEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.displayName === "string" &&
    Array.isArray(value.capabilityIds) &&
    isRecord(value.health) &&
    isRecord(value.sandbox) &&
    isRecord(value.sourceTrust) &&
    Array.isArray(value.uiSurfaces)
  );
}

function countAgentOsExtensionMatrixStatus(
  entries: readonly AgentOsExternalToolExtensionMatrixEntry[],
  status: AgentOsExtensionHealthStatus,
): number {
  return entries.filter((entry) => entry.health.status === status).length;
}

function groupAgentOsExtensionMatrixEntriesByCapability(
  entries: readonly AgentOsExternalToolExtensionMatrixEntry[],
): Readonly<Record<string, readonly AgentOsExternalToolExtensionMatrixEntry[]>> {
  const grouped: Record<string, AgentOsExternalToolExtensionMatrixEntry[]> = {};
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

function formatAgentOsExternalToolExtensionMatrixEntry(
  entry: AgentOsExtensionMatrixEntry,
): AgentOsExternalToolExtensionMatrixEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    displayName: entry.displayName,
    ...(entry.providerId === undefined ? {} : { providerId: entry.providerId }),
    capabilityIds: entry.capabilityIds,
    health: entry.health,
    sandbox: entry.sandbox,
    sourceTrust: entry.sourceTrust,
    uiSurfaces: entry.uiSurfaces,
    ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
  };
}

function formatExternalToolsInvokeRpcResult(
  result: ExternalToolInvokeResult,
): ExternalToolsInvokeRpcResult {
  const requiresApproval = result.status === "approval-required";
  const source = readInvokeTraceSource(result.trace);
  return {
    schemaVersion: "director.external-tools.invoke.v1",
    ok: result.ok,
    toolName: result.toolId,
    toolId: result.toolId,
    ...(result.operationId === undefined ? {} : { operationId: result.operationId }),
    status: result.status,
    ...(result.output === undefined ? {} : { output: result.output }),
    content: result.content,
    ...(requiresApproval ? { requiresApproval: true } : {}),
    ...(result.approval?.id === undefined ? {} : { approvalId: result.approval.id }),
    ...(result.approval === undefined ? {} : { approval: result.approval }),
    ...(source === undefined ? {} : { source }),
    ...(result.error === undefined
      ? {}
      : {
          error: {
            code: mapExternalToolInvokeErrorCode(result.status),
            message: result.content,
            details: {
              rawError: result.error,
              ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
            },
          },
        }),
    trace: result.trace,
    ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
  };
}

function groupExternalToolsCatalogEntries(
  tools: readonly ExternalToolsCatalogEntry[],
): readonly ExternalToolsCatalogGroup[] {
  const groups = new Map<string, ExternalToolsCatalogEntry[]>();
  for (const tool of tools) {
    const key = createExternalToolsGroupId(tool);
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  return [...groups.entries()]
    .map(([id, entries]) => ({
      id,
      label: createExternalToolsGroupLabel(entries[0]),
      source: entries[0]?.source ?? "unknown",
      ...(entries[0]?.providerId === undefined ? {} : { providerId: entries[0].providerId }),
      tools: entries,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createExternalToolsProviderCapabilityMatrix(
  tools: readonly ExternalToolsEffectiveEntry[],
): ExternalToolsProviderCapabilityMatrix {
  const groups = new Map<string, ExternalToolsEffectiveEntry[]>();
  for (const tool of tools) {
    const providerId = createExternalToolsGroupId(tool);
    groups.set(providerId, [...(groups.get(providerId) ?? []), tool]);
  }
  const providers = [...groups.entries()]
    .map(([providerId, entries]) =>
      createExternalToolsProviderCapabilityMatrixEntry(providerId, entries),
    )
    .sort((left, right) => left.providerId.localeCompare(right.providerId));
  return {
    schemaVersion: "director.external-tools.provider-matrix.v1",
    providerCount: providers.length,
    readyProviderCount: providers.filter((provider) => provider.status === "ready").length,
    providers,
  };
}

function createExternalToolsProviderCapabilityMatrixEntry(
  providerId: string,
  entries: readonly ExternalToolsEffectiveEntry[],
): ExternalToolsProviderCapabilityMatrixEntry {
  const health = createExternalToolsProviderHealth(providerId, entries);
  const healthSummary = createExternalToolsProviderHealthSummary(entries);
  const budgetSources = createExternalToolsProviderBudgetSources(entries);
  const budget = mergeExternalToolsProviderBudgets(budgetSources);
  const approvalBoundary = selectExternalToolsProviderApprovalBoundary(entries);
  const lastKnownGood = selectExternalToolsProviderLastKnownGood(entries);
  return {
    providerId,
    label: createExternalToolsGroupLabel(entries[0]),
    source: entries[0]?.source ?? "unknown",
    status: health.status,
    health,
    healthSummary,
    toolIds: entries.map((tool) => tool.id),
    toolCount: entries.length,
    invokableToolCount: entries.filter((tool) => tool.canInvoke).length,
    capabilities: dedupeExternalToolsCapabilities(entries.flatMap((tool) => tool.capabilities)),
    ...(budget === undefined ? {} : { budget }),
    ...(budgetSources.length === 0 ? {} : { budgetSources }),
    ...(approvalBoundary === undefined ? {} : { approvalBoundary }),
    ...(lastKnownGood === undefined ? {} : { lastKnownGood }),
  };
}

function createExternalToolsProviderHealth(
  providerId: string,
  entries: readonly ExternalToolsEffectiveEntry[],
): ExternalToolDoctorResult {
  const nonReady = entries.find((tool) => tool.status !== "ready");
  const primary = nonReady ?? entries[0];
  const checkedAtMs = Math.max(...entries.map((tool) => tool.doctor.checkedAtMs ?? 0), 0);
  return {
    status: primary?.status ?? "missing",
    summary: primary?.doctor.summary ?? `${providerId} provider has no registered tools.`,
    ...(checkedAtMs <= 0 ? {} : { checkedAtMs }),
    nextActions: uniqueExternalToolsStrings(
      entries.flatMap((tool) => tool.doctor.nextActions ?? []),
    ),
    details: {
      providerId,
      toolIds: entries.map((tool) => tool.id),
      readyToolIds: entries.filter((tool) => tool.canInvoke).map((tool) => tool.id),
      unavailableToolIds: entries.filter((tool) => !tool.canInvoke).map((tool) => tool.id),
    },
  };
}

function createExternalToolsProviderHealthSummary(
  entries: readonly ExternalToolsEffectiveEntry[],
): ExternalToolsProviderHealthSummary {
  const statusCounts = new Map<string, number>();
  for (const entry of entries) {
    statusCounts.set(entry.status, (statusCounts.get(entry.status) ?? 0) + 1);
  }
  return {
    readyToolCount: entries.filter((tool) => tool.canInvoke).length,
    unavailableToolCount: entries.filter((tool) => !tool.canInvoke).length,
    statusCounts: Object.fromEntries([...statusCounts.entries()].sort()),
  };
}

function createExternalToolsProviderBudgetSources(
  entries: readonly ExternalToolsEffectiveEntry[],
): readonly ExternalToolsProviderBudgetSource[] {
  return entries
    .map((entry) => {
      const budget = readExternalToolPolicyBudget(entry.metadata);
      return budget === undefined
        ? undefined
        : {
            toolId: entry.id,
            budget,
          };
    })
    .filter((entry): entry is ExternalToolsProviderBudgetSource => entry !== undefined);
}

function mergeExternalToolsProviderBudgets(
  sources: readonly ExternalToolsProviderBudgetSource[],
): ConversationRuntimePolicyBudget | undefined {
  if (sources.length === 0) {
    return undefined;
  }
  const budgets = sources.map((source) => source.budget);
  const merged: ConversationRuntimePolicyBudget = {
    ...minProviderBudgetNumber("tokenLimit", budgets),
    ...minProviderBudgetNumber("fileCountLimit", budgets),
    ...minProviderBudgetNumber("videoMinuteLimit", budgets),
    ...minProviderBudgetNumber("audioMinuteLimit", budgets),
    ...maxProviderBudgetTier(budgets),
    ...maxProviderBudgetNumber("estimatedCostUsd", budgets),
  };
  return Object.keys(merged).length === 0 ? undefined : merged;
}

type NumericProviderBudgetKey =
  | "tokenLimit"
  | "fileCountLimit"
  | "videoMinuteLimit"
  | "audioMinuteLimit"
  | "estimatedCostUsd";

function minProviderBudgetNumber<K extends NumericProviderBudgetKey>(
  key: K,
  budgets: readonly ConversationRuntimePolicyBudget[],
): Pick<ConversationRuntimePolicyBudget, K> | Record<string, never> {
  const values = budgets
    .map((budget) => budget[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return {};
  }
  return { [key]: Math.min(...values) } as Pick<ConversationRuntimePolicyBudget, K>;
}

function maxProviderBudgetNumber<K extends NumericProviderBudgetKey>(
  key: K,
  budgets: readonly ConversationRuntimePolicyBudget[],
): Pick<ConversationRuntimePolicyBudget, K> | Record<string, never> {
  const values = budgets
    .map((budget) => budget[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) {
    return {};
  }
  return { [key]: Math.max(...values) } as Pick<ConversationRuntimePolicyBudget, K>;
}

function maxProviderBudgetTier(
  budgets: readonly ConversationRuntimePolicyBudget[],
): Pick<ConversationRuntimePolicyBudget, "estimatedCostTier"> | Record<string, never> {
  const tiers = budgets
    .map((budget) => budget.estimatedCostTier)
    .filter((tier): tier is string => typeof tier === "string" && tier.trim().length > 0);
  if (tiers.length === 0) {
    return {};
  }
  const selected = tiers.sort(compareProviderBudgetTiers).at(-1);
  return selected === undefined ? {} : { estimatedCostTier: selected };
}

function compareProviderBudgetTiers(left: string, right: string): number {
  return providerBudgetTierRank(left) - providerBudgetTierRank(right) || left.localeCompare(right);
}

function providerBudgetTierRank(value: string): number {
  switch (value.trim().toLowerCase()) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
    default:
      return 0;
  }
}

function selectExternalToolsProviderApprovalBoundary(
  entries: readonly ExternalToolsEffectiveEntry[],
): ExternalToolApprovalBoundary | undefined {
  return entries.find((tool) => tool.approvalBoundary !== undefined)?.approvalBoundary;
}

function selectExternalToolsProviderLastKnownGood(
  entries: readonly ExternalToolsEffectiveEntry[],
): ExternalToolLastKnownGoodDoctorResult | undefined {
  return entries
    .map((tool) => tool.lastKnownGood)
    .filter((item): item is ExternalToolLastKnownGoodDoctorResult => item !== undefined)
    .sort(
      (left, right) => right.checkedAtMs - left.checkedAtMs || right.generation - left.generation,
    )[0];
}

function dedupeExternalToolsCapabilities(
  capabilities: readonly ExternalToolsCapabilityEntry[],
): readonly ExternalToolsCapabilityEntry[] {
  return [...new Map(capabilities.map((capability) => [capability.id, capability])).values()].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
}

function uniqueExternalToolsStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function groupExternalToolsEffectiveEntries(
  tools: readonly ExternalToolsEffectiveEntry[],
): readonly ExternalToolsEffectiveGroup[] {
  const groups = new Map<string, ExternalToolsEffectiveEntry[]>();
  for (const tool of tools) {
    const key = createExternalToolsGroupId(tool);
    groups.set(key, [...(groups.get(key) ?? []), tool]);
  }
  return [...groups.entries()]
    .map(([id, entries]) => ({
      id,
      label: createExternalToolsGroupLabel(entries[0]),
      source: entries[0]?.source ?? "unknown",
      ...(entries[0]?.providerId === undefined ? {} : { providerId: entries[0].providerId }),
      tools: entries,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function createExternalToolsGroupId(
  tool: Pick<ExternalToolsCatalogEntry, "providerId" | "source">,
): string {
  return tool.providerId ?? String(tool.source);
}

function createExternalToolsGroupLabel(
  tool: Pick<ExternalToolsCatalogEntry, "providerId" | "source"> | undefined,
): string {
  return tool?.providerId ?? String(tool?.source ?? "unknown");
}

function normalizeExternalToolsAgentId(agentId: string | undefined): string {
  return typeof agentId === "string" && agentId.trim().length > 0 ? agentId.trim() : "director";
}

function readInvokeTraceSource(
  trace: readonly ExternalToolTraceEntry[],
): ExternalToolSource | undefined {
  for (const entry of trace) {
    const source = entry.metadata?.source;
    if (typeof source === "string" && source.length > 0) {
      return source;
    }
  }
  return undefined;
}

function mapExternalToolInvokeErrorCode(status: ExternalToolInvokeStatus): string {
  switch (status) {
    case "approval-required":
      return "requires_approval";
    case "not-found":
      return "not_found";
    case "permission-denied":
      return "permission_denied";
    case "unavailable":
      return "unavailable";
    case "dry-run":
    case "success":
      return "none";
    case "error":
      return "tool_error";
  }
}

function createExternalToolTraceWriter(): {
  readonly items: readonly ExternalToolTraceEntry[];
  readonly push: (
    stage: string,
    detail: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
} {
  const items: ExternalToolTraceEntry[] = [];
  return {
    items,
    push: (stage, detail, metadata) => {
      items.push({
        stage,
        detail,
        occurredAtMs: Date.now(),
        ...(metadata === undefined ? {} : { metadata }),
      });
    },
  };
}

function createExternalSystemControlEnvelope(
  input: CreateExternalSystemControlRequestInput,
): ExternalSystemControlEnvelope {
  const systemId = normalizeRequiredString(input.systemId, "external-system");
  const objective = normalizeRequiredString(input.objective, "external system control request");
  const toolId = normalizeRequiredString(input.toolId, systemId);
  return {
    schemaVersion: "director.external-system-control.v1",
    systemId,
    objective,
    toolId,
    ...optionalStringField("operationId", input.operationId),
    ...optionalStringField("sessionKey", input.sessionKey),
    ...optionalStringField("turnId", input.turnId),
    ...(input.angelRoleProfile === undefined ? {} : { angelRoleProfile: input.angelRoleProfile }),
    ...(input.userFacingProjection === undefined
      ? {}
      : {
          userFacingProjection: normalizeExternalSystemUserFacingProjection(
            input.userFacingProjection,
          ),
        }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  };
}

function normalizeExternalSystemUserFacingProjection(
  projection: ExternalSystemControlUserFacingProjection,
): ExternalSystemControlUserFacingProjection {
  return {
    userText: normalizeRequiredString(projection.userText, ""),
    ...optionalStringField("briefStatus", projection.briefStatus),
    ...(projection.canRetry === undefined ? {} : { canRetry: projection.canRetry }),
    ...optionalStringField("suggestedNextStep", projection.suggestedNextStep),
    ...(projection.attachments === undefined ? {} : { attachments: projection.attachments }),
    ...optionalStringField("developerTraceRef", projection.developerTraceRef),
    ...(projection.metadata === undefined ? {} : { metadata: projection.metadata }),
  };
}

function isExternalToolInvokeRequest(value: unknown): value is ExternalToolInvokeRequest {
  return isRecord(value) && typeof value.toolId === "string" && !("systemId" in value);
}

interface MutableExternalToolExecution {
  readonly id: string;
  readonly toolId: string;
  readonly turnId?: string;
  readonly operationId?: string;
  readonly request: ExternalToolInvokeRequest;
  status: ExternalToolExecutionStatus;
  readonly queuedAtMs: number;
  startedAtMs?: number;
  completedAtMs?: number;
  readonly timeline: ExternalToolExecutionTimelineEntry[];
  result?: ExternalToolInvokeResult;
  error?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

function cloneExternalToolExecution(
  item: MutableExternalToolExecution,
): ExternalToolExecutionSnapshot {
  return {
    id: item.id,
    toolId: item.toolId,
    ...(item.operationId === undefined ? {} : { operationId: item.operationId }),
    status: item.status,
    queuedAtMs: item.queuedAtMs,
    ...(item.startedAtMs === undefined ? {} : { startedAtMs: item.startedAtMs }),
    ...(item.completedAtMs === undefined ? {} : { completedAtMs: item.completedAtMs }),
    timeline: item.timeline.map((entry) => ({ ...entry })),
    ...(item.result === undefined ? {} : { result: item.result }),
    ...(item.error === undefined ? {} : { error: item.error }),
    ...(item.metadata === undefined && item.turnId === undefined
      ? {}
      : {
          metadata: {
            ...(item.metadata ?? {}),
            ...(item.turnId === undefined ? {} : { turnId: item.turnId }),
          },
        }),
  };
}

function compareExternalToolById(
  left: ExternalToolCatalogEntry,
  right: ExternalToolCatalogEntry,
): number {
  return left.id.localeCompare(right.id);
}

function readMetadataString(
  metadata: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readExternalToolMapValue<T>(
  source: ReadonlyMap<string, T> | Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  if (source === undefined) {
    return undefined;
  }
  if (isExternalToolReadonlyMap(source)) {
    return source.get(key);
  }
  return source[key];
}

function isExternalToolReadonlyMap<T>(
  source: ReadonlyMap<string, T> | Readonly<Record<string, T>>,
): source is ReadonlyMap<string, T> {
  return typeof (source as { get?: unknown }).get === "function";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
