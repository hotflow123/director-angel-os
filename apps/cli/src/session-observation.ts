import {
  type AgentOsTimelineEventType,
  type AgentOsTimelineSummary,
  projectAgentOsTimelineSummary,
} from "@hotflow/agent-os-kernel-contracts";
import { mapSessionJournalEntriesToAgentOsTimeline } from "@hotflow/agent-os-runtime-mapping";
import {
  type RuntimeDegradationSummaryInput,
  summarizeRuntimeDegradationSurfaces,
} from "@hotflow/context";
import type { JournalEntry, JsonValue, SessionStore } from "@hotflow/sessions";

import { decodeTaskTodoWriteState } from "./task-event-contract-compat.js";

export interface SessionObservationInput {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly limit?: number;
}

export interface SessionPromptInspectInput {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly stepIndex?: number;
}

export type ToolRuntimeStatus = "healthy" | "degraded" | "blocked" | "failed";
export type ResumeRecoverySelectionSource =
  | "persisted-runtime"
  | "default-fallback"
  | "unavailable";
export type ResumeReasoningRecoverySource =
  | "stream-evidence"
  | "latest-turn-fallback"
  | "surface-default"
  | "unavailable";

export interface ToolOutcomeSummary {
  readonly total: number;
  readonly executed: number;
  readonly denied: number;
  readonly approvalRequired: number;
  readonly degraded: number;
  readonly failed: number;
  readonly missing: number;
  readonly unknown: number;
}

export interface AgentOsTimelineObservationSummary extends AgentOsTimelineSummary {
  readonly totalEvents: number;
  readonly firstSequence?: number;
  readonly lastSequence?: number;
  readonly latestEventType?: AgentOsTimelineEventType;
}

export interface SessionObservationPromptSummary {
  readonly stepIndex: number;
  readonly previousStepIndex?: number;
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly runtimeShellSectionIds?: readonly string[];
  readonly runtimeShellSectionSummaries?: readonly string[];
  readonly staticGuidanceSectionIds?: readonly string[];
  readonly staticGuidanceSectionSummaries?: readonly string[];
  readonly focusSectionIds: readonly string[];
  readonly focusSectionSummaries?: readonly string[];
  readonly omittedSectionIds: readonly string[];
  readonly omittedSectionSummaries?: readonly string[];
  readonly runtimeDegradations: readonly PromptInspectRuntimeDegradation[];
  readonly addedDynamicSectionIds: readonly string[];
  readonly addedDynamicSectionSummaries?: readonly string[];
  readonly removedDynamicSectionIds: readonly string[];
  readonly removedDynamicSectionSummaries?: readonly string[];
  readonly newlyOmittedSectionIds: readonly string[];
  readonly newlyOmittedSectionSummaries?: readonly string[];
  readonly restoredOmittedSectionIds: readonly string[];
  readonly restoredOmittedSectionSummaries?: readonly string[];
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
  readonly toolRuntimeGuidance?: PromptToolRuntimeGuidanceSummary;
  readonly turnResumeGuidance?: PromptTurnResumeGuidanceSummary;
  readonly latestTurnGuidance?: PromptLatestTurnGuidanceSummary;
  readonly runtimeDegradationSummaries?: readonly string[];
}

export interface SessionObservationSnapshot {
  readonly firstTodo: string;
  readonly lastAppliedSeq: number;
  readonly journalEvents: number;
  readonly agentOsTimelineSummary?: AgentOsTimelineObservationSummary;
  readonly workingMemoryEntries?: number;
  readonly episodicMemoryEntries?: number;
  readonly latestMemoryControl?: SessionMemoryControlSummary;
  readonly latestGuidanceControl?: SessionGuidanceControlSummary;
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
  readonly latestTurnId?: string;
  readonly latestTurnProviderId?: string;
  readonly latestTurnModel?: string;
  readonly latestTurnRuntimeStatus?: string;
  readonly latestTurnTurnBranch?: string;
  readonly latestTurnFinishReason?: string;
  readonly latestTurnCompletedSteps?: number;
  readonly latestTurnResumeAction?: string;
  readonly latestTurnNextStepIndex?: number;
  readonly latestTurnLastStepEventType?: string;
  readonly latestTurnToolCount?: number;
  readonly latestTurnToolOutcomes?: ToolOutcomeSummary;
  readonly latestTurnReasoning?: PromptLatestTurnReasoningSummary;
  readonly latestTurnToolRuntimeGuidance?: PromptToolRuntimeGuidanceSummary;
  readonly latestTurnRuntimeDegradationSummaries?: readonly string[];
  readonly auditEvents: number;
  readonly streamEvents: number;
  readonly latestAuditKind?: string;
  readonly latestStreamKind?: string;
  readonly step?: {
    readonly turnId: string;
    readonly resumeAction: string;
    readonly replayWindow: {
      readonly fromSeqExclusive: number;
      readonly toSeqInclusive: number;
    };
    readonly nextStepIndex: number;
    readonly lastStepEventType?: string;
    readonly stepJournalEvents: number;
    readonly modelOutputEvents: number;
    readonly plannedToolEvents: number;
    readonly toolResultEvents: number;
    readonly finalOutputEvents: number;
    readonly toolOutcomes: ToolOutcomeSummary;
    readonly runtimeStatus: ToolRuntimeStatus;
    readonly promptSummary?: SessionObservationPromptSummary;
  };
}

export interface SessionResumeSnapshot {
  readonly sessionId: string;
  readonly requestedCheckpointId: number | null;
  readonly checkpointId: number | null;
  readonly checkpointUptoSeq: number | null;
  readonly firstTodo: string;
  readonly lastAppliedSeq: number;
  readonly journalEvents: number;
  readonly auditEvents: number;
  readonly streamEvents: number;
  readonly latestTurnId: string | null;
  readonly latestTurnProviderId: string | null;
  readonly latestTurnModel: string | null;
  readonly recoveryProviderId: string | null;
  readonly recoveryModel: string | null;
  readonly recoverySelectionSource: ResumeRecoverySelectionSource;
  readonly recoveryReasoningStrategy: "react" | "plan-execute" | null;
  readonly recoveryReasoningSource: ResumeReasoningRecoverySource;
  readonly resumable: boolean;
  readonly guidance: string;
  readonly resumeAction: string;
  readonly nextStepIndex: number;
  readonly runtimeStatus: ToolRuntimeStatus;
  readonly toolOutcomes: ToolOutcomeSummary;
  readonly replayWindow?: {
    readonly fromSeqExclusive: number;
    readonly toSeqInclusive: number;
  };
  readonly lastStepEventType?: string;
}

export interface PromptInspectSectionSummary {
  readonly id: string;
  readonly cacheBucket: string;
  readonly owner?: string;
  readonly priority?: number;
  readonly metadataKeys?: readonly string[];
  readonly metadataPreview?: Readonly<Record<string, string | number | boolean>>;
}

export interface PromptSessionGuidanceSummary {
  readonly outputStyle?: string;
  readonly permissionMode?: string;
  readonly responseLanguage?: string;
}

export type PromptSessionGuidanceSource = "runtime-default" | "session-override";

export interface PromptSessionGuidanceSourceSummary {
  readonly outputStyle?: PromptSessionGuidanceSource;
  readonly permissionMode?: PromptSessionGuidanceSource;
  readonly responseLanguage?: PromptSessionGuidanceSource;
}

export interface PromptToolRuntimeGuidanceSummary {
  readonly status?: string;
  readonly impactedTools?: number;
  readonly previewedTools?: number;
  readonly previewTruncated?: boolean;
  readonly toolPreview?: string;
  readonly metaImpactedTools?: number;
  readonly metaPreviewedTools?: number;
  readonly metaPreviewTruncated?: boolean;
  readonly toolMetaPreview?: string;
}

export interface PromptTurnResumeGuidanceSummary {
  readonly resumeAction?: string;
  readonly nextStepIndex?: number;
  readonly recoveredToolResults?: number;
}

export interface PromptLatestTurnReasoningSummary {
  readonly strategy?: string;
  readonly confidence?: number;
  readonly rationale?: string;
  readonly suggestedAction?: string;
}

export interface PromptLatestTurnGuidanceSummary {
  readonly turnId?: string;
  readonly runtimeStatus?: string;
  readonly turnBranch?: string;
  readonly reasoning?: PromptLatestTurnReasoningSummary;
}

export interface SessionMemoryControlSummary {
  readonly action: "inspect" | "clear";
  readonly scope: "working" | "episodic" | "all";
  readonly journalSeq?: number;
  readonly occurredAtMs?: number;
  readonly workingMemoryEntries?: number;
  readonly episodicMemoryEntries?: number;
  readonly beforeWorkingMemoryEntries?: number;
  readonly beforeEpisodicMemoryEntries?: number;
  readonly afterWorkingMemoryEntries?: number;
  readonly afterEpisodicMemoryEntries?: number;
}

export interface SessionGuidanceControlSummary {
  readonly action: "output-style" | "permission-mode" | "response-language";
  readonly value: string;
  readonly previousValue?: string;
  readonly journalSeq?: number;
  readonly occurredAtMs?: number;
}

export interface PromptInspectRuntimeDegradation {
  readonly stage: string;
  readonly category: string;
  readonly severity: string;
  readonly reason: string;
  readonly message: string;
  readonly metadataPreview?: Readonly<Record<string, string | number | boolean>>;
}

export interface SessionPromptInspectSnapshot {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly previousStepIndex?: number;
  readonly availableStepIndices: readonly number[];
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly runtimeShellSectionIds?: readonly string[];
  readonly runtimeShellSectionSummaries?: readonly string[];
  readonly staticGuidanceSectionIds?: readonly string[];
  readonly staticGuidanceSectionSummaries?: readonly string[];
  readonly focusSectionIds: readonly string[];
  readonly focusSectionSummaries?: readonly string[];
  readonly omittedSectionIds: readonly string[];
  readonly omittedSectionSummaries?: readonly string[];
  readonly staticSections: readonly PromptInspectSectionSummary[];
  readonly dynamicSections: readonly PromptInspectSectionSummary[];
  readonly omittedSections: readonly PromptInspectSectionSummary[];
  readonly runtimeDegradations: readonly PromptInspectRuntimeDegradation[];
  readonly addedDynamicSectionIds: readonly string[];
  readonly addedDynamicSectionSummaries?: readonly string[];
  readonly removedDynamicSectionIds: readonly string[];
  readonly removedDynamicSectionSummaries?: readonly string[];
  readonly newlyOmittedSectionIds: readonly string[];
  readonly newlyOmittedSectionSummaries?: readonly string[];
  readonly restoredOmittedSectionIds: readonly string[];
  readonly restoredOmittedSectionSummaries?: readonly string[];
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
  readonly toolRuntimeGuidance?: PromptToolRuntimeGuidanceSummary;
  readonly turnResumeGuidance?: PromptTurnResumeGuidanceSummary;
  readonly latestTurnGuidance?: PromptLatestTurnGuidanceSummary;
  readonly runtimeDegradationSummaries?: readonly string[];
}

export interface SessionPromptExplainSnapshot {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly previousStepIndex?: number;
  readonly availableStepIndices: readonly number[];
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly runtimeShellSectionIds?: readonly string[];
  readonly runtimeShellSectionSummaries?: readonly string[];
  readonly staticGuidanceSectionIds?: readonly string[];
  readonly staticGuidanceSectionSummaries?: readonly string[];
  readonly focusSectionIds: readonly string[];
  readonly focusSectionSummaries?: readonly string[];
  readonly omittedSectionIds: readonly string[];
  readonly omittedSectionSummaries?: readonly string[];
  readonly runtimeDegradations: readonly PromptInspectRuntimeDegradation[];
  readonly addedDynamicSectionIds: readonly string[];
  readonly addedDynamicSectionSummaries?: readonly string[];
  readonly removedDynamicSectionIds: readonly string[];
  readonly removedDynamicSectionSummaries?: readonly string[];
  readonly newlyOmittedSectionIds: readonly string[];
  readonly newlyOmittedSectionSummaries?: readonly string[];
  readonly restoredOmittedSectionIds: readonly string[];
  readonly restoredOmittedSectionSummaries?: readonly string[];
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
  readonly toolRuntimeGuidance?: PromptToolRuntimeGuidanceSummary;
  readonly turnResumeGuidance?: PromptTurnResumeGuidanceSummary;
  readonly latestTurnGuidance?: PromptLatestTurnGuidanceSummary;
  readonly runtimeDegradationSummaries?: readonly string[];
}

interface PromptBuildEvidencePayload {
  readonly usedTokens: number;
  readonly remainingTokens: number;
  readonly staticSections: readonly PromptInspectSectionSummary[];
  readonly dynamicSections: readonly PromptInspectSectionSummary[];
  readonly omittedSections: readonly PromptInspectSectionSummary[];
  readonly runtimeDegradations: readonly PromptInspectRuntimeDegradation[];
}

interface PromptBuildSelection {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly previousStepIndex?: number;
  readonly availableStepIndices: readonly number[];
  readonly payload: PromptBuildEvidencePayload;
  readonly previousPayload?: PromptBuildEvidencePayload;
}

const EMPTY_TOOL_OUTCOME_SUMMARY: ToolOutcomeSummary = {
  total: 0,
  executed: 0,
  denied: 0,
  approvalRequired: 0,
  degraded: 0,
  failed: 0,
  missing: 0,
  unknown: 0,
};

type ToolOutcomeKey = keyof Omit<ToolOutcomeSummary, "total">;

export function createSessionObservationSnapshot(
  sessionStore: Pick<
    SessionStore,
    "recover" | "listAuditEvents" | "listStreamEvents" | "recoverLatestStep" | "listRuntimeEvidence"
  >,
  input: SessionObservationInput,
): SessionObservationSnapshot {
  const recovered = recoverTaskObservationState(sessionStore, input.sessionId);
  const sessionGuidance = readSessionGuidanceFromMetadata(recovered.session.metadata);
  const latestMemoryControl = readLatestMemoryControlSummary(recovered.journal);
  const latestGuidanceControl = readLatestGuidanceControlSummary(recovered.journal);
  const agentOsTimelineSummary = createAgentOsTimelineObservationSummary(recovered.journal);

  const journalLimit = input.limit ?? 50;
  const auditEvents = sessionStore.listAuditEvents(input.sessionId, { limit: journalLimit });
  const streamEvents = sessionStore.listStreamEvents(input.sessionId, { limit: journalLimit });
  const latestStep = sessionStore.recoverLatestStep(input.sessionId, {
    ...(input.turnId ? { turnId: input.turnId } : {}),
  });
  const latestTurnId = latestStep.latestTurnId ?? undefined;
  const latestTurnRuntimeSelection = readLatestTurnRuntimeSelection(
    recovered.session.metadata,
    latestTurnId,
  );
  const latestTurnRuntimeState = readLatestTurnRuntimeState(
    recovered.session.metadata,
    latestTurnId,
  );
  const latestTurnFinishState = readLatestTurnFinishState(recovered.session.metadata, latestTurnId);
  const latestTurnContinuity = readLatestTurnContinuity(recovered.session.metadata, latestTurnId);
  const latestTurnToolSummary = readLatestTurnToolSummary(recovered.session.metadata, latestTurnId);
  const latestTurnReasoning = readLatestTurnReasoning(recovered.session.metadata, latestTurnId);
  const latestTurnToolRuntimeGuidance = readLatestTurnToolRuntimeGuidance(
    recovered.session.metadata,
    latestTurnId,
  );
  const latestTurnRuntimeDegradationSummaries = readLatestTurnRuntimeDegradationSummaries(
    recovered.session.metadata,
    latestTurnId,
  );
  const latestAuditKind = auditEvents.at(-1)?.event.kind;
  const latestStreamKind = streamEvents.at(-1)?.event.kind;

  if (!latestTurnId) {
    return {
      firstTodo: recovered.state.tasks.items[0]?.content ?? "(none)",
      lastAppliedSeq: recovered.lastAppliedSeq,
      journalEvents: recovered.journal.length,
      ...(agentOsTimelineSummary === undefined ? {} : { agentOsTimelineSummary }),
      ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
      ...(latestMemoryControl === undefined ? {} : { latestMemoryControl }),
      ...(latestGuidanceControl === undefined ? {} : { latestGuidanceControl }),
      auditEvents: auditEvents.length,
      streamEvents: streamEvents.length,
      ...(latestAuditKind !== undefined ? { latestAuditKind } : {}),
      ...(latestStreamKind !== undefined ? { latestStreamKind } : {}),
    };
  }

  const stepRecovery = latestStep.stepRecovery;
  const toolOutcomes = summarizeStepReplayToolOutcomes(stepRecovery?.replay.toolResults ?? []);
  const runtimeEvidence = sessionStore.listRuntimeEvidence(input.sessionId, {
    limit: journalLimit,
    ...(latestTurnId ? { turnId: latestTurnId } : {}),
  });
  const promptSummary =
    stepRecovery === null
      ? undefined
      : createSessionObservationPromptSummary(sessionStore, {
          sessionId: input.sessionId,
          turnId: latestTurnId,
        });
  const step =
    stepRecovery === null
      ? undefined
      : {
          turnId: latestTurnId,
          resumeAction: stepRecovery.resumeAction,
          replayWindow: stepRecovery.replayWindow,
          nextStepIndex: stepRecovery.nextStepIndex,
          ...(stepRecovery.lastStepEvent?.eventType !== undefined
            ? { lastStepEventType: stepRecovery.lastStepEvent.eventType }
            : {}),
          stepJournalEvents: stepRecovery.stepJournal.length,
          modelOutputEvents: stepRecovery.replay.modelOutput.length,
          plannedToolEvents: stepRecovery.replay.plannedTools.length,
          toolResultEvents: stepRecovery.replay.toolResults.length,
          finalOutputEvents: stepRecovery.replay.finalOutput.length,
          toolOutcomes,
          runtimeStatus: combineRuntimeStatus(
            deriveRuntimeStatus(toolOutcomes),
            deriveRuntimeStatusFromEvidence(runtimeEvidence),
          ),
          ...(promptSummary === undefined ? {} : { promptSummary }),
        };

  return {
    firstTodo: recovered.state.tasks.items[0]?.content ?? "(none)",
    lastAppliedSeq: recovered.lastAppliedSeq,
    journalEvents: recovered.journal.length,
    ...(agentOsTimelineSummary === undefined ? {} : { agentOsTimelineSummary }),
    ...(latestMemoryControl === undefined ? {} : { latestMemoryControl }),
    ...(latestGuidanceControl === undefined ? {} : { latestGuidanceControl }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    latestTurnId,
    ...latestTurnRuntimeSelection,
    ...latestTurnRuntimeState,
    ...latestTurnFinishState,
    ...latestTurnContinuity,
    ...latestTurnToolSummary,
    ...(latestTurnReasoning === undefined ? {} : { latestTurnReasoning }),
    ...(latestTurnToolRuntimeGuidance === undefined ? {} : { latestTurnToolRuntimeGuidance }),
    ...(latestTurnRuntimeDegradationSummaries === undefined
      ? {}
      : { latestTurnRuntimeDegradationSummaries }),
    auditEvents: auditEvents.length,
    streamEvents: streamEvents.length,
    ...(latestAuditKind !== undefined ? { latestAuditKind } : {}),
    ...(latestStreamKind !== undefined ? { latestStreamKind } : {}),
    ...(step !== undefined ? { step } : {}),
  };
}

export function createSessionResumeSnapshot(
  sessionStore: Pick<
    SessionStore,
    "recover" | "listAuditEvents" | "listStreamEvents" | "recoverLatestStep" | "listRuntimeEvidence"
  >,
  input: SessionObservationInput & { readonly requestedCheckpointId?: number },
  options: {
    readonly defaultProviderId?: string;
    readonly defaultModel?: string;
  } = {},
): SessionResumeSnapshot {
  const recovered = recoverTaskObservationState(sessionStore, input.sessionId);
  const observation = createSessionObservationSnapshot(sessionStore, input);
  const step = observation.step;
  const resumeAction = step?.resumeAction ?? "no-progress";
  const guidanceState = describeResumeGuidance(step, observation.latestTurnId);
  const recoverySelection = resolveResumeRecoverySelection({
    latestTurnId: observation.latestTurnId ?? null,
    latestTurnProviderId: observation.latestTurnProviderId ?? null,
    latestTurnModel: observation.latestTurnModel ?? null,
    ...(options.defaultProviderId === undefined
      ? {}
      : { defaultProviderId: options.defaultProviderId }),
    ...(options.defaultModel === undefined ? {} : { defaultModel: options.defaultModel }),
  });
  const recoveryReasoning = resolveResumeReasoningSelection(sessionStore, {
    sessionId: input.sessionId,
    latestTurnId: observation.latestTurnId ?? null,
    ...(observation.latestTurnReasoning === undefined
      ? {}
      : { latestTurnReasoning: observation.latestTurnReasoning }),
  });

  return {
    sessionId: input.sessionId,
    requestedCheckpointId: input.requestedCheckpointId ?? null,
    checkpointId: recovered.checkpoint?.checkpointId ?? null,
    checkpointUptoSeq: recovered.checkpoint?.uptoSeq ?? null,
    firstTodo: observation.firstTodo,
    lastAppliedSeq: observation.lastAppliedSeq,
    journalEvents: observation.journalEvents,
    auditEvents: observation.auditEvents,
    streamEvents: observation.streamEvents,
    latestTurnId: observation.latestTurnId ?? null,
    latestTurnProviderId: observation.latestTurnProviderId ?? null,
    latestTurnModel: observation.latestTurnModel ?? null,
    recoveryProviderId: recoverySelection.providerId,
    recoveryModel: recoverySelection.model,
    recoverySelectionSource: recoverySelection.source,
    recoveryReasoningStrategy: recoveryReasoning.strategy,
    recoveryReasoningSource: recoveryReasoning.source,
    resumable: guidanceState.resumable,
    guidance: guidanceState.guidance,
    resumeAction,
    nextStepIndex: step?.nextStepIndex ?? 0,
    runtimeStatus: step?.runtimeStatus ?? "healthy",
    toolOutcomes: step?.toolOutcomes ?? EMPTY_TOOL_OUTCOME_SUMMARY,
    ...(step?.replayWindow === undefined ? {} : { replayWindow: step.replayWindow }),
    ...(step?.lastStepEventType === undefined ? {} : { lastStepEventType: step.lastStepEventType }),
  };
}

export function coerceSessionObservationSnapshot(
  data: unknown,
): SessionObservationSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    firstTodo?: unknown;
    lastAppliedSeq?: unknown;
    journalEvents?: unknown;
    agentOsTimelineSummary?: unknown;
    workingMemoryEntries?: unknown;
    episodicMemoryEntries?: unknown;
    latestMemoryControl?: unknown;
    latestGuidanceControl?: unknown;
    sessionGuidance?: unknown;
    effectiveGuidance?: unknown;
    effectiveGuidanceSources?: unknown;
    auditEvents?: unknown;
    streamEvents?: unknown;
    latestTurnId?: unknown;
    latestTurnProviderId?: unknown;
    latestTurnModel?: unknown;
    latestTurnRuntimeStatus?: unknown;
    latestTurnTurnBranch?: unknown;
    latestTurnFinishReason?: unknown;
    latestTurnCompletedSteps?: unknown;
    latestTurnResumeAction?: unknown;
    latestTurnNextStepIndex?: unknown;
    latestTurnLastStepEventType?: unknown;
    latestTurnToolCount?: unknown;
    latestTurnToolOutcomes?: unknown;
    latestTurnReasoning?: unknown;
    latestTurnToolRuntimeGuidance?: unknown;
    latestTurnRuntimeDegradationSummaries?: unknown;
    latestAuditKind?: unknown;
    latestStreamKind?: unknown;
    step?: unknown;
  };
  if (
    typeof candidate.firstTodo !== "string" ||
    typeof candidate.lastAppliedSeq !== "number" ||
    typeof candidate.journalEvents !== "number" ||
    typeof candidate.auditEvents !== "number" ||
    typeof candidate.streamEvents !== "number"
  ) {
    return undefined;
  }

  const snapshot: SessionObservationSnapshot = {
    firstTodo: candidate.firstTodo,
    lastAppliedSeq: candidate.lastAppliedSeq,
    journalEvents: candidate.journalEvents,
    auditEvents: candidate.auditEvents,
    streamEvents: candidate.streamEvents,
  };
  const agentOsTimelineSummary = coerceAgentOsTimelineObservationSummary(
    candidate.agentOsTimelineSummary,
  );
  if (agentOsTimelineSummary !== undefined) {
    (
      snapshot as {
        agentOsTimelineSummary?: AgentOsTimelineObservationSummary;
      }
    ).agentOsTimelineSummary = agentOsTimelineSummary;
  }
  if (typeof candidate.workingMemoryEntries === "number") {
    (snapshot as { workingMemoryEntries?: number }).workingMemoryEntries =
      candidate.workingMemoryEntries;
  }
  if (typeof candidate.episodicMemoryEntries === "number") {
    (snapshot as { episodicMemoryEntries?: number }).episodicMemoryEntries =
      candidate.episodicMemoryEntries;
  }
  const latestMemoryControl = coerceSessionMemoryControlSummary(candidate.latestMemoryControl);
  if (latestMemoryControl !== undefined) {
    (snapshot as { latestMemoryControl?: SessionMemoryControlSummary }).latestMemoryControl =
      latestMemoryControl;
  }
  const latestGuidanceControl = coerceSessionGuidanceControlSummary(
    candidate.latestGuidanceControl,
  );
  if (latestGuidanceControl !== undefined) {
    (snapshot as { latestGuidanceControl?: SessionGuidanceControlSummary }).latestGuidanceControl =
      latestGuidanceControl;
  }
  const sessionGuidance = coercePromptSessionGuidanceSummary(candidate.sessionGuidance);
  if (sessionGuidance !== undefined) {
    (snapshot as { sessionGuidance?: PromptSessionGuidanceSummary }).sessionGuidance =
      sessionGuidance;
  }
  const effectiveGuidance = coercePromptSessionGuidanceSummary(candidate.effectiveGuidance);
  if (effectiveGuidance !== undefined) {
    (snapshot as { effectiveGuidance?: PromptSessionGuidanceSummary }).effectiveGuidance =
      effectiveGuidance;
  }
  const effectiveGuidanceSources = coercePromptSessionGuidanceSourceSummary(
    candidate.effectiveGuidanceSources,
  );
  if (effectiveGuidanceSources !== undefined) {
    (
      snapshot as {
        effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
      }
    ).effectiveGuidanceSources = effectiveGuidanceSources;
  }
  if (typeof candidate.latestTurnId === "string") {
    (snapshot as { latestTurnId?: string }).latestTurnId = candidate.latestTurnId;
  }
  if (typeof candidate.latestTurnProviderId === "string") {
    (snapshot as { latestTurnProviderId?: string }).latestTurnProviderId =
      candidate.latestTurnProviderId;
  }
  if (typeof candidate.latestTurnModel === "string") {
    (snapshot as { latestTurnModel?: string }).latestTurnModel = candidate.latestTurnModel;
  }
  if (typeof candidate.latestTurnRuntimeStatus === "string") {
    (snapshot as { latestTurnRuntimeStatus?: string }).latestTurnRuntimeStatus =
      candidate.latestTurnRuntimeStatus;
  }
  if (typeof candidate.latestTurnTurnBranch === "string") {
    (snapshot as { latestTurnTurnBranch?: string }).latestTurnTurnBranch =
      candidate.latestTurnTurnBranch;
  }
  if (typeof candidate.latestTurnFinishReason === "string") {
    (snapshot as { latestTurnFinishReason?: string }).latestTurnFinishReason =
      candidate.latestTurnFinishReason;
  }
  if (typeof candidate.latestTurnCompletedSteps === "number") {
    (snapshot as { latestTurnCompletedSteps?: number }).latestTurnCompletedSteps =
      candidate.latestTurnCompletedSteps;
  }
  if (typeof candidate.latestTurnResumeAction === "string") {
    (snapshot as { latestTurnResumeAction?: string }).latestTurnResumeAction =
      candidate.latestTurnResumeAction;
  }
  if (typeof candidate.latestTurnNextStepIndex === "number") {
    (snapshot as { latestTurnNextStepIndex?: number }).latestTurnNextStepIndex =
      candidate.latestTurnNextStepIndex;
  }
  if (typeof candidate.latestTurnLastStepEventType === "string") {
    (snapshot as { latestTurnLastStepEventType?: string }).latestTurnLastStepEventType =
      candidate.latestTurnLastStepEventType;
  }
  if (typeof candidate.latestTurnToolCount === "number") {
    (snapshot as { latestTurnToolCount?: number }).latestTurnToolCount =
      candidate.latestTurnToolCount;
  }
  const latestTurnToolOutcomes = coerceToolOutcomeSummary(candidate.latestTurnToolOutcomes);
  if (latestTurnToolOutcomes !== undefined) {
    (
      snapshot as {
        latestTurnToolOutcomes?: SessionObservationSnapshot["latestTurnToolOutcomes"];
      }
    ).latestTurnToolOutcomes = latestTurnToolOutcomes;
  }
  const latestTurnReasoning = coercePromptLatestTurnReasoningSummary(candidate.latestTurnReasoning);
  if (latestTurnReasoning !== undefined) {
    (
      snapshot as {
        latestTurnReasoning?: SessionObservationSnapshot["latestTurnReasoning"];
      }
    ).latestTurnReasoning = latestTurnReasoning;
  }
  const latestTurnToolRuntimeGuidance = coercePromptToolRuntimeGuidanceSummary(
    candidate.latestTurnToolRuntimeGuidance,
  );
  if (latestTurnToolRuntimeGuidance !== undefined) {
    (
      snapshot as {
        latestTurnToolRuntimeGuidance?: SessionObservationSnapshot["latestTurnToolRuntimeGuidance"];
      }
    ).latestTurnToolRuntimeGuidance = latestTurnToolRuntimeGuidance;
  }
  const latestTurnRuntimeDegradationSummaries = readOptionalStringArray(
    candidate.latestTurnRuntimeDegradationSummaries,
  );
  if (latestTurnRuntimeDegradationSummaries !== undefined) {
    (
      snapshot as {
        latestTurnRuntimeDegradationSummaries?: SessionObservationSnapshot["latestTurnRuntimeDegradationSummaries"];
      }
    ).latestTurnRuntimeDegradationSummaries = latestTurnRuntimeDegradationSummaries;
  }
  if (typeof candidate.latestAuditKind === "string") {
    (snapshot as { latestAuditKind?: string }).latestAuditKind = candidate.latestAuditKind;
  }
  if (typeof candidate.latestStreamKind === "string") {
    (snapshot as { latestStreamKind?: string }).latestStreamKind = candidate.latestStreamKind;
  }

  const step = coerceObservationStep(candidate.step);
  if (step) {
    (snapshot as { step?: SessionObservationSnapshot["step"] }).step = step;
  }
  return snapshot;
}

export function createSessionPromptInspectSnapshot(
  sessionStore: Pick<SessionStore, "recoverLatestStep">,
  input: SessionPromptInspectInput,
): SessionPromptInspectSnapshot {
  const selection = resolvePromptBuildSelection(sessionStore, input);
  const previousPayload = selection.previousPayload;
  const sessionGuidance = extractPromptSessionGuidance(selection.payload.dynamicSections);
  const runtimeDefaultGuidance = extractPromptSessionGuidance(selection.payload.staticSections);
  const effectiveGuidance = buildPromptEffectiveGuidance(runtimeDefaultGuidance, sessionGuidance);
  const effectiveGuidanceSources = buildPromptEffectiveGuidanceSourceSummary(
    runtimeDefaultGuidance,
    sessionGuidance,
  );
  const toolRuntimeGuidance = extractPromptToolRuntimeGuidance(selection.payload.dynamicSections);
  const turnResumeGuidance = extractPromptTurnResumeGuidance(selection.payload.dynamicSections);
  const latestTurnGuidance = extractPromptLatestTurnGuidance(selection.payload.dynamicSections);
  const runtimeShellSectionIds = extractRuntimeShellSectionIds(selection.payload.staticSections);
  const runtimeShellSectionSummaries = summarizePromptSectionIds(runtimeShellSectionIds);
  const staticGuidanceSectionIds = extractStaticGuidanceSectionIds(
    selection.payload.staticSections,
  );
  const staticGuidanceSectionSummaries = summarizePromptSectionIds(staticGuidanceSectionIds);
  const focusSectionIds = selection.payload.dynamicSections.map((section) => section.id);
  const focusSectionSummaries = summarizePromptSectionIds(focusSectionIds);
  const omittedSectionIds = selection.payload.omittedSections.map((section) => section.id);
  const omittedSectionSummaries = summarizePromptSectionIds(omittedSectionIds);
  const addedDynamicSectionIds = diffSectionIds(
    selection.payload.dynamicSections,
    previousPayload?.dynamicSections,
  );
  const removedDynamicSectionIds = diffSectionIds(
    previousPayload?.dynamicSections,
    selection.payload.dynamicSections,
  );
  const newlyOmittedSectionIds = diffSectionIds(
    selection.payload.omittedSections,
    previousPayload?.omittedSections,
  );
  const restoredOmittedSectionIds = diffSectionIds(
    previousPayload?.omittedSections,
    selection.payload.omittedSections,
  );
  const addedDynamicSectionSummaries = summarizePromptSectionIds(addedDynamicSectionIds);
  const removedDynamicSectionSummaries = summarizePromptSectionIds(removedDynamicSectionIds);
  const newlyOmittedSectionSummaries = summarizePromptSectionIds(newlyOmittedSectionIds);
  const restoredOmittedSectionSummaries = summarizePromptSectionIds(restoredOmittedSectionIds);
  const runtimeDegradationSummaries = summarizePromptRuntimeDegradations(
    selection.payload.runtimeDegradations,
  );

  return {
    sessionId: selection.sessionId,
    turnId: selection.turnId,
    stepIndex: selection.stepIndex,
    ...(selection.previousStepIndex === undefined
      ? {}
      : { previousStepIndex: selection.previousStepIndex }),
    availableStepIndices: selection.availableStepIndices,
    ...selection.payload,
    ...(runtimeShellSectionIds.length === 0 ? {} : { runtimeShellSectionIds }),
    ...(runtimeShellSectionSummaries.length === 0 ? {} : { runtimeShellSectionSummaries }),
    ...(staticGuidanceSectionIds.length === 0 ? {} : { staticGuidanceSectionIds }),
    ...(staticGuidanceSectionSummaries.length === 0 ? {} : { staticGuidanceSectionSummaries }),
    focusSectionIds,
    ...(focusSectionSummaries.length === 0 ? {} : { focusSectionSummaries }),
    omittedSectionIds,
    ...(omittedSectionSummaries.length === 0 ? {} : { omittedSectionSummaries }),
    addedDynamicSectionIds,
    ...(addedDynamicSectionSummaries.length === 0 ? {} : { addedDynamicSectionSummaries }),
    removedDynamicSectionIds,
    ...(removedDynamicSectionSummaries.length === 0 ? {} : { removedDynamicSectionSummaries }),
    newlyOmittedSectionIds,
    ...(newlyOmittedSectionSummaries.length === 0 ? {} : { newlyOmittedSectionSummaries }),
    restoredOmittedSectionIds,
    ...(restoredOmittedSectionSummaries.length === 0 ? {} : { restoredOmittedSectionSummaries }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
    ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
    ...(turnResumeGuidance === undefined ? {} : { turnResumeGuidance }),
    ...(latestTurnGuidance === undefined ? {} : { latestTurnGuidance }),
    ...(runtimeDegradationSummaries.length === 0 ? {} : { runtimeDegradationSummaries }),
  };
}

export function createSessionPromptExplainSnapshot(
  sessionStore: Pick<SessionStore, "recoverLatestStep">,
  input: SessionPromptInspectInput,
): SessionPromptExplainSnapshot {
  const selection = resolvePromptBuildSelection(sessionStore, input);
  const previousPayload = selection.previousPayload;
  const sessionGuidance = extractPromptSessionGuidance(selection.payload.dynamicSections);
  const runtimeDefaultGuidance = extractPromptSessionGuidance(selection.payload.staticSections);
  const effectiveGuidance = buildPromptEffectiveGuidance(runtimeDefaultGuidance, sessionGuidance);
  const effectiveGuidanceSources = buildPromptEffectiveGuidanceSourceSummary(
    runtimeDefaultGuidance,
    sessionGuidance,
  );
  const toolRuntimeGuidance = extractPromptToolRuntimeGuidance(selection.payload.dynamicSections);
  const turnResumeGuidance = extractPromptTurnResumeGuidance(selection.payload.dynamicSections);
  const latestTurnGuidance = extractPromptLatestTurnGuidance(selection.payload.dynamicSections);
  const runtimeShellSectionIds = extractRuntimeShellSectionIds(selection.payload.staticSections);
  const staticGuidanceSectionIds = extractStaticGuidanceSectionIds(
    selection.payload.staticSections,
  );
  const runtimeShellSectionSummaries = summarizePromptSectionIds(runtimeShellSectionIds);
  const focusSectionIds = selection.payload.dynamicSections.map((section) => section.id);
  const omittedSectionIds = selection.payload.omittedSections.map((section) => section.id);
  const addedDynamicSectionIds = diffSectionIds(
    selection.payload.dynamicSections,
    previousPayload?.dynamicSections,
  );
  const removedDynamicSectionIds = diffSectionIds(
    previousPayload?.dynamicSections,
    selection.payload.dynamicSections,
  );
  const newlyOmittedSectionIds = diffSectionIds(
    selection.payload.omittedSections,
    previousPayload?.omittedSections,
  );
  const restoredOmittedSectionIds = diffSectionIds(
    previousPayload?.omittedSections,
    selection.payload.omittedSections,
  );
  const focusSectionSummaries = summarizePromptSectionIds(focusSectionIds);
  const omittedSectionSummaries = summarizePromptSectionIds(omittedSectionIds);
  const addedDynamicSectionSummaries = summarizePromptSectionIds(addedDynamicSectionIds);
  const removedDynamicSectionSummaries = summarizePromptSectionIds(removedDynamicSectionIds);
  const newlyOmittedSectionSummaries = summarizePromptSectionIds(newlyOmittedSectionIds);
  const restoredOmittedSectionSummaries = summarizePromptSectionIds(restoredOmittedSectionIds);
  const staticGuidanceSectionSummaries = summarizePromptSectionIds(staticGuidanceSectionIds);
  const runtimeDegradationSummaries = summarizePromptRuntimeDegradations(
    selection.payload.runtimeDegradations,
  );

  return {
    sessionId: selection.sessionId,
    turnId: selection.turnId,
    stepIndex: selection.stepIndex,
    ...(selection.previousStepIndex === undefined
      ? {}
      : { previousStepIndex: selection.previousStepIndex }),
    availableStepIndices: selection.availableStepIndices,
    usedTokens: selection.payload.usedTokens,
    remainingTokens: selection.payload.remainingTokens,
    ...(runtimeShellSectionIds.length === 0 ? {} : { runtimeShellSectionIds }),
    ...(runtimeShellSectionSummaries.length === 0 ? {} : { runtimeShellSectionSummaries }),
    ...(staticGuidanceSectionIds.length === 0 ? {} : { staticGuidanceSectionIds }),
    ...(staticGuidanceSectionSummaries.length === 0 ? {} : { staticGuidanceSectionSummaries }),
    focusSectionIds,
    ...(focusSectionSummaries.length === 0 ? {} : { focusSectionSummaries }),
    omittedSectionIds,
    ...(omittedSectionSummaries.length === 0 ? {} : { omittedSectionSummaries }),
    runtimeDegradations: selection.payload.runtimeDegradations,
    addedDynamicSectionIds,
    ...(addedDynamicSectionSummaries.length === 0 ? {} : { addedDynamicSectionSummaries }),
    removedDynamicSectionIds,
    ...(removedDynamicSectionSummaries.length === 0 ? {} : { removedDynamicSectionSummaries }),
    newlyOmittedSectionIds,
    ...(newlyOmittedSectionSummaries.length === 0 ? {} : { newlyOmittedSectionSummaries }),
    restoredOmittedSectionIds,
    ...(restoredOmittedSectionSummaries.length === 0 ? {} : { restoredOmittedSectionSummaries }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
    ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
    ...(turnResumeGuidance === undefined ? {} : { turnResumeGuidance }),
    ...(latestTurnGuidance === undefined ? {} : { latestTurnGuidance }),
    ...(runtimeDegradationSummaries.length === 0 ? {} : { runtimeDegradationSummaries }),
  };
}

function createSessionObservationPromptSummary(
  sessionStore: Pick<SessionStore, "recoverLatestStep">,
  input: SessionPromptInspectInput,
): SessionObservationPromptSummary | undefined {
  try {
    const snapshot = createSessionPromptExplainSnapshot(sessionStore, input);
    return {
      stepIndex: snapshot.stepIndex,
      ...(snapshot.previousStepIndex === undefined
        ? {}
        : { previousStepIndex: snapshot.previousStepIndex }),
      usedTokens: snapshot.usedTokens,
      remainingTokens: snapshot.remainingTokens,
      ...(snapshot.runtimeShellSectionIds === undefined
        ? {}
        : { runtimeShellSectionIds: snapshot.runtimeShellSectionIds }),
      ...(snapshot.runtimeShellSectionSummaries === undefined
        ? {}
        : { runtimeShellSectionSummaries: snapshot.runtimeShellSectionSummaries }),
      ...(snapshot.staticGuidanceSectionIds === undefined
        ? {}
        : { staticGuidanceSectionIds: snapshot.staticGuidanceSectionIds }),
      ...(snapshot.staticGuidanceSectionSummaries === undefined
        ? {}
        : { staticGuidanceSectionSummaries: snapshot.staticGuidanceSectionSummaries }),
      focusSectionIds: snapshot.focusSectionIds,
      ...(snapshot.focusSectionSummaries === undefined
        ? {}
        : { focusSectionSummaries: snapshot.focusSectionSummaries }),
      omittedSectionIds: snapshot.omittedSectionIds,
      ...(snapshot.omittedSectionSummaries === undefined
        ? {}
        : { omittedSectionSummaries: snapshot.omittedSectionSummaries }),
      runtimeDegradations: snapshot.runtimeDegradations,
      addedDynamicSectionIds: snapshot.addedDynamicSectionIds,
      ...(snapshot.addedDynamicSectionSummaries === undefined
        ? {}
        : { addedDynamicSectionSummaries: snapshot.addedDynamicSectionSummaries }),
      removedDynamicSectionIds: snapshot.removedDynamicSectionIds,
      ...(snapshot.removedDynamicSectionSummaries === undefined
        ? {}
        : { removedDynamicSectionSummaries: snapshot.removedDynamicSectionSummaries }),
      newlyOmittedSectionIds: snapshot.newlyOmittedSectionIds,
      ...(snapshot.newlyOmittedSectionSummaries === undefined
        ? {}
        : { newlyOmittedSectionSummaries: snapshot.newlyOmittedSectionSummaries }),
      restoredOmittedSectionIds: snapshot.restoredOmittedSectionIds,
      ...(snapshot.restoredOmittedSectionSummaries === undefined
        ? {}
        : { restoredOmittedSectionSummaries: snapshot.restoredOmittedSectionSummaries }),
      ...(snapshot.sessionGuidance === undefined
        ? {}
        : { sessionGuidance: snapshot.sessionGuidance }),
      ...(snapshot.effectiveGuidance === undefined
        ? {}
        : { effectiveGuidance: snapshot.effectiveGuidance }),
      ...(snapshot.effectiveGuidanceSources === undefined
        ? {}
        : { effectiveGuidanceSources: snapshot.effectiveGuidanceSources }),
      ...(snapshot.toolRuntimeGuidance === undefined
        ? {}
        : { toolRuntimeGuidance: snapshot.toolRuntimeGuidance }),
      ...(snapshot.turnResumeGuidance === undefined
        ? {}
        : { turnResumeGuidance: snapshot.turnResumeGuidance }),
      ...(snapshot.latestTurnGuidance === undefined
        ? {}
        : { latestTurnGuidance: snapshot.latestTurnGuidance }),
      ...(snapshot.runtimeDegradationSummaries === undefined
        ? {}
        : { runtimeDegradationSummaries: snapshot.runtimeDegradationSummaries }),
    };
  } catch {
    return undefined;
  }
}

export function coerceSessionResumeSnapshot(data: unknown): SessionResumeSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    sessionId?: unknown;
    requestedCheckpointId?: unknown;
    checkpointId?: unknown;
    checkpointUptoSeq?: unknown;
    firstTodo?: unknown;
    lastAppliedSeq?: unknown;
    journalEvents?: unknown;
    auditEvents?: unknown;
    streamEvents?: unknown;
    latestTurnId?: unknown;
    latestTurnProviderId?: unknown;
    latestTurnModel?: unknown;
    recoveryProviderId?: unknown;
    recoveryModel?: unknown;
    recoverySelectionSource?: unknown;
    recoveryReasoningStrategy?: unknown;
    recoveryReasoningSource?: unknown;
    resumable?: unknown;
    guidance?: unknown;
    resumeAction?: unknown;
    nextStepIndex?: unknown;
    runtimeStatus?: unknown;
    toolOutcomes?: unknown;
    replayWindow?: unknown;
    lastStepEventType?: unknown;
  };
  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.firstTodo !== "string" ||
    typeof candidate.lastAppliedSeq !== "number" ||
    typeof candidate.journalEvents !== "number" ||
    typeof candidate.auditEvents !== "number" ||
    typeof candidate.streamEvents !== "number" ||
    typeof candidate.resumable !== "boolean" ||
    typeof candidate.guidance !== "string" ||
    typeof candidate.resumeAction !== "string" ||
    typeof candidate.nextStepIndex !== "number"
  ) {
    return undefined;
  }

  const checkpointId =
    candidate.checkpointId === null ? null : readNullableNumber(candidate.checkpointId);
  const checkpointUptoSeq =
    candidate.checkpointUptoSeq === null ? null : readNullableNumber(candidate.checkpointUptoSeq);
  const requestedCheckpointId =
    candidate.requestedCheckpointId === null
      ? null
      : readNullableNumber(candidate.requestedCheckpointId);
  const latestTurnId =
    candidate.latestTurnId === null
      ? null
      : typeof candidate.latestTurnId === "string"
        ? candidate.latestTurnId
        : null;
  const latestTurnProviderId =
    candidate.latestTurnProviderId === null
      ? null
      : typeof candidate.latestTurnProviderId === "string"
        ? candidate.latestTurnProviderId
        : null;
  const latestTurnModel =
    candidate.latestTurnModel === null
      ? null
      : typeof candidate.latestTurnModel === "string"
        ? candidate.latestTurnModel
        : null;
  const recoveryProviderId =
    candidate.recoveryProviderId === null
      ? null
      : typeof candidate.recoveryProviderId === "string"
        ? candidate.recoveryProviderId
        : null;
  const recoveryModel =
    candidate.recoveryModel === null
      ? null
      : typeof candidate.recoveryModel === "string"
        ? candidate.recoveryModel
        : null;
  const toolOutcomes =
    coerceToolOutcomeSummary(candidate.toolOutcomes) ?? EMPTY_TOOL_OUTCOME_SUMMARY;
  const runtimeStatus =
    candidate.runtimeStatus === "healthy" ||
    candidate.runtimeStatus === "degraded" ||
    candidate.runtimeStatus === "blocked" ||
    candidate.runtimeStatus === "failed"
      ? candidate.runtimeStatus
      : deriveRuntimeStatus(toolOutcomes);

  if (
    (candidate.checkpointId !== undefined && checkpointId === undefined) ||
    (candidate.checkpointUptoSeq !== undefined && checkpointUptoSeq === undefined) ||
    (candidate.requestedCheckpointId !== undefined && requestedCheckpointId === undefined)
  ) {
    return undefined;
  }

  const derivedRecoverySelection = resolveResumeRecoverySelection({
    latestTurnId,
    latestTurnProviderId,
    latestTurnModel,
    ...(recoveryProviderId === null ? {} : { defaultProviderId: recoveryProviderId }),
    ...(recoveryModel === null ? {} : { defaultModel: recoveryModel }),
  });
  const recoverySelectionSource =
    candidate.recoverySelectionSource === "persisted-runtime" ||
    candidate.recoverySelectionSource === "default-fallback" ||
    candidate.recoverySelectionSource === "unavailable"
      ? candidate.recoverySelectionSource
      : derivedRecoverySelection.source;
  const recoveryReasoningStrategy =
    candidate.recoveryReasoningStrategy === "react" ||
    candidate.recoveryReasoningStrategy === "plan-execute"
      ? candidate.recoveryReasoningStrategy
      : null;
  const recoveryReasoningSource =
    candidate.recoveryReasoningSource === "stream-evidence" ||
    candidate.recoveryReasoningSource === "latest-turn-fallback" ||
    candidate.recoveryReasoningSource === "surface-default" ||
    candidate.recoveryReasoningSource === "unavailable"
      ? candidate.recoveryReasoningSource
      : latestTurnId === null
        ? "unavailable"
        : "surface-default";

  const snapshot: SessionResumeSnapshot = {
    sessionId: candidate.sessionId,
    requestedCheckpointId: requestedCheckpointId ?? null,
    checkpointId: checkpointId ?? null,
    checkpointUptoSeq: checkpointUptoSeq ?? null,
    firstTodo: candidate.firstTodo,
    lastAppliedSeq: candidate.lastAppliedSeq,
    journalEvents: candidate.journalEvents,
    auditEvents: candidate.auditEvents,
    streamEvents: candidate.streamEvents,
    latestTurnId,
    latestTurnProviderId,
    latestTurnModel,
    recoveryProviderId:
      recoveryProviderId ??
      (recoverySelectionSource === "unavailable" ? null : derivedRecoverySelection.providerId),
    recoveryModel:
      recoveryModel ??
      (recoverySelectionSource === "unavailable" ? null : derivedRecoverySelection.model),
    recoverySelectionSource,
    recoveryReasoningStrategy,
    recoveryReasoningSource,
    resumable: candidate.resumable,
    guidance: candidate.guidance,
    resumeAction: candidate.resumeAction,
    nextStepIndex: candidate.nextStepIndex,
    runtimeStatus,
    toolOutcomes,
  };
  if (typeof candidate.lastStepEventType === "string") {
    (snapshot as { lastStepEventType?: string }).lastStepEventType = candidate.lastStepEventType;
  }
  const replayWindow = coerceReplayWindow(candidate.replayWindow);
  if (replayWindow) {
    (snapshot as { replayWindow?: SessionResumeSnapshot["replayWindow"] }).replayWindow =
      replayWindow;
  }
  return snapshot;
}

export function coerceSessionPromptInspectSnapshot(
  data: unknown,
): SessionPromptInspectSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const turnId = readStringValue(record?.turnId);
  const stepIndex = readNumberValue(record?.stepIndex);
  const previousStepIndex = readNumberValue(record?.previousStepIndex);
  const usedTokens = readNumberValue(record?.usedTokens);
  const remainingTokens = readNumberValue(record?.remainingTokens);
  const availableStepIndices = readNumberArray(record?.availableStepIndices);
  const runtimeShellSectionIds = readOptionalStringArray(record?.runtimeShellSectionIds);
  const runtimeShellSectionSummaries = readOptionalStringArray(
    record?.runtimeShellSectionSummaries,
  );
  const staticGuidanceSectionIds = readOptionalStringArray(record?.staticGuidanceSectionIds);
  const staticGuidanceSectionSummaries = readOptionalStringArray(
    record?.staticGuidanceSectionSummaries,
  );
  const staticSections = coercePromptInspectSectionSummaryArray(record?.staticSections);
  const dynamicSections = coercePromptInspectSectionSummaryArray(record?.dynamicSections);
  const omittedSections = coercePromptInspectSectionSummaryArray(record?.omittedSections);
  const runtimeDegradations =
    coercePromptInspectRuntimeDegradationArray(record?.runtimeDegradations) ?? [];
  const sessionGuidance = coercePromptSessionGuidanceSummary(record?.sessionGuidance);
  const effectiveGuidance = coercePromptSessionGuidanceSummary(record?.effectiveGuidance);
  const effectiveGuidanceSources = coercePromptSessionGuidanceSourceSummary(
    record?.effectiveGuidanceSources,
  );
  const toolRuntimeGuidance = coercePromptToolRuntimeGuidanceSummary(record?.toolRuntimeGuidance);
  const turnResumeGuidance = coercePromptTurnResumeGuidanceSummary(record?.turnResumeGuidance);
  const latestTurnGuidance = coercePromptLatestTurnGuidanceSummary(record?.latestTurnGuidance);
  const runtimeDegradationSummaries = readOptionalStringArray(record?.runtimeDegradationSummaries);

  if (
    sessionId === undefined ||
    turnId === undefined ||
    stepIndex === undefined ||
    availableStepIndices === undefined ||
    usedTokens === undefined ||
    remainingTokens === undefined ||
    staticSections === undefined ||
    dynamicSections === undefined ||
    omittedSections === undefined
  ) {
    return undefined;
  }

  const focusSectionIds =
    readOptionalStringArray(record?.focusSectionIds) ??
    dynamicSections.map((section) => section.id);
  const focusSectionSummaries =
    readOptionalStringArray(record?.focusSectionSummaries) ??
    summarizePromptSectionIds(focusSectionIds);
  const omittedSectionIds =
    readOptionalStringArray(record?.omittedSectionIds) ??
    omittedSections.map((section) => section.id);
  const omittedSectionSummaries =
    readOptionalStringArray(record?.omittedSectionSummaries) ??
    summarizePromptSectionIds(omittedSectionIds);
  const addedDynamicSectionIds = readOptionalStringArray(record?.addedDynamicSectionIds) ?? [];
  const addedDynamicSectionSummaries =
    readOptionalStringArray(record?.addedDynamicSectionSummaries) ??
    summarizePromptSectionIds(addedDynamicSectionIds);
  const removedDynamicSectionIds = readOptionalStringArray(record?.removedDynamicSectionIds) ?? [];
  const removedDynamicSectionSummaries =
    readOptionalStringArray(record?.removedDynamicSectionSummaries) ??
    summarizePromptSectionIds(removedDynamicSectionIds);
  const newlyOmittedSectionIds = readOptionalStringArray(record?.newlyOmittedSectionIds) ?? [];
  const newlyOmittedSectionSummaries =
    readOptionalStringArray(record?.newlyOmittedSectionSummaries) ??
    summarizePromptSectionIds(newlyOmittedSectionIds);
  const restoredOmittedSectionIds =
    readOptionalStringArray(record?.restoredOmittedSectionIds) ?? [];
  const restoredOmittedSectionSummaries =
    readOptionalStringArray(record?.restoredOmittedSectionSummaries) ??
    summarizePromptSectionIds(restoredOmittedSectionIds);

  return {
    sessionId,
    turnId,
    stepIndex,
    ...(previousStepIndex === undefined ? {} : { previousStepIndex }),
    availableStepIndices,
    usedTokens,
    remainingTokens,
    ...(runtimeShellSectionIds === undefined ? {} : { runtimeShellSectionIds }),
    ...(runtimeShellSectionSummaries === undefined ? {} : { runtimeShellSectionSummaries }),
    ...(staticGuidanceSectionIds === undefined ? {} : { staticGuidanceSectionIds }),
    ...(staticGuidanceSectionSummaries === undefined ? {} : { staticGuidanceSectionSummaries }),
    focusSectionIds,
    ...(focusSectionSummaries.length === 0 ? {} : { focusSectionSummaries }),
    omittedSectionIds,
    ...(omittedSectionSummaries.length === 0 ? {} : { omittedSectionSummaries }),
    staticSections,
    dynamicSections,
    omittedSections,
    runtimeDegradations,
    addedDynamicSectionIds,
    ...(addedDynamicSectionSummaries.length === 0 ? {} : { addedDynamicSectionSummaries }),
    removedDynamicSectionIds,
    ...(removedDynamicSectionSummaries.length === 0 ? {} : { removedDynamicSectionSummaries }),
    newlyOmittedSectionIds,
    ...(newlyOmittedSectionSummaries.length === 0 ? {} : { newlyOmittedSectionSummaries }),
    restoredOmittedSectionIds,
    ...(restoredOmittedSectionSummaries.length === 0 ? {} : { restoredOmittedSectionSummaries }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
    ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
    ...(turnResumeGuidance === undefined ? {} : { turnResumeGuidance }),
    ...(latestTurnGuidance === undefined ? {} : { latestTurnGuidance }),
    ...(runtimeDegradationSummaries === undefined ? {} : { runtimeDegradationSummaries }),
  };
}

export function coerceSessionPromptExplainSnapshot(
  data: unknown,
): SessionPromptExplainSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const turnId = readStringValue(record?.turnId);
  const stepIndex = readNumberValue(record?.stepIndex);
  const previousStepIndex = readNumberValue(record?.previousStepIndex);
  const availableStepIndices = readNumberArray(record?.availableStepIndices);
  const usedTokens = readNumberValue(record?.usedTokens);
  const remainingTokens = readNumberValue(record?.remainingTokens);
  const runtimeShellSectionIds = readOptionalStringArray(record?.runtimeShellSectionIds);
  const runtimeShellSectionSummaries = readOptionalStringArray(
    record?.runtimeShellSectionSummaries,
  );
  const staticGuidanceSectionIds = readOptionalStringArray(record?.staticGuidanceSectionIds);
  const staticGuidanceSectionSummaries = readOptionalStringArray(
    record?.staticGuidanceSectionSummaries,
  );
  const focusSectionIds = readStringArray(record?.focusSectionIds);
  const focusSectionSummaries = readOptionalStringArray(record?.focusSectionSummaries);
  const omittedSectionIds = readStringArray(record?.omittedSectionIds);
  const omittedSectionSummaries = readOptionalStringArray(record?.omittedSectionSummaries);
  const runtimeDegradations =
    coercePromptInspectRuntimeDegradationArray(record?.runtimeDegradations) ?? [];
  const addedDynamicSectionIds = readStringArray(record?.addedDynamicSectionIds);
  const addedDynamicSectionSummaries = readOptionalStringArray(
    record?.addedDynamicSectionSummaries,
  );
  const removedDynamicSectionIds = readStringArray(record?.removedDynamicSectionIds);
  const removedDynamicSectionSummaries = readOptionalStringArray(
    record?.removedDynamicSectionSummaries,
  );
  const newlyOmittedSectionIds = readStringArray(record?.newlyOmittedSectionIds);
  const newlyOmittedSectionSummaries = readOptionalStringArray(
    record?.newlyOmittedSectionSummaries,
  );
  const restoredOmittedSectionIds = readStringArray(record?.restoredOmittedSectionIds);
  const restoredOmittedSectionSummaries = readOptionalStringArray(
    record?.restoredOmittedSectionSummaries,
  );
  const sessionGuidance = coercePromptSessionGuidanceSummary(record?.sessionGuidance);
  const effectiveGuidance = coercePromptSessionGuidanceSummary(record?.effectiveGuidance);
  const effectiveGuidanceSources = coercePromptSessionGuidanceSourceSummary(
    record?.effectiveGuidanceSources,
  );
  const toolRuntimeGuidance = coercePromptToolRuntimeGuidanceSummary(record?.toolRuntimeGuidance);
  const turnResumeGuidance = coercePromptTurnResumeGuidanceSummary(record?.turnResumeGuidance);
  const latestTurnGuidance = coercePromptLatestTurnGuidanceSummary(record?.latestTurnGuidance);
  const runtimeDegradationSummaries = readOptionalStringArray(record?.runtimeDegradationSummaries);

  if (
    sessionId === undefined ||
    turnId === undefined ||
    stepIndex === undefined ||
    availableStepIndices === undefined ||
    usedTokens === undefined ||
    remainingTokens === undefined
  ) {
    return undefined;
  }

  return {
    sessionId,
    turnId,
    stepIndex,
    ...(previousStepIndex === undefined ? {} : { previousStepIndex }),
    availableStepIndices,
    usedTokens,
    remainingTokens,
    ...(runtimeShellSectionIds === undefined ? {} : { runtimeShellSectionIds }),
    ...(runtimeShellSectionSummaries === undefined ? {} : { runtimeShellSectionSummaries }),
    ...(staticGuidanceSectionIds === undefined ? {} : { staticGuidanceSectionIds }),
    ...(staticGuidanceSectionSummaries === undefined ? {} : { staticGuidanceSectionSummaries }),
    focusSectionIds,
    ...(focusSectionSummaries === undefined ? {} : { focusSectionSummaries }),
    omittedSectionIds,
    ...(omittedSectionSummaries === undefined ? {} : { omittedSectionSummaries }),
    runtimeDegradations,
    addedDynamicSectionIds,
    ...(addedDynamicSectionSummaries === undefined ? {} : { addedDynamicSectionSummaries }),
    removedDynamicSectionIds,
    ...(removedDynamicSectionSummaries === undefined ? {} : { removedDynamicSectionSummaries }),
    newlyOmittedSectionIds,
    ...(newlyOmittedSectionSummaries === undefined ? {} : { newlyOmittedSectionSummaries }),
    restoredOmittedSectionIds,
    ...(restoredOmittedSectionSummaries === undefined ? {} : { restoredOmittedSectionSummaries }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
    ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
    ...(turnResumeGuidance === undefined ? {} : { turnResumeGuidance }),
    ...(latestTurnGuidance === undefined ? {} : { latestTurnGuidance }),
    ...(runtimeDegradationSummaries === undefined ? {} : { runtimeDegradationSummaries }),
  };
}

export function summarizeStepReplayToolOutcomes(
  replayEntries: ReadonlyArray<{ readonly payload: unknown }>,
): ToolOutcomeSummary {
  if (replayEntries.length === 0) {
    return EMPTY_TOOL_OUTCOME_SUMMARY;
  }

  const counters = createToolOutcomeCounters();
  for (const replayEntry of replayEntries) {
    const outcomes = extractToolOutcomesFromReplayPayload(replayEntry.payload);
    for (const outcome of outcomes) {
      countToolOutcome(counters, outcome);
    }
  }
  return toToolOutcomeSummary(counters);
}

export function deriveRuntimeStatus(summary: ToolOutcomeSummary): ToolRuntimeStatus {
  if (summary.failed > 0) {
    return "failed";
  }
  if (summary.denied > 0 || summary.approvalRequired > 0 || summary.missing > 0) {
    return "blocked";
  }
  if (summary.degraded > 0 || summary.unknown > 0) {
    return "degraded";
  }
  return "healthy";
}

export function formatToolOutcomeSummary(summary: ToolOutcomeSummary): string {
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

function recoverTaskObservationState(
  sessionStore: Pick<SessionStore, "recover">,
  sessionId: string,
) {
  return sessionStore.recover<{
    tasks: { items: Array<{ content: string }>; updatedAtMs?: number };
  }>(sessionId, {
    initialState: { tasks: { items: [] } },
    reducer(state, event) {
      if (event.eventType === "tasks.todo_write") {
        const decoded = decodeTaskTodoWriteState(event.payload);
        if (!decoded) {
          return state;
        }
        return {
          ...state,
          tasks: {
            items: decoded.items.map((item) => ({ content: item.content })),
            ...(decoded.updatedAtMs === undefined ? {} : { updatedAtMs: decoded.updatedAtMs }),
          },
        };
      }
      return state;
    },
  });
}

function createAgentOsTimelineObservationSummary(
  journal: readonly JournalEntry[],
): AgentOsTimelineObservationSummary | undefined {
  const entries = journal.filter(isJournalEntryLike);
  if (entries.length === 0) {
    return undefined;
  }

  const timeline = mapSessionJournalEntriesToAgentOsTimeline({
    entries,
  });
  const summary = projectAgentOsTimelineSummary(timeline);
  const firstEvent = timeline[0];
  const latestEvent = timeline.at(-1);

  return {
    ...summary,
    totalEvents: timeline.length,
    ...(firstEvent === undefined ? {} : { firstSequence: firstEvent.sequence }),
    ...(latestEvent === undefined
      ? {}
      : {
          lastSequence: latestEvent.sequence,
          latestEventType: latestEvent.eventType,
        }),
  };
}

function isJournalEntryLike(entry: JournalEntry): entry is JournalEntry {
  return (
    typeof entry.rowId === "number" &&
    typeof entry.sessionId === "string" &&
    typeof entry.seq === "number" &&
    typeof entry.eventType === "string" &&
    (typeof entry.turnId === "string" || entry.turnId === null) &&
    typeof entry.schemaVersion === "string" &&
    typeof entry.createdAtMs === "number" &&
    Number.isFinite(entry.createdAtMs) &&
    isJsonValue(entry.payload)
  );
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function readLatestMemoryControlSummary(
  journal: ReadonlyArray<unknown>,
): SessionMemoryControlSummary | undefined {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = readObjectRecord(journal[index]);
    const eventType = readStringValue(entry?.eventType);

    if (eventType === "control.memory_clear") {
      const summary = coerceSessionMemoryControlSummary({
        action: "clear",
        scope: readStringValue(readObjectRecord(entry?.payload)?.scope),
        journalSeq: readNumberValue(entry?.seq),
        occurredAtMs: readNumberValue(entry?.createdAtMs),
        beforeWorkingMemoryEntries: readNumberValue(
          readObjectRecord(entry?.payload)?.beforeLayer0Count,
        ),
        beforeEpisodicMemoryEntries: readNumberValue(
          readObjectRecord(entry?.payload)?.beforeLayer1Count,
        ),
        afterWorkingMemoryEntries: readNumberValue(
          readObjectRecord(entry?.payload)?.afterLayer0Count,
        ),
        afterEpisodicMemoryEntries: readNumberValue(
          readObjectRecord(entry?.payload)?.afterLayer1Count,
        ),
      });
      if (summary !== undefined) {
        return summary;
      }
    }

    if (eventType === "control.memory_inspect") {
      const summary = coerceSessionMemoryControlSummary({
        action: "inspect",
        scope: readStringValue(readObjectRecord(entry?.payload)?.scope),
        journalSeq: readNumberValue(entry?.seq),
        occurredAtMs: readNumberValue(entry?.createdAtMs),
        workingMemoryEntries: readNumberValue(readObjectRecord(entry?.payload)?.layer0Count),
        episodicMemoryEntries: readNumberValue(readObjectRecord(entry?.payload)?.layer1Count),
      });
      if (summary !== undefined) {
        return summary;
      }
    }
  }

  return undefined;
}

function readLatestGuidanceControlSummary(
  journal: ReadonlyArray<unknown>,
): SessionGuidanceControlSummary | undefined {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = readObjectRecord(journal[index]);
    const eventType = readStringValue(entry?.eventType);
    const payload = readObjectRecord(entry?.payload);

    if (eventType === "control.output_style") {
      const summary = coerceSessionGuidanceControlSummary({
        action: "output-style",
        value: readStringValue(payload?.style),
        previousValue: readStringValue(payload?.previousStyle),
        journalSeq: readNumberValue(entry?.seq),
        occurredAtMs: readNumberValue(entry?.createdAtMs),
      });
      if (summary !== undefined) {
        return summary;
      }
    }

    if (eventType === "control.permission_mode") {
      const summary = coerceSessionGuidanceControlSummary({
        action: "permission-mode",
        value: readStringValue(payload?.mode),
        previousValue: readStringValue(payload?.previousMode),
        journalSeq: readNumberValue(entry?.seq),
        occurredAtMs: readNumberValue(entry?.createdAtMs),
      });
      if (summary !== undefined) {
        return summary;
      }
    }

    if (eventType === "control.response_language") {
      const summary = coerceSessionGuidanceControlSummary({
        action: "response-language",
        value: readStringValue(payload?.language),
        previousValue: readStringValue(payload?.previousLanguage),
        journalSeq: readNumberValue(entry?.seq),
        occurredAtMs: readNumberValue(entry?.createdAtMs),
      });
      if (summary !== undefined) {
        return summary;
      }
    }
  }

  return undefined;
}

function readLatestTurnRuntimeSelection(
  metadata: unknown,
  latestTurnId: string | undefined,
): {
  readonly latestTurnProviderId?: string;
  readonly latestTurnModel?: string;
} {
  if (latestTurnId === undefined) {
    return {};
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return {};
  }

  const latestTurnProviderId = readStringValue(latestTurn?.providerId);
  const latestTurnModel = readStringValue(latestTurn?.model);

  return {
    ...(latestTurnProviderId === undefined ? {} : { latestTurnProviderId }),
    ...(latestTurnModel === undefined ? {} : { latestTurnModel }),
  };
}

function coerceAgentOsTimelineObservationSummary(
  data: unknown,
): AgentOsTimelineObservationSummary | undefined {
  const record = readObjectRecord(data);
  if (record === undefined) {
    return undefined;
  }

  const totalEvents = readNumberValue(record.totalEvents);
  const firstSequence = readNumberValue(record.firstSequence);
  const lastSequence = readNumberValue(record.lastSequence);
  const latestEventType = readStringValue(record.latestEventType);
  const latestState = readStringValue(record.latestState);
  const approvalEvents = readNumberValue(record.approvalEvents);
  const memoryEvents = readNumberValue(record.memoryEvents);
  const skillEvents = readNumberValue(record.skillEvents);
  const subagentEvents = readNumberValue(record.subagentEvents);
  const controlPlaneEvents = readNumberValue(record.controlPlaneEvents);
  const toolEvents = readNumberValue(record.toolEvents);

  if (
    totalEvents === undefined ||
    approvalEvents === undefined ||
    memoryEvents === undefined ||
    skillEvents === undefined ||
    subagentEvents === undefined ||
    controlPlaneEvents === undefined ||
    toolEvents === undefined ||
    typeof record.finalDelivered !== "boolean"
  ) {
    return undefined;
  }

  const summary: AgentOsTimelineObservationSummary = {
    totalEvents,
    approvalEvents,
    memoryEvents,
    skillEvents,
    subagentEvents,
    controlPlaneEvents,
    toolEvents,
    finalDelivered: record.finalDelivered,
  };
  if (firstSequence !== undefined) {
    (summary as { firstSequence?: number }).firstSequence = firstSequence;
  }
  if (lastSequence !== undefined) {
    (summary as { lastSequence?: number }).lastSequence = lastSequence;
  }
  if (latestEventType !== undefined) {
    (summary as { latestEventType?: AgentOsTimelineEventType }).latestEventType =
      latestEventType as AgentOsTimelineEventType;
  }
  if (latestState !== undefined) {
    (summary as { latestState?: AgentOsTimelineObservationSummary["latestState"] }).latestState =
      latestState as AgentOsTimelineObservationSummary["latestState"];
  }

  return summary;
}

function coerceSessionMemoryControlSummary(data: unknown): SessionMemoryControlSummary | undefined {
  const record = readObjectRecord(data);
  const action = readStringValue(record?.action);
  const scope = readStringValue(record?.scope);
  const journalSeq = readNumberValue(record?.journalSeq);
  const occurredAtMs = readNumberValue(record?.occurredAtMs);
  const workingMemoryEntries = readNumberValue(record?.workingMemoryEntries);
  const episodicMemoryEntries = readNumberValue(record?.episodicMemoryEntries);
  const beforeWorkingMemoryEntries = readNumberValue(record?.beforeWorkingMemoryEntries);
  const beforeEpisodicMemoryEntries = readNumberValue(record?.beforeEpisodicMemoryEntries);
  const afterWorkingMemoryEntries = readNumberValue(record?.afterWorkingMemoryEntries);
  const afterEpisodicMemoryEntries = readNumberValue(record?.afterEpisodicMemoryEntries);

  if (
    (action !== "inspect" && action !== "clear") ||
    (scope !== "working" && scope !== "episodic" && scope !== "all")
  ) {
    return undefined;
  }

  return {
    action,
    scope,
    ...(journalSeq === undefined ? {} : { journalSeq }),
    ...(occurredAtMs === undefined ? {} : { occurredAtMs }),
    ...(workingMemoryEntries === undefined ? {} : { workingMemoryEntries }),
    ...(episodicMemoryEntries === undefined ? {} : { episodicMemoryEntries }),
    ...(beforeWorkingMemoryEntries === undefined ? {} : { beforeWorkingMemoryEntries }),
    ...(beforeEpisodicMemoryEntries === undefined ? {} : { beforeEpisodicMemoryEntries }),
    ...(afterWorkingMemoryEntries === undefined ? {} : { afterWorkingMemoryEntries }),
    ...(afterEpisodicMemoryEntries === undefined ? {} : { afterEpisodicMemoryEntries }),
  };
}

function coerceSessionGuidanceControlSummary(
  data: unknown,
): SessionGuidanceControlSummary | undefined {
  const record = readObjectRecord(data);
  const action = readStringValue(record?.action);
  const value = readStringValue(record?.value);
  const previousValue = readStringValue(record?.previousValue);
  const journalSeq = readNumberValue(record?.journalSeq);
  const occurredAtMs = readNumberValue(record?.occurredAtMs);

  if (
    (action !== "output-style" && action !== "permission-mode" && action !== "response-language") ||
    value === undefined
  ) {
    return undefined;
  }

  return {
    action,
    value,
    ...(previousValue === undefined ? {} : { previousValue }),
    ...(journalSeq === undefined ? {} : { journalSeq }),
    ...(occurredAtMs === undefined ? {} : { occurredAtMs }),
  };
}

function readSessionGuidanceFromMetadata(
  metadata: unknown,
): PromptSessionGuidanceSummary | undefined {
  const metadataRecord = readObjectRecord(metadata);
  return coercePromptSessionGuidanceSummary(metadataRecord?.preferences);
}

function readLatestTurnRuntimeState(
  metadata: unknown,
  latestTurnId: string | undefined,
): {
  readonly latestTurnRuntimeStatus?: string;
  readonly latestTurnTurnBranch?: string;
} {
  if (latestTurnId === undefined) {
    return {};
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return {};
  }

  const latestTurnRuntimeStatus = readStringValue(latestTurn?.runtimeStatus);
  const latestTurnTurnBranch = readStringValue(latestTurn?.turnBranch);

  return {
    ...(latestTurnRuntimeStatus === undefined ? {} : { latestTurnRuntimeStatus }),
    ...(latestTurnTurnBranch === undefined ? {} : { latestTurnTurnBranch }),
  };
}

function readLatestTurnFinishState(
  metadata: unknown,
  latestTurnId: string | undefined,
): {
  readonly latestTurnFinishReason?: string;
  readonly latestTurnCompletedSteps?: number;
} {
  if (latestTurnId === undefined) {
    return {};
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return {};
  }

  const latestTurnFinishReason = readStringValue(latestTurn?.finishReason);
  const latestTurnCompletedSteps = readNumberValue(latestTurn?.completedSteps);

  return {
    ...(latestTurnFinishReason === undefined ? {} : { latestTurnFinishReason }),
    ...(latestTurnCompletedSteps === undefined ? {} : { latestTurnCompletedSteps }),
  };
}

function readLatestTurnContinuity(
  metadata: unknown,
  latestTurnId: string | undefined,
): {
  readonly latestTurnResumeAction?: string;
  readonly latestTurnNextStepIndex?: number;
  readonly latestTurnLastStepEventType?: string;
} {
  if (latestTurnId === undefined) {
    return {};
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return {};
  }

  const latestTurnResumeAction = readStringValue(latestTurn?.resumeAction);
  const latestTurnNextStepIndex = readNumberValue(latestTurn?.nextStepIndex);
  const latestTurnLastStepEventType = readStringValue(latestTurn?.lastStepEventType);

  return {
    ...(latestTurnResumeAction === undefined ? {} : { latestTurnResumeAction }),
    ...(latestTurnNextStepIndex === undefined ? {} : { latestTurnNextStepIndex }),
    ...(latestTurnLastStepEventType === undefined ? {} : { latestTurnLastStepEventType }),
  };
}

function readLatestTurnToolSummary(
  metadata: unknown,
  latestTurnId: string | undefined,
): {
  readonly latestTurnToolCount?: number;
  readonly latestTurnToolOutcomes?: ToolOutcomeSummary;
} {
  if (latestTurnId === undefined) {
    return {};
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return {};
  }

  const latestTurnToolCount = readNumberValue(latestTurn?.toolCount);
  const latestTurnToolOutcomes = coerceToolOutcomeSummary(latestTurn?.toolOutcomes);

  return {
    ...(latestTurnToolCount === undefined ? {} : { latestTurnToolCount }),
    ...(latestTurnToolOutcomes === undefined ? {} : { latestTurnToolOutcomes }),
  };
}

function readLatestTurnReasoning(
  metadata: unknown,
  latestTurnId: string | undefined,
): PromptLatestTurnReasoningSummary | undefined {
  if (latestTurnId === undefined) {
    return undefined;
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return undefined;
  }

  return coercePromptLatestTurnReasoningSummary(latestTurn?.reasoning);
}

function readLatestTurnToolRuntimeGuidance(
  metadata: unknown,
  latestTurnId: string | undefined,
): PromptToolRuntimeGuidanceSummary | undefined {
  if (latestTurnId === undefined) {
    return undefined;
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return undefined;
  }

  return coercePromptToolRuntimeGuidanceSummary(latestTurn?.toolRuntimeGuidance);
}

function readLatestTurnRuntimeDegradationSummaries(
  metadata: unknown,
  latestTurnId: string | undefined,
): readonly string[] | undefined {
  if (latestTurnId === undefined) {
    return undefined;
  }

  const metadataRecord = readObjectRecord(metadata);
  const runtime = readObjectRecord(metadataRecord?.runtime);
  const latestTurn = readObjectRecord(runtime?.latestTurn);
  if (readStringValue(latestTurn?.turnId) !== latestTurnId) {
    return undefined;
  }

  return readOptionalStringArray(latestTurn?.runtimeDegradationSummaries);
}

function resolveResumeRecoverySelection(input: {
  readonly latestTurnId: string | null;
  readonly latestTurnProviderId: string | null;
  readonly latestTurnModel: string | null;
  readonly defaultProviderId?: string;
  readonly defaultModel?: string;
}): {
  readonly providerId: string | null;
  readonly model: string | null;
  readonly source: ResumeRecoverySelectionSource;
} {
  if (input.latestTurnId === null) {
    return {
      providerId: null,
      model: null,
      source: "unavailable",
    };
  }

  if (input.latestTurnProviderId !== null && input.latestTurnModel !== null) {
    return {
      providerId: input.latestTurnProviderId,
      model: input.latestTurnModel,
      source: "persisted-runtime",
    };
  }

  if (input.defaultProviderId !== undefined && input.defaultModel !== undefined) {
    return {
      providerId: input.defaultProviderId,
      model: input.defaultModel,
      source: "default-fallback",
    };
  }

  return {
    providerId: null,
    model: null,
    source: "unavailable",
  };
}

function resolveResumeReasoningSelection(
  sessionStore: Pick<SessionStore, "listStreamEvents">,
  input: {
    readonly sessionId: string;
    readonly latestTurnId: string | null;
    readonly latestTurnReasoning?: PromptLatestTurnReasoningSummary;
  },
): {
  readonly strategy: "react" | "plan-execute" | null;
  readonly source: ResumeReasoningRecoverySource;
} {
  if (input.latestTurnId === null) {
    return {
      strategy: null,
      source: "unavailable",
    };
  }

  const streamedStrategy = readStreamReasoningStrategy(sessionStore, {
    sessionId: input.sessionId,
    turnId: input.latestTurnId,
  });
  if (streamedStrategy !== undefined) {
    return {
      strategy: streamedStrategy,
      source: "stream-evidence",
    };
  }

  if (
    input.latestTurnReasoning?.strategy === "react" ||
    input.latestTurnReasoning?.strategy === "plan-execute"
  ) {
    return {
      strategy: input.latestTurnReasoning.strategy,
      source: "latest-turn-fallback",
    };
  }

  return {
    strategy: null,
    source: "surface-default",
  };
}

function readStreamReasoningStrategy(
  sessionStore: Pick<SessionStore, "listStreamEvents">,
  input: {
    readonly sessionId: string;
    readonly turnId: string;
  },
): "react" | "plan-execute" | undefined {
  if (typeof sessionStore.listStreamEvents !== "function") {
    return undefined;
  }

  const streamEntries = sessionStore.listStreamEvents(input.sessionId, {
    turnId: input.turnId,
  });
  for (const entry of streamEntries) {
    const entryRecord = readObjectRecord(entry);
    const eventRecord = readObjectRecord(entryRecord?.event);
    if (readStringValue(eventRecord?.kind) !== "stream.reasoning") {
      continue;
    }

    const payloadRecord = readObjectRecord(eventRecord?.payload);
    const decisionRecord = readObjectRecord(payloadRecord?.decision);
    const strategy = readStringValue(decisionRecord?.strategy);
    if (strategy === "react" || strategy === "plan-execute") {
      return strategy;
    }
  }

  return undefined;
}

function describeResumeGuidance(
  step: SessionObservationSnapshot["step"] | undefined,
  latestTurnId: string | undefined,
): {
  readonly resumable: boolean;
  readonly guidance: string;
} {
  if (!latestTurnId || !step) {
    return {
      resumable: false,
      guidance: "No interrupted turn is available in this session yet.",
    };
  }

  if (step.resumeAction === "continue-current-step") {
    if (step.runtimeStatus === "blocked") {
      return {
        resumable: true,
        guidance: `Resume step ${step.nextStepIndex} after clearing the blocking approval or policy gate.`,
      };
    }
    if (step.runtimeStatus === "failed") {
      return {
        resumable: true,
        guidance: `Rebuild step ${step.nextStepIndex} from recovered state before continuing.`,
      };
    }
    return {
      resumable: true,
      guidance: `Continue step ${step.nextStepIndex} before branching into new work.`,
    };
  }

  if (step.resumeAction === "start-next-step") {
    return {
      resumable: true,
      guidance: `Start step ${step.nextStepIndex} and reuse the recovered tool results instead of replaying them.`,
    };
  }

  if (step.resumeAction === "turn-complete") {
    return {
      resumable: false,
      guidance:
        "The latest turn is already complete; start a new turn on this session instead of replaying the old one.",
    };
  }

  return {
    resumable: false,
    guidance: "The session has no recoverable in-flight step right now.",
  };
}

function coerceObservationStep(data: unknown): SessionObservationSnapshot["step"] | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    turnId?: unknown;
    resumeAction?: unknown;
    replayWindow?: unknown;
    nextStepIndex?: unknown;
    lastStepEventType?: unknown;
    stepJournalEvents?: unknown;
    modelOutputEvents?: unknown;
    plannedToolEvents?: unknown;
    toolResultEvents?: unknown;
    finalOutputEvents?: unknown;
    toolOutcomes?: unknown;
    runtimeStatus?: unknown;
    promptSummary?: unknown;
  };
  if (
    typeof candidate.turnId !== "string" ||
    typeof candidate.resumeAction !== "string" ||
    typeof candidate.nextStepIndex !== "number" ||
    typeof candidate.stepJournalEvents !== "number" ||
    typeof candidate.modelOutputEvents !== "number" ||
    typeof candidate.plannedToolEvents !== "number" ||
    typeof candidate.toolResultEvents !== "number" ||
    typeof candidate.finalOutputEvents !== "number"
  ) {
    return undefined;
  }
  if (
    !candidate.replayWindow ||
    typeof candidate.replayWindow !== "object" ||
    Array.isArray(candidate.replayWindow)
  ) {
    return undefined;
  }
  const replayWindow = candidate.replayWindow as {
    fromSeqExclusive?: unknown;
    toSeqInclusive?: unknown;
  };
  if (
    typeof replayWindow.fromSeqExclusive !== "number" ||
    typeof replayWindow.toSeqInclusive !== "number"
  ) {
    return undefined;
  }

  const toolOutcomes =
    coerceToolOutcomeSummary(candidate.toolOutcomes) ?? EMPTY_TOOL_OUTCOME_SUMMARY;
  const runtimeStatus =
    candidate.runtimeStatus === "healthy" ||
    candidate.runtimeStatus === "degraded" ||
    candidate.runtimeStatus === "blocked" ||
    candidate.runtimeStatus === "failed"
      ? candidate.runtimeStatus
      : deriveRuntimeStatus(toolOutcomes);
  const promptSummary = coerceObservationPromptSummary(candidate.promptSummary);

  return {
    turnId: candidate.turnId,
    resumeAction: candidate.resumeAction,
    replayWindow: {
      fromSeqExclusive: replayWindow.fromSeqExclusive,
      toSeqInclusive: replayWindow.toSeqInclusive,
    },
    nextStepIndex: candidate.nextStepIndex,
    ...(typeof candidate.lastStepEventType === "string"
      ? { lastStepEventType: candidate.lastStepEventType }
      : {}),
    stepJournalEvents: candidate.stepJournalEvents,
    modelOutputEvents: candidate.modelOutputEvents,
    plannedToolEvents: candidate.plannedToolEvents,
    toolResultEvents: candidate.toolResultEvents,
    finalOutputEvents: candidate.finalOutputEvents,
    toolOutcomes,
    runtimeStatus,
    ...(promptSummary === undefined ? {} : { promptSummary }),
  };
}

function coerceObservationPromptSummary(
  data: unknown,
): SessionObservationPromptSummary | undefined {
  const record = readObjectRecord(data);
  const stepIndex = readNumberValue(record?.stepIndex);
  const previousStepIndex = readNumberValue(record?.previousStepIndex);
  const usedTokens = readNumberValue(record?.usedTokens);
  const remainingTokens = readNumberValue(record?.remainingTokens);
  const runtimeShellSectionIds = readOptionalStringArray(record?.runtimeShellSectionIds);
  const runtimeShellSectionSummaries = readOptionalStringArray(
    record?.runtimeShellSectionSummaries,
  );
  const staticGuidanceSectionIds = readOptionalStringArray(record?.staticGuidanceSectionIds);
  const staticGuidanceSectionSummaries = readOptionalStringArray(
    record?.staticGuidanceSectionSummaries,
  );
  const focusSectionIds = readStringArray(record?.focusSectionIds);
  const focusSectionSummaries = readOptionalStringArray(record?.focusSectionSummaries);
  const omittedSectionIds = readStringArray(record?.omittedSectionIds);
  const omittedSectionSummaries = readOptionalStringArray(record?.omittedSectionSummaries);
  const runtimeDegradations =
    coercePromptInspectRuntimeDegradationArray(record?.runtimeDegradations) ?? [];
  const addedDynamicSectionIds = readStringArray(record?.addedDynamicSectionIds);
  const addedDynamicSectionSummaries = readOptionalStringArray(
    record?.addedDynamicSectionSummaries,
  );
  const removedDynamicSectionIds = readStringArray(record?.removedDynamicSectionIds);
  const removedDynamicSectionSummaries = readOptionalStringArray(
    record?.removedDynamicSectionSummaries,
  );
  const newlyOmittedSectionIds = readStringArray(record?.newlyOmittedSectionIds);
  const newlyOmittedSectionSummaries = readOptionalStringArray(
    record?.newlyOmittedSectionSummaries,
  );
  const restoredOmittedSectionIds = readStringArray(record?.restoredOmittedSectionIds);
  const restoredOmittedSectionSummaries = readOptionalStringArray(
    record?.restoredOmittedSectionSummaries,
  );
  const sessionGuidance = coercePromptSessionGuidanceSummary(record?.sessionGuidance);
  const effectiveGuidance = coercePromptSessionGuidanceSummary(record?.effectiveGuidance);
  const effectiveGuidanceSources = coercePromptSessionGuidanceSourceSummary(
    record?.effectiveGuidanceSources,
  );
  const toolRuntimeGuidance = coercePromptToolRuntimeGuidanceSummary(record?.toolRuntimeGuidance);
  const turnResumeGuidance = coercePromptTurnResumeGuidanceSummary(record?.turnResumeGuidance);
  const latestTurnGuidance = coercePromptLatestTurnGuidanceSummary(record?.latestTurnGuidance);
  const runtimeDegradationSummaries = readOptionalStringArray(record?.runtimeDegradationSummaries);

  if (
    stepIndex === undefined ||
    usedTokens === undefined ||
    remainingTokens === undefined ||
    focusSectionIds === undefined ||
    omittedSectionIds === undefined ||
    addedDynamicSectionIds === undefined ||
    removedDynamicSectionIds === undefined ||
    newlyOmittedSectionIds === undefined ||
    restoredOmittedSectionIds === undefined
  ) {
    return undefined;
  }

  return {
    stepIndex,
    ...(previousStepIndex === undefined ? {} : { previousStepIndex }),
    usedTokens,
    remainingTokens,
    ...(runtimeShellSectionIds === undefined ? {} : { runtimeShellSectionIds }),
    ...(runtimeShellSectionSummaries === undefined ? {} : { runtimeShellSectionSummaries }),
    ...(staticGuidanceSectionIds === undefined ? {} : { staticGuidanceSectionIds }),
    ...(staticGuidanceSectionSummaries === undefined ? {} : { staticGuidanceSectionSummaries }),
    focusSectionIds,
    ...(focusSectionSummaries === undefined ? {} : { focusSectionSummaries }),
    omittedSectionIds,
    ...(omittedSectionSummaries === undefined ? {} : { omittedSectionSummaries }),
    runtimeDegradations,
    addedDynamicSectionIds,
    ...(addedDynamicSectionSummaries === undefined ? {} : { addedDynamicSectionSummaries }),
    removedDynamicSectionIds,
    ...(removedDynamicSectionSummaries === undefined ? {} : { removedDynamicSectionSummaries }),
    newlyOmittedSectionIds,
    ...(newlyOmittedSectionSummaries === undefined ? {} : { newlyOmittedSectionSummaries }),
    restoredOmittedSectionIds,
    ...(restoredOmittedSectionSummaries === undefined ? {} : { restoredOmittedSectionSummaries }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
    ...(toolRuntimeGuidance === undefined ? {} : { toolRuntimeGuidance }),
    ...(turnResumeGuidance === undefined ? {} : { turnResumeGuidance }),
    ...(latestTurnGuidance === undefined ? {} : { latestTurnGuidance }),
    ...(runtimeDegradationSummaries === undefined ? {} : { runtimeDegradationSummaries }),
  };
}

function coerceReplayWindow(
  data: unknown,
): { readonly fromSeqExclusive: number; readonly toSeqInclusive: number } | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    fromSeqExclusive?: unknown;
    toSeqInclusive?: unknown;
  };
  if (
    typeof candidate.fromSeqExclusive !== "number" ||
    typeof candidate.toSeqInclusive !== "number"
  ) {
    return undefined;
  }
  return {
    fromSeqExclusive: candidate.fromSeqExclusive,
    toSeqInclusive: candidate.toSeqInclusive,
  };
}

function readNullableNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function resolvePromptBuildSelection(
  sessionStore: Pick<SessionStore, "recoverLatestStep">,
  input: SessionPromptInspectInput,
): PromptBuildSelection {
  const latestStep = sessionStore.recoverLatestStep(input.sessionId, {
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
  });
  const turnId = latestStep.latestTurnId;
  const stepRecovery = latestStep.stepRecovery;

  if (!turnId || !stepRecovery) {
    throw new Error(`Session "${input.sessionId}" has no prompt build evidence yet.`);
  }

  const contextBuiltEntries = stepRecovery.replay.contextBuilt;
  if (contextBuiltEntries.length === 0) {
    throw new Error(`Session "${input.sessionId}" turn "${turnId}" has no prompt build evidence.`);
  }

  const availableStepIndices = Array.from(
    new Set(contextBuiltEntries.map((entry) => entry.stepIndex)),
  ).sort((left, right) => left - right);

  const selectedEntryIndex =
    input.stepIndex === undefined
      ? contextBuiltEntries.length - 1
      : findLastMatchingPromptBuildIndex(contextBuiltEntries, input.stepIndex);

  if (selectedEntryIndex < 0) {
    throw new Error(
      `Session "${input.sessionId}" turn "${turnId}" is missing prompt build evidence for step ${input.stepIndex}. Available steps: ${availableStepIndices.join(", ")}.`,
    );
  }

  const selectedEntry = contextBuiltEntries[selectedEntryIndex];
  if (!selectedEntry) {
    throw new Error(
      `Session "${input.sessionId}" turn "${turnId}" is missing the selected prompt build entry.`,
    );
  }

  const payload = coercePromptBuildEvidencePayload(selectedEntry.payload);
  if (!payload) {
    throw new Error(
      `Session "${input.sessionId}" turn "${turnId}" step ${selectedEntry.stepIndex} has malformed prompt build evidence.`,
    );
  }

  const previousEntry =
    selectedEntryIndex > 0 ? contextBuiltEntries[selectedEntryIndex - 1] : undefined;
  const previousPayload =
    previousEntry === undefined
      ? undefined
      : coercePromptBuildEvidencePayload(previousEntry.payload);
  if (previousEntry !== undefined && previousPayload === undefined) {
    throw new Error(
      `Session "${input.sessionId}" turn "${turnId}" step ${previousEntry.stepIndex} has malformed previous prompt build evidence.`,
    );
  }

  return {
    sessionId: input.sessionId,
    turnId,
    stepIndex: selectedEntry.stepIndex,
    ...(previousEntry === undefined ? {} : { previousStepIndex: previousEntry.stepIndex }),
    availableStepIndices,
    payload,
    ...(previousPayload === undefined ? {} : { previousPayload }),
  };
}

function coercePromptBuildEvidencePayload(data: unknown): PromptBuildEvidencePayload | undefined {
  const record = readObjectRecord(data);
  const usedTokens = readNumberValue(record?.usedTokens);
  const remainingTokens = readNumberValue(record?.remainingTokens);
  const staticSections = coercePromptInspectSectionSummaryArray(record?.staticSections);
  const dynamicSections = coercePromptInspectSectionSummaryArray(record?.dynamicSections);
  const omittedSections = coercePromptInspectSectionSummaryArray(record?.omittedSections);
  const runtimeDegradations =
    coercePromptInspectRuntimeDegradationArray(record?.runtimeDegradations) ?? [];

  if (
    usedTokens === undefined ||
    remainingTokens === undefined ||
    staticSections === undefined ||
    dynamicSections === undefined ||
    omittedSections === undefined
  ) {
    return undefined;
  }

  return {
    usedTokens,
    remainingTokens,
    staticSections,
    dynamicSections,
    omittedSections,
    runtimeDegradations,
  };
}

function findLastMatchingPromptBuildIndex(
  entries: ReadonlyArray<{ readonly stepIndex: number }>,
  stepIndex: number,
): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.stepIndex === stepIndex) {
      return index;
    }
  }
  return -1;
}

function diffSectionIds(
  source: readonly PromptInspectSectionSummary[] | undefined,
  baseline: readonly PromptInspectSectionSummary[] | undefined,
): readonly string[] {
  if (!source || source.length === 0) {
    return [];
  }

  const baselineIds = new Set((baseline ?? []).map((section) => section.id));
  return source.filter((section) => !baselineIds.has(section.id)).map((section) => section.id);
}

function extractPromptSessionGuidance(
  sections: readonly PromptInspectSectionSummary[],
): PromptSessionGuidanceSummary | undefined {
  let outputStyle: string | undefined;
  let permissionMode: string | undefined;
  let responseLanguage: string | undefined;

  for (const section of sections) {
    const metadataPreview = section.metadataPreview;
    if (!metadataPreview) {
      continue;
    }

    if (outputStyle === undefined && typeof metadataPreview.outputStyle === "string") {
      outputStyle = metadataPreview.outputStyle;
    }
    if (permissionMode === undefined && typeof metadataPreview.permissionMode === "string") {
      permissionMode = metadataPreview.permissionMode;
    }
    if (responseLanguage === undefined && typeof metadataPreview.responseLanguage === "string") {
      responseLanguage = metadataPreview.responseLanguage;
    }
  }

  if (outputStyle === undefined && permissionMode === undefined && responseLanguage === undefined) {
    return undefined;
  }

  return {
    ...(outputStyle === undefined ? {} : { outputStyle }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
  };
}

function buildPromptEffectiveGuidance(
  runtimeDefaultGuidance: PromptSessionGuidanceSummary | undefined,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSummary | undefined {
  const effectiveGuidance = {
    ...(runtimeDefaultGuidance === undefined ? {} : runtimeDefaultGuidance),
    ...(sessionGuidance === undefined ? {} : sessionGuidance),
  };

  return hasPromptGuidanceValues(effectiveGuidance) ? effectiveGuidance : undefined;
}

function buildPromptEffectiveGuidanceSourceSummary(
  runtimeDefaultGuidance: PromptSessionGuidanceSummary | undefined,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSourceSummary | undefined {
  const outputStyle = hasPromptGuidanceField(sessionGuidance, "outputStyle")
    ? "session-override"
    : hasPromptGuidanceField(runtimeDefaultGuidance, "outputStyle")
      ? "runtime-default"
      : undefined;
  const permissionMode = hasPromptGuidanceField(sessionGuidance, "permissionMode")
    ? "session-override"
    : hasPromptGuidanceField(runtimeDefaultGuidance, "permissionMode")
      ? "runtime-default"
      : undefined;
  const responseLanguage = hasPromptGuidanceField(sessionGuidance, "responseLanguage")
    ? "session-override"
    : hasPromptGuidanceField(runtimeDefaultGuidance, "responseLanguage")
      ? "runtime-default"
      : undefined;

  if (outputStyle === undefined && permissionMode === undefined && responseLanguage === undefined) {
    return undefined;
  }

  return {
    ...(outputStyle === undefined ? {} : { outputStyle }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
  };
}

function hasPromptGuidanceValues(guidance: PromptSessionGuidanceSummary | undefined): boolean {
  return (
    hasPromptGuidanceField(guidance, "outputStyle") ||
    hasPromptGuidanceField(guidance, "permissionMode") ||
    hasPromptGuidanceField(guidance, "responseLanguage")
  );
}

function hasPromptGuidanceField(
  guidance: PromptSessionGuidanceSummary | undefined,
  field: keyof PromptSessionGuidanceSummary,
): boolean {
  return (
    guidance !== undefined &&
    Object.prototype.hasOwnProperty.call(guidance, field) &&
    typeof guidance[field] === "string"
  );
}

function extractPromptToolRuntimeGuidance(
  sections: readonly PromptInspectSectionSummary[],
): PromptToolRuntimeGuidanceSummary | undefined {
  let status: string | undefined;
  let impactedTools: number | undefined;
  let previewedTools: number | undefined;
  let previewTruncated: boolean | undefined;
  let toolPreview: string | undefined;
  let metaImpactedTools: number | undefined;
  let metaPreviewedTools: number | undefined;
  let metaPreviewTruncated: boolean | undefined;
  let toolMetaPreview: string | undefined;

  for (const section of sections) {
    if (section.id !== "runtime.tool-status") {
      continue;
    }

    const metadataPreview = section.metadataPreview;
    if (!metadataPreview) {
      continue;
    }

    if (status === undefined && typeof metadataPreview.status === "string") {
      status = metadataPreview.status;
    }
    if (impactedTools === undefined && typeof metadataPreview.impactedTools === "number") {
      impactedTools = metadataPreview.impactedTools;
    }
    if (previewedTools === undefined && typeof metadataPreview.previewedTools === "number") {
      previewedTools = metadataPreview.previewedTools;
    }
    if (previewTruncated === undefined && typeof metadataPreview.previewTruncated === "boolean") {
      previewTruncated = metadataPreview.previewTruncated;
    }
    if (toolPreview === undefined && typeof metadataPreview.toolPreview === "string") {
      toolPreview = metadataPreview.toolPreview;
    }
    if (metaImpactedTools === undefined && typeof metadataPreview.metaImpactedTools === "number") {
      metaImpactedTools = metadataPreview.metaImpactedTools;
    }
    if (
      metaPreviewedTools === undefined &&
      typeof metadataPreview.metaPreviewedTools === "number"
    ) {
      metaPreviewedTools = metadataPreview.metaPreviewedTools;
    }
    if (
      metaPreviewTruncated === undefined &&
      typeof metadataPreview.metaPreviewTruncated === "boolean"
    ) {
      metaPreviewTruncated = metadataPreview.metaPreviewTruncated;
    }
    if (toolMetaPreview === undefined && typeof metadataPreview.toolMetaPreview === "string") {
      toolMetaPreview = metadataPreview.toolMetaPreview;
    }
  }

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

function extractPromptTurnResumeGuidance(
  sections: readonly PromptInspectSectionSummary[],
): PromptTurnResumeGuidanceSummary | undefined {
  let resumeAction: string | undefined;
  let nextStepIndex: number | undefined;
  let recoveredToolResults: number | undefined;

  for (const section of sections) {
    if (section.id !== "runtime.turn-resume") {
      continue;
    }

    const metadataPreview = section.metadataPreview;
    if (!metadataPreview) {
      continue;
    }

    if (resumeAction === undefined && typeof metadataPreview.resumeAction === "string") {
      resumeAction = metadataPreview.resumeAction;
    }
    if (nextStepIndex === undefined && typeof metadataPreview.nextStepIndex === "number") {
      nextStepIndex = metadataPreview.nextStepIndex;
    }
    if (
      recoveredToolResults === undefined &&
      typeof metadataPreview.recoveredToolResults === "number"
    ) {
      recoveredToolResults = metadataPreview.recoveredToolResults;
    }
  }

  if (
    resumeAction === undefined &&
    nextStepIndex === undefined &&
    recoveredToolResults === undefined
  ) {
    return undefined;
  }

  return {
    ...(resumeAction === undefined ? {} : { resumeAction }),
    ...(nextStepIndex === undefined ? {} : { nextStepIndex }),
    ...(recoveredToolResults === undefined ? {} : { recoveredToolResults }),
  };
}

function extractPromptLatestTurnGuidance(
  sections: readonly PromptInspectSectionSummary[],
): PromptLatestTurnGuidanceSummary | undefined {
  let turnId: string | undefined;
  let runtimeStatus: string | undefined;
  let turnBranch: string | undefined;
  let reasoningStrategy: string | undefined;
  let reasoningConfidence: number | undefined;
  let reasoningRationale: string | undefined;
  let reasoningSuggestedAction: string | undefined;

  for (const section of sections) {
    if (section.id !== "session.latest-turn") {
      continue;
    }

    const metadataPreview = section.metadataPreview;
    if (!metadataPreview) {
      continue;
    }

    if (turnId === undefined && typeof metadataPreview.turnId === "string") {
      turnId = metadataPreview.turnId;
    }
    if (runtimeStatus === undefined && typeof metadataPreview.runtimeStatus === "string") {
      runtimeStatus = metadataPreview.runtimeStatus;
    }
    if (turnBranch === undefined && typeof metadataPreview.turnBranch === "string") {
      turnBranch = metadataPreview.turnBranch;
    }
    if (reasoningStrategy === undefined && typeof metadataPreview.reasoningStrategy === "string") {
      reasoningStrategy = metadataPreview.reasoningStrategy;
    }
    if (
      reasoningConfidence === undefined &&
      typeof metadataPreview.reasoningConfidence === "number"
    ) {
      reasoningConfidence = metadataPreview.reasoningConfidence;
    }
    if (
      reasoningRationale === undefined &&
      typeof metadataPreview.reasoningRationale === "string"
    ) {
      reasoningRationale = metadataPreview.reasoningRationale;
    }
    if (
      reasoningSuggestedAction === undefined &&
      typeof metadataPreview.reasoningSuggestedAction === "string"
    ) {
      reasoningSuggestedAction = metadataPreview.reasoningSuggestedAction;
    }
  }

  const reasoning =
    reasoningStrategy === undefined &&
    reasoningConfidence === undefined &&
    reasoningRationale === undefined &&
    reasoningSuggestedAction === undefined
      ? undefined
      : {
          ...(reasoningStrategy === undefined ? {} : { strategy: reasoningStrategy }),
          ...(reasoningConfidence === undefined ? {} : { confidence: reasoningConfidence }),
          ...(reasoningRationale === undefined ? {} : { rationale: reasoningRationale }),
          ...(reasoningSuggestedAction === undefined
            ? {}
            : { suggestedAction: reasoningSuggestedAction }),
        };

  if (
    turnId === undefined &&
    runtimeStatus === undefined &&
    turnBranch === undefined &&
    reasoning === undefined
  ) {
    return undefined;
  }

  return {
    ...(turnId === undefined ? {} : { turnId }),
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
    ...(turnBranch === undefined ? {} : { turnBranch }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function summarizePromptSectionIds(sectionIds: readonly string[]): readonly string[] {
  if (sectionIds.length === 0) {
    return [];
  }
  return sectionIds.map((sectionId) => summarizePromptSectionId(sectionId));
}

function extractStaticGuidanceSectionIds(
  sections: readonly PromptInspectSectionSummary[],
): readonly string[] {
  return sections
    .map((section) => section.id)
    .filter((sectionId) => isStaticGuidanceSectionId(sectionId))
    .sort((left, right) => compareStaticGuidanceSectionIds(left, right));
}

function extractRuntimeShellSectionIds(
  sections: readonly PromptInspectSectionSummary[],
): readonly string[] {
  return sections
    .map((section) => section.id)
    .filter((sectionId) => sectionId === "system.runtime");
}

function isStaticGuidanceSectionId(sectionId: string): boolean {
  return (
    sectionId === "system.output-style" ||
    sectionId === "system.permission-mode" ||
    sectionId === "system.response-language"
  );
}

function compareStaticGuidanceSectionIds(left: string, right: string): number {
  return getStaticGuidanceSectionPriority(left) - getStaticGuidanceSectionPriority(right);
}

function getStaticGuidanceSectionPriority(sectionId: string): number {
  switch (sectionId) {
    case "system.output-style":
      return 0;
    case "system.permission-mode":
      return 1;
    case "system.response-language":
      return 2;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

function summarizePromptSectionId(sectionId: string): string {
  switch (sectionId) {
    case "user-input":
      return "user input";
    case "task-state":
      return "task state";
    case "tool-results":
      return "tool results";
    case "session.guidance":
      return "session guidance";
    case "session.output-style":
      return "output style guidance";
    case "session.permission-mode":
      return "permission mode guidance";
    case "session.response-language":
      return "response language guidance";
    case "system.runtime":
      return "runtime shell";
    case "system.output-style":
      return "default output style guidance";
    case "system.permission-mode":
      return "default permission mode guidance";
    case "system.response-language":
      return "default response language guidance";
    case "session.latest-turn":
      return "latest turn guidance";
    case "runtime.turn-resume":
      return "turn resume guidance";
    case "runtime.degradations":
      return "runtime degradations";
    case "runtime.tool-status":
      return "tool runtime guidance";
    case "working-memory.degraded":
      return "working memory degraded";
    default:
      break;
  }

  const toolResultMatch = /^tool-result-(\d+)$/.exec(sectionId);
  if (toolResultMatch) {
    return `tool result ${toolResultMatch[1]}`;
  }

  const recallMatch = /^(.*)\.recall-(\d+)$/.exec(sectionId);
  if (recallMatch) {
    const recallPrefix = recallMatch[1];
    const recallIndex = recallMatch[2];
    if (recallPrefix !== undefined && recallIndex !== undefined) {
      return `${normalizePromptSectionLabelToken(recallPrefix)} recall ${recallIndex}`;
    }
  }

  return normalizePromptSectionLabelToken(sectionId);
}

function normalizePromptSectionLabelToken(value: string): string {
  return value.replaceAll(/[._-]+/g, " ").trim();
}

function summarizePromptRuntimeDegradations(
  degradations: readonly PromptInspectRuntimeDegradation[],
): readonly string[] {
  return summarizeRuntimeDegradationSurfaces(
    degradations.map((degradation) => toRuntimeDegradationSurface(degradation)),
  );
}

function toRuntimeDegradationSurface(
  degradation: PromptInspectRuntimeDegradation,
): RuntimeDegradationSummaryInput {
  return {
    reason: degradation.reason,
    severity: degradation.severity,
    message: degradation.message,
    ...(degradation.metadataPreview === undefined ? {} : { metadata: degradation.metadataPreview }),
  };
}

function readObjectRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function readStringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNumberArray(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const numbers = value.filter((entry): entry is number => readNumberValue(entry) !== undefined);
  if (numbers.length !== value.length) {
    return undefined;
  }
  return numbers;
}

function coercePromptInspectSectionSummaryArray(
  value: unknown,
): readonly PromptInspectSectionSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sections: PromptInspectSectionSummary[] = [];
  for (const entry of value) {
    const record = readObjectRecord(entry);
    const id = readStringValue(record?.id);
    const cacheBucket = readStringValue(record?.cacheBucket);
    const owner = readStringValue(record?.owner);
    const priority = readNumberValue(record?.priority);
    const metadataKeys = readStringArray(record?.metadataKeys);
    const metadataPreview = coercePromptInspectSectionMetadataPreview(record?.metadataPreview);

    if (id === undefined || cacheBucket === undefined) {
      return undefined;
    }

    sections.push({
      id,
      cacheBucket,
      ...(owner === undefined ? {} : { owner }),
      ...(priority === undefined ? {} : { priority }),
      ...(metadataKeys.length === 0 ? {} : { metadataKeys }),
      ...(metadataPreview === undefined ? {} : { metadataPreview }),
    });
  }

  return sections;
}

function coercePromptSessionGuidanceSummary(
  value: unknown,
): PromptSessionGuidanceSummary | undefined {
  const record = readObjectRecord(value);
  const outputStyle = readStringValue(record?.outputStyle);
  const permissionMode = readStringValue(record?.permissionMode);
  const responseLanguage = readStringValue(record?.responseLanguage);

  if (outputStyle === undefined && permissionMode === undefined && responseLanguage === undefined) {
    return undefined;
  }

  return {
    ...(outputStyle === undefined ? {} : { outputStyle }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
  };
}

function coercePromptSessionGuidanceSourceSummary(
  value: unknown,
): PromptSessionGuidanceSourceSummary | undefined {
  const record = readObjectRecord(value);
  const outputStyle = readPromptSessionGuidanceSource(record?.outputStyle);
  const permissionMode = readPromptSessionGuidanceSource(record?.permissionMode);
  const responseLanguage = readPromptSessionGuidanceSource(record?.responseLanguage);

  if (outputStyle === undefined && permissionMode === undefined && responseLanguage === undefined) {
    return undefined;
  }

  return {
    ...(outputStyle === undefined ? {} : { outputStyle }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(responseLanguage === undefined ? {} : { responseLanguage }),
  };
}

function readPromptSessionGuidanceSource(value: unknown): PromptSessionGuidanceSource | undefined {
  return value === "runtime-default" || value === "session-override" ? value : undefined;
}

function coercePromptToolRuntimeGuidanceSummary(
  value: unknown,
): PromptToolRuntimeGuidanceSummary | undefined {
  const record = readObjectRecord(value);
  const status = readStringValue(record?.status);
  const impactedTools = readNumberValue(record?.impactedTools);
  const previewedTools = readNumberValue(record?.previewedTools);
  const previewTruncated =
    typeof record?.previewTruncated === "boolean" ? record.previewTruncated : undefined;
  const toolPreview = readStringValue(record?.toolPreview);
  const metaImpactedTools = readNumberValue(record?.metaImpactedTools);
  const metaPreviewedTools = readNumberValue(record?.metaPreviewedTools);
  const metaPreviewTruncated =
    typeof record?.metaPreviewTruncated === "boolean" ? record.metaPreviewTruncated : undefined;
  const toolMetaPreview = readStringValue(record?.toolMetaPreview);

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

function coercePromptTurnResumeGuidanceSummary(
  value: unknown,
): PromptTurnResumeGuidanceSummary | undefined {
  const record = readObjectRecord(value);
  const resumeAction = readStringValue(record?.resumeAction);
  const nextStepIndex = readNumberValue(record?.nextStepIndex);
  const recoveredToolResults = readNumberValue(record?.recoveredToolResults);

  if (
    resumeAction === undefined &&
    nextStepIndex === undefined &&
    recoveredToolResults === undefined
  ) {
    return undefined;
  }

  return {
    ...(resumeAction === undefined ? {} : { resumeAction }),
    ...(nextStepIndex === undefined ? {} : { nextStepIndex }),
    ...(recoveredToolResults === undefined ? {} : { recoveredToolResults }),
  };
}

function coercePromptLatestTurnGuidanceSummary(
  value: unknown,
): PromptLatestTurnGuidanceSummary | undefined {
  const record = readObjectRecord(value);
  const turnId = readStringValue(record?.turnId);
  const runtimeStatus = readStringValue(record?.runtimeStatus);
  const turnBranch = readStringValue(record?.turnBranch);
  const reasoning = coercePromptLatestTurnReasoningSummary(record?.reasoning);

  if (
    turnId === undefined &&
    runtimeStatus === undefined &&
    turnBranch === undefined &&
    reasoning === undefined
  ) {
    return undefined;
  }

  return {
    ...(turnId === undefined ? {} : { turnId }),
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
    ...(turnBranch === undefined ? {} : { turnBranch }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
}

function coercePromptLatestTurnReasoningSummary(
  value: unknown,
): PromptLatestTurnReasoningSummary | undefined {
  const record = readObjectRecord(value);
  const strategy = readStringValue(record?.strategy);
  const confidence = readNumberValue(record?.confidence);
  const rationale = readStringValue(record?.rationale);
  const suggestedAction = readStringValue(record?.suggestedAction);

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

function coercePromptInspectSectionMetadataPreview(
  value: unknown,
): Readonly<Record<string, string | number | boolean>> | undefined {
  const record = readObjectRecord(value);
  if (record === undefined) {
    return undefined;
  }

  const previewEntries: Array<readonly [string, string | number | boolean]> = [];
  for (const [key, entryValue] of Object.entries(record)) {
    if (typeof entryValue === "string" || typeof entryValue === "boolean") {
      previewEntries.push([key, entryValue]);
      continue;
    }
    if (typeof entryValue === "number" && Number.isFinite(entryValue)) {
      previewEntries.push([key, entryValue]);
    }
  }

  if (previewEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(previewEntries);
}

function coercePromptInspectRuntimeDegradationArray(
  value: unknown,
): readonly PromptInspectRuntimeDegradation[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const degradations: PromptInspectRuntimeDegradation[] = [];
  for (const entry of value) {
    const record = readObjectRecord(entry);
    const stage = readStringValue(record?.stage);
    const category = readStringValue(record?.category);
    const severity = readStringValue(record?.severity);
    const reason = readStringValue(record?.reason);
    const message = readStringValue(record?.message);
    const metadataPreview =
      coercePromptInspectSectionMetadataPreview(record?.metadata) ??
      coercePromptInspectSectionMetadataPreview(record?.metadataPreview);

    if (
      stage === undefined ||
      category === undefined ||
      severity === undefined ||
      reason === undefined ||
      message === undefined
    ) {
      return undefined;
    }

    degradations.push({
      stage,
      category,
      severity,
      reason,
      message,
      ...(metadataPreview === undefined ? {} : { metadataPreview }),
    });
  }

  return degradations;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function readOptionalStringArray(value: unknown): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((entry): entry is string => typeof entry === "string");
  return strings.length === value.length ? strings : undefined;
}

function coerceToolOutcomeSummary(data: unknown): ToolOutcomeSummary | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    total?: unknown;
    executed?: unknown;
    denied?: unknown;
    approvalRequired?: unknown;
    degraded?: unknown;
    failed?: unknown;
    missing?: unknown;
    unknown?: unknown;
  };
  if (
    typeof candidate.total !== "number" ||
    typeof candidate.executed !== "number" ||
    typeof candidate.denied !== "number" ||
    typeof candidate.approvalRequired !== "number" ||
    typeof candidate.degraded !== "number" ||
    typeof candidate.failed !== "number" ||
    typeof candidate.missing !== "number" ||
    typeof candidate.unknown !== "number"
  ) {
    return undefined;
  }
  return {
    total: candidate.total,
    executed: candidate.executed,
    denied: candidate.denied,
    approvalRequired: candidate.approvalRequired,
    degraded: candidate.degraded,
    failed: candidate.failed,
    missing: candidate.missing,
    unknown: candidate.unknown,
  };
}

function extractToolOutcomesFromReplayPayload(payload: unknown): ToolOutcomeKey[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["unknown"];
  }
  const record = payload as {
    results?: unknown;
    resolution?: unknown;
    ok?: unknown;
    degradation?: unknown;
  };
  if (Array.isArray(record.results) && record.results.length > 0) {
    return record.results.map((item) =>
      classifyToolOutcome(
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as {
              resolution?: unknown;
              ok?: unknown;
              degradation?: unknown;
            })
          : {},
      ),
    );
  }
  return [
    classifyToolOutcome({
      resolution: record.resolution,
      ok: record.ok,
      degradation: record.degradation,
    }),
  ];
}

function classifyToolOutcome(input: {
  readonly resolution?: unknown;
  readonly ok?: unknown;
  readonly degradation?: unknown;
}): ToolOutcomeKey {
  if (typeof input.resolution === "string") {
    if (input.resolution === "executed") {
      return "executed";
    }
    if (input.resolution === "denied") {
      return "denied";
    }
    if (input.resolution === "approval_required") {
      return "approvalRequired";
    }
    if (input.resolution === "degraded") {
      return "degraded";
    }
    if (input.resolution === "failed") {
      return "failed";
    }
    if (input.resolution === "missing") {
      return "missing";
    }
  }
  if (input.degradation !== undefined) {
    return "degraded";
  }
  if (input.ok === false) {
    return "failed";
  }
  if (input.ok === true || input.resolution === "executed") {
    return "executed";
  }
  return "unknown";
}

export function deriveRuntimeStatusFromEvidence(
  evidence: ReadonlyArray<{ readonly kind: string }>,
): ToolRuntimeStatus {
  if (evidence.some((entry) => entry.kind === "runtime.failed")) {
    return "failed";
  }
  if (
    evidence.some(
      (entry) =>
        entry.kind === "provider.transient_failure" ||
        entry.kind === "stream.error" ||
        entry.kind === "stream.aborted",
    )
  ) {
    return "failed";
  }
  if (
    evidence.some((entry) => entry.kind === "runtime.degraded" || entry.kind === "stream.degraded")
  ) {
    return "degraded";
  }
  return "healthy";
}

export function combineRuntimeStatus(
  primary: ToolRuntimeStatus,
  secondary: ToolRuntimeStatus,
): ToolRuntimeStatus {
  const priority = {
    healthy: 0,
    degraded: 1,
    blocked: 2,
    failed: 3,
  } satisfies Record<ToolRuntimeStatus, number>;
  return priority[secondary] > priority[primary] ? secondary : primary;
}

function createToolOutcomeCounters(): Record<ToolOutcomeKey, number> {
  return {
    executed: 0,
    denied: 0,
    approvalRequired: 0,
    degraded: 0,
    failed: 0,
    missing: 0,
    unknown: 0,
  };
}

function countToolOutcome(counters: Record<ToolOutcomeKey, number>, key: ToolOutcomeKey): void {
  counters[key] += 1;
}

function toToolOutcomeSummary(counters: Record<ToolOutcomeKey, number>): ToolOutcomeSummary {
  return {
    total: Object.values(counters).reduce((sum, count) => sum + count, 0),
    executed: counters.executed,
    denied: counters.denied,
    approvalRequired: counters.approvalRequired,
    degraded: counters.degraded,
    failed: counters.failed,
    missing: counters.missing,
    unknown: counters.unknown,
  };
}
