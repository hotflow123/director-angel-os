import type {
  ChannelCommandActiveSessionPolicy,
  ChannelCommandMemoryPolicy,
  ChannelCommandOutputPolicy,
  ChannelSlashCommandEnvelope,
} from "./channel-command-registry.js";

export type ConversationTurnSurface = "desktop" | "weixin" | "cli" | "api" | (string & {});

export type ConversationTurnAudience = "user" | "operator" | "developer";

export type ConversationTurnIntentKind =
  | "production-start"
  | "production-confirm"
  | "production-supplement"
  | "learning-admit"
  | "learning-confirmation"
  | "comfyui-run"
  | "management-command"
  | "run-control"
  | "capability-intro"
  | "chat"
  | "ignore";

export type ConversationTurnAbilityGroup =
  | "text"
  | "vision"
  | "image_generation"
  | "video_generation";

export type ConversationTurnCapabilityIntentKind =
  | "text_chat"
  | "media_understanding"
  | "image_generation"
  | "video_generation";

export type ConversationTurnInputModality = "text" | "image" | "video" | "audio" | "file" | "link";

export type ConversationTurnOutputModality = "text" | "image" | "video";

export type ConversationTurnResponsePolicy =
  | "result-first"
  | "review-gated"
  | "status-first"
  | "control-reply"
  | "silent";

export type ConversationTurnMemoryDecision =
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

export interface ConversationTurnActiveSessionSnapshot {
  readonly hasActiveSession: boolean;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly objective?: string;
  readonly awaitingConfirmation?: boolean;
  readonly pendingReviewCount?: number;
}

export interface ConversationTurnAngelRoleProfile {
  readonly roleId: string;
  readonly title?: string;
  readonly domain?: string;
  readonly responsibilities?: readonly string[];
  readonly learningScope?: readonly string[];
  readonly controllableSystems?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationTurnAttachment {
  readonly id?: string;
  readonly kind: ConversationTurnInputModality | (string & {});
  readonly name?: string;
  readonly mimeType?: string;
  readonly text?: string;
  readonly url?: string;
  readonly path?: string;
  readonly sizeBytes?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationTurnModelCapabilities {
  readonly model?: string;
  readonly providerId?: string;
  readonly text?: boolean;
  readonly vision?: boolean;
  readonly imageUnderstanding?: boolean;
  readonly videoUnderstanding?: boolean;
  readonly mediaUnderstanding?: boolean;
  readonly capabilities?: readonly string[];
  readonly inputModalities?: readonly ConversationTurnInputModality[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationTurnCapabilityRouteDecision {
  readonly abilityGroup: ConversationTurnAbilityGroup;
  readonly intentKind: ConversationTurnCapabilityIntentKind;
  readonly inputModalities: readonly ConversationTurnInputModality[];
  readonly outputModality: ConversationTurnOutputModality;
  readonly requiresMediaUnderstanding: boolean;
  readonly explicitGeneration: boolean;
  readonly reason: string;
  readonly textModelCanHandleVision?: boolean;
  readonly modelAbilityGroups?: readonly ConversationTurnAbilityGroup[];
}

export interface ConversationTurnInput {
  readonly text: string;
  readonly surface: ConversationTurnSurface;
  readonly channel?: string;
  readonly agentId?: string;
  readonly peerId?: string;
  readonly sessionKey?: string;
  readonly activeSession?: ConversationTurnActiveSessionSnapshot;
  readonly angelRoleProfile?: ConversationTurnAngelRoleProfile;
  readonly attachments?: readonly ConversationTurnAttachment[];
  readonly textModelCapabilities?: ConversationTurnModelCapabilities;
  readonly contentSafetyMode?: "standard" | "developer-debug";
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationTurnTraceEvent {
  readonly stage:
    | "input-normalized"
    | "capability-route-decided"
    | "slash-command-detected"
    | "active-session-intent-detected"
    | "intent-decided"
    | "memory-admission-decided"
    | "safety-evaluated";
  readonly detail: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationTurnIntent {
  readonly kind: ConversationTurnIntentKind;
  readonly objective?: string;
  readonly supplement?: string;
  readonly command?: ChannelSlashCommandEnvelope;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly safety?: {
    readonly verdict: "allow" | "rewrite-required";
    readonly reason?: string;
    readonly safeRewriteObjective?: string;
    readonly ruleId?: string;
  };
}

export interface ConversationTurnResult {
  readonly intent: ConversationTurnIntent;
  readonly responsePolicy: ConversationTurnResponsePolicy;
  readonly audience: ConversationTurnAudience;
  readonly userText: string;
  readonly operatorTrace: readonly ConversationTurnTraceEvent[];
  readonly memoryDecision: ConversationTurnMemoryDecision;
  readonly capabilityRoute?: ConversationTurnCapabilityRouteDecision;
  readonly shouldInvokeRecall: boolean;
  readonly shouldCreateRun: boolean;
  readonly shouldAttachToActiveSession: boolean;
}

export function mapCommandOutputPolicy(
  policy: ChannelCommandOutputPolicy,
): ConversationTurnResponsePolicy {
  return policy;
}

export function mapCommandMemoryPolicy(
  policy: ChannelCommandMemoryPolicy,
): ConversationTurnMemoryDecision {
  if (policy === "never-store") {
    return {
      action: "never-store",
      reason: "命令声明为 never-store，不进入长期记忆或经验候选。",
    };
  }
  if (policy === "transient") {
    return {
      action: "transient",
      reason: "命令只影响当前会话或运行状态，不沉淀为经验。",
    };
  }
  if (policy === "review-gated-source") {
    return {
      action: "candidate-review",
      reason: "学习/沉淀类命令只能生成待审候选，不能直接发布为经验。",
    };
  }
  return {
    action: "store-result-only",
    reason: "只允许保存经过执行产出的结果摘要，不保存原始闲聊。",
  };
}

export function isRunControlPolicy(policy: ChannelCommandActiveSessionPolicy): boolean {
  return policy === "status-only" || policy === "interrupt-current";
}
