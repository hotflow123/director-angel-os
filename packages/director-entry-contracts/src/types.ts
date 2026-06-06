import {
  AGENT_OS_APPROVAL_BOUNDARIES,
  AGENT_OS_MEMORY_LANES,
  AGENT_OS_POLICY_VERDICTS,
  AGENT_OS_QUEUE_DROP_POLICIES,
  AGENT_OS_QUEUE_LANES,
  AGENT_OS_QUEUE_MODES,
  AGENT_OS_REMOTE_UNSAFE_COMMAND_POLICIES,
  AGENT_OS_SANDBOX_MODES,
  AGENT_OS_TIMELINE_EVENT_TYPES,
  AGENT_OS_TRUST_LEVELS,
  AGENT_OS_TURN_KINDS,
  AGENT_OS_TURN_STATES,
  type AgentOsApprovalBoundary,
  type AgentOsMemoryLane,
  type AgentOsPolicyVerdictValue,
  type AgentOsQueueDropPolicy,
  type AgentOsQueueLane,
  type AgentOsQueueMode,
  type AgentOsRemoteUnsafeCommandPolicy,
  type AgentOsSandboxMode,
  type AgentOsTimelineEventType,
  type AgentOsTrustLevel,
  type AgentOsTurnKind,
  type AgentOsTurnState,
} from "@hotflow/agent-os-kernel-contracts";
import {
  CONTRACTS_SCHEMA_VERSION,
  type ChannelRouteKind,
  type ChannelTransportEnvelope,
} from "@hotflow/contracts";
import {
  DIRECTOR_HOST_API_VERSION,
  type DirectorHostSnapshotEnvelope,
  type DirectorIntakePayload,
  type DirectorIntakeResponse,
  isDirectorHostSnapshotEnvelope,
  isDirectorIntakePayload,
  isDirectorIntakeResponse,
} from "@hotflow/director-host-contracts";

import { isArrayOf, isObject, isOneOf, isOptional, isString } from "./guards.js";

export const DIRECTOR_ENTRY_API_VERSION = "director-entry.v1";
export const DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION = "director.entry.session.v1";
export const DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID = "director.entry.agent-os-projection.v1";
export const DIRECTOR_ENTRY_ROUTE_KINDS = ["direct", "thread"] as const;
export const DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SOURCES = [
  "channel-transport",
  "entry-session",
] as const;
export const DIRECTOR_ENTRY_STATES = [
  "awaiting_input",
  "clarification_required",
  "ready_for_blueprint",
  "ready_for_run",
  "run_in_progress",
  "run_failed",
  "run_completed",
  "blocked",
] as const;
export const DIRECTOR_ENTRY_NEXT_ACTIONS = [
  "await_input",
  "clarify",
  "blueprint",
  "run",
  "wait",
  "review_report",
  "none",
] as const;
export const DIRECTOR_ENTRY_RUN_STATUSES = [
  "created",
  "running",
  "paused",
  "completed",
  "failed",
  "aborted",
] as const;

export type DirectorEntryRouteKind = (typeof DIRECTOR_ENTRY_ROUTE_KINDS)[number];
export type DirectorEntryAgentOsProjectionSource =
  (typeof DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SOURCES)[number];
export type DirectorEntryState = (typeof DIRECTOR_ENTRY_STATES)[number];
export type DirectorEntryNextAction = (typeof DIRECTOR_ENTRY_NEXT_ACTIONS)[number];
export type DirectorEntryRunStatus = (typeof DIRECTOR_ENTRY_RUN_STATUSES)[number];

export interface DirectorEntrySourceEnvelope {
  readonly hostId: string;
  readonly channel: string;
  readonly routeKind: DirectorEntryRouteKind;
  readonly sessionKey: string;
  readonly messageId: string;
  readonly receivedAt: string;
}

export interface DirectorEntryLineage {
  readonly sessionKey: string;
  readonly entrySessionId: string;
  readonly entryTurnId: string;
  readonly intakeId?: string;
  readonly alignmentLockId?: string;
  readonly blueprintId?: string;
  readonly runId?: string;
  readonly reportId?: string;
}

export interface DirectorEntryTurn {
  readonly entryTurnId: string;
  readonly messageId: string;
  readonly receivedAt: string;
  readonly state: DirectorEntryState;
  readonly nextAction: DirectorEntryNextAction;
  readonly summary: string;
  readonly lineage: DirectorEntryLineage;
  readonly clarificationPrompts?: readonly string[];
}

export interface DirectorEntryBlueprintPointer {
  readonly blueprintId: string;
  readonly handoffId: string;
  readonly recordedAt: string;
}

export interface DirectorEntryRunPointer {
  readonly runId: string;
  readonly status: DirectorEntryRunStatus;
  readonly updatedAt: string;
}

export interface DirectorEntryReportPointer {
  readonly reportId: string;
  readonly runId: string;
  readonly recordedAt: string;
  readonly flags: readonly string[];
  readonly operatorSummary?: string;
  readonly nextAction?: string;
  readonly retryable?: boolean;
}

export interface DirectorEntryAgentOsChannelProjection {
  readonly adapterId: string;
  readonly channel: string;
  readonly routeKind: DirectorEntryRouteKind;
  readonly sourceId: string;
  readonly threadId?: string;
  readonly deliveryTargetKind: "desktop" | "channel" | "host" | "none";
  readonly deliveryTargetId?: string;
}

export interface DirectorEntryAgentOsPermissionProjection {
  readonly mode: "allow" | "ask" | "deny" | "plan-only";
  readonly approvalBoundary: AgentOsApprovalBoundary;
  readonly remoteUnsafeCommandPolicy: AgentOsRemoteUnsafeCommandPolicy;
}

export interface DirectorEntryAgentOsSandboxProjection {
  readonly verdict: AgentOsPolicyVerdictValue;
  readonly sandboxMode: AgentOsSandboxMode;
  readonly reason?: string;
}

export interface DirectorEntryAgentOsMemoryProjection {
  readonly lane: AgentOsMemoryLane;
  readonly localOnly: boolean;
  readonly enabledLayers: readonly string[];
  readonly evidenceRequired: boolean;
}

export interface DirectorEntryAgentOsQueueProjection {
  readonly lane: AgentOsQueueLane;
  readonly mode: AgentOsQueueMode;
  readonly dropPolicy: AgentOsQueueDropPolicy;
}

export interface DirectorEntryAgentOsTimelineSummaryProjection {
  readonly latestState?: AgentOsTurnState;
  readonly approvalEvents: number;
  readonly memoryEvents: number;
  readonly skillEvents: number;
  readonly subagentEvents: number;
  readonly controlPlaneEvents: number;
  readonly toolEvents: number;
  readonly finalDelivered: boolean;
  readonly totalEvents: number;
  readonly latestEventType?: AgentOsTimelineEventType;
}

export interface DirectorEntryAgentOsProjection {
  readonly schemaId: typeof DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID;
  readonly source: DirectorEntryAgentOsProjectionSource;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly latestLineage?: DirectorEntryLineage;
  readonly actorTrustLevel: AgentOsTrustLevel;
  readonly turnKind: AgentOsTurnKind;
  readonly channel: DirectorEntryAgentOsChannelProjection;
  readonly permission: DirectorEntryAgentOsPermissionProjection;
  readonly sandbox: DirectorEntryAgentOsSandboxProjection;
  readonly memory: DirectorEntryAgentOsMemoryProjection;
  readonly queue: DirectorEntryAgentOsQueueProjection;
  readonly timelineSummary: DirectorEntryAgentOsTimelineSummaryProjection;
}

export interface DirectorEntrySession {
  readonly schemaVersion: typeof DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION;
  readonly entrySessionId: string;
  readonly sessionKey: string;
  readonly hostId: string;
  readonly channel: string;
  readonly routeKind: DirectorEntryRouteKind;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly state: DirectorEntryState;
  readonly nextAction: DirectorEntryNextAction;
  readonly latestTurnId: string;
  readonly latestLineage: DirectorEntryLineage;
  readonly latestBlueprint?: DirectorEntryBlueprintPointer;
  readonly latestRun?: DirectorEntryRunPointer;
  readonly latestReport?: DirectorEntryReportPointer;
  readonly agentOsProjection?: DirectorEntryAgentOsProjection;
  readonly turns: readonly DirectorEntryTurn[];
}

export interface DirectorEntryIntakeRequest {
  readonly apiVersion: typeof DIRECTOR_ENTRY_API_VERSION;
  readonly entry: DirectorEntrySourceEnvelope;
  readonly snapshot: DirectorHostSnapshotEnvelope;
  readonly intake: DirectorIntakePayload;
}

export interface DirectorEntryMessageRequest {
  readonly apiVersion: typeof DIRECTOR_ENTRY_API_VERSION;
  readonly hostId: string;
  readonly message: ChannelTransportEnvelope;
}

export interface DirectorEntryIntakeResponse {
  readonly apiVersion: typeof DIRECTOR_ENTRY_API_VERSION;
  readonly directorApiVersion: typeof DIRECTOR_HOST_API_VERSION;
  readonly session: DirectorEntrySession;
  readonly turn: DirectorEntryTurn;
  readonly intake: DirectorIntakeResponse;
  readonly agentOsProjection?: DirectorEntryAgentOsProjection;
}

export function isDirectorEntrySourceEnvelope(
  value: unknown,
): value is DirectorEntrySourceEnvelope {
  return (
    isObject(value) &&
    isString(value.hostId) &&
    isString(value.channel) &&
    isOneOf(value.routeKind, DIRECTOR_ENTRY_ROUTE_KINDS) &&
    isString(value.sessionKey) &&
    isString(value.messageId) &&
    isString(value.receivedAt)
  );
}

export function isDirectorEntryLineage(value: unknown): value is DirectorEntryLineage {
  return (
    isObject(value) &&
    isString(value.sessionKey) &&
    isString(value.entrySessionId) &&
    isString(value.entryTurnId) &&
    isOptional(value.intakeId, isString) &&
    isOptional(value.alignmentLockId, isString) &&
    isOptional(value.blueprintId, isString) &&
    isOptional(value.runId, isString) &&
    isOptional(value.reportId, isString)
  );
}

export function isDirectorEntryTurn(value: unknown): value is DirectorEntryTurn {
  return (
    isObject(value) &&
    isString(value.entryTurnId) &&
    isString(value.messageId) &&
    isString(value.receivedAt) &&
    isOneOf(value.state, DIRECTOR_ENTRY_STATES) &&
    isOneOf(value.nextAction, DIRECTOR_ENTRY_NEXT_ACTIONS) &&
    isString(value.summary) &&
    isDirectorEntryLineage(value.lineage) &&
    isOptional(value.clarificationPrompts, (candidate): candidate is readonly string[] =>
      isArrayOf(candidate, isString),
    )
  );
}

export function isDirectorEntrySession(value: unknown): value is DirectorEntrySession {
  return (
    isObject(value) &&
    value.schemaVersion === DIRECTOR_ENTRY_SESSION_SCHEMA_VERSION &&
    isString(value.entrySessionId) &&
    isString(value.sessionKey) &&
    isString(value.hostId) &&
    isString(value.channel) &&
    isOneOf(value.routeKind, DIRECTOR_ENTRY_ROUTE_KINDS) &&
    isString(value.createdAt) &&
    isString(value.updatedAt) &&
    isOneOf(value.state, DIRECTOR_ENTRY_STATES) &&
    isOneOf(value.nextAction, DIRECTOR_ENTRY_NEXT_ACTIONS) &&
    isString(value.latestTurnId) &&
    isDirectorEntryLineage(value.latestLineage) &&
    isOptional(value.latestBlueprint, isDirectorEntryBlueprintPointer) &&
    isOptional(value.latestRun, isDirectorEntryRunPointer) &&
    isOptional(value.latestReport, isDirectorEntryReportPointer) &&
    isOptional(value.agentOsProjection, isDirectorEntryAgentOsProjection) &&
    isArrayOf(value.turns, isDirectorEntryTurn)
  );
}

export function isDirectorEntryIntakeRequest(value: unknown): value is DirectorEntryIntakeRequest {
  return (
    isObject(value) &&
    value.apiVersion === DIRECTOR_ENTRY_API_VERSION &&
    isDirectorEntrySourceEnvelope(value.entry) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isDirectorIntakePayload(value.intake)
  );
}

export function isDirectorEntryMessageRequest(
  value: unknown,
): value is DirectorEntryMessageRequest {
  return (
    isObject(value) &&
    value.apiVersion === DIRECTOR_ENTRY_API_VERSION &&
    isString(value.hostId) &&
    isChannelTransportEnvelope(value.message) &&
    typeof value.message.text === "string" &&
    value.message.text.trim().length > 0 &&
    value.message.routingHint.agentId === value.message.agentId &&
    value.message.routingHint.channel === value.message.channel &&
    value.message.routingHint.peerId === value.message.peerId
  );
}

export function isDirectorEntryIntakeResponse(
  value: unknown,
): value is DirectorEntryIntakeResponse {
  return (
    isObject(value) &&
    value.apiVersion === DIRECTOR_ENTRY_API_VERSION &&
    value.directorApiVersion === DIRECTOR_HOST_API_VERSION &&
    isDirectorEntrySession(value.session) &&
    isDirectorEntryTurn(value.turn) &&
    isDirectorIntakeResponse(value.intake) &&
    isOptional(value.agentOsProjection, isDirectorEntryAgentOsProjection)
  );
}

export function isDirectorEntryAgentOsProjection(
  value: unknown,
): value is DirectorEntryAgentOsProjection {
  return (
    isObject(value) &&
    value.schemaId === DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SCHEMA_ID &&
    isOneOf(value.source, DIRECTOR_ENTRY_AGENT_OS_PROJECTION_SOURCES) &&
    isString(value.turnId) &&
    isString(value.sessionKey) &&
    isOptional(value.latestLineage, isDirectorEntryLineage) &&
    isOneOf(value.actorTrustLevel, AGENT_OS_TRUST_LEVELS) &&
    isOneOf(value.turnKind, AGENT_OS_TURN_KINDS) &&
    isDirectorEntryAgentOsChannelProjection(value.channel) &&
    isDirectorEntryAgentOsPermissionProjection(value.permission) &&
    isDirectorEntryAgentOsSandboxProjection(value.sandbox) &&
    isDirectorEntryAgentOsMemoryProjection(value.memory) &&
    isDirectorEntryAgentOsQueueProjection(value.queue) &&
    isDirectorEntryAgentOsTimelineSummaryProjection(value.timelineSummary)
  );
}

function isDirectorEntryAgentOsChannelProjection(
  value: unknown,
): value is DirectorEntryAgentOsChannelProjection {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isString(value.channel) &&
    isOneOf(value.routeKind, DIRECTOR_ENTRY_ROUTE_KINDS) &&
    isString(value.sourceId) &&
    isOptional(value.threadId, isString) &&
    isOneOf(value.deliveryTargetKind, ["desktop", "channel", "host", "none"] as const) &&
    isOptional(value.deliveryTargetId, isString)
  );
}

function isDirectorEntryAgentOsPermissionProjection(
  value: unknown,
): value is DirectorEntryAgentOsPermissionProjection {
  return (
    isObject(value) &&
    isOneOf(value.mode, ["allow", "ask", "deny", "plan-only"] as const) &&
    isOneOf(value.approvalBoundary, AGENT_OS_APPROVAL_BOUNDARIES) &&
    isOneOf(value.remoteUnsafeCommandPolicy, AGENT_OS_REMOTE_UNSAFE_COMMAND_POLICIES)
  );
}

function isDirectorEntryAgentOsSandboxProjection(
  value: unknown,
): value is DirectorEntryAgentOsSandboxProjection {
  return (
    isObject(value) &&
    isOneOf(value.verdict, AGENT_OS_POLICY_VERDICTS) &&
    isOneOf(value.sandboxMode, AGENT_OS_SANDBOX_MODES) &&
    isOptional(value.reason, isString)
  );
}

function isDirectorEntryAgentOsMemoryProjection(
  value: unknown,
): value is DirectorEntryAgentOsMemoryProjection {
  return (
    isObject(value) &&
    isOneOf(value.lane, AGENT_OS_MEMORY_LANES) &&
    typeof value.localOnly === "boolean" &&
    isArrayOf(value.enabledLayers, isString) &&
    typeof value.evidenceRequired === "boolean"
  );
}

function isDirectorEntryAgentOsQueueProjection(
  value: unknown,
): value is DirectorEntryAgentOsQueueProjection {
  return (
    isObject(value) &&
    isOneOf(value.lane, AGENT_OS_QUEUE_LANES) &&
    isOneOf(value.mode, AGENT_OS_QUEUE_MODES) &&
    isOneOf(value.dropPolicy, AGENT_OS_QUEUE_DROP_POLICIES)
  );
}

function isDirectorEntryAgentOsTimelineSummaryProjection(
  value: unknown,
): value is DirectorEntryAgentOsTimelineSummaryProjection {
  return (
    isObject(value) &&
    isOptional(value.latestState, (candidate): candidate is AgentOsTurnState =>
      isOneOf(candidate, AGENT_OS_TURN_STATES),
    ) &&
    isCount(value.approvalEvents) &&
    isCount(value.memoryEvents) &&
    isCount(value.skillEvents) &&
    isCount(value.subagentEvents) &&
    isCount(value.controlPlaneEvents) &&
    isCount(value.toolEvents) &&
    typeof value.finalDelivered === "boolean" &&
    isCount(value.totalEvents) &&
    isOptional(value.latestEventType, (candidate): candidate is AgentOsTimelineEventType =>
      isOneOf(candidate, AGENT_OS_TIMELINE_EVENT_TYPES),
    )
  );
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isChannelTransportEnvelope(value: unknown): value is ChannelTransportEnvelope {
  return (
    isObject(value) &&
    value.schemaVersion === CONTRACTS_SCHEMA_VERSION &&
    isString(value.channel) &&
    isString(value.agentId) &&
    isString(value.peerId) &&
    isString(value.messageId) &&
    typeof value.receivedAtMs === "number" &&
    Number.isFinite(value.receivedAtMs) &&
    isOptional(value.text, isString) &&
    isChannelRoutingHint(value.routingHint)
  );
}

function isDirectorEntryBlueprintPointer(value: unknown): value is DirectorEntryBlueprintPointer {
  return (
    isObject(value) &&
    isString(value.blueprintId) &&
    isString(value.handoffId) &&
    isString(value.recordedAt)
  );
}

function isDirectorEntryRunPointer(value: unknown): value is DirectorEntryRunPointer {
  return (
    isObject(value) &&
    isString(value.runId) &&
    isOneOf(value.status, DIRECTOR_ENTRY_RUN_STATUSES) &&
    isString(value.updatedAt)
  );
}

function isDirectorEntryReportPointer(value: unknown): value is DirectorEntryReportPointer {
  return (
    isObject(value) &&
    isString(value.reportId) &&
    isString(value.runId) &&
    isString(value.recordedAt) &&
    isArrayOf(value.flags, isString) &&
    isOptional(value.operatorSummary, isString) &&
    isOptional(value.nextAction, isString) &&
    isOptional(value.retryable, (candidate): candidate is boolean => typeof candidate === "boolean")
  );
}

function isChannelRoutingHint(value: unknown): value is ChannelTransportEnvelope["routingHint"] {
  return (
    isObject(value) &&
    isString(value.agentId) &&
    isString(value.channel) &&
    isChannelRouteKind(value.routeKind) &&
    isString(value.peerId) &&
    isOptional(value.threadId, isString) &&
    isOptional(value.baseSessionId, isString)
  );
}

function isChannelRouteKind(value: unknown): value is ChannelRouteKind {
  return value === "direct" || value === "thread";
}
