export type LockLevel = "soft_lock" | "hard_lock";
export type ReviewStatus = "pass" | "warn" | "block";
export type PlanStatus = "ready" | "review_required" | "blocked";
export type BindingPolicy = "auto" | "prefer" | "require";
export type DirectorGenerationStyle = "standard" | "immersive";
export type DirectorGenerationType = "new" | "extend" | "edit";
export type TriggerSource = "cli" | "api" | "shadow";
export type RuntimeHealthStatus = "ready" | "degraded" | "offline";
export type AlignmentState = "aligned" | "clarification_required" | "blocked";
export type AlignmentLockStatus = "locked" | "pending" | "blocked";
export type CrewRole =
  | "researcher"
  | "script-planner"
  | "shot-planner"
  | "asset-router"
  | "qc-reviewer";
export type ActionClass = "read" | "generate" | "route" | "review" | "write" | "publish";
export type ApprovalMode = "auto-allow" | "operator-approve" | "forbidden-in-beta1";
export type BlueprintStatus = "planned" | "blocked";
export type CapabilityScope = "image" | "video" | "hybrid" | "internal";
export type CapabilityStatus = "ready" | "degraded" | "blocked";
export type RouteDecisionStatus = "selected" | "degraded" | "blocked" | "no-match";
export type ActionNodeStatus = "ready" | "awaiting_approval" | "blocked";
export type PolicySafetyDecision = "allow" | "review_required" | "block";
export type HandoffStatus = "preview_ready" | "handoff_ready" | "blocked";
export type ArtifactKind = "brief" | "outline" | "routing" | "review" | "prompt" | "unknown";
export type DirectorControlStatus =
  | "clarification_required"
  | "blocked"
  | "ready_for_preview"
  | "ready_for_handoff";

export interface DirectorRequestMeta {
  requestId: string;
  projectId: string;
  groupId: string;
  timestamp: string;
  triggerSource: TriggerSource;
}

export interface DirectorProjectInfo {
  title?: string;
  outline?: string;
  genre?: string[];
  continuityPriority?: "low" | "medium" | "high";
}

export interface DirectorGroupInfo {
  groupId: string;
  generationStyle?: DirectorGenerationStyle;
  generationType: DirectorGenerationType;
  sceneCount: number;
  anchorIds: string[];
  totalDurationSeconds?: number;
}

export interface DirectorRuntimeCapabilities {
  runtimeId: string;
  status: RuntimeHealthStatus;
  availableBindings: string[];
  maxPromptChars: number;
  supportsVideo: boolean;
  deterministicMode?: "safe" | "balanced";
}

export interface DirectorExecutionIntent {
  bindingPolicy: BindingPolicy;
  preferredImageBinding?: string;
  preferredVideoBinding?: string;
  requiredImageBinding?: string;
  requiredVideoBinding?: string;
  fallbackBindings?: string[];
}

export interface DirectorFieldLock {
  field: string;
  level: LockLevel;
  reason?: string;
}

export interface DirectorUserLocks {
  lockedFields: DirectorFieldLock[];
}

export interface DirectorKnowledgeSignal {
  id: string;
  description: string;
  confidence: number;
  tags: string[];
}

export interface DirectorContext {
  request: DirectorRequestMeta;
  project: DirectorProjectInfo;
  group: DirectorGroupInfo;
  runtime: DirectorRuntimeCapabilities;
  intent: DirectorExecutionIntent;
  locks?: DirectorUserLocks;
  knowledgeSignals?: DirectorKnowledgeSignal[];
}

export interface RuntimeCapabilityDescriptor {
  capabilityId: string;
  adapterId: string;
  bindingId: string;
  scope: CapabilityScope;
  status: CapabilityStatus;
  supportsDeterministicMode: boolean;
  supportedActionClasses: ActionClass[];
  reason: string;
}

export interface RuntimeCapabilitySnapshot {
  snapshotId: string;
  runtimeId: string;
  capturedAt: string;
  runtimeStatus: RuntimeHealthStatus;
  maxPromptChars: number;
  supportsVideo: boolean;
  deterministicMode?: "safe" | "balanced";
  availableBindings: string[];
  capabilityTags: string[];
  capabilities: RuntimeCapabilityDescriptor[];
  notes: string[];
}

export interface ClarificationQuestion {
  questionId: string;
  field: string;
  prompt: string;
  reason: string;
  required: boolean;
}

export interface ClarificationDecision {
  decisionId: string;
  alignmentState: AlignmentState;
  summary: string;
  questions: ClarificationQuestion[];
  blockingReasons: string[];
  satisfiedSignals: string[];
  missingSignals: string[];
}

export interface AlignmentConstraint {
  constraintId: string;
  field: string;
  level: LockLevel;
  source: "user_lock" | "runtime_guardrail" | "director_guardrail";
  value: string;
  reason?: string;
}

export interface AlignmentLock {
  lockId: string;
  status: AlignmentLockStatus;
  goal: string;
  deliverable: string;
  alignmentState: AlignmentState;
  lockedConstraints: AlignmentConstraint[];
  unresolvedQuestionIds: string[];
  lockedAt: string;
  notes: string[];
}

export interface ModeDecision {
  selectedGenerationStyle: DirectorGenerationStyle;
  whySelected: string;
  fallbackGenerationStyle?: DirectorGenerationStyle;
  rejectedStyles: DirectorGenerationStyle[];
}

export interface ModelRoutingDecision {
  selectedImageBinding: string | null;
  selectedVideoBinding: string | null;
  bindingPolicy: BindingPolicy;
  whySelected: string;
}

export interface DirectorPlan {
  planId: string;
  version: "v1";
  status: PlanStatus;
  summary: string;
  confidence: number;
  riskFlags: string[];
  modeDecision: ModeDecision;
  modelRoutingDecision: ModelRoutingDecision;
  reviewStatus: ReviewStatus;
  createdAt: string;
  capabilitySnapshotId: string;
  alignmentState: AlignmentState;
  alignmentLockId?: string;
  blueprintId?: string;
}

export type ExecutionPromptVisibility = "visible" | "hidden";

export interface ExecutionPromptSection {
  id: string;
  visibility: ExecutionPromptVisibility;
  content: string;
}

export interface ExecutionPromptBundle {
  visible: string;
  hidden?: string;
  sections?: readonly ExecutionPromptSection[];
}

export interface ExecutionPlan {
  executionId: string;
  planId: string;
  groupId: string;
  selectedGenerationStyle: DirectorGenerationStyle;
  selectedGenerationType: DirectorGenerationType;
  selectedImageBinding: string | null;
  selectedVideoBinding: string | null;
  prompt: ExecutionPromptBundle;
  reviewStatus: ReviewStatus;
  intent: DirectorExecutionIntent;
  blueprintId?: string;
  actionGraphId?: string;
  handoffEnvelopeId?: string;
}

export type ReviewGate = "runtime" | "alignment" | "continuity" | "binding" | "locks";

export interface ReviewGateResult {
  gate: ReviewGate;
  status: ReviewStatus;
  score: number;
  reason: string;
  requiredFix?: string;
}

export interface ReviewReport {
  overallDecision: ReviewStatus;
  gates: ReviewGateResult[];
  blockingReasons: string[];
  requiredFixes: string[];
}

export interface DirectorDecisionRecord {
  decisionId: string;
  stage: "capability_snapshot" | "alignment" | "review" | "routing" | "safety";
  summary: string;
  rationale: string;
}

export interface BlueprintArtifactRef {
  artifactId: string;
  label: string;
  kind: ArtifactKind;
  contract: string;
}

export interface AssignmentInputContract {
  name: string;
  source: "host" | "director" | "assignment";
  description: string;
  required: boolean;
  artifactId?: string;
}

export interface AssignmentOutputContract {
  name: string;
  description: string;
  artifact: BlueprintArtifactRef;
}

export interface AssignmentFallbackPolicy {
  strategy: "retry_same_role" | "reassign" | "stop";
  reason: string;
}

export interface AssignmentEscalation {
  when: string;
  action: "replan" | "block" | "operator_review";
  reason: string;
}

export interface CrewAssignment {
  assignmentId: string;
  role: CrewRole;
  objective: string;
  assignedCapability: string;
  inputs: AssignmentInputContract[];
  outputs: AssignmentOutputContract[];
  deliverable: string;
  acceptanceCriteria: string[];
  constraints: string[];
  dependsOn: string[];
  allowedAdapters: string[];
  actionClass: ActionClass;
  approvalMode: ApprovalMode;
  budgetLimit: number | null;
  timeoutMs: number;
  maxDelegationDepth: number;
  fallbackPolicy: AssignmentFallbackPolicy;
  escalationToDirector: AssignmentEscalation;
}

export interface CrewHandoff {
  fromAssignmentId: string;
  toAssignmentId: string;
  artifact: BlueprintArtifactRef;
  handoffContract: string;
  blocking: boolean;
}

export interface ExecutionBlueprint {
  blueprintId: string;
  status: BlueprintStatus;
  goal: string;
  lockedConstraints: AlignmentConstraint[];
  directorDecisions: DirectorDecisionRecord[];
  assignments: CrewAssignment[];
  handoffs: CrewHandoff[];
  globalFailurePolicy: {
    blockOnLockedConstraintViolation: boolean;
    blockOnMissingCapability: boolean;
    replanOnDependencyFailure: boolean;
  };
  replanTriggers: string[];
  stopConditions: string[];
}

export interface AdapterRouteDecision {
  assignmentId: string;
  adapterId: string | null;
  adapterKind: "internal" | "media";
  routeStatus: RouteDecisionStatus;
  reason: string;
  dryRunOnly: boolean;
}

export interface ActionGraphNode {
  nodeId: string;
  assignmentId: string;
  role: CrewRole;
  title: string;
  actionClass: ActionClass;
  approvalMode: ApprovalMode;
  selectedAdapterId: string | null;
  dependsOn: string[];
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  status: ActionNodeStatus;
}

export interface ActionGraphEdge {
  fromNodeId: string;
  toNodeId: string;
  artifactId: string;
  blocking: boolean;
}

export interface ActionGraph {
  graphId: string;
  blueprintId: string;
  routeDecisions: AdapterRouteDecision[];
  nodes: ActionGraphNode[];
  edges: ActionGraphEdge[];
  blockedReasons: string[];
  previewSummary: string[];
}

export interface PolicySafetyGateResult {
  gateId: string;
  decision: PolicySafetyDecision;
  reasons: string[];
  requiredApprovals: string[];
}

export interface OperatorPreview {
  headline: string;
  summaryLines: string[];
  blockedReasons: string[];
  requiredApprovals: string[];
}

export interface ExecutionHandoffItem {
  assignmentId: string;
  role: CrewRole;
  deliverable: string;
  actionClass: ActionClass;
  selectedAdapterId: string | null;
  approvalMode: ApprovalMode;
  dependsOn: string[];
  constraints: string[];
}

export interface ExecutionHandoffEnvelope {
  envelopeId: string;
  status: HandoffStatus;
  planId: string;
  blueprintId: string;
  actionGraphId: string;
  capabilitySnapshotId: string;
  alignmentLockId: string;
  operatorPreview: OperatorPreview;
  safetyGate: PolicySafetyGateResult;
  handoffItems: ExecutionHandoffItem[];
  blockedReasons: string[];
  createdAt: string;
}

export interface DirectorControlResult {
  controlId: string;
  status: DirectorControlStatus;
  capabilitySnapshot: RuntimeCapabilitySnapshot;
  clarification: ClarificationDecision;
  alignmentLock: AlignmentLock;
  plan: DirectorPlan;
  review: ReviewReport;
  blueprint?: ExecutionBlueprint;
  actionGraph?: ActionGraph;
  safetyGate?: PolicySafetyGateResult;
  handoffEnvelope?: ExecutionHandoffEnvelope;
}
