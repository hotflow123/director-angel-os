import type { ConversationRuntimeAttachment, ConversationRuntimeSurface } from "./types.js";
import type { ConversationRuntimeAngelRoleProfile } from "./types.js";

export type ConversationRuntimeAdmission =
  | {
      readonly kind: "dispatch";
      readonly reason?: string;
    }
  | {
      readonly kind: "observe-only";
      readonly reason?: string;
    }
  | {
      readonly kind: "handled";
      readonly reason: string;
    }
  | {
      readonly kind: "drop";
      readonly reason: string;
    };

export interface ConversationRuntimeEventClass {
  readonly kind: "message" | "command" | "reaction" | "delivery" | "system" | (string & {});
  readonly canStartAgentTurn: boolean;
  readonly reason?: string;
}

export type ConversationRuntimeStage =
  | "ingest"
  | "classify"
  | "preflight"
  | "resolve"
  | "assemble"
  | "record"
  | "dispatch"
  | "finalize";

export interface ConversationRuntimeSenderFacts {
  readonly id: string;
  readonly name?: string;
  readonly username?: string;
  readonly displayLabel?: string;
  readonly roles?: readonly string[];
  readonly tag?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeConversationFacts {
  readonly kind: "direct" | "group" | "thread" | (string & {});
  readonly label?: string;
  readonly nativeChannelId?: string;
  readonly threadId?: string;
  readonly parentId?: string;
  readonly spaceId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeRouteFacts {
  readonly sessionKey: string;
  readonly dispatchSessionKey?: string;
  readonly parentSessionKey?: string;
  readonly accountId?: string;
  readonly routeKind?: "direct" | "group" | "thread" | (string & {});
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeReplyPlanFacts {
  readonly to?: string;
  readonly replyToId?: string;
  readonly messageThreadId?: string;
  readonly nativeChannelId?: string;
  readonly threadParentId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeAccessFacts {
  readonly wasMentioned?: boolean;
  readonly commandAuthorized?: boolean;
  readonly authorizedBy?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSupplementalContextFacts {
  readonly quote?: {
    readonly id?: string;
    readonly body?: string;
    readonly sender?: string;
    readonly senderAllowed?: boolean;
  };
  readonly forwarded?: {
    readonly from?: string;
    readonly fromType?: string;
    readonly date?: string;
    readonly senderAllowed?: boolean;
  };
  readonly thread?: {
    readonly starterBody?: string;
    readonly historyBody?: string;
    readonly label?: string;
    readonly senderAllowed?: boolean;
  };
  readonly groupSystemPrompt?: string;
  readonly untrustedContext?: readonly unknown[];
}

export interface ConversationRuntimeMessageFacts {
  readonly id: string;
  readonly rawBody: string;
  readonly body?: string;
  readonly bodyForAgent?: string;
  readonly commandBody?: string;
  readonly inboundHistory?: string;
  readonly timestampMs?: number;
}

export interface ConversationRuntimeNormalizedTurnInput {
  readonly surface: ConversationRuntimeSurface;
  readonly channel: string;
  readonly accountId?: string;
  readonly message: ConversationRuntimeMessageFacts;
  readonly sender: ConversationRuntimeSenderFacts;
  readonly conversation: ConversationRuntimeConversationFacts;
  readonly route: ConversationRuntimeRouteFacts;
  readonly reply: ConversationRuntimeReplyPlanFacts;
  readonly access?: ConversationRuntimeAccessFacts;
  readonly attachments?: readonly ConversationRuntimeAttachment[];
  readonly supplemental?: ConversationRuntimeSupplementalContextFacts;
  readonly angelRoleProfile?: ConversationRuntimeAngelRoleProfile;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeTurnLogEvent {
  readonly stage: ConversationRuntimeStage;
  readonly event: "start" | "done" | "drop" | "handled" | "error" | (string & {});
  readonly channel: string;
  readonly occurredAtMs?: number;
  readonly accountId?: string;
  readonly messageId?: string;
  readonly sessionKey?: string;
  readonly admission?: ConversationRuntimeAdmission["kind"];
  readonly reason?: string;
  readonly error?: unknown;
}
