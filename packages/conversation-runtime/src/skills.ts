export interface ConversationRuntimeSkillCommand {
  readonly command: string;
  readonly name: string;
  readonly description: string;
  readonly skillPath?: string;
  readonly skillDir?: string;
  readonly source?: "local" | "external" | "bundled" | "remote" | (string & {});
  readonly userInvocable?: boolean;
  readonly modelInvocable?: boolean;
  readonly requiresApproval?: boolean;
  readonly disabled?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillCommandReloadResult {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: readonly string[];
  readonly total: number;
  readonly commands: readonly ConversationRuntimeSkillCommand[];
}

export interface ConversationRuntimeSkillIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly source?: "local" | "external" | "bundled" | "remote" | (string & {});
  readonly userInvocable?: boolean;
  readonly modelInvocable?: boolean;
  readonly requiresApproval?: boolean;
  readonly disabled?: boolean;
  readonly score?: number;
  readonly runtimeContract?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillViewRequest {
  readonly skillId: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillViewPacket {
  readonly skillId: string;
  readonly title: string;
  readonly content: string;
  readonly status: "loaded" | "missing" | "disabled" | "degraded";
  readonly description?: string;
  readonly source?: ConversationRuntimeSkillIndexEntry["source"];
  readonly tags?: readonly string[];
  readonly allowedTools?: readonly string[];
  readonly requiresApproval?: boolean;
  readonly runtimeContract?: Readonly<Record<string, unknown>>;
  readonly setupOnLoad?: Readonly<Record<string, unknown>>;
  readonly fallback?: Readonly<Record<string, unknown>>;
  readonly guard?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillUseRequest {
  readonly skillId: string;
  readonly args?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillUsageRecord {
  readonly skillId: string;
  readonly action: "hit" | "view" | "use" | "patch" | "failure";
  readonly status: "ok" | "missing" | "disabled" | "approval-required" | "failed";
  readonly occurredAtMs: number;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillRuntimePort {
  readonly listIndex: (input: {
    readonly userText: string;
    readonly limit?: number;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }) =>
    | Promise<readonly ConversationRuntimeSkillIndexEntry[]>
    | readonly ConversationRuntimeSkillIndexEntry[];
  readonly view: (
    input: ConversationRuntimeSkillViewRequest,
  ) => Promise<ConversationRuntimeSkillViewPacket> | ConversationRuntimeSkillViewPacket;
  readonly use: (
    input: ConversationRuntimeSkillUseRequest,
  ) => Promise<ConversationRuntimeSkillToolOutput> | ConversationRuntimeSkillToolOutput;
  readonly recordUsage?: (input: ConversationRuntimeSkillUsageRecord) => Promise<void> | void;
}

export type ConversationRuntimeSkillRuntimeEvent =
  | {
      readonly kind: "skill.hit";
      readonly skill: ConversationRuntimeSkillIndexEntry;
    }
  | {
      readonly kind: "skill.view";
      readonly packet: ConversationRuntimeSkillViewPacket;
    }
  | {
      readonly kind: "skill.use";
      readonly skillId: string;
      readonly output: ConversationRuntimeSkillToolOutput;
    };

export interface ConversationRuntimeSkillToolInput {
  readonly skill: string;
  readonly args?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ConversationRuntimeSkillToolOutput =
  | {
      readonly success: boolean;
      readonly commandName: string;
      readonly status: "inline";
      readonly allowedTools?: readonly string[];
      readonly model?: string;
      readonly runtimeDelta?: ConversationRuntimeSkillRuntimeDelta;
      readonly runtimeContract?: Readonly<Record<string, unknown>>;
      readonly setupOnLoad?: Readonly<Record<string, unknown>>;
      readonly fallback?: Readonly<Record<string, unknown>>;
      readonly guard?: Readonly<Record<string, unknown>>;
      readonly metadata?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly success: boolean;
      readonly commandName: string;
      readonly status: "forked";
      readonly agentId: string;
      readonly result: string;
      readonly runtimeDelta?: ConversationRuntimeSkillRuntimeDelta;
      readonly runtimeContract?: Readonly<Record<string, unknown>>;
      readonly setupOnLoad?: Readonly<Record<string, unknown>>;
      readonly fallback?: Readonly<Record<string, unknown>>;
      readonly guard?: Readonly<Record<string, unknown>>;
      readonly metadata?: Readonly<Record<string, unknown>>;
    };

export interface ConversationRuntimeSkillRuntimeDelta {
  readonly allowedTools?: readonly string[];
  readonly model?: string;
  readonly reasoningEffort?: "low" | "medium" | "high" | "xhigh" | (string & {});
  readonly newMessages?: readonly ConversationRuntimeSkillMessage[];
}

export interface ConversationRuntimeSkillMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ConversationRuntimeSkillLoadPacket {
  readonly name: string;
  readonly content: string;
  readonly skillDir?: string;
  readonly supportingFiles?: readonly string[];
  readonly setupNote?: string;
  readonly runtimeNote?: string;
  readonly userInstruction?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
