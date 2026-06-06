import { createHash } from "node:crypto";
import { posix as pathPosix } from "node:path";

import type {
  AgentOsSandboxMode,
  AgentOsSandboxPreflight,
} from "@hotflow/agent-os-kernel-contracts";

export type AgentOsSandboxNetworkPolicy = "none" | "limited" | "full";
export type AgentOsSandboxPlanStatus = "blocked" | "ready";
export type AgentOsSandboxAdmissionStatus = "admitted" | "blocked";
export type AgentOsSandboxCommandExecutionStatus = "blocked" | "completed" | "failed";

export interface AgentOsSandboxRuntimePolicy {
  readonly enabledBackends?: readonly AgentOsSandboxMode[];
  readonly readableRoots?: readonly string[];
  readonly writableRoots?: readonly string[];
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
}

export interface AgentOsSandboxExecutionPlanInput {
  readonly toolName: string;
  readonly operationId?: string;
  readonly providerId?: string;
  readonly cwd?: string;
  readonly command?: string;
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly requestedNetworkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly preflight: AgentOsSandboxPreflight;
  readonly policy?: AgentOsSandboxRuntimePolicy;
}

export interface AgentOsSandboxRiskSummary {
  readonly toolName: string;
  readonly operationId?: string;
  readonly providerId?: string;
  readonly sandboxMode: AgentOsSandboxMode;
  readonly filesystem: {
    readonly cwd?: string;
    readonly readableRoots: readonly string[];
    readonly writableRoots: readonly string[];
  };
  readonly networkPolicy: AgentOsSandboxNetworkPolicy;
  readonly command?: string;
  readonly reason?: string;
}

export interface AgentOsSandboxReadyExecutionPlan {
  readonly ok: true;
  readonly status: "ready";
  readonly backend: AgentOsSandboxMode;
  readonly cwd?: string;
  readonly command?: string;
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly readableRoots: readonly string[];
  readonly writableRoots: readonly string[];
  readonly networkPolicy: AgentOsSandboxNetworkPolicy;
  readonly riskSummary: AgentOsSandboxRiskSummary;
}

export interface AgentOsSandboxBlockedExecutionPlan {
  readonly ok: false;
  readonly status: "blocked";
  readonly error:
    | "sandbox-backend-disabled"
    | "sandbox-cwd-outside-scope"
    | "sandbox-disabled"
    | "sandbox-network-escalation"
    | "sandbox-preflight-denied";
  readonly reason: string;
  readonly riskSummary?: AgentOsSandboxRiskSummary;
}

export type AgentOsSandboxExecutionPlan =
  | AgentOsSandboxBlockedExecutionPlan
  | AgentOsSandboxReadyExecutionPlan;

export interface AgentOsSandboxBackendAdmissionEnforcement {
  readonly filesystem:
    | "container-bind-mounts"
    | "host-explicit"
    | "none"
    | "process-cwd-scope"
    | "remote-workdir-scope";
  readonly network:
    | "network-full"
    | "network-limited"
    | "network-none"
    | "none"
    | "policy-declared"
    | "ssh-target-policy";
  readonly process: "container" | "host-process" | "in-process-adapter" | "remote-session";
}

export interface AgentOsSandboxBackendAdmission {
  readonly ok: boolean;
  readonly status: AgentOsSandboxAdmissionStatus;
  readonly backend?: AgentOsSandboxMode;
  readonly providerId?: string;
  readonly admittedAt?: string;
  readonly cwd?: string;
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly filesystem?: {
    readonly readableRoots: readonly string[];
    readonly writableRoots: readonly string[];
  };
  readonly enforcement?: AgentOsSandboxBackendAdmissionEnforcement;
  readonly backendConfig?: Readonly<Record<string, unknown>>;
  readonly planHash?: string;
  readonly error?:
    | "sandbox-backend-adapter-denied"
    | "sandbox-backend-adapter-unavailable"
    | "sandbox-plan-not-ready";
  readonly reason?: string;
}

export interface AgentOsSandboxBackendAdapter {
  readonly id: string;
  readonly mode: AgentOsSandboxMode;
  readonly admit: (
    plan: AgentOsSandboxReadyExecutionPlan,
    context: AgentOsSandboxAdmissionContext,
  ) => AgentOsSandboxBackendAdmission | Promise<AgentOsSandboxBackendAdmission>;
  readonly execute?: (
    plan: AgentOsSandboxReadyExecutionPlan,
    admission: AgentOsSandboxBackendAdmission,
    context: AgentOsSandboxExecutionContext,
  ) => AgentOsSandboxCommandExecutionResult | Promise<AgentOsSandboxCommandExecutionResult>;
}

export interface AgentOsSandboxBackendRegistry {
  readonly get: (mode: AgentOsSandboxMode) => AgentOsSandboxBackendAdapter | undefined;
  readonly list: () => readonly AgentOsSandboxBackendAdapter[];
}

export interface AgentOsSandboxBackendRegistryOptions {
  readonly enabledBackends?: readonly AgentOsSandboxMode[];
  readonly adapters?: readonly AgentOsSandboxBackendAdapter[];
}

export interface AgentOsSandboxAdmissionContext {
  readonly now: () => string;
}

export interface AgentOsSandboxAdmissionOptions {
  readonly registry?: AgentOsSandboxBackendRegistry;
  readonly now?: () => string;
}

export interface AgentOsSandboxExecutionContext {
  readonly now: () => string;
}

export interface AgentOsSandboxCommandRunRequest {
  readonly backend: AgentOsSandboxMode;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentOsSandboxCommandRunResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
  readonly artifacts?: readonly AgentOsSandboxCommandArtifact[];
}

export interface AgentOsSandboxCommandArtifact {
  readonly id: string;
  readonly kind: string;
  readonly path?: string;
  readonly url?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type AgentOsSandboxCommandRunner = (
  request: AgentOsSandboxCommandRunRequest,
) => AgentOsSandboxCommandRunResult | Promise<AgentOsSandboxCommandRunResult>;

export interface AgentOsSandboxCommandExecutionEvidence {
  readonly backend: AgentOsSandboxMode;
  readonly providerId: string;
  readonly planHash: string;
  readonly commandHash?: string;
  readonly cwd?: string;
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly filesystem?: {
    readonly readableRoots: readonly string[];
    readonly writableRoots: readonly string[];
  };
  readonly enforcement?: AgentOsSandboxBackendAdmissionEnforcement;
  readonly backendConfig?: Readonly<Record<string, unknown>>;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly exitCode?: number;
  readonly stdoutSummary?: string;
  readonly stderrSummary?: string;
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
  readonly artifacts?: readonly AgentOsSandboxCommandArtifact[];
}

export interface AgentOsSandboxCommandExecutionResult {
  readonly ok: boolean;
  readonly status: AgentOsSandboxCommandExecutionStatus;
  readonly backend?: AgentOsSandboxMode;
  readonly providerId?: string;
  readonly admission?: AgentOsSandboxBackendAdmission;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
  readonly artifacts?: readonly AgentOsSandboxCommandArtifact[];
  readonly evidence?: AgentOsSandboxCommandExecutionEvidence;
  readonly error?:
    | "sandbox-backend-admission-denied"
    | "sandbox-backend-execution-failed"
    | "sandbox-backend-executor-unavailable"
    | "sandbox-backend-executor-threw"
    | "sandbox-command-invalid"
    | "sandbox-plan-not-ready";
  readonly reason?: string;
}

export interface AgentOsSandboxCommandExecutionOptions {
  readonly registry?: AgentOsSandboxBackendRegistry;
  readonly now?: () => string;
}

export interface AgentOsDockerSandboxBackendAdapterOptions {
  readonly image?: string;
  readonly allowedCommandPatterns?: readonly AgentOsSandboxAllowedCommandPattern[];
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly readonlyRootfs?: boolean;
  readonly commandRunner?: AgentOsSandboxCommandRunner;
  readonly includeSandboxEvidenceInRunnerRequest?: boolean;
}

export interface AgentOsSshSandboxBackendAdapterOptions {
  readonly target?: string;
  readonly allowedCommandPatterns?: readonly AgentOsSandboxAllowedCommandPattern[];
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly commandRunner?: AgentOsSandboxCommandRunner;
  readonly includeSandboxEvidenceInRunnerRequest?: boolean;
}

export interface AgentOsHostSandboxBackendAdapterOptions {
  readonly allowHostExecution?: boolean;
  readonly allowedCommandPatterns?: readonly AgentOsSandboxAllowedCommandPattern[];
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly commandRunner?: AgentOsSandboxCommandRunner;
  readonly includeSandboxEvidenceInRunnerRequest?: boolean;
}

export interface AgentOsSandboxAllowedCommandPattern {
  readonly executable: string;
  readonly argv?: readonly string[];
  readonly operationId?: string;
}

export type AgentOsProcessCapabilityRunnerKind =
  | "browser"
  | "comfyui-cli"
  | "desktop-cli"
  | "exec-file"
  | "keychain"
  | "mcp-stdio"
  | "open-external"
  | "other"
  | "weixin-service";

export interface AgentOsProcessCapabilityLedgerSourceEntry {
  readonly owner: string;
  readonly runnerKind: AgentOsProcessCapabilityRunnerKind;
  readonly plan?: AgentOsSandboxExecutionPlan;
  readonly admission?: AgentOsSandboxBackendAdmission;
  readonly execution?: AgentOsSandboxCommandExecutionResult;
  readonly evidence?: AgentOsSandboxCommandExecutionEvidence;
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
}

export interface AgentOsProcessCapabilityProcessEvidence {
  readonly pid?: number;
  readonly signal?: string | null;
  readonly signals?: readonly AgentOsProcessCapabilitySignalEvidence[];
  readonly ownedProcess?: boolean;
  readonly terminationReason?: string;
}

export interface AgentOsProcessCapabilitySignalEvidence {
  readonly signal: string;
  readonly reason?: string;
  readonly sentAt?: string;
}

export interface AgentOsProcessCapabilityLedgerInput {
  readonly generatedAt?: string;
  readonly entries: readonly AgentOsProcessCapabilityLedgerSourceEntry[];
}

export interface AgentOsProcessCapabilityLedgerSummary {
  readonly generatedAt: string;
  readonly totalEntries: number;
  readonly riskyHostEntries: number;
  readonly entries: readonly AgentOsProcessCapabilityLedgerEntry[];
}

export interface AgentOsProcessCapabilityLedgerEntry {
  readonly owner: string;
  readonly runnerKind: AgentOsProcessCapabilityRunnerKind;
  readonly toolName?: string;
  readonly operationId?: string;
  readonly providerId?: string;
  readonly backend?: AgentOsSandboxMode;
  readonly status: "admitted" | "blocked" | "completed" | "failed" | "planned";
  readonly cwd?: string;
  readonly readableRoots: readonly string[];
  readonly writableRoots: readonly string[];
  readonly networkPolicy?: AgentOsSandboxNetworkPolicy;
  readonly enforcement?: AgentOsSandboxBackendAdmissionEnforcement;
  readonly command?: string;
  readonly commandPrefix?: string;
  readonly commandPattern?: AgentOsSandboxAllowedCommandPattern;
  readonly planHash?: string;
  readonly commandHash?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly exitCode?: number;
  readonly stdoutSummary?: string;
  readonly stderrSummary?: string;
  readonly artifacts?: readonly AgentOsSandboxCommandArtifact[];
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
}

export interface AgentOsSandboxLongLivedProcessSpawnRequest {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly sandbox?: AgentOsSandboxLongLivedProcessAdmission;
}

export interface AgentOsSandboxLongLivedProcessAdmission {
  readonly ok: boolean;
  readonly status: string;
  readonly backend?: string;
  readonly evidence?: AgentOsSandboxCommandExecutionEvidence;
}

export interface AgentOsSandboxLongLivedProcessAdmissionOptions {
  readonly allowedProcessEnforcements?: readonly AgentOsSandboxBackendAdmissionEnforcement["process"][];
}

export type AgentOsLiveRunnerMode = "dry-run" | "live";
export type AgentOsLiveRunnerAdmissionStatus = "admitted" | "blocked" | "revoked";
export type AgentOsLiveRunnerSessionStatus = "blocked" | "cancelled" | "running";
export type AgentOsLiveRunnerIntentRevocationStatus = "active" | "missing" | "revoked";

export type AgentOsLiveRunnerAdmissionIssue =
  | "audit-artifact-missing"
  | "credentials-config-missing"
  | "data-policy-missing"
  | "local-audio-process-not-allowed"
  | "microphone-permission-missing"
  | "network-policy-missing"
  | "operator-scope-missing"
  | "provider-config-missing"
  | "provider-runtime-config-missing"
  | "raw-audio-storage-policy-missing"
  | "runner-cancellation-missing"
  | "runner-intent-not-signed"
  | "runner-intent-not-unlocked"
  | "runner-intent-revoked"
  | "runner-intent-token-missing"
  | "sandbox-admission-missing"
  | "speaker-permission-missing";

export interface AgentOsLiveRunnerIntentStateInput {
  readonly tokenIssued: boolean;
  readonly signed: boolean;
  readonly unlocked: boolean;
  readonly revocationStatus: AgentOsLiveRunnerIntentRevocationStatus;
  readonly tokenHash?: string;
}

export interface AgentOsLiveRunnerAdmissionEvidenceInput {
  readonly operatorScopeGranted: boolean;
  readonly sandboxAdmitted: boolean;
  readonly providerConfigured: boolean;
  readonly credentialsConfigured: boolean;
  readonly networkPolicyGranted: boolean;
  readonly dataPolicyAccepted: boolean;
  readonly auditArtifactReady: boolean;
  readonly cancellationSupported: boolean;
  readonly microphonePermissionGranted?: boolean;
  readonly speakerPermissionGranted?: boolean;
  readonly rawAudioStoragePolicyAccepted?: boolean;
  readonly providerRuntimeConfigured?: boolean;
  readonly localAudioProcessAllowed?: boolean;
}

export interface AgentOsLiveRunnerAdmissionInput {
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly requestedAt?: string;
  readonly mode?: AgentOsLiveRunnerMode;
  readonly runnerIntent: AgentOsLiveRunnerIntentStateInput;
  readonly evidence: AgentOsLiveRunnerAdmissionEvidenceInput;
}

export interface AgentOsLiveRunnerAdmissionEvidence
  extends AgentOsLiveRunnerAdmissionEvidenceInput {
  readonly runnerIntentTokenIssued: boolean;
  readonly runnerIntentSigned: boolean;
  readonly runnerIntentUnlocked: boolean;
  readonly runnerIntentRevocationStatus: AgentOsLiveRunnerIntentRevocationStatus;
  readonly runnerIntentTokenHash?: string;
}

export interface AgentOsLiveRunnerAdmissionPacket {
  readonly ok: boolean;
  readonly status: AgentOsLiveRunnerAdmissionStatus;
  readonly admitted: boolean;
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly requestedAt: string;
  readonly mode: AgentOsLiveRunnerMode;
  readonly canStartLiveRunner: boolean;
  readonly liveRunnerStarted: false;
  readonly providerSdkLoaded: false;
  readonly providerCredentialsUsed: false;
  readonly networkUsed: false;
  readonly localProcessStarted: false;
  readonly audioBytesRead: false;
  readonly microphoneAccessed: false;
  readonly speakerAccessed: false;
  readonly rawAudioPersisted: false;
  readonly speechTranscribed: false;
  readonly speechSynthesized: false;
  readonly whisperStarted: false;
  readonly runnerIntentTokenIssued: boolean;
  readonly runnerIntentSigned: boolean;
  readonly runnerIntentUnlocked: boolean;
  readonly runnerIntentRevocationStatus: AgentOsLiveRunnerIntentRevocationStatus;
  readonly cancellationSupported: boolean;
  readonly evidence: AgentOsLiveRunnerAdmissionEvidence;
  readonly issues: readonly AgentOsLiveRunnerAdmissionIssue[];
}

export interface AgentOsLiveRunnerSessionStartOptions {
  readonly sessionId?: string;
  readonly startedAt?: string;
}

export interface AgentOsLiveRunnerBlockedSession {
  readonly ok: false;
  readonly status: "blocked";
  readonly sessionId: string;
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly mode: AgentOsLiveRunnerMode;
  readonly startedAt: string;
  readonly controlPlaneSessionStarted: false;
  readonly liveRunnerStarted: false;
  readonly providerSdkLoaded: false;
  readonly providerCredentialsUsed: false;
  readonly networkUsed: false;
  readonly localProcessStarted: false;
  readonly audioBytesRead: false;
  readonly microphoneAccessed: false;
  readonly speakerAccessed: false;
  readonly rawAudioPersisted: false;
  readonly speechTranscribed: false;
  readonly speechSynthesized: false;
  readonly whisperStarted: false;
  readonly cancelable: false;
  readonly reason: string;
  readonly admission: AgentOsLiveRunnerAdmissionPacket;
}

export interface AgentOsLiveRunnerRunningSession {
  readonly ok: true;
  readonly status: "running";
  readonly sessionId: string;
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly mode: AgentOsLiveRunnerMode;
  readonly startedAt: string;
  readonly controlPlaneSessionStarted: true;
  readonly liveRunnerStarted: false;
  readonly providerSdkLoaded: false;
  readonly providerCredentialsUsed: false;
  readonly networkUsed: false;
  readonly localProcessStarted: false;
  readonly audioBytesRead: false;
  readonly microphoneAccessed: false;
  readonly speakerAccessed: false;
  readonly rawAudioPersisted: false;
  readonly speechTranscribed: false;
  readonly speechSynthesized: false;
  readonly whisperStarted: false;
  readonly cancelable: true;
  readonly admission: AgentOsLiveRunnerAdmissionPacket;
}

export interface AgentOsLiveRunnerCancelledSession {
  readonly ok: true;
  readonly status: "cancelled";
  readonly sessionId: string;
  readonly runnerId: string;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly mode: AgentOsLiveRunnerMode;
  readonly startedAt: string;
  readonly cancelledAt: string;
  readonly controlPlaneSessionStarted: false;
  readonly liveRunnerStarted: false;
  readonly providerSdkLoaded: false;
  readonly providerCredentialsUsed: false;
  readonly networkUsed: false;
  readonly localProcessStarted: false;
  readonly audioBytesRead: false;
  readonly microphoneAccessed: false;
  readonly speakerAccessed: false;
  readonly rawAudioPersisted: false;
  readonly speechTranscribed: false;
  readonly speechSynthesized: false;
  readonly whisperStarted: false;
  readonly cancelable: false;
  readonly cancelReason: string;
  readonly admission: AgentOsLiveRunnerAdmissionPacket;
}

export type AgentOsLiveRunnerSession =
  | AgentOsLiveRunnerBlockedSession
  | AgentOsLiveRunnerCancelledSession
  | AgentOsLiveRunnerRunningSession;

export interface AgentOsLiveRunnerCancelOptions {
  readonly cancelledAt?: string;
  readonly reason?: string;
}

export interface AgentOsLiveRunnerIntentRevocationOptions {
  readonly revokedAt?: string;
  readonly reason?: string;
}

export interface AgentOsLiveRunnerRevokedAdmissionPacket
  extends Omit<
    AgentOsLiveRunnerAdmissionPacket,
    | "admitted"
    | "canStartLiveRunner"
    | "evidence"
    | "issues"
    | "ok"
    | "runnerIntentRevocationStatus"
    | "runnerIntentTokenIssued"
    | "runnerIntentUnlocked"
    | "status"
  > {
  readonly ok: false;
  readonly status: "revoked";
  readonly admitted: false;
  readonly canStartLiveRunner: false;
  readonly runnerIntentTokenIssued: false;
  readonly runnerIntentUnlocked: false;
  readonly runnerIntentRevocationStatus: "revoked";
  readonly revokedAt: string;
  readonly revokeReason: string;
  readonly evidence: AgentOsLiveRunnerAdmissionEvidence;
  readonly issues: readonly AgentOsLiveRunnerAdmissionIssue[];
}

const DEFAULT_ENABLED_BACKENDS: readonly AgentOsSandboxMode[] = ["readonly"];
const NETWORK_POLICY_ORDER: Record<AgentOsSandboxNetworkPolicy, number> = {
  none: 0,
  limited: 1,
  full: 2,
};

export function planAgentOsSandboxExecution(
  input: AgentOsSandboxExecutionPlanInput,
): AgentOsSandboxExecutionPlan {
  const sandboxMode = input.preflight.sandboxMode;
  const providerId = input.providerId ?? input.preflight.providerId;
  const readableRoots = normalizeRoots(input.policy?.readableRoots);
  const writableRoots = normalizeRoots(input.policy?.writableRoots);
  const networkPolicy = input.policy?.networkPolicy ?? defaultNetworkPolicyForMode(sandboxMode);
  const riskSummary = createRiskSummary({
    ...input,
    readableRoots,
    writableRoots,
    networkPolicy,
    ...(providerId === undefined ? {} : { providerId }),
  });

  if (input.preflight.verdict !== "allow") {
    return {
      ok: false,
      status: "blocked",
      error: "sandbox-preflight-denied",
      reason: input.preflight.reason ?? "Agent OS sandbox preflight denied execution",
      riskSummary,
    };
  }

  if (sandboxMode === "disabled") {
    return {
      ok: false,
      status: "blocked",
      error: "sandbox-disabled",
      reason: "Sandbox mode disabled cannot execute",
      riskSummary,
    };
  }

  if (!isBackendEnabled(sandboxMode, input.policy?.enabledBackends)) {
    return {
      ok: false,
      status: "blocked",
      error: "sandbox-backend-disabled",
      reason: `Sandbox backend ${sandboxMode} is not enabled`,
      riskSummary,
    };
  }

  if (
    input.cwd !== undefined &&
    !isCwdAllowed(input.cwd, readableRoots, writableRoots, sandboxMode)
  ) {
    return {
      ok: false,
      status: "blocked",
      error: "sandbox-cwd-outside-scope",
      reason: `Sandbox cwd ${input.cwd} is outside declared filesystem scope`,
      riskSummary,
    };
  }

  const requestedNetworkPolicy =
    input.requestedNetworkPolicy ?? defaultNetworkPolicyForMode(sandboxMode);
  if (NETWORK_POLICY_ORDER[requestedNetworkPolicy] > NETWORK_POLICY_ORDER[networkPolicy]) {
    return {
      ok: false,
      status: "blocked",
      error: "sandbox-network-escalation",
      reason: `Requested network policy ${requestedNetworkPolicy} exceeds allowed policy ${networkPolicy}`,
      riskSummary,
    };
  }

  return {
    ok: true,
    status: "ready",
    backend: sandboxMode,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.command === undefined ? {} : { command: input.command }),
    ...(input.argv === undefined ? {} : { argv: input.argv }),
    ...(input.env === undefined ? {} : { env: input.env }),
    readableRoots,
    writableRoots,
    networkPolicy,
    riskSummary,
  };
}

export function createAgentOsSandboxBackendRegistry(
  options: AgentOsSandboxBackendRegistryOptions = {},
): AgentOsSandboxBackendRegistry {
  const enabledBackends = new Set(options.enabledBackends ?? DEFAULT_ENABLED_BACKENDS);
  const adapters = [
    ...createBuiltInAgentOsSandboxBackendAdapters().filter((adapter) =>
      enabledBackends.has(adapter.mode),
    ),
    ...(options.adapters ?? []).filter((adapter) => enabledBackends.has(adapter.mode)),
  ];
  const byMode = new Map<AgentOsSandboxMode, AgentOsSandboxBackendAdapter>();
  for (const adapter of adapters) {
    if (!byMode.has(adapter.mode)) {
      byMode.set(adapter.mode, adapter);
    }
  }
  return {
    get: (mode) => byMode.get(mode),
    list: () => [...byMode.values()],
  };
}

export async function admitAgentOsSandboxExecution(
  plan: AgentOsSandboxExecutionPlan,
  options: AgentOsSandboxAdmissionOptions = {},
): Promise<AgentOsSandboxBackendAdmission> {
  if (!plan.ok) {
    return {
      ok: false,
      status: "blocked",
      ...(plan.riskSummary?.sandboxMode === undefined
        ? {}
        : { backend: plan.riskSummary.sandboxMode }),
      error: "sandbox-plan-not-ready",
      reason: plan.reason,
    };
  }
  const registry = options.registry ?? createAgentOsSandboxBackendRegistry();
  const adapter = registry.get(plan.backend);
  if (adapter === undefined) {
    return {
      ok: false,
      status: "blocked",
      backend: plan.backend,
      error: "sandbox-backend-adapter-unavailable",
      reason: `Sandbox backend ${plan.backend} is not available for execution admission`,
    };
  }
  const admission = await adapter.admit(plan, {
    now: options.now ?? (() => new Date().toISOString()),
  });
  return normalizeAgentOsSandboxBackendAdmission(admission, plan, adapter);
}

export function admitAgentOsSandboxExecutionSync(
  plan: AgentOsSandboxExecutionPlan,
  options: AgentOsSandboxAdmissionOptions = {},
): AgentOsSandboxBackendAdmission {
  if (!plan.ok) {
    return {
      ok: false,
      status: "blocked",
      ...(plan.riskSummary?.sandboxMode === undefined
        ? {}
        : { backend: plan.riskSummary.sandboxMode }),
      error: "sandbox-plan-not-ready",
      reason: plan.reason,
    };
  }
  const registry = options.registry ?? createAgentOsSandboxBackendRegistry();
  const adapter = registry.get(plan.backend);
  if (adapter === undefined) {
    return {
      ok: false,
      status: "blocked",
      backend: plan.backend,
      error: "sandbox-backend-adapter-unavailable",
      reason: `Sandbox backend ${plan.backend} is not available for execution admission`,
    };
  }
  const admission = adapter.admit(plan, {
    now: options.now ?? (() => new Date().toISOString()),
  });
  if (isPromiseLike(admission)) {
    return {
      ok: false,
      status: "blocked",
      backend: plan.backend,
      providerId: adapter.id,
      error: "sandbox-backend-adapter-denied",
      reason: `Sandbox backend ${plan.backend} returned asynchronous admission for a synchronous execution path`,
    };
  }
  return normalizeAgentOsSandboxBackendAdmission(admission, plan, adapter);
}

export async function executeAgentOsSandboxCommand(
  plan: AgentOsSandboxExecutionPlan,
  admission: AgentOsSandboxBackendAdmission,
  options: AgentOsSandboxCommandExecutionOptions = {},
): Promise<AgentOsSandboxCommandExecutionResult> {
  if (!plan.ok) {
    return {
      ok: false,
      status: "blocked",
      ...(plan.riskSummary?.sandboxMode === undefined
        ? {}
        : { backend: plan.riskSummary.sandboxMode }),
      error: "sandbox-plan-not-ready",
      reason: plan.reason,
    };
  }
  if (!admission.ok) {
    const providerId = admission.providerId ?? createDefaultSandboxProviderId(plan.backend);
    return {
      ok: false,
      status: "blocked",
      backend: admission.backend ?? plan.backend,
      providerId,
      admission,
      error: "sandbox-backend-admission-denied",
      reason: admission.reason ?? `Sandbox backend ${plan.backend} did not admit execution`,
      evidence: createCommandExecutionEvidence({
        plan,
        admission,
        providerId,
      }),
    };
  }
  const registry = options.registry ?? createAgentOsSandboxBackendRegistry();
  const adapter = registry.get(plan.backend);
  if (adapter?.execute === undefined) {
    const providerId =
      admission.providerId ?? adapter?.id ?? createDefaultSandboxProviderId(plan.backend);
    const result: AgentOsSandboxCommandExecutionResult = {
      ok: false,
      status: "blocked",
      backend: plan.backend,
      providerId,
      admission,
      error: "sandbox-backend-executor-unavailable",
      reason: `Sandbox backend ${plan.backend} does not expose command execution`,
      evidence: createCommandExecutionEvidence({
        plan,
        admission,
        providerId,
      }),
    };
    return result;
  }
  try {
    return normalizeAgentOsSandboxCommandExecutionResult(
      await adapter.execute(plan, admission, {
        now: options.now ?? (() => new Date().toISOString()),
      }),
      plan,
      admission,
      adapter,
    );
  } catch (error) {
    const providerId = admission.providerId ?? adapter.id;
    return {
      ok: false,
      status: "failed",
      backend: plan.backend,
      providerId,
      admission,
      error: "sandbox-backend-executor-threw",
      reason: toErrorMessage(error),
      evidence: createCommandExecutionEvidence({
        plan,
        admission,
        providerId,
        completedAt: (options.now ?? (() => new Date().toISOString()))(),
      }),
    };
  }
}

export function executeAgentOsSandboxCommandSync(
  plan: AgentOsSandboxExecutionPlan,
  admission: AgentOsSandboxBackendAdmission,
  options: AgentOsSandboxCommandExecutionOptions = {},
): AgentOsSandboxCommandExecutionResult {
  if (!plan.ok) {
    return {
      ok: false,
      status: "blocked",
      ...(plan.riskSummary?.sandboxMode === undefined
        ? {}
        : { backend: plan.riskSummary.sandboxMode }),
      error: "sandbox-plan-not-ready",
      reason: plan.reason,
    };
  }
  if (!admission.ok) {
    const providerId = admission.providerId ?? createDefaultSandboxProviderId(plan.backend);
    return {
      ok: false,
      status: "blocked",
      backend: admission.backend ?? plan.backend,
      providerId,
      admission,
      error: "sandbox-backend-admission-denied",
      reason: admission.reason ?? `Sandbox backend ${plan.backend} did not admit execution`,
      evidence: createCommandExecutionEvidence({
        plan,
        admission,
        providerId,
      }),
    };
  }
  const registry = options.registry ?? createAgentOsSandboxBackendRegistry();
  const adapter = registry.get(plan.backend);
  if (adapter?.execute === undefined) {
    const providerId =
      admission.providerId ?? adapter?.id ?? createDefaultSandboxProviderId(plan.backend);
    return {
      ok: false,
      status: "blocked",
      backend: plan.backend,
      providerId,
      admission,
      error: "sandbox-backend-executor-unavailable",
      reason: `Sandbox backend ${plan.backend} does not expose command execution`,
      evidence: createCommandExecutionEvidence({
        plan,
        admission,
        providerId,
      }),
    };
  }
  try {
    const result = adapter.execute(plan, admission, {
      now: options.now ?? (() => new Date().toISOString()),
    });
    if (isPromiseLike(result)) {
      const providerId = admission.providerId ?? adapter.id;
      return {
        ok: false,
        status: "blocked",
        backend: plan.backend,
        providerId,
        admission,
        error: "sandbox-backend-executor-unavailable",
        reason: `Sandbox backend ${plan.backend} returned asynchronous command execution for a synchronous execution path`,
        evidence: createCommandExecutionEvidence({
          plan,
          admission,
          providerId,
        }),
      };
    }
    return normalizeAgentOsSandboxCommandExecutionResult(result, plan, admission, adapter);
  } catch (error) {
    const providerId = admission.providerId ?? adapter.id;
    return {
      ok: false,
      status: "failed",
      backend: plan.backend,
      providerId,
      admission,
      error: "sandbox-backend-executor-threw",
      reason: toErrorMessage(error),
      evidence: createCommandExecutionEvidence({
        plan,
        admission,
        providerId,
        completedAt: (options.now ?? (() => new Date().toISOString()))(),
      }),
    };
  }
}

export function createAgentOsSandboxCommandAdmissionEvidence(
  plan: AgentOsSandboxExecutionPlan,
  admission: AgentOsSandboxBackendAdmission,
): AgentOsSandboxCommandExecutionEvidence | undefined {
  if (!plan.ok) {
    return undefined;
  }
  return createCommandExecutionEvidence({
    plan,
    admission,
    providerId: admission.providerId ?? createDefaultSandboxProviderId(plan.backend),
  });
}

export function summarizeAgentOsProcessCapabilityLedger(
  input: AgentOsProcessCapabilityLedgerInput,
): AgentOsProcessCapabilityLedgerSummary {
  const entries = input.entries.map(createAgentOsProcessCapabilityLedgerEntry);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totalEntries: entries.length,
    riskyHostEntries: entries.filter((entry) => entry.backend === "host").length,
    entries,
  };
}

export function assertAgentOsSandboxLongLivedProcessSpawnAdmitted(
  request: AgentOsSandboxLongLivedProcessSpawnRequest,
  options: AgentOsSandboxLongLivedProcessAdmissionOptions = {},
): void {
  const sandbox = request.sandbox;
  const evidence = sandbox?.evidence;
  if (
    sandbox?.ok !== true ||
    sandbox.status !== "admitted" ||
    evidence === undefined ||
    evidence.backend !== sandbox.backend
  ) {
    throw new Error("Long-lived process spawn requires admitted Agent OS sandbox evidence.");
  }

  const allowedProcessEnforcements = options.allowedProcessEnforcements ?? [
    "container",
    "host-process",
    "remote-session",
  ];
  const processEnforcement = evidence.enforcement?.process;
  if (
    processEnforcement === undefined ||
    !allowedProcessEnforcements.includes(processEnforcement)
  ) {
    throw new Error("Long-lived process spawn requires OS process sandbox enforcement.");
  }

  const commandPattern = readCommandPattern(readRecord(evidence.backendConfig)?.commandPattern);
  if (
    commandPattern?.executable !== request.executable ||
    commandPattern.argv === undefined ||
    !areStringArraysEqual(commandPattern.argv, request.argv)
  ) {
    throw new Error("Long-lived process spawn command does not match admitted sandbox evidence.");
  }
}

export function createAgentOsLiveRunnerAdmissionPacket(
  input: AgentOsLiveRunnerAdmissionInput,
): AgentOsLiveRunnerAdmissionPacket {
  const evidence: AgentOsLiveRunnerAdmissionEvidence = {
    ...input.evidence,
    runnerIntentTokenIssued: input.runnerIntent.tokenIssued,
    runnerIntentSigned: input.runnerIntent.signed,
    runnerIntentUnlocked: input.runnerIntent.unlocked,
    runnerIntentRevocationStatus: input.runnerIntent.revocationStatus,
    ...(input.runnerIntent.tokenHash === undefined
      ? {}
      : { runnerIntentTokenHash: input.runnerIntent.tokenHash }),
  };
  const issues = createLiveRunnerAdmissionIssues(evidence);
  const admitted = issues.length === 0;
  const status: AgentOsLiveRunnerAdmissionStatus = admitted ? "admitted" : "blocked";
  return {
    ok: admitted,
    status,
    admitted,
    runnerId: input.runnerId,
    providerId: input.providerId,
    capabilityId: input.capabilityId,
    requestedAt: input.requestedAt ?? new Date().toISOString(),
    mode: input.mode ?? "dry-run",
    canStartLiveRunner: admitted,
    liveRunnerStarted: false,
    providerSdkLoaded: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: false,
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    rawAudioPersisted: false,
    speechTranscribed: false,
    speechSynthesized: false,
    whisperStarted: false,
    runnerIntentTokenIssued: input.runnerIntent.tokenIssued,
    runnerIntentSigned: input.runnerIntent.signed,
    runnerIntentUnlocked: input.runnerIntent.unlocked,
    runnerIntentRevocationStatus: input.runnerIntent.revocationStatus,
    cancellationSupported: input.evidence.cancellationSupported,
    evidence,
    issues,
  };
}

export function startAgentOsLiveRunnerSession(
  admission: AgentOsLiveRunnerAdmissionPacket,
  options: AgentOsLiveRunnerSessionStartOptions = {},
): AgentOsLiveRunnerSession {
  const startedAt = options.startedAt ?? new Date().toISOString();
  const sessionId = options.sessionId ?? createLiveRunnerSessionId(admission, startedAt);
  if (!admission.ok || !admission.canStartLiveRunner) {
    return {
      ok: false,
      status: "blocked",
      sessionId,
      runnerId: admission.runnerId,
      providerId: admission.providerId,
      capabilityId: admission.capabilityId,
      mode: admission.mode,
      startedAt,
      controlPlaneSessionStarted: false,
      liveRunnerStarted: false,
      providerSdkLoaded: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      localProcessStarted: false,
      audioBytesRead: false,
      microphoneAccessed: false,
      speakerAccessed: false,
      rawAudioPersisted: false,
      speechTranscribed: false,
      speechSynthesized: false,
      whisperStarted: false,
      cancelable: false,
      reason: "Live runner admission is not ready",
      admission,
    };
  }
  if (admission.mode !== "dry-run") {
    return {
      ok: false,
      status: "blocked",
      sessionId,
      runnerId: admission.runnerId,
      providerId: admission.providerId,
      capabilityId: admission.capabilityId,
      mode: admission.mode,
      startedAt,
      controlPlaneSessionStarted: false,
      liveRunnerStarted: false,
      providerSdkLoaded: false,
      providerCredentialsUsed: false,
      networkUsed: false,
      localProcessStarted: false,
      audioBytesRead: false,
      microphoneAccessed: false,
      speakerAccessed: false,
      rawAudioPersisted: false,
      speechTranscribed: false,
      speechSynthesized: false,
      whisperStarted: false,
      cancelable: false,
      reason: "Live runner provider driver is not registered",
      admission,
    };
  }
  return {
    ok: true,
    status: "running",
    sessionId,
    runnerId: admission.runnerId,
    providerId: admission.providerId,
    capabilityId: admission.capabilityId,
    mode: admission.mode,
    startedAt,
    controlPlaneSessionStarted: true,
    liveRunnerStarted: false,
    providerSdkLoaded: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: false,
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    rawAudioPersisted: false,
    speechTranscribed: false,
    speechSynthesized: false,
    whisperStarted: false,
    cancelable: true,
    admission,
  };
}

export function cancelAgentOsLiveRunnerSession(
  session: AgentOsLiveRunnerSession,
  options: AgentOsLiveRunnerCancelOptions = {},
): AgentOsLiveRunnerCancelledSession {
  return {
    ok: true,
    status: "cancelled",
    sessionId: session.sessionId,
    runnerId: session.runnerId,
    providerId: session.providerId,
    capabilityId: session.capabilityId,
    mode: session.mode,
    startedAt: session.startedAt,
    cancelledAt: options.cancelledAt ?? new Date().toISOString(),
    controlPlaneSessionStarted: false,
    liveRunnerStarted: false,
    providerSdkLoaded: false,
    providerCredentialsUsed: false,
    networkUsed: false,
    localProcessStarted: false,
    audioBytesRead: false,
    microphoneAccessed: false,
    speakerAccessed: false,
    rawAudioPersisted: false,
    speechTranscribed: false,
    speechSynthesized: false,
    whisperStarted: false,
    cancelable: false,
    cancelReason: options.reason ?? "cancelled",
    admission: session.admission,
  };
}

export function revokeAgentOsLiveRunnerIntent(
  admission: AgentOsLiveRunnerAdmissionPacket,
  options: AgentOsLiveRunnerIntentRevocationOptions = {},
): AgentOsLiveRunnerRevokedAdmissionPacket {
  const evidence: AgentOsLiveRunnerAdmissionEvidence = {
    ...admission.evidence,
    runnerIntentTokenIssued: false,
    runnerIntentUnlocked: false,
    runnerIntentRevocationStatus: "revoked",
  };
  const issues = createLiveRunnerAdmissionIssues(evidence);
  return {
    ...admission,
    ok: false,
    status: "revoked",
    admitted: false,
    canStartLiveRunner: false,
    runnerIntentTokenIssued: false,
    runnerIntentUnlocked: false,
    runnerIntentRevocationStatus: "revoked",
    revokedAt: options.revokedAt ?? new Date().toISOString(),
    revokeReason: options.reason ?? "revoked",
    evidence,
    issues,
  };
}

export function createAgentOsDockerSandboxBackendAdapter(
  options: AgentOsDockerSandboxBackendAdapterOptions = {},
): AgentOsSandboxBackendAdapter {
  return createCommandSandboxBackendAdapter({
    id: "agent-os-sandbox.docker",
    mode: "docker",
    missingConfigReason: () =>
      normalizeConfigString(options.image) === undefined
        ? "Docker sandbox backend requires a configured image"
        : undefined,
    createEnforcement: () => ({
      filesystem: "container-bind-mounts",
      network: networkEnforcementForPolicy(options.networkPolicy ?? "none"),
      process: "container",
    }),
    createBackendConfig: ({ commandPattern }) => ({
      image: normalizeConfigString(options.image),
      readonlyRootfs: options.readonlyRootfs ?? true,
      ...(commandPattern === undefined ? {} : { commandPattern }),
    }),
    allowedCommandPatterns: options.allowedCommandPatterns,
    legacyCommandPrefixes: readLegacyAllowedCommandPrefixes(options),
    legacyCommandPrefixReason:
      "Docker sandbox legacy command prefixes are no longer supported; use allowedCommandPatterns",
    commandDeniedReason: "Docker sandbox command is not allowed by configured argv patterns",
    commandRunner: options.commandRunner,
    includeSandboxEvidenceInRunnerRequest: options.includeSandboxEvidenceInRunnerRequest,
  });
}

export function createAgentOsSshSandboxBackendAdapter(
  options: AgentOsSshSandboxBackendAdapterOptions = {},
): AgentOsSandboxBackendAdapter {
  return createCommandSandboxBackendAdapter({
    id: "agent-os-sandbox.ssh",
    mode: "ssh",
    missingConfigReason: () =>
      normalizeConfigString(options.target) === undefined
        ? "SSH sandbox backend requires a configured target"
        : undefined,
    createEnforcement: () => ({
      filesystem: "remote-workdir-scope",
      network: "ssh-target-policy",
      process: "remote-session",
    }),
    createBackendConfig: ({ commandPattern }) => ({
      target: normalizeConfigString(options.target),
      ...(commandPattern === undefined ? {} : { commandPattern }),
    }),
    allowedCommandPatterns: options.allowedCommandPatterns,
    legacyCommandPrefixes: readLegacyAllowedCommandPrefixes(options),
    legacyCommandPrefixReason:
      "SSH sandbox legacy command prefixes are no longer supported; use allowedCommandPatterns",
    commandDeniedReason: "SSH sandbox command is not allowed by configured argv patterns",
    commandRunner: options.commandRunner,
    includeSandboxEvidenceInRunnerRequest: options.includeSandboxEvidenceInRunnerRequest,
  });
}

export function createAgentOsHostSandboxBackendAdapter(
  options: AgentOsHostSandboxBackendAdapterOptions = {},
): AgentOsSandboxBackendAdapter {
  return createCommandSandboxBackendAdapter({
    id: "agent-os-sandbox.host",
    mode: "host",
    missingConfigReason: () =>
      options.allowHostExecution === true
        ? undefined
        : "Host sandbox backend requires explicit allowHostExecution=true",
    createEnforcement: () => ({
      filesystem: "host-explicit",
      network: networkEnforcementForPolicy(options.networkPolicy ?? "none"),
      process: "host-process",
    }),
    createBackendConfig: ({ commandPattern }) => ({
      allowHostExecution: options.allowHostExecution === true,
      ...(commandPattern === undefined ? {} : { commandPattern }),
    }),
    allowedCommandPatterns: options.allowedCommandPatterns,
    legacyCommandPrefixes: readLegacyAllowedCommandPrefixes(options),
    legacyCommandPrefixReason:
      "Host sandbox legacy command prefixes are no longer supported; use allowedCommandPatterns",
    commandDeniedReason: "Host sandbox command is not allowed by configured argv patterns",
    commandRunner: options.commandRunner,
    includeSandboxEvidenceInRunnerRequest: options.includeSandboxEvidenceInRunnerRequest,
  });
}

function createBuiltInAgentOsSandboxBackendAdapters(): readonly AgentOsSandboxBackendAdapter[] {
  return [
    createLocalAgentOsSandboxBackendAdapter("readonly", {
      filesystem: "process-cwd-scope",
      network: "none",
    }),
    createLocalAgentOsSandboxBackendAdapter("workspace-write", {
      filesystem: "process-cwd-scope",
      network: "none",
    }),
    createLocalAgentOsSandboxBackendAdapter("network-limited", {
      filesystem: "process-cwd-scope",
      network: "policy-declared",
    }),
  ];
}

function createLocalAgentOsSandboxBackendAdapter(
  mode: AgentOsSandboxMode,
  enforcement: Pick<AgentOsSandboxBackendAdmissionEnforcement, "filesystem" | "network">,
): AgentOsSandboxBackendAdapter {
  return {
    id: `agent-os-sandbox.local.${mode}`,
    mode,
    admit: (plan, context) => ({
      ok: true,
      status: "admitted",
      backend: plan.backend,
      providerId: `agent-os-sandbox.local.${mode}`,
      admittedAt: context.now(),
      ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
      networkPolicy: plan.networkPolicy,
      planHash: createAgentOsSandboxPlanHash(plan),
      filesystem: {
        readableRoots: plan.readableRoots,
        writableRoots: plan.writableRoots,
      },
      enforcement: {
        filesystem: enforcement.filesystem,
        network: enforcement.network,
        process: "in-process-adapter",
      },
    }),
  };
}

function createCommandSandboxBackendAdapter(input: {
  readonly id: string;
  readonly mode: AgentOsSandboxMode;
  readonly missingConfigReason: () => string | undefined;
  readonly createEnforcement: () => AgentOsSandboxBackendAdmissionEnforcement;
  readonly createBackendConfig: (match: {
    readonly commandPattern?: AgentOsSandboxAllowedCommandPattern;
  }) => Readonly<Record<string, unknown>>;
  readonly allowedCommandPatterns: readonly AgentOsSandboxAllowedCommandPattern[] | undefined;
  readonly legacyCommandPrefixes: readonly string[] | undefined;
  readonly legacyCommandPrefixReason: string;
  readonly commandDeniedReason: string;
  readonly commandRunner: AgentOsSandboxCommandRunner | undefined;
  readonly includeSandboxEvidenceInRunnerRequest: boolean | undefined;
}): AgentOsSandboxBackendAdapter {
  return {
    id: input.id,
    mode: input.mode,
    admit: (plan, context) => {
      const missingConfigReason = input.missingConfigReason();
      if (missingConfigReason !== undefined) {
        return createSandboxBackendDeniedAdmission(plan, input.id, missingConfigReason);
      }
      if (hasLegacyCommandPrefixes(input.legacyCommandPrefixes)) {
        return createSandboxBackendDeniedAdmission(plan, input.id, input.legacyCommandPrefixReason);
      }
      const commandPattern = findAllowedCommandPattern(plan, input.allowedCommandPatterns);
      if (commandPattern === undefined && hasCommandPatterns(input.allowedCommandPatterns)) {
        return createSandboxBackendDeniedAdmission(plan, input.id, input.commandDeniedReason);
      }
      return {
        ok: true,
        status: "admitted",
        backend: input.mode,
        providerId: input.id,
        admittedAt: context.now(),
        ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
        networkPolicy: plan.networkPolicy,
        filesystem: {
          readableRoots: plan.readableRoots,
          writableRoots: plan.writableRoots,
        },
        enforcement: input.createEnforcement(),
        backendConfig: input.createBackendConfig({
          ...(commandPattern === undefined ? {} : { commandPattern }),
        }),
        planHash: createAgentOsSandboxPlanHash(plan),
      };
    },
    execute: (plan, admission, context) => {
      if (plan.command === undefined || plan.command.trim().length === 0) {
        return createSandboxCommandBlockedResult(
          plan,
          admission,
          "sandbox-command-invalid",
          "Sandbox command execution requires a non-empty command",
        );
      }
      if (input.commandRunner === undefined) {
        return createSandboxCommandBlockedResult(
          plan,
          admission,
          "sandbox-backend-executor-unavailable",
          `Sandbox backend ${input.mode} has no configured command runner`,
        );
      }
      const command = parseCommandForSandbox(plan.command, plan.argv);
      if (command === undefined) {
        return createSandboxCommandBlockedResult(
          plan,
          admission,
          "sandbox-command-invalid",
          "Sandbox command must include an executable",
        );
      }
      const startedAt = context.now();
      const request: AgentOsSandboxCommandRunRequest = {
        backend: input.mode,
        executable: command.executable,
        argv: command.argv,
        ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
        ...(plan.env === undefined ? {} : { env: plan.env }),
        ...(input.includeSandboxEvidenceInRunnerRequest === true
          ? {
              metadata: {
                sandboxAdmission: admission,
                sandboxEvidence: createCommandExecutionEvidence({
                  plan,
                  admission,
                  providerId: admission.providerId ?? input.id,
                }),
              },
            }
          : {}),
      };
      const finalize = (
        runResult: AgentOsSandboxCommandRunResult,
      ): AgentOsSandboxCommandExecutionResult => {
        const completedAt = context.now();
        const ok = runResult.exitCode === 0;
        const process = normalizeProcessEvidence(
          runResult.process ?? readRecord(runResult.metadata)?.process,
        );
        return {
          ok,
          status: ok ? "completed" : "failed",
          backend: input.mode,
          providerId: admission.providerId ?? input.id,
          admission,
          startedAt,
          completedAt,
          exitCode: runResult.exitCode,
          ...(runResult.stdout === undefined ? {} : { stdout: runResult.stdout }),
          ...(runResult.stderr === undefined ? {} : { stderr: runResult.stderr }),
          ...(runResult.metadata === undefined ? {} : { metadata: runResult.metadata }),
          ...(process === undefined ? {} : { process }),
          ...(runResult.artifacts === undefined ? {} : { artifacts: runResult.artifacts }),
          evidence: createCommandExecutionEvidence({
            plan,
            admission,
            providerId: admission.providerId ?? input.id,
            startedAt,
            completedAt,
            exitCode: runResult.exitCode,
            ...(runResult.stdout === undefined ? {} : { stdout: runResult.stdout }),
            ...(runResult.stderr === undefined ? {} : { stderr: runResult.stderr }),
            ...(process === undefined ? {} : { process }),
            ...(runResult.artifacts === undefined ? {} : { artifacts: runResult.artifacts }),
          }),
        };
      };
      const runResult = input.commandRunner(request);
      return isPromiseLike(runResult) ? runResult.then(finalize) : finalize(runResult);
    },
  };
}

function normalizeAgentOsSandboxBackendAdmission(
  admission: AgentOsSandboxBackendAdmission,
  plan: AgentOsSandboxReadyExecutionPlan,
  adapter: AgentOsSandboxBackendAdapter,
): AgentOsSandboxBackendAdmission {
  if (admission.ok !== true) {
    return {
      ok: false,
      status: "blocked",
      backend: plan.backend,
      providerId: admission.providerId ?? adapter.id,
      error: admission.error ?? "sandbox-backend-adapter-denied",
      reason: admission.reason ?? `Sandbox backend ${plan.backend} denied execution admission`,
    };
  }
  return {
    ok: true,
    status: "admitted",
    backend: plan.backend,
    providerId: admission.providerId ?? adapter.id,
    ...(admission.admittedAt === undefined ? {} : { admittedAt: admission.admittedAt }),
    ...(plan.cwd === undefined ? {} : { cwd: plan.cwd }),
    networkPolicy: plan.networkPolicy,
    filesystem: {
      readableRoots: plan.readableRoots,
      writableRoots: plan.writableRoots,
    },
    enforcement: createClampedAdmissionEnforcement(plan.backend, plan.networkPolicy),
    ...(admission.backendConfig === undefined ? {} : { backendConfig: admission.backendConfig }),
    planHash: createAgentOsSandboxPlanHash(plan),
  };
}

function normalizeAgentOsSandboxCommandExecutionResult(
  result: AgentOsSandboxCommandExecutionResult,
  plan: AgentOsSandboxReadyExecutionPlan,
  admission: AgentOsSandboxBackendAdmission,
  adapter: AgentOsSandboxBackendAdapter,
): AgentOsSandboxCommandExecutionResult {
  if (result.ok !== true) {
    const providerId = result.providerId ?? admission.providerId ?? adapter.id;
    return {
      ...result,
      ok: false,
      status: result.status === "failed" ? "failed" : "blocked",
      backend: result.backend ?? plan.backend,
      providerId,
      admission: result.admission ?? admission,
      error: result.error ?? "sandbox-backend-execution-failed",
      reason: result.reason ?? `Sandbox backend ${plan.backend} command execution failed`,
      ...processEvidenceProperty(result),
      evidence:
        result.evidence ??
        createCommandExecutionEvidence({
          plan,
          admission,
          providerId,
          ...(result.startedAt === undefined ? {} : { startedAt: result.startedAt }),
          ...(result.completedAt === undefined ? {} : { completedAt: result.completedAt }),
          ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
          ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
          ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
          ...processEvidenceProperty(result),
          ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
        }),
    };
  }
  return {
    ...result,
    ok: true,
    status: "completed",
    backend: result.backend ?? plan.backend,
    providerId: result.providerId ?? admission.providerId ?? adapter.id,
    admission: result.admission ?? admission,
    ...processEvidenceProperty(result),
    evidence:
      result.evidence ??
      createCommandExecutionEvidence({
        plan,
        admission,
        providerId: result.providerId ?? admission.providerId ?? adapter.id,
        ...(result.startedAt === undefined ? {} : { startedAt: result.startedAt }),
        ...(result.completedAt === undefined ? {} : { completedAt: result.completedAt }),
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
        ...(result.stdout === undefined ? {} : { stdout: result.stdout }),
        ...(result.stderr === undefined ? {} : { stderr: result.stderr }),
        ...processEvidenceProperty(result),
        ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
      }),
  };
}

function createRiskSummary(
  input: AgentOsSandboxExecutionPlanInput & {
    readonly providerId?: string;
    readonly readableRoots: readonly string[];
    readonly writableRoots: readonly string[];
    readonly networkPolicy: AgentOsSandboxNetworkPolicy;
  },
): AgentOsSandboxRiskSummary {
  return {
    toolName: input.toolName,
    ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
    ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
    sandboxMode: input.preflight.sandboxMode,
    filesystem: {
      ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
      readableRoots: input.readableRoots,
      writableRoots: input.writableRoots,
    },
    networkPolicy: input.networkPolicy,
    ...(input.command === undefined ? {} : { command: input.command }),
    ...(input.preflight.reason === undefined ? {} : { reason: input.preflight.reason }),
  };
}

function isBackendEnabled(
  sandboxMode: AgentOsSandboxMode,
  enabledBackends: readonly AgentOsSandboxMode[] | undefined,
): boolean {
  return (enabledBackends ?? DEFAULT_ENABLED_BACKENDS).includes(sandboxMode);
}

function isCwdAllowed(
  cwd: string,
  readableRoots: readonly string[],
  writableRoots: readonly string[],
  sandboxMode: AgentOsSandboxMode,
): boolean {
  const allowedRoots =
    sandboxMode === "readonly" ? readableRoots : [...readableRoots, ...writableRoots];
  if (allowedRoots.length === 0) {
    return false;
  }
  return allowedRoots.some((root) => isPathInsideRoot(cwd, root));
}

function createSandboxBackendDeniedAdmission(
  plan: AgentOsSandboxReadyExecutionPlan,
  providerId: string,
  reason: string,
): AgentOsSandboxBackendAdmission {
  return {
    ok: false,
    status: "blocked",
    backend: plan.backend,
    providerId,
    error: "sandbox-backend-adapter-denied",
    reason,
  };
}

function createClampedAdmissionEnforcement(
  backend: AgentOsSandboxMode,
  networkPolicy: AgentOsSandboxNetworkPolicy,
): AgentOsSandboxBackendAdmissionEnforcement {
  switch (backend) {
    case "docker":
      return {
        filesystem: "container-bind-mounts",
        network: networkEnforcementForPolicy(networkPolicy),
        process: "container",
      };
    case "ssh":
      return {
        filesystem: "remote-workdir-scope",
        network: "ssh-target-policy",
        process: "remote-session",
      };
    case "host":
      return {
        filesystem: "host-explicit",
        network: networkEnforcementForPolicy(networkPolicy),
        process: "host-process",
      };
    case "readonly":
    case "workspace-write":
      return {
        filesystem: "process-cwd-scope",
        network: "none",
        process: "in-process-adapter",
      };
    case "network-limited":
      return {
        filesystem: "process-cwd-scope",
        network: "policy-declared",
        process: "in-process-adapter",
      };
    case "disabled":
      return {
        filesystem: "none",
        network: "none",
        process: "in-process-adapter",
      };
  }
}

function createSandboxCommandBlockedResult(
  plan: AgentOsSandboxReadyExecutionPlan,
  admission: AgentOsSandboxBackendAdmission,
  error: NonNullable<AgentOsSandboxCommandExecutionResult["error"]>,
  reason: string,
): AgentOsSandboxCommandExecutionResult {
  const providerId = admission.providerId ?? createDefaultSandboxProviderId(plan.backend);
  return {
    ok: false,
    status: "blocked",
    backend: plan.backend,
    providerId,
    admission,
    error,
    reason,
    evidence: createCommandExecutionEvidence({
      plan,
      admission,
      providerId,
    }),
  };
}

function createDefaultSandboxProviderId(backend: AgentOsSandboxMode): string {
  return `agent-os-sandbox.${backend}`;
}

function createCommandExecutionEvidence(input: {
  readonly plan: AgentOsSandboxReadyExecutionPlan;
  readonly admission: AgentOsSandboxBackendAdmission;
  readonly providerId: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
  readonly artifacts?: readonly AgentOsSandboxCommandArtifact[];
}): AgentOsSandboxCommandExecutionEvidence {
  const process = normalizeProcessEvidence(input.process);
  return {
    backend: input.plan.backend,
    providerId: input.providerId,
    planHash: input.admission.planHash ?? createAgentOsSandboxPlanHash(input.plan),
    ...(input.plan.command === undefined
      ? {}
      : { commandHash: createStableHash(input.plan.command) }),
    ...(input.plan.cwd === undefined ? {} : { cwd: input.plan.cwd }),
    networkPolicy: input.admission.networkPolicy ?? input.plan.networkPolicy,
    filesystem: input.admission.filesystem ?? {
      readableRoots: input.plan.readableRoots,
      writableRoots: input.plan.writableRoots,
    },
    ...(input.admission.enforcement === undefined
      ? {}
      : { enforcement: input.admission.enforcement }),
    ...(input.admission.backendConfig === undefined
      ? {}
      : { backendConfig: input.admission.backendConfig }),
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
    ...(input.exitCode === undefined ? {} : { exitCode: input.exitCode }),
    ...(input.stdout === undefined ? {} : { stdoutSummary: summarizeText(input.stdout) }),
    ...(input.stderr === undefined ? {} : { stderrSummary: summarizeText(input.stderr) }),
    ...(process === undefined ? {} : { process }),
    ...(input.artifacts === undefined ? {} : { artifacts: input.artifacts }),
  };
}

function processEvidenceProperty(result: {
  readonly process?: AgentOsProcessCapabilityProcessEvidence;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): { readonly process?: AgentOsProcessCapabilityProcessEvidence } {
  const process = normalizeProcessEvidence(result.process ?? readRecord(result.metadata)?.process);
  return process === undefined ? {} : { process };
}

function createAgentOsProcessCapabilityLedgerEntry(
  source: AgentOsProcessCapabilityLedgerSourceEntry,
): AgentOsProcessCapabilityLedgerEntry {
  const plan = source.plan;
  const readyPlan = plan?.ok === true ? plan : undefined;
  const riskSummary = plan?.riskSummary;
  const evidence = source.execution?.evidence ?? source.evidence;
  const admission = source.execution?.admission ?? source.admission;
  const backendConfig = readRecord(evidence?.backendConfig ?? admission?.backendConfig);
  const commandPattern = readCommandPattern(backendConfig?.commandPattern);
  const commandPrefix =
    typeof backendConfig?.commandPrefix === "string" ? backendConfig.commandPrefix : undefined;
  const backend =
    evidence?.backend ?? admission?.backend ?? readyPlan?.backend ?? riskSummary?.sandboxMode;
  const cwd = evidence?.cwd ?? admission?.cwd ?? readyPlan?.cwd ?? riskSummary?.filesystem.cwd;
  const networkPolicy =
    evidence?.networkPolicy ?? admission?.networkPolicy ?? readyPlan?.networkPolicy;
  const enforcement = evidence?.enforcement ?? admission?.enforcement;
  const command = readyPlan?.command ?? riskSummary?.command;
  const planHash = evidence?.planHash ?? admission?.planHash;
  const process = source.process ?? evidence?.process ?? source.execution?.process;
  return {
    owner: source.owner,
    runnerKind: source.runnerKind,
    ...(riskSummary?.toolName === undefined ? {} : { toolName: riskSummary.toolName }),
    ...(riskSummary?.operationId === undefined ? {} : { operationId: riskSummary.operationId }),
    ...(riskSummary?.providerId === undefined ? {} : { providerId: riskSummary.providerId }),
    ...(backend === undefined ? {} : { backend }),
    status: resolveProcessCapabilityLedgerStatus(source),
    ...(cwd === undefined ? {} : { cwd }),
    readableRoots:
      evidence?.filesystem?.readableRoots ??
      admission?.filesystem?.readableRoots ??
      readyPlan?.readableRoots ??
      riskSummary?.filesystem.readableRoots ??
      [],
    writableRoots:
      evidence?.filesystem?.writableRoots ??
      admission?.filesystem?.writableRoots ??
      readyPlan?.writableRoots ??
      riskSummary?.filesystem.writableRoots ??
      [],
    ...(networkPolicy === undefined ? {} : { networkPolicy }),
    ...(enforcement === undefined ? {} : { enforcement }),
    ...(command === undefined ? {} : { command }),
    ...(commandPrefix === undefined ? {} : { commandPrefix }),
    ...(commandPattern === undefined ? {} : { commandPattern }),
    ...(planHash === undefined ? {} : { planHash }),
    ...(evidence?.commandHash === undefined ? {} : { commandHash: evidence.commandHash }),
    ...(evidence?.startedAt === undefined ? {} : { startedAt: evidence.startedAt }),
    ...(evidence?.completedAt === undefined ? {} : { completedAt: evidence.completedAt }),
    ...(evidence?.exitCode === undefined ? {} : { exitCode: evidence.exitCode }),
    ...(evidence?.stdoutSummary === undefined ? {} : { stdoutSummary: evidence.stdoutSummary }),
    ...(evidence?.stderrSummary === undefined ? {} : { stderrSummary: evidence.stderrSummary }),
    ...(evidence?.artifacts === undefined ? {} : { artifacts: evidence.artifacts }),
    ...(process === undefined ? {} : { process }),
  };
}

function resolveProcessCapabilityLedgerStatus(
  source: AgentOsProcessCapabilityLedgerSourceEntry,
): AgentOsProcessCapabilityLedgerEntry["status"] {
  if (source.execution !== undefined) {
    return source.execution.status;
  }
  if (source.admission !== undefined) {
    return source.admission.ok ? "admitted" : "blocked";
  }
  if (source.plan !== undefined) {
    return source.plan.ok ? "planned" : "blocked";
  }
  return "planned";
}

function createAgentOsSandboxPlanHash(plan: AgentOsSandboxReadyExecutionPlan): string {
  return createStableHash({
    backend: plan.backend,
    command: plan.command ?? "",
    argv: plan.argv ?? [],
    env: plan.env ?? {},
    cwd: plan.cwd ?? "",
    networkPolicy: plan.networkPolicy,
    readableRoots: plan.readableRoots,
    writableRoots: plan.writableRoots,
  });
}

function createStableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function summarizeText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) {
    return normalized;
  }
  return `${normalized.slice(0, 237)}...`;
}

function networkEnforcementForPolicy(
  policy: AgentOsSandboxNetworkPolicy,
): AgentOsSandboxBackendAdmissionEnforcement["network"] {
  switch (policy) {
    case "full":
      return "network-full";
    case "limited":
      return "network-limited";
    case "none":
      return "network-none";
  }
}

function hasCommandPatterns(
  patterns: readonly AgentOsSandboxAllowedCommandPattern[] | undefined,
): boolean {
  return normalizeCommandPatterns(patterns).length > 0;
}

function findAllowedCommandPattern(
  plan: AgentOsSandboxReadyExecutionPlan,
  patterns: readonly AgentOsSandboxAllowedCommandPattern[] | undefined,
): AgentOsSandboxAllowedCommandPattern | undefined {
  const command = parseCommandForSandbox(plan.command ?? "", plan.argv);
  if (command === undefined) {
    return undefined;
  }
  const normalizedOperationId = normalizeCommand(plan.riskSummary.operationId);
  return normalizeCommandPatterns(patterns).find((pattern) => {
    if (command.executable !== pattern.executable) {
      return false;
    }
    if (pattern.operationId !== undefined && pattern.operationId !== normalizedOperationId) {
      return false;
    }
    if (pattern.argv === undefined) {
      return true;
    }
    return areStringArraysEqual(command.argv, pattern.argv);
  });
}

function hasLegacyCommandPrefixes(prefixes: readonly string[] | undefined): boolean {
  return (prefixes ?? []).some((prefix) => normalizeCommand(prefix).length > 0);
}

function readLegacyAllowedCommandPrefixes(options: unknown): readonly string[] | undefined {
  const value = (options as { readonly allowedCommandPrefixes?: unknown }).allowedCommandPrefixes;
  return Array.isArray(value) && value.length > 0 ? value.map(String) : undefined;
}

function normalizeCommandPatterns(
  patterns: readonly AgentOsSandboxAllowedCommandPattern[] | undefined,
): AgentOsSandboxAllowedCommandPattern[] {
  const normalized: AgentOsSandboxAllowedCommandPattern[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns ?? []) {
    const executable = normalizeCommand(pattern.executable);
    if (executable.length === 0 || /\s/u.test(executable)) {
      continue;
    }
    const argv =
      pattern.argv === undefined
        ? undefined
        : pattern.argv.map((value) => String(value)).filter((value) => value.length > 0);
    const operationId = normalizeCommand(pattern.operationId);
    const normalizedPattern: AgentOsSandboxAllowedCommandPattern = {
      executable,
      ...(argv === undefined ? {} : { argv }),
      ...(operationId.length === 0 ? {} : { operationId }),
    };
    const key = stableStringify(normalizedPattern);
    if (!seen.has(key)) {
      normalized.push(normalizedPattern);
      seen.add(key);
    }
  }
  return normalized;
}

function readCommandPattern(value: unknown): AgentOsSandboxAllowedCommandPattern | undefined {
  const record = readRecord(value);
  if (record === undefined || typeof record.executable !== "string") {
    return undefined;
  }
  const executable = normalizeCommand(record.executable);
  if (executable.length === 0) {
    return undefined;
  }
  const argv = Array.isArray(record.argv)
    ? record.argv.filter((item): item is string => typeof item === "string")
    : undefined;
  const operationId =
    typeof record.operationId === "string" ? normalizeCommand(record.operationId) : undefined;
  return {
    executable,
    ...(argv === undefined ? {} : { argv }),
    ...(operationId === undefined || operationId.length === 0 ? {} : { operationId }),
  };
}

function normalizeProcessEvidence(
  value: unknown,
): AgentOsProcessCapabilityProcessEvidence | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const pid =
    typeof record.pid === "number" && Number.isFinite(record.pid) ? record.pid : undefined;
  const signal =
    typeof record.signal === "string" && record.signal.trim().length > 0
      ? record.signal.trim()
      : record.signal === null
        ? null
        : undefined;
  const ownedProcess = typeof record.ownedProcess === "boolean" ? record.ownedProcess : undefined;
  const terminationReason =
    typeof record.terminationReason === "string" && record.terminationReason.trim().length > 0
      ? record.terminationReason.trim()
      : undefined;
  const signals = normalizeProcessSignalEvidence(record.signals);
  if (
    pid === undefined &&
    signal === undefined &&
    ownedProcess === undefined &&
    terminationReason === undefined &&
    signals === undefined
  ) {
    return undefined;
  }
  return {
    ...(pid === undefined ? {} : { pid }),
    ...(signal === undefined ? {} : { signal }),
    ...(signals === undefined ? {} : { signals }),
    ...(ownedProcess === undefined ? {} : { ownedProcess }),
    ...(terminationReason === undefined ? {} : { terminationReason }),
  };
}

function normalizeProcessSignalEvidence(
  value: unknown,
): readonly AgentOsProcessCapabilitySignalEvidence[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const signals = value.flatMap((item) => {
    const record = readRecord(item);
    const signal = typeof record?.signal === "string" ? record.signal.trim() : "";
    if (signal.length === 0) {
      return [];
    }
    const reason =
      typeof record?.reason === "string" && record.reason.trim().length > 0
        ? record.reason.trim()
        : undefined;
    const sentAt =
      typeof record?.sentAt === "string" && record.sentAt.trim().length > 0
        ? record.sentAt.trim()
        : undefined;
    return [
      {
        signal,
        ...(reason === undefined ? {} : { reason }),
        ...(sentAt === undefined ? {} : { sentAt }),
      },
    ];
  });
  return signals.length === 0 ? undefined : signals;
}

function createLiveRunnerAdmissionIssues(
  evidence: AgentOsLiveRunnerAdmissionEvidence,
): readonly AgentOsLiveRunnerAdmissionIssue[] {
  const issues: AgentOsLiveRunnerAdmissionIssue[] = [];
  if (!evidence.operatorScopeGranted) {
    issues.push("operator-scope-missing");
  }
  if (!evidence.sandboxAdmitted) {
    issues.push("sandbox-admission-missing");
  }
  if (!evidence.providerConfigured) {
    issues.push("provider-config-missing");
  }
  if (!evidence.credentialsConfigured) {
    issues.push("credentials-config-missing");
  }
  if (!evidence.networkPolicyGranted) {
    issues.push("network-policy-missing");
  }
  if (!evidence.dataPolicyAccepted) {
    issues.push("data-policy-missing");
  }
  if (!evidence.auditArtifactReady) {
    issues.push("audit-artifact-missing");
  }
  if (!evidence.cancellationSupported) {
    issues.push("runner-cancellation-missing");
  }
  if (evidence.microphonePermissionGranted === false) {
    issues.push("microphone-permission-missing");
  }
  if (evidence.speakerPermissionGranted === false) {
    issues.push("speaker-permission-missing");
  }
  if (evidence.rawAudioStoragePolicyAccepted === false) {
    issues.push("raw-audio-storage-policy-missing");
  }
  if (evidence.providerRuntimeConfigured === false) {
    issues.push("provider-runtime-config-missing");
  }
  if (evidence.localAudioProcessAllowed === false) {
    issues.push("local-audio-process-not-allowed");
  }
  if (!evidence.runnerIntentTokenIssued) {
    issues.push("runner-intent-token-missing");
  }
  if (!evidence.runnerIntentSigned) {
    issues.push("runner-intent-not-signed");
  }
  if (!evidence.runnerIntentUnlocked) {
    issues.push("runner-intent-not-unlocked");
  }
  if (evidence.runnerIntentRevocationStatus !== "active") {
    issues.push("runner-intent-revoked");
  }
  return issues;
}

function createLiveRunnerSessionId(
  admission: AgentOsLiveRunnerAdmissionPacket,
  startedAt: string,
): string {
  const digest = createHash("sha256")
    .update(`${admission.runnerId}\n${admission.providerId}\n${startedAt}`)
    .digest("hex")
    .slice(0, 16);
  return `agent-os-live-runner:${digest}`;
}

function normalizeCommand(command: string | undefined): string {
  return (command ?? "").trim().replace(/\s+/g, " ");
}

function normalizeConfigString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function parseCommandForSandbox(
  command: string,
  structuredArgv: readonly string[] | undefined,
): { readonly executable: string; readonly argv: readonly string[] } | undefined {
  const normalized = normalizeCommand(command);
  if (normalized.length === 0) {
    return undefined;
  }
  const [executable, ...argv] = normalized.split(" ");
  if (executable === undefined || executable.length === 0) {
    return undefined;
  }
  return { executable, argv: structuredArgv ?? argv };
}

function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPromiseLike<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}

function isPathInsideRoot(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizeRoots(roots: readonly string[] | undefined): readonly string[] {
  return [...new Set((roots ?? []).map(normalizePath).filter((root) => root.length > 0))];
}

function normalizePath(path: string): string {
  const collapsed = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (collapsed === "") {
    return "";
  }
  const normalized = pathPosix.normalize(collapsed);
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function defaultNetworkPolicyForMode(sandboxMode: AgentOsSandboxMode): AgentOsSandboxNetworkPolicy {
  switch (sandboxMode) {
    case "network-limited":
      return "limited";
    case "host":
    case "ssh":
      return "full";
    default:
      return "none";
  }
}
