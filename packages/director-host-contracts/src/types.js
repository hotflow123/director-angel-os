export const DIRECTOR_HOST_API_VERSION = "director-host-api.v1";
export const DIRECTOR_DECISIONS = ["pass", "warn", "block"];
export const HOST_TRIGGER_SOURCES = ["cli", "api", "shadow"];
export const BINDING_POLICIES = ["auto", "prefer", "require"];
export const LOCK_LEVELS = ["soft_lock", "hard_lock"];
export const DIRECTOR_GENERATION_STYLES = ["standard", "immersive"];
export const DIRECTOR_GENERATION_TYPES = ["new", "extend", "edit"];
export const RUNTIME_HEALTH_STATUSES = ["ready", "degraded", "offline"];
export const DIRECTOR_RUNTIME_PREFLIGHT_STATUSES = ["pass", "warn", "fail"];
export const DIRECTOR_RUNTIME_PREFLIGHT_READINESS = ["ready", "needs-attention", "blocked"];
export const DIRECTOR_RUNTIME_PREFLIGHT_ROUTE_METHODS = ["GET", "POST"];
export const KNOWLEDGE_PACK_STAGES = ["candidate", "review", "published", "rollback"];
export const CONTINUITY_PRIORITIES = ["low", "medium", "high"];
export const DETERMINISTIC_MODES = ["safe", "balanced"];
export const DIRECTOR_CLARIFICATION_DECISIONS = ["ready", "needs_clarification", "blocked"];
export const ALIGNMENT_STATES = ["pending", "locked", "blocked"];
export const ALIGNMENT_LOCK_STATES = ["locked", "blocked"];
export const ALIGNMENT_CONSTRAINT_PRIORITIES = ["required", "preferred"];
export const CLARIFICATION_ANSWER_KINDS = [
  "text",
  "single_select",
  "multi_select",
  "boolean",
  "number",
  "artifact",
];
export const DIRECTOR_CREW_ROLES = [
  "researcher",
  "script-planner",
  "shot-planner",
  "asset-router",
  "qc-reviewer",
];
export const DIRECTOR_ACTION_CLASSES = ["read", "generate", "write", "publish"];
export const DIRECTOR_ACTION_NODE_STATUSES = ["ready", "awaiting_approval", "blocked"];
export const DIRECTOR_APPROVAL_MODES = ["auto_allow", "operator_approve", "forbidden_in_beta1"];
export const OPERATOR_OUTCOME_STATUSES = ["accepted", "edited", "rejected", "abandoned"];
export const ADAPTER_KINDS = ["host", "media", "execution"];
export const RUNTIME_CAPABILITY_ADAPTER_BRIDGE_KINDS = ["http-json"];
export const RUNTIME_CAPABILITY_ADAPTER_BRIDGE_AUTH_MODES = ["none", "static", "env"];
export const ARTIFACT_KINDS = ["text", "image", "video", "audio", "document", "json"];
export const ARTIFACT_SOURCES = [
  "host_input",
  "user_upload",
  "workspace",
  "generated",
  "external_url",
  "inline",
];
export const MEDIA_EXECUTION_MODES = ["text_to_image", "text_to_video", "image_to_video"];
export const MEDIA_OUTPUT_ARTIFACT_KINDS = ["image", "video"];
export const COST_CLASSES = ["low", "medium", "high", "premium"];
export const LATENCY_CLASSES = ["interactive", "batch", "slow"];
export const SAFETY_TIERS = ["standard", "restricted", "strict"];
export const CAPABILITY_MATCH_STATUSES = ["matched", "partial", "blocked", "no_match"];
export const MEDIA_EXECUTION_STATUSES = [
  "accepted",
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
];
export const MEDIA_FAILURE_CATEGORIES = [
  "validation",
  "routing",
  "adapter_unavailable",
  "provider_error",
  "timeout",
  "policy_blocked",
  "unknown",
];
const isString = (value) => typeof value === "string";
const isBoolean = (value) => typeof value === "boolean";
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isOneOf = (value, allowed) => isString(value) && allowed.includes(value);
const isArrayOf = (value, guard) => Array.isArray(value) && value.every(guard);
const isArrayOfStrings = (value) => isArrayOf(value, isString);
const isStringRecord = (value) => isObject(value) && Object.values(value).every(isString);
const isOptional = (value, guard) => value === undefined || guard(value);
const hasDefinedValue = (...values) => values.some((value) => value !== undefined);
export function isDirectorApiVersion(value) {
  return value === DIRECTOR_HOST_API_VERSION;
}
function isHostProjectSnapshot(value) {
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
function isHostGroupSnapshot(value) {
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
    isOptional(value.generationStyle, (candidate) =>
      isOneOf(candidate, DIRECTOR_GENERATION_STYLES),
    ) && isOptional(value.totalDurationSeconds, isNumber)
  );
}
function isHostRuntimeState(value) {
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
function isHostExecutionIntent(value) {
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
function isHostFieldLock(value) {
  return (
    isObject(value) &&
    isString(value.field) &&
    isOneOf(value.level, LOCK_LEVELS) &&
    isOptional(value.reason, isString)
  );
}
function isHostKnowledgeSignal(value) {
  return (
    isObject(value) &&
    isString(value.id) &&
    isString(value.description) &&
    isNumber(value.confidence) &&
    isOptional(value.tags, isArrayOfStrings)
  );
}
function isDirectorPlanSummary(value) {
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
function isDirectorExecutionSummary(value) {
  return (
    isObject(value) &&
    isString(value.executionId) &&
    isOneOf(value.selectedGenerationType, DIRECTOR_GENERATION_TYPES) &&
    isOneOf(value.selectedGenerationStyle, DIRECTOR_GENERATION_STYLES) &&
    isString(value.visiblePrompt)
  );
}
function isDirectorReviewSummary(value) {
  return (
    isObject(value) &&
    isOneOf(value.overallDecision, DIRECTOR_DECISIONS) &&
    isArrayOfStrings(value.blockingReasons) &&
    isArrayOfStrings(value.requiredFixes) &&
    isOptional(value.warnings, isArrayOfStrings)
  );
}
function isKnowledgePackCatalogEntry(value) {
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
function isDirectorAlignmentConstraint(value) {
  return (
    isObject(value) &&
    isString(value.field) &&
    isString(value.requirement) &&
    isOneOf(value.priority, ALIGNMENT_CONSTRAINT_PRIORITIES) &&
    isOptional(value.rationale, isString)
  );
}
export function isArtifactRef(value) {
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
export function isDirectorIntakePayload(value) {
  return (
    isObject(value) &&
    isString(value.intakeId) &&
    isString(value.submittedAt) &&
    isString(value.objective) &&
    isOptional(value.desiredOutcome, isString) &&
    isOptional(value.deliverables, isArrayOfStrings) &&
    isOptional(value.audience, isString) &&
    isOptional(value.styleNotes, isArrayOfStrings) &&
    isOptional(value.constraints, (candidate) =>
      isArrayOf(candidate, isDirectorAlignmentConstraint),
    ) &&
    isOptional(value.nonGoals, isArrayOfStrings) &&
    isOptional(value.references, (candidate) => isArrayOf(candidate, isArtifactRef)) &&
    isOptional(value.notes, isArrayOfStrings) &&
    isOptional(value.metadata, isStringRecord)
  );
}
function isDirectorClarificationQuestionOption(value) {
  return (
    isObject(value) &&
    isString(value.value) &&
    isString(value.label) &&
    isOptional(value.description, isString)
  );
}
function isDirectorClarificationQuestion(value) {
  return (
    isObject(value) &&
    isString(value.questionId) &&
    isString(value.prompt) &&
    isOptional(value.rationale, isString) &&
    isBoolean(value.required) &&
    isOneOf(value.answerKind, CLARIFICATION_ANSWER_KINDS) &&
    isArrayOfStrings(value.affectsFields) &&
    isOptional(value.options, (candidate) =>
      isArrayOf(candidate, isDirectorClarificationQuestionOption),
    )
  );
}
export function isDirectorClarificationAssessment(value) {
  return (
    isObject(value) &&
    isOneOf(value.decision, DIRECTOR_CLARIFICATION_DECISIONS) &&
    isString(value.summary) &&
    isArrayOfStrings(value.missingFields) &&
    isArrayOfStrings(value.conflictingFields) &&
    isArrayOf(value.questions, isDirectorClarificationQuestion)
  );
}
function isDirectorClarificationAnswer(value) {
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
    isOptional(value.artifacts, (candidate) => isArrayOf(candidate, isArtifactRef))
  );
}
export function isAlignmentLock(value) {
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
function isDirectorBudgetLimit(value) {
  return (
    isObject(value) &&
    isOptional(value.currency, isString) &&
    isOptional(value.maxCost, isNumber) &&
    isOptional(value.costClass, (candidate) => isOneOf(candidate, COST_CLASSES))
  );
}
function isAdapterProfileRef(value) {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isString(value.profileId) &&
    isOptional(value.displayName, isString)
  );
}
function isMediaOutputContract(value) {
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
export function isMediaExecutionRequest(value) {
  return (
    isObject(value) &&
    isString(value.requestId) &&
    isOneOf(value.mode, MEDIA_EXECUTION_MODES) &&
    isString(value.objective) &&
    isOptional(value.prompt, isString) &&
    isArrayOfStrings(value.requiredCapabilities) &&
    isOptional(value.preferredCapabilities, isArrayOfStrings) &&
    isOptional(value.lockedConstraints, (candidate) =>
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
function isMediaExecutionJobHandle(value) {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isOptional(value.providerJobId, isString) &&
    isOptional(value.statusUrl, isString) &&
    isOptional(value.cancelToken, isString)
  );
}
function isMediaExecutionAuditEntry(value) {
  return isObject(value) && isString(value.at) && isString(value.event) && isString(value.message);
}
export function isMediaExecutionReceipt(value) {
  return (
    isObject(value) &&
    isString(value.receiptId) &&
    isString(value.requestId) &&
    isOneOf(value.status, MEDIA_EXECUTION_STATUSES) &&
    isMediaExecutionJobHandle(value.jobHandle) &&
    isArrayOf(value.artifacts, isArtifactRef) &&
    isArrayOfStrings(value.warnings) &&
    isOptional(value.failureCategory, (candidate) =>
      isOneOf(candidate, MEDIA_FAILURE_CATEGORIES),
    ) &&
    isOptional(value.retryable, isBoolean) &&
    isArrayOf(value.auditTrail, isMediaExecutionAuditEntry)
  );
}
function isMediaCapabilityProfile(value) {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    value.adapterKind === "media" &&
    isString(value.provider) &&
    isOptional(value.modelFamily, isString) &&
    isOptional(value.modelVersion, isString) &&
    isOptional(value.capabilityVersion, isString) &&
    isArrayOf(value.supportedModes, (candidate) => isOneOf(candidate, MEDIA_EXECUTION_MODES)) &&
    isArrayOf(value.inputModalities, (candidate) => isOneOf(candidate, ARTIFACT_KINDS)) &&
    isArrayOf(value.outputArtifactTypes, (candidate) =>
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
    isOptional(value.costClass, (candidate) => isOneOf(candidate, COST_CLASSES)) &&
    isOptional(value.latencyClass, (candidate) => isOneOf(candidate, LATENCY_CLASSES)) &&
    isOptional(value.safetyTier, (candidate) => isOneOf(candidate, SAFETY_TIERS)) &&
    isOptional(value.regionOrDataPolicy, isString) &&
    isOneOf(value.healthStatus, RUNTIME_HEALTH_STATUSES)
  );
}
function isRuntimeCapabilityAdapter(value) {
  return (
    isObject(value) &&
    isString(value.adapterId) &&
    isOneOf(value.adapterKind, ADAPTER_KINDS) &&
    isString(value.provider) &&
    isBoolean(value.enabled) &&
    isOneOf(value.healthStatus, RUNTIME_HEALTH_STATUSES) &&
    isBoolean(value.dryRunSupported) &&
    isBoolean(value.mockOnly) &&
    isOptional(value.bridge, isRuntimeCapabilityAdapterBridge) &&
    isOptional(value.supportedActionClasses, (candidate) =>
      isArrayOf(candidate, (item) => isOneOf(item, DIRECTOR_ACTION_CLASSES)),
    ) &&
    isOptional(value.availableProfiles, (candidate) => isArrayOf(candidate, isAdapterProfileRef)) &&
    (value.mediaCapability === undefined ||
      (value.adapterKind === "media" &&
        isMediaCapabilityProfile(value.mediaCapability) &&
        value.mediaCapability.adapterId === value.adapterId)) &&
    isOptional(value.notes, isArrayOfStrings)
  );
}
function isRuntimeCapabilityAdapterBridge(value) {
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
export function isRuntimeCapabilitySnapshot(value) {
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
export function isDirectorRuntimeCapabilitySnapshotRequest(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.runtimeId) &&
    isOptional(value.hostId, isString) &&
    isOptional(value.sessionId, isString) &&
    isOptional(value.adapterKinds, (candidate) =>
      isArrayOf(candidate, (item) => isOneOf(item, ADAPTER_KINDS)),
    ) &&
    isOptional(value.includeDisabled, isBoolean) &&
    isOptional(value.includeMockOnly, isBoolean)
  );
}
export function isDirectorRuntimeCapabilitySnapshotResponse(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.runtimeId) &&
    isRuntimeCapabilitySnapshot(value.capabilitySnapshot) &&
    value.capabilitySnapshot.runtimeId === value.runtimeId
  );
}
function isCapabilityMatchResult(value) {
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
function isDirectorActionNode(value) {
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
    isOptional(value.status, (candidate) => isOneOf(candidate, DIRECTOR_ACTION_NODE_STATUSES)) &&
    isOptional(value.selectedAdapter, (candidate) => candidate === null || isString(candidate)) &&
    isOptional(value.blockingReason, isString)
  );
}
function isDirectorActionEdge(value) {
  return (
    isObject(value) &&
    isString(value.fromNodeId) &&
    isString(value.toNodeId) &&
    isOptional(value.artifactId, isString) &&
    isString(value.handoffContract) &&
    isBoolean(value.blocking)
  );
}
export function isDirectorActionGraph(value) {
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
function isDirectorOperatorPreview(value) {
  return (
    isObject(value) &&
    isString(value.previewId) &&
    isString(value.summary) &&
    isArrayOfStrings(value.warnings) &&
    isArrayOfStrings(value.blockedReasons) &&
    isArrayOfStrings(value.requiredApprovals)
  );
}
export function isExecutionHandoffEnvelope(value) {
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
export function isOperatorOutcome(value) {
  return (
    isObject(value) &&
    isString(value.outcomeId) &&
    isOneOf(value.status, OPERATOR_OUTCOME_STATUSES) &&
    isString(value.recordedAt) &&
    isOptional(value.operatorId, isString) &&
    isOptional(value.notes, isString) &&
    isOptional(value.editedFieldPaths, isArrayOfStrings) &&
    isOptional(value.acceptedArtifacts, (candidate) => isArrayOf(candidate, isArtifactRef)) &&
    isOptional(value.rejectionReasons, isArrayOfStrings)
  );
}
export function isDirectorHostSnapshotEnvelope(value) {
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
    isOptional(value.knowledgeSignals, (candidate) =>
      isArrayOf(candidate, isHostKnowledgeSignal),
    ) &&
    isOptional(value.metadata, isStringRecord)
  );
}
export function isDirectorEvaluateRequest(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isOptional(value.operatorId, isString)
  );
}
export function isDirectorEvaluateResponse(value) {
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
export function isDirectorRuntimeResponse(value) {
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
function isDirectorRuntimePreflightSurface(value) {
  return (
    isObject(value) &&
    isOneOf(value.status, DIRECTOR_RUNTIME_PREFLIGHT_STATUSES) &&
    isString(value.summaryText)
  );
}
function isDirectorRuntimePreflightAdapterCounts(value) {
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
function isDirectorRuntimePreflightAdapterSurface(value) {
  return (
    isDirectorRuntimePreflightSurface(value) &&
    isObject(value) &&
    isDirectorRuntimePreflightAdapterCounts(value.counts)
  );
}
function isDirectorRuntimePreflightRouteHint(value) {
  return (
    isObject(value) &&
    isOneOf(value.method, DIRECTOR_RUNTIME_PREFLIGHT_ROUTE_METHODS) &&
    isString(value.path)
  );
}
export function isDirectorRuntimePreflightResponse(value) {
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
export function isDirectorKnowledgePackCatalogRequest(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isOptional(value.includeDraft, isBoolean)
  );
}
export function isDirectorKnowledgePackCatalogResponse(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isArrayOf(value.knowledgePacks, isKnowledgePackCatalogEntry)
  );
}
export function isDirectorIntakeRequest(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isDirectorIntakePayload(value.intake) &&
    isOptional(value.operatorId, isString)
  );
}
export function isDirectorIntakeResponse(value) {
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
export function isDirectorClarifyRequest(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isDirectorHostSnapshotEnvelope(value.snapshot) &&
    isDirectorIntakePayload(value.intake) &&
    isArrayOf(value.answers, isDirectorClarificationAnswer) &&
    isOptional(value.operatorId, isString)
  );
}
export function isDirectorClarifyResponse(value) {
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
export function isDirectorBlueprintRequest(value) {
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
export function isDirectorBlueprintResponse(value) {
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
export function isDirectorOutcomeRequest(value) {
  return (
    isObject(value) &&
    isDirectorApiVersion(value.apiVersion) &&
    isString(value.snapshotId) &&
    isString(value.blueprintId) &&
    isString(value.handoffId) &&
    isOperatorOutcome(value.outcome)
  );
}
export function isDirectorOutcomeResponse(value) {
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
  constructor(expectedType) {
    super(`Invalid ${expectedType}`);
    this.name = "DirectorContractValidationError";
  }
}
function assertWithGuard(value, guard, expectedType) {
  if (!guard(value)) {
    throw new DirectorContractValidationError(expectedType);
  }
}
export function assertDirectorHostSnapshotEnvelope(value) {
  assertWithGuard(value, isDirectorHostSnapshotEnvelope, "DirectorHostSnapshotEnvelope");
}
export function assertDirectorEvaluateRequest(value) {
  assertWithGuard(value, isDirectorEvaluateRequest, "DirectorEvaluateRequest");
}
export function assertDirectorEvaluateResponse(value) {
  assertWithGuard(value, isDirectorEvaluateResponse, "DirectorEvaluateResponse");
}
export function assertDirectorRuntimeResponse(value) {
  assertWithGuard(value, isDirectorRuntimeResponse, "DirectorRuntimeResponse");
}
export function assertDirectorRuntimePreflightResponse(value) {
  assertWithGuard(value, isDirectorRuntimePreflightResponse, "DirectorRuntimePreflightResponse");
}
export function assertDirectorKnowledgePackCatalogRequest(value) {
  assertWithGuard(
    value,
    isDirectorKnowledgePackCatalogRequest,
    "DirectorKnowledgePackCatalogRequest",
  );
}
export function assertDirectorKnowledgePackCatalogResponse(value) {
  assertWithGuard(
    value,
    isDirectorKnowledgePackCatalogResponse,
    "DirectorKnowledgePackCatalogResponse",
  );
}
export function assertArtifactRef(value) {
  assertWithGuard(value, isArtifactRef, "ArtifactRef");
}
export function assertDirectorIntakePayload(value) {
  assertWithGuard(value, isDirectorIntakePayload, "DirectorIntakePayload");
}
export function assertDirectorClarificationAssessment(value) {
  assertWithGuard(value, isDirectorClarificationAssessment, "DirectorClarificationAssessment");
}
export function assertAlignmentLock(value) {
  assertWithGuard(value, isAlignmentLock, "AlignmentLock");
}
export function assertMediaExecutionRequest(value) {
  assertWithGuard(value, isMediaExecutionRequest, "MediaExecutionRequest");
}
export function assertMediaExecutionReceipt(value) {
  assertWithGuard(value, isMediaExecutionReceipt, "MediaExecutionReceipt");
}
export function assertRuntimeCapabilitySnapshot(value) {
  assertWithGuard(value, isRuntimeCapabilitySnapshot, "RuntimeCapabilitySnapshot");
}
export function assertDirectorRuntimeCapabilitySnapshotRequest(value) {
  assertWithGuard(
    value,
    isDirectorRuntimeCapabilitySnapshotRequest,
    "DirectorRuntimeCapabilitySnapshotRequest",
  );
}
export function assertDirectorRuntimeCapabilitySnapshotResponse(value) {
  assertWithGuard(
    value,
    isDirectorRuntimeCapabilitySnapshotResponse,
    "DirectorRuntimeCapabilitySnapshotResponse",
  );
}
export function assertDirectorActionGraph(value) {
  assertWithGuard(value, isDirectorActionGraph, "DirectorActionGraph");
}
export function assertExecutionHandoffEnvelope(value) {
  assertWithGuard(value, isExecutionHandoffEnvelope, "ExecutionHandoffEnvelope");
}
export function assertOperatorOutcome(value) {
  assertWithGuard(value, isOperatorOutcome, "OperatorOutcome");
}
export function assertDirectorIntakeRequest(value) {
  assertWithGuard(value, isDirectorIntakeRequest, "DirectorIntakeRequest");
}
export function assertDirectorIntakeResponse(value) {
  assertWithGuard(value, isDirectorIntakeResponse, "DirectorIntakeResponse");
}
export function assertDirectorClarifyRequest(value) {
  assertWithGuard(value, isDirectorClarifyRequest, "DirectorClarifyRequest");
}
export function assertDirectorClarifyResponse(value) {
  assertWithGuard(value, isDirectorClarifyResponse, "DirectorClarifyResponse");
}
export function assertDirectorBlueprintRequest(value) {
  assertWithGuard(value, isDirectorBlueprintRequest, "DirectorBlueprintRequest");
}
export function assertDirectorBlueprintResponse(value) {
  assertWithGuard(value, isDirectorBlueprintResponse, "DirectorBlueprintResponse");
}
export function assertDirectorOutcomeRequest(value) {
  assertWithGuard(value, isDirectorOutcomeRequest, "DirectorOutcomeRequest");
}
export function assertDirectorOutcomeResponse(value) {
  assertWithGuard(value, isDirectorOutcomeResponse, "DirectorOutcomeResponse");
}
//# sourceMappingURL=types.js.map
