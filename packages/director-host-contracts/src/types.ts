export const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";

type StringRecord = Record<string, string>;
type UnknownRecord = Record<string, unknown>;
type Guard<T> = (value: unknown) => value is T;

export const DIRECTOR_DECISIONS = ["pass", "warn", "block"] as const;
export const HOST_TRIGGER_SOURCES = ["cli", "api", "shadow"] as const;
export const BINDING_POLICIES = ["auto", "prefer", "require"] as const;
export const LOCK_LEVELS = ["soft_lock", "hard_lock"] as const;
export const DIRECTOR_GENERATION_STYLES = ["standard", "immersive"] as const;
export const DIRECTOR_GENERATION_TYPES = ["new", "extend", "edit"] as const;
export const RUNTIME_HEALTH_STATUSES = ["ready", "degraded", "offline"] as const;
export const DIRECTOR_RUNTIME_PREFLIGHT_STATUSES = ["pass", "warn", "fail"] as const;
export const DIRECTOR_RUNTIME_PREFLIGHT_READINESS = [
  "ready",
  "needs-attention",
  "blocked",
] as const;
export const DIRECTOR_RUNTIME_PREFLIGHT_ROUTE_METHODS = ["GET", "POST"] as const;
export const KNOWLEDGE_PACK_STAGES = ["candidate", "review", "published", "rollback"] as const;
export const CONTINUITY_PRIORITIES = ["low", "medium", "high"] as const;
export const DETERMINISTIC_MODES = ["safe", "balanced"] as const;
export const DIRECTOR_CLARIFICATION_DECISIONS = [
  "ready",
  "needs_clarification",
  "blocked",
] as const;
export const ALIGNMENT_STATES = ["pending", "locked", "blocked"] as const;
export const ALIGNMENT_LOCK_STATES = ["locked", "blocked"] as const;
export const ALIGNMENT_CONSTRAINT_PRIORITIES = ["required", "preferred"] as const;
export const CLARIFICATION_ANSWER_KINDS = [
  "text",
  "single_select",
  "multi_select",
  "boolean",
  "number",
  "artifact",
] as const;
export const DIRECTOR_CREW_ROLES = [
  "researcher",
  "script-planner",
  "shot-planner",
  "asset-router",
  "qc-reviewer",
] as const;
export const DIRECTOR_ACTION_CLASSES = ["read", "generate", "write", "publish"] as const;
export const DIRECTOR_ACTION_NODE_STATUSES = ["ready", "awaiting_approval", "blocked"] as const;
export const DIRECTOR_APPROVAL_MODES = [
  "auto_allow",
  "operator_approve",
  "forbidden_in_beta1",
] as const;
export const OPERATOR_OUTCOME_STATUSES = ["accepted", "edited", "rejected", "abandoned"] as const;
export const ADAPTER_KINDS = ["host", "media", "execution"] as const;
export const RUNTIME_CAPABILITY_ADAPTER_BRIDGE_KINDS = ["http-json"] as const;
export const RUNTIME_CAPABILITY_ADAPTER_BRIDGE_AUTH_MODES = ["none", "static", "env"] as const;
export const ADAPTER_RISK_LEVELS = ["low", "medium", "high"] as const;
export const ARTIFACT_KINDS = ["text", "image", "video", "audio", "document", "json"] as const;
export const ARTIFACT_SOURCES = [
  "host_input",
  "user_upload",
  "workspace",
  "generated",
  "external_url",
  "inline",
] as const;
export const MEDIA_EXECUTION_MODES = ["text_to_image", "text_to_video", "image_to_video"] as const;
export const MEDIA_OUTPUT_ARTIFACT_KINDS = ["image", "video"] as const;
export const COST_CLASSES = ["low", "medium", "high", "premium"] as const;
export const LATENCY_CLASSES = ["interactive", "batch", "slow"] as const;
export const SAFETY_TIERS = ["standard", "restricted", "strict"] as const;
export const CAPABILITY_MATCH_STATUSES = ["matched", "partial", "blocked", "no_match"] as const;
export const MEDIA_EXECUTION_STATUSES = [
  "accepted",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
] as const;
export const MEDIA_FAILURE_CATEGORIES = [
  "validation",
  "routing",
  "adapter_unavailable",
  "provider_error",
  "timeout",
  "policy_blocked",
  "unknown",
] as const;
export const DIRECTOR_HOST_AGENT_OS_SUBAGENT_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export const DIRECTOR_HOST_AGENT_OS_SUBAGENT_ROLES = [
  "explore",
  "plan",
  "verify",
  "general",
] as const;
export const DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_STATUSES = [
  "pending",
  "passed",
  "failed",
  "partial",
] as const;
export const DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_VERDICTS = [
  "pass",
  "fail",
  "partial",
] as const;

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
export type AdapterRiskLevel = (typeof ADAPTER_RISK_LEVELS)[number];
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
export type DirectorHostAgentOsSubagentRunStatus =
  (typeof DIRECTOR_HOST_AGENT_OS_SUBAGENT_RUN_STATUSES)[number];
export type DirectorHostAgentOsSubagentRole =
  (typeof DIRECTOR_HOST_AGENT_OS_SUBAGENT_ROLES)[number];
export type DirectorHostAgentOsSubagentVerificationStatus =
  (typeof DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_STATUSES)[number];
export type DirectorHostAgentOsSubagentVerificationVerdict =
  (typeof DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_VERDICTS)[number];

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
  riskLevel?: AdapterRiskLevel;
  approvalMode?: DirectorApprovalMode;
  permissionScopes?: string[];
  dataRetentionPolicy?: string;
  rateLimitPolicy?: string;
  budgetPolicy?: string;
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
  agentOsProcessCapabilityLedger?: DirectorHostAgentOsProcessCapabilityLedgerSummary;
  agentOsExtensionMatrix?: DirectorHostAgentOsExtensionMatrix;
  agentOsSubagentRuns?: DirectorHostAgentOsSubagentRunProjection;
}

export interface DirectorHostAgentOsSubagentRunProjection {
  summary: DirectorHostAgentOsSubagentRunSummary;
  entries: readonly DirectorHostAgentOsSubagentRunEntry[];
  schedulerHeartbeat?: DirectorHostAgentOsSubagentSchedulerHeartbeat;
  schedulerDispatchPlan?: DirectorHostAgentOsSubagentSchedulerDispatchPlan;
  schedulerTick?: DirectorHostAgentOsSubagentSchedulerTick;
  schedulerRecoveryPlan?: DirectorHostAgentOsSubagentSchedulerRecoveryPlan;
}

export interface DirectorHostAgentOsSubagentRunSummary {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  verifiedPass: number;
  verifiedFail: number;
  verifiedPartial: number;
}

export type DirectorHostAgentOsSubagentSchedulerStoppedReason =
  | "ready"
  | "scheduler-blocked"
  | "mailbox-empty";

export interface DirectorHostAgentOsSubagentSchedulerHeartbeat {
  schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1";
  parentTurnId?: string;
  totalSubagentRuns: number;
  queuedCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  schedulerTrackedCount: number;
  readyCount: number;
  blockedCount: number;
  unscheduledQueuedCount: number;
  nextReadySubagentIds: readonly string[];
  blockedSubagentIds: readonly string[];
  runningSubagentIds: readonly string[];
  nextParallelBatch?: number;
  canContinue: boolean;
  stoppedReason: DirectorHostAgentOsSubagentSchedulerStoppedReason;
  heartbeatOrdinal: number;
  latestUpdatedAtMs?: number;
}

export type DirectorHostAgentOsSubagentSchedulerDispatchReason =
  | "ready"
  | "scheduler-blocked"
  | "mailbox-empty";

export interface DirectorHostAgentOsSubagentSchedulerDispatchWriteSet {
  subagentId: string;
  writeSet: readonly string[];
  writeSetSource?: "explicit" | "inferred";
}

export interface DirectorHostAgentOsSubagentSchedulerDispatchBatch {
  parallelBatch: number;
  subagentIds: readonly string[];
  workerIds: readonly string[];
  writeSets: readonly DirectorHostAgentOsSubagentSchedulerDispatchWriteSet[];
}

export interface DirectorHostAgentOsSubagentSchedulerDispatchPlan {
  schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1";
  parentTurnId?: string;
  planOrdinal: number;
  heartbeatOrdinal: number;
  canDispatch: boolean;
  dispatchReason: DirectorHostAgentOsSubagentSchedulerDispatchReason;
  maxDispatchableCount: number;
  dispatchableSubagentIds: readonly string[];
  dispatchBatches: readonly DirectorHostAgentOsSubagentSchedulerDispatchBatch[];
  blockedSubagentIds: readonly string[];
  runningSubagentIds: readonly string[];
}

export interface DirectorHostAgentOsSubagentSchedulerTickIntent {
  intentId: string;
  delegationId: string;
  workerId: string;
  command: "run-delegation";
  argv: readonly string[];
  parallelBatch: number;
  writeSet: readonly string[];
  writeSetSource?: "explicit" | "inferred";
}

export interface DirectorHostAgentOsSubagentSchedulerTick {
  schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1";
  sessionId: string;
  latestTurnId: string | null;
  dispatchIntents: readonly DirectorHostAgentOsSubagentSchedulerTickIntent[];
  claimDryRun: true;
}

export type DirectorHostAgentOsSubagentSchedulerRecoveryActionType =
  | "wait-for-running-subagent"
  | "review-observed-write-set";

export type DirectorHostAgentOsSubagentSchedulerRecoverySeverity = "info" | "warning";

export interface DirectorHostAgentOsSubagentSchedulerRecoveryEvidence {
  blockedBy: readonly string[];
  conflictsWith: readonly string[];
  observedConflictWith?: readonly string[];
}

export interface DirectorHostAgentOsSubagentSchedulerRecoveryAction {
  actionId: string;
  subagentId: string;
  actionType: DirectorHostAgentOsSubagentSchedulerRecoveryActionType;
  severity: DirectorHostAgentOsSubagentSchedulerRecoverySeverity;
  reason: string;
  relatedSubagentIds: readonly string[];
  writeSet: readonly string[];
  observedWriteSet?: readonly string[];
  undeclaredObservedWriteSet?: readonly string[];
  evidence: DirectorHostAgentOsSubagentSchedulerRecoveryEvidence;
  operatorSummary: string;
}

export type DirectorHostAgentOsSubagentSchedulerRecoveryGroupType =
  | "write-set-overlap"
  | "observed-write-set-overlap";

export interface DirectorHostAgentOsSubagentSchedulerRecoveryGroup {
  groupId: string;
  groupType: DirectorHostAgentOsSubagentSchedulerRecoveryGroupType;
  severity: DirectorHostAgentOsSubagentSchedulerRecoverySeverity;
  reason: string;
  actionIds: readonly string[];
  subagentIds: readonly string[];
  runningSubagentIds: readonly string[];
  blockedSubagentIds: readonly string[];
  completedSubagentIds: readonly string[];
  writeSet: readonly string[];
  observedWriteSet?: readonly string[];
  undeclaredObservedWriteSet?: readonly string[];
  operatorSummary: string;
}

export interface DirectorHostAgentOsSubagentSchedulerRecoveryPlan {
  schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1";
  parentTurnId?: string;
  canRecover: boolean;
  blockedSubagentIds: readonly string[];
  conflictedSubagentIds: readonly string[];
  recoveryActions: readonly DirectorHostAgentOsSubagentSchedulerRecoveryAction[];
  recoveryGroups: readonly DirectorHostAgentOsSubagentSchedulerRecoveryGroup[];
  recoveryOrdinal: number;
}

export interface DirectorHostAgentOsSubagentRunEntry {
  subagentId: string;
  parentTurnId: string;
  profileId: string;
  workerId: string;
  taskId?: string;
  status: DirectorHostAgentOsSubagentRunStatus;
  role: DirectorHostAgentOsSubagentRole;
  targetAgent?: string;
  isolatedContext: boolean;
  instruction: string;
  contextSnapshot?: string;
  resultSummary?: string;
  observedWriteSet?: readonly string[];
  observedWriteSetSource?: "patch" | "diff" | "artifact";
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number;
  error?: string;
  verification?: DirectorHostAgentOsSubagentVerification;
  parentVisibleResult: DirectorHostAgentOsParentVisibleSubagentResult;
  scheduling?: DirectorHostAgentOsSubagentScheduling;
}

export interface DirectorHostAgentOsSubagentScheduling {
  parallelGroup?: string;
  writeSet: readonly string[];
  writeSetSource?: "explicit" | "inferred";
  observedWriteSet?: readonly string[];
  observedWriteSetSource?: "patch" | "diff" | "artifact";
  undeclaredObservedWriteSet?: readonly string[];
  observedConflictWith?: readonly string[];
  canRunInParallel: boolean;
  conflictsWith: readonly string[];
  conflictReason?: string;
  parallelBatch: number;
  scheduleOrder: number;
  readyToStart: boolean;
  blockedBy: readonly string[];
}

export interface DirectorHostAgentOsSubagentVerification {
  verificationId: string;
  verifierId: string;
  status: DirectorHostAgentOsSubagentVerificationStatus;
  verdict?: DirectorHostAgentOsSubagentVerificationVerdict;
  verdictSummary?: string;
  requirement: string;
  checks?: readonly DirectorHostAgentOsSubagentVerificationCheck[];
}

export interface DirectorHostAgentOsSubagentVerificationCheck {
  id: string;
  status: DirectorHostAgentOsSubagentVerificationVerdict;
  summary: string;
  detail?: string;
}

export interface DirectorHostAgentOsParentVisibleSubagentResult {
  status: DirectorHostAgentOsSubagentRunStatus;
  summary?: string;
  verificationVerdict?: DirectorHostAgentOsSubagentVerificationVerdict;
  observedWriteSet?: readonly string[];
  observedWriteSetSource?: "patch" | "diff" | "artifact";
}

export interface DirectorHostAgentOsExtensionMatrix {
  summary: DirectorHostAgentOsExtensionMatrixSummary;
  entries: readonly DirectorHostAgentOsExtensionMatrixEntry[];
  byCapability: Readonly<Record<string, readonly DirectorHostAgentOsExtensionMatrixEntry[]>>;
}

export interface DirectorHostAgentOsExtensionMatrixSummary {
  total: number;
  ready: number;
  needsAuth: number;
  needsSetup: number;
  disabled: number;
  problem: number;
}

export interface DirectorHostAgentOsExtensionMatrixEntry {
  id: string;
  kind: string;
  displayName: string;
  toolId?: string;
  providerId?: string;
  capabilityIds: readonly string[];
  health: {
    status: string;
    checkedAt?: string;
    checkFn?: string;
    message?: string;
  };
  sandbox: {
    defaultMode: string;
    networkPolicy: string;
    requiresCommandPattern?: boolean;
  };
  sourceTrust: {
    status: string;
    label?: string;
    reason?: string;
  };
  uiSurfaces: readonly string[];
  metadata?: UnknownRecord;
}

export interface DirectorHostAgentOsProcessCapabilityLedgerSummary {
  generatedAt: string;
  totalEntries: number;
  riskyHostEntries: number;
  entries: readonly DirectorHostAgentOsProcessCapabilityLedgerEntry[];
}

export interface DirectorHostAgentOsProcessCapabilityLedgerEntry {
  owner: string;
  runnerKind: string;
  backend?: string;
  status: string;
  toolName?: string;
  operationId?: string;
  providerId?: string;
  cwd?: string;
  command?: string;
  commandPrefix?: string;
  commandPattern?: {
    executable: string;
    argv?: readonly string[];
    operationId?: string;
  };
  planHash?: string;
  commandHash?: string;
  exitCode?: number;
  process?: {
    pid?: number;
    signal?: string | null;
    ownedProcess?: boolean;
    terminationReason?: string;
    signals?: readonly {
      signal: string;
      reason?: string;
      sentAt?: string;
    }[];
  };
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

const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isObject = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  isString(value) && (allowed as readonly string[]).includes(value);
const isArrayOf = <T>(value: unknown, guard: Guard<T>): value is T[] =>
  Array.isArray(value) && value.every(guard);
const isArrayOfStrings = (value: unknown): value is string[] => isArrayOf(value, isString);
const isStringRecord = (value: unknown): value is StringRecord =>
  isObject(value) && Object.values(value).every(isString);
const isOptional = <T>(value: unknown, guard: Guard<T>): value is T | undefined =>
  value === undefined || guard(value);
const hasDefinedValue = (...values: unknown[]): boolean =>
  values.some((value) => value !== undefined);

export function isDirectorApiVersion(value: unknown): value is typeof DIRECTOR_HOST_API_VERSION {
  return value === DIRECTOR_HOST_API_VERSION;
}

function isHostProjectSnapshot(value: unknown): value is HostProjectSnapshot {
  if (!isObject(value) || !isString(value.projectId)) {
    return false;
  }

  return (
    isOptional(value.title, isString) &&
    isOptional(value.outline, isString) &&
    isOptional(value.genre, isArrayOfStrings) &&
    (value.continuityPriority === undefined ||
      isOneOf(value.continuityPriority, CONTINUITY_PRIORITIES))
  );
}

function isHostGroupSnapshot(value: unknown): value is HostGroupSnapshot {
  if (
    !isObject(value) ||
    !isString(value.groupId) ||
    !isOneOf(value.generationType, DIRECTOR_GENERATION_TYPES) ||
    !isNumber(value.sceneCount) ||
    !isArrayOfStrings(value.anchorIds)
  ) {
    return false;
  }

  return (
    isOptional(value.generationStyle, (candidate): candidate is DirectorGenerationStyle =>
      isOneOf(candidate, DIRECTOR_GENERATION_STYLES),
    ) && isOptional(value.totalDurationSeconds, isNumber)
  );
}

function isHostRuntimeState(value: unknown): value is HostRuntimeState {
  if (
    !isObject(value) ||
    !isString(value.runtimeId) ||
    !isOneOf(value.status, RUNTIME_HEALTH_STATUSES) ||
    !isArrayOfStrings(value.availableBindings) ||
    !isNumber(value.maxPromptChars) ||
    !isBoolean(value.supportsVideo)
  ) {
    return false;
  }

  return (
    value.deterministicMode === undefined || isOneOf(value.deterministicMode, DETERMINISTIC_MODES)
  );
}

function isHostExecutionIntent(value: unknown): value is HostExecutionIntent {
  if (!isObject(value) || !isOneOf(value.bindingPolicy, BINDING_POLICIES)) {
    return false;
  }

  return (
    isOptional(value.preferredImageBinding, isString) &&
    isOptional(value.preferredVideoBinding, isString) &&
    isOptional(value.requiredImageBinding, isString) &&
    isOptional(value.requiredVideoBinding, isString) &&
    isOptional(value.fallbackBindings, isArrayOfStrings)
  );
}

function isHostFieldLock(value: unknown): value is HostFieldLock {
  return (
    isObject(value) &&
    isString(value.field) &&
    isOneOf(value.level, LOCK_LEVELS) &&
    isOptional(value.reason, isString)
  );
}

function isHostKnowledgeSignal(value: unknown): value is HostKnowledgeSignal {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.description) &&
    isNumber(value.confidence) &&
    isOptional(value.tags, isArrayOfStrings)
  );
}

function isDirectorPlanSummary(value: unknown): value is DirectorPlanSummary {
  return (
    isObject(value) &&
    isString(value.planId) &&
    (value.status === "ready" ||
      value.status === "review_required" ||
      value.status === "blocked") &&
    isString(value.summary) &&
    isNumber(value.confidence) &&
    isOneOf(value.selectedGenerationStyle, DIRECTOR_GENERATION_STYLES) &&
    (value.selectedImageBinding === null || isString(value.selectedImageBinding)) &&
    (value.selectedVideoBinding === null || isString(value.selectedVideoBinding)) &&
    isArrayOfStrings(value.riskFlags)
  );
}

function isDirectorExecutionSummary(value: unknown): value is DirectorExecutionSummary {
  return (
    isObject(value) &&
    isString(value.executionId) &&
    isOneOf(value.selectedGenerationType, DIRECTOR_GENERATION_TYPES) &&
    isOneOf(value.selectedGenerationStyle, DIRECTOR_GENERATION_STYLES) &&
    isString(value.visiblePrompt)
  );
}

function isDirectorReviewSummary(value: unknown): value is DirectorReviewSummary {
  return (
    isObject(value) &&
    isOneOf(value.overallDecision, DIRECTOR_DECISIONS) &&
    isArrayOfStrings(value.blockingReasons) &&
    isArrayOfStrings(value.requiredFixes) &&
    isOptional(value.warnings, isArrayOfStrings)
  );
}

function isKnowledgePackCatalogEntry(value: unknown): value is DirectorKnowledgePackCatalogEntry {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.title) &&
    isNumber(value.version) &&
    isOneOf(value.stage, KNOWLEDGE_PACK_STAGES) &&
    isString(value.createdAt) &&
    isOptional(value.description, isString) &&
    isOptional(value.tags, isArrayOfStrings)
  );
}

function isDirectorAlignmentConstraint(value: unknown): value is DirectorAlignmentConstraint {
  return (
    isObject(value) &&
    isString(value.field) &&
    isString(value.requirement) &&
    isOneOf(value.priority, ALIGNMENT_CONSTRAINT_PRIORITIES) &&
    isOptional(value.rationale, isString)
  );
}

export function isArtifactRef(value: unknown): value is ArtifactRef {
  return (
    isObject(value) &&
    isString(value.artifactId) &&
    isOneOf(value.kind, ARTIFACT_KINDS) &&
    isOneOf(value.source, ARTIFACT_SOURCES) &&
    isOptional(value.title, isString) &&
    isOptional(value.uri, isString) &&
    isOptional(value.path, isString) &&
    isOptional(value.inlineText, isString) &&
    isOptional(value.mimeType, isString) &&
    isOptional(value.format, isString) &&
    isOptional(value.width, isNumber) &&
    isOptional(value.height, isNumber) &&
    isOptional(value.durationSec, isNumber) &&
    isOptional(value.sizeBytes, isNumber) &&
    isOptional(value.checksum, isString) &&
    isOptional(value.metadata, isStringRecord)
  );
}

export function isDirectorIntakePayload(value: unknown): value is DirectorIntakePayload {
  return (
    isObject(value) &&
    isString(value.intakeId) &&
    isString(value.submittedAt) &&
    isString(value.objective) &&
    isOptional(value.desiredOutcome, isString) &&
    isOptional(value.deliverables, isArrayOfStrings) &&
    isOptional(value.audience, isString) &&
    isOptional(value.styleNotes, isArrayOfStrings) &&
    isOptional(value.constraints, (candidate): candidate is DirectorAlignmentConstraint[] =>
      isArrayOf(candidate, isDirectorAlignmentConstraint),
    ) &&
    isOptional(value.nonGoals, isArrayOfStrings) &&
    isOptional(value.references, (candidate): candidate is ArtifactRef[] =>
      isArrayOf(candidate, isArtifactRef),
    ) &&
    isOptional(value.notes, isArrayOfStrings) &&
    isOptional(value.metadata, isStringRecord)
  );
}

function isDirectorClarificationQuestionOption(
  value: unknown,
): value is DirectorClarificationQuestionOption {
  return (
    isObject(value) &&
    isString(value.value) &&
    isString(value.label) &&
    isOptional(value.description, isString)
  );
}

function isDirectorClarificationQuestion(value: unknown): value is DirectorClarificationQuestion {
  return (
    isObject(value) &&
    isString(value.questionId) &&
    isString(value.prompt) &&
    isOptional(value.rationale, isString) &&
    isBoolean(value.required) &&
    isOneOf(value.answerKind, CLARIFICATION_ANSWER_KINDS) &&
    isArrayOfStrings(value.affectsFields) &&
    isOptional(value.options, (candidate): candidate is DirectorClarificationQuestionOption[] =>
      isArrayOf(candidate, isDirectorClarificationQuestionOption),
    )
  );
}

export function isDirectorClarificationAssessment(
  value: unknown,
): value is DirectorClarificationAssessment {
  return (
    isObject(value) &&
    isOneOf(value.decision, DIRECTOR_CLARIFICATION_DECISIONS) &&
    isString(value.summary) &&
    isArrayOfStrings(value.missingFields) &&
    isArrayOfStrings(value.conflictingFields) &&
    isArrayOf(value.questions, isDirectorClarificationQuestion)
  );
}

function isDirectorClarificationAnswer(value: unknown): value is DirectorClarificationAnswer {
  return (
    isObject(value) &&
    isString(value.questionId) &&
    hasDefinedValue(
      value.text,
      value.values,
      value.booleanValue,
      value.numberValue,
      value.artifacts,
    ) &&
    isOptional(value.text, isString) &&
    isOptional(value.values, isArrayOfStrings) &&
    isOptional(value.booleanValue, isBoolean) &&
    isOptional(value.numberValue, isNumber) &&
    isOptional(value.artifacts, (candidate): candidate is ArtifactRef[] =>
      isArrayOf(candidate, isArtifactRef),
    )
  );
}

export function isAlignmentLock(value: unknown): value is AlignmentLock {
  return (
    isObject(value) &&
    isString(value.lockId) &&
    isString(value.sourceIntakeId) &&
    isOneOf(value.state, ALIGNMENT_LOCK_STATES) &&
    isString(value.lockedAt) &&
    isString(value.objective) &&
    isOptional(value.desiredOutcome, isString) &&
    isArrayOfStrings(value.deliverables) &&
    isArrayOf(value.lockedConstraints, isDirectorAlignmentConstraint) &&
    isArrayOf(value.lockedFields, isHostFieldLock) &&
    isOptional(value.answeredQuestionIds, isArrayOfStrings) &&
    isOptional(value.nonGoals, isArrayOfStrings) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}

function isDirectorBudgetLimit(value: unknown): value is DirectorBudgetLimit {
  return (
    isObject(value) &&
    isOptional(value.currency, isString) &&
    isOptional(value.maxCost, isNumber) &&
    isOptional(value.costClass, (candidate): candidate is CostClass =>
      isOneOf(candidate, COST_CLASSES),
    )
  );
}

function isAdapterProfileRef(value: unknown): value is AdapterProfileRef {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isString(value.profileId) &&
    isOptional(value.displayName, isString)
  );
}

function isMediaOutputContract(value: unknown): value is MediaOutputContract {
  return (
    isObject(value) &&
    isOneOf(value.artifactKind, MEDIA_OUTPUT_ARTIFACT_KINDS) &&
    isOptional(value.count, isNumber) &&
    isOptional(value.format, isString) &&
    isOptional(value.aspectRatio, isString) &&
    isOptional(value.resolution, isString) &&
    isOptional(value.maxDurationSec, isNumber)
  );
}

export function isMediaExecutionRequest(value: unknown): value is MediaExecutionRequest {
  return (
    isObject(value) &&
    isString(value.requestId) &&
    isOneOf(value.mode, MEDIA_EXECUTION_MODES) &&
    isString(value.objective) &&
    isOptional(value.prompt, isString) &&
    isArrayOfStrings(value.requiredCapabilities) &&
    isOptional(value.preferredCapabilities, isArrayOfStrings) &&
    isOptional(value.lockedConstraints, (candidate): candidate is DirectorAlignmentConstraint[] =>
      isArrayOf(candidate, isDirectorAlignmentConstraint),
    ) &&
    isArrayOf(value.inputArtifacts, isArtifactRef) &&
    isMediaOutputContract(value.outputContract) &&
    isOptional(value.budgetLimit, isDirectorBudgetLimit) &&
    isOptional(value.deadlineAt, isString) &&
    isString(value.idempotencyKey) &&
    isOptional(value.profileRef, isAdapterProfileRef) &&
    isOptional(value.metadata, isStringRecord)
  );
}

function isMediaExecutionJobHandle(value: unknown): value is MediaExecutionJobHandle {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isOptional(value.providerJobId, isString) &&
    isOptional(value.statusUrl, isString) &&
    isOptional(value.cancelToken, isString)
  );
}

function isMediaExecutionAuditEntry(value: unknown): value is MediaExecutionAuditEntry {
  return isObject(value) && isString(value.at) && isString(value.event) && isString(value.message);
}

export function isMediaExecutionReceipt(value: unknown): value is MediaExecutionReceipt {
  return (
    isObject(value) &&
    isString(value.receiptId) &&
    isString(value.requestId) &&
    isOneOf(value.status, MEDIA_EXECUTION_STATUSES) &&
    isMediaExecutionJobHandle(value.jobHandle) &&
    isArrayOf(value.artifacts, isArtifactRef) &&
    isArrayOfStrings(value.warnings) &&
    isOptional(value.failureCategory, (candidate): candidate is MediaFailureCategory =>
      isOneOf(candidate, MEDIA_FAILURE_CATEGORIES),
    ) &&
    isOptional(value.retryable, isBoolean) &&
    isArrayOf(value.auditTrail, isMediaExecutionAuditEntry)
  );
}

function isMediaCapabilityProfile(value: unknown): value is MediaCapabilityProfile {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    value.adapterKind === "media" &&
    isString(value.provider) &&
    isOptional(value.modelFamily, isString) &&
    isOptional(value.modelVersion, isString) &&
    isOptional(value.capabilityVersion, isString) &&
    isArrayOf(value.supportedModes, (candidate): candidate is MediaExecutionMode =>
      isOneOf(candidate, MEDIA_EXECUTION_MODES),
    ) &&
    isArrayOf(value.inputModalities, (candidate): candidate is ArtifactKind =>
      isOneOf(candidate, ARTIFACT_KINDS),
    ) &&
    isArrayOf(value.outputArtifactTypes, (candidate): candidate is MediaOutputArtifactKind =>
      isOneOf(candidate, MEDIA_OUTPUT_ARTIFACT_KINDS),
    ) &&
    isBoolean(value.supportsAsync) &&
    isOptional(value.supportsWebhook, isBoolean) &&
    isOptional(value.maxDurationSec, isNumber) &&
    isOptional(value.supportedAspectRatios, isArrayOfStrings) &&
    isOptional(value.supportedResolutions, isArrayOfStrings) &&
    isOptional(value.supportsReferenceImage, isBoolean) &&
    isOptional(value.supportsMultiImage, isBoolean) &&
    isOptional(value.supportsAudioConditioning, isBoolean) &&
    isOptional(value.costClass, (candidate): candidate is CostClass =>
      isOneOf(candidate, COST_CLASSES),
    ) &&
    isOptional(value.latencyClass, (candidate): candidate is LatencyClass =>
      isOneOf(candidate, LATENCY_CLASSES),
    ) &&
    isOptional(value.safetyTier, (candidate): candidate is SafetyTier =>
      isOneOf(candidate, SAFETY_TIERS),
    ) &&
    isOptional(value.regionOrDataPolicy, isString) &&
    isOneOf(value.healthStatus, RUNTIME_HEALTH_STATUSES)
  );
}

function isRuntimeCapabilityAdapter(value: unknown): value is RuntimeCapabilityAdapter {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isOneOf(value.adapterKind, ADAPTER_KINDS) &&
    isString(value.provider) &&
    isBoolean(value.enabled) &&
    isOneOf(value.healthStatus, RUNTIME_HEALTH_STATUSES) &&
    isBoolean(value.dryRunSupported) &&
    isBoolean(value.mockOnly) &&
    isOptional(value.riskLevel, (candidate): candidate is AdapterRiskLevel =>
      isOneOf(candidate, ADAPTER_RISK_LEVELS),
    ) &&
    isOptional(value.approvalMode, (candidate): candidate is DirectorApprovalMode =>
      isOneOf(candidate, DIRECTOR_APPROVAL_MODES),
    ) &&
    isOptional(value.permissionScopes, isArrayOfStrings) &&
    isOptional(value.dataRetentionPolicy, isString) &&
    isOptional(value.rateLimitPolicy, isString) &&
    isOptional(value.budgetPolicy, isString) &&
    isOptional(value.bridge, isRuntimeCapabilityAdapterBridge) &&
    isOptional(value.supportedActionClasses, (candidate): candidate is DirectorActionClass[] =>
      isArrayOf(candidate, (item): item is DirectorActionClass =>
        isOneOf(item, DIRECTOR_ACTION_CLASSES),
      ),
    ) &&
    isOptional(value.availableProfiles, (candidate): candidate is AdapterProfileRef[] =>
      isArrayOf(candidate, isAdapterProfileRef),
    ) &&
    (value.mediaCapability === undefined ||
      (value.adapterKind === "media" &&
        isMediaCapabilityProfile(value.mediaCapability) &&
        value.mediaCapability.adapterId === value.adapterId)) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}

function isRuntimeCapabilityAdapterBridge(value: unknown): value is RuntimeCapabilityAdapterBridge {
  return (
    isObject(value) &&
    isOneOf(value.kind, RUNTIME_CAPABILITY_ADAPTER_BRIDGE_KINDS) &&
    isString(value.endpointOrigin) &&
    isString(value.endpointPath) &&
    isOneOf(value.authMode, RUNTIME_CAPABILITY_ADAPTER_BRIDGE_AUTH_MODES) &&
    isNumber(value.timeoutMs) &&
    isOptional(value.headerKeys, isArrayOfStrings)
  );
}

export function isRuntimeCapabilitySnapshot(value: unknown): value is RuntimeCapabilitySnapshot {
  return (
    isObject(value) &&
    isString(value.snapshotId) &&
    isString(value.runtimeId) &&
    isString(value.capturedAt) &&
    isOneOf(value.status, RUNTIME_HEALTH_STATUSES) &&
    isArrayOf(value.adapters, isRuntimeCapabilityAdapter) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}

export function isDirectorRuntimeCapabilitySnapshotRequest(
  value: unknown,
): value is DirectorRuntimeCapabilitySnapshotRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.runtimeId) &&
    isOptional(value.hostId, isString) &&
    isOptional(value.sessionId, isString) &&
    isOptional(value.adapterKinds, (candidate): candidate is AdapterKind[] =>
      isArrayOf(candidate, (item): item is AdapterKind => isOneOf(item, ADAPTER_KINDS)),
    ) &&
    isOptional(value.includeDisabled, isBoolean) &&
    isOptional(value.includeMockOnly, isBoolean)
  );
}

export function isDirectorRuntimeCapabilitySnapshotResponse(
  value: unknown,
): value is DirectorRuntimeCapabilitySnapshotResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.runtimeId) &&
    isRuntimeCapabilitySnapshot(value.capabilitySnapshot) &&
    isOptional(
      value.agentOsProcessCapabilityLedger,
      isDirectorHostAgentOsProcessCapabilityLedgerSummary,
    ) &&
    isOptional(value.agentOsExtensionMatrix, isDirectorHostAgentOsExtensionMatrix) &&
    isOptional(value.agentOsSubagentRuns, isDirectorHostAgentOsSubagentRunProjection) &&
    value.capabilitySnapshot.runtimeId === value.runtimeId
  );
}

function isDirectorHostAgentOsSubagentRunProjection(
  value: unknown,
): value is DirectorHostAgentOsSubagentRunProjection {
  return (
    isObject(value) &&
    isDirectorHostAgentOsSubagentRunSummary(value.summary) &&
    isArrayOf(value.entries, isDirectorHostAgentOsSubagentRunEntry) &&
    isOptional(value.schedulerHeartbeat, isDirectorHostAgentOsSubagentSchedulerHeartbeat) &&
    isOptional(value.schedulerDispatchPlan, isDirectorHostAgentOsSubagentSchedulerDispatchPlan) &&
    isOptional(value.schedulerTick, isDirectorHostAgentOsSubagentSchedulerTick) &&
    isOptional(value.schedulerRecoveryPlan, isDirectorHostAgentOsSubagentSchedulerRecoveryPlan)
  );
}

function isDirectorHostAgentOsSubagentRunSummary(
  value: unknown,
): value is DirectorHostAgentOsSubagentRunSummary {
  return (
    isObject(value) &&
    isNumber(value.total) &&
    isNumber(value.queued) &&
    isNumber(value.running) &&
    isNumber(value.completed) &&
    isNumber(value.failed) &&
    isNumber(value.cancelled) &&
    isNumber(value.verifiedPass) &&
    isNumber(value.verifiedFail) &&
    isNumber(value.verifiedPartial)
  );
}

function isDirectorHostAgentOsSubagentSchedulerHeartbeat(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerHeartbeat {
  return (
    isObject(value) &&
    value.schemaId === "hotflow.agent-os.subagent-scheduler-heartbeat.v1" &&
    isOptional(value.parentTurnId, isString) &&
    isNumber(value.totalSubagentRuns) &&
    isNumber(value.queuedCount) &&
    isNumber(value.runningCount) &&
    isNumber(value.completedCount) &&
    isNumber(value.failedCount) &&
    isNumber(value.cancelledCount) &&
    isNumber(value.schedulerTrackedCount) &&
    isNumber(value.readyCount) &&
    isNumber(value.blockedCount) &&
    isNumber(value.unscheduledQueuedCount) &&
    isArrayOfStrings(value.nextReadySubagentIds) &&
    isArrayOfStrings(value.blockedSubagentIds) &&
    isArrayOfStrings(value.runningSubagentIds) &&
    isOptional(value.nextParallelBatch, isNumber) &&
    isBoolean(value.canContinue) &&
    isOneOf(value.stoppedReason, ["ready", "scheduler-blocked", "mailbox-empty"]) &&
    isNumber(value.heartbeatOrdinal) &&
    isOptional(value.latestUpdatedAtMs, isNumber)
  );
}

function isDirectorHostAgentOsSubagentSchedulerDispatchPlan(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerDispatchPlan {
  return (
    isObject(value) &&
    value.schemaId === "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1" &&
    isOptional(value.parentTurnId, isString) &&
    isNumber(value.planOrdinal) &&
    isNumber(value.heartbeatOrdinal) &&
    isBoolean(value.canDispatch) &&
    isOneOf(value.dispatchReason, ["ready", "scheduler-blocked", "mailbox-empty"]) &&
    isNumber(value.maxDispatchableCount) &&
    isArrayOfStrings(value.dispatchableSubagentIds) &&
    isArrayOf(value.dispatchBatches, isDirectorHostAgentOsSubagentSchedulerDispatchBatch) &&
    isArrayOfStrings(value.blockedSubagentIds) &&
    isArrayOfStrings(value.runningSubagentIds)
  );
}

function isDirectorHostAgentOsSubagentSchedulerDispatchBatch(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerDispatchBatch {
  return (
    isObject(value) &&
    isNumber(value.parallelBatch) &&
    isArrayOfStrings(value.subagentIds) &&
    isArrayOfStrings(value.workerIds) &&
    isArrayOf(value.writeSets, isDirectorHostAgentOsSubagentSchedulerDispatchWriteSet)
  );
}

function isDirectorHostAgentOsSubagentSchedulerDispatchWriteSet(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerDispatchWriteSet {
  return (
    isObject(value) &&
    isString(value.subagentId) &&
    isArrayOfStrings(value.writeSet) &&
    isOptional(value.writeSetSource, (source) => isOneOf(source, ["explicit", "inferred"]))
  );
}

function isDirectorHostAgentOsSubagentSchedulerTick(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerTick {
  return (
    isObject(value) &&
    value.schemaId === "hotflow.agent-os.subagent-scheduler-tick.v1" &&
    isString(value.sessionId) &&
    (value.latestTurnId === null || isString(value.latestTurnId)) &&
    isArrayOf(value.dispatchIntents, isDirectorHostAgentOsSubagentSchedulerTickIntent) &&
    value.claimDryRun === true
  );
}

function isDirectorHostAgentOsSubagentSchedulerTickIntent(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerTickIntent {
  return (
    isObject(value) &&
    isString(value.intentId) &&
    isString(value.delegationId) &&
    isString(value.workerId) &&
    value.command === "run-delegation" &&
    isArrayOfStrings(value.argv) &&
    isNumber(value.parallelBatch) &&
    isArrayOfStrings(value.writeSet) &&
    isOptional(value.writeSetSource, (source) => isOneOf(source, ["explicit", "inferred"]))
  );
}

function isDirectorHostAgentOsSubagentSchedulerRecoveryPlan(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerRecoveryPlan {
  return (
    isObject(value) &&
    value.schemaId === "hotflow.agent-os.subagent-scheduler-recovery-plan.v1" &&
    isOptional(value.parentTurnId, isString) &&
    isBoolean(value.canRecover) &&
    isArrayOfStrings(value.blockedSubagentIds) &&
    isArrayOfStrings(value.conflictedSubagentIds) &&
    isArrayOf(value.recoveryActions, isDirectorHostAgentOsSubagentSchedulerRecoveryAction) &&
    isArrayOf(value.recoveryGroups, isDirectorHostAgentOsSubagentSchedulerRecoveryGroup) &&
    isNumber(value.recoveryOrdinal)
  );
}

function isDirectorHostAgentOsSubagentSchedulerRecoveryAction(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerRecoveryAction {
  return (
    isObject(value) &&
    isString(value.actionId) &&
    isString(value.subagentId) &&
    isOneOf(value.actionType, ["wait-for-running-subagent", "review-observed-write-set"]) &&
    isOneOf(value.severity, ["info", "warning"]) &&
    isString(value.reason) &&
    isArrayOfStrings(value.relatedSubagentIds) &&
    isArrayOfStrings(value.writeSet) &&
    isOptional(value.observedWriteSet, isArrayOfStrings) &&
    isOptional(value.undeclaredObservedWriteSet, isArrayOfStrings) &&
    isDirectorHostAgentOsSubagentSchedulerRecoveryEvidence(value.evidence) &&
    isString(value.operatorSummary)
  );
}

function isDirectorHostAgentOsSubagentSchedulerRecoveryEvidence(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerRecoveryEvidence {
  return (
    isObject(value) &&
    isArrayOfStrings(value.blockedBy) &&
    isArrayOfStrings(value.conflictsWith) &&
    isOptional(value.observedConflictWith, isArrayOfStrings)
  );
}

function isDirectorHostAgentOsSubagentSchedulerRecoveryGroup(
  value: unknown,
): value is DirectorHostAgentOsSubagentSchedulerRecoveryGroup {
  return (
    isObject(value) &&
    isString(value.groupId) &&
    isOneOf(value.groupType, ["write-set-overlap", "observed-write-set-overlap"]) &&
    isOneOf(value.severity, ["info", "warning"]) &&
    isString(value.reason) &&
    isArrayOfStrings(value.actionIds) &&
    isArrayOfStrings(value.subagentIds) &&
    isArrayOfStrings(value.runningSubagentIds) &&
    isArrayOfStrings(value.blockedSubagentIds) &&
    isArrayOfStrings(value.completedSubagentIds) &&
    isArrayOfStrings(value.writeSet) &&
    isOptional(value.observedWriteSet, isArrayOfStrings) &&
    isOptional(value.undeclaredObservedWriteSet, isArrayOfStrings) &&
    isString(value.operatorSummary)
  );
}

function isDirectorHostAgentOsSubagentRunEntry(
  value: unknown,
): value is DirectorHostAgentOsSubagentRunEntry {
  return (
    isObject(value) &&
    isString(value.subagentId) &&
    isString(value.parentTurnId) &&
    isString(value.profileId) &&
    isString(value.workerId) &&
    isOptional(value.taskId, isString) &&
    isOneOf(value.status, DIRECTOR_HOST_AGENT_OS_SUBAGENT_RUN_STATUSES) &&
    isOneOf(value.role, DIRECTOR_HOST_AGENT_OS_SUBAGENT_ROLES) &&
    isOptional(value.targetAgent, isString) &&
    isBoolean(value.isolatedContext) &&
    isString(value.instruction) &&
    isOptional(value.contextSnapshot, isString) &&
    isOptional(value.resultSummary, isString) &&
    isOptional(value.observedWriteSet, isArrayOfStrings) &&
    isOptional(value.observedWriteSetSource, isDirectorHostObservedWriteSetSource) &&
    isNumber(value.createdAtMs) &&
    isNumber(value.updatedAtMs) &&
    isOptional(value.completedAtMs, isNumber) &&
    isOptional(value.error, isString) &&
    isOptional(value.verification, isDirectorHostAgentOsSubagentVerification) &&
    isDirectorHostAgentOsParentVisibleSubagentResult(value.parentVisibleResult) &&
    isOptional(value.scheduling, isDirectorHostAgentOsSubagentScheduling)
  );
}

function isDirectorHostObservedWriteSetSource(
  value: unknown,
): value is "patch" | "diff" | "artifact" {
  return isOneOf(value, ["patch", "diff", "artifact"]);
}

function isDirectorHostAgentOsSubagentScheduling(
  value: unknown,
): value is DirectorHostAgentOsSubagentScheduling {
  return (
    isObject(value) &&
    isOptional(value.parallelGroup, isString) &&
    isArrayOfStrings(value.writeSet) &&
    isOptional(value.writeSetSource, (candidate): candidate is "explicit" | "inferred" =>
      isOneOf(candidate, ["explicit", "inferred"]),
    ) &&
    isOptional(value.observedWriteSet, isArrayOfStrings) &&
    isOptional(value.observedWriteSetSource, isDirectorHostObservedWriteSetSource) &&
    isOptional(value.undeclaredObservedWriteSet, isArrayOfStrings) &&
    isOptional(value.observedConflictWith, isArrayOfStrings) &&
    isBoolean(value.canRunInParallel) &&
    isArrayOfStrings(value.conflictsWith) &&
    isOptional(value.conflictReason, isString) &&
    isNumber(value.parallelBatch) &&
    isNumber(value.scheduleOrder) &&
    isBoolean(value.readyToStart) &&
    isArrayOfStrings(value.blockedBy)
  );
}

function isDirectorHostAgentOsSubagentVerification(
  value: unknown,
): value is DirectorHostAgentOsSubagentVerification {
  return (
    isObject(value) &&
    isString(value.verificationId) &&
    isString(value.verifierId) &&
    isOneOf(value.status, DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_STATUSES) &&
    isOptional(
      value.verdict,
      (candidate): candidate is DirectorHostAgentOsSubagentVerificationVerdict =>
        isOneOf(candidate, DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_VERDICTS),
    ) &&
    isOptional(value.verdictSummary, isString) &&
    isString(value.requirement) &&
    isOptional(
      value.checks,
      (candidate): candidate is DirectorHostAgentOsSubagentVerificationCheck[] =>
        isArrayOf(candidate, isDirectorHostAgentOsSubagentVerificationCheck),
    )
  );
}

function isDirectorHostAgentOsSubagentVerificationCheck(
  value: unknown,
): value is DirectorHostAgentOsSubagentVerificationCheck {
  return (
    isObject(value) &&
    isString(value.id) &&
    isOneOf(value.status, DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_VERDICTS) &&
    isString(value.summary) &&
    isOptional(value.detail, isString)
  );
}

function isDirectorHostAgentOsParentVisibleSubagentResult(
  value: unknown,
): value is DirectorHostAgentOsParentVisibleSubagentResult {
  return (
    isObject(value) &&
    isOneOf(value.status, DIRECTOR_HOST_AGENT_OS_SUBAGENT_RUN_STATUSES) &&
    isOptional(value.summary, isString) &&
    isOptional(
      value.verificationVerdict,
      (candidate): candidate is DirectorHostAgentOsSubagentVerificationVerdict =>
        isOneOf(candidate, DIRECTOR_HOST_AGENT_OS_SUBAGENT_VERIFICATION_VERDICTS),
    ) &&
    isOptional(value.observedWriteSet, isArrayOfStrings) &&
    isOptional(value.observedWriteSetSource, isDirectorHostObservedWriteSetSource)
  );
}

function isDirectorHostAgentOsExtensionMatrix(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrix {
  return (
    isObject(value) &&
    isDirectorHostAgentOsExtensionMatrixSummary(value.summary) &&
    isArrayOf(value.entries, isDirectorHostAgentOsExtensionMatrixEntry) &&
    isDirectorHostAgentOsExtensionMatrixByCapability(value.byCapability)
  );
}

function isDirectorHostAgentOsExtensionMatrixSummary(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrixSummary {
  return (
    isObject(value) &&
    isNumber(value.total) &&
    isNumber(value.ready) &&
    isNumber(value.needsAuth) &&
    isNumber(value.needsSetup) &&
    isNumber(value.disabled) &&
    isNumber(value.problem)
  );
}

function isDirectorHostAgentOsExtensionMatrixByCapability(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrix["byCapability"] {
  return (
    isObject(value) &&
    Object.values(value).every((entry) =>
      isArrayOf(entry, isDirectorHostAgentOsExtensionMatrixEntry),
    )
  );
}

function isDirectorHostAgentOsExtensionMatrixEntry(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrixEntry {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.kind) &&
    isString(value.displayName) &&
    isOptional(value.toolId, isString) &&
    isOptional(value.providerId, isString) &&
    isArrayOfStrings(value.capabilityIds) &&
    isDirectorHostAgentOsExtensionHealth(value.health) &&
    isDirectorHostAgentOsExtensionSandbox(value.sandbox) &&
    isDirectorHostAgentOsExtensionSourceTrust(value.sourceTrust) &&
    isArrayOfStrings(value.uiSurfaces) &&
    isOptional(value.metadata, isObject)
  );
}

function isDirectorHostAgentOsExtensionHealth(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrixEntry["health"] {
  return (
    isObject(value) &&
    isString(value.status) &&
    isOptional(value.checkedAt, isString) &&
    isOptional(value.checkFn, isString) &&
    isOptional(value.message, isString)
  );
}

function isDirectorHostAgentOsExtensionSandbox(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrixEntry["sandbox"] {
  return (
    isObject(value) &&
    isString(value.defaultMode) &&
    isString(value.networkPolicy) &&
    isOptional(value.requiresCommandPattern, isBoolean)
  );
}

function isDirectorHostAgentOsExtensionSourceTrust(
  value: unknown,
): value is DirectorHostAgentOsExtensionMatrixEntry["sourceTrust"] {
  return (
    isObject(value) &&
    isString(value.status) &&
    isOptional(value.label, isString) &&
    isOptional(value.reason, isString)
  );
}

function isDirectorHostAgentOsProcessCapabilityLedgerSummary(
  value: unknown,
): value is DirectorHostAgentOsProcessCapabilityLedgerSummary {
  return (
    isObject(value) &&
    isString(value.generatedAt) &&
    isNumber(value.totalEntries) &&
    isNumber(value.riskyHostEntries) &&
    isArrayOf(value.entries, isDirectorHostAgentOsProcessCapabilityLedgerEntry)
  );
}

function isDirectorHostAgentOsProcessCapabilityLedgerEntry(
  value: unknown,
): value is DirectorHostAgentOsProcessCapabilityLedgerEntry {
  return (
    isObject(value) &&
    isString(value.owner) &&
    isString(value.runnerKind) &&
    isString(value.status) &&
    isOptional(value.backend, isString) &&
    isOptional(value.toolName, isString) &&
    isOptional(value.operationId, isString) &&
    isOptional(value.providerId, isString) &&
    isOptional(value.cwd, isString) &&
    isOptional(value.command, isString) &&
    isOptional(value.commandPrefix, isString) &&
    isOptional(value.commandPattern, isDirectorHostAgentOsCommandPattern) &&
    isOptional(value.planHash, isString) &&
    isOptional(value.commandHash, isString) &&
    isOptional(value.exitCode, isNumber) &&
    isOptional(value.process, isDirectorHostAgentOsProcessEvidence)
  );
}

function isDirectorHostAgentOsCommandPattern(
  value: unknown,
): value is NonNullable<DirectorHostAgentOsProcessCapabilityLedgerEntry["commandPattern"]> {
  return (
    isObject(value) &&
    isString(value.executable) &&
    isOptional(value.argv, isArrayOfStrings) &&
    isOptional(value.operationId, isString)
  );
}

function isDirectorHostAgentOsProcessEvidence(
  value: unknown,
): value is NonNullable<DirectorHostAgentOsProcessCapabilityLedgerEntry["process"]> {
  return (
    isObject(value) &&
    isOptional(value.pid, isNumber) &&
    (value.signal === null || isOptional(value.signal, isString)) &&
    isOptional(value.ownedProcess, isBoolean) &&
    isOptional(value.terminationReason, isString) &&
    isOptional(
      value.signals,
      (
        candidate,
      ): candidate is NonNullable<
        NonNullable<DirectorHostAgentOsProcessCapabilityLedgerEntry["process"]>["signals"]
      > => isArrayOf(candidate, isDirectorHostAgentOsSignalEvidence),
    )
  );
}

function isDirectorHostAgentOsSignalEvidence(
  value: unknown,
): value is NonNullable<
  NonNullable<DirectorHostAgentOsProcessCapabilityLedgerEntry["process"]>["signals"]
>[number] {
  return (
    isObject(value) &&
    isString(value.signal) &&
    isOptional(value.reason, isString) &&
    isOptional(value.sentAt, isString)
  );
}

function isCapabilityMatchResult(value: unknown): value is CapabilityMatchResult {
  return (
    isObject(value) &&
    isString(value.matchId) &&
    isString(value.assignmentId) &&
    isOneOf(value.status, CAPABILITY_MATCH_STATUSES) &&
    isOptional(value.chosenAdapterId, isString) &&
    isArrayOfStrings(value.reasons) &&
    isOptional(value.missingCapabilities, isArrayOfStrings)
  );
}

function isDirectorActionNode(value: unknown): value is DirectorActionNode {
  return (
    isObject(value) &&
    isString(value.nodeId) &&
    isString(value.assignmentId) &&
    isOneOf(value.role, DIRECTOR_CREW_ROLES) &&
    isString(value.objective) &&
    isOptional(value.assignedCapability, isString) &&
    isArrayOfStrings(value.inputs) &&
    isArrayOfStrings(value.outputs) &&
    isString(value.deliverable) &&
    isArrayOfStrings(value.acceptanceCriteria) &&
    isArrayOf(value.constraints, isDirectorAlignmentConstraint) &&
    isArrayOfStrings(value.dependsOn) &&
    isArrayOfStrings(value.allowedAdapters) &&
    isOneOf(value.actionClass, DIRECTOR_ACTION_CLASSES) &&
    isOneOf(value.approvalMode, DIRECTOR_APPROVAL_MODES) &&
    isOptional(value.budgetLimit, isDirectorBudgetLimit) &&
    isOptional(value.timeoutMs, isNumber) &&
    isOptional(value.maxDelegationDepth, isNumber) &&
    isOptional(value.fallbackPolicy, isString) &&
    isBoolean(value.escalationToDirector) &&
    isOptional(value.status, (candidate): candidate is DirectorActionNodeStatus =>
      isOneOf(candidate, DIRECTOR_ACTION_NODE_STATUSES),
    ) &&
    isOptional(
      value.selectedAdapter,
      (candidate): candidate is string | null => candidate === null || isString(candidate),
    ) &&
    isOptional(value.blockingReason, isString)
  );
}

function isDirectorActionEdge(value: unknown): value is DirectorActionEdge {
  return (
    isObject(value) &&
    isString(value.fromNodeId) &&
    isString(value.toNodeId) &&
    isOptional(value.artifactId, isString) &&
    isString(value.handoffContract) &&
    isBoolean(value.blocking)
  );
}

export function isDirectorActionGraph(value: unknown): value is DirectorActionGraph {
  return (
    isObject(value) &&
    isString(value.graphId) &&
    isString(value.blueprintId) &&
    isString(value.goal) &&
    isArrayOf(value.nodes, isDirectorActionNode) &&
    isArrayOf(value.edges, isDirectorActionEdge) &&
    isArrayOfStrings(value.stopConditions)
  );
}

function isDirectorOperatorPreview(value: unknown): value is DirectorOperatorPreview {
  return (
    isObject(value) &&
    isString(value.previewId) &&
    isString(value.summary) &&
    isArrayOfStrings(value.warnings) &&
    isArrayOfStrings(value.blockedReasons) &&
    isArrayOfStrings(value.requiredApprovals)
  );
}

export function isExecutionHandoffEnvelope(value: unknown): value is ExecutionHandoffEnvelope {
  return (
    isObject(value) &&
    isString(value.handoffId) &&
    isString(value.blueprintId) &&
    isString(value.createdAt) &&
    isString(value.alignmentLockId) &&
    isString(value.actionGraphId) &&
    isString(value.previewSummary) &&
    isArrayOf(value.capabilityMatches, isCapabilityMatchResult) &&
    isArrayOf(value.mediaRequests, isMediaExecutionRequest) &&
    isArrayOf(value.expectedArtifacts, isArtifactRef) &&
    isArrayOfStrings(value.chosenAdapters) &&
    isBoolean(value.sideEffectsAllowed) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}

export function isOperatorOutcome(value: unknown): value is OperatorOutcome {
  return (
    isObject(value) &&
    isString(value.outcomeId) &&
    isOneOf(value.status, OPERATOR_OUTCOME_STATUSES) &&
    isString(value.recordedAt) &&
    isOptional(value.operatorId, isString) &&
    isOptional(value.notes, isString) &&
    isOptional(value.editedFieldPaths, isArrayOfStrings) &&
    isOptional(value.acceptedArtifacts, (candidate): candidate is ArtifactRef[] =>
      isArrayOf(candidate, isArtifactRef),
    ) &&
    isOptional(value.rejectionReasons, isArrayOfStrings)
  );
}

export function isDirectorHostSnapshotEnvelope(
  value: unknown,
): value is DirectorHostSnapshotEnvelope {
  if (
    !isObject(value) ||
    !isDirectorApiVersion(value.apiVersion) ||
    !isString(value.schemaId) ||
    !isString(value.snapshotId) ||
    !isString(value.createdAt) ||
    !isObject(value.host) ||
    !isString(value.host.hostId) ||
    !isOneOf(value.host.triggerSource, HOST_TRIGGER_SOURCES) ||
    !isHostProjectSnapshot(value.project) ||
    !isHostGroupSnapshot(value.group) ||
    !isHostRuntimeState(value.runtime) ||
    !isHostExecutionIntent(value.intent)
  ) {
    return false;
  }

  return (
    isOptional(value.host.sessionId, isString) &&
    (value.locks === undefined ||
      (isObject(value.locks) && isArrayOf(value.locks.lockedFields, isHostFieldLock))) &&
    isOptional(value.knowledgeSignals, (candidate): candidate is HostKnowledgeSignal[] =>
      isArrayOf(candidate, isHostKnowledgeSignal),
    ) &&
    isOptional(value.metadata, isStringRecord)
  );
}

export function isDirectorEvaluateRequest(value: unknown): value is DirectorEvaluateRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isOptional(value.operatorId, isString)
  );
}

export function isDirectorEvaluateResponse(value: unknown): value is DirectorEvaluateResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.snapshotId) &&
    isString(value.runtimeId) &&
    isOneOf(value.decision, DIRECTOR_DECISIONS) &&
    isString(value.summary) &&
    isArrayOfStrings(value.recommendations) &&
    isDirectorPlanSummary(value.plan) &&
    isDirectorExecutionSummary(value.execution) &&
    isDirectorReviewSummary(value.review)
  );
}

export function isDirectorRuntimeResponse(value: unknown): value is DirectorRuntimeResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.runtimeId) &&
    isOneOf(value.status, RUNTIME_HEALTH_STATUSES) &&
    isString(value.workspaceRoot) &&
    isString(value.dataDir) &&
    isString(value.defaultProvider) &&
    isString(value.defaultModel) &&
    isArrayOfStrings(value.availableProviders) &&
    isNumber(value.knowledgePackCount) &&
    isArrayOfStrings(value.notes)
  );
}

function isDirectorRuntimePreflightSurface(
  value: unknown,
): value is DirectorRuntimePreflightSurface {
  return (
    isObject(value) &&
    isOneOf(value.status, DIRECTOR_RUNTIME_PREFLIGHT_STATUSES) &&
    isString(value.summaryText)
  );
}

function isDirectorRuntimePreflightAdapterCounts(
  value: unknown,
): value is DirectorRuntimePreflightAdapterCounts {
  return (
    isObject(value) &&
    isNumber(value.total) &&
    isNumber(value.host) &&
    isNumber(value.media) &&
    isNumber(value.execution) &&
    isNumber(value.enabled) &&
    isNumber(value.ready) &&
    isNumber(value.degraded) &&
    isNumber(value.offline) &&
    isNumber(value.mockOnly) &&
    isNumber(value.dryRunSupported)
  );
}

function isDirectorRuntimePreflightAdapterSurface(
  value: unknown,
): value is DirectorRuntimePreflightAdapterSurface {
  return (
    isDirectorRuntimePreflightSurface(value) &&
    isObject(value) &&
    isDirectorRuntimePreflightAdapterCounts(value.counts)
  );
}

function isDirectorRuntimePreflightRouteHint(
  value: unknown,
): value is DirectorRuntimePreflightRouteHint {
  return (
    isObject(value) &&
    isOneOf(value.method, DIRECTOR_RUNTIME_PREFLIGHT_ROUTE_METHODS) &&
    isString(value.path)
  );
}

export function isDirectorRuntimePreflightResponse(
  value: unknown,
): value is DirectorRuntimePreflightResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.runtimeId) &&
    isOneOf(value.status, DIRECTOR_RUNTIME_PREFLIGHT_STATUSES) &&
    isOneOf(value.readiness, DIRECTOR_RUNTIME_PREFLIGHT_READINESS) &&
    isString(value.summaryText) &&
    isString(value.recommendedAction) &&
    isOptional(value.recommendedCommand, isString) &&
    isOptional(value.recommendedRoute, isDirectorRuntimePreflightRouteHint) &&
    isArrayOfStrings(value.commands) &&
    isArrayOfStrings(value.notes) &&
    isObject(value.surfaces) &&
    isDirectorRuntimePreflightSurface(value.surfaces.runtime) &&
    isDirectorRuntimePreflightAdapterSurface(value.surfaces.adapters)
  );
}

export function isDirectorKnowledgePackCatalogRequest(
  value: unknown,
): value is DirectorKnowledgePackCatalogRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isOptional(value.includeDraft, isBoolean)
  );
}

export function isDirectorKnowledgePackCatalogResponse(
  value: unknown,
): value is DirectorKnowledgePackCatalogResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isArrayOf(value.knowledgePacks, isKnowledgePackCatalogEntry)
  );
}

export function isDirectorIntakeRequest(value: unknown): value is DirectorIntakeRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isDirectorIntakePayload(value.intake) &&
    isOptional(value.operatorId, isString)
  );
}

export function isDirectorIntakeResponse(value: unknown): value is DirectorIntakeResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.snapshotId) &&
    isString(value.runtimeId) &&
    isString(value.intakeId) &&
    isRuntimeCapabilitySnapshot(value.capabilitySnapshot) &&
    value.capabilitySnapshot.runtimeId === value.runtimeId &&
    isDirectorClarificationAssessment(value.clarification) &&
    isOneOf(value.alignmentState, ALIGNMENT_STATES) &&
    (value.alignmentLock === null || isAlignmentLock(value.alignmentLock)) &&
    (value.alignmentLock === null || value.alignmentLock.sourceIntakeId === value.intakeId)
  );
}

export function isDirectorClarifyRequest(value: unknown): value is DirectorClarifyRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isDirectorIntakePayload(value.intake) &&
    isArrayOf(value.answers, isDirectorClarificationAnswer) &&
    isOptional(value.operatorId, isString)
  );
}

export function isDirectorClarifyResponse(value: unknown): value is DirectorClarifyResponse {
  if (
    !isObject(value) ||
    !isDirectorApiVersion(value.apiVersion) ||
    !isString(value.snapshotId) ||
    !isString(value.runtimeId) ||
    !isString(value.intakeId) ||
    !isDirectorClarificationAssessment(value.clarification) ||
    !isOneOf(value.alignmentState, ALIGNMENT_STATES) ||
    (value.alignmentLock !== null && !isAlignmentLock(value.alignmentLock))
  ) {
    return false;
  }

  if (value.alignmentLock !== null && value.alignmentLock.sourceIntakeId !== value.intakeId) {
    return false;
  }

  if (value.alignmentState === "pending") {
    return value.alignmentLock === null;
  }

  if (value.alignmentState === "locked") {
    return value.alignmentLock !== null && value.alignmentLock.state === "locked";
  }

  return value.alignmentLock !== null && value.alignmentLock.state === "blocked";
}

export function isDirectorBlueprintRequest(value: unknown): value is DirectorBlueprintRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isDirectorIntakePayload(value.intake) &&
    isAlignmentLock(value.alignmentLock) &&
    value.alignmentLock.sourceIntakeId === value.intake.intakeId &&
    isOptional(value.capabilitySnapshot, isRuntimeCapabilitySnapshot) &&
    isOptional(value.operatorId, isString)
  );
}

export function isDirectorBlueprintResponse(value: unknown): value is DirectorBlueprintResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.snapshotId) &&
    isString(value.runtimeId) &&
    isString(value.blueprintId) &&
    isDirectorReviewSummary(value.review) &&
    isRuntimeCapabilitySnapshot(value.capabilitySnapshot) &&
    value.capabilitySnapshot.runtimeId === value.runtimeId &&
    isDirectorActionGraph(value.actionGraph) &&
    value.actionGraph.blueprintId === value.blueprintId &&
    isDirectorOperatorPreview(value.preview) &&
    isExecutionHandoffEnvelope(value.handoff) &&
    value.handoff.blueprintId === value.blueprintId &&
    value.handoff.actionGraphId === value.actionGraph.graphId
  );
}

export function isDirectorOutcomeRequest(value: unknown): value is DirectorOutcomeRequest {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.snapshotId) &&
    isString(value.blueprintId) &&
    isString(value.handoffId) &&
    isOperatorOutcome(value.outcome)
  );
}

export function isDirectorOutcomeResponse(value: unknown): value is DirectorOutcomeResponse {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.snapshotId) &&
    isString(value.blueprintId) &&
    isString(value.handoffId) &&
    isBoolean(value.stored) &&
    isOperatorOutcome(value.outcome)
  );
}

export class DirectorContractValidationError extends TypeError {
  public constructor(expectedType: string) {
    super(`Invalid ${expectedType}`);
    this.name = "DirectorContractValidationError";
  }
}

function assertWithGuard<T>(
  value: unknown,
  guard: Guard<T>,
  expectedType: string,
): asserts value is T {
  if (!guard(value)) {
    throw new DirectorContractValidationError(expectedType);
  }
}

export function assertDirectorHostSnapshotEnvelope(
  value: unknown,
): asserts value is DirectorHostSnapshotEnvelope {
  assertWithGuard(value, isDirectorHostSnapshotEnvelope, "DirectorHostSnapshotEnvelope");
}

export function assertDirectorEvaluateRequest(
  value: unknown,
): asserts value is DirectorEvaluateRequest {
  assertWithGuard(value, isDirectorEvaluateRequest, "DirectorEvaluateRequest");
}

export function assertDirectorEvaluateResponse(
  value: unknown,
): asserts value is DirectorEvaluateResponse {
  assertWithGuard(value, isDirectorEvaluateResponse, "DirectorEvaluateResponse");
}

export function assertDirectorRuntimeResponse(
  value: unknown,
): asserts value is DirectorRuntimeResponse {
  assertWithGuard(value, isDirectorRuntimeResponse, "DirectorRuntimeResponse");
}

export function assertDirectorRuntimePreflightResponse(
  value: unknown,
): asserts value is DirectorRuntimePreflightResponse {
  assertWithGuard(value, isDirectorRuntimePreflightResponse, "DirectorRuntimePreflightResponse");
}

export function assertDirectorKnowledgePackCatalogRequest(
  value: unknown,
): asserts value is DirectorKnowledgePackCatalogRequest {
  assertWithGuard(
    value,
    isDirectorKnowledgePackCatalogRequest,
    "DirectorKnowledgePackCatalogRequest",
  );
}

export function assertDirectorKnowledgePackCatalogResponse(
  value: unknown,
): asserts value is DirectorKnowledgePackCatalogResponse {
  assertWithGuard(
    value,
    isDirectorKnowledgePackCatalogResponse,
    "DirectorKnowledgePackCatalogResponse",
  );
}

export function assertArtifactRef(value: unknown): asserts value is ArtifactRef {
  assertWithGuard(value, isArtifactRef, "ArtifactRef");
}

export function assertDirectorIntakePayload(
  value: unknown,
): asserts value is DirectorIntakePayload {
  assertWithGuard(value, isDirectorIntakePayload, "DirectorIntakePayload");
}

export function assertDirectorClarificationAssessment(
  value: unknown,
): asserts value is DirectorClarificationAssessment {
  assertWithGuard(value, isDirectorClarificationAssessment, "DirectorClarificationAssessment");
}

export function assertAlignmentLock(value: unknown): asserts value is AlignmentLock {
  assertWithGuard(value, isAlignmentLock, "AlignmentLock");
}

export function assertMediaExecutionRequest(
  value: unknown,
): asserts value is MediaExecutionRequest {
  assertWithGuard(value, isMediaExecutionRequest, "MediaExecutionRequest");
}

export function assertMediaExecutionReceipt(
  value: unknown,
): asserts value is MediaExecutionReceipt {
  assertWithGuard(value, isMediaExecutionReceipt, "MediaExecutionReceipt");
}

export function assertRuntimeCapabilitySnapshot(
  value: unknown,
): asserts value is RuntimeCapabilitySnapshot {
  assertWithGuard(value, isRuntimeCapabilitySnapshot, "RuntimeCapabilitySnapshot");
}

export function assertDirectorRuntimeCapabilitySnapshotRequest(
  value: unknown,
): asserts value is DirectorRuntimeCapabilitySnapshotRequest {
  assertWithGuard(
    value,
    isDirectorRuntimeCapabilitySnapshotRequest,
    "DirectorRuntimeCapabilitySnapshotRequest",
  );
}

export function assertDirectorRuntimeCapabilitySnapshotResponse(
  value: unknown,
): asserts value is DirectorRuntimeCapabilitySnapshotResponse {
  assertWithGuard(
    value,
    isDirectorRuntimeCapabilitySnapshotResponse,
    "DirectorRuntimeCapabilitySnapshotResponse",
  );
}

export function assertDirectorActionGraph(value: unknown): asserts value is DirectorActionGraph {
  assertWithGuard(value, isDirectorActionGraph, "DirectorActionGraph");
}

export function assertExecutionHandoffEnvelope(
  value: unknown,
): asserts value is ExecutionHandoffEnvelope {
  assertWithGuard(value, isExecutionHandoffEnvelope, "ExecutionHandoffEnvelope");
}

export function assertOperatorOutcome(value: unknown): asserts value is OperatorOutcome {
  assertWithGuard(value, isOperatorOutcome, "OperatorOutcome");
}

export function assertDirectorIntakeRequest(
  value: unknown,
): asserts value is DirectorIntakeRequest {
  assertWithGuard(value, isDirectorIntakeRequest, "DirectorIntakeRequest");
}

export function assertDirectorIntakeResponse(
  value: unknown,
): asserts value is DirectorIntakeResponse {
  assertWithGuard(value, isDirectorIntakeResponse, "DirectorIntakeResponse");
}

export function assertDirectorClarifyRequest(
  value: unknown,
): asserts value is DirectorClarifyRequest {
  assertWithGuard(value, isDirectorClarifyRequest, "DirectorClarifyRequest");
}

export function assertDirectorClarifyResponse(
  value: unknown,
): asserts value is DirectorClarifyResponse {
  assertWithGuard(value, isDirectorClarifyResponse, "DirectorClarifyResponse");
}

export function assertDirectorBlueprintRequest(
  value: unknown,
): asserts value is DirectorBlueprintRequest {
  assertWithGuard(value, isDirectorBlueprintRequest, "DirectorBlueprintRequest");
}

export function assertDirectorBlueprintResponse(
  value: unknown,
): asserts value is DirectorBlueprintResponse {
  assertWithGuard(value, isDirectorBlueprintResponse, "DirectorBlueprintResponse");
}

export function assertDirectorOutcomeRequest(
  value: unknown,
): asserts value is DirectorOutcomeRequest {
  assertWithGuard(value, isDirectorOutcomeRequest, "DirectorOutcomeRequest");
}

export function assertDirectorOutcomeResponse(
  value: unknown,
): asserts value is DirectorOutcomeResponse {
  assertWithGuard(value, isDirectorOutcomeResponse, "DirectorOutcomeResponse");
}
