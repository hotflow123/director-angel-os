import type { ConversationRuntimeMemoryEvidenceRecord } from "./memory-evidence.js";
import type { ConversationRuntimeModelToolMessage } from "./model-tool-loop.js";
import type { ConversationRuntimeQueuePriority } from "./queue.js";
import type { ConversationRuntimeUnifiedEvent } from "./runtime-events.js";

export type ConversationRuntimeSurface = "desktop" | "weixin" | "host-api" | "cli" | (string & {});

export type ConversationRuntimeAudience = "user" | "operator" | "developer";

export type ConversationRuntimeIntentKind =
  | "production-start"
  | "production-confirm"
  | "production-supplement"
  | "learning-admit"
  | "comfyui-run"
  | "management-command"
  | "run-control"
  | "capability-intro"
  | "chat"
  | "ignore"
  | (string & {});

export type ConversationRuntimeResponsePolicy =
  | "result-first"
  | "review-gated"
  | "status-first"
  | "control-reply"
  | "silent";

export type ConversationRuntimeReplySource =
  | "model"
  | "tool-loop"
  | "local-command"
  | "structured-renderer"
  | "degraded-error";

export type ConversationRuntimeMemoryDecision =
  | {
      readonly action: "never-store";
      readonly reason: string;
    }
  | {
      readonly action: "transient";
      readonly reason: string;
    }
  | {
      readonly action: "candidate-review";
      readonly reason: string;
    }
  | {
      readonly action: "store-result-only";
      readonly reason: string;
    };

export interface ConversationRuntimeIntent {
  readonly kind: ConversationRuntimeIntentKind;
  readonly objective?: string;
  readonly supplement?: string;
  readonly command?: {
    readonly name: string;
    readonly raw: string;
    readonly args?: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  };
  readonly safety?: {
    readonly verdict: "allow" | "rewrite-required";
    readonly reason?: string;
    readonly safeRewriteObjective?: string;
    readonly ruleId?: string;
  };
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeAbilityGroup =
  | "text"
  | "vision"
  | "image_generation"
  | "video_generation";

export type ConversationRuntimeCapabilityIntentKind =
  | "text_chat"
  | "media_understanding"
  | "image_generation"
  | "video_generation";

export type ConversationRuntimeInputModality =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "link";

export type ConversationRuntimeOutputModality = "text" | "image" | "video";

export interface ConversationRuntimeModelCapabilities {
  readonly model?: string;
  readonly providerId?: string;
  readonly text?: boolean;
  readonly vision?: boolean;
  readonly imageUnderstanding?: boolean;
  readonly videoUnderstanding?: boolean;
  readonly mediaUnderstanding?: boolean;
  readonly capabilities?: readonly string[];
  readonly inputModalities?: readonly ConversationRuntimeInputModality[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeCapabilityRouteDecision {
  readonly abilityGroup: ConversationRuntimeAbilityGroup;
  readonly intentKind: ConversationRuntimeCapabilityIntentKind;
  readonly inputModalities: readonly ConversationRuntimeInputModality[];
  readonly outputModality: ConversationRuntimeOutputModality;
  readonly requiresMediaUnderstanding: boolean;
  readonly explicitGeneration: boolean;
  readonly reason: string;
  readonly textModelCanHandleVision?: boolean;
  readonly modelAbilityGroups?: readonly ConversationRuntimeAbilityGroup[];
}

export interface ConversationRuntimeTurnDecision {
  readonly intent: ConversationRuntimeIntent;
  readonly responsePolicy: ConversationRuntimeResponsePolicy;
  readonly audience: ConversationRuntimeAudience;
  readonly userText: string;
  readonly trace?: readonly ConversationRuntimeTraceItem[];
  readonly memoryDecision: ConversationRuntimeMemoryDecision;
  readonly capabilityRoute?: ConversationRuntimeCapabilityRouteDecision;
  readonly shouldInvokeRecall: boolean;
  readonly shouldCreateRun: boolean;
  readonly shouldAttachToActiveSession: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeEventKind =
  | "runtime.ack"
  | "runtime.partial"
  | "runtime.tool"
  | "runtime.approval"
  | "runtime.artifact"
  | "runtime.final"
  | "runtime.error"
  | "runtime.trace";

export type ConversationRuntimeAttachmentKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "link"
  | (string & {});

export type ConversationRuntimeDeliveryMode =
  | "plain-text"
  | "markdown"
  | "card"
  | "stream"
  | (string & {});

export type ConversationRuntimeTraceSource =
  | "runtime"
  | "channel"
  | "orchestrator"
  | "capability"
  | "model"
  | "tool"
  | "memory"
  | "session"
  | "approval"
  | (string & {});

export interface ConversationRuntimeSender {
  readonly id: string;
  readonly displayName?: string;
  readonly username?: string;
  readonly role?: "user" | "operator" | "developer" | "system" | (string & {});
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeAttachment {
  readonly id?: string;
  readonly kind: ConversationRuntimeAttachmentKind;
  readonly name?: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly url?: string;
  readonly path?: string;
  readonly sizeBytes?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeQuotedContext {
  readonly messageId?: string;
  readonly senderId?: string;
  readonly text?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeTrustedContext {
  readonly workspaceRoot?: string;
  readonly dataDir?: string;
  readonly activeRunId?: string;
  readonly activeSessionKey?: string;
  readonly activeEvidenceFrame?: Readonly<Record<string, unknown>>;
  readonly accountId?: string;
  readonly angelRoleProfile?: ConversationRuntimeAngelRoleProfile;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeAngelRoleProfile {
  readonly roleId: string;
  readonly title?: string;
  readonly domain?: string;
  readonly responsibilities?: readonly string[];
  readonly learningScope?: readonly string[];
  readonly controllableSystems?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeUntrustedChannelContext {
  readonly channel: string;
  readonly rawMessageId?: string;
  readonly rawThreadId?: string;
  readonly rawSenderId?: string;
  readonly payload?: unknown;
}

export interface ConversationRuntimeDeliveryCapabilities {
  readonly modes: readonly ConversationRuntimeDeliveryMode[];
  readonly supportsStreaming?: boolean;
  readonly supportsCards?: boolean;
  readonly supportsMarkdown?: boolean;
  readonly supportsApprovalActions?: boolean;
  readonly supportsFileLinks?: boolean;
  readonly maxMessageChars?: number;
}

export interface ConversationRuntimeInput {
  readonly surface: ConversationRuntimeSurface;
  readonly channel: string;
  readonly messageId: string;
  readonly sessionKey: string;
  readonly text: string;
  readonly receivedAtMs?: number;
  readonly accountId?: string;
  readonly sender: ConversationRuntimeSender;
  readonly queuePriority?: ConversationRuntimeQueuePriority;
  readonly attachments?: readonly ConversationRuntimeAttachment[];
  readonly quotedContext?: ConversationRuntimeQuotedContext;
  readonly trustedContext?: ConversationRuntimeTrustedContext;
  readonly untrustedChannelContext?: ConversationRuntimeUntrustedChannelContext;
  readonly deliveryCapabilities?: ConversationRuntimeDeliveryCapabilities;
  readonly history?: readonly ConversationRuntimeModelToolMessage[];
  readonly textModelCapabilities?: ConversationRuntimeModelCapabilities;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeToolSignal {
  readonly id: string;
  readonly name: string;
  readonly phase: "requested" | "started" | "completed" | "failed" | "skipped";
  readonly summary?: string;
  readonly inputPreview?: string;
  readonly outputPreview?: string;
  readonly requiresApproval?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeApprovalSignal {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  readonly summary?: string;
  readonly actionLabels?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeArtifactSignal {
  readonly id: string;
  readonly kind:
    | "run"
    | "blueprint"
    | "script"
    | "storyboard"
    | "prompt-pack"
    | "workflow"
    | "review"
    | (string & {});
  readonly title?: string;
  readonly path?: string;
  readonly url?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeTraceItem {
  readonly source: ConversationRuntimeTraceSource;
  readonly stage: string;
  readonly detail: string;
  readonly occurredAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeEventPayloadMap {
  readonly "runtime.ack": {
    readonly message: string;
  };
  readonly "runtime.partial": {
    readonly delta: string;
    readonly index: number;
  };
  readonly "runtime.tool": {
    readonly tool: ConversationRuntimeToolSignal;
  };
  readonly "runtime.approval": {
    readonly approval: ConversationRuntimeApprovalSignal;
  };
  readonly "runtime.artifact": {
    readonly artifact: ConversationRuntimeArtifactSignal;
  };
  readonly "runtime.final": {
    readonly text: string;
    readonly responsePolicy: ConversationRuntimeResponsePolicy;
    readonly audience: ConversationRuntimeAudience;
    readonly replySource?: ConversationRuntimeReplySource;
  };
  readonly "runtime.error": {
    readonly message: string;
    readonly code?: string;
    readonly recoverable?: boolean;
  };
  readonly "runtime.trace": {
    readonly trace: ConversationRuntimeTraceItem;
  };
}

export interface ConversationRuntimeEvent<
  K extends ConversationRuntimeEventKind = ConversationRuntimeEventKind,
> {
  readonly id: string;
  readonly kind: K;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly payload: ConversationRuntimeEventPayloadMap[K];
}

export interface ConversationRuntimeCapabilityHit {
  readonly id: string;
  readonly source: "knowledge" | "skill" | "memory" | "session" | (string & {});
  readonly title?: string;
  readonly status: "hit" | "miss" | "degraded" | "used";
  readonly score?: number;
  readonly summary?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeCapabilityPacket {
  readonly status: "hit" | "miss" | "degraded" | "skipped";
  readonly visibleSummary?: string;
  readonly hiddenPromptBlock?: string;
  readonly hits: readonly ConversationRuntimeCapabilityHit[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeOperatorTrace {
  readonly items: readonly ConversationRuntimeTraceItem[];
  readonly turnTrace?: readonly ConversationRuntimeTraceItem[];
}

export interface ConversationRuntimeUserFacingProjection {
  readonly userText: string;
  readonly briefStatus?: string;
  readonly canRetry?: boolean;
  readonly suggestedNextStep?: string;
  readonly attachments?: readonly ConversationRuntimeAttachment[];
  readonly developerTraceRef?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeResult {
  readonly turnId: string;
  readonly turnRunId?: string;
  readonly sessionKey: string;
  readonly replySource: ConversationRuntimeReplySource;
  readonly intent?: ConversationRuntimeIntent;
  readonly turn?: ConversationRuntimeTurnDecision;
  readonly events: readonly ConversationRuntimeEvent[];
  readonly runtimeEventsV1?: readonly ConversationRuntimeUnifiedEvent[];
  readonly finalText?: string;
  readonly responsePolicy?: ConversationRuntimeResponsePolicy;
  readonly memoryDecision?: ConversationRuntimeMemoryDecision;
  readonly capabilityRoute?: ConversationRuntimeCapabilityRouteDecision;
  readonly capabilityPacket?: ConversationRuntimeCapabilityPacket;
  readonly runId?: string;
  readonly artifactIds?: readonly string[];
  readonly approvalIds?: readonly string[];
  readonly memoryEvidenceRecords?: readonly ConversationRuntimeMemoryEvidenceRecord[];
  readonly transcriptMessages?: readonly ConversationRuntimeModelToolMessage[];
  readonly userFacingProjection?: ConversationRuntimeUserFacingProjection;
  readonly operatorTrace: ConversationRuntimeOperatorTrace;
}

export function mapRuntimeSurfaceToTurnSurface(
  surface: ConversationRuntimeSurface,
): "desktop" | "weixin" | "cli" | "api" | (string & {}) {
  if (surface === "host-api") {
    return "api";
  }
  return surface;
}

export function createConversationRuntimeEvent<K extends ConversationRuntimeEventKind>(input: {
  readonly id: string;
  readonly kind: K;
  readonly turnId: string;
  readonly sessionKey: string;
  readonly occurredAtMs: number;
  readonly payload: ConversationRuntimeEventPayloadMap[K];
}): ConversationRuntimeEvent<K> {
  return input;
}
