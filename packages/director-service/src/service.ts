import {
  type AlignmentLock as CoreAlignmentLock,
  type ClarificationDecision as CoreClarificationDecision,
  type CrewAssignment as CoreCrewAssignment,
  type RuntimeCapabilitySnapshot as CoreRuntimeCapabilitySnapshot,
  type DirectorContext,
  type DirectorKnowledgeSignal,
  type DirectorPlan,
  type ExecutionBlueprint,
  type ExecutionPlan,
  type ReviewReport,
  type ReviewStatus,
  buildDirectorControlResult,
  buildExecutionPlan,
} from "@hotflow/director-core";
import type {
  DirectorEvaluateRequest,
  DirectorEvaluateResponse,
  DirectorIntakePayload,
  DirectorKnowledgePackCatalogEntry,
  DirectorKnowledgePackCatalogRequest,
  DirectorKnowledgePackCatalogResponse,
  DirectorOutcomeRequest,
  DirectorRuntimeResponse,
} from "@hotflow/director-host-contracts";
import { DIRECTOR_HOST_API_VERSION } from "@hotflow/director-host-contracts";
import {
  type DirectorKnowledgePackDocument,
  type DirectorKnowledgeRecallPacket,
  recallPublishedKnowledge as buildPublishedKnowledgeRecallPacket,
} from "@hotflow/director-knowledge";
import {
  DIRECTOR_OBSERVATION_SCHEMA_ID,
  type DirectorMemoryRecallRequest,
  type DirectorMemoryRecallResult,
  type DirectorObservationEnvelope,
  type DirectorRecallHints,
  type DirectorWorkingContext,
  type LearningObservationSink,
  type MemoryRecallPort,
} from "@hotflow/director-runtime";

import { materializeSnapshot } from "./materializer.js";

export interface DirectorRuntimeSummaryInput {
  runtimeId: string;
  workspaceRoot: string;
  dataDir: string;
  defaultProvider: string;
  defaultModel: string;
  availableProviders: readonly string[];
  status?: DirectorContext["runtime"]["status"];
  notes?: readonly string[];
}

export interface KnowledgeStorePort {
  listPublished(): Promise<
    ReadonlyArray<{
      readonly metadata: {
        readonly id: string;
        readonly title: string;
        readonly version: number;
        readonly createdAt: string;
        readonly description?: string;
        readonly tags?: readonly string[];
      };
      readonly state: string;
    }>
  >;
  listPublishedDocuments?(): Promise<readonly DirectorKnowledgePackDocument[]>;
}

type MaybePromise<T> = T | Promise<T>;

export type DirectorRuntimeAdapterKind = "host" | "media" | "execution" | "internal";
export type DirectorRuntimeMediaMode = "image" | "video";
export type DirectorRuntimeAdapterBridgeKind = "http-json";

export interface DirectorRuntimeAdapterDescriptor {
  adapterId: string;
  adapterKind: DirectorRuntimeAdapterKind;
  bindingId?: string;
  enabled?: boolean;
  healthy?: boolean;
  dryRunOnly?: boolean;
  mockOnly?: boolean;
  bridgeKind?: DirectorRuntimeAdapterBridgeKind;
  approvalMode?: ApprovalMode;
  supportedRoles?: readonly CrewRole[];
  supportedActionClasses?: readonly ActionClass[];
  mediaModes?: readonly DirectorRuntimeMediaMode[];
  reason?: string;
}

export interface DirectorRuntimeSwitchSnapshot {
  autoRouteEnabled?: boolean;
  disabledRoles?: readonly CrewRole[];
  disabledAdapters?: readonly string[];
}

export interface DirectorRuntimeSwitchContext {
  normalizedInput: DirectorNormalizedInput;
  coreSnapshot: CoreRuntimeCapabilitySnapshot;
  adapters: readonly DirectorRuntimeAdapterDescriptor[];
}

export interface DirectorRuntimeSwitchesPort {
  snapshot(input: DirectorRuntimeSwitchContext): MaybePromise<DirectorRuntimeSwitchSnapshot>;
}

export interface DirectorRuntimeRegistryPort {
  listAdapters(
    input: Omit<DirectorRuntimeSwitchContext, "adapters">,
  ): MaybePromise<readonly DirectorRuntimeAdapterDescriptor[]>;
}

export interface DirectorRuntimeMatchInput extends DirectorRuntimeSwitchContext {
  switches: Required<DirectorRuntimeSwitchSnapshot>;
}

export interface DirectorRuntimeMatchResult {
  eligibleImageAdapters?: readonly string[];
  eligibleVideoAdapters?: readonly string[];
  eligibleImageBindings?: readonly string[];
  eligibleVideoBindings?: readonly string[];
  selectedImageAdapterId?: string | null;
  selectedVideoAdapterId?: string | null;
  selectedImageBinding?: string | null;
  selectedVideoBinding?: string | null;
  blockedReasons?: readonly string[];
  warnings?: readonly string[];
}

export interface DirectorRuntimeMatcherPort {
  match(input: DirectorRuntimeMatchInput): MaybePromise<DirectorRuntimeMatchResult>;
}

export interface DirectorSkillPromptSection {
  readonly id: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface DirectorSkillPromptIndexPort {
  buildSections(input: {
    readonly userText: string;
    readonly limit?: number;
  }): readonly DirectorSkillPromptSection[];
}

export type DirectorLongTermMemoryStatus = "miss" | "hit" | "degraded";

export interface DirectorLongTermMemoryPacket {
  readonly status: DirectorLongTermMemoryStatus;
  readonly signals: readonly DirectorKnowledgeSignal[];
  readonly notes: readonly string[];
}

export interface DirectorLongTermMemoryPort {
  load(input: {
    readonly normalizedInput: DirectorNormalizedInput;
  }): MaybePromise<DirectorLongTermMemoryPacket>;
}

export interface DirectorServiceOptions {
  knowledgeStore?: KnowledgeStorePort;
  knowledgeRecall?: {
    enabled?: boolean;
    maxHits?: number;
    maxChars?: number;
  };
  longTermMemory?: DirectorLongTermMemoryPort;
  skillPromptIndex?: DirectorSkillPromptIndexPort;
  skillContext?: {
    enabled?: boolean;
    limit?: number;
    maxChars?: number;
  };
  switches?: DirectorRuntimeSwitchesPort;
  runtimeRegistry?: DirectorRuntimeRegistryPort;
  runtimeMatcher?: DirectorRuntimeMatcherPort;
  memoryRecall?: MemoryRecallPort;
  learningSink?: LearningObservationSink;
  now?: () => string;
}

export type AlignmentDecision = "aligned" | "clarification_required" | "blocked";
export type AlignmentLockStatus = "locked" | "awaiting_clarification" | "blocked";
export type ActionGraphReadiness = "ready" | "review_required" | "blocked";
export type CrewRole =
  | "researcher"
  | "script-planner"
  | "shot-planner"
  | "asset-router"
  | "qc-reviewer";
export type CrewAssignmentStatus = "ready" | "awaiting_approval" | "blocked";
export type ActionNodeStatus = "ready" | "awaiting_approval" | "blocked";
export type ActionClass = "read" | "generate" | "route" | "review" | "write" | "publish";
export type ApprovalMode = "auto-allow" | "operator-approve" | "forbidden-in-beta1";

export interface DirectorNormalizedInput {
  snapshotId: string;
  operatorId: string | null;
  goal: string;
  projectLabel: string;
  context: DirectorContext;
}

export interface RuntimeCapabilityIssue {
  code: string;
  severity: "warn" | "block";
  message: string;
}

export interface ExecutionAdapterSelection {
  role: CrewRole;
  actionClass: ActionClass;
  eligibleAdapters: readonly string[];
  selectedAdapter: string | null;
  requiresOperatorApproval: boolean;
}

export interface RuntimeCapabilitySnapshot {
  runtimeId: string;
  status: DirectorContext["runtime"]["status"];
  availableBindings: readonly string[];
  availableAdapters: readonly string[];
  eligibleImageBindings: readonly string[];
  eligibleVideoBindings: readonly string[];
  eligibleImageAdapters: readonly string[];
  eligibleVideoAdapters: readonly string[];
  eligibleExecutionAdapters: readonly string[];
  executionAdapterSelections: readonly ExecutionAdapterSelection[];
  selectedImageAdapter: string | null;
  selectedVideoAdapter: string | null;
  selectedExecutionAdapter: string | null;
  supportsVideo: boolean;
  maxPromptChars: number;
  deterministicMode: DirectorContext["runtime"]["deterministicMode"] | null;
  autoRouteEnabled: boolean;
  disabledRoles: readonly CrewRole[];
  disabledAdapters: readonly string[];
  blockedReasons: readonly string[];
  warnings: readonly string[];
  issues: readonly RuntimeCapabilityIssue[];
}

export interface ClarificationQuestion {
  code: string;
  prompt: string;
}

export interface AlignmentAssessment {
  decision: AlignmentDecision;
  summary: string;
  reasons: readonly string[];
  clarificationQuestions: readonly ClarificationQuestion[];
}

export interface LockedConstraint {
  field: string;
  level: "soft_lock" | "hard_lock";
  source: "snapshot" | "director";
  value: string;
  reason?: string;
}

export interface AlignmentLock {
  status: AlignmentLockStatus;
  goal: string;
  lockedConstraints: readonly LockedConstraint[];
  openQuestions: readonly ClarificationQuestion[];
  blockingReasons: readonly string[];
}

export interface DirectorReview {
  decision: ReviewStatus;
  summary: string;
  recommendations: readonly string[];
  blockingReasons: readonly string[];
  plan: DirectorPlan;
  executionPlan: ExecutionPlan;
  reviewReport: ReviewReport;
}

export interface CrewAssignment {
  assignmentId: string;
  role: CrewRole;
  objective: string;
  assignedCapability: string;
  inputs: readonly string[];
  outputs: readonly string[];
  deliverable: string;
  acceptanceCriteria: readonly string[];
  constraints: readonly string[];
  dependsOn: readonly string[];
  allowedAdapters: readonly string[];
  actionClass: ActionClass;
  approvalMode: ApprovalMode;
  budgetLimit: number;
  timeoutMs: number;
  maxDelegationDepth: number;
  fallbackPolicy: string;
  escalationToDirector: string;
  status: CrewAssignmentStatus;
  selectedAdapter?: string | null;
  blockingReason?: string;
}

export interface ActionGraphNode {
  nodeId: string;
  assignmentId: string;
  role: CrewRole;
  objective: string;
  deliverable: string;
  actionClass: ActionClass;
  approvalMode: ApprovalMode;
  status: ActionNodeStatus;
  dependsOn: readonly string[];
  eligibleAdapters: readonly string[];
  selectedAdapter: string | null;
  acceptanceCriteria: readonly string[];
  blockingReason?: string;
}

export interface ActionGraphEdge {
  edgeId: string;
  fromAssignmentId: string;
  toAssignmentId: string;
  artifact: string;
  handoffContract: string;
  blocking: boolean;
}

export interface ActionGraph {
  graphId: string;
  goal: string;
  readiness: ActionGraphReadiness;
  nodes: readonly ActionGraphNode[];
  edges: readonly ActionGraphEdge[];
  blockedReasons: readonly string[];
}

export interface OperatorPreview {
  summary: string;
  visiblePrompt: string;
  selectedGenerationType: ExecutionPlan["selectedGenerationType"];
  selectedGenerationStyle: ExecutionPlan["selectedGenerationStyle"];
  selectedImageBinding: string | null;
  selectedVideoBinding: string | null;
  actionCount: number;
  blockedReasons: readonly string[];
}

export interface ExecutionHandoffEntry {
  assignmentId: string;
  role: CrewRole;
  deliverable: string;
  actionClass: ActionClass;
  approvalMode: ApprovalMode;
  selectedAdapter: string | null;
  status: ActionNodeStatus;
  blockingReason?: string;
}

export interface ExecutionHandoffEnvelope {
  handoffId: string;
  snapshotId: string;
  runtimeId: string;
  status: ActionGraphReadiness;
  goal: string;
  lockedConstraints: readonly string[];
  operatorPreview: OperatorPreview;
  entries: readonly ExecutionHandoffEntry[];
  auditTrail: readonly string[];
}

export interface DirectorControlResult {
  normalizedInput: DirectorNormalizedInput;
  runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot;
  alignmentAssessment: AlignmentAssessment;
  alignmentLock: AlignmentLock;
  review: DirectorReview;
  crewAssignments: readonly CrewAssignment[];
  actionGraph: ActionGraph;
  executionHandoffEnvelope: ExecutionHandoffEnvelope;
  skillContext: DirectorSkillContext;
}

export interface DirectorEvaluationResult extends DirectorControlResult {
  context: DirectorContext;
  plan: DirectorPlan;
  executionPlan: ExecutionPlan;
  reviewReport: ReviewReport;
  recall: DirectorMemoryRecallResult;
  publishedKnowledgeRecall: DirectorKnowledgeRecallPacket;
  observation: DirectorObservationEnvelope;
  response: DirectorEvaluateResponse;
}

export interface DirectorRecordedOutcome {
  stored: boolean;
  observation: DirectorObservationEnvelope;
}

interface MaterializedRecallContext {
  readonly status: DirectorMemoryRecallResult["status"];
  readonly summary?: string;
  readonly recommendations: readonly string[];
  readonly sharedInputs: readonly string[];
  readonly sharedConstraints: readonly string[];
  readonly preferredAdapterIds: readonly string[];
  readonly auditTrail: readonly string[];
}

export interface DirectorSkillContext {
  readonly status: "disabled" | "miss" | "hit" | "degraded";
  readonly sections: readonly DirectorSkillPromptSection[];
  readonly skillIds: readonly string[];
  readonly recommendations: readonly string[];
  readonly sharedInputs: readonly string[];
  readonly sharedConstraints: readonly string[];
  readonly auditTrail: readonly string[];
  readonly notes: readonly string[];
  readonly summary?: string;
}

const EXECUTION_HANDOFF_CANDIDATES: readonly Pick<
  ExecutionAdapterSelection,
  "role" | "actionClass"
>[] = [
  {
    role: "script-planner",
    actionClass: "generate",
  },
  {
    role: "shot-planner",
    actionClass: "generate",
  },
];

export class DirectorService {
  public constructor(private readonly options: DirectorServiceOptions = {}) {}

  public async evaluateSnapshot(
    request: DirectorEvaluateRequest,
  ): Promise<DirectorEvaluationResult> {
    const normalizedInput = this.normalizeInput(request);
    const longTermMemory = await this.loadLongTermMemory(normalizedInput);
    const memoryEnrichedInput = applyLongTermMemorySignals(normalizedInput, longTermMemory);
    const skillContext = this.matchSkillContext(memoryEnrichedInput);
    const recall = await this.recallMemory(normalizedInput);
    const publishedKnowledgeRecall = await this.recallPublishedKnowledge(memoryEnrichedInput);
    const enrichedInput = applySkillSignals(
      applyPublishedKnowledgeSignals(memoryEnrichedInput, publishedKnowledgeRecall),
      skillContext,
    );
    const recallContext = materializeRecall(recall, publishedKnowledgeRecall, longTermMemory);
    const coreControl = buildDirectorControlResult(enrichedInput.context);
    const runtimeCapabilitySnapshot = await this.captureRuntimeCapabilitySnapshot(
      enrichedInput,
      coreControl.capabilitySnapshot,
    );
    const alignmentAssessment = this.assessAlignment(enrichedInput, coreControl.clarification);
    const alignmentLock = this.lockAlignment(
      enrichedInput,
      coreControl.alignmentLock,
      alignmentAssessment,
    );
    const review = this.buildReview(
      enrichedInput,
      runtimeCapabilitySnapshot,
      alignmentLock,
      coreControl,
      recallContext,
      skillContext,
    );
    const crewAssignments = this.buildCrewAssignments(
      enrichedInput,
      runtimeCapabilitySnapshot,
      alignmentLock,
      review,
      coreControl.blueprint,
      recallContext,
      skillContext,
    );
    const actionGraph = this.buildActionGraph(
      enrichedInput,
      review,
      crewAssignments,
      runtimeCapabilitySnapshot,
    );
    const executionHandoffEnvelope = this.buildExecutionHandoffEnvelope(
      enrichedInput,
      alignmentLock,
      review,
      actionGraph,
      recallContext,
      skillContext,
    );
    const observation = this.buildEvaluationObservation(
      enrichedInput,
      runtimeCapabilitySnapshot,
      review,
      actionGraph,
      recall,
      publishedKnowledgeRecall,
    );
    const response = this.toEvaluateResponse(review, actionGraph, executionHandoffEnvelope);

    this.appendObservation(observation);

    return {
      normalizedInput,
      runtimeCapabilitySnapshot,
      alignmentAssessment,
      alignmentLock,
      review,
      crewAssignments,
      actionGraph,
      executionHandoffEnvelope,
      skillContext,
      context: enrichedInput.context,
      plan: review.plan,
      executionPlan: review.executionPlan,
      reviewReport: review.reviewReport,
      recall,
      publishedKnowledgeRecall,
      observation,
      response,
    };
  }

  public async recordOutcome(
    request: DirectorOutcomeRequest,
    input: { runtimeId: string },
  ): Promise<DirectorRecordedOutcome> {
    const observation = this.buildOutcomeObservation(request, input.runtimeId);
    this.appendObservation(observation);

    return {
      stored: true,
      observation,
    };
  }

  public async listKnowledgePacks(
    _request: DirectorKnowledgePackCatalogRequest = {
      apiVersion: DIRECTOR_HOST_API_VERSION,
    },
  ): Promise<DirectorKnowledgePackCatalogResponse> {
    const knowledgePacks = this.options.knowledgeStore
      ? (await this.options.knowledgeStore.listPublished()).map((record) =>
          this.toKnowledgePackEntry(record),
        )
      : [];

    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      knowledgePacks,
    };
  }

  public async getRuntimeSummary(
    input: DirectorRuntimeSummaryInput,
  ): Promise<DirectorRuntimeResponse> {
    const knowledgeCatalog = await this.listKnowledgePacks();
    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      runtimeId: input.runtimeId,
      status: input.status ?? (input.availableProviders.length > 0 ? "ready" : "degraded"),
      workspaceRoot: input.workspaceRoot,
      dataDir: input.dataDir,
      defaultProvider: input.defaultProvider,
      defaultModel: input.defaultModel,
      availableProviders: [...input.availableProviders],
      knowledgePackCount: knowledgeCatalog.knowledgePacks.length,
      notes: input.notes
        ? [...input.notes]
        : ["Director host API is ready for Beta-1 control-kernel preflight."],
    };
  }

  private nowIso(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private async recallMemory(
    normalizedInput: DirectorNormalizedInput,
  ): Promise<DirectorMemoryRecallResult> {
    const request: DirectorMemoryRecallRequest = {
      workingContext: this.buildWorkingContext(normalizedInput),
      recallHints: this.buildRecallHints(normalizedInput),
    };

    if (this.options.memoryRecall === undefined) {
      return {
        status: "disabled",
        knowledgePacks: [],
        hits: [],
        notes: ["Memory recall port is not configured for Director Angel Beta-1."],
      };
    }

    try {
      const result = await this.options.memoryRecall.recall(request);
      return {
        status: result.status,
        knowledgePacks: result.knowledgePacks.map((pack) => ({
          knowledgePackId: pack.knowledgePackId,
          ...(pack.title === undefined ? {} : { title: pack.title }),
          ...(pack.version === undefined ? {} : { version: pack.version }),
          ...(pack.tags === undefined ? {} : { tags: [...pack.tags] }),
          ...(pack.reason === undefined ? {} : { reason: pack.reason }),
        })),
        hits: (result.hits ?? []).map((hit) => ({
          recordId: hit.recordId,
          summary: hit.summary,
          status: hit.status,
          recordedAt: hit.recordedAt,
          score: hit.score,
          reasons: [...hit.reasons],
          selectedAdapters: [...hit.selectedAdapters],
          provenance: {
            runId: hit.provenance.runId,
            reportId: hit.provenance.reportId,
            observationIds: [...hit.provenance.observationIds],
          },
        })),
        notes: [...result.notes],
      };
    } catch (error) {
      return {
        status: "degraded",
        knowledgePacks: [],
        hits: [],
        notes: [
          `Memory recall degraded safely: ${error instanceof Error ? error.message : "unknown error"}.`,
        ],
      };
    }
  }

  private async loadLongTermMemory(
    normalizedInput: DirectorNormalizedInput,
  ): Promise<DirectorLongTermMemoryPacket> {
    if (this.options.longTermMemory === undefined) {
      return {
        status: "miss",
        signals: [],
        notes: ["Long-term memory port is not configured."],
      };
    }

    try {
      const packet = await this.options.longTermMemory.load({ normalizedInput });
      return {
        status: packet.status,
        signals: packet.signals.map((signal) => ({
          id: signal.id,
          description: signal.description,
          confidence: signal.confidence,
          tags: dedupeStrings(signal.tags),
        })),
        notes: [...packet.notes],
      };
    } catch (error) {
      return {
        status: "degraded",
        signals: [],
        notes: [
          `Long-term memory degraded safely: ${error instanceof Error ? error.message : "unknown error"}.`,
        ],
      };
    }
  }

  private buildWorkingContext(normalizedInput: DirectorNormalizedInput): DirectorWorkingContext {
    const { context } = normalizedInput;

    return {
      snapshotId: normalizedInput.snapshotId,
      runtimeId: context.runtime.runtimeId,
      operatorId: normalizedInput.operatorId,
      goal: normalizedInput.goal,
      projectLabel: normalizedInput.projectLabel,
      projectId: context.request.projectId,
      groupId: context.request.groupId,
      generationType: context.group.generationType,
      ...(context.group.generationStyle === undefined
        ? {}
        : { generationStyle: context.group.generationStyle }),
      sceneCount: context.group.sceneCount,
      ...(context.project.continuityPriority === undefined
        ? {}
        : { continuityPriority: context.project.continuityPriority }),
      anchorIds: [...context.group.anchorIds],
    };
  }

  private buildRecallHints(normalizedInput: DirectorNormalizedInput): DirectorRecallHints {
    const { context } = normalizedInput;

    return {
      preferredBindings: dedupeStrings(
        [context.intent.preferredImageBinding, context.intent.preferredVideoBinding].filter(
          (binding): binding is string => binding !== undefined,
        ),
      ),
      requiredBindings: dedupeStrings(
        [context.intent.requiredImageBinding, context.intent.requiredVideoBinding].filter(
          (binding): binding is string => binding !== undefined,
        ),
      ),
      fallbackBindings: dedupeStrings(context.intent.fallbackBindings ?? []),
      continuityAnchorIds: [...context.group.anchorIds],
      knowledgeSignalTags: dedupeStrings(
        (context.knowledgeSignals ?? []).flatMap((signal) => signal.tags),
      ),
      deliverables: [normalizedInput.goal],
    };
  }

  private buildEvaluationObservation(
    normalizedInput: DirectorNormalizedInput,
    runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
    review: DirectorReview,
    actionGraph: ActionGraph,
    recall: DirectorMemoryRecallResult,
    publishedKnowledgeRecall: DirectorKnowledgeRecallPacket,
  ): DirectorObservationEnvelope {
    const recordedAt = this.nowIso();

    return {
      schemaId: DIRECTOR_OBSERVATION_SCHEMA_ID,
      observationId: buildObservationId("evaluation", normalizedInput.snapshotId, recordedAt),
      recordedAt,
      source: "evaluation",
      snapshotId: normalizedInput.snapshotId,
      runtimeId: runtimeCapabilitySnapshot.runtimeId,
      workingContext: this.buildWorkingContext(normalizedInput),
      recallHints: this.buildRecallHints(normalizedInput),
      recalledKnowledgePacks: mergeKnowledgePackRefs(recall, publishedKnowledgeRecall),
      recallStatus: deriveObservationRecallStatus(recall, publishedKnowledgeRecall),
      recallNotes: mergeRecallNotes(recall, publishedKnowledgeRecall),
      evaluation: {
        decision: review.decision,
        actionGraphReadiness: actionGraph.readiness,
        selectedAdapters: dedupeStrings(
          [
            runtimeCapabilitySnapshot.selectedImageAdapter,
            runtimeCapabilitySnapshot.selectedVideoAdapter,
            ...runtimeCapabilitySnapshot.executionAdapterSelections.map(
              (selection) => selection.selectedAdapter,
            ),
          ].filter((adapterId): adapterId is string => adapterId !== null),
        ),
        blockedReasons: [...actionGraph.blockedReasons],
        warnings: [...runtimeCapabilitySnapshot.warnings],
      },
      notes: dedupeStrings([`review=${review.decision}`, `readiness=${actionGraph.readiness}`]),
    };
  }

  private buildOutcomeObservation(
    request: DirectorOutcomeRequest,
    runtimeId: string,
  ): DirectorObservationEnvelope {
    const recordedAt = request.outcome.recordedAt;

    return {
      schemaId: DIRECTOR_OBSERVATION_SCHEMA_ID,
      observationId: buildObservationId("outcome", request.snapshotId, request.outcome.outcomeId),
      recordedAt,
      source: "outcome",
      snapshotId: request.snapshotId,
      runtimeId,
      blueprintId: request.blueprintId,
      handoffId: request.handoffId,
      recalledKnowledgePacks: [],
      recallStatus: "disabled",
      recallNotes: ["Outcome capture does not perform memory recall in Director Angel Beta-1."],
      outcome: {
        outcomeId: request.outcome.outcomeId,
        status: request.outcome.status,
        recordedAt: request.outcome.recordedAt,
        ...(request.outcome.operatorId === undefined
          ? {}
          : { operatorId: request.outcome.operatorId }),
        ...(request.outcome.notes === undefined ? {} : { notes: request.outcome.notes }),
        ...(request.outcome.editedFieldPaths === undefined
          ? {}
          : { editedFieldPaths: [...request.outcome.editedFieldPaths] }),
        ...(request.outcome.acceptedArtifacts === undefined
          ? {}
          : { acceptedArtifacts: [...request.outcome.acceptedArtifacts] }),
        ...(request.outcome.rejectionReasons === undefined
          ? {}
          : { rejectionReasons: [...request.outcome.rejectionReasons] }),
      },
      notes: dedupeStrings([
        `blueprint=${request.blueprintId}`,
        `handoff=${request.handoffId}`,
        `outcome=${request.outcome.status}`,
      ]),
    };
  }

  private appendObservation(observation: DirectorObservationEnvelope): void {
    if (this.options.learningSink === undefined) {
      return;
    }

    try {
      const appendResult = this.options.learningSink.append(observation);
      void Promise.resolve(appendResult).catch(() => {
        // Observation recording must never block or crash the director control path.
      });
    } catch {
      // Observation recording must never block or crash the director control path.
    }
  }

  private normalizeInput(request: DirectorEvaluateRequest): DirectorNormalizedInput {
    const context = materializeSnapshot(request.snapshot);
    const intake = readDirectorIntakePayload(request);
    const projectLabel =
      intake?.objective ??
      intake?.desiredOutcome ??
      context.project.outline ??
      context.project.title ??
      context.request.projectId;
    const goal =
      intake?.objective ??
      [
        `${context.group.generationType} ${context.group.sceneCount} scene(s)`,
        `for ${projectLabel}`,
      ].join(" ");

    return {
      snapshotId: request.snapshot.snapshotId,
      operatorId: request.operatorId ?? null,
      goal,
      projectLabel,
      context:
        intake === null
          ? context
          : {
              ...context,
              project: {
                ...context.project,
                title: context.project.title ?? truncateText(intake.objective, 80),
                outline: intake.desiredOutcome ?? intake.objective,
              },
            },
    };
  }

  private matchSkillContext(normalizedInput: DirectorNormalizedInput): DirectorSkillContext {
    if (
      this.options.skillContext?.enabled === false ||
      this.options.skillPromptIndex === undefined
    ) {
      return {
        status: "disabled",
        sections: [],
        skillIds: [],
        recommendations: [],
        sharedInputs: [],
        sharedConstraints: [],
        auditTrail: ["skills=disabled"],
        notes: ["Skill prompt index is not configured for this Director runtime."],
      };
    }

    try {
      const sections = this.options.skillPromptIndex
        .buildSections({
          userText: buildSkillMatchText(normalizedInput),
          limit: this.options.skillContext?.limit ?? 3,
        })
        .map((section) => limitSkillSection(section, this.options.skillContext?.maxChars ?? 1_200));
      const skillIds = dedupeStrings(sections.map(readSkillIdFromSection));

      if (sections.length === 0) {
        return {
          status: "miss",
          sections: [],
          skillIds: [],
          recommendations: [],
          sharedInputs: [],
          sharedConstraints: [],
          auditTrail: ["skills=miss"],
          notes: ["No approved Skill matched the current director objective."],
        };
      }

      return {
        status: "hit",
        sections,
        skillIds,
        summary: `Matched ${sections.length} approved Skill(s): ${skillIds.join(", ")}.`,
        recommendations: [
          `Apply matched Skill guidance before changing the production plan: ${skillIds.join(", ")}.`,
        ],
        sharedInputs: ["matched approved skill brief"],
        sharedConstraints: sections.map(
          (section) =>
            `Skill ${readSkillIdFromSection(section)}: ${truncateText(section.content, 520)}`,
        ),
        auditTrail: ["skills=hit", ...skillIds.map((skillId) => `skill-hit=${skillId}`)],
        notes: [`Approved Skill context matched: ${skillIds.join(", ")}.`],
      };
    } catch (error) {
      return {
        status: "degraded",
        sections: [],
        skillIds: [],
        recommendations: [],
        sharedInputs: [],
        sharedConstraints: [],
        auditTrail: ["skills=degraded"],
        notes: [
          `Skill prompt index degraded safely: ${error instanceof Error ? error.message : "unknown error"}.`,
        ],
      };
    }
  }

  private async recallPublishedKnowledge(
    normalizedInput: DirectorNormalizedInput,
  ): Promise<DirectorKnowledgeRecallPacket> {
    if (!this.options.knowledgeRecall?.enabled) {
      return buildPublishedKnowledgeRecallPacket([], {
        ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
        queryId: `published-disabled-${normalizedInput.snapshotId}`,
      });
    }

    if (this.options.knowledgeStore?.listPublishedDocuments === undefined) {
      return {
        ...buildPublishedKnowledgeRecallPacket([], {
          ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
          queryId: `published-unavailable-${normalizedInput.snapshotId}`,
        }),
        status: "miss",
        notes: [
          "Published knowledge recall is enabled, but no document-capable knowledge store is configured.",
        ],
      };
    }

    try {
      const documents = await this.options.knowledgeStore.listPublishedDocuments();
      return buildPublishedKnowledgeRecallPacket(
        documents,
        {
          ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
          queryId: `published-${normalizedInput.snapshotId}`,
        },
        { now: this.nowIso() },
      );
    } catch (error) {
      return {
        ...buildPublishedKnowledgeRecallPacket([], {
          ...this.buildPublishedKnowledgeRecallQuery(normalizedInput),
          queryId: `published-degraded-${normalizedInput.snapshotId}`,
        }),
        status: "degraded",
        notes: [
          `Published knowledge recall degraded safely: ${error instanceof Error ? error.message : "unknown error"}.`,
        ],
      };
    }
  }

  private buildPublishedKnowledgeRecallQuery(normalizedInput: DirectorNormalizedInput): Omit<
    DirectorKnowledgeRecallPacket["query"],
    "maxHits" | "maxChars"
  > & {
    maxHits: number;
    maxChars: number;
  } {
    const workingContext = this.buildWorkingContext(normalizedInput);
    const recallHints = this.buildRecallHints(normalizedInput);

    return {
      ...(workingContext.projectId === undefined ? {} : { projectId: workingContext.projectId }),
      ...(workingContext.groupId === undefined ? {} : { groupId: workingContext.groupId }),
      anchorIds: [...workingContext.anchorIds],
      tags: [...recallHints.knowledgeSignalTags],
      preferredAdapters: dedupeStrings([
        ...recallHints.preferredBindings,
        ...recallHints.requiredBindings,
        ...recallHints.fallbackBindings,
      ]),
      ...(workingContext.generationType === undefined
        ? {}
        : { generationType: workingContext.generationType }),
      ...(workingContext.generationStyle === undefined
        ? {}
        : { generationStyle: workingContext.generationStyle }),
      includeGlobalExperience: true,
      maxHits: this.options.knowledgeRecall?.maxHits ?? 3,
      maxChars: this.options.knowledgeRecall?.maxChars ?? 900,
    };
  }

  private async captureRuntimeCapabilitySnapshot(
    normalizedInput: DirectorNormalizedInput,
    coreSnapshot: CoreRuntimeCapabilitySnapshot,
  ): Promise<RuntimeCapabilitySnapshot> {
    const adapters = await this.listRuntimeAdapters(normalizedInput, coreSnapshot);
    const switches = await this.resolveRuntimeSwitches(normalizedInput, coreSnapshot, adapters);
    const matchResult = await this.matchRuntimeAdapters(
      normalizedInput,
      coreSnapshot,
      adapters,
      switches,
    );
    const availableBindings = collectAvailableBindings(adapters);
    const availableAdapters = adapters.map((adapter) => adapter.adapterId);
    const executionAdapterSelections = buildExecutionAdapterSelections(adapters, switches);
    const eligibleExecutionAdapters = dedupeStrings(
      executionAdapterSelections.flatMap((selection) => selection.eligibleAdapters),
    );
    const primaryExecutionSelection = executionAdapterSelections.find(
      (selection) => selection.role === "script-planner" && selection.actionClass === "generate",
    );
    const eligibleImageBindings = dedupeStrings(
      matchResult.eligibleImageBindings ??
        matchResult.eligibleImageAdapters
          .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
          .filter((bindingId): bindingId is string => bindingId !== null),
    );
    const eligibleVideoBindings = dedupeStrings(
      matchResult.eligibleVideoBindings ??
        matchResult.eligibleVideoAdapters
          .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
          .filter((bindingId): bindingId is string => bindingId !== null),
    );
    const issues: RuntimeCapabilityIssue[] = [];

    if (coreSnapshot.runtimeStatus === "offline") {
      issues.push({
        code: "runtime-offline",
        severity: "block",
        message: "Runtime is offline, so no controlled execution handoff can be produced.",
      });
    } else if (coreSnapshot.runtimeStatus === "degraded") {
      issues.push({
        code: "runtime-degraded",
        severity: "warn",
        message: "Runtime is degraded, so operator approval is required before execution.",
      });
    }

    if (availableBindings.length === 0) {
      issues.push({
        code: "binding-missing",
        severity: "block",
        message: "No runtime bindings are available.",
      });
    }

    if (
      normalizedInput.context.intent.requiredImageBinding !== undefined &&
      !availableBindings.includes(normalizedInput.context.intent.requiredImageBinding)
    ) {
      issues.push({
        code: "required-image-binding-unavailable",
        severity: "block",
        message: `Required image binding ${normalizedInput.context.intent.requiredImageBinding} is unavailable.`,
      });
    }

    if (
      normalizedInput.context.intent.requiredVideoBinding !== undefined &&
      !availableBindings.includes(normalizedInput.context.intent.requiredVideoBinding)
    ) {
      issues.push({
        code: "required-video-binding-unavailable",
        severity: "block",
        message: `Required video binding ${normalizedInput.context.intent.requiredVideoBinding} is unavailable.`,
      });
    }

    if (
      !coreSnapshot.supportsVideo &&
      normalizedInput.context.group.generationStyle === "immersive"
    ) {
      issues.push({
        code: "immersive-video-unsupported",
        severity: "warn",
        message: "Immersive generation was requested, but the runtime does not support video.",
      });
    }

    if (!switches.autoRouteEnabled) {
      issues.push({
        code: "auto-route-disabled",
        severity: "block",
        message: "Auto-route is disabled by runtime switches.",
      });
    }

    for (const role of switches.disabledRoles) {
      issues.push({
        code: `role-disabled-${role}`,
        severity: "block",
        message: `Role ${role} is disabled by runtime switches.`,
      });
    }

    for (const reason of matchResult.blockedReasons) {
      issues.push({
        code: "runtime-match-blocked",
        severity: "block",
        message: reason,
      });
    }

    for (const warning of matchResult.warnings) {
      issues.push({
        code: "runtime-match-warning",
        severity: "warn",
        message: warning,
      });
    }

    return {
      runtimeId: coreSnapshot.runtimeId,
      status: coreSnapshot.runtimeStatus,
      availableBindings,
      availableAdapters,
      eligibleImageBindings,
      eligibleVideoBindings,
      eligibleImageAdapters: [...matchResult.eligibleImageAdapters],
      eligibleVideoAdapters: [...matchResult.eligibleVideoAdapters],
      eligibleExecutionAdapters,
      executionAdapterSelections,
      selectedImageAdapter: matchResult.selectedImageAdapterId ?? null,
      selectedVideoAdapter: matchResult.selectedVideoAdapterId ?? null,
      selectedExecutionAdapter: primaryExecutionSelection?.selectedAdapter ?? null,
      supportsVideo: coreSnapshot.supportsVideo,
      maxPromptChars: coreSnapshot.maxPromptChars,
      deterministicMode: coreSnapshot.deterministicMode ?? null,
      autoRouteEnabled: switches.autoRouteEnabled,
      disabledRoles: [...switches.disabledRoles],
      disabledAdapters: [...switches.disabledAdapters],
      blockedReasons: [...matchResult.blockedReasons],
      warnings: [...matchResult.warnings],
      issues,
    };
  }

  private assessAlignment(
    normalizedInput: DirectorNormalizedInput,
    clarification: CoreClarificationDecision,
  ): AlignmentAssessment {
    const { context } = normalizedInput;
    const clarificationQuestions: ClarificationQuestion[] = [];
    const seenCodes = new Set<string>();

    if (!context.project.title && !context.project.outline) {
      seenCodes.add("missing-project-brief");
      clarificationQuestions.push({
        code: "missing-project-brief",
        prompt: "Please describe the desired output or provide a project title before execution.",
      });
    }

    if (context.group.generationType !== "new" && context.group.anchorIds.length === 0) {
      seenCodes.add("missing-continuity-anchor");
      clarificationQuestions.push({
        code: "missing-continuity-anchor",
        prompt: "Extend/edit flows need at least one anchor ID to preserve continuity.",
      });
    }

    if (context.project.continuityPriority === "high" && context.group.anchorIds.length === 0) {
      seenCodes.add("continuity-needs-anchor");
      clarificationQuestions.push({
        code: "continuity-needs-anchor",
        prompt: "Continuity is high priority. Which anchor or reference should stay locked?",
      });
    }

    for (const question of clarification.questions) {
      if (seenCodes.has(question.questionId)) {
        continue;
      }
      clarificationQuestions.push({
        code: question.questionId,
        prompt: question.prompt,
      });
    }

    const decision: AlignmentDecision =
      clarification.alignmentState === "blocked"
        ? "blocked"
        : clarificationQuestions.length > 0
          ? "clarification_required"
          : "aligned";

    return {
      decision,
      summary:
        decision === clarification.alignmentState
          ? clarification.summary
          : `Director requires ${clarificationQuestions.length} clarification answer(s) before handoff can be trusted.`,
      reasons: [...clarification.blockingReasons],
      clarificationQuestions,
    };
  }

  private lockAlignment(
    normalizedInput: DirectorNormalizedInput,
    coreAlignmentLock: CoreAlignmentLock,
    alignmentAssessment: AlignmentAssessment,
  ): AlignmentLock {
    return {
      status:
        coreAlignmentLock.status === "pending"
          ? "awaiting_clarification"
          : coreAlignmentLock.status,
      goal: normalizedInput.goal,
      lockedConstraints: coreAlignmentLock.lockedConstraints.map((constraint) => ({
        field: constraint.field,
        level: constraint.level,
        source: constraint.source === "user_lock" ? "snapshot" : "director",
        value: constraint.value,
        ...(constraint.reason === undefined ? {} : { reason: constraint.reason }),
      })),
      openQuestions: [...alignmentAssessment.clarificationQuestions],
      blockingReasons: [...alignmentAssessment.reasons],
    };
  }

  private buildReview(
    normalizedInput: DirectorNormalizedInput,
    runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
    alignmentLock: AlignmentLock,
    coreControl: {
      readonly plan: DirectorPlan;
      readonly review: ReviewReport;
    },
    recallContext: MaterializedRecallContext,
    skillContext: DirectorSkillContext,
  ): DirectorReview {
    const executionPlan = applySkillContextToExecutionPlan(
      buildExecutionPlan(normalizedInput.context, coreControl.plan),
      skillContext,
    );
    const reviewReport = mergeReviewReport(
      coreControl.review,
      runtimeCapabilitySnapshot,
      alignmentLock,
    );
    const plan = applyReviewDecisionToPlan(coreControl.plan, reviewReport.overallDecision);

    return {
      decision: reviewReport.overallDecision,
      summary: buildReviewSummary(
        normalizedInput,
        reviewReport,
        alignmentLock,
        recallContext,
        skillContext,
      ),
      recommendations: dedupeStrings([
        ...reviewReport.requiredFixes,
        ...recallContext.recommendations,
        ...skillContext.recommendations,
      ]),
      blockingReasons: reviewReport.blockingReasons,
      plan,
      executionPlan,
      reviewReport,
    };
  }

  private buildCrewAssignments(
    normalizedInput: DirectorNormalizedInput,
    runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
    alignmentLock: AlignmentLock,
    review: DirectorReview,
    coreBlueprint?: ExecutionBlueprint,
    recallContext?: MaterializedRecallContext,
    skillContext?: DirectorSkillContext,
  ): readonly CrewAssignment[] {
    const selectedRoutingAdapters =
      review.plan.modeDecision.selectedGenerationStyle === "immersive"
        ? runtimeCapabilitySnapshot.eligibleVideoAdapters
        : runtimeCapabilitySnapshot.eligibleImageAdapters;
    const scriptPlannerExecutionSelection = findExecutionAdapterSelection(
      runtimeCapabilitySnapshot,
      "script-planner",
      "generate",
    );
    const shotPlannerExecutionSelection = findExecutionAdapterSelection(
      runtimeCapabilitySnapshot,
      "shot-planner",
      "generate",
    );
    const baseStatus = decisionToAssignmentStatus(review.decision);
    const constraints = alignmentLock.lockedConstraints.map(
      (constraint) => `${constraint.field}=${constraint.value}`,
    );

    const assignments = [
      {
        assignmentId: "assignment-researcher",
        role: "researcher",
        objective: "Inspect workspace and continuity signals before planning.",
        assignedCapability: "workspace-research",
        inputs: ["host snapshot", "knowledge signals"],
        outputs: ["research brief"],
        deliverable: "Research brief with continuity notes and unknowns.",
        acceptanceCriteria: [
          "Continuity risks are explicitly called out.",
          "Missing references are surfaced before script planning.",
        ],
        constraints,
        dependsOn: [],
        allowedAdapters: [],
        actionClass: "read",
        approvalMode: "auto-allow",
        budgetLimit: 0,
        timeoutMs: 5_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Escalate to director if no continuity signal is usable.",
        escalationToDirector:
          "Escalate when workspace evidence is missing or contradicts locked constraints.",
        status: baseStatus,
      },
      {
        assignmentId: "assignment-script-planner",
        role: "script-planner",
        objective: "Turn the aligned brief into a deterministic scene script plan.",
        assignedCapability: "script-outline",
        inputs: ["research brief", "alignment lock"],
        outputs: ["script outline"],
        deliverable: "Script outline aligned with the locked director goal.",
        acceptanceCriteria: [
          "The script outline preserves the requested generation type.",
          "Locked constraints are echoed back without mutation.",
        ],
        constraints,
        dependsOn: ["assignment-researcher"],
        allowedAdapters: [...(scriptPlannerExecutionSelection?.eligibleAdapters ?? [])],
        actionClass: "generate",
        approvalMode: review.decision === "pass" ? "auto-allow" : "operator-approve",
        budgetLimit: 0,
        timeoutMs: 8_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Return control to the director instead of improvising.",
        escalationToDirector:
          "Escalate when the brief cannot be converted into a script outline safely.",
        status: baseStatus,
        ...(scriptPlannerExecutionSelection?.selectedAdapter === null ||
        scriptPlannerExecutionSelection?.selectedAdapter === undefined
          ? {}
          : { selectedAdapter: scriptPlannerExecutionSelection.selectedAdapter }),
      },
      {
        assignmentId: "assignment-shot-planner",
        role: "shot-planner",
        objective: "Break the script outline into shot-ready assets and timing.",
        assignedCapability: "shot-breakdown",
        inputs: ["script outline"],
        outputs: ["shot breakdown"],
        deliverable: "Shot breakdown with scene timing and asset expectations.",
        acceptanceCriteria: [
          "Shot count stays consistent with the requested scene count.",
          "Each shot keeps the locked creative constraints visible.",
        ],
        constraints,
        dependsOn: ["assignment-script-planner"],
        allowedAdapters: [...(shotPlannerExecutionSelection?.eligibleAdapters ?? [])],
        actionClass: "generate",
        approvalMode: review.decision === "pass" ? "auto-allow" : "operator-approve",
        budgetLimit: 0,
        timeoutMs: 8_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Pause and return the partial shot breakdown to the director.",
        escalationToDirector: "Escalate when shot-level planning would violate locked constraints.",
        status: baseStatus,
        ...(shotPlannerExecutionSelection?.selectedAdapter === null ||
        shotPlannerExecutionSelection?.selectedAdapter === undefined
          ? {}
          : { selectedAdapter: shotPlannerExecutionSelection.selectedAdapter }),
      },
      {
        assignmentId: "assignment-asset-router",
        role: "asset-router",
        objective: "Match the requested output with an eligible runtime binding.",
        assignedCapability: "adapter-route-selection",
        inputs: ["script outline", "runtime capability snapshot"],
        outputs: ["adapter route"],
        deliverable: "Adapter route recommendation and readiness decision.",
        acceptanceCriteria: [
          "Selected adapter must satisfy the locked binding policy.",
          "No-match outcomes are returned as structured blocking reasons.",
        ],
        constraints,
        dependsOn: ["assignment-script-planner"],
        allowedAdapters: [...selectedRoutingAdapters],
        actionClass: "route",
        approvalMode: "operator-approve",
        budgetLimit: 0,
        timeoutMs: 4_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Block the handoff if no eligible adapter exists.",
        escalationToDirector: "Escalate when adapter capabilities do not satisfy the locked goal.",
        status:
          baseStatus === "blocked"
            ? "blocked"
            : selectedRoutingAdapters.length === 0
              ? "blocked"
              : baseStatus,
        selectedAdapter:
          review.plan.modeDecision.selectedGenerationStyle === "immersive"
            ? runtimeCapabilitySnapshot.selectedVideoAdapter
            : runtimeCapabilitySnapshot.selectedImageAdapter,
        ...(selectedRoutingAdapters.length === 0
          ? { blockingReason: "No eligible adapter matched the locked request." }
          : {}),
      },
      {
        assignmentId: "assignment-qc-reviewer",
        role: "qc-reviewer",
        objective: "Check that the crew output and adapter route still honor the locked brief.",
        assignedCapability: "quality-review",
        inputs: ["shot breakdown", "adapter route"],
        outputs: ["release recommendation"],
        deliverable: "Quality review before any external execution is allowed.",
        acceptanceCriteria: [
          "Every locked constraint is still present.",
          "Blocked or warning states are surfaced to the operator preview.",
        ],
        constraints,
        dependsOn: ["assignment-shot-planner", "assignment-asset-router"],
        allowedAdapters: [],
        actionClass: "review",
        approvalMode: "operator-approve",
        budgetLimit: 0,
        timeoutMs: 3_000,
        maxDelegationDepth: 0,
        fallbackPolicy: "Return review findings and stop before execution.",
        escalationToDirector:
          "Escalate when review finds drift between the plan and the locked goal.",
        status: baseStatus,
      },
    ] satisfies readonly CrewAssignment[];
    const baseAssignments =
      coreBlueprint !== undefined && coreBlueprint.assignments.length > 0
        ? mapCoreCrewAssignments(coreBlueprint.assignments, review.decision)
        : assignments;
    const recallAwareAssignments =
      recallContext === undefined
        ? baseAssignments
        : applyRecallCrewContext(baseAssignments, recallContext);
    const skillAwareAssignments =
      skillContext === undefined
        ? recallAwareAssignments
        : applySkillCrewContext(recallAwareAssignments, skillContext);

    return applyRuntimeCrewGates(skillAwareAssignments, runtimeCapabilitySnapshot, review);
  }

  private buildActionGraph(
    normalizedInput: DirectorNormalizedInput,
    review: DirectorReview,
    crewAssignments: readonly CrewAssignment[],
    runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
  ): ActionGraph {
    const selectedMediaAdapter =
      review.plan.modeDecision.selectedGenerationStyle === "immersive"
        ? runtimeCapabilitySnapshot.selectedVideoAdapter
        : runtimeCapabilitySnapshot.selectedImageAdapter;

    const nodes = crewAssignments.map<ActionGraphNode>((assignment) => {
      const selectedAdapter =
        assignment.role === "asset-router"
          ? (assignment.selectedAdapter ?? selectedMediaAdapter)
          : (assignment.selectedAdapter ?? null);
      const blockingReason =
        assignment.blockingReason ??
        (assignment.role === "asset-router" && assignment.allowedAdapters.length === 0
          ? "No eligible adapter matched the locked request."
          : assignment.status === "blocked"
            ? "Director review blocked this assignment before handoff."
            : undefined);

      return {
        nodeId: `node-${assignment.assignmentId}`,
        assignmentId: assignment.assignmentId,
        role: assignment.role,
        objective: assignment.objective,
        deliverable: assignment.deliverable,
        actionClass: assignment.actionClass,
        approvalMode: assignment.approvalMode,
        status:
          blockingReason !== undefined
            ? "blocked"
            : assignment.status === "awaiting_approval"
              ? "awaiting_approval"
              : assignment.status,
        dependsOn: [...assignment.dependsOn],
        eligibleAdapters: [...assignment.allowedAdapters],
        selectedAdapter,
        acceptanceCriteria: [...assignment.acceptanceCriteria],
        ...(blockingReason === undefined ? {} : { blockingReason }),
      };
    });

    const edges: ActionGraphEdge[] = [
      {
        edgeId: "handoff-research-to-script",
        fromAssignmentId: "assignment-researcher",
        toAssignmentId: "assignment-script-planner",
        artifact: "research brief",
        handoffContract: "Research findings become the script outline input.",
        blocking: true,
      },
      {
        edgeId: "handoff-script-to-shot",
        fromAssignmentId: "assignment-script-planner",
        toAssignmentId: "assignment-shot-planner",
        artifact: "script outline",
        handoffContract: "Approved script outline becomes shot planning input.",
        blocking: true,
      },
      {
        edgeId: "handoff-script-to-router",
        fromAssignmentId: "assignment-script-planner",
        toAssignmentId: "assignment-asset-router",
        artifact: "route requirements",
        handoffContract: "Script output informs adapter routing in parallel with shot planning.",
        blocking: true,
      },
      {
        edgeId: "handoff-shot-to-qc",
        fromAssignmentId: "assignment-shot-planner",
        toAssignmentId: "assignment-qc-reviewer",
        artifact: "shot breakdown",
        handoffContract: "Shot plan must be reviewed before any execution handoff.",
        blocking: true,
      },
      {
        edgeId: "handoff-router-to-qc",
        fromAssignmentId: "assignment-asset-router",
        toAssignmentId: "assignment-qc-reviewer",
        artifact: "adapter route",
        handoffContract: "Adapter route must be reviewed before any execution handoff.",
        blocking: true,
      },
    ];

    const blockedReasons = dedupeStrings([
      ...runtimeCapabilitySnapshot.blockedReasons,
      ...nodes.flatMap((node) =>
        node.status === "blocked" && node.blockingReason !== undefined ? [node.blockingReason] : [],
      ),
    ]);
    const readiness: ActionGraphReadiness =
      blockedReasons.length > 0 || review.decision === "block"
        ? "blocked"
        : nodes.some((node) => node.status === "awaiting_approval") || review.decision === "warn"
          ? "review_required"
          : "ready";

    return {
      graphId: `graph-${normalizedInput.snapshotId}`,
      goal: normalizedInput.goal,
      readiness,
      nodes,
      edges,
      blockedReasons,
    };
  }

  private buildExecutionHandoffEnvelope(
    normalizedInput: DirectorNormalizedInput,
    alignmentLock: AlignmentLock,
    review: DirectorReview,
    actionGraph: ActionGraph,
    recallContext: MaterializedRecallContext,
    skillContext: DirectorSkillContext,
  ): ExecutionHandoffEnvelope {
    return {
      handoffId: `handoff-${normalizedInput.snapshotId}`,
      snapshotId: normalizedInput.snapshotId,
      runtimeId: normalizedInput.context.runtime.runtimeId,
      status: actionGraph.readiness,
      goal: normalizedInput.goal,
      lockedConstraints: alignmentLock.lockedConstraints.map(
        (constraint) => `${constraint.field}=${constraint.value}`,
      ),
      operatorPreview: {
        summary: review.summary,
        visiblePrompt: review.executionPlan.prompt.visible,
        selectedGenerationType: review.executionPlan.selectedGenerationType,
        selectedGenerationStyle: review.executionPlan.selectedGenerationStyle,
        selectedImageBinding: review.executionPlan.selectedImageBinding,
        selectedVideoBinding: review.executionPlan.selectedVideoBinding,
        actionCount: actionGraph.nodes.length,
        blockedReasons: [...actionGraph.blockedReasons],
      },
      entries: actionGraph.nodes.map((node) => ({
        assignmentId: node.assignmentId,
        role: node.role,
        deliverable: node.deliverable,
        actionClass: node.actionClass,
        approvalMode: node.approvalMode,
        selectedAdapter: node.selectedAdapter,
        status: node.status,
        ...(node.blockingReason === undefined ? {} : { blockingReason: node.blockingReason }),
      })),
      auditTrail: buildAuditTrail(
        normalizedInput,
        alignmentLock,
        actionGraph,
        recallContext,
        skillContext,
      ),
    };
  }

  private toEvaluateResponse(
    review: DirectorReview,
    actionGraph: ActionGraph,
    executionHandoffEnvelope: ExecutionHandoffEnvelope,
  ): DirectorEvaluateResponse {
    const decision = readinessToDecision(actionGraph.readiness);
    const blockingReasons = dedupeStrings([
      ...review.blockingReasons,
      ...actionGraph.blockedReasons,
    ]);
    const recommendations = dedupeStrings([
      ...review.recommendations,
      ...(actionGraph.readiness === "review_required"
        ? ["Operator approval is required before execution handoff can continue."]
        : []),
      ...(actionGraph.readiness === "blocked"
        ? ["Resolve blocked action nodes before continuing to external execution."]
        : []),
    ]);

    return {
      apiVersion: DIRECTOR_HOST_API_VERSION,
      snapshotId: executionHandoffEnvelope.snapshotId,
      runtimeId: executionHandoffEnvelope.runtimeId,
      decision,
      summary: executionHandoffEnvelope.operatorPreview.summary,
      recommendations:
        recommendations.length > 0
          ? recommendations
          : ["Proceed with the current deterministic director handoff."],
      plan: {
        planId: review.plan.planId,
        status: readinessToPlanStatus(actionGraph.readiness),
        summary: review.plan.summary,
        confidence: review.plan.confidence,
        selectedGenerationStyle: review.plan.modeDecision.selectedGenerationStyle,
        selectedImageBinding: review.plan.modelRoutingDecision.selectedImageBinding,
        selectedVideoBinding: review.plan.modelRoutingDecision.selectedVideoBinding,
        riskFlags: dedupeStrings([
          ...review.plan.riskFlags,
          ...(actionGraph.blockedReasons.length > 0 ? ["action-graph-blocked"] : []),
        ]),
      },
      execution: {
        executionId: review.executionPlan.executionId,
        selectedGenerationType: review.executionPlan.selectedGenerationType,
        selectedGenerationStyle: review.executionPlan.selectedGenerationStyle,
        visiblePrompt: review.executionPlan.prompt.visible,
      },
      review: {
        overallDecision: decision,
        blockingReasons,
        requiredFixes: recommendations,
      },
    };
  }

  private async listRuntimeAdapters(
    normalizedInput: DirectorNormalizedInput,
    coreSnapshot: CoreRuntimeCapabilitySnapshot,
  ): Promise<readonly DirectorRuntimeAdapterDescriptor[]> {
    if (this.options.runtimeRegistry === undefined) {
      return defaultRuntimeAdaptersFromCore(coreSnapshot);
    }

    const adapters = await this.options.runtimeRegistry.listAdapters({
      normalizedInput,
      coreSnapshot,
    });
    return adapters.map((adapter) => normalizeRuntimeAdapterDescriptor(adapter));
  }

  private async resolveRuntimeSwitches(
    normalizedInput: DirectorNormalizedInput,
    coreSnapshot: CoreRuntimeCapabilitySnapshot,
    adapters: readonly DirectorRuntimeAdapterDescriptor[],
  ): Promise<Required<DirectorRuntimeSwitchSnapshot>> {
    if (this.options.switches === undefined) {
      return {
        autoRouteEnabled: true,
        disabledRoles: [],
        disabledAdapters: [],
      };
    }

    const snapshot = await this.options.switches.snapshot({
      normalizedInput,
      coreSnapshot,
      adapters,
    });

    return {
      autoRouteEnabled: snapshot.autoRouteEnabled ?? true,
      disabledRoles: [...(snapshot.disabledRoles ?? [])],
      disabledAdapters: [...(snapshot.disabledAdapters ?? [])],
    };
  }

  private async matchRuntimeAdapters(
    normalizedInput: DirectorNormalizedInput,
    coreSnapshot: CoreRuntimeCapabilitySnapshot,
    adapters: readonly DirectorRuntimeAdapterDescriptor[],
    switches: Required<DirectorRuntimeSwitchSnapshot>,
  ): Promise<Required<DirectorRuntimeMatchResult>> {
    if (this.options.runtimeMatcher === undefined) {
      return defaultRuntimeMatchResult(normalizedInput, adapters, switches);
    }

    const matchResult = await this.options.runtimeMatcher.match({
      normalizedInput,
      coreSnapshot,
      adapters,
      switches,
    });

    const eligibleImageAdapters = dedupeStrings([...(matchResult.eligibleImageAdapters ?? [])]);
    const eligibleVideoAdapters = dedupeStrings([...(matchResult.eligibleVideoAdapters ?? [])]);

    return {
      eligibleImageAdapters,
      eligibleVideoAdapters,
      eligibleImageBindings: eligibleImageAdapters
        .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
        .filter((bindingId): bindingId is string => bindingId !== null),
      eligibleVideoBindings: eligibleVideoAdapters
        .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
        .filter((bindingId): bindingId is string => bindingId !== null),
      selectedImageAdapterId: matchResult.selectedImageAdapterId ?? null,
      selectedVideoAdapterId: matchResult.selectedVideoAdapterId ?? null,
      selectedImageBinding:
        matchResult.selectedImageBinding ??
        resolveBindingForAdapter(adapters, matchResult.selectedImageAdapterId ?? null),
      selectedVideoBinding:
        matchResult.selectedVideoBinding ??
        resolveBindingForAdapter(adapters, matchResult.selectedVideoAdapterId ?? null),
      blockedReasons: dedupeStrings([...(matchResult.blockedReasons ?? [])]),
      warnings: dedupeStrings([...(matchResult.warnings ?? [])]),
    };
  }

  private toKnowledgePackEntry(
    record: Awaited<ReturnType<KnowledgeStorePort["listPublished"]>>[number],
  ): DirectorKnowledgePackCatalogEntry {
    return {
      id: record.metadata.id,
      title: record.metadata.title,
      version: record.metadata.version,
      stage: "published",
      createdAt: record.metadata.createdAt,
      ...(record.metadata.description === undefined
        ? {}
        : { description: record.metadata.description }),
      ...(record.metadata.tags === undefined ? {} : { tags: [...record.metadata.tags] }),
    };
  }
}

function resolveEligibleBindings(
  availableBindings: readonly string[],
  requiredBinding: string | undefined,
  preferredBinding: string | undefined,
  fallbackBindings: readonly string[] | undefined,
): readonly string[] {
  if (requiredBinding !== undefined) {
    return availableBindings.includes(requiredBinding) ? [requiredBinding] : [];
  }
  if (preferredBinding !== undefined && availableBindings.includes(preferredBinding)) {
    const rest = availableBindings.filter((binding) => binding !== preferredBinding);
    return [preferredBinding, ...rest];
  }

  if (fallbackBindings !== undefined && fallbackBindings.length > 0) {
    const fallbackMatches = fallbackBindings.filter((binding) =>
      availableBindings.includes(binding),
    );
    if (fallbackMatches.length > 0) {
      const remaining = availableBindings.filter((binding) => !fallbackMatches.includes(binding));
      return [...fallbackMatches, ...remaining];
    }
  }

  return [...availableBindings];
}

function defaultRuntimeAdaptersFromCore(
  coreSnapshot: CoreRuntimeCapabilitySnapshot,
): readonly DirectorRuntimeAdapterDescriptor[] {
  return coreSnapshot.capabilities.map((capability) =>
    normalizeRuntimeAdapterDescriptor({
      adapterId: capability.adapterId,
      adapterKind: capability.bindingId === "director-core.internal" ? "internal" : "media",
      bindingId: capability.bindingId,
      enabled: capability.status !== "blocked",
      healthy: capability.status === "ready",
      dryRunOnly: true,
      supportedActionClasses: capability.supportedActionClasses,
      mediaModes:
        capability.scope === "hybrid"
          ? ["image", "video"]
          : capability.scope === "video"
            ? ["video"]
            : capability.scope === "image"
              ? ["image"]
              : [],
      reason: capability.reason,
    }),
  );
}

function normalizeRuntimeAdapterDescriptor(
  adapter: DirectorRuntimeAdapterDescriptor,
): DirectorRuntimeAdapterDescriptor {
  return {
    adapterId: adapter.adapterId,
    adapterKind: adapter.adapterKind,
    ...(adapter.bindingId === undefined ? {} : { bindingId: adapter.bindingId }),
    ...(adapter.enabled === undefined ? {} : { enabled: adapter.enabled }),
    ...(adapter.healthy === undefined ? {} : { healthy: adapter.healthy }),
    ...(adapter.dryRunOnly === undefined ? {} : { dryRunOnly: adapter.dryRunOnly }),
    ...(adapter.mockOnly === undefined ? {} : { mockOnly: adapter.mockOnly }),
    ...(adapter.bridgeKind === undefined ? {} : { bridgeKind: adapter.bridgeKind }),
    ...(adapter.approvalMode === undefined ? {} : { approvalMode: adapter.approvalMode }),
    ...(adapter.supportedRoles === undefined
      ? {}
      : { supportedRoles: [...adapter.supportedRoles] }),
    ...(adapter.supportedActionClasses === undefined
      ? {}
      : { supportedActionClasses: [...adapter.supportedActionClasses] }),
    ...(adapter.mediaModes === undefined ? {} : { mediaModes: [...adapter.mediaModes] }),
    ...(adapter.reason === undefined ? {} : { reason: adapter.reason }),
  };
}

function collectAvailableBindings(adapters: readonly DirectorRuntimeAdapterDescriptor[]): string[] {
  return dedupeStrings(
    adapters
      .map((adapter) => adapter.bindingId ?? null)
      .filter((bindingId): bindingId is string => bindingId !== null),
  );
}

function resolveBindingForAdapter(
  adapters: readonly DirectorRuntimeAdapterDescriptor[],
  adapterId: string | null | undefined,
): string | null {
  if (adapterId === null || adapterId === undefined) {
    return null;
  }

  return adapters.find((adapter) => adapter.adapterId === adapterId)?.bindingId ?? null;
}

function supportsMediaMode(
  adapter: DirectorRuntimeAdapterDescriptor,
  mode: DirectorRuntimeMediaMode,
): boolean {
  if (adapter.adapterKind !== "media") {
    return false;
  }

  if (adapter.mediaModes === undefined || adapter.mediaModes.length === 0) {
    return mode === "image";
  }

  return adapter.mediaModes.includes(mode);
}

function isAdapterEligibleForRoute(
  adapter: DirectorRuntimeAdapterDescriptor,
  switches: Required<DirectorRuntimeSwitchSnapshot>,
): boolean {
  if (adapter.adapterKind !== "media") {
    return false;
  }

  if (switches.disabledAdapters.includes(adapter.adapterId)) {
    return false;
  }

  if (adapter.enabled === false || adapter.healthy === false) {
    return false;
  }

  if (
    adapter.supportedActionClasses !== undefined &&
    !adapter.supportedActionClasses.includes("route")
  ) {
    return false;
  }

  if (adapter.supportedRoles !== undefined && !adapter.supportedRoles.includes("asset-router")) {
    return false;
  }

  return true;
}

function supportsCrewRole(adapter: DirectorRuntimeAdapterDescriptor, role: CrewRole): boolean {
  return adapter.supportedRoles === undefined || adapter.supportedRoles.includes(role);
}

function supportsActionClass(
  adapter: DirectorRuntimeAdapterDescriptor,
  actionClass: ActionClass,
): boolean {
  return (
    adapter.supportedActionClasses === undefined ||
    adapter.supportedActionClasses.includes(actionClass)
  );
}

function isAdapterEligibleForExecutionHandoff(
  adapter: DirectorRuntimeAdapterDescriptor,
  role: CrewRole,
  actionClass: ActionClass,
  switches: Required<DirectorRuntimeSwitchSnapshot>,
): boolean {
  if (adapter.adapterKind !== "execution") {
    return false;
  }

  if (switches.disabledAdapters.includes(adapter.adapterId)) {
    return false;
  }

  if (adapter.enabled === false || adapter.healthy === false) {
    return false;
  }

  if (adapter.mockOnly === true || adapter.bridgeKind !== "http-json") {
    return false;
  }

  return supportsCrewRole(adapter, role) && supportsActionClass(adapter, actionClass);
}

function resolveEligibleExecutionAdapterIds(
  adapters: readonly DirectorRuntimeAdapterDescriptor[],
  role: CrewRole,
  actionClass: ActionClass,
  switches: Required<DirectorRuntimeSwitchSnapshot>,
): string[] {
  return adapters
    .filter((adapter) => isAdapterEligibleForExecutionHandoff(adapter, role, actionClass, switches))
    .map((adapter) => adapter.adapterId);
}

function buildExecutionAdapterSelections(
  adapters: readonly DirectorRuntimeAdapterDescriptor[],
  switches: Required<DirectorRuntimeSwitchSnapshot>,
): ExecutionAdapterSelection[] {
  return EXECUTION_HANDOFF_CANDIDATES.map((candidate) => {
    const eligibleAdapters = resolveEligibleExecutionAdapterIds(
      adapters,
      candidate.role,
      candidate.actionClass,
      switches,
    );

    return {
      role: candidate.role,
      actionClass: candidate.actionClass,
      eligibleAdapters,
      selectedAdapter: eligibleAdapters[0] ?? null,
      requiresOperatorApproval:
        eligibleAdapters[0] !== undefined &&
        isExecutionAdapterOperatorApprovalRequired(adapters, eligibleAdapters[0]),
    };
  });
}

function isExecutionAdapterOperatorApprovalRequired(
  adapters: readonly DirectorRuntimeAdapterDescriptor[],
  adapterId: string,
): boolean {
  const adapter = adapters.find((candidate) => candidate.adapterId === adapterId);
  if (adapter === undefined) {
    return true;
  }
  return adapter.mockOnly !== true && adapter.bridgeKind === "http-json";
}

function findExecutionAdapterSelection(
  runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
  role: CrewRole,
  actionClass: ActionClass,
): ExecutionAdapterSelection | undefined {
  return runtimeCapabilitySnapshot.executionAdapterSelections.find(
    (selection) => selection.role === role && selection.actionClass === actionClass,
  );
}

function resolveEligibleAdapterIds(
  adapters: readonly DirectorRuntimeAdapterDescriptor[],
  mode: DirectorRuntimeMediaMode,
  requiredBinding: string | undefined,
  preferredBinding: string | undefined,
  fallbackBindings: readonly string[] | undefined,
  switches: Required<DirectorRuntimeSwitchSnapshot>,
): string[] {
  const eligibleAdapters = adapters.filter(
    (adapter) => isAdapterEligibleForRoute(adapter, switches) && supportsMediaMode(adapter, mode),
  );

  if (requiredBinding !== undefined) {
    return eligibleAdapters
      .filter((adapter) => adapter.bindingId === requiredBinding)
      .map((adapter) => adapter.adapterId);
  }

  const preferredAdapters =
    preferredBinding === undefined
      ? []
      : eligibleAdapters
          .filter((adapter) => adapter.bindingId === preferredBinding)
          .map((adapter) => adapter.adapterId);
  const fallbackAdapters =
    fallbackBindings === undefined || fallbackBindings.length === 0
      ? []
      : fallbackBindings.flatMap((bindingId) =>
          eligibleAdapters
            .filter((adapter) => adapter.bindingId === bindingId)
            .map((adapter) => adapter.adapterId),
        );
  const remainingAdapters = eligibleAdapters
    .map((adapter) => adapter.adapterId)
    .filter(
      (adapterId) =>
        !preferredAdapters.includes(adapterId) && !fallbackAdapters.includes(adapterId),
    );

  return dedupeStrings([...preferredAdapters, ...fallbackAdapters, ...remainingAdapters]);
}

function defaultRuntimeMatchResult(
  normalizedInput: DirectorNormalizedInput,
  adapters: readonly DirectorRuntimeAdapterDescriptor[],
  switches: Required<DirectorRuntimeSwitchSnapshot>,
): Required<DirectorRuntimeMatchResult> {
  const { context } = normalizedInput;
  const eligibleImageAdapters = resolveEligibleAdapterIds(
    adapters,
    "image",
    context.intent.requiredImageBinding,
    context.intent.preferredImageBinding,
    context.intent.fallbackBindings,
    switches,
  );
  const eligibleVideoAdapters = context.runtime.supportsVideo
    ? resolveEligibleAdapterIds(
        adapters,
        "video",
        context.intent.requiredVideoBinding,
        context.intent.preferredVideoBinding,
        context.intent.fallbackBindings,
        switches,
      )
    : [];
  const blockedReasons: string[] = [];
  const warnings: string[] = [];

  if (!switches.autoRouteEnabled) {
    blockedReasons.push("Auto-route is disabled by runtime switches.");
  }

  if (context.intent.requiredImageBinding !== undefined && eligibleImageAdapters.length === 0) {
    blockedReasons.push(
      `Required image binding ${context.intent.requiredImageBinding} is unavailable after runtime filtering.`,
    );
  }

  if (
    context.intent.requiredVideoBinding !== undefined &&
    eligibleVideoAdapters.length === 0 &&
    context.runtime.supportsVideo
  ) {
    blockedReasons.push(
      `Required video binding ${context.intent.requiredVideoBinding} is unavailable after runtime filtering.`,
    );
  }

  if (
    context.group.generationStyle === "immersive" &&
    context.runtime.supportsVideo &&
    eligibleVideoAdapters.length === 0
  ) {
    blockedReasons.push("No eligible adapter matched the locked request.");
  } else if (eligibleImageAdapters.length === 0) {
    blockedReasons.push("No eligible adapter matched the locked request.");
  }

  if (switches.disabledAdapters.length > 0) {
    warnings.push(`Runtime switches disabled adapter(s): ${switches.disabledAdapters.join(", ")}.`);
  }

  return {
    eligibleImageAdapters,
    eligibleVideoAdapters,
    eligibleImageBindings: eligibleImageAdapters
      .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
      .filter((bindingId): bindingId is string => bindingId !== null),
    eligibleVideoBindings: eligibleVideoAdapters
      .map((adapterId) => resolveBindingForAdapter(adapters, adapterId))
      .filter((bindingId): bindingId is string => bindingId !== null),
    selectedImageAdapterId: eligibleImageAdapters[0] ?? null,
    selectedVideoAdapterId: eligibleVideoAdapters[0] ?? null,
    selectedImageBinding: resolveBindingForAdapter(adapters, eligibleImageAdapters[0] ?? null),
    selectedVideoBinding: resolveBindingForAdapter(adapters, eligibleVideoAdapters[0] ?? null),
    blockedReasons: dedupeStrings(blockedReasons),
    warnings: dedupeStrings(warnings),
  };
}

function applyRuntimeCrewGates(
  assignments: readonly CrewAssignment[],
  runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
  review: DirectorReview,
): readonly CrewAssignment[] {
  const selectedRoutingAdapters =
    review.plan.modeDecision.selectedGenerationStyle === "immersive"
      ? runtimeCapabilitySnapshot.eligibleVideoAdapters
      : runtimeCapabilitySnapshot.eligibleImageAdapters;
  const selectedAdapter =
    review.plan.modeDecision.selectedGenerationStyle === "immersive"
      ? runtimeCapabilitySnapshot.selectedVideoAdapter
      : runtimeCapabilitySnapshot.selectedImageAdapter;

  return assignments.map((assignment) => {
    const executionSelection = findExecutionAdapterSelection(
      runtimeCapabilitySnapshot,
      assignment.role,
      assignment.actionClass,
    );
    const prefersExecutionAdapter =
      executionSelection !== undefined && executionSelection.eligibleAdapters.length > 0;
    const filteredAllowedAdapters =
      assignment.role === "asset-router"
        ? assignment.allowedAdapters.length === 0
          ? [...selectedRoutingAdapters]
          : assignment.allowedAdapters.some((adapterId) =>
                selectedRoutingAdapters.includes(adapterId),
              )
            ? [
                ...assignment.allowedAdapters.filter((adapterId) =>
                  selectedRoutingAdapters.includes(adapterId),
                ),
                ...selectedRoutingAdapters.filter(
                  (adapterId) => !assignment.allowedAdapters.includes(adapterId),
                ),
              ]
            : [...selectedRoutingAdapters]
        : prefersExecutionAdapter
          ? [...executionSelection.eligibleAdapters]
          : assignment.allowedAdapters.filter(
              (adapterId) => !runtimeCapabilitySnapshot.disabledAdapters.includes(adapterId),
            );

    const blockingReason = runtimeCapabilitySnapshot.disabledRoles.includes(assignment.role)
      ? `Role ${assignment.role} is disabled by runtime switches.`
      : assignment.role === "asset-router" && !runtimeCapabilitySnapshot.autoRouteEnabled
        ? "Auto-route is disabled by runtime switches."
        : assignment.role === "asset-router" && filteredAllowedAdapters.length === 0
          ? "No eligible adapter matched the locked request."
          : assignment.allowedAdapters.length > 0 && filteredAllowedAdapters.length === 0
            ? `All adapters for role ${assignment.role} are disabled by runtime switches.`
            : assignment.blockingReason;
    const requiresExecutionApproval =
      prefersExecutionAdapter && executionSelection.requiresOperatorApproval;
    const approvalMode = requiresExecutionApproval ? "operator-approve" : assignment.approvalMode;
    const status =
      assignment.status === "blocked" || blockingReason !== undefined
        ? "blocked"
        : requiresExecutionApproval && assignment.status === "ready"
          ? "awaiting_approval"
          : assignment.status;

    return {
      ...assignment,
      approvalMode,
      allowedAdapters: filteredAllowedAdapters,
      selectedAdapter:
        assignment.role === "asset-router"
          ? selectedAdapter
          : prefersExecutionAdapter
            ? (executionSelection.selectedAdapter ?? assignment.selectedAdapter ?? null)
            : (assignment.selectedAdapter ?? null),
      status,
      ...(blockingReason === undefined ? {} : { blockingReason }),
    };
  });
}

function isExecutionHandoffCandidate(
  assignment: Pick<CrewAssignment, "role" | "actionClass">,
): boolean {
  return EXECUTION_HANDOFF_CANDIDATES.some(
    (candidate) =>
      candidate.role === assignment.role && candidate.actionClass === assignment.actionClass,
  );
}

function applyReviewDecisionToPlan(plan: DirectorPlan, decision: ReviewStatus): DirectorPlan {
  return {
    ...plan,
    status:
      decision === "block" ? "blocked" : decision === "warn" ? "review_required" : plan.status,
    reviewStatus: decision,
  };
}

function mergeReviewReport(
  baseReviewReport: ReviewReport,
  runtimeCapabilitySnapshot: RuntimeCapabilitySnapshot,
  alignmentLock: AlignmentLock,
): ReviewReport {
  const additionalReasons = [
    ...runtimeCapabilitySnapshot.issues
      .filter((issue) => issue.severity === "warn")
      .map((issue) => `runtime: ${issue.message}`),
    ...alignmentLock.blockingReasons.map((reason) => `alignment: ${reason}`),
    ...alignmentLock.openQuestions.map((question) => `alignment: ${question.prompt}`),
  ];
  const requiredFixes = [
    ...baseReviewReport.requiredFixes,
    ...alignmentLock.openQuestions.map((question) => question.prompt),
    ...runtimeCapabilitySnapshot.issues
      .filter((issue) => issue.severity === "block")
      .map((issue) => issue.message),
  ];
  const runtimeDecision = runtimeCapabilitySnapshot.issues.some(
    (issue) => issue.severity === "block",
  )
    ? "block"
    : runtimeCapabilitySnapshot.issues.some((issue) => issue.severity === "warn")
      ? "warn"
      : "pass";
  const alignmentDecision =
    alignmentLock.status === "blocked"
      ? "block"
      : alignmentLock.status === "awaiting_clarification"
        ? "warn"
        : "pass";
  const overallDecision = mergeDecisions(
    mergeDecisions(baseReviewReport.overallDecision, runtimeDecision),
    alignmentDecision,
  );

  return {
    overallDecision,
    gates: [...baseReviewReport.gates],
    blockingReasons: dedupeStrings([...baseReviewReport.blockingReasons, ...additionalReasons]),
    requiredFixes: dedupeStrings(requiredFixes),
  };
}

function buildReviewSummary(
  normalizedInput: DirectorNormalizedInput,
  reviewReport: ReviewReport,
  alignmentLock: AlignmentLock,
  recallContext: MaterializedRecallContext,
  skillContext: DirectorSkillContext,
): string {
  const baseSummary =
    reviewReport.overallDecision === "block"
      ? `${normalizedInput.goal} is blocked before external execution handoff.`
      : reviewReport.overallDecision === "warn"
        ? alignmentLock.status === "awaiting_clarification"
          ? `${normalizedInput.goal} needs clarification before the crew can proceed safely.`
          : `${normalizedInput.goal} needs operator review before execution handoff.`
        : `${normalizedInput.goal} is ready for deterministic crew delegation.`;

  return [baseSummary, recallContext.summary, skillContext.summary]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(" ");
}

function materializeRecall(
  recall: DirectorMemoryRecallResult,
  publishedKnowledgeRecall: DirectorKnowledgeRecallPacket,
  longTermMemory: DirectorLongTermMemoryPacket,
): MaterializedRecallContext {
  const topHits = recall.hits.slice(0, 2);
  const topPublishedHits = publishedKnowledgeRecall.hits.slice(0, 2);
  const longTermSignals = longTermMemory.signals.slice(0, 3);
  const preferredAdapterIds = dedupeStrings([
    ...topHits.flatMap((hit) => hit.selectedAdapters),
    ...topPublishedHits.flatMap((hit) => hit.method.preferredAdapters),
  ]);
  const topHit = topHits[0];
  const topPublishedHit = topPublishedHits[0];

  return {
    status:
      recall.status === "hit" ||
      publishedKnowledgeRecall.status === "hit" ||
      longTermMemory.status === "hit"
        ? "hit"
        : recall.status === "degraded" ||
            publishedKnowledgeRecall.status === "degraded" ||
            longTermMemory.status === "degraded"
          ? "degraded"
          : recall.status,
    ...(topHit !== undefined || topPublishedHit !== undefined
      ? {
          summary: [
            topHit === undefined
              ? undefined
              : `Recall matched ${recall.hits.length} prior run(s); top hit: ${topHit.summary}`,
            topPublishedHit === undefined
              ? undefined
              : `Published knowledge matched ${publishedKnowledgeRecall.hits.length} pack(s); top pack: ${topPublishedHit.summary}`,
          ]
            .filter((value): value is string => value !== undefined)
            .join(" "),
        }
      : {}),
    recommendations: dedupeStrings([
      ...(topHit === undefined
        ? []
        : [
            `Review recalled run ${topHit.provenance.runId} before changing continuity-sensitive decisions.`,
          ]),
      ...(topPublishedHit === undefined
        ? []
        : [
            `Review published knowledge pack ${topPublishedHit.knowledgePackId} before changing continuity-sensitive decisions.`,
          ]),
      ...longTermSignals.map(
        (signal) => `Apply long-term memory signal ${signal.id} during production planning.`,
      ),
      ...topHits
        .filter((hit) => hit.status !== "completed")
        .map(
          (hit) =>
            `Check why recalled run ${hit.provenance.runId} ended as ${hit.status} before reusing its route.`,
        ),
    ]),
    sharedInputs:
      topHit === undefined && topPublishedHit === undefined && longTermSignals.length === 0
        ? []
        : dedupeStrings([
            ...(topHit === undefined ? [] : ["bounded recall brief"]),
            ...(topPublishedHit === undefined ? [] : ["published knowledge brief"]),
            ...(longTermSignals.length === 0 ? [] : ["long-term memory brief"]),
          ]),
    sharedConstraints:
      topHit === undefined && topPublishedHit === undefined && longTermSignals.length === 0
        ? []
        : dedupeStrings([
            ...(topHit === undefined ? [] : [`Recall continuity brief: ${topHit.summary}`]),
            ...(topPublishedHit === undefined
              ? []
              : [`Published method brief: ${topPublishedHit.summary}`]),
            ...longTermSignals.map(
              (signal) => `Long-term memory ${signal.id}: ${signal.description}`,
            ),
            ...(preferredAdapterIds.length === 0
              ? []
              : [`Prefer recalled adapters: ${preferredAdapterIds.join(", ")}`]),
          ]),
    preferredAdapterIds,
    auditTrail: dedupeStrings([
      `recall=${recall.status}`,
      `published-knowledge=${publishedKnowledgeRecall.status}`,
      `long-term-memory=${longTermMemory.status}`,
      ...topHits.map((hit) => `recall-hit=${hit.recordId}:${hit.status}:${hit.score.toFixed(2)}`),
      ...topHits.map((hit) => `recall-run=${hit.provenance.runId}`),
      ...topPublishedHits.map(
        (hit) => `published-pack=${hit.knowledgePackId}:${hit.score.toFixed(2)}`,
      ),
      ...longTermSignals.map((signal) => `long-term-signal=${signal.id}`),
    ]),
  };
}

function applyPublishedKnowledgeSignals(
  normalizedInput: DirectorNormalizedInput,
  publishedKnowledgeRecall: DirectorKnowledgeRecallPacket,
): DirectorNormalizedInput {
  if (publishedKnowledgeRecall.hits.length === 0) {
    return normalizedInput;
  }

  const nextSignals = mergeKnowledgeSignals(
    normalizedInput.context.knowledgeSignals ?? [],
    publishedKnowledgeRecall.hits.map((hit) => ({
      id: `knowledge-pack:${hit.knowledgePackId}`,
      description: truncateText(
        `${hit.title} | ${hit.method.trigger} | ${hit.method.explanation}`,
        180,
      ),
      confidence: deriveSignalConfidence(hit.score),
      tags: dedupeStrings(hit.tags),
    })),
  );

  return {
    ...normalizedInput,
    context: {
      ...normalizedInput.context,
      knowledgeSignals: nextSignals,
    },
  };
}

function applyLongTermMemorySignals(
  normalizedInput: DirectorNormalizedInput,
  longTermMemory: DirectorLongTermMemoryPacket,
): DirectorNormalizedInput {
  if (longTermMemory.signals.length === 0) {
    return normalizedInput;
  }

  return {
    ...normalizedInput,
    context: {
      ...normalizedInput.context,
      knowledgeSignals: mergeKnowledgeSignals(
        normalizedInput.context.knowledgeSignals ?? [],
        longTermMemory.signals,
      ),
    },
  };
}

function applySkillSignals(
  normalizedInput: DirectorNormalizedInput,
  skillContext: DirectorSkillContext,
): DirectorNormalizedInput {
  if (skillContext.sections.length === 0) {
    return normalizedInput;
  }

  const nextSignals = mergeKnowledgeSignals(
    normalizedInput.context.knowledgeSignals ?? [],
    skillContext.sections.map((section) => {
      const skillId = readSkillIdFromSection(section);
      return {
        id: `skill:${skillId}`,
        description: truncateText(section.content.replaceAll(/\s+/gu, " "), 180),
        confidence: 0.82,
        tags: ["skill", skillId],
      };
    }),
  );

  return {
    ...normalizedInput,
    context: {
      ...normalizedInput.context,
      knowledgeSignals: nextSignals,
    },
  };
}

function mergeKnowledgeSignals(
  current: readonly DirectorKnowledgeSignal[],
  next: readonly DirectorKnowledgeSignal[],
): DirectorKnowledgeSignal[] {
  const byId = new Map<string, DirectorKnowledgeSignal>();
  for (const signal of [...current, ...next]) {
    byId.set(signal.id, {
      id: signal.id,
      description: signal.description,
      confidence: signal.confidence,
      tags: dedupeStrings(signal.tags),
    });
  }
  return [...byId.values()];
}

function mergeKnowledgePackRefs(
  recall: DirectorMemoryRecallResult,
  publishedKnowledgeRecall: DirectorKnowledgeRecallPacket,
): DirectorObservationEnvelope["recalledKnowledgePacks"] {
  const merged = new Map<string, DirectorObservationEnvelope["recalledKnowledgePacks"][number]>();

  for (const pack of recall.knowledgePacks) {
    merged.set(pack.knowledgePackId, {
      knowledgePackId: pack.knowledgePackId,
      ...(pack.title === undefined ? {} : { title: pack.title }),
      ...(pack.version === undefined ? {} : { version: pack.version }),
      ...(pack.tags === undefined ? {} : { tags: [...pack.tags] }),
      ...(pack.reason === undefined ? {} : { reason: pack.reason }),
    });
  }

  for (const hit of publishedKnowledgeRecall.hits) {
    merged.set(hit.knowledgePackId, {
      knowledgePackId: hit.knowledgePackId,
      title: hit.title,
      version: hit.version,
      tags: [...hit.tags],
      reason: hit.reasons.join(" | "),
    });
  }

  return [...merged.values()];
}

function deriveObservationRecallStatus(
  recall: DirectorMemoryRecallResult,
  publishedKnowledgeRecall: DirectorKnowledgeRecallPacket,
): DirectorObservationEnvelope["recallStatus"] {
  if (recall.status === "degraded" || publishedKnowledgeRecall.status === "degraded") {
    return "degraded";
  }
  if (recall.status === "hit" || publishedKnowledgeRecall.status === "hit") {
    return "hit";
  }
  if (recall.status === "miss") {
    return "miss";
  }
  return publishedKnowledgeRecall.status === "miss" ? "miss" : recall.status;
}

function mergeRecallNotes(
  recall: DirectorMemoryRecallResult,
  publishedKnowledgeRecall: DirectorKnowledgeRecallPacket,
): readonly string[] {
  return dedupeStrings([...recall.notes, ...publishedKnowledgeRecall.notes]);
}

function deriveSignalConfidence(score: number): number {
  return Math.max(0.55, Math.min(0.98, Number((score / 100).toFixed(2))));
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const limit = Math.max(1, maxChars - 1);
  return `${value.slice(0, limit)}…`;
}

function readDirectorIntakePayload(request: DirectorEvaluateRequest): DirectorIntakePayload | null {
  const value = (request as { readonly intake?: unknown }).intake;
  if (!isPlainObject(value) || typeof value.objective !== "string") {
    return null;
  }
  return value as unknown as DirectorIntakePayload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildSkillMatchText(normalizedInput: DirectorNormalizedInput): string {
  const { context } = normalizedInput;
  return [
    normalizedInput.goal,
    normalizedInput.projectLabel,
    context.project.title,
    context.project.outline,
    context.project.genre?.join(" "),
    context.group.generationType,
    context.group.generationStyle,
    ...(context.knowledgeSignals ?? []).flatMap((signal) => [signal.description, ...signal.tags]),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function limitSkillSection(
  section: DirectorSkillPromptSection,
  maxChars: number,
): DirectorSkillPromptSection {
  return {
    ...section,
    content: truncateText(section.content, maxChars),
  };
}

function readSkillIdFromSection(section: DirectorSkillPromptSection): string {
  const skillId = section.metadata?.skillId;
  if (typeof skillId === "string" && skillId.length > 0) {
    return skillId;
  }
  return section.id.startsWith("skill.") ? section.id.slice("skill.".length) : section.id;
}

function applySkillContextToExecutionPlan(
  executionPlan: ExecutionPlan,
  skillContext: DirectorSkillContext,
): ExecutionPlan {
  if (skillContext.sections.length === 0) {
    return executionPlan;
  }

  const skillBrief = skillContext.sharedConstraints.join("\n");
  const hidden = [executionPlan.prompt.hidden, skillBrief]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  return {
    ...executionPlan,
    prompt: {
      ...executionPlan.prompt,
      hidden,
      sections: [
        ...(executionPlan.prompt.sections ?? []),
        {
          id: "execution.skills",
          visibility: "hidden" as const,
          content: skillBrief,
        },
      ],
    },
  };
}

function prioritizeAdapters(
  allowedAdapters: readonly string[],
  preferredAdapterIds: readonly string[],
): string[] {
  if (preferredAdapterIds.length === 0) {
    return [...allowedAdapters];
  }

  const preferred = preferredAdapterIds.filter((adapterId) => allowedAdapters.includes(adapterId));
  const remaining = allowedAdapters.filter((adapterId) => !preferred.includes(adapterId));

  return dedupeStrings([...preferred, ...remaining]);
}

function applyRecallCrewContext(
  assignments: readonly CrewAssignment[],
  recallContext: MaterializedRecallContext,
): readonly CrewAssignment[] {
  if (recallContext.sharedInputs.length === 0 && recallContext.sharedConstraints.length === 0) {
    return assignments;
  }

  return assignments.map((assignment) => {
    const allowedAdapters =
      assignment.role === "asset-router"
        ? prioritizeAdapters(
            dedupeStrings([...assignment.allowedAdapters, ...recallContext.preferredAdapterIds]),
            recallContext.preferredAdapterIds,
          )
        : [...assignment.allowedAdapters];
    const sharedInputs =
      assignment.role === "researcher" || assignment.role === "script-planner"
        ? recallContext.sharedInputs
        : [];
    const sharedConstraints =
      assignment.role === "asset-router" || assignment.role === "qc-reviewer"
        ? recallContext.sharedConstraints
        : [];

    return {
      ...assignment,
      inputs: dedupeStrings([...assignment.inputs, ...sharedInputs]),
      constraints: dedupeStrings([...assignment.constraints, ...sharedConstraints]),
      allowedAdapters,
    };
  });
}

function applySkillCrewContext(
  assignments: readonly CrewAssignment[],
  skillContext: DirectorSkillContext,
): readonly CrewAssignment[] {
  if (skillContext.sharedInputs.length === 0 && skillContext.sharedConstraints.length === 0) {
    return assignments;
  }

  return assignments.map((assignment) => {
    const sharedInputs =
      assignment.role === "researcher" ||
      assignment.role === "script-planner" ||
      assignment.role === "shot-planner"
        ? skillContext.sharedInputs
        : [];
    const sharedConstraints =
      assignment.role === "script-planner" ||
      assignment.role === "shot-planner" ||
      assignment.role === "qc-reviewer"
        ? skillContext.sharedConstraints
        : [];

    return {
      ...assignment,
      inputs: dedupeStrings([...assignment.inputs, ...sharedInputs]),
      constraints: dedupeStrings([...assignment.constraints, ...sharedConstraints]),
    };
  });
}

function mergeDecisions(left: ReviewStatus, right: ReviewStatus): ReviewStatus {
  if (left === "block" || right === "block") {
    return "block";
  }
  if (left === "warn" || right === "warn") {
    return "warn";
  }
  return "pass";
}

function decisionToAssignmentStatus(decision: ReviewStatus): CrewAssignmentStatus {
  return decision === "block" ? "blocked" : decision === "warn" ? "awaiting_approval" : "ready";
}

function buildAuditTrail(
  normalizedInput: DirectorNormalizedInput,
  alignmentLock: AlignmentLock,
  actionGraph: ActionGraph,
  recallContext: MaterializedRecallContext,
  skillContext: DirectorSkillContext,
): readonly string[] {
  const executionRoutes = actionGraph.nodes
    .filter((node) => isExecutionHandoffCandidate(node) && node.selectedAdapter !== null)
    .map((node) => `${node.role}:${node.selectedAdapter}`);

  return dedupeStrings([
    `snapshot=${normalizedInput.snapshotId}`,
    `runtime=${normalizedInput.context.runtime.runtimeId}`,
    `alignment=${alignmentLock.status}`,
    `action-graph=${actionGraph.readiness}`,
    ...(executionRoutes.length === 0 ? [] : [`execution-routes=${executionRoutes.join(",")}`]),
    ...recallContext.auditTrail,
    ...skillContext.auditTrail,
    ...(normalizedInput.operatorId === null ? [] : [`operator=${normalizedInput.operatorId}`]),
  ]);
}

function readinessToDecision(readiness: ActionGraphReadiness): ReviewStatus {
  return readiness === "blocked" ? "block" : readiness === "review_required" ? "warn" : "pass";
}

function readinessToPlanStatus(
  readiness: ActionGraphReadiness,
): DirectorEvaluateResponse["plan"]["status"] {
  return readiness === "blocked"
    ? "blocked"
    : readiness === "review_required"
      ? "review_required"
      : "ready";
}

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildObservationId(
  source: "evaluation" | "outcome",
  primaryKey: string,
  secondaryKey: string,
): string {
  const sanitize = (value: string): string =>
    value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  return ["observation", source, sanitize(primaryKey), sanitize(secondaryKey)]
    .filter((segment) => segment.length > 0)
    .join("-");
}

function mapCoreCrewAssignments(
  assignments: readonly CoreCrewAssignment[],
  decision: ReviewStatus,
): readonly CrewAssignment[] {
  const baseStatus = decisionToAssignmentStatus(decision);

  return assignments.map((assignment) => ({
    assignmentId: assignment.assignmentId,
    role: assignment.role,
    objective: assignment.objective,
    assignedCapability: assignment.assignedCapability,
    inputs: assignment.inputs.map((input) => input.name),
    outputs: assignment.outputs.map((output) => output.name),
    deliverable: assignment.deliverable,
    acceptanceCriteria: [...assignment.acceptanceCriteria],
    constraints: [...assignment.constraints],
    dependsOn: [...assignment.dependsOn],
    allowedAdapters: dedupeStrings(assignment.allowedAdapters),
    actionClass: assignment.actionClass,
    approvalMode: assignment.approvalMode,
    budgetLimit: assignment.budgetLimit ?? 0,
    timeoutMs: assignment.timeoutMs,
    maxDelegationDepth: assignment.maxDelegationDepth,
    fallbackPolicy: `${assignment.fallbackPolicy.strategy}: ${assignment.fallbackPolicy.reason}`,
    escalationToDirector: `${assignment.escalationToDirector.action}: ${assignment.escalationToDirector.reason}`,
    selectedAdapter: assignment.allowedAdapters[0] ?? null,
    status:
      baseStatus === "blocked"
        ? "blocked"
        : assignment.role === "asset-router" && assignment.allowedAdapters.length === 0
          ? "blocked"
          : baseStatus,
    ...(assignment.role === "asset-router" && assignment.allowedAdapters.length === 0
      ? { blockingReason: "No eligible adapter matched the locked request." }
      : {}),
  }));
}
