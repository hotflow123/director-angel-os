import {
  isArrayOf,
  isBoolean,
  isNumber,
  isObject,
  isOneOf,
  isOptional,
  isString,
  isStringArray,
} from "./guards.js";

export const AGENT_OS_KERNEL_SCHEMA_VERSION = "agent-os.kernel.v1";

export const AGENT_OS_ACTOR_KINDS = [
  "user",
  "assistant",
  "tool",
  "skill",
  "subagent",
  "system",
  "operator",
  "heartbeat",
] as const;
export const AGENT_OS_TRUST_LEVELS = [
  "system",
  "trusted-local",
  "paired-channel",
  "untrusted-remote",
] as const;
export const AGENT_OS_TURN_KINDS = [
  "user-message",
  "slash-command",
  "control-command",
  "heartbeat",
  "interrupt",
  "subagent-task",
] as const;
export const AGENT_OS_ROUTE_KINDS = ["direct", "thread", "group", "broadcast"] as const;
export const AGENT_OS_DELIVERY_TARGET_KINDS = ["desktop", "channel", "host", "none"] as const;
export const AGENT_OS_PERMISSION_MODES = ["allow", "ask", "deny", "plan-only"] as const;
export const AGENT_OS_APPROVAL_BOUNDARIES = [
  "none",
  "all-tools",
  "mutating-tools",
  "unsafe-only",
] as const;
export const AGENT_OS_REMOTE_UNSAFE_COMMAND_POLICIES = ["block", "ask", "allow"] as const;
export const AGENT_OS_MEMORY_LAYERS = ["L0", "L1", "L2", "L3"] as const;
export const AGENT_OS_MEMORY_LANES = ["session", "user", "project", "global"] as const;
export const AGENT_OS_NETWORK_POLICIES = ["disabled", "limited", "enabled"] as const;
export const AGENT_OS_QUEUE_LANES = ["session", "global"] as const;
export const AGENT_OS_QUEUE_MODES = [
  "enqueue",
  "steer",
  "collect",
  "followup",
  "interrupt",
  "debounce",
  "cap",
] as const;
export const AGENT_OS_QUEUE_DROP_POLICIES = [
  "none",
  "summarize",
  "drop:old",
  "drop:new",
  "reject",
] as const;
export const AGENT_OS_POLICY_VERDICTS = [
  "allow",
  "deny",
  "needs_approval",
  "needs_setup",
  "blocked",
  "degraded",
] as const;
export const AGENT_OS_SANDBOX_MODES = [
  "host",
  "readonly",
  "workspace-write",
  "network-limited",
  "docker",
  "ssh",
  "disabled",
] as const;
export const AGENT_OS_TOOL_VISIBILITIES = ["model-visible", "hidden", "operator-only"] as const;
export const AGENT_OS_SKILL_LIFECYCLES = [
  "proposed",
  "needs-setup",
  "approved",
  "active",
  "deprecated",
  "archived",
  "missing",
] as const;
export const AGENT_OS_APPROVAL_STATUSES = [
  "requested",
  "approved",
  "denied",
  "expired",
  "cancelled",
] as const;
export const AGENT_OS_TRAJECTORY_STEP_KINDS = [
  "model",
  "tool",
  "approval",
  "memory",
  "skill",
  "subagent",
  "final",
] as const;
export const AGENT_OS_SUBAGENT_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "blocked",
] as const;
export const AGENT_OS_CONTROL_PLANE_EVENT_KINDS = [
  "doctor",
  "health",
  "log",
  "config",
  "secrets",
  "usage",
  "cost",
  "gateway-lock",
  "operator-scope",
] as const;
export const AGENT_OS_TURN_STATES = [
  "received",
  "queued",
  "preflight",
  "context_resolved",
  "model_calling",
  "tool_calling",
  "awaiting_approval",
  "observing",
  "delegating",
  "finalizing",
  "completed",
  "blocked",
  "failed",
] as const;
export const AGENT_OS_TIMELINE_EVENT_TYPES = [
  "state.transition",
  "queue.decision",
  "capability.projected",
  "model.call",
  "model.result",
  "tool.start",
  "tool.progress",
  "tool.result",
  "approval.requested",
  "approval.resolved",
  "sandbox.preflight",
  "memory.recall",
  "memory.eval",
  "memory.store",
  "memory.sweep",
  "skill.viewed",
  "skill.used",
  "skill.evolved",
  "subagent.spawned",
  "subagent.message",
  "subagent.finished",
  "control.doctor",
  "control.health",
  "control.log",
  "control.config",
  "control.secrets",
  "control.cost",
  "control.gateway_lock",
  "final.delivered",
] as const;

export type AgentOsActorKind = (typeof AGENT_OS_ACTOR_KINDS)[number];
export type AgentOsTrustLevel = (typeof AGENT_OS_TRUST_LEVELS)[number];
export type AgentOsTurnKind = (typeof AGENT_OS_TURN_KINDS)[number];
export type AgentOsRouteKind = (typeof AGENT_OS_ROUTE_KINDS)[number];
export type AgentOsDeliveryTargetKind = (typeof AGENT_OS_DELIVERY_TARGET_KINDS)[number];
export type AgentOsPermissionMode = (typeof AGENT_OS_PERMISSION_MODES)[number];
export type AgentOsApprovalBoundary = (typeof AGENT_OS_APPROVAL_BOUNDARIES)[number];
export type AgentOsRemoteUnsafeCommandPolicy =
  (typeof AGENT_OS_REMOTE_UNSAFE_COMMAND_POLICIES)[number];
export type AgentOsMemoryLayer = (typeof AGENT_OS_MEMORY_LAYERS)[number];
export type AgentOsMemoryLane = (typeof AGENT_OS_MEMORY_LANES)[number];
export type AgentOsNetworkPolicy = (typeof AGENT_OS_NETWORK_POLICIES)[number];
export type AgentOsQueueLane = (typeof AGENT_OS_QUEUE_LANES)[number];
export type AgentOsQueueMode = (typeof AGENT_OS_QUEUE_MODES)[number];
export type AgentOsQueueDropPolicy = (typeof AGENT_OS_QUEUE_DROP_POLICIES)[number];
export type AgentOsPolicyVerdictValue = (typeof AGENT_OS_POLICY_VERDICTS)[number];
export type AgentOsSandboxMode = (typeof AGENT_OS_SANDBOX_MODES)[number];
export type AgentOsToolVisibility = (typeof AGENT_OS_TOOL_VISIBILITIES)[number];
export type AgentOsSkillLifecycle = (typeof AGENT_OS_SKILL_LIFECYCLES)[number];
export type AgentOsApprovalStatus = (typeof AGENT_OS_APPROVAL_STATUSES)[number];
export type AgentOsTrajectoryStepKind = (typeof AGENT_OS_TRAJECTORY_STEP_KINDS)[number];
export type AgentOsSubagentStatus = (typeof AGENT_OS_SUBAGENT_STATUSES)[number];
export type AgentOsControlPlaneEventKind = (typeof AGENT_OS_CONTROL_PLANE_EVENT_KINDS)[number];
export type AgentOsTurnState = (typeof AGENT_OS_TURN_STATES)[number];
export type AgentOsTimelineEventType = (typeof AGENT_OS_TIMELINE_EVENT_TYPES)[number];

export interface AgentOsActorEnvelope {
  readonly actorId: string;
  readonly kind: AgentOsActorKind;
  readonly trustLevel: AgentOsTrustLevel;
  readonly displayName?: string;
  readonly parentActorId?: string;
}

export interface AgentOsDeliveryTarget {
  readonly kind: AgentOsDeliveryTargetKind;
  readonly targetId: string;
  readonly channel?: string;
  readonly threadId?: string;
}

export interface AgentOsChannelEnvelope {
  readonly adapterId: string;
  readonly channel: string;
  readonly routeKind: AgentOsRouteKind;
  readonly sourceId: string;
  readonly threadId?: string;
  readonly deliveryTarget: AgentOsDeliveryTarget;
}

export interface AgentOsPermissionContext {
  readonly mode: AgentOsPermissionMode;
  readonly approvalBoundary: AgentOsApprovalBoundary;
  readonly operatorScopes: readonly string[];
  readonly remoteUnsafeCommandPolicy: AgentOsRemoteUnsafeCommandPolicy;
}

export interface AgentOsMemoryScope {
  readonly lane: AgentOsMemoryLane;
  readonly localOnly: boolean;
  readonly enabledLayers: readonly AgentOsMemoryLayer[];
  readonly evidenceRequired: boolean;
}

export interface AgentOsWorkspaceScope {
  readonly workspaceId: string;
  readonly root: string;
  readonly writableRoots: readonly string[];
  readonly readonlyRoots: readonly string[];
  readonly networkPolicy: AgentOsNetworkPolicy;
}

export interface AgentOsBudgetEnvelope {
  readonly maxModelCalls?: number;
  readonly maxToolCalls?: number;
  readonly maxCostUsd?: number;
  readonly modelHints?: readonly string[];
}

export interface AgentOsQueueDirective {
  readonly lane: AgentOsQueueLane;
  readonly mode: AgentOsQueueMode;
  readonly dropPolicy?: AgentOsQueueDropPolicy;
  readonly cap?: number;
  readonly priority?: number;
}

export interface AgentOsPolicyVerdict {
  readonly verdict: AgentOsPolicyVerdictValue;
  readonly reason: string;
  readonly decidedAt: string;
  readonly policyId?: string;
  readonly approvalId?: string;
}

export interface AgentOsSandboxPreflight {
  readonly verdict: AgentOsPolicyVerdictValue;
  readonly sandboxMode: AgentOsSandboxMode;
  readonly checkedAt: string;
  readonly providerId?: string;
  readonly reason?: string;
}

export interface AgentOsApprovalLifecycleEvent {
  readonly approvalId: string;
  readonly turnId: string;
  readonly status: AgentOsApprovalStatus;
  readonly createdAt: string;
  readonly decidedAt?: string;
  readonly reason?: string;
}

export interface AgentOsToolProjection {
  readonly toolName: string;
  readonly visibility: AgentOsToolVisibility;
  readonly readOnly: boolean;
  readonly providerId: string;
  readonly policyVerdict: AgentOsPolicyVerdict;
  readonly sandboxPreflight: AgentOsSandboxPreflight;
  readonly hiddenReason?: string;
  readonly capabilityIds?: readonly string[];
}

export interface AgentOsSkillToolContract {
  readonly skillId: string;
  readonly skillVersion: string;
  readonly lifecycle: AgentOsSkillLifecycle;
  readonly modelVisible: boolean;
  readonly needsSetup: boolean;
  readonly requiredTools: readonly string[];
  readonly missingTools: readonly string[];
  readonly permissionVerdict: AgentOsPolicyVerdict;
}

export interface AgentOsSubagentEnvelope {
  readonly subagentId: string;
  readonly parentTurnId: string;
  readonly profileId: string;
  readonly permissions: readonly string[];
  readonly tools: readonly string[];
  readonly writableRoots: readonly string[];
  readonly memoryLayers: readonly AgentOsMemoryLayer[];
  readonly maxTurns: number;
  readonly delegationRequestId?: string;
  readonly task?: string;
  readonly expectedOutput?: string;
  readonly isolatedContext?: boolean;
  readonly status?: AgentOsSubagentStatus;
  readonly createdAt?: string;
  readonly budget?: AgentOsBudgetEnvelope;
  readonly artifactsRequested?: readonly string[];
}

export interface AgentOsSubagentProfile {
  readonly profileId: string;
  readonly role: string;
  readonly instructions: string;
  readonly permissions: readonly string[];
  readonly tools: readonly string[];
  readonly writableRoots: readonly string[];
  readonly memoryLayers: readonly AgentOsMemoryLayer[];
  readonly maxTurns: number;
  readonly budget?: AgentOsBudgetEnvelope;
}

export interface AgentOsAgentToolDelegationRequest {
  readonly requestId: string;
  readonly parentTurnId: string;
  readonly task: string;
  readonly expectedOutput: string;
  readonly allowedTools?: readonly string[];
  readonly allowedPermissions?: readonly string[];
  readonly writableRoots?: readonly string[];
  readonly memoryLayers?: readonly AgentOsMemoryLayer[];
  readonly maxTurns?: number;
  readonly artifactsRequested?: readonly string[];
}

export interface AgentOsSubagentArtifact {
  readonly artifactId: string;
  readonly kind: string;
  readonly label: string;
  readonly uri: string;
  readonly parentVisible: boolean;
}

export interface AgentOsParentVisibleSubagentResult {
  readonly subagentId: string;
  readonly parentTurnId: string;
  readonly delegationRequestId?: string;
  readonly profileId: string;
  readonly status: AgentOsSubagentStatus;
  readonly summary: string;
  readonly artifacts: readonly AgentOsSubagentArtifact[];
  readonly completedAt: string;
}

export interface AgentOsMemoryProvenance {
  readonly sourceId: string;
  readonly sourceKind: string;
  readonly recordedAt: string;
  readonly localOnly: boolean;
}

export interface AgentOsMemoryEvidence {
  readonly evidenceId: string;
  readonly layer: AgentOsMemoryLayer;
  readonly backend: string;
  readonly retrievalEngine: string;
  readonly matchMode: string;
  readonly citation: string;
  readonly verbatim?: string;
  readonly score?: number;
  readonly provenance: AgentOsMemoryProvenance;
}

export interface AgentOsTrajectoryStep {
  readonly stepId: string;
  readonly turnId: string;
  readonly kind: AgentOsTrajectoryStepKind;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly outcome: "ok" | "failed" | "blocked" | "degraded";
  readonly evidenceIds: readonly string[];
  readonly failureTaxonomy?: readonly string[];
}

export interface AgentOsControlPlaneEvent {
  readonly eventId: string;
  readonly kind: AgentOsControlPlaneEventKind;
  readonly createdAt: string;
  readonly status: "ready" | "problem" | "blocked" | "degraded" | "unknown";
  readonly summary: string;
}

export interface AgentOsTurnEnvelope {
  readonly schemaVersion: typeof AGENT_OS_KERNEL_SCHEMA_VERSION;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly turnKind: AgentOsTurnKind;
  readonly createdAt: string;
  readonly actor: AgentOsActorEnvelope;
  readonly channel: AgentOsChannelEnvelope;
  readonly permissionContext: AgentOsPermissionContext;
  readonly memoryScope: AgentOsMemoryScope;
  readonly workspaceScope: AgentOsWorkspaceScope;
  readonly budget?: AgentOsBudgetEnvelope;
  readonly queueDirective?: AgentOsQueueDirective;
  readonly policyVerdict: AgentOsPolicyVerdict;
  readonly sandboxPreflight: AgentOsSandboxPreflight;
  readonly parentTurnId?: string;
}

export function isAgentOsActorEnvelope(value: unknown): value is AgentOsActorEnvelope {
  return (
    isObject(value) &&
    isString(value.actorId) &&
    isOneOf(value.kind, AGENT_OS_ACTOR_KINDS) &&
    isOneOf(value.trustLevel, AGENT_OS_TRUST_LEVELS) &&
    isOptional(value.displayName, isString) &&
    isOptional(value.parentActorId, isString)
  );
}

export function isAgentOsDeliveryTarget(value: unknown): value is AgentOsDeliveryTarget {
  return (
    isObject(value) &&
    isOneOf(value.kind, AGENT_OS_DELIVERY_TARGET_KINDS) &&
    isString(value.targetId) &&
    isOptional(value.channel, isString) &&
    isOptional(value.threadId, isString) &&
    (value.kind !== "channel" || isString(value.channel))
  );
}

export function isAgentOsChannelEnvelope(value: unknown): value is AgentOsChannelEnvelope {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isString(value.channel) &&
    isOneOf(value.routeKind, AGENT_OS_ROUTE_KINDS) &&
    isString(value.sourceId) &&
    isOptional(value.threadId, isString) &&
    isAgentOsDeliveryTarget(value.deliveryTarget)
  );
}

export function isAgentOsPermissionContext(value: unknown): value is AgentOsPermissionContext {
  return (
    isObject(value) &&
    isOneOf(value.mode, AGENT_OS_PERMISSION_MODES) &&
    isOneOf(value.approvalBoundary, AGENT_OS_APPROVAL_BOUNDARIES) &&
    isStringArray(value.operatorScopes) &&
    isOneOf(value.remoteUnsafeCommandPolicy, AGENT_OS_REMOTE_UNSAFE_COMMAND_POLICIES)
  );
}

export function isAgentOsMemoryScope(value: unknown): value is AgentOsMemoryScope {
  return (
    isObject(value) &&
    isOneOf(value.lane, AGENT_OS_MEMORY_LANES) &&
    isBoolean(value.localOnly) &&
    isArrayOf(value.enabledLayers, isAgentOsMemoryLayer) &&
    isBoolean(value.evidenceRequired)
  );
}

export function isAgentOsWorkspaceScope(value: unknown): value is AgentOsWorkspaceScope {
  return (
    isObject(value) &&
    isString(value.workspaceId) &&
    isString(value.root) &&
    isStringArray(value.writableRoots) &&
    isStringArray(value.readonlyRoots) &&
    isOneOf(value.networkPolicy, AGENT_OS_NETWORK_POLICIES)
  );
}

export function isAgentOsBudgetEnvelope(value: unknown): value is AgentOsBudgetEnvelope {
  return (
    isObject(value) &&
    isOptional(value.maxModelCalls, isNumber) &&
    isOptional(value.maxToolCalls, isNumber) &&
    isOptional(value.maxCostUsd, isNumber) &&
    isOptional(value.modelHints, isStringArray)
  );
}

export function isAgentOsQueueDirective(value: unknown): value is AgentOsQueueDirective {
  return (
    isObject(value) &&
    isOneOf(value.lane, AGENT_OS_QUEUE_LANES) &&
    isOneOf(value.mode, AGENT_OS_QUEUE_MODES) &&
    isOptional(value.dropPolicy, isAgentOsQueueDropPolicy) &&
    isOptional(value.cap, isNumber) &&
    isOptional(value.priority, isNumber)
  );
}

export function isAgentOsPolicyVerdict(value: unknown): value is AgentOsPolicyVerdict {
  return (
    isObject(value) &&
    isOneOf(value.verdict, AGENT_OS_POLICY_VERDICTS) &&
    isString(value.reason) &&
    isString(value.decidedAt) &&
    isOptional(value.policyId, isString) &&
    isOptional(value.approvalId, isString)
  );
}

export function isAgentOsSandboxPreflight(value: unknown): value is AgentOsSandboxPreflight {
  return (
    isObject(value) &&
    isOneOf(value.verdict, AGENT_OS_POLICY_VERDICTS) &&
    isOneOf(value.sandboxMode, AGENT_OS_SANDBOX_MODES) &&
    isString(value.checkedAt) &&
    isOptional(value.providerId, isString) &&
    isOptional(value.reason, isString)
  );
}

export function isAgentOsApprovalLifecycleEvent(
  value: unknown,
): value is AgentOsApprovalLifecycleEvent {
  return (
    isObject(value) &&
    isString(value.approvalId) &&
    isString(value.turnId) &&
    isOneOf(value.status, AGENT_OS_APPROVAL_STATUSES) &&
    isString(value.createdAt) &&
    isOptional(value.decidedAt, isString) &&
    isOptional(value.reason, isString)
  );
}

export function isAgentOsToolProjection(value: unknown): value is AgentOsToolProjection {
  return (
    isObject(value) &&
    isString(value.toolName) &&
    isOneOf(value.visibility, AGENT_OS_TOOL_VISIBILITIES) &&
    isBoolean(value.readOnly) &&
    isString(value.providerId) &&
    isAgentOsPolicyVerdict(value.policyVerdict) &&
    isAgentOsSandboxPreflight(value.sandboxPreflight) &&
    isOptional(value.hiddenReason, isString) &&
    isOptional(value.capabilityIds, isStringArray)
  );
}

export function isAgentOsSkillToolContract(value: unknown): value is AgentOsSkillToolContract {
  return (
    isObject(value) &&
    isString(value.skillId) &&
    isString(value.skillVersion) &&
    isOneOf(value.lifecycle, AGENT_OS_SKILL_LIFECYCLES) &&
    isBoolean(value.modelVisible) &&
    isBoolean(value.needsSetup) &&
    isStringArray(value.requiredTools) &&
    isStringArray(value.missingTools) &&
    isAgentOsPolicyVerdict(value.permissionVerdict)
  );
}

export function isAgentOsSubagentEnvelope(value: unknown): value is AgentOsSubagentEnvelope {
  return (
    isObject(value) &&
    isString(value.subagentId) &&
    isString(value.parentTurnId) &&
    isString(value.profileId) &&
    isStringArray(value.permissions) &&
    isStringArray(value.tools) &&
    isStringArray(value.writableRoots) &&
    isArrayOf(value.memoryLayers, isAgentOsMemoryLayer) &&
    isNumber(value.maxTurns) &&
    isOptional(value.delegationRequestId, isString) &&
    isOptional(value.task, isString) &&
    isOptional(value.expectedOutput, isString) &&
    isOptional(value.isolatedContext, isBoolean) &&
    isOptional(value.status, isAgentOsSubagentStatus) &&
    isOptional(value.createdAt, isString) &&
    isOptional(value.budget, isAgentOsBudgetEnvelope) &&
    isOptional(value.artifactsRequested, isStringArray)
  );
}

export function isAgentOsSubagentProfile(value: unknown): value is AgentOsSubagentProfile {
  return (
    isObject(value) &&
    isString(value.profileId) &&
    isString(value.role) &&
    isString(value.instructions) &&
    isStringArray(value.permissions) &&
    isStringArray(value.tools) &&
    isStringArray(value.writableRoots) &&
    isArrayOf(value.memoryLayers, isAgentOsMemoryLayer) &&
    isNumber(value.maxTurns) &&
    isOptional(value.budget, isAgentOsBudgetEnvelope)
  );
}

export function isAgentOsAgentToolDelegationRequest(
  value: unknown,
): value is AgentOsAgentToolDelegationRequest {
  return (
    isObject(value) &&
    isString(value.requestId) &&
    isString(value.parentTurnId) &&
    isString(value.task) &&
    isString(value.expectedOutput) &&
    isOptional(value.allowedTools, isStringArray) &&
    isOptional(value.allowedPermissions, isStringArray) &&
    isOptional(value.writableRoots, isStringArray) &&
    isOptional(value.memoryLayers, (candidate): candidate is readonly AgentOsMemoryLayer[] =>
      isArrayOf(candidate, isAgentOsMemoryLayer),
    ) &&
    isOptional(value.maxTurns, isNumber) &&
    isOptional(value.artifactsRequested, isStringArray)
  );
}

export function isAgentOsSubagentArtifact(value: unknown): value is AgentOsSubagentArtifact {
  return (
    isObject(value) &&
    isString(value.artifactId) &&
    isString(value.kind) &&
    isString(value.label) &&
    isString(value.uri) &&
    isBoolean(value.parentVisible)
  );
}

export function isAgentOsParentVisibleSubagentResult(
  value: unknown,
): value is AgentOsParentVisibleSubagentResult {
  return (
    isObject(value) &&
    isString(value.subagentId) &&
    isString(value.parentTurnId) &&
    isOptional(value.delegationRequestId, isString) &&
    isString(value.profileId) &&
    isAgentOsSubagentStatus(value.status) &&
    isString(value.summary) &&
    isArrayOf(value.artifacts, isAgentOsSubagentArtifact) &&
    isString(value.completedAt)
  );
}

export function isAgentOsMemoryProvenance(value: unknown): value is AgentOsMemoryProvenance {
  return (
    isObject(value) &&
    isString(value.sourceId) &&
    isString(value.sourceKind) &&
    isString(value.recordedAt) &&
    isBoolean(value.localOnly)
  );
}

export function isAgentOsMemoryEvidence(value: unknown): value is AgentOsMemoryEvidence {
  return (
    isObject(value) &&
    isString(value.evidenceId) &&
    isAgentOsMemoryLayer(value.layer) &&
    isString(value.backend) &&
    isString(value.retrievalEngine) &&
    isString(value.matchMode) &&
    isString(value.citation) &&
    isOptional(value.verbatim, isString) &&
    isOptional(value.score, isNumber) &&
    isAgentOsMemoryProvenance(value.provenance)
  );
}

export function isAgentOsTrajectoryStep(value: unknown): value is AgentOsTrajectoryStep {
  return (
    isObject(value) &&
    isString(value.stepId) &&
    isString(value.turnId) &&
    isOneOf(value.kind, AGENT_OS_TRAJECTORY_STEP_KINDS) &&
    isString(value.startedAt) &&
    isOptional(value.completedAt, isString) &&
    isOneOf(value.outcome, ["ok", "failed", "blocked", "degraded"] as const) &&
    isStringArray(value.evidenceIds) &&
    isOptional(value.failureTaxonomy, isStringArray)
  );
}

export function isAgentOsControlPlaneEvent(value: unknown): value is AgentOsControlPlaneEvent {
  return (
    isObject(value) &&
    isString(value.eventId) &&
    isOneOf(value.kind, AGENT_OS_CONTROL_PLANE_EVENT_KINDS) &&
    isString(value.createdAt) &&
    isOneOf(value.status, ["ready", "problem", "blocked", "degraded", "unknown"] as const) &&
    isString(value.summary)
  );
}

export const isAgentOsMemoryLayer = (value: unknown): value is AgentOsMemoryLayer =>
  isOneOf(value, AGENT_OS_MEMORY_LAYERS);

export const isAgentOsQueueDropPolicy = (value: unknown): value is AgentOsQueueDropPolicy =>
  isOneOf(value, AGENT_OS_QUEUE_DROP_POLICIES);

export const isAgentOsTurnState = (value: unknown): value is AgentOsTurnState =>
  isOneOf(value, AGENT_OS_TURN_STATES);

export const isAgentOsSubagentStatus = (value: unknown): value is AgentOsSubagentStatus =>
  isOneOf(value, AGENT_OS_SUBAGENT_STATUSES);

export const isAgentOsTimelineEventType = (value: unknown): value is AgentOsTimelineEventType =>
  isOneOf(value, AGENT_OS_TIMELINE_EVENT_TYPES);
