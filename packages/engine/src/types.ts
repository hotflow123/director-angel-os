import type {
  DynamicContextAssembler,
  PromptSection,
  PromptSectionContributor,
} from "@hotflow/context";
import type {
  EstimatedComplexity,
  ReasoningStrategy,
  ReasoningStrategyDecision,
  RuntimeDegradeSurface,
  TaskItemStatus,
  TaskPriority,
  TaskState,
} from "@hotflow/contracts";
import type { MemoryCoreManager } from "@hotflow/memory-core";
import type { ModelRuntime, ModelToolDefinition } from "@hotflow/models";
import type { Logger } from "@hotflow/observability";
import type { JsonObject, SessionStore } from "@hotflow/sessions";
import type { TaskBoard } from "@hotflow/tasks-core";
import type { ToolDispatcher, ToolExecutionResult } from "@hotflow/tools";

export interface TurnInput {
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly userText: string;
  readonly providerId: string;
  readonly model: string;
  readonly tokenBudget?: number;
  readonly maxSteps?: number;
  readonly reasoningStrategy?: ReasoningStrategy;
  readonly estimatedComplexity?: EstimatedComplexity;
  readonly requiresTools?: boolean;
  readonly latencyBudgetMs?: number;
}

export interface PersistedTaskItem extends JsonObject {
  readonly id: string;
  readonly content: string;
  readonly status: TaskItemStatus;
  readonly priority?: TaskPriority;
}

export interface PersistedTaskState extends JsonObject {
  readonly items: PersistedTaskItem[];
  readonly updatedAtMs?: number;
}

export interface PersistedTurnState extends JsonObject {
  readonly tasks: PersistedTaskState;
  readonly lastAssistantOutput?: string;
}

export interface TurnResult {
  readonly sessionId: string;
  readonly output: string;
  readonly taskState: TaskState;
  readonly toolResults: readonly ToolExecutionResult[];
  readonly reasoningDecision?: ReasoningStrategyDecision;
}

export type EngineContextAssembler = Pick<DynamicContextAssembler, "build">;
export type EngineMemory = Pick<MemoryCoreManager, "writeLayer0" | "recallWorkingMemory"> &
  Partial<Pick<MemoryCoreManager, "writeLayer1">>;
export type EngineModelRuntime = Pick<ModelRuntime, "generate">;
export type EngineSessionStoreBase = Pick<
  SessionStore,
  | "appendJournal"
  | "createCheckpoint"
  | "createSession"
  | "getSession"
  | "recover"
  | "recordRuntimeEvidence"
  | "updateMetadata"
>;
export type EngineSessionStoreStepRuntime = Pick<
  SessionStore,
  "appendStepJournal" | "createStepCheckpoint" | "recoverStep"
>;
export type EngineSessionStoreStreamRuntime = Pick<
  SessionStore,
  "appendStreamEvent" | "listStreamEvents"
>;
export type EngineSessionStoreHandoffRuntime = Pick<SessionStore, "createHandoffSummary">;
export type EngineSessionStore = EngineSessionStoreBase &
  Partial<EngineSessionStoreStepRuntime> &
  Partial<EngineSessionStoreStreamRuntime> &
  Partial<EngineSessionStoreHandoffRuntime>;
export type EngineToolDispatcher = Pick<ToolDispatcher, "dispatch"> & {
  readonly getSchemas?: (toolset?: string) => readonly ModelToolDefinition[];
  readonly managesJournalClosure?: boolean;
};
export type EnginePromptSectionContributor = PromptSectionContributor;

export interface EngineDependencies {
  readonly contextAssembler: EngineContextAssembler;
  readonly createDispatcher: (board: TaskBoard) => EngineToolDispatcher;
  readonly logger?: Logger;
  readonly memory: EngineMemory;
  readonly modelRuntime: EngineModelRuntime;
  readonly promptSectionContributors?: readonly EnginePromptSectionContributor[];
  readonly sessionStore: EngineSessionStore;
  readonly workspaceRoot: string;
}

export interface ModelLoopContext {
  readonly turnId: string;
  readonly providerId: string;
  readonly model: string;
  readonly sessionId: string;
  readonly tokenBudget: number;
  readonly maxSteps: number;
}

export interface PromptArtifacts {
  readonly prompt: string;
  readonly staticPrompt: string;
  readonly dynamicPrompt: string;
  readonly staticSections: readonly PromptArtifactSectionSummary[];
  readonly staticSectionIds: readonly string[];
  readonly dynamicSections: readonly PromptArtifactSectionSummary[];
  readonly dynamicSectionIds: readonly string[];
  readonly omittedSections: readonly PromptArtifactSectionSummary[];
  readonly omittedSectionIds: readonly string[];
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly runtimeDegradations?: readonly RuntimeDegradeSurface[];
}

export interface PromptArtifactSectionSummary {
  readonly id: string;
  readonly cacheBucket: PromptSection["cacheBucket"];
  readonly owner?: PromptSection["owner"];
  readonly priority?: number;
  readonly metadataKeys?: readonly string[];
  readonly metadataPreview?: Readonly<Record<string, string | number | boolean>>;
}
