import type {
  ConversationRuntimeArtifactSignal,
  ConversationRuntimeCapabilityPacket,
  ConversationRuntimeInput,
  ConversationRuntimeReplySource,
  ConversationRuntimeTraceItem,
  ConversationRuntimeTurnDecision,
} from "./types.js";

export type ConversationRuntimeProductionMode = "start" | "confirm" | "supplement";

export interface ConversationRuntimeProductionStartRequest {
  readonly turnId: string;
  readonly sessionKey: string;
  readonly mode: ConversationRuntimeProductionMode;
  readonly objective: string;
  readonly supplement?: string;
  readonly userText: string;
  readonly surface: ConversationRuntimeInput["surface"];
  readonly channel: string;
  readonly intent: ConversationRuntimeTurnDecision["intent"];
  readonly turn: ConversationRuntimeTurnDecision;
  readonly capabilityPacket?: ConversationRuntimeCapabilityPacket;
  readonly trustedContext?: ConversationRuntimeInput["trustedContext"];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeProductionApprovalRef {
  readonly id: string;
  readonly title?: string;
  readonly status?: "pending" | "approved" | "rejected" | "auto" | (string & {});
  readonly summary?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeProductionResult {
  readonly ok: boolean;
  readonly finalText?: string;
  readonly replySource?: ConversationRuntimeReplySource;
  readonly status?: "created" | "running" | "completed" | "blocked" | "failed" | (string & {});
  readonly runId?: string;
  readonly blueprintId?: string;
  readonly reportId?: string;
  readonly artifacts?: readonly ConversationRuntimeArtifactSignal[];
  readonly approvals?: readonly ConversationRuntimeProductionApprovalRef[];
  readonly recallStatus?: "hit" | "miss" | "degraded" | "skipped" | (string & {});
  readonly skillStatus?: "hit" | "miss" | "degraded" | "skipped" | (string & {});
  readonly memoryStatus?: "hit" | "miss" | "degraded" | "skipped" | (string & {});
  readonly learningTargets?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly trace?: readonly ConversationRuntimeTraceItem[];
}

export type ConversationRuntimeProductionPort = (
  request: ConversationRuntimeProductionStartRequest,
) => Promise<ConversationRuntimeProductionResult> | ConversationRuntimeProductionResult;

export function isConversationRuntimeProductionTurn(
  turn: ConversationRuntimeTurnDecision,
): boolean {
  return (
    turn.intent.kind === "production-start" ||
    turn.intent.kind === "production-confirm" ||
    turn.intent.kind === "production-supplement" ||
    turn.shouldCreateRun ||
    turn.shouldAttachToActiveSession
  );
}

export function resolveConversationRuntimeProductionMode(
  turn: ConversationRuntimeTurnDecision,
): ConversationRuntimeProductionMode {
  if (turn.intent.kind === "production-confirm") {
    return "confirm";
  }
  if (turn.intent.kind === "production-supplement" || turn.shouldAttachToActiveSession) {
    return "supplement";
  }
  return "start";
}

export function resolveConversationRuntimeProductionObjective(
  input: ConversationRuntimeInput,
  turn: ConversationRuntimeTurnDecision,
): string {
  const objective =
    turn.intent.objective ??
    input.trustedContext?.metadata?.productionObjective ??
    input.trustedContext?.metadata?.objective ??
    input.text;
  return String(objective).trim();
}
