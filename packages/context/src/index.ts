import {
  type RuntimeDegradeSurface,
  type TaskState,
  createContractError,
  createRuntimeDegradeSurface,
} from "@hotflow/contracts";

export type CacheBucket = "static" | "dynamic";
export type PromptSectionOwner = "system" | "runtime" | "memory" | "plugin" | "skill" | "user";

export interface PromptSection {
  id: string;
  content: string;
  cacheBucket: CacheBucket;
  owner?: PromptSectionOwner;
  priority?: number;
  tokenCost?: number;
  metadata?: Record<string, unknown>;
}

export interface AssembleContextInput {
  tokenBudget: number;
  dynamicSections?: PromptSection[];
}

export interface TokenBudgetResult {
  included: PromptSection[];
  omitted: PromptSection[];
  usedTokens: number;
  remainingTokens: number;
}

export interface CacheBoundaryResult {
  staticSections: PromptSection[];
  dynamicSections: PromptSection[];
  staticPrompt: string;
  dynamicPrompt: string;
}

export interface AssembledContext {
  prompt: string;
  cacheBoundary: CacheBoundaryResult;
  budget: TokenBudgetResult;
}

export type TokenEstimator = (text: string) => number;
export type DynamicSectionCompactor = (sections: PromptSection[]) => PromptSection[];

export interface ContextToolResult {
  id?: string;
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: unknown;
  priority?: number;
}

export interface ContextRecallItem {
  id?: string;
  layer?: string;
  content: string;
  score?: number;
  priority?: number;
}

export interface RecallDegrade {
  reason: string;
  message?: string;
}

export interface RecallBlock {
  blockId: string;
  source?: string;
  items: ContextRecallItem[];
  degraded?: RecallDegrade;
  priority?: number;
}

export interface RebuildDynamicContextInput {
  tokenBudget: number;
  compactor?: DynamicSectionCompactor;
}

export interface TurnContextAssembler {
  build(input: AssembleContextInput): AssembledContext;
}

interface CachedTurnValueEntry {
  fingerprint: string;
  value: unknown;
}

interface CachedRebuildEntry {
  tokenBudget: number;
  compactor: DynamicSectionCompactor;
  stateVersion: number;
  assembled: AssembledContext;
}

const DEFAULT_PRIORITY = 0;
const USER_INPUT_PRIORITY = 100;
const TURN_RESUME_PRIORITY = 96;
const SESSION_GUIDANCE_PRIORITY = 95;
const RUNTIME_DEGRADATION_PRIORITY = 94;
const SESSION_LATEST_TURN_PRIORITY = 93;
const TOOL_RUNTIME_GUIDANCE_PRIORITY = 91;
const TOOL_RESULT_PRIORITY = 90;
const TASK_STATE_PRIORITY = 80;
const MEMORY_RECALL_PRIORITY = 70;
const TOOL_RUNTIME_METADATA_PREVIEW_LIMIT = 3;
const TOOL_RUNTIME_METADATA_PREVIEW_CHAR_LIMIT = 80;
const DEFAULT_RECALL_BLOCK_SOURCE = "working-memory";
const DEFAULT_PROTECTED_STATIC_SECTION_IDS = ["system"] as const;

export function estimateTokens(text: string): number {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function renderSection(section: PromptSection): string {
  return `## ${section.id}\n${section.content.trim()}`;
}

export function compactDynamicSections(sections: PromptSection[]): PromptSection[] {
  const deduped = new Map<string, PromptSection>();
  for (const section of sections) {
    deduped.set(section.id, section);
  }
  return [...deduped.values()];
}

export function createUserInputSection(content: string): PromptSection {
  return {
    id: "user-input",
    cacheBucket: "dynamic",
    priority: USER_INPUT_PRIORITY,
    content,
  };
}

export function createTaskStateSection(content: string): PromptSection {
  return {
    id: "task-state",
    cacheBucket: "dynamic",
    priority: TASK_STATE_PRIORITY,
    content,
  };
}

export function createToolResultSections(
  results: ContextToolResult[],
  startIndex = 0,
): PromptSection[] {
  return results.map((result, index) => {
    const payload = result.ok ? (result.output ?? null) : (result.error ?? null);
    return {
      id: `tool-result-${startIndex + index + 1}`,
      cacheBucket: "dynamic",
      priority: result.priority ?? TOOL_RESULT_PRIORITY,
      ...(result.id !== undefined
        ? {
            metadata: {
              sourceToolCallId: result.id,
            },
          }
        : {}),
      content: [
        `Tool: ${result.toolName}`,
        `Success: ${String(result.ok)}`,
        `Payload: ${JSON.stringify(payload)}`,
      ].join("\n"),
    };
  });
}

export function createRecallSections(items: ContextRecallItem[], startIndex = 0): PromptSection[] {
  return items.map((item, index) => {
    const details = [`Layer: ${item.layer ?? "unknown"}`];
    if (item.score !== undefined) {
      details.push(`Score: ${item.score.toFixed(3)}`);
    }
    details.push(item.content);
    return {
      id: `memory-recall-${startIndex + index + 1}`,
      cacheBucket: "dynamic",
      priority: item.priority ?? MEMORY_RECALL_PRIORITY,
      ...(item.id !== undefined
        ? {
            metadata: {
              sourceMemoryId: item.id,
            },
          }
        : {}),
      content: details.join("\n"),
    };
  });
}

export function createRecallSectionsFromBlock(block: RecallBlock): PromptSection[] {
  const blockPriority = block.priority ?? MEMORY_RECALL_PRIORITY;
  const sections = createRecallSections(
    block.items.map((item) => ({
      ...item,
      priority: item.priority ?? blockPriority,
    })),
  );

  for (const [index, section] of sections.entries()) {
    if (section.id.startsWith("memory-recall-")) {
      section.id = `${block.blockId}.recall-${index + 1}`;
    }
  }

  if (block.degraded === undefined) {
    return sections;
  }

  const degradeDetails = [`Recall degraded: ${block.degraded.reason}`];
  if (block.degraded.message !== undefined) {
    degradeDetails.push(block.degraded.message);
  }

  return [
    {
      id: `${block.blockId}.degraded`,
      cacheBucket: "dynamic",
      owner: "memory",
      priority: blockPriority + 1,
      content: [`Source: ${block.source ?? DEFAULT_RECALL_BLOCK_SOURCE}`, ...degradeDetails].join(
        "\n",
      ),
    },
    ...sections,
  ];
}

export interface SessionPromptPreferences {
  outputStyle?: string;
  permissionMode?: string;
  responseLanguage?: string;
}

export type ToolRuntimeGuidanceStatus = "blocked" | "degraded" | "failed";

export interface ToolRuntimeGuidanceSummary {
  status?: ToolRuntimeGuidanceStatus;
  impactedTools?: number;
  previewedTools?: number;
  previewTruncated?: boolean;
  toolPreview?: string;
  metaImpactedTools?: number;
  metaPreviewedTools?: number;
  metaPreviewTruncated?: boolean;
  toolMetaPreview?: string;
}

export interface TurnResumePromptState {
  resumed: boolean;
  resumeAction: string;
  nextStepIndex: number;
  replayWindow?: {
    fromSeqExclusive: number;
    toSeqInclusive: number;
  };
  recoveredToolResults?: number;
  lastStepEventType?: string;
}

export interface LatestTurnReasoningSummary {
  strategy?: string;
  confidence?: number;
  rationale?: string;
  suggestedAction?: string;
}

export interface SessionLatestTurnPromptState {
  turnId: string;
  runtimeStatus: string;
  turnBranch: string;
  finishReason?: string;
  completedSteps?: number;
  lastStepEventType?: string;
  resumeAction?: string;
  nextStepIndex?: number;
  toolCount?: number;
  toolOutcomes?: LatestTurnToolOutcomeSummary;
  reasoning?: LatestTurnReasoningSummary;
  toolRuntimeGuidance?: ToolRuntimeGuidanceSummary;
  runtimeDegradationSummaries?: readonly string[];
  updatedAtMs?: number;
}

export interface LatestTurnToolOutcomeSummary {
  total: number;
  executed: number;
  denied: number;
  approvalRequired: number;
  degraded: number;
  failed: number;
  missing: number;
  unknown: number;
}

export interface ToolRuntimePromptObservation {
  toolName: string;
  ok: boolean;
  resolution?: string;
  error?: string;
  metadataPreview?: Readonly<Record<string, string | number | boolean>>;
  degradation?: RuntimeDegradeSurface;
  policyDecision?: {
    verdict?: string;
    reason?: string;
  };
}

export interface RuntimeDegradationSummaryInput {
  reason: string;
  severity: string;
  message: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface PromptSectionContributorInput {
  userInput?: string;
  taskState?: Pick<TaskState, "items">;
  taskStatePrompt?: string;
  availableTools?: readonly string[];
  availableToolsets?: readonly string[];
  toolResults?: readonly ContextToolResult[];
  recall?: readonly ContextRecallItem[];
  recallBlocks?: readonly RecallBlock[];
  sessionMetadata?: unknown;
  currentTurnId?: string;
  turnResumeState?: TurnResumePromptState;
  runtimeDegradations?: readonly RuntimeDegradeSurface[];
  toolObservations?: readonly ToolRuntimePromptObservation[];
}

export interface PromptSectionContributor {
  id: string;
  buildSections: (input: PromptSectionContributorInput) => readonly PromptSection[];
  resolveFingerprint?: (input: PromptSectionContributorInput) => string;
}

export interface RuntimePromptSectionsInput {
  sessionMetadata: unknown;
  currentTurnId?: string;
  turnResumeState?: TurnResumePromptState;
  runtimeDegradations?: readonly RuntimeDegradeSurface[];
  toolObservations?: readonly ToolRuntimePromptObservation[];
  turnContext?: MultiStepTurnContext;
  contributors?: readonly PromptSectionContributor[];
  contributorInput?: PromptSectionContributorInput;
  extraSections?: readonly PromptSection[];
}

export interface MultiStepTurnStateInput {
  userInput?: string;
  taskState?: string;
  toolResults?: readonly ContextToolResult[];
  recall?: readonly ContextRecallItem[];
  recallBlock?: RecallBlock;
  recallBlocks?: readonly RecallBlock[];
  customDynamicSections?: readonly PromptSection[];
}

export interface WorkingMemoryPromptState {
  recallBlock?: WorkingMemoryPromptRecallBlock;
  runtimeDegradations: readonly RuntimeDegradeSurface[];
}

export interface WorkingMemoryPromptRecallScope {
  sessionId?: string;
}

export interface WorkingMemoryPromptRecallOptions {
  blockId?: string;
  scope: WorkingMemoryPromptRecallScope;
  query?: string;
  limit?: number;
  minScore?: number;
}

export interface WorkingMemoryPromptRecallBlockItem extends ContextRecallItem {
  updatedAt?: number;
}

export interface WorkingMemoryPromptRecallBlock extends RecallBlock {
  source: "working-memory";
  scope: WorkingMemoryPromptRecallScope;
  query?: string;
  items: WorkingMemoryPromptRecallBlockItem[];
}

export function readSessionPromptPreferences(metadata: unknown): SessionPromptPreferences {
  if (!isRecord(metadata)) {
    return {};
  }

  const preferences = isRecord(metadata.preferences) ? metadata.preferences : undefined;
  if (preferences === undefined) {
    return {};
  }

  const outputStyle = readString(preferences.outputStyle);
  const permissionMode = readString(preferences.permissionMode);
  const responseLanguage = readString(preferences.responseLanguage);

  return {
    ...(outputStyle === undefined ? {} : { outputStyle }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
  };
}

export function createSessionGuidanceSections(metadata: unknown): PromptSection[] {
  const preferences = readSessionPromptPreferences(metadata);
  const sections: PromptSection[] = [];

  if (preferences.outputStyle !== undefined) {
    sections.push({
      id: "session.output-style",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: SESSION_GUIDANCE_PRIORITY,
      metadata: {
        outputStyle: preferences.outputStyle,
        source: "session-override",
      },
      content: [
        "Session-specific output style guidance overrides runtime defaults for this turn.",
        `Output style: ${preferences.outputStyle}`,
        renderSessionOutputStyleGuidance(preferences.outputStyle),
      ].join("\n"),
    });
  }

  if (preferences.permissionMode !== undefined) {
    sections.push({
      id: "session.permission-mode",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: SESSION_GUIDANCE_PRIORITY - 1,
      metadata: {
        permissionMode: preferences.permissionMode,
        source: "session-override",
      },
      content: [
        "Session-specific permission guidance overrides runtime defaults for this turn.",
        `Permission mode: ${preferences.permissionMode}`,
        renderSessionPermissionModeGuidance(preferences.permissionMode),
      ].join("\n"),
    });
  }

  if (preferences.responseLanguage !== undefined) {
    sections.push({
      id: "session.response-language",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: SESSION_GUIDANCE_PRIORITY - 2,
      metadata: {
        responseLanguage: preferences.responseLanguage,
        source: "session-override",
      },
      content: [
        "Session-specific response language guidance overrides runtime defaults for this turn.",
        `Response language: ${preferences.responseLanguage}`,
        renderSessionResponseLanguageGuidance(preferences.responseLanguage),
      ].join("\n"),
    });
  }

  return sections;
}

export function readSessionLatestTurnPromptState(
  metadata: unknown,
): SessionLatestTurnPromptState | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const runtime = isRecord(metadata.runtime) ? metadata.runtime : undefined;
  const latestTurn = runtime && isRecord(runtime.latestTurn) ? runtime.latestTurn : undefined;
  if (latestTurn === undefined) {
    return undefined;
  }

  const turnId = readString(latestTurn.turnId);
  const runtimeStatus = readString(latestTurn.runtimeStatus);
  const turnBranch = readString(latestTurn.turnBranch);
  if (turnId === undefined || runtimeStatus === undefined || turnBranch === undefined) {
    return undefined;
  }

  const finishReason = readString(latestTurn.finishReason);
  const completedSteps =
    typeof latestTurn.completedSteps === "number" ? latestTurn.completedSteps : undefined;
  const lastStepEventType = readString(latestTurn.lastStepEventType);
  const resumeAction = readString(latestTurn.resumeAction);
  const nextStepIndex =
    typeof latestTurn.nextStepIndex === "number" ? latestTurn.nextStepIndex : undefined;
  const toolCount = typeof latestTurn.toolCount === "number" ? latestTurn.toolCount : undefined;
  const toolOutcomes = readLatestTurnToolOutcomeSummary(latestTurn.toolOutcomes);
  const reasoning = readLatestTurnReasoningSummary(latestTurn.reasoning);
  const toolRuntimeGuidance = readToolRuntimeGuidanceSummary(latestTurn.toolRuntimeGuidance);
  const runtimeDegradationSummaries = readOptionalStringArray(
    latestTurn.runtimeDegradationSummaries,
  );
  const updatedAtMs =
    typeof latestTurn.updatedAtMs === "number" ? latestTurn.updatedAtMs : undefined;

  return {
    turnId,
    runtimeStatus,
    turnBranch,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(completedSteps === undefined ? {} : { completedSteps }),
    ...(lastStepEventType === undefined ? {} : { lastStepEventType }),
    ...(resumeAction === undefined ? {} : { resumeAction }),
    ...(nextStepIndex === undefined ? {} : { nextStepIndex }),
    ...(toolCount === undefined ? {} : { toolCount }),
    ...(toolOutcomes === undefined ? {} : { toolOutcomes }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
    ...(runtimeDegradationSummaries === undefined ? {} : { runtimeDegradationSummaries }),
    ...(updatedAtMs === undefined ? {} : { updatedAtMs }),
  };
}

export function createSessionLatestTurnGuidanceSections(
  metadata: unknown,
  options: {
    currentTurnId?: string;
  } = {},
): PromptSection[] {
  const latestTurn = readSessionLatestTurnPromptState(metadata);
  if (
    latestTurn === undefined ||
    (options.currentTurnId !== undefined && latestTurn.turnId === options.currentTurnId)
  ) {
    return [];
  }

  return [
    {
      id: "session.latest-turn",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: SESSION_LATEST_TURN_PRIORITY,
      metadata: {
        turnId: latestTurn.turnId,
        runtimeStatus: latestTurn.runtimeStatus,
        turnBranch: latestTurn.turnBranch,
        ...(latestTurn.reasoning?.strategy === undefined
          ? {}
          : { reasoningStrategy: latestTurn.reasoning.strategy }),
        ...(latestTurn.reasoning?.confidence === undefined
          ? {}
          : { reasoningConfidence: latestTurn.reasoning.confidence }),
        ...(latestTurn.reasoning?.rationale === undefined
          ? {}
          : { reasoningRationale: latestTurn.reasoning.rationale }),
        ...(latestTurn.reasoning?.suggestedAction === undefined
          ? {}
          : { reasoningSuggestedAction: latestTurn.reasoning.suggestedAction }),
      },
      content: [
        "Latest known turn state from this session:",
        `Turn ID: ${latestTurn.turnId}`,
        `Runtime status: ${latestTurn.runtimeStatus}`,
        `Turn branch: ${latestTurn.turnBranch}`,
        ...(latestTurn.finishReason === undefined
          ? []
          : [`Finish reason: ${latestTurn.finishReason}`]),
        ...(latestTurn.completedSteps === undefined
          ? []
          : [`Completed steps: ${latestTurn.completedSteps}`]),
        ...(latestTurn.lastStepEventType === undefined
          ? []
          : [`Last step event: ${latestTurn.lastStepEventType}`]),
        ...(latestTurn.resumeAction === undefined
          ? []
          : [`Suggested resume action: ${latestTurn.resumeAction}`]),
        ...(latestTurn.nextStepIndex === undefined
          ? []
          : [`Suggested next step index: ${latestTurn.nextStepIndex}`]),
        ...createSessionLatestTurnUnfinishedWorkLines(latestTurn),
        ...(latestTurn.toolCount === undefined ? [] : [`Tool count: ${latestTurn.toolCount}`]),
        ...(latestTurn.toolOutcomes === undefined
          ? []
          : [`Tool outcomes: ${formatLatestTurnToolOutcomeSummary(latestTurn.toolOutcomes)}`]),
        ...createSessionLatestTurnReasoningLines(latestTurn),
        ...createSessionLatestTurnToolRuntimeGuidanceLines(latestTurn),
        ...createSessionLatestTurnRuntimeDegradationLines(latestTurn),
        renderSessionLatestTurnGuidance(
          latestTurn.runtimeStatus,
          latestTurn.finishReason,
          latestTurn.lastStepEventType,
          latestTurn.resumeAction,
          latestTurn.nextStepIndex,
        ),
      ].join("\n"),
    },
  ];
}

function createSessionLatestTurnUnfinishedWorkLines(state: SessionLatestTurnPromptState): string[] {
  if (
    state.finishReason === "length" &&
    state.resumeAction === "start-next-step" &&
    state.nextStepIndex !== undefined &&
    state.lastStepEventType === "step.tool_result"
  ) {
    return [
      `Unfinished work: Start at step ${state.nextStepIndex} and turn the recorded tool results into the next reasoning/output step before planning duplicate tool calls.`,
    ];
  }

  if (
    state.finishReason === "length" &&
    state.resumeAction === "continue-current-step" &&
    state.nextStepIndex !== undefined
  ) {
    return [
      `Unfinished work: Resume step ${state.nextStepIndex} and finish the interrupted step before branching into new work.`,
    ];
  }

  if (
    state.finishReason === "failed" &&
    state.resumeAction === "continue-current-step" &&
    state.nextStepIndex !== undefined
  ) {
    return [
      `Unfinished work: Rebuild step ${state.nextStepIndex} from confirmed state and treat the interrupted step as incomplete until it succeeds.`,
    ];
  }

  if (state.runtimeStatus === "blocked") {
    return [
      "Unfinished work: Surface the blocked action plus the required approval or policy change before retrying anything.",
    ];
  }

  return [];
}

export function createTurnResumeGuidanceSections(
  state: TurnResumePromptState | undefined,
): PromptSection[] {
  if (!state?.resumed) {
    return [];
  }

  const content = [
    "This turn is resuming from an interrupted execution. Continue from recovered state instead of restarting the task.",
    `Resume action: ${state.resumeAction}`,
    `Next step index: ${state.nextStepIndex}`,
    ...(state.replayWindow === undefined
      ? []
      : [
          `Replay window: seq>${state.replayWindow.fromSeqExclusive}..${state.replayWindow.toSeqInclusive}`,
        ]),
    ...(state.recoveredToolResults === undefined
      ? []
      : [`Recovered tool results: ${state.recoveredToolResults}`]),
    ...(state.lastStepEventType === undefined
      ? []
      : [`Last step event: ${state.lastStepEventType}`]),
    renderTurnResumeGuidance(state.resumeAction, state.lastStepEventType),
  ].join("\n");

  return [
    {
      id: "runtime.turn-resume",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: TURN_RESUME_PRIORITY,
      metadata: {
        resumeAction: state.resumeAction,
        nextStepIndex: state.nextStepIndex,
        ...(state.recoveredToolResults === undefined
          ? {}
          : { recoveredToolResults: state.recoveredToolResults }),
        ...(state.lastStepEventType === undefined
          ? {}
          : { lastStepEventType: state.lastStepEventType }),
      },
      content,
    },
  ];
}

export function createRuntimeDegradationGuidanceSections(
  degradations: readonly RuntimeDegradeSurface[],
): PromptSection[] {
  if (degradations.length === 0) {
    return [];
  }

  return [
    {
      id: "runtime.degradations",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: RUNTIME_DEGRADATION_PRIORITY,
      metadata: {
        count: degradations.length,
      },
      content: [
        "Runtime degraded surfaces were detected while assembling this prompt.",
        ...degradations.map((degradation, index) =>
          renderRuntimeDegradationLine(degradation, index + 1),
        ),
        renderRuntimeDegradationGuidance(degradations),
      ].join("\n"),
    },
  ];
}

export function createToolRuntimeGuidanceSections(
  observations: readonly ToolRuntimePromptObservation[],
): PromptSection[] {
  const impactful = observations.filter((observation) => isImpactfulToolObservation(observation));
  const summary = summarizeToolRuntimeGuidanceObservations(impactful);
  const status = summary?.status;
  if (summary === undefined || status === undefined) {
    return [];
  }

  return [
    {
      id: "runtime.tool-status",
      cacheBucket: "dynamic",
      owner: "runtime",
      priority: TOOL_RUNTIME_GUIDANCE_PRIORITY,
      metadata: { ...summary },
      content: [
        `Current tool runtime status: ${status}`,
        ...impactful.map((observation, index) => renderToolObservationLine(observation, index + 1)),
        renderToolRuntimeGuidance(status),
      ].join("\n"),
    },
  ];
}

export const DEFAULT_RUNTIME_PROMPT_SECTION_CONTRIBUTORS: readonly PromptSectionContributor[] = [
  {
    id: "runtime.turn-resume",
    resolveFingerprint: ({ turnResumeState }) => JSON.stringify(turnResumeState ?? null),
    buildSections: ({ turnResumeState }) => createTurnResumeGuidanceSections(turnResumeState),
  },
  {
    id: "runtime.degradations",
    resolveFingerprint: ({ runtimeDegradations }) =>
      JSON.stringify(
        (runtimeDegradations ?? []).map((degradation) => ({
          stage: degradation.stage,
          category: degradation.category,
          action: degradation.action,
          severity: degradation.severity,
          reason: degradation.reason,
          message: degradation.message,
          recoverable: degradation.recoverable,
          ...(toRuntimeDegradationMetadataPreview(degradation.metadata) === undefined
            ? {}
            : { metadata: toRuntimeDegradationMetadataPreview(degradation.metadata) }),
        })),
      ),
    buildSections: ({ runtimeDegradations }) =>
      createRuntimeDegradationGuidanceSections(runtimeDegradations ?? []),
  },
  {
    id: "session.output-style",
    resolveFingerprint: ({ sessionMetadata }) =>
      JSON.stringify(readSessionPromptPreferences(sessionMetadata).outputStyle ?? null),
    buildSections: ({ sessionMetadata }) =>
      createSessionGuidanceSections(sessionMetadata).filter(
        (section) => section.id === "session.output-style",
      ),
  },
  {
    id: "session.permission-mode",
    resolveFingerprint: ({ sessionMetadata }) =>
      JSON.stringify(readSessionPromptPreferences(sessionMetadata).permissionMode ?? null),
    buildSections: ({ sessionMetadata }) =>
      createSessionGuidanceSections(sessionMetadata).filter(
        (section) => section.id === "session.permission-mode",
      ),
  },
  {
    id: "session.response-language",
    resolveFingerprint: ({ sessionMetadata }) =>
      JSON.stringify(readSessionPromptPreferences(sessionMetadata).responseLanguage ?? null),
    buildSections: ({ sessionMetadata }) =>
      createSessionGuidanceSections(sessionMetadata).filter(
        (section) => section.id === "session.response-language",
      ),
  },
  {
    id: "session.latest-turn",
    resolveFingerprint: ({ sessionMetadata, currentTurnId }) =>
      JSON.stringify({
        latestTurn: readSessionLatestTurnPromptState(sessionMetadata),
        currentTurnId: currentTurnId ?? null,
      }),
    buildSections: ({ sessionMetadata, currentTurnId }) =>
      createSessionLatestTurnGuidanceSections(sessionMetadata, {
        ...(currentTurnId === undefined ? {} : { currentTurnId }),
      }),
  },
  {
    id: "runtime.tool-status",
    resolveFingerprint: ({ toolObservations }) =>
      JSON.stringify(
        (toolObservations ?? []).map((observation) => ({
          toolName: observation.toolName,
          ok: observation.ok,
          resolution: observation.resolution,
          error: observation.error,
          ...(observation.metadataPreview === undefined
            ? {}
            : { metadataPreview: observation.metadataPreview }),
          degradationReason: observation.degradation?.reason,
          degradationMessage: observation.degradation?.message,
          policyVerdict: observation.policyDecision?.verdict,
          policyReason: observation.policyDecision?.reason,
        })),
      ),
    buildSections: ({ toolObservations }) =>
      createToolRuntimeGuidanceSections(toolObservations ?? []),
  },
] as const;

export function createRuntimePromptSections(input: RuntimePromptSectionsInput): PromptSection[] {
  const contributorInput: PromptSectionContributorInput = {
    sessionMetadata: input.sessionMetadata,
    ...(input.currentTurnId === undefined ? {} : { currentTurnId: input.currentTurnId }),
    ...(input.turnResumeState === undefined ? {} : { turnResumeState: input.turnResumeState }),
    ...(input.runtimeDegradations === undefined
      ? {}
      : { runtimeDegradations: input.runtimeDegradations }),
    ...(input.toolObservations === undefined ? {} : { toolObservations: input.toolObservations }),
    ...(input.contributorInput ?? {}),
  };

  return [
    ...resolvePromptSectionContributorSections({
      contributorInput,
      contributors: [...DEFAULT_RUNTIME_PROMPT_SECTION_CONTRIBUTORS, ...(input.contributors ?? [])],
      ...(input.turnContext === undefined ? {} : { turnContext: input.turnContext }),
    }),
    ...(input.extraSections === undefined ? [] : [...input.extraSections]),
  ];
}

export function renderTaskStatePrompt(taskState: Pick<TaskState, "items">): string | undefined {
  if (taskState.items.length === 0) {
    return undefined;
  }

  const lines = taskState.items.map(
    (item, index) => `${index + 1}. [${item.status}] ${item.content}`,
  );
  return ["Current todo list:", ...lines].join("\n");
}

export function resolveWorkingMemoryPromptState(input: {
  recallWorkingMemory: (
    options: WorkingMemoryPromptRecallOptions,
  ) => WorkingMemoryPromptRecallBlock;
  options: WorkingMemoryPromptRecallOptions;
}): WorkingMemoryPromptState {
  const runtimeDegradations: RuntimeDegradeSurface[] = [];
  let recallBlock: WorkingMemoryPromptRecallBlock | undefined;

  try {
    recallBlock = input.recallWorkingMemory(input.options);
  } catch (error) {
    const degradedMessage = `Working-memory recall degraded: ${normalizeErrorMessage(error)}`;
    runtimeDegradations.push(
      createRuntimeDegradeSurface({
        stage: "runtime",
        category: "memory",
        severity: "minor",
        reason: "fallback",
        message: degradedMessage,
        recoverable: true,
        error: createContractError({
          code: "MEMORY_DEGRADED",
          message: degradedMessage,
          retryable: true,
          kind: "memory-degrade",
          defaultAction: "degrade",
          metadata: {
            blockId: input.options.blockId ?? "working-memory",
            scopeSessionId: input.options.scope.sessionId,
          },
          cause: error,
        }),
        metadata: {
          blockId: input.options.blockId ?? "working-memory",
          scopeSessionId: input.options.scope.sessionId,
        },
      }),
    );
  }

  if (recallBlock?.degraded !== undefined) {
    runtimeDegradations.push(
      createRuntimeDegradeSurface({
        stage: "runtime",
        category: "memory",
        severity: "minor",
        reason: "fallback",
        message:
          recallBlock.degraded.message ??
          `Working-memory recall degraded: ${recallBlock.degraded.reason}`,
        recoverable: true,
        metadata: {
          blockId: recallBlock.blockId,
          source: recallBlock.source,
          scopeSessionId: recallBlock.scope.sessionId,
          memoryReason: recallBlock.degraded.reason,
        },
      }),
    );
  }

  return {
    ...(recallBlock && (recallBlock.items.length > 0 || recallBlock.degraded !== undefined)
      ? { recallBlock }
      : {}),
    runtimeDegradations,
  };
}

export function splitCacheBoundary(sections: PromptSection[]): CacheBoundaryResult {
  const staticSections = sections.filter((section) => section.cacheBucket === "static");
  const dynamicSections = sections.filter((section) => section.cacheBucket === "dynamic");

  const staticPrompt = staticSections.map(renderSection).join("\n\n");
  const dynamicPrompt = dynamicSections.map(renderSection).join("\n\n");

  return {
    staticSections,
    dynamicSections,
    staticPrompt,
    dynamicPrompt,
  };
}

export function applyTokenBudget(
  sections: PromptSection[],
  tokenBudget: number,
  estimator: TokenEstimator = estimateTokens,
): TokenBudgetResult {
  const rankedSections = [...sections].sort((left, right) => {
    const priorityDiff = (right.priority ?? DEFAULT_PRIORITY) - (left.priority ?? DEFAULT_PRIORITY);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return left.id.localeCompare(right.id);
  });

  let remainingTokens = Math.max(0, tokenBudget);
  let usedTokens = 0;
  const included: PromptSection[] = [];
  const omitted: PromptSection[] = [];

  for (const section of rankedSections) {
    const sectionCost = section.tokenCost ?? estimator(section.content);
    if (sectionCost <= remainingTokens) {
      included.push(section);
      usedTokens += sectionCost;
      remainingTokens -= sectionCost;
    } else {
      omitted.push(section);
    }
  }

  return {
    included,
    omitted,
    usedTokens,
    remainingTokens,
  };
}

export interface PromptSectionRegistryOptions {
  protectedStaticSectionIds?: readonly string[];
}

export class PromptSectionRegistry {
  private readonly sections = new Map<string, PromptSection>();
  private readonly protectedStaticSectionIds: Set<string>;

  constructor(options: PromptSectionRegistryOptions = {}) {
    this.protectedStaticSectionIds = new Set(
      options.protectedStaticSectionIds ?? DEFAULT_PROTECTED_STATIC_SECTION_IDS,
    );
  }

  register(section: PromptSection): void {
    this.assertSection(section);
    if (this.sections.has(section.id)) {
      throw new Error(`Prompt section already registered: ${section.id}`);
    }
    this.sections.set(section.id, section);
  }

  upsert(section: PromptSection): void {
    this.assertSection(section);
    this.assertNotOverwritingProtectedStatic(section);
    this.sections.set(section.id, section);
  }

  get(id: string): PromptSection | undefined {
    return this.sections.get(id);
  }

  list(): PromptSection[] {
    return [...this.sections.values()];
  }

  clearDynamic(): void {
    for (const [id, section] of this.sections.entries()) {
      if (section.cacheBucket === "dynamic") {
        this.sections.delete(id);
      }
    }
  }

  private assertSection(section: PromptSection): void {
    if (section.id.trim().length === 0) {
      throw new Error("Prompt section id cannot be empty");
    }
  }

  private assertNotOverwritingProtectedStatic(section: PromptSection): void {
    const existing = this.sections.get(section.id);
    if (
      existing !== undefined &&
      existing.cacheBucket === "static" &&
      this.protectedStaticSectionIds.has(existing.id)
    ) {
      throw new Error(`Protected static section cannot be overwritten: ${existing.id}`);
    }
  }
}

export class DynamicContextAssembler {
  constructor(
    private readonly registry: PromptSectionRegistry = new PromptSectionRegistry(),
    private readonly estimator: TokenEstimator = estimateTokens,
  ) {}

  getRegistry(): PromptSectionRegistry {
    return this.registry;
  }

  build(input: AssembleContextInput): AssembledContext {
    const dynamicSections = input.dynamicSections ?? [];
    const merged = new Map<string, PromptSection>();

    for (const section of this.registry.list()) {
      merged.set(section.id, section);
    }
    for (const section of dynamicSections) {
      const existing = merged.get(section.id);
      if (existing?.cacheBucket === "static") {
        continue;
      }
      merged.set(section.id, section);
    }

    const budget = applyTokenBudget([...merged.values()], input.tokenBudget, this.estimator);
    const cacheBoundary = splitCacheBoundary(budget.included);
    const prompt = [cacheBoundary.staticPrompt, cacheBoundary.dynamicPrompt]
      .filter((chunk) => chunk.length > 0)
      .join("\n\n");

    return {
      prompt,
      cacheBoundary,
      budget,
    };
  }
}

export const DEFAULT_TURN_STATE_PROMPT_SECTION_CONTRIBUTORS: readonly PromptSectionContributor[] = [
  {
    id: "turn.user-input",
    resolveFingerprint: ({ userInput }) => JSON.stringify(userInput ?? null),
    buildSections: ({ userInput }) =>
      userInput === undefined ? [] : [createUserInputSection(userInput)],
  },
  {
    id: "turn.tool-results",
    resolveFingerprint: ({ toolResults }) =>
      JSON.stringify(
        (toolResults ?? []).map((result) => ({
          id: result.id,
          toolName: result.toolName,
          ok: result.ok,
          output: result.output ?? null,
          error: result.error ?? null,
          ...(result.priority === undefined ? {} : { priority: result.priority }),
        })),
      ),
    buildSections: ({ toolResults }) => createToolResultSections([...(toolResults ?? [])]),
  },
  {
    id: "turn.task-state",
    resolveFingerprint: ({ taskStatePrompt }) => JSON.stringify(taskStatePrompt ?? null),
    buildSections: ({ taskStatePrompt }) =>
      taskStatePrompt === undefined ? [] : [createTaskStateSection(taskStatePrompt)],
  },
  {
    id: "turn.recall",
    resolveFingerprint: ({ recall, recallBlocks }) =>
      JSON.stringify({
        recall:
          recallBlocks === undefined
            ? (recall ?? []).map((item) => ({
                id: item.id,
                layer: item.layer,
                content: item.content,
                score: item.score,
                ...(item.priority === undefined ? {} : { priority: item.priority }),
              }))
            : null,
        recallBlocks: recallBlocks?.map((block) => ({
          blockId: block.blockId,
          source: block.source,
          items: block.items.map((item) => ({
            id: item.id,
            layer: item.layer,
            content: item.content,
            score: item.score,
            ...(item.priority === undefined ? {} : { priority: item.priority }),
          })),
          degraded:
            block.degraded === undefined
              ? null
              : {
                  reason: block.degraded.reason,
                  message: block.degraded.message,
                },
          ...(block.priority === undefined ? {} : { priority: block.priority }),
        })),
      }),
    buildSections: ({ recall, recallBlocks }) =>
      recallBlocks === undefined
        ? createRecallSections([...(recall ?? [])])
        : recallBlocks.flatMap((block) => createRecallSectionsFromBlock(block)),
  },
] as const;

export class MultiStepTurnContext {
  private userInput: string | undefined;
  private taskStatePrompt: string | undefined;
  private toolResults: ContextToolResult[] = [];
  private recallItems: ContextRecallItem[] = [];
  private recallBlocks: RecallBlock[] | undefined;
  private customDynamicSections: PromptSection[] = [];
  private lastBudget: TokenBudgetResult | undefined;
  private stateVersion = 0;
  private readonly cachedTurnValues = new Map<string, CachedTurnValueEntry>();
  private lastRebuild: CachedRebuildEntry | undefined;

  constructor(
    private readonly assembler: TurnContextAssembler = new DynamicContextAssembler(),
    private readonly defaultCompactor: DynamicSectionCompactor = compactDynamicSections,
  ) {}

  setUserInput(content: string): void {
    if (this.userInput === content) {
      return;
    }
    this.userInput = content;
    this.markStateChanged();
  }

  clearUserInput(): void {
    if (this.userInput === undefined) {
      return;
    }
    this.userInput = undefined;
    this.markStateChanged();
  }

  setTaskState(content: string | undefined): void {
    if (this.taskStatePrompt === content) {
      return;
    }
    this.taskStatePrompt = content;
    this.markStateChanged();
  }

  replaceToolResults(results: ContextToolResult[]): void {
    const nextSections = createToolResultSections(results);
    if (arePromptSectionListsEqual(createToolResultSections(this.toolResults), nextSections)) {
      return;
    }
    this.toolResults = [...results];
    this.markStateChanged();
  }

  appendToolResult(result: ContextToolResult): void {
    const nextToolResults = [...this.toolResults, result];
    if (
      arePromptSectionListsEqual(
        createToolResultSections(this.toolResults),
        createToolResultSections(nextToolResults),
      )
    ) {
      return;
    }
    this.toolResults = nextToolResults;
    this.markStateChanged();
  }

  replaceRecall(items: ContextRecallItem[]): void {
    if (
      arePromptSectionListsEqual(
        createRecallSections(this.recallItems),
        createRecallSections(items),
      ) &&
      this.recallBlocks === undefined
    ) {
      return;
    }
    this.recallItems = [...items];
    this.recallBlocks = undefined;
    this.markStateChanged();
  }

  replaceRecallBlock(block: RecallBlock): void {
    this.replaceRecallBlocks([block]);
  }

  replaceRecallBlocks(blocks: RecallBlock[]): void {
    const nextRecallBlocks = [...blocks];
    if (
      arePromptSectionListsEqual(
        createRecallSectionsFromState({
          recall: this.recallItems,
          ...(this.recallBlocks === undefined ? {} : { recallBlocks: this.recallBlocks }),
        }),
        createRecallSectionsFromState({
          recallBlocks: nextRecallBlocks,
        }),
      )
    ) {
      return;
    }
    this.recallItems = [];
    this.recallBlocks = nextRecallBlocks;
    this.markStateChanged();
  }

  setCustomDynamicSections(sections: PromptSection[]): void {
    const nextSections = [...sections];
    if (arePromptSectionListsEqual(this.customDynamicSections, nextSections)) {
      return;
    }
    this.customDynamicSections = nextSections;
    this.markStateChanged();
  }

  replaceState(input: MultiStepTurnStateInput): void {
    const nextUserInput = input.userInput;
    const nextTaskStatePrompt = input.taskState;
    const nextToolResults = [...(input.toolResults ?? [])];
    const nextRecallItems =
      input.recallBlocks !== undefined || input.recallBlock !== undefined
        ? []
        : [...(input.recall ?? [])];
    const nextRecallBlocks =
      input.recallBlocks !== undefined
        ? [...input.recallBlocks]
        : input.recallBlock !== undefined
          ? [input.recallBlock]
          : undefined;
    const nextCustomDynamicSections = [...(input.customDynamicSections ?? [])];

    if (
      this.userInput === nextUserInput &&
      this.taskStatePrompt === nextTaskStatePrompt &&
      arePromptSectionListsEqual(
        createToolResultSections(this.toolResults),
        createToolResultSections(nextToolResults),
      ) &&
      arePromptSectionListsEqual(
        createRecallSectionsFromState({
          recall: this.recallItems,
          ...(this.recallBlocks === undefined ? {} : { recallBlocks: this.recallBlocks }),
        }),
        createRecallSectionsFromState({
          recall: nextRecallItems,
          ...(nextRecallBlocks === undefined ? {} : { recallBlocks: nextRecallBlocks }),
        }),
      ) &&
      arePromptSectionListsEqual(this.customDynamicSections, nextCustomDynamicSections)
    ) {
      return;
    }

    this.userInput = nextUserInput;
    this.taskStatePrompt = nextTaskStatePrompt;
    this.toolResults = nextToolResults;
    this.recallItems = nextRecallItems;
    this.recallBlocks = nextRecallBlocks;
    this.customDynamicSections = nextCustomDynamicSections;
    this.markStateChanged();
  }

  resolveCachedTurnValue<T>(key: string, fingerprint: string, compute: () => T): T {
    const cached = this.cachedTurnValues.get(key);
    if (cached?.fingerprint === fingerprint) {
      return cached.value as T;
    }

    const value = compute();
    this.cachedTurnValues.set(key, {
      fingerprint,
      value,
    });
    return value;
  }

  invalidateCachedTurnValues(key?: string): void {
    if (key === undefined) {
      this.cachedTurnValues.clear();
    } else {
      this.cachedTurnValues.delete(key);
    }
  }

  listDynamicSections(): PromptSection[] {
    return [
      ...resolvePromptSectionContributorSections({
        turnContext: this,
        contributors: DEFAULT_TURN_STATE_PROMPT_SECTION_CONTRIBUTORS,
        contributorInput: {
          ...(this.userInput === undefined ? {} : { userInput: this.userInput }),
          ...(this.taskStatePrompt === undefined ? {} : { taskStatePrompt: this.taskStatePrompt }),
          toolResults: this.toolResults,
          recall: this.recallItems,
          ...(this.recallBlocks === undefined ? {} : { recallBlocks: this.recallBlocks }),
        },
      }),
      ...this.customDynamicSections,
    ];
  }

  rebuild(input: RebuildDynamicContextInput): AssembledContext {
    const compactor = input.compactor ?? this.defaultCompactor;
    if (
      this.lastRebuild !== undefined &&
      this.lastRebuild.stateVersion === this.stateVersion &&
      this.lastRebuild.tokenBudget === input.tokenBudget &&
      this.lastRebuild.compactor === compactor
    ) {
      this.lastBudget = this.lastRebuild.assembled.budget;
      return this.lastRebuild.assembled;
    }

    const dynamicSections = compactor(this.listDynamicSections());
    const assembled = this.assembler.build({
      tokenBudget: input.tokenBudget,
      dynamicSections,
    });
    this.lastBudget = assembled.budget;
    this.lastRebuild = {
      tokenBudget: input.tokenBudget,
      compactor,
      stateVersion: this.stateVersion,
      assembled,
    };
    return assembled;
  }

  getLastBudget(): TokenBudgetResult | undefined {
    return this.lastBudget;
  }

  private markStateChanged(): void {
    this.stateVersion += 1;
    this.lastBudget = undefined;
    this.lastRebuild = undefined;
  }
}

function resolvePromptSectionContributorSections(input: {
  turnContext?: MultiStepTurnContext;
  contributors?: readonly PromptSectionContributor[];
  contributorInput: PromptSectionContributorInput;
}): PromptSection[] {
  if (input.contributors === undefined || input.contributors.length === 0) {
    return [];
  }

  return input.contributors.flatMap((contributor) => {
    const buildSections = () => [...contributor.buildSections(input.contributorInput)];
    if (input.turnContext === undefined) {
      return buildSections();
    }

    const fingerprint =
      contributor.resolveFingerprint?.(input.contributorInput) ??
      createPromptSectionContributorFingerprint(input.contributorInput);
    return input.turnContext.resolveCachedTurnValue(
      `prompt-contributor:${contributor.id}`,
      fingerprint,
      buildSections,
    );
  });
}

function createRecallSectionsFromState(input: {
  recall?: readonly ContextRecallItem[];
  recallBlocks?: readonly RecallBlock[];
}): PromptSection[] {
  return input.recallBlocks === undefined
    ? createRecallSections([...(input.recall ?? [])])
    : input.recallBlocks.flatMap((block) => createRecallSectionsFromBlock(block));
}

function arePromptSectionsEqual(
  left: PromptSection | undefined,
  right: PromptSection | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }

  return (
    left.id === right.id &&
    left.content === right.content &&
    left.cacheBucket === right.cacheBucket &&
    left.owner === right.owner &&
    left.priority === right.priority &&
    left.tokenCost === right.tokenCost &&
    serializeMetadata(left.metadata) === serializeMetadata(right.metadata)
  );
}

function arePromptSectionListsEqual(
  left: readonly PromptSection[],
  right: readonly PromptSection[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  for (const [index, section] of left.entries()) {
    if (!arePromptSectionsEqual(section, right[index])) {
      return false;
    }
  }

  return true;
}

function serializeMetadata(metadata: Record<string, unknown> | undefined): string {
  return JSON.stringify(metadata ?? null);
}

function createPromptSectionContributorFingerprint(input: PromptSectionContributorInput): string {
  return JSON.stringify({
    userInput: input.userInput,
    taskItems: input.taskState?.items.map((item) => ({
      id: item.id,
      content: item.content,
      status: item.status,
      ...(item.priority === undefined ? {} : { priority: item.priority }),
    })),
    taskStatePrompt: input.taskStatePrompt,
    availableTools: input.availableTools,
    availableToolsets: input.availableToolsets,
    toolResults: input.toolResults?.map((result) => ({
      id: result.id,
      toolName: result.toolName,
      ok: result.ok,
      ...(result.priority === undefined ? {} : { priority: result.priority }),
    })),
    recall: input.recall?.map((item) => ({
      id: item.id,
      layer: item.layer,
      content: item.content,
      score: item.score,
      ...(item.priority === undefined ? {} : { priority: item.priority }),
    })),
    recallBlocks: input.recallBlocks?.map((block) => ({
      blockId: block.blockId,
      source: block.source,
      items: block.items.map((item) => ({
        id: item.id,
        layer: item.layer,
        content: item.content,
        score: item.score,
        ...(item.priority === undefined ? {} : { priority: item.priority }),
      })),
      degraded:
        block.degraded === undefined
          ? null
          : {
              reason: block.degraded.reason,
              message: block.degraded.message,
            },
      ...(block.priority === undefined ? {} : { priority: block.priority }),
    })),
    sessionMetadata: input.sessionMetadata ?? null,
    currentTurnId: input.currentTurnId,
    turnResumeState: input.turnResumeState,
    runtimeDegradations: input.runtimeDegradations?.map((degradation) => ({
      stage: degradation.stage,
      category: degradation.category,
      action: degradation.action,
      severity: degradation.severity,
      reason: degradation.reason,
      message: degradation.message,
      recoverable: degradation.recoverable,
      ...(toRuntimeDegradationMetadataPreview(degradation.metadata) === undefined
        ? {}
        : { metadata: toRuntimeDegradationMetadataPreview(degradation.metadata) }),
    })),
    toolObservations: input.toolObservations?.map((observation) => ({
      toolName: observation.toolName,
      ok: observation.ok,
      resolution: observation.resolution,
      error: observation.error,
      ...(observation.metadataPreview === undefined
        ? {}
        : { metadataPreview: observation.metadataPreview }),
      degradationReason: observation.degradation?.reason,
      policyVerdict: observation.policyDecision?.verdict,
      policyReason: observation.policyDecision?.reason,
    })),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRuntimeDegradationMetadataPreview(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  const previewEntries: Array<readonly [string, string | number | boolean]> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string" || typeof value === "boolean") {
      previewEntries.push([key, value]);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      previewEntries.push([key, value]);
    }
  }

  if (previewEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(previewEntries);
}

function formatRuntimeDegradationMetadataPreview(
  preview: Readonly<Record<string, string | number | boolean>>,
): string {
  return Object.entries(preview)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");
}

function isReplayTrimRuntimeDegradation(degradation: RuntimeDegradeSurface): boolean {
  return degradation.reason === "context-pressure" && degradation.category === "runtime";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return "Unknown runtime error";
}

function renderSessionOutputStyleGuidance(style: string): string {
  switch (style) {
    case "concise":
      return "Keep the answer brief, high-signal, and easy to skim unless the operator asks for more depth.";
    case "verbose":
      return "Provide fuller explanations, include key tradeoffs, and keep the structure easy to follow.";
    case "normal":
      return "Use balanced detail: enough explanation to orient the operator without bloating the turn.";
    default:
      return "Match this session's requested answer shape while staying clear, direct, and low-friction.";
  }
}

function renderSessionPermissionModeGuidance(mode: string): string {
  switch (mode) {
    case "allow":
      return "When tool execution is needed and otherwise permitted, proceed without asking for another confirmation and clearly surface meaningful side effects.";
    case "ask":
      return "Treat side-effectful tool actions as approval-gated. If approval is missing, stop and explain exactly what needs confirmation.";
    case "deny":
      return "Do not attempt side-effectful tool actions. Prefer read-only reasoning or explain the blocked action explicitly.";
    default:
      return "Respect the current session permission posture and do not assume extra execution authority.";
  }
}

function renderSessionResponseLanguageGuidance(language: string): string {
  return `Respond in ${language} unless the user explicitly asks to switch languages for this turn.`;
}

function renderTurnResumeGuidance(action: string, lastStepEventType?: string): string {
  switch (action) {
    case "continue-current-step":
      return "Finish the interrupted step using the recovered task state and prior tool evidence before planning new work.";
    case "start-next-step":
      if (lastStepEventType === "step.tool_result") {
        return "Treat recovered tool outputs as already completed work and continue from the next step. The last recorded event was tool results, so reuse them before planning duplicate calls.";
      }
      return "Treat recovered outputs as already completed work and move forward from the next step without redoing finished calls unless evidence is missing.";
    case "turn-complete":
      return "The previous run already completed the turn; avoid duplicating the final answer.";
    default:
      return "Use the recovered execution state as the source of truth for what has already happened in this turn.";
  }
}

function renderSessionLatestTurnGuidance(
  runtimeStatus: string,
  finishReason?: string,
  lastStepEventType?: string,
  resumeAction?: string,
  nextStepIndex?: number,
): string {
  if (finishReason === "length") {
    if (
      lastStepEventType === "step.tool_result" &&
      resumeAction === "start-next-step" &&
      nextStepIndex !== undefined
    ) {
      return `The last turn hit the step budget immediately after tool results were recorded. Continue from step ${nextStepIndex} using those results instead of repeating the same tool calls unless the world changed.`;
    }
    if (lastStepEventType === "step.tool_result") {
      return "The last turn hit the step budget immediately after tool results were recorded. Continue from those results instead of repeating the same tool calls unless the world changed.";
    }
    return "The last turn stopped because it hit the step budget. Continue from the existing context instead of restarting the reasoning chain.";
  }
  if (
    finishReason === "failed" &&
    resumeAction === "continue-current-step" &&
    nextStepIndex !== undefined
  ) {
    return `The last turn failed mid-step. Resume from step ${nextStepIndex} and rebuild only from confirmed evidence instead of assuming unfinished actions succeeded.`;
  }
  switch (runtimeStatus) {
    case "failed":
      return "The last turn ended in failure. Do not assume that blocked or failed actions succeeded; rebuild only from confirmed evidence.";
    case "blocked":
      return "The last turn was blocked by approval or policy. If the operator asks to continue, explain what is still blocked instead of silently retrying.";
    case "degraded":
      return "The last turn completed under degraded conditions. Use that as cautionary context, but confirm whether the limitation still applies in this turn.";
    default:
      return "The last turn completed without a recorded degradation. Use it as context, not as a guarantee about this turn's runtime state.";
  }
}

function readLatestTurnToolOutcomeSummary(
  value: unknown,
): LatestTurnToolOutcomeSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const total = readNumber(value.total);
  const executed = readNumber(value.executed);
  const denied = readNumber(value.denied);
  const approvalRequired = readNumber(value.approvalRequired);
  const degraded = readNumber(value.degraded);
  const failed = readNumber(value.failed);
  const missing = readNumber(value.missing);
  const unknown = readNumber(value.unknown);

  if (
    total === undefined ||
    executed === undefined ||
    denied === undefined ||
    approvalRequired === undefined ||
    degraded === undefined ||
    failed === undefined ||
    missing === undefined ||
    unknown === undefined
  ) {
    return undefined;
  }

  return {
    total,
    executed,
    denied,
    approvalRequired,
    degraded,
    failed,
    missing,
    unknown,
  };
}

function readLatestTurnReasoningSummary(value: unknown): LatestTurnReasoningSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const strategy = readString(value.strategy);
  const confidence = readNumber(value.confidence);
  const rationale = readString(value.rationale);
  const suggestedAction = readString(value.suggestedAction);

  if (
    strategy === undefined &&
    confidence === undefined &&
    rationale === undefined &&
    suggestedAction === undefined
  ) {
    return undefined;
  }

  return {
    ...(strategy === undefined ? {} : { strategy }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(rationale === undefined ? {} : { rationale }),
    ...(suggestedAction === undefined ? {} : { suggestedAction }),
  };
}

function formatLatestTurnToolOutcomeSummary(summary: LatestTurnToolOutcomeSummary): string {
  return [
    `executed=${summary.executed}`,
    `denied=${summary.denied}`,
    `approval_required=${summary.approvalRequired}`,
    `degraded=${summary.degraded}`,
    `failed=${summary.failed}`,
    `missing=${summary.missing}`,
    `unknown=${summary.unknown}`,
  ].join(", ");
}

function renderRuntimeDegradationLine(degradation: RuntimeDegradeSurface, index: number): string {
  const metadataPreview = toRuntimeDegradationMetadataPreview(degradation.metadata);
  return [
    `${index}. stage=${degradation.stage}`,
    `category=${degradation.category}`,
    `reason=${degradation.reason}`,
    ...(degradation.message === undefined ? [] : [`message=${degradation.message}`]),
    `recoverable=${String(degradation.recoverable)}`,
    ...(metadataPreview === undefined
      ? []
      : [`metadata=${formatRuntimeDegradationMetadataPreview(metadataPreview)}`]),
  ].join(" ");
}

function renderRuntimeDegradationGuidance(degradations: readonly RuntimeDegradeSurface[]): string {
  if (degradations.some((degradation) => isReplayTrimRuntimeDegradation(degradation))) {
    return "Some tool result replay was truncated to fit context. Treat those tool outputs as partial evidence and avoid overconfident claims about omitted details.";
  }
  if (degradations.some((degradation) => degradation.category === "memory")) {
    return "Memory recall may be partial or skipped in this turn. Do not present missing recall as certainty.";
  }
  if (degradations.some((degradation) => degradation.category === "policy")) {
    return "Execution constraints are currently degraded. Stay within the surfaced limits and avoid assuming unavailable capabilities.";
  }
  return "Treat degraded runtime surfaces as partial context. Use cautious wording and rely on confirmed evidence only.";
}

export function summarizeRuntimeDegradationSurfaces(
  degradations: readonly RuntimeDegradationSummaryInput[],
): readonly string[] {
  if (degradations.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const summaries: string[] = [];
  for (const degradation of degradations) {
    const summary = formatRuntimeDegradationSummary(degradation);
    if (seen.has(summary)) {
      continue;
    }
    seen.add(summary);
    summaries.push(summary);
  }
  return summaries;
}

function formatRuntimeDegradationSummary(degradation: RuntimeDegradationSummaryInput): string {
  const replayTrimLabel = formatReplayTrimRuntimeDegradationSummaryLabel(degradation);
  const label =
    replayTrimLabel ??
    (degradation.reason === "token_budget_low"
      ? "budget trim"
      : degradation.reason.replaceAll("_", " "));
  return `${label} [${degradation.severity}]`;
}

function formatReplayTrimRuntimeDegradationSummaryLabel(
  degradation: RuntimeDegradationSummaryInput,
): string | undefined {
  if (degradation.reason !== "context-pressure") {
    return undefined;
  }

  const toolName =
    readString(degradation.metadata?.toolName) ??
    extractReplayTrimRuntimeDegradationToolName(degradation.message);
  if (toolName === undefined) {
    return "tool replay trim";
  }
  return `tool replay trim (${toolName})`;
}

function extractReplayTrimRuntimeDegradationToolName(message: string): string | undefined {
  const replayTrimMatch =
    /^Tool result replay for "([^"]+)" was truncated to fit the remaining context budget\.?$/u.exec(
      message,
    );
  return replayTrimMatch?.[1];
}

function isImpactfulToolObservation(observation: ToolRuntimePromptObservation): boolean {
  return (
    observation.resolution === "degraded" ||
    observation.resolution === "failed" ||
    observation.resolution === "missing" ||
    observation.resolution === "denied" ||
    observation.resolution === "approval_required" ||
    observation.degradation !== undefined ||
    observation.policyDecision?.verdict === "degrade" ||
    observation.policyDecision?.verdict === "deny" ||
    observation.policyDecision?.verdict === "ask"
  );
}

function classifyToolRuntimePromptStatus(
  observations: readonly ToolRuntimePromptObservation[],
): ToolRuntimeGuidanceStatus {
  if (
    observations.some(
      (observation) =>
        observation.resolution === "failed" ||
        (!observation.ok && observation.resolution === undefined),
    )
  ) {
    return "failed";
  }
  if (
    observations.some(
      (observation) =>
        observation.resolution === "denied" ||
        observation.resolution === "approval_required" ||
        observation.resolution === "missing" ||
        observation.policyDecision?.verdict === "deny" ||
        observation.policyDecision?.verdict === "ask",
    )
  ) {
    return "blocked";
  }
  return "degraded";
}

function renderToolObservationLine(
  observation: ToolRuntimePromptObservation,
  index: number,
): string {
  const status = resolveToolObservationStatus(observation);
  const reason =
    observation.error ??
    observation.policyDecision?.reason ??
    observation.degradation?.message ??
    observation.degradation?.reason;

  return [
    `${index}. tool=${observation.toolName}`,
    `status=${status}`,
    ...(reason === undefined ? [] : [`reason=${reason}`]),
    ...(observation.metadataPreview === undefined
      ? []
      : [`metadata=${formatToolObservationMetadataPreview(observation.metadataPreview)}`]),
  ].join(" ");
}

function createToolRuntimeGuidanceMetadata(
  status: ToolRuntimeGuidanceStatus,
  observations: readonly ToolRuntimePromptObservation[],
): ToolRuntimeGuidanceSummary {
  const previewedObservations = observations.slice(0, TOOL_RUNTIME_METADATA_PREVIEW_LIMIT);
  const preview = previewedObservations
    .map((observation) => `${observation.toolName}:${resolveToolObservationStatus(observation)}`)
    .join("|");
  const metadataPreview = createToolRuntimeMetadataPreview(observations);

  return {
    impactedTools: observations.length,
    status,
    ...(previewedObservations.length === 0 ? {} : { previewedTools: previewedObservations.length }),
    ...(previewedObservations.length < observations.length ? { previewTruncated: true } : {}),
    ...(preview.length === 0 ? {} : { toolPreview: preview }),
    ...(metadataPreview ?? {}),
  };
}

export function summarizeToolRuntimeGuidanceObservations(
  observations: readonly ToolRuntimePromptObservation[],
): ToolRuntimeGuidanceSummary | undefined {
  const impactful = observations.filter((observation) => isImpactfulToolObservation(observation));
  if (impactful.length === 0) {
    return undefined;
  }

  const status = classifyToolRuntimePromptStatus(impactful);
  return createToolRuntimeGuidanceMetadata(status, impactful);
}

function resolveToolObservationStatus(observation: ToolRuntimePromptObservation): string {
  return (
    observation.resolution ??
    observation.policyDecision?.verdict ??
    (observation.ok ? "executed" : "failed")
  );
}

function renderToolRuntimeGuidance(status: ToolRuntimeGuidanceStatus): string {
  switch (status) {
    case "failed":
      return "Do not assume failed tool actions succeeded. Either recover using confirmed evidence or state the failure explicitly.";
    case "blocked":
      return "Do not silently retry blocked actions. Explain what needs approval or what policy blocked, then continue with allowed reasoning if possible.";
    default:
      return "Treat degraded tool outputs as partial evidence. Prefer cautious conclusions and mention caveats instead of pretending the capability worked perfectly.";
  }
}

function createToolRuntimeMetadataPreview(
  observations: readonly ToolRuntimePromptObservation[],
): Record<string, string | number | boolean> | undefined {
  const metadataObservations = observations.filter(
    (observation) =>
      observation.metadataPreview !== undefined &&
      Object.keys(observation.metadataPreview).length > 0,
  );
  if (metadataObservations.length === 0) {
    return undefined;
  }

  const previewItems: string[] = [];
  let previewTruncated = false;
  for (const observation of metadataObservations) {
    const previewItem = formatToolObservationMetadataPreviewItem(observation);
    if (previewItem === undefined) {
      continue;
    }

    const nextPreview = [...previewItems, previewItem].join("|");
    if (previewItems.length > 0 && nextPreview.length > TOOL_RUNTIME_METADATA_PREVIEW_CHAR_LIMIT) {
      previewTruncated = true;
      break;
    }
    if (
      previewItems.length === 0 &&
      nextPreview.length > TOOL_RUNTIME_METADATA_PREVIEW_CHAR_LIMIT
    ) {
      previewItems.push(previewItem.slice(0, TOOL_RUNTIME_METADATA_PREVIEW_CHAR_LIMIT));
      previewTruncated = true;
      break;
    }
    previewItems.push(previewItem);
  }

  if (previewItems.length < metadataObservations.length) {
    previewTruncated = true;
  }

  const toolMetaPreview = previewItems.join("|");
  return {
    metaImpactedTools: metadataObservations.length,
    ...(previewItems.length === 0 ? {} : { metaPreviewedTools: previewItems.length }),
    ...(previewTruncated ? { metaPreviewTruncated: true } : {}),
    ...(toolMetaPreview.length === 0 ? {} : { toolMetaPreview }),
  };
}

function formatToolObservationMetadataPreviewItem(
  observation: ToolRuntimePromptObservation,
): string | undefined {
  if (observation.metadataPreview === undefined) {
    return undefined;
  }

  const detail = formatToolObservationMetadataPreview(observation.metadataPreview);
  if (detail.length === 0) {
    return undefined;
  }
  return `${observation.toolName}[${detail}]`;
}

function formatToolObservationMetadataPreview(
  metadataPreview: Readonly<Record<string, string | number | boolean>>,
): string {
  return Object.entries(metadataPreview)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");
}

function readToolRuntimeGuidanceSummary(value: unknown): ToolRuntimeGuidanceSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const status = isToolRuntimeGuidanceStatus(value.status) ? value.status : undefined;
  const impactedTools = readNumber(value.impactedTools);
  const previewedTools = readNumber(value.previewedTools);
  const previewTruncated =
    typeof value.previewTruncated === "boolean" ? value.previewTruncated : undefined;
  const toolPreview = readString(value.toolPreview);
  const metaImpactedTools = readNumber(value.metaImpactedTools);
  const metaPreviewedTools = readNumber(value.metaPreviewedTools);
  const metaPreviewTruncated =
    typeof value.metaPreviewTruncated === "boolean" ? value.metaPreviewTruncated : undefined;
  const toolMetaPreview = readString(value.toolMetaPreview);

  if (
    status === undefined &&
    impactedTools === undefined &&
    previewedTools === undefined &&
    previewTruncated === undefined &&
    toolPreview === undefined &&
    metaImpactedTools === undefined &&
    metaPreviewedTools === undefined &&
    metaPreviewTruncated === undefined &&
    toolMetaPreview === undefined
  ) {
    return undefined;
  }

  return {
    ...(status === undefined ? {} : { status }),
    ...(impactedTools === undefined ? {} : { impactedTools }),
    ...(previewedTools === undefined ? {} : { previewedTools }),
    ...(previewTruncated === undefined ? {} : { previewTruncated }),
    ...(toolPreview === undefined ? {} : { toolPreview }),
    ...(metaImpactedTools === undefined ? {} : { metaImpactedTools }),
    ...(metaPreviewedTools === undefined ? {} : { metaPreviewedTools }),
    ...(metaPreviewTruncated === undefined ? {} : { metaPreviewTruncated }),
    ...(toolMetaPreview === undefined ? {} : { toolMetaPreview }),
  };
}

function isToolRuntimeGuidanceStatus(value: unknown): value is ToolRuntimeGuidanceStatus {
  return value === "blocked" || value === "degraded" || value === "failed";
}

function createSessionLatestTurnToolRuntimeGuidanceLines(
  state: SessionLatestTurnPromptState,
): string[] {
  if (state.toolRuntimeGuidance === undefined) {
    return [];
  }

  const summary = formatToolRuntimeGuidanceSummary(state.toolRuntimeGuidance);
  const details = formatToolRuntimeGuidanceDetail(state.toolRuntimeGuidance);
  const metadata = formatToolRuntimeGuidanceMetadataDetail(state.toolRuntimeGuidance);

  return [
    ...(summary === undefined ? [] : [`Latest tool runtime guidance: ${summary}`]),
    ...(details === undefined ? [] : [`Latest tool runtime details: ${details}`]),
    ...(metadata === undefined ? [] : [`Latest tool runtime metadata: ${metadata}`]),
  ];
}

function createSessionLatestTurnReasoningLines(state: SessionLatestTurnPromptState): string[] {
  if (state.reasoning === undefined) {
    return [];
  }

  return [
    ...(state.reasoning.strategy === undefined
      ? []
      : [`Latest reasoning strategy: ${state.reasoning.strategy}`]),
    ...(state.reasoning.confidence === undefined
      ? []
      : [`Latest reasoning confidence: ${state.reasoning.confidence}`]),
    ...(state.reasoning.rationale === undefined
      ? []
      : [`Latest reasoning rationale: ${state.reasoning.rationale}`]),
    ...(state.reasoning.suggestedAction === undefined
      ? []
      : [`Latest suggested reasoning action: ${state.reasoning.suggestedAction}`]),
  ];
}

function createSessionLatestTurnRuntimeDegradationLines(
  state: SessionLatestTurnPromptState,
): string[] {
  if (
    state.runtimeDegradationSummaries === undefined ||
    state.runtimeDegradationSummaries.length === 0
  ) {
    return [];
  }

  return [
    `Latest prompt degradations: ${formatRuntimeDegradationSummaryList(state.runtimeDegradationSummaries)}`,
  ];
}

function formatRuntimeDegradationSummaryList(summaries: readonly string[]): string {
  return summaries.join(", ");
}

function formatToolRuntimeGuidanceSummary(
  guidance: ToolRuntimeGuidanceSummary,
): string | undefined {
  const impactedTools =
    guidance.impactedTools === undefined
      ? undefined
      : `${guidance.impactedTools} impacted tool${guidance.impactedTools === 1 ? "" : "s"}`;

  if (guidance.status !== undefined && impactedTools !== undefined) {
    return `${guidance.status} (${impactedTools})`;
  }
  if (guidance.status !== undefined) {
    return guidance.status;
  }
  return impactedTools;
}

function formatToolRuntimeGuidanceDetail(guidance: ToolRuntimeGuidanceSummary): string | undefined {
  return formatToolRuntimeGuidancePreview(
    guidance.toolPreview,
    guidance.previewedTools,
    guidance.previewTruncated,
    guidance.impactedTools,
    formatToolRuntimeGuidancePreviewItem,
  );
}

function formatToolRuntimeGuidanceMetadataDetail(
  guidance: ToolRuntimeGuidanceSummary,
): string | undefined {
  return formatToolRuntimeGuidancePreview(
    guidance.toolMetaPreview,
    guidance.metaPreviewedTools,
    guidance.metaPreviewTruncated,
    guidance.metaImpactedTools,
    formatToolRuntimeGuidanceMetadataPreviewItem,
  );
}

function formatToolRuntimeGuidancePreview(
  rawPreview: string | undefined,
  previewedTools: number | undefined,
  previewTruncated: boolean | undefined,
  impactedTools: number | undefined,
  formatter: (item: string) => string,
): string | undefined {
  if (rawPreview === undefined || rawPreview.trim().length === 0) {
    return undefined;
  }

  const previewItems = rawPreview
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => formatter(item));
  if (previewItems.length === 0) {
    return undefined;
  }

  const resolvedPreviewedTools = previewedTools ?? previewItems.length;
  const additionalTools =
    previewTruncated === true && impactedTools !== undefined
      ? Math.max(0, impactedTools - resolvedPreviewedTools)
      : 0;

  return additionalTools > 0
    ? `${previewItems.join(", ")} (+${additionalTools} more)`
    : previewItems.join(", ");
}

function formatToolRuntimeGuidancePreviewItem(item: string): string {
  const separatorIndex = item.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === item.length - 1) {
    return item.replaceAll("_", " ");
  }

  const toolName = item.slice(0, separatorIndex);
  const status = item.slice(separatorIndex + 1).replaceAll("_", " ");
  return `${toolName}: ${status}`;
}

function formatToolRuntimeGuidanceMetadataPreviewItem(item: string): string {
  const bracketIndex = item.indexOf("[");
  if (bracketIndex <= 0 || !item.endsWith("]")) {
    return item;
  }

  const toolName = item.slice(0, bracketIndex);
  const detail = item.slice(bracketIndex + 1, -1);
  return detail.length === 0 ? toolName : `${toolName} [${detail}]`;
}
