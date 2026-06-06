import {
  type AgentOsPolicyVerdict,
  type AgentOsSandboxPreflight,
  type AgentOsTimelineEvent,
  type AgentOsTimelineEventType,
  type AgentOsTrustLevel,
  type AgentOsTurnEnvelope,
  type AgentOsTurnKind,
  appendAgentOsTimelineEvent,
  createAgentOsTurnEnvelope,
} from "@hotflow/agent-os-kernel-contracts";
import { resolveChannelSessionTarget } from "@hotflow/channels-core";
import type { ChannelTransportEnvelope } from "@hotflow/contracts";
import type {
  ConversationRuntimeCapabilityHit,
  ConversationRuntimeEvent,
  ConversationRuntimeEventKind,
  ConversationRuntimeInput,
  ConversationRuntimeResult,
  ConversationRuntimeTraceItem,
} from "@hotflow/conversation-runtime";
import type { JournalEntry, JsonObject, JsonValue } from "@hotflow/sessions";

export interface AgentOsChannelTransportMappingInput {
  readonly hostId: string;
  readonly surface: "desktop" | "weixin" | "host-api" | "cli" | "api" | (string & {});
  readonly message: ChannelTransportEnvelope;
  readonly workspaceRoot?: string;
  readonly dataDir?: string;
  readonly turnId?: string;
}

export interface AgentOsRuntimeInputMappingInput {
  readonly input: ConversationRuntimeInput;
  readonly turnId?: string;
}

export interface AgentOsRuntimeResultTimelineInput {
  readonly result: ConversationRuntimeResult;
  readonly startSequence?: number;
}

export interface AgentOsSessionJournalTimelineInput {
  readonly entries: readonly JournalEntry[];
}

export function createAgentOsTurnEnvelopeFromChannelTransport(
  input: AgentOsChannelTransportMappingInput,
): AgentOsTurnEnvelope {
  const sessionTarget = resolveChannelSessionTarget(input.message.routingHint);
  const receivedAt = new Date(input.message.receivedAtMs).toISOString();
  const turnKind = resolveTurnKind(input.message.text ?? "");
  const remote = isRemoteSurface(input.surface);
  const workspaceRoot = input.workspaceRoot ?? ".";
  const policyVerdict = createPolicyVerdict({
    verdict: remote && turnKind === "slash-command" ? "needs_approval" : "allow",
    reason:
      remote && turnKind === "slash-command"
        ? "Remote slash command requires approval before execution."
        : "Channel message admitted into Agent OS turn mapping.",
    decidedAt: receivedAt,
  });
  const sandboxPreflight = createSandboxPreflight({
    verdict: remote ? "blocked" : "allow",
    sandboxMode: remote ? "disabled" : "workspace-write",
    checkedAt: receivedAt,
    reason: remote
      ? "Remote channel execution is fail-closed until a runtime sandbox grants access."
      : "Trusted local workspace may use workspace-write sandbox.",
  });

  return createAgentOsTurnEnvelope({
    turnId: input.turnId ?? `${input.message.channel}:${input.message.messageId}`,
    sessionKey: sessionTarget.sessionKey,
    turnKind,
    createdAt: receivedAt,
    actor: {
      actorId: `${input.message.channel}:${input.message.peerId}`,
      kind: "user",
      trustLevel: resolveTrustLevel(input.surface),
    },
    channel: {
      adapterId: `${input.message.channel}-adapter`,
      channel: input.message.channel,
      routeKind: input.message.routingHint.routeKind,
      sourceId: input.message.peerId,
      ...(input.message.routingHint.threadId === undefined
        ? {}
        : { threadId: input.message.routingHint.threadId }),
      deliveryTarget: {
        kind: input.surface === "desktop" ? "desktop" : "channel",
        targetId: input.message.peerId,
        ...(input.surface === "desktop" ? {} : { channel: input.message.channel }),
        ...(input.message.routingHint.threadId === undefined
          ? {}
          : { threadId: input.message.routingHint.threadId }),
      },
    },
    permissionContext: {
      mode: "ask",
      approvalBoundary: remote ? "all-tools" : "mutating-tools",
      operatorScopes: remote ? ["chat:reply"] : ["chat:reply", "workspace:write", "tools:execute"],
      remoteUnsafeCommandPolicy: remote ? "block" : "ask",
    },
    memoryScope: {
      lane: remote ? "user" : "project",
      localOnly: true,
      enabledLayers: remote ? ["L0", "L1"] : ["L0", "L1", "L2"],
      evidenceRequired: true,
    },
    workspaceScope: {
      workspaceId: input.hostId,
      root: workspaceRoot,
      writableRoots: remote ? [] : [workspaceRoot],
      readonlyRoots: [workspaceRoot],
      networkPolicy: remote ? "disabled" : "limited",
    },
    queueDirective: {
      lane: "session",
      mode: turnKind === "interrupt" ? "interrupt" : "enqueue",
      dropPolicy: "summarize",
    },
    policyVerdict,
    sandboxPreflight,
  });
}

export function createAgentOsTurnEnvelopeFromRuntimeInput(
  input: AgentOsRuntimeInputMappingInput,
): AgentOsTurnEnvelope {
  const receivedAtMs = input.input.receivedAtMs ?? Date.now();
  const receivedAt = new Date(receivedAtMs).toISOString();
  const trustLevel = resolveRuntimeTrustLevel(input.input);
  const trusted = trustLevel === "trusted-local";
  const remote = !trusted;
  const workspaceRoot = input.input.trustedContext?.workspaceRoot ?? ".";
  const turnKind = resolveTurnKind(input.input.text);
  const policyVerdict = createPolicyVerdict({
    verdict: trusted ? "allow" : "needs_approval",
    reason: trusted
      ? "Trusted runtime surface admitted into Agent OS turn mapping."
      : "Untrusted runtime surface requires approval before execution.",
    decidedAt: receivedAt,
  });
  const sandboxPreflight = createSandboxPreflight({
    verdict: trusted ? "allow" : "blocked",
    sandboxMode: trusted ? "workspace-write" : "disabled",
    checkedAt: receivedAt,
    reason: trusted
      ? "Trusted local runtime may use workspace-write sandbox."
      : "Untrusted runtime surface is fail-closed until sandbox grants access.",
  });

  return createAgentOsTurnEnvelope({
    turnId: input.turnId ?? `${input.input.surface}:${input.input.messageId}`,
    sessionKey: input.input.sessionKey,
    turnKind,
    createdAt: receivedAt,
    actor: {
      actorId: `${input.input.surface}:${input.input.sender.id}`,
      kind:
        input.input.sender.role === "system"
          ? "system"
          : input.input.sender.role === "operator"
            ? "operator"
            : "user",
      trustLevel,
      ...(input.input.sender.displayName === undefined
        ? {}
        : { displayName: input.input.sender.displayName }),
    },
    channel: {
      adapterId: `${input.input.channel}-runtime`,
      channel: input.input.channel,
      routeKind:
        input.input.untrustedChannelContext?.rawThreadId === undefined ? "direct" : "thread",
      sourceId: input.input.sender.id,
      ...(input.input.untrustedChannelContext?.rawThreadId === undefined
        ? {}
        : { threadId: input.input.untrustedChannelContext.rawThreadId }),
      deliveryTarget: resolveRuntimeDeliveryTarget(input.input),
    },
    permissionContext: {
      mode: "ask",
      approvalBoundary: remote ? "all-tools" : "mutating-tools",
      operatorScopes: trusted ? ["chat:reply", "workspace:write", "tools:execute"] : ["chat:reply"],
      remoteUnsafeCommandPolicy: remote ? "block" : "ask",
    },
    memoryScope: {
      lane:
        input.input.surface === "desktop" || input.input.surface === "host-api"
          ? "project"
          : "user",
      localOnly: true,
      enabledLayers: trusted ? ["L0", "L1", "L2"] : ["L0", "L1"],
      evidenceRequired: true,
    },
    workspaceScope: {
      workspaceId: input.input.trustedContext?.accountId ?? input.input.channel,
      root: workspaceRoot,
      writableRoots: trusted ? [workspaceRoot] : [],
      readonlyRoots: [workspaceRoot],
      networkPolicy: trusted ? "limited" : "disabled",
    },
    queueDirective: {
      lane: "session",
      mode: turnKind === "interrupt" ? "interrupt" : "enqueue",
      dropPolicy: "summarize",
    },
    policyVerdict,
    sandboxPreflight,
  });
}

export function mapConversationRuntimeResultToAgentOsTimeline(
  input: AgentOsRuntimeResultTimelineInput,
): readonly AgentOsTimelineEvent[] {
  const baseSequence = input.startSequence ?? 1;
  let nextSequence = baseSequence;
  let timeline: readonly AgentOsTimelineEvent[] = [];

  const append = (event: Omit<AgentOsTimelineEvent, "sequence">) => {
    timeline = appendAgentOsTimelineEvent(timeline, {
      sequence: nextSequence,
      ...event,
    });
    nextSequence += 1;
  };

  for (const trace of input.result.operatorTrace.items) {
    if (trace.stage === "capability.resolved") {
      continue;
    }
    const event = mapRuntimeTraceToTimelineEvent(input.result, trace);
    if (event !== null) {
      append(event);
    }
  }

  for (const hit of input.result.capabilityPacket?.hits ?? []) {
    const event = mapCapabilityHitToTimelineEvent(input.result, hit);
    if (event !== null) {
      append(event);
    }
  }

  for (const trace of input.result.operatorTrace.items) {
    if (trace.stage !== "capability.resolved") {
      continue;
    }
    const event = mapRuntimeTraceToTimelineEvent(input.result, trace);
    if (event !== null) {
      append(event);
    }
  }

  for (const event of input.result.events) {
    append(mapRuntimeEventToTimelineEvent(event));
  }

  return timeline;
}

export function mapSessionJournalEntriesToAgentOsTimeline(
  input: AgentOsSessionJournalTimelineInput,
): readonly AgentOsTimelineEvent[] {
  let timeline: readonly AgentOsTimelineEvent[] = [];
  for (const entry of input.entries) {
    timeline = appendAgentOsTimelineEvent(timeline, {
      sequence: entry.seq,
      turnId: entry.turnId ?? "unknown-turn",
      eventId: `journal:${entry.sessionId}:${entry.seq}`,
      eventType: mapJournalEventType(entry.eventType),
      createdAt: new Date(entry.createdAtMs).toISOString(),
      payload: mapJournalPayload(entry),
    });
  }
  return timeline;
}

function resolveTurnKind(text: string): AgentOsTurnKind {
  const trimmed = text.trim();
  if (trimmed.startsWith("/")) {
    return "slash-command";
  }
  if (/^(stop|cancel|interrupt|暂停|停止|中断)\b/iu.test(trimmed)) {
    return "interrupt";
  }
  return "user-message";
}

function resolveTrustLevel(surface: string): AgentOsTrustLevel {
  if (surface === "desktop" || surface === "host-api" || surface === "cli") {
    return "trusted-local";
  }
  if (surface === "weixin") {
    return "paired-channel";
  }
  return "untrusted-remote";
}

function isRemoteSurface(surface: string): boolean {
  return resolveTrustLevel(surface) !== "trusted-local";
}

function resolveRuntimeTrustLevel(input: ConversationRuntimeInput): AgentOsTrustLevel {
  const surfaceTrustLevel = resolveTrustLevel(input.surface);
  if (surfaceTrustLevel !== "trusted-local") {
    return surfaceTrustLevel;
  }
  return "trusted-local";
}

function createPolicyVerdict(
  input: Pick<AgentOsPolicyVerdict, "verdict" | "reason" | "decidedAt">,
): AgentOsPolicyVerdict {
  return input;
}

function createSandboxPreflight(
  input: Pick<AgentOsSandboxPreflight, "verdict" | "sandboxMode" | "checkedAt" | "reason">,
): AgentOsSandboxPreflight {
  return input;
}

function resolveRuntimeDeliveryTarget(input: ConversationRuntimeInput) {
  if (input.surface === "desktop") {
    return {
      kind: "desktop" as const,
      targetId: input.sender.id,
    };
  }
  if (input.surface === "host-api") {
    return {
      kind: "host" as const,
      targetId: input.sender.id,
    };
  }
  return {
    kind: "channel" as const,
    channel: input.channel,
    targetId: input.sender.id,
    ...(input.untrustedChannelContext?.rawThreadId === undefined
      ? {}
      : { threadId: input.untrustedChannelContext.rawThreadId }),
  };
}

function mapRuntimeTraceToTimelineEvent(
  result: ConversationRuntimeResult,
  trace: ConversationRuntimeTraceItem,
): Omit<AgentOsTimelineEvent, "sequence"> | null {
  if (trace.stage !== "turn.orchestrated" && trace.stage !== "capability.resolved") {
    return null;
  }
  return {
    turnId: result.turnId,
    eventId: `${result.turnId}:trace:${trace.stage}`,
    eventType: "state.transition",
    createdAt: new Date(trace.occurredAtMs ?? Date.now()).toISOString(),
    payload: {
      from: trace.stage === "turn.orchestrated" ? "received" : "preflight",
      to: trace.stage === "turn.orchestrated" ? "preflight" : "context_resolved",
      source: trace.source,
      stage: trace.stage,
      detail: trace.detail,
      ...(trace.metadata === undefined ? {} : { metadata: trace.metadata }),
    },
  };
}

function mapCapabilityHitToTimelineEvent(
  result: ConversationRuntimeResult,
  hit: ConversationRuntimeCapabilityHit,
): Omit<AgentOsTimelineEvent, "sequence"> | null {
  if (hit.source !== "memory") {
    return null;
  }
  const metadata = toRecord(hit.metadata);
  return {
    turnId: result.turnId,
    eventId: `${result.turnId}:memory:${hit.id}`,
    eventType: "memory.recall",
    createdAt: new Date(Date.now()).toISOString(),
    payload: {
      evidenceId: hit.id,
      backend: "conversation-runtime",
      layer: readString(metadata.layer, "L1"),
      retrievalEngine: readString(metadata.retrievalEngine, "unknown"),
      matchMode: readString(metadata.matchMode, "unknown"),
      citation: readString(metadata.citation, hit.id),
      status: hit.status,
      ...(hit.score === undefined ? {} : { score: hit.score }),
      ...(hit.summary === undefined ? {} : { summary: hit.summary }),
    },
  };
}

function mapRuntimeEventToTimelineEvent(
  event: ConversationRuntimeEvent,
): Omit<AgentOsTimelineEvent, "sequence"> {
  const base = {
    turnId: event.turnId,
    eventId: event.id,
    createdAt: new Date(event.occurredAtMs).toISOString(),
  };

  if (isRuntimeEventKind(event, "runtime.approval")) {
    const approval = event.payload.approval;
    return {
      ...base,
      eventType: approval.status === "pending" ? "approval.requested" : "approval.resolved",
      payload: {
        approvalId: approval.id,
        title: approval.title,
        status: approval.status,
        ...(approval.summary === undefined ? {} : { summary: approval.summary }),
        ...(approval.metadata === undefined ? {} : { metadata: approval.metadata }),
      },
    };
  }

  if (isRuntimeEventKind(event, "runtime.tool")) {
    const tool = event.payload.tool;
    return {
      ...base,
      eventType:
        tool.phase === "completed" || tool.phase === "failed"
          ? "tool.result"
          : tool.phase === "started"
            ? "tool.start"
            : "tool.progress",
      payload: {
        toolId: tool.id,
        toolName: tool.name,
        phase: tool.phase,
        ...(tool.summary === undefined ? {} : { summary: tool.summary }),
        ...(tool.metadata === undefined ? {} : { metadata: tool.metadata }),
      },
    };
  }

  if (isRuntimeEventKind(event, "runtime.final")) {
    return {
      ...base,
      eventType: "final.delivered",
      payload: {
        text: event.payload.text,
        responsePolicy: event.payload.responsePolicy,
        audience: event.payload.audience,
        ...(event.payload.replySource === undefined
          ? {}
          : { replySource: event.payload.replySource }),
      },
    };
  }

  if (isRuntimeEventKind(event, "runtime.error")) {
    return {
      ...base,
      eventType: "control.log",
      payload: {
        kind: event.kind,
        message: event.payload.message,
        ...(event.payload.code === undefined ? {} : { code: event.payload.code }),
        ...(event.payload.recoverable === undefined
          ? {}
          : { recoverable: event.payload.recoverable }),
      },
    };
  }

  return {
    ...base,
    eventType: "control.log",
    payload: {
      kind: event.kind,
      payload: event.payload as JsonObject,
    },
  };
}

function isRuntimeEventKind<K extends ConversationRuntimeEventKind>(
  event: ConversationRuntimeEvent,
  kind: K,
): event is ConversationRuntimeEvent<K> {
  return event.kind === kind;
}

function mapJournalEventType(eventType: string): AgentOsTimelineEventType {
  if (eventType === "step.context_built") {
    return "capability.projected";
  }
  if (eventType === "step.model_output") {
    return "model.result";
  }
  if (eventType === "step.tools_planned" || eventType === "tool.call_planned") {
    return "tool.start";
  }
  if (eventType === "step.tool_result" || eventType === "tool.result") {
    return "tool.result";
  }
  if (eventType === "step.final_output") {
    return "final.delivered";
  }
  if (eventType === "runtime.degraded" || eventType === "runtime.failed") {
    return "control.log";
  }
  return "control.log";
}

function mapJournalPayload(entry: JournalEntry): Record<string, unknown> {
  if (entry.eventType === "audit.event" || entry.eventType === "stream.event") {
    const envelope = toRecord(entry.payload);
    const payload = toRecord(envelope.payload);
    return {
      kind: readString(envelope.kind, entry.eventType),
      eventId: readString(envelope.id, `journal:${entry.seq}`),
      occurredAtMs:
        typeof envelope.occurredAtMs === "number" ? envelope.occurredAtMs : entry.createdAtMs,
      ...payload,
    };
  }

  const stepPayload = toRecord(entry.payload);
  const data = toRecord(stepPayload.data);
  return {
    journalEventType: entry.eventType,
    stepIndex: typeof stepPayload.stepIndex === "number" ? stepPayload.stepIndex : undefined,
    ...stripUndefined(data),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export type { JsonValue };
