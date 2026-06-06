export declare const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";
type StringRecord = Record<string, string>;
export declare const DIRECTOR_DECISIONS: readonly ["pass", "warn", "block"];
export declare const HOST_TRIGGER_SOURCES: readonly ["cli", "api", "shadow"];
export declare const BINDING_POLICIES: readonly ["auto", "prefer", "require"];
export declare const LOCK_LEVELS: readonly ["soft_lock", "hard_lock"];
export declare const DIRECTOR_GENERATION_STYLES: readonly ["standard", "immersive"];
export declare const DIRECTOR_GENERATION_TYPES: readonly ["new", "extend", "edit"];
export declare const RUNTIME_HEALTH_STATUSES: readonly ["ready", "degraded", "offline"];
export declare const DIRECTOR_RUNTIME_PREFLIGHT_STATUSES: readonly ["pass", "warn", "fail"];
export declare const DIRECTOR_RUNTIME_PREFLIGHT_READINESS: readonly [
  "ready",
  "needs-attention",
  "blocked",
];
export declare const DIRECTOR_RUNTIME_PREFLIGHT_ROUTE_METHODS: readonly ["GET", "POST"];
export declare const KNOWLEDGE_PACK_STAGES: readonly [
  "candidate",
  "review",
  "published",
  "rollback",
];
export declare const CONTINUITY_PRIORITIES: readonly ["low", "medium", "high"];
export declare const DETERMINISTIC_MODES: readonly ["safe", "balanced"];
export declare const DIRECTOR_CLARIFICATION_DECISIONS: readonly [
  "ready",
  "needs_clarification",
  "blocked",
];
export declare const ALIGNMENT_STATES: readonly ["pending", "locked", "blocked"];
export declare const ALIGNMENT_LOCK_STATES: readonly ["locked", "blocked"];
export declare const ALIGNMENT_CONSTRAINT_PRIORITIES: readonly ["required", "preferred"];
export declare const CLARIFICATION_ANSWER_KINDS: readonly [
  "text",
  "single_select",
  "multi_select",
  "boolean",
  "number",
  "artifact",
];
export declare const DIRECTOR_CREW_ROLES: readonly [
  "researcher",
  "script-planner",
  "shot-planner",
  "asset-router",
  "qc-reviewer",
];
export declare const DIRECTOR_ACTION_CLASSES: readonly ["read", "generate", "write", "publish"];
export declare const DIRECTOR_ACTION_NODE_STATUSES: readonly [
  "ready",
  "awaiting_approval",
  "blocked",
];
export declare const DIRECTOR_APPROVAL_MODES: readonly [
  "auto_allow",
  "operator_approve",
  "forbidden_in_beta1",
];
export declare const OPERATOR_OUTCOME_STATUSES: readonly [
  "accepted",
  "edited",
  "rejected",
  "abandoned",
];
export declare const ADAPTER_KINDS: readonly ["host", "media", "execution"];
export declare const RUNTIME_CAPABILITY_ADAPTER_BRIDGE_KINDS: readonly ["http-json"];
export declare const RUNTIME_CAPABILITY_ADAPTER_BRIDGE_AUTH_MODES: readonly [
  "none",
  "static",
  "env",
];
export declare const ARTIFACT_KINDS: readonly [
  "text",
  "image",
  "video",
  "audio",
  "document",
  "json",
];
export declare const ARTIFACT_SOURCES: readonly [
  "host_input",
  "user_upload",
  "workspace",
  "generated",
  "external_url",
  "inline",
];
export declare const MEDIA_EXECUTION_MODES: readonly [
  "text_to_image",
  "text_to_video",
  "image_to_video",
];
export declare const MEDIA_OUTPUT_ARTIFACT_KINDS: readonly ["image", "video"];
export declare const COST_CLASSES: readonly ["low", "medium", "high", "premium"];
export declare const LATENCY_CLASSES: readonly ["interactive", "batch", "slow"];
export declare const SAFETY_TIERS: readonly ["standard", "restricted", "strict"];
export declare const CAPABILITY_MATCH_STATUSES: readonly [
  "matched",
  "partial",
  "blocked",
  "no_match",
];
export declare const MEDIA_EXECUTION_STATUSES: readonly [
  "accepted",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
];
export declare const MEDIA_FAILURE_CATEGORIES: readonly [
  "validation",
  "routing",
  "adapter_unavailable",
  "provider_error",
  "timeout",
  "policy_blocked",
  "unknown",
];
export type DirectorDecision = (typeof DIRECTOR_DECISIONS)[number];
export type HostTriggerSource = (typeof HOST_TRIGGER_SOURCES)[number];
export type BindingPolicy = (typeof BINDING_POLICIES)[number];
export type LockLevel = (typeof LOCK_LEVELS)[number];
export type DirectorGenerationStyle = (typeof DIRECTOR_GENERATION_STYLES)[number];
export type DirectorGenerationType = (typeof DIRECTOR_GENERATION_TYPES)[number];
export type RuntimeHealthStatus = (typeof RUNTIME_HEALTH_STATUSES)[number];
export type DirectorRuntimePreflightStatus = (typeof DIRECTOR_RUNTIME_PREFLIGHT_STATUSES)[number];
export type DirectorRuntimePreflightReadiness =
  (typeof DIRECTOR_RUNTIME_PREFLIGHT_READINESS)[number];
export type DirectorRuntimePreflightRouteMethod =
  (typeof DIRECTOR_RUNTIME_PREFLIGHT_ROUTE_METHODS)[number];
export type KnowledgePackStage = (typeof KNOWLEDGE_PACK_STAGES)[number];
export type ContinuityPriority = (typeof CONTINUITY_PRIORITIES)[number];
export type DeterministicMode = (typeof DETERMINISTIC_MODES)[number];
export type DirectorClarificationDecision = (typeof DIRECTOR_CLARIFICATION_DECISIONS)[number];
export type AlignmentState = (typeof ALIGNMENT_STATES)[number];
export type AlignmentLockState = (typeof ALIGNMENT_LOCK_STATES)[number];
export type AlignmentConstraintPriority = (typeof ALIGNMENT_CONSTRAINT_PRIORITIES)[number];
export type ClarificationAnswerKind = (typeof CLARIFICATION_ANSWER_KINDS)[number];
export type DirectorCrewRole = (typeof DIRECTOR_CREW_ROLES)[number];
export type DirectorActionClass = (typeof DIRECTOR_ACTION_CLASSES)[number];
export type DirectorActionNodeStatus = (typeof DIRECTOR_ACTION_NODE_STATUSES)[number];
export type DirectorApprovalMode = (typeof DIRECTOR_APPROVAL_MODES)[number];
export type OperatorOutcomeStatus = (typeof OPERATOR_OUTCOME_STATUSES)[number];
export type AdapterKind = (typeof ADAPTER_KINDS)[number];
export type RuntimeCapabilityAdapterBridgeKind =
  (typeof RUNTIME_CAPABILITY_ADAPTER_BRIDGE_KINDS)[number];
export type RuntimeCapabilityAdapterBridgeAuthMode =
  (typeof RUNTIME_CAPABILITY_ADAPTER_BRIDGE_AUTH_MODES)[number];
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number];
export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];
export type MediaOutputArtifactKind = (typeof MEDIA_OUTPUT_ARTIFACT_KINDS)[number];
export type CostClass = (typeof COST_CLASSES)[number];
export type LatencyClass = (typeof LATENCY_CLASSES)[number];
export type SafetyTier = (typeof SAFETY_TIERS)[number];
export type CapabilityMatchStatus = (typeof CAPABILITY_MATCH_STATUSES)[number];
export type MediaExecutionStatus = (typeof MEDIA_EXECUTION_STATUSES)[number];
export type MediaFailureCategory = (typeof MEDIA_FAILURE_CATEGORIES)[number];
export interface HostProjectSnapshot {
  projectId: string;
  title?: string;
  outline?: string;
  genre?: string[];
  continuityPriority?: ContinuityPriority;
}
export interface HostGroupSnapshot {
  groupId: string;
  generationStyle?: DirectorGenerationStyle;
  generationType: DirectorGenerationType;
  sceneCount: number;
  anchorIds: string[];
  totalDurationSeconds?: number;
}
export interface HostRuntimeState {
  runtimeId: string;
  status: RuntimeHealthStatus;
  availableBindings: string[];
  maxPromptChars: number;
  supportsVideo: boolean;
  deterministicMode?: DeterministicMode;
}
export interface HostExecutionIntent {
  bindingPolicy: BindingPolicy;
  preferredImageBinding?: string;
  preferredVideoBinding?: string;
  requiredImageBinding?: string;
  requiredVideoBinding?: string;
  fallbackBindings?: string[];
}
export interface HostFieldLock {
  field: string;
  level: LockLevel;
  reason?: string;
}
export interface HostKnowledgeSignal {
  id: string;
  description: string;
  confidence: number;
  tags?: string[];
}
export interface DirectorHostSnapshotEnvelope {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  schemaId: string;
  snapshotId: string;
  createdAt: string;
  host: {
    hostId: string;
    triggerSource: HostTriggerSource;
    sessionId?: string;
  };
  project: HostProjectSnapshot;
  group: HostGroupSnapshot;
  runtime: HostRuntimeState;
  intent: HostExecutionIntent;
  locks?: {
    lockedFields: HostFieldLock[];
  };
  knowledgeSignals?: HostKnowledgeSignal[];
  metadata?: StringRecord;
}
export interface DirectorEvaluateRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshot: DirectorHostSnapshotEnvelope;
  operatorId?: string;
}
export interface DirectorPlanSummary {
  planId: string;
  status: "ready" | "review_required" | "blocked";
  summary: string;
  confidence: number;
  selectedGenerationStyle: DirectorGenerationStyle;
  selectedImageBinding: string | null;
  selectedVideoBinding: string | null;
  riskFlags: string[];
}
export interface DirectorExecutionSummary {
  executionId: string;
  selectedGenerationType: DirectorGenerationType;
  selectedGenerationStyle: DirectorGenerationStyle;
  visiblePrompt: string;
}
export interface DirectorReviewSummary {
  overallDecision: DirectorDecision;
  blockingReasons: string[];
  requiredFixes: string[];
  warnings?: string[];
}
export interface DirectorEvaluateResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshotId: string;
  runtimeId: string;
  decision: DirectorDecision;
  summary: string;
  recommendations: string[];
  plan: DirectorPlanSummary;
  execution: DirectorExecutionSummary;
  review: DirectorReviewSummary;
}
export interface DirectorRuntimeResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  runtimeId: string;
  status: RuntimeHealthStatus;
  workspaceRoot: string;
  dataDir: string;
  defaultProvider: string;
  defaultModel: string;
  availableProviders: string[];
  knowledgePackCount: number;
  notes: string[];
}
export interface DirectorRuntimePreflightSurface {
  status: DirectorRuntimePreflightStatus;
  summaryText: string;
}
export interface DirectorRuntimePreflightAdapterCounts {
  total: number;
  host: number;
  media: number;
  execution: number;
  enabled: number;
  ready: number;
  degraded: number;
  offline: number;
  mockOnly: number;
  dryRunSupported: number;
}
export interface DirectorRuntimePreflightAdapterSurface extends DirectorRuntimePreflightSurface {
  counts: DirectorRuntimePreflightAdapterCounts;
}
export interface DirectorRuntimePreflightRouteHint {
  method: DirectorRuntimePreflightRouteMethod;
  path: string;
}
export interface DirectorRuntimePreflightResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  runtimeId: string;
  status: DirectorRuntimePreflightStatus;
  readiness: DirectorRuntimePreflightReadiness;
  summaryText: string;
  recommendedAction: string;
  recommendedCommand?: string;
  recommendedRoute?: DirectorRuntimePreflightRouteHint;
  commands: string[];
  notes: string[];
  surfaces: {
    runtime: DirectorRuntimePreflightSurface;
    adapters: DirectorRuntimePreflightAdapterSurface;
  };
}
export interface DirectorKnowledgePackCatalogRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  includeDraft?: boolean;
}
export interface DirectorKnowledgePackCatalogEntry {
  id: string;
  title: string;
  version: number;
  stage: KnowledgePackStage;
  createdAt: string;
  description?: string;
  tags?: string[];
}
export interface DirectorKnowledgePackCatalogResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  knowledgePacks: DirectorKnowledgePackCatalogEntry[];
}
export interface DirectorAlignmentConstraint {
  field: string;
  requirement: string;
  priority: AlignmentConstraintPriority;
  rationale?: string;
}
export interface ArtifactRef {
  artifactId: string;
  kind: ArtifactKind;
  source: ArtifactSource;
  title?: string;
  uri?: string;
  path?: string;
  inlineText?: string;
  mimeType?: string;
  format?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
  checksum?: string;
  metadata?: StringRecord;
}
export interface DirectorIntakePayload {
  intakeId: string;
  submittedAt: string;
  objective: string;
  desiredOutcome?: string;
  deliverables?: string[];
  audience?: string;
  styleNotes?: string[];
  constraints?: DirectorAlignmentConstraint[];
  nonGoals?: string[];
  references?: ArtifactRef[];
  notes?: string[];
  metadata?: StringRecord;
}
export interface DirectorClarificationQuestionOption {
  value: string;
  label: string;
  description?: string;
}
export interface DirectorClarificationQuestion {
  questionId: string;
  prompt: string;
  rationale?: string;
  required: boolean;
  answerKind: ClarificationAnswerKind;
  affectsFields: string[];
  options?: DirectorClarificationQuestionOption[];
}
export interface DirectorClarificationAssessment {
  decision: DirectorClarificationDecision;
  summary: string;
  missingFields: string[];
  conflictingFields: string[];
  questions: DirectorClarificationQuestion[];
}
export interface DirectorClarificationAnswer {
  questionId: string;
  text?: string;
  values?: string[];
  booleanValue?: boolean;
  numberValue?: number;
  artifacts?: ArtifactRef[];
}
export interface AlignmentLock {
  lockId: string;
  sourceIntakeId: string;
  state: AlignmentLockState;
  lockedAt: string;
  objective: string;
  desiredOutcome?: string;
  deliverables: string[];
  lockedConstraints: DirectorAlignmentConstraint[];
  lockedFields: HostFieldLock[];
  answeredQuestionIds?: string[];
  nonGoals?: string[];
  notes?: string[];
}
export interface DirectorBudgetLimit {
  currency?: string;
  maxCost?: number;
  costClass?: CostClass;
}
export interface AdapterProfileRef {
  adapterId: string;
  profileId: string;
  displayName?: string;
}
export interface MediaOutputContract {
  artifactKind: MediaOutputArtifactKind;
  count?: number;
  format?: string;
  aspectRatio?: string;
  resolution?: string;
  maxDurationSec?: number;
}
export interface MediaExecutionRequest {
  requestId: string;
  mode: MediaExecutionMode;
  objective: string;
  prompt?: string;
  requiredCapabilities: string[];
  preferredCapabilities?: string[];
  lockedConstraints?: DirectorAlignmentConstraint[];
  inputArtifacts: ArtifactRef[];
  outputContract: MediaOutputContract;
  budgetLimit?: DirectorBudgetLimit;
  deadlineAt?: string;
  idempotencyKey: string;
  profileRef?: AdapterProfileRef;
  metadata?: StringRecord;
}
export interface MediaExecutionJobHandle {
  adapterId: string;
  providerJobId?: string;
  statusUrl?: string;
  cancelToken?: string;
}
export interface MediaExecutionAuditEntry {
  at: string;
  event: string;
  message: string;
}
export interface MediaExecutionReceipt {
  receiptId: string;
  requestId: string;
  status: MediaExecutionStatus;
  jobHandle: MediaExecutionJobHandle;
  artifacts: ArtifactRef[];
  warnings: string[];
  failureCategory?: MediaFailureCategory;
  retryable?: boolean;
  auditTrail: MediaExecutionAuditEntry[];
}
export interface MediaCapabilityProfile {
  adapterId: string;
  adapterKind: "media";
  provider: string;
  modelFamily?: string;
  modelVersion?: string;
  capabilityVersion?: string;
  supportedModes: MediaExecutionMode[];
  inputModalities: ArtifactKind[];
  outputArtifactTypes: MediaOutputArtifactKind[];
  supportsAsync: boolean;
  supportsWebhook?: boolean;
  maxDurationSec?: number;
  supportedAspectRatios?: string[];
  supportedResolutions?: string[];
  supportsReferenceImage?: boolean;
  supportsMultiImage?: boolean;
  supportsAudioConditioning?: boolean;
  costClass?: CostClass;
  latencyClass?: LatencyClass;
  safetyTier?: SafetyTier;
  regionOrDataPolicy?: string;
  healthStatus: RuntimeHealthStatus;
}
export interface RuntimeCapabilityAdapter {
  adapterId: string;
  adapterKind: AdapterKind;
  provider: string;
  enabled: boolean;
  healthStatus: RuntimeHealthStatus;
  dryRunSupported: boolean;
  mockOnly: boolean;
  bridge?: RuntimeCapabilityAdapterBridge;
  supportedActionClasses?: DirectorActionClass[];
  availableProfiles?: AdapterProfileRef[];
  mediaCapability?: MediaCapabilityProfile;
  notes?: string[];
}
export interface RuntimeCapabilityAdapterBridge {
  kind: RuntimeCapabilityAdapterBridgeKind;
  endpointOrigin: string;
  endpointPath: string;
  authMode: RuntimeCapabilityAdapterBridgeAuthMode;
  timeoutMs: number;
  headerKeys?: string[];
}
export interface RuntimeCapabilitySnapshot {
  snapshotId: string;
  runtimeId: string;
  capturedAt: string;
  status: RuntimeHealthStatus;
  adapters: RuntimeCapabilityAdapter[];
  notes?: string[];
}
export interface DirectorRuntimeCapabilitySnapshotRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  runtimeId: string;
  hostId?: string;
  sessionId?: string;
  adapterKinds?: AdapterKind[];
  includeDisabled?: boolean;
  includeMockOnly?: boolean;
}
export interface DirectorRuntimeCapabilitySnapshotResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  runtimeId: string;
  capabilitySnapshot: RuntimeCapabilitySnapshot;
}
export interface CapabilityMatchResult {
  matchId: string;
  assignmentId: string;
  status: CapabilityMatchStatus;
  chosenAdapterId?: string;
  reasons: string[];
  missingCapabilities?: string[];
}
export interface DirectorActionNode {
  nodeId: string;
  assignmentId: string;
  role: DirectorCrewRole;
  objective: string;
  assignedCapability?: string;
  inputs: string[];
  outputs: string[];
  deliverable: string;
  acceptanceCriteria: string[];
  constraints: DirectorAlignmentConstraint[];
  dependsOn: string[];
  allowedAdapters: string[];
  actionClass: DirectorActionClass;
  approvalMode: DirectorApprovalMode;
  budgetLimit?: DirectorBudgetLimit;
  timeoutMs?: number;
  maxDelegationDepth?: number;
  fallbackPolicy?: string;
  escalationToDirector: boolean;
  status?: DirectorActionNodeStatus;
  selectedAdapter?: string | null;
  blockingReason?: string;
}
export interface DirectorActionEdge {
  fromNodeId: string;
  toNodeId: string;
  artifactId?: string;
  handoffContract: string;
  blocking: boolean;
}
export interface DirectorActionGraph {
  graphId: string;
  blueprintId: string;
  goal: string;
  nodes: DirectorActionNode[];
  edges: DirectorActionEdge[];
  stopConditions: string[];
}
export interface DirectorOperatorPreview {
  previewId: string;
  summary: string;
  warnings: string[];
  blockedReasons: string[];
  requiredApprovals: string[];
}
export interface ExecutionHandoffEnvelope {
  handoffId: string;
  blueprintId: string;
  createdAt: string;
  alignmentLockId: string;
  actionGraphId: string;
  previewSummary: string;
  capabilityMatches: CapabilityMatchResult[];
  mediaRequests: MediaExecutionRequest[];
  expectedArtifacts: ArtifactRef[];
  chosenAdapters: string[];
  sideEffectsAllowed: boolean;
  notes?: string[];
}
export interface OperatorOutcome {
  outcomeId: string;
  status: OperatorOutcomeStatus;
  recordedAt: string;
  operatorId?: string;
  notes?: string;
  editedFieldPaths?: string[];
  acceptedArtifacts?: ArtifactRef[];
  rejectionReasons?: string[];
}
export interface DirectorIntakeRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshot: DirectorHostSnapshotEnvelope;
  intake: DirectorIntakePayload;
  operatorId?: string;
}
export interface DirectorIntakeResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshotId: string;
  runtimeId: string;
  intakeId: string;
  capabilitySnapshot: RuntimeCapabilitySnapshot;
  clarification: DirectorClarificationAssessment;
  alignmentState: AlignmentState;
  alignmentLock: AlignmentLock | null;
}
export interface DirectorClarifyRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshot: DirectorHostSnapshotEnvelope;
  intake: DirectorIntakePayload;
  answers: DirectorClarificationAnswer[];
  operatorId?: string;
}
export interface DirectorClarifyResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshotId: string;
  runtimeId: string;
  intakeId: string;
  clarification: DirectorClarificationAssessment;
  alignmentState: AlignmentState;
  alignmentLock: AlignmentLock | null;
}
export interface DirectorBlueprintRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshot: DirectorHostSnapshotEnvelope;
  intake: DirectorIntakePayload;
  alignmentLock: AlignmentLock;
  capabilitySnapshot?: RuntimeCapabilitySnapshot;
  operatorId?: string;
}
export interface DirectorBlueprintResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshotId: string;
  runtimeId: string;
  blueprintId: string;
  review: DirectorReviewSummary;
  capabilitySnapshot: RuntimeCapabilitySnapshot;
  actionGraph: DirectorActionGraph;
  preview: DirectorOperatorPreview;
  handoff: ExecutionHandoffEnvelope;
}
export interface DirectorOutcomeRequest {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshotId: string;
  blueprintId: string;
  handoffId: string;
  outcome: OperatorOutcome;
}
export interface DirectorOutcomeResponse {
  apiVersion: typeof DIRECTOR_HOST_API_VERSION;
  snapshotId: string;
  blueprintId: string;
  handoffId: string;
  stored: boolean;
  outcome: OperatorOutcome;
}
export declare function isDirectorApiVersion(
  value: unknown,
): value is typeof DIRECTOR_HOST_API_VERSION;
export declare function isArtifactRef(value: unknown): value is ArtifactRef;
export declare function isDirectorIntakePayload(value: unknown): value is DirectorIntakePayload;
export declare function isDirectorClarificationAssessment(
  value: unknown,
): value is DirectorClarificationAssessment;
export declare function isAlignmentLock(value: unknown): value is AlignmentLock;
export declare function isMediaExecutionRequest(value: unknown): value is MediaExecutionRequest;
export declare function isMediaExecutionReceipt(value: unknown): value is MediaExecutionReceipt;
export declare function isRuntimeCapabilitySnapshot(
  value: unknown,
): value is RuntimeCapabilitySnapshot;
export declare function isDirectorRuntimeCapabilitySnapshotRequest(
  value: unknown,
): value is DirectorRuntimeCapabilitySnapshotRequest;
export declare function isDirectorRuntimeCapabilitySnapshotResponse(
  value: unknown,
): value is DirectorRuntimeCapabilitySnapshotResponse;
export declare function isDirectorActionGraph(value: unknown): value is DirectorActionGraph;
export declare function isExecutionHandoffEnvelope(
  value: unknown,
): value is ExecutionHandoffEnvelope;
export declare function isOperatorOutcome(value: unknown): value is OperatorOutcome;
export declare function isDirectorHostSnapshotEnvelope(
  value: unknown,
): value is DirectorHostSnapshotEnvelope;
export declare function isDirectorEvaluateRequest(value: unknown): value is DirectorEvaluateRequest;
export declare function isDirectorEvaluateResponse(
  value: unknown,
): value is DirectorEvaluateResponse;
export declare function isDirectorRuntimeResponse(value: unknown): value is DirectorRuntimeResponse;
export declare function isDirectorRuntimePreflightResponse(
  value: unknown,
): value is DirectorRuntimePreflightResponse;
export declare function isDirectorKnowledgePackCatalogRequest(
  value: unknown,
): value is DirectorKnowledgePackCatalogRequest;
export declare function isDirectorKnowledgePackCatalogResponse(
  value: unknown,
): value is DirectorKnowledgePackCatalogResponse;
export declare function isDirectorIntakeRequest(value: unknown): value is DirectorIntakeRequest;
export declare function isDirectorIntakeResponse(value: unknown): value is DirectorIntakeResponse;
export declare function isDirectorClarifyRequest(value: unknown): value is DirectorClarifyRequest;
export declare function isDirectorClarifyResponse(value: unknown): value is DirectorClarifyResponse;
export declare function isDirectorBlueprintRequest(
  value: unknown,
): value is DirectorBlueprintRequest;
export declare function isDirectorBlueprintResponse(
  value: unknown,
): value is DirectorBlueprintResponse;
export declare function isDirectorOutcomeRequest(value: unknown): value is DirectorOutcomeRequest;
export declare function isDirectorOutcomeResponse(value: unknown): value is DirectorOutcomeResponse;
export declare class DirectorContractValidationError extends TypeError {
  constructor(expectedType: string);
}
export declare function assertDirectorHostSnapshotEnvelope(
  value: unknown,
): asserts value is DirectorHostSnapshotEnvelope;
export declare function assertDirectorEvaluateRequest(
  value: unknown,
): asserts value is DirectorEvaluateRequest;
export declare function assertDirectorEvaluateResponse(
  value: unknown,
): asserts value is DirectorEvaluateResponse;
export declare function assertDirectorRuntimeResponse(
  value: unknown,
): asserts value is DirectorRuntimeResponse;
export declare function assertDirectorRuntimePreflightResponse(
  value: unknown,
): asserts value is DirectorRuntimePreflightResponse;
export declare function assertDirectorKnowledgePackCatalogRequest(
  value: unknown,
): asserts value is DirectorKnowledgePackCatalogRequest;
export declare function assertDirectorKnowledgePackCatalogResponse(
  value: unknown,
): asserts value is DirectorKnowledgePackCatalogResponse;
export declare function assertArtifactRef(value: unknown): asserts value is ArtifactRef;
export declare function assertDirectorIntakePayload(
  value: unknown,
): asserts value is DirectorIntakePayload;
export declare function assertDirectorClarificationAssessment(
  value: unknown,
): asserts value is DirectorClarificationAssessment;
export declare function assertAlignmentLock(value: unknown): asserts value is AlignmentLock;
export declare function assertMediaExecutionRequest(
  value: unknown,
): asserts value is MediaExecutionRequest;
export declare function assertMediaExecutionReceipt(
  value: unknown,
): asserts value is MediaExecutionReceipt;
export declare function assertRuntimeCapabilitySnapshot(
  value: unknown,
): asserts value is RuntimeCapabilitySnapshot;
export declare function assertDirectorRuntimeCapabilitySnapshotRequest(
  value: unknown,
): asserts value is DirectorRuntimeCapabilitySnapshotRequest;
export declare function assertDirectorRuntimeCapabilitySnapshotResponse(
  value: unknown,
): asserts value is DirectorRuntimeCapabilitySnapshotResponse;
export declare function assertDirectorActionGraph(
  value: unknown,
): asserts value is DirectorActionGraph;
export declare function assertExecutionHandoffEnvelope(
  value: unknown,
): asserts value is ExecutionHandoffEnvelope;
export declare function assertOperatorOutcome(value: unknown): asserts value is OperatorOutcome;
export declare function assertDirectorIntakeRequest(
  value: unknown,
): asserts value is DirectorIntakeRequest;
export declare function assertDirectorIntakeResponse(
  value: unknown,
): asserts value is DirectorIntakeResponse;
export declare function assertDirectorClarifyRequest(
  value: unknown,
): asserts value is DirectorClarifyRequest;
export declare function assertDirectorClarifyResponse(
  value: unknown,
): asserts value is DirectorClarifyResponse;
export declare function assertDirectorBlueprintRequest(
  value: unknown,
): asserts value is DirectorBlueprintRequest;
export declare function assertDirectorBlueprintResponse(
  value: unknown,
): asserts value is DirectorBlueprintResponse;
export declare function assertDirectorOutcomeRequest(
  value: unknown,
): asserts value is DirectorOutcomeRequest;
export declare function assertDirectorOutcomeResponse(
  value: unknown,
): asserts value is DirectorOutcomeResponse;
//# sourceMappingURL=types.d.ts.map
