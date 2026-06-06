import type {
  RuntimeCapabilitySnapshot as CoreRuntimeCapabilitySnapshot,
  DirectorContext,
  DirectorPlan,
  ExecutionPlan,
  ReviewReport,
  ReviewStatus,
} from "@hotflow/director-core";
import type {
  DirectorEvaluateRequest,
  DirectorEvaluateResponse,
  DirectorKnowledgePackCatalogRequest,
  DirectorKnowledgePackCatalogResponse,
  DirectorOutcomeRequest,
  DirectorRuntimeResponse,
} from "@hotflow/director-host-contracts";
import type {
  DirectorKnowledgePackDocument,
  DirectorKnowledgeRecallPacket,
} from "@hotflow/director-knowledge";
import type {
  DirectorMemoryRecallResult,
  DirectorObservationEnvelope,
  LearningObservationSink,
  MemoryRecallPort,
} from "@hotflow/director-runtime";
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
export interface DirectorServiceOptions {
  knowledgeStore?: KnowledgeStorePort;
  knowledgeRecall?: {
    enabled?: boolean;
    maxHits?: number;
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
export declare class DirectorService {
  private readonly options;
  constructor(options?: DirectorServiceOptions);
  evaluateSnapshot(request: DirectorEvaluateRequest): Promise<DirectorEvaluationResult>;
  recordOutcome(
    request: DirectorOutcomeRequest,
    input: {
      runtimeId: string;
    },
  ): Promise<DirectorRecordedOutcome>;
  listKnowledgePacks(
    _request?: DirectorKnowledgePackCatalogRequest,
  ): Promise<DirectorKnowledgePackCatalogResponse>;
  getRuntimeSummary(input: DirectorRuntimeSummaryInput): Promise<DirectorRuntimeResponse>;
  private nowIso;
  private recallMemory;
  private buildWorkingContext;
  private buildRecallHints;
  private buildEvaluationObservation;
  private buildOutcomeObservation;
  private appendObservation;
  private normalizeInput;
  private recallPublishedKnowledge;
  private buildPublishedKnowledgeRecallQuery;
  private captureRuntimeCapabilitySnapshot;
  private assessAlignment;
  private lockAlignment;
  private buildReview;
  private buildCrewAssignments;
  private buildActionGraph;
  private buildExecutionHandoffEnvelope;
  private toEvaluateResponse;
  private listRuntimeAdapters;
  private resolveRuntimeSwitches;
  private matchRuntimeAdapters;
  private toKnowledgePackEntry;
}
//# sourceMappingURL=service.d.ts.map
