import type {
  ConversationRuntimeAngelRoleProfile,
  ConversationRuntimeAttachment,
  ConversationRuntimeCapabilityHit,
  ConversationRuntimeCapabilityPacket,
  ConversationRuntimeCapabilityRouteDecision,
  ConversationRuntimeInput,
  ConversationRuntimeIntent,
  ConversationRuntimeMemoryDecision,
  ConversationRuntimeModelCapabilities,
  ConversationRuntimeResponsePolicy,
  ConversationRuntimeTraceItem,
  ConversationRuntimeTurnDecision,
} from "./types.js";
import { mapRuntimeSurfaceToTurnSurface } from "./types.js";

export interface ConversationRuntimeChannelTurnActiveSessionLike {
  readonly hasActiveSession: boolean;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly objective?: string;
  readonly awaitingConfirmation?: boolean;
  readonly pendingReviewCount?: number;
}

export interface ConversationRuntimeChannelTurnInputLike {
  readonly text: string;
  readonly surface: string;
  readonly channel?: string;
  readonly agentId?: string;
  readonly peerId?: string;
  readonly sessionKey?: string;
  readonly activeSession?: ConversationRuntimeChannelTurnActiveSessionLike;
  readonly angelRoleProfile?: ConversationRuntimeAngelRoleProfile;
  readonly attachments?: readonly ConversationRuntimeAttachment[];
  readonly textModelCapabilities?: ConversationRuntimeModelCapabilities;
  readonly contentSafetyMode?: "standard" | "developer-debug";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeChannelTurnTraceLike {
  readonly stage: string;
  readonly detail: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeChannelTurnResultLike {
  readonly intent: {
    readonly kind: string;
    readonly objective?: string;
    readonly supplement?: string;
    readonly command?: unknown;
    readonly safety?: ConversationRuntimeIntent["safety"];
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly capabilityRoute?: ConversationRuntimeCapabilityRouteDecision;
  readonly responsePolicy: ConversationRuntimeResponsePolicy;
  readonly audience?: "user" | "operator" | "developer";
  readonly userText: string;
  readonly operatorTrace?: readonly ConversationRuntimeChannelTurnTraceLike[];
  readonly memoryDecision: ConversationRuntimeMemoryDecision;
  readonly shouldInvokeRecall: boolean;
  readonly shouldCreateRun: boolean;
  readonly shouldAttachToActiveSession: boolean;
}

export interface BuildChannelTurnInputOptions {
  readonly activeSession?: ConversationRuntimeChannelTurnActiveSessionLike;
  readonly contentSafetyMode?: "standard" | "developer-debug";
  readonly agentId?: string;
  readonly peerId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export function buildChannelTurnInputFromRuntimeInput(
  input: ConversationRuntimeInput,
  options: BuildChannelTurnInputOptions = {},
): ConversationRuntimeChannelTurnInputLike {
  const agentId = options.agentId ?? input.trustedContext?.accountId ?? input.accountId;
  return {
    text: input.text,
    surface: mapRuntimeSurfaceToTurnSurface(input.surface),
    channel: input.channel,
    ...(agentId === undefined ? {} : { agentId }),
    peerId: options.peerId ?? input.sender.id,
    sessionKey: input.sessionKey,
    ...(options.activeSession === undefined ? {} : { activeSession: options.activeSession }),
    ...(input.trustedContext?.angelRoleProfile === undefined
      ? {}
      : { angelRoleProfile: input.trustedContext.angelRoleProfile }),
    ...(options.contentSafetyMode === undefined
      ? {}
      : { contentSafetyMode: options.contentSafetyMode }),
    ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    ...resolveRuntimeTextModelCapabilitiesForChannelInput(input),
    metadata: {
      ...(input.metadata ?? {}),
      ...(options.metadata ?? {}),
    },
  };
}

export function mapChannelTurnResultToRuntimeTurnDecision(
  turn: ConversationRuntimeChannelTurnResultLike,
): ConversationRuntimeTurnDecision {
  const capabilityRoute = turn.capabilityRoute ?? readCapabilityRoute(turn.intent.metadata);
  return {
    intent: {
      kind: turn.intent.kind,
      ...(turn.intent.objective === undefined ? {} : { objective: turn.intent.objective }),
      ...(turn.intent.supplement === undefined ? {} : { supplement: turn.intent.supplement }),
      ...mapChannelCommandToRuntimeIntentCommand(turn.intent.command),
      ...(turn.intent.safety === undefined ? {} : { safety: turn.intent.safety }),
      metadata: {
        ...(turn.intent.metadata ?? {}),
        ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
      },
    },
    responsePolicy: turn.responsePolicy,
    audience: turn.audience ?? "user",
    userText: turn.userText,
    trace: (turn.operatorTrace ?? []).map(mapChannelTraceToRuntimeTrace),
    memoryDecision: turn.memoryDecision,
    ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
    shouldInvokeRecall: turn.shouldInvokeRecall,
    shouldCreateRun: turn.shouldCreateRun,
    shouldAttachToActiveSession: turn.shouldAttachToActiveSession,
    metadata: {
      ...(turn.intent.metadata ?? {}),
      ...(capabilityRoute === undefined ? {} : { capabilityRoute }),
    },
  };
}

export interface DirectorCapabilityContextPacketLike {
  readonly visibleSummary?: string;
  readonly hiddenPromptBlock?: string;
  readonly promptBlock?: string;
  readonly recallStatus?: "hit" | "miss" | "degraded";
  readonly skillStatus?: "hit" | "miss" | "degraded";
  readonly knowledgeHits?: readonly DirectorCapabilityHitLike[];
  readonly skillHits?: readonly DirectorCapabilityHitLike[];
  readonly recallTrace?: readonly DirectorCapabilityTraceLike[];
  readonly policy?: unknown;
  readonly capabilityPlan?: unknown;
}

export interface DirectorCapabilityHitLike {
  readonly id: string;
  readonly title?: string;
}

export interface DirectorCapabilityTraceLike {
  readonly source: "knowledge" | "skill" | "memory" | (string & {});
  readonly status: "hit" | "miss" | "degraded";
  readonly id?: string;
  readonly title?: string;
  readonly reason: string;
  readonly score?: number;
  readonly query?: string;
  readonly matchMode?: string;
  readonly retrievalMode?: string;
  readonly memoryLayer?: string;
  readonly verbatimExcerpt?: string;
  readonly retrieval?: Readonly<Record<string, unknown>>;
  readonly promptChars?: number;
}

export function mapDirectorCapabilityPacketToRuntimeCapabilityPacket(
  packet: DirectorCapabilityContextPacketLike,
): ConversationRuntimeCapabilityPacket {
  const hits = [
    ...(packet.knowledgeHits ?? []).map((hit) => mapDirectorHitToRuntimeHit(hit, "knowledge")),
    ...(packet.skillHits ?? []).map((hit) => mapDirectorHitToRuntimeHit(hit, "skill")),
    ...(packet.recallTrace ?? [])
      .filter((trace) => trace.source === "memory" && trace.status === "hit")
      .map((trace) => mapDirectorTraceToRuntimeHit(trace)),
    ...(packet.recallTrace ?? [])
      .filter((trace) => trace.status === "degraded" && trace.id !== undefined)
      .map((trace) => mapDirectorTraceToRuntimeHit(trace)),
  ];
  return {
    status: deriveRuntimeCapabilityStatus(packet, hits),
    ...(packet.visibleSummary === undefined ? {} : { visibleSummary: packet.visibleSummary }),
    hiddenPromptBlock: packet.hiddenPromptBlock ?? packet.promptBlock ?? "",
    hits,
    metadata: {
      recallStatus: packet.recallStatus ?? "miss",
      skillStatus: packet.skillStatus ?? "miss",
      ...(packet.policy === undefined ? {} : { policy: packet.policy }),
      ...(packet.capabilityPlan === undefined ? {} : { capabilityPlan: packet.capabilityPlan }),
    },
  };
}

function mapChannelTraceToRuntimeTrace(
  trace: ConversationRuntimeChannelTurnTraceLike,
): ConversationRuntimeTraceItem {
  return {
    source: "orchestrator",
    stage: trace.stage,
    detail: trace.detail,
    ...(trace.metadata === undefined ? {} : { metadata: trace.metadata }),
  };
}

function mapChannelCommandToRuntimeIntentCommand(
  command: unknown,
): Pick<ConversationRuntimeIntent, "command"> {
  if (!isRecord(command)) {
    return {};
  }
  const name = readString(command, "commandId") ?? readString(command, "canonicalName");
  const raw = readString(command, "matchedName") ?? name;
  if (name === undefined || raw === undefined) {
    return {};
  }
  const args = readString(command, "args");
  return {
    command: {
      name,
      raw,
      ...(args === undefined ? {} : { args }),
      metadata: command,
    },
  };
}

function mapDirectorHitToRuntimeHit(
  hit: DirectorCapabilityHitLike,
  source: ConversationRuntimeCapabilityHit["source"],
): ConversationRuntimeCapabilityHit {
  return {
    id: `${source}:${hit.id}`,
    source,
    status: "hit",
    ...(hit.title === undefined ? {} : { title: hit.title }),
  };
}

function mapDirectorTraceToRuntimeHit(
  trace: DirectorCapabilityTraceLike,
): ConversationRuntimeCapabilityHit {
  return {
    id: `${trace.source}:${trace.id ?? "degraded"}`,
    source: trace.source,
    status: trace.status,
    ...(trace.title === undefined ? {} : { title: trace.title }),
    ...(trace.score === undefined ? {} : { score: trace.score }),
    summary: trace.reason,
    metadata: {
      ...(trace.query === undefined ? {} : { query: trace.query }),
      ...(trace.matchMode === undefined ? {} : { matchMode: trace.matchMode }),
      ...(trace.retrievalMode === undefined ? {} : { retrievalMode: trace.retrievalMode }),
      ...(trace.memoryLayer === undefined ? {} : { memoryLayer: trace.memoryLayer }),
      ...(trace.verbatimExcerpt === undefined ? {} : { verbatimExcerpt: trace.verbatimExcerpt }),
      ...(trace.retrieval === undefined ? {} : trace.retrieval),
      promptChars: trace.promptChars ?? 0,
    },
  };
}

function deriveRuntimeCapabilityStatus(
  packet: DirectorCapabilityContextPacketLike,
  hits: readonly ConversationRuntimeCapabilityHit[],
): ConversationRuntimeCapabilityPacket["status"] {
  if (packet.recallStatus === "degraded" || packet.skillStatus === "degraded") {
    return "degraded";
  }
  if (hits.some((hit) => hit.status === "hit" || hit.status === "used")) {
    return "hit";
  }
  return "miss";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function resolveRuntimeTextModelCapabilitiesForChannelInput(
  input: ConversationRuntimeInput,
): Pick<ConversationRuntimeChannelTurnInputLike, "textModelCapabilities"> {
  if (input.textModelCapabilities !== undefined) {
    return { textModelCapabilities: input.textModelCapabilities };
  }
  const value = input.metadata?.textModelCapabilities;
  return isRecord(value)
    ? { textModelCapabilities: value as unknown as ConversationRuntimeModelCapabilities }
    : {};
}

function readCapabilityRoute(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ConversationRuntimeCapabilityRouteDecision | undefined {
  const route = metadata?.capabilityRoute;
  if (!isRecord(route)) {
    return undefined;
  }
  if (
    route.abilityGroup === "text" ||
    route.abilityGroup === "vision" ||
    route.abilityGroup === "image_generation" ||
    route.abilityGroup === "video_generation"
  ) {
    return route as unknown as ConversationRuntimeCapabilityRouteDecision;
  }
  return undefined;
}
