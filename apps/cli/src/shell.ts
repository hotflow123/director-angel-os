import { isAbsolute, resolve } from "node:path";
import {
  buildSafeRewriteObjective,
  evaluateProductionContentSafety,
  getChannelCommandDefinitionsForSurface,
  humanizeProductionResultText,
  isLowAdmissionText,
  parseExplicitProductionObjective,
  parseNaturalDirectorProductionObjective,
} from "@hotflow/channels-core";
import { type HotflowConfig, loadConfig } from "@hotflow/config";
import { type ContractError, isContractError } from "@hotflow/contracts";
import type { ExecutionRun, ExecutionRunReport } from "@hotflow/director-execution-contracts";
import type {
  DirectorBlueprintResponse,
  DirectorClarificationAssessment,
  DirectorClarifyResponse,
  DirectorEvaluateResponse,
  DirectorHostAgentOsSubagentSchedulerDispatchBatch,
  DirectorHostAgentOsSubagentSchedulerDispatchPlan,
  DirectorHostAgentOsSubagentSchedulerTick,
  DirectorIntakeResponse,
  DirectorOutcomeResponse,
  DirectorRuntimeCapabilitySnapshotResponse,
} from "@hotflow/director-host-contracts";
import type { DirectorRecallQuery } from "@hotflow/director-memory-contracts";
import {
  DIRECTOR_FEATURE_SWITCH_KEYS,
  type DirectorApiProviderSettingKey,
  type DirectorFeatureSwitchKey,
  loadDirectorApiProviderConfig,
  loadDirectorSwitchState,
  testDirectorApiProviderConnection,
  updateDirectorApiProviderSetting,
  writeDirectorFeatureOverride,
} from "@hotflow/director-runtime";
import { resolveDirectorWorkspace } from "@hotflow/director-workspace";
import { isEngineRunFailure } from "@hotflow/engine";
import { toModelProviderRuntimeFailureSurface } from "@hotflow/models";
import {
  type SurfaceTurnReasoningInput,
  createSurfaceTurnReasoningInput,
} from "@hotflow/runtime-bootstrap";
import { bootstrapCli } from "./bootstrap.js";
import {
  parseDirectorAcceptanceArgs,
  renderDirectorAcceptanceReport,
  renderDirectorAcceptanceUsage,
  runDirectorAcceptance,
} from "./director-acceptance.js";
import {
  explainDirectorAdapter,
  registerDirectorAdapterManifest,
  setDirectorAdapterEnabled,
} from "./director-adapters.js";
import { bootstrapDirectorWorkspace } from "./director-bootstrap.js";
import { describeDirectorBridgeFailureNextAction } from "./director-bridge-failure-guidance.js";
import {
  parseDirectorDoctorArgs,
  renderDirectorDoctorReport,
  renderDirectorDoctorUsage,
  runDirectorDoctor,
} from "./director-doctor.js";
import {
  type DirectorEntryMessageResult,
  renderDirectorEntryMessageResult,
  sendDirectorEntryMessage,
} from "./director-entry.js";
import {
  evaluateSnapshotWithDirector,
  fetchDirectorRunReport,
  fetchDirectorRunStatus,
  fetchDirectorRuntimeSnapshot,
  submitDirectorBlueprint,
  submitDirectorClarify,
  submitDirectorIntake,
  submitDirectorOutcome,
  submitDirectorRunAbort,
  submitDirectorRunApprove,
  submitDirectorRunCreate,
  submitDirectorRunPause,
  submitDirectorRunReroute,
  submitDirectorRunResume,
  submitDirectorRunRetry,
  submitDirectorRunStart,
} from "./director-evaluate.js";
import {
  acceptDirectorExperienceCandidate,
  acceptDirectorKnowledgeCandidate,
  classifyDirectorExperienceCandidate,
  createDirectorExperienceFromTraceProposal,
  createDirectorReflectionFromRunReport,
  describeDirectorHeartbeatStatus,
  describeDirectorKnowledgeStatus,
  diffDirectorKnowledgeCandidate,
  explainDirectorExperienceCandidate,
  explainDirectorKnowledgeCandidate,
  explainDirectorKnowledgePack,
  formatDirectorDailySelfReflectionReport,
  learnDirectorExperience,
  listDirectorExperienceCandidates,
  listDirectorKnowledgeCandidates,
  listDirectorKnowledgePacks,
  previewDirectorKnowledgeRecall,
  promoteDirectorExperienceCandidate,
  publishDirectorKnowledgeCandidate,
  rejectDirectorExperienceCandidate,
  rejectDirectorKnowledgeCandidate,
  reviewDirectorKnowledgeCandidate,
  rollbackDirectorKnowledgePack,
  runDirectorDailySelfReflection,
  runDirectorHeartbeat,
  syncDirectorKnowledgeCandidateFromProposal,
  tagDirectorExperienceCandidate,
  viewDirectorSoul,
} from "./director-knowledge.js";
import { describeDirectorMemoryStatus, previewDirectorMemoryRecall } from "./director-memory.js";
import {
  acceptDirectorTraceProposal,
  describeDirectorTraceProposalStatus,
  explainDirectorTraceProposal,
  listDirectorTraceProposals,
  previewDirectorTraceProposal,
  rejectDirectorTraceProposal,
  replayDirectorTraceProposal,
  reviewDirectorTraceProposalForOperator,
} from "./director-proposals.js";
import {
  deriveDirectorRouteHealthEntries,
  summarizeDirectorRouteHealthForDoctor,
} from "./director-route-health.js";
import { renderDirectorRunAudit } from "./director-run-audit.js";
import { renderDirectorRunExplanation } from "./director-run-explain.js";
import {
  countDirectorRunAssignments,
  deriveDirectorRunHoldingStateSurface,
} from "./director-run-holding-state.js";
import {
  renderDirectorAdapterInventory,
  renderDirectorSwitchSummary,
} from "./director-runtime-report.js";
import { resolveDirectorCliSharedCommandArgs } from "./director-shared-cli-commands.js";
import {
  acceptDirectorSkillProposal,
  applyDirectorSkillProposal,
  classifyDirectorSkill,
  listDirectorSkills,
  proposeDirectorSkillFromExperience,
  rejectDirectorSkillProposal,
  tagDirectorSkill,
} from "./director-skills.js";
import { describeDirectorStatus } from "./director-status.js";
import { DIRECTOR_V1_ACTIONS, renderDirectorV1Usage, runDirectorV1Command } from "./director-v1.js";
import {
  parseDoctorArgs,
  renderDoctorFailure,
  renderDoctorReport,
  renderDoctorUsage,
  runCliDoctorViaControlPlane,
} from "./doctor.js";
import {
  type PromptInspectRuntimeDegradation,
  type PromptInspectSectionSummary,
  type PromptLatestTurnReasoningSummary,
  type PromptSessionGuidanceSource,
  type PromptSessionGuidanceSourceSummary,
  type PromptSessionGuidanceSummary,
  type SessionGuidanceControlSummary,
  type SessionObservationPromptSummary,
  type SessionObservationSnapshot,
  type SessionPromptExplainSnapshot,
  type SessionPromptInspectSnapshot,
  type SessionResumeSnapshot,
  type ToolOutcomeSummary,
  coerceSessionObservationSnapshot,
  coerceSessionPromptExplainSnapshot,
  coerceSessionPromptInspectSnapshot,
  coerceSessionResumeSnapshot,
  createSessionObservationSnapshot,
  createSessionResumeSnapshot,
  deriveRuntimeStatus,
  formatToolOutcomeSummary,
  summarizeStepReplayToolOutcomes,
} from "./session-observation.js";

export { deriveRuntimeStatus, formatToolOutcomeSummary, summarizeStepReplayToolOutcomes };

type CliCommand =
  | "help"
  | "golden-path"
  | "preflight"
  | "run"
  | "control"
  | "resume"
  | "status"
  | "task"
  | "doctor"
  | "onboard"
  | "director";
interface ParsedCliInput {
  readonly command: CliCommand;
  readonly args: readonly string[];
}

interface ParsedOnboardInput {
  readonly format: "text" | "json";
  readonly help: boolean;
  readonly sessionId?: string;
}

type ParsedOnboardArgsResult =
  | { readonly ok: true; readonly value: ParsedOnboardInput }
  | { readonly ok: false; readonly error: string };

interface OnboardModule {
  parseOnboardArgs(args: readonly string[]): ParsedOnboardArgsResult;
  renderOnboardUsage(): string;
  renderOnboardingReport(report: unknown, format: "text" | "json"): string;
  renderOnboardingFailure(error: unknown, format: "text" | "json"): string;
}

interface ParsedPreflightInput {
  readonly format: "text" | "json";
  readonly help: boolean;
}

type ParsedPreflightArgsResult =
  | { readonly ok: true; readonly value: ParsedPreflightInput }
  | { readonly ok: false; readonly error: string };

interface PreflightModule {
  parsePreflightArgs(args: readonly string[]): ParsedPreflightArgsResult;
  renderPreflightUsage(): string;
  renderPreflightReport(report: unknown, format: "text" | "json"): string;
  renderPreflightFailure(error: unknown, format: "text" | "json"): string;
  runCliPreflightViaControlPlane(options?: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly sessionId?: string;
    readonly createControlPlane?: (options: {
      readonly cwd?: string;
      readonly env?: NodeJS.ProcessEnv;
    }) => {
      dispatch(action: {
        readonly type: "onboarding-status";
        readonly sessionId: string;
      }): Promise<{ readonly ok: boolean; readonly data?: unknown; readonly error?: string }>;
    };
  }): Promise<{ readonly status: "pass" | "warn" | "fail" }>;
}

interface DirectorWorkerModule {
  runDirectorWorkerOnce(
    input: {
      readonly runId: string;
      readonly workerId: string;
    },
    options?: {
      readonly env?: NodeJS.ProcessEnv;
    },
  ): Promise<{
    readonly run: ExecutionRun;
    readonly report: ExecutionRunReport;
    readonly executedAssignments: readonly string[];
  }>;
  runDirectorWorkerCli(
    argv: readonly string[],
    options?: {
      readonly env?: NodeJS.ProcessEnv;
      readonly io?: {
        readonly stdout: (message: string) => void;
        readonly stderr: (message: string) => void;
      };
    },
  ): Promise<number>;
}

interface DirectorRunOnceExecutionResult {
  readonly run: ExecutionRun;
  readonly report: ExecutionRunReport;
  readonly executedAssignments: readonly string[];
}

type OnboardReportStatus = "pass" | "warn" | "fail";
type OnboardModuleLoader = () => Promise<OnboardModule>;
type PreflightModuleLoader = () => Promise<PreflightModule>;
type DirectorWorkerModuleLoader = () => Promise<DirectorWorkerModule>;

const defaultOnboardModuleLoader: OnboardModuleLoader = async () => {
  const modulePath = "./onboard.js";
  return (await import(modulePath)) as OnboardModule;
};

const defaultPreflightModuleLoader: PreflightModuleLoader = async () => {
  const modulePath = "./preflight.js";
  return (await import(modulePath)) as PreflightModule;
};

const defaultDirectorWorkerModuleLoader: DirectorWorkerModuleLoader = async () => {
  const moduleUrl = import.meta.url.endsWith(".ts")
    ? new URL("../../director-worker/src/main.ts", import.meta.url)
    : new URL("../../director-worker/dist/main.js", import.meta.url);
  return (await import(moduleUrl.href)) as DirectorWorkerModule;
};

let onboardModuleLoader: OnboardModuleLoader = defaultOnboardModuleLoader;
let preflightModuleLoader: PreflightModuleLoader = defaultPreflightModuleLoader;
let directorWorkerModuleLoader: DirectorWorkerModuleLoader = defaultDirectorWorkerModuleLoader;

export function setOnboardModuleLoaderForTests(loader?: OnboardModuleLoader): void {
  onboardModuleLoader = loader ?? defaultOnboardModuleLoader;
}

export function setPreflightModuleLoaderForTests(loader?: PreflightModuleLoader): void {
  preflightModuleLoader = loader ?? defaultPreflightModuleLoader;
}

export function setDirectorWorkerModuleLoaderForTests(loader?: DirectorWorkerModuleLoader): void {
  directorWorkerModuleLoader = loader ?? defaultDirectorWorkerModuleLoader;
}

export interface ParsedRunInput {
  readonly userText: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly sessionId?: string;
  readonly maxSteps?: number;
  readonly tokenBudget?: number;
}

type ParsedRunArgsResult =
  | { readonly ok: true; readonly value: ParsedRunInput }
  | { readonly ok: false; readonly error: string };

type RunFailureClass = "transient" | "fatal";
type RunFailureStage =
  | "generate"
  | "stream"
  | "model"
  | "runtime"
  | "tool"
  | "policy"
  | "reasoning";

interface RunFailureSurface {
  readonly failureClass: RunFailureClass;
  readonly kind: string;
  readonly action: string;
  readonly providerId: string;
  readonly model: string;
  readonly stage: RunFailureStage;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly operatorVisible?: boolean;
}

export interface ParsedStatusInput {
  readonly sessionId: string;
  readonly turnId?: string;
  readonly limit?: number;
}

type ParsedStatusArgsResult =
  | { readonly ok: true; readonly value: ParsedStatusInput }
  | { readonly ok: false; readonly error: string };

type ControlMemoryScope = "working" | "episodic" | "all";

interface ParsedCompactControlAction {
  readonly type: "compact";
  readonly sessionId: string;
  readonly strategy?: "soft" | "hard";
}

interface ParsedResumeControlAction {
  readonly type: "resume";
  readonly sessionId: string;
  readonly checkpointId?: number;
}

interface ParsedRewindControlAction {
  readonly type: "rewind";
  readonly sessionId: string;
  readonly checkpointId?: number;
}

interface ParsedPromptInspectControlAction {
  readonly type: "prompt-inspect";
  readonly sessionId: string;
  readonly turnId?: string;
  readonly stepIndex?: number;
}

interface ParsedPromptExplainControlAction {
  readonly type: "prompt-explain";
  readonly sessionId: string;
  readonly turnId?: string;
  readonly stepIndex?: number;
}

interface ParsedOutputStyleControlAction {
  readonly type: "output-style";
  readonly sessionId: string;
  readonly style: string;
}

interface ParsedPermissionsControlAction {
  readonly type: "permissions";
  readonly sessionId: string;
  readonly mode: string;
}

interface ParsedLanguageControlAction {
  readonly type: "language";
  readonly sessionId: string;
  readonly language: string;
}

interface ParsedMemoryInspectControlAction {
  readonly type: "memory-inspect";
  readonly sessionId: string;
  readonly scope?: ControlMemoryScope;
}

interface ParsedMemoryClearControlAction {
  readonly type: "memory-clear";
  readonly sessionId: string;
  readonly scope?: ControlMemoryScope;
}

type ParsedControlAction =
  | ParsedCompactControlAction
  | ParsedResumeControlAction
  | ParsedRewindControlAction
  | ParsedPromptInspectControlAction
  | ParsedPromptExplainControlAction
  | ParsedOutputStyleControlAction
  | ParsedPermissionsControlAction
  | ParsedLanguageControlAction
  | ParsedMemoryInspectControlAction
  | ParsedMemoryClearControlAction;

type ParsedControlArgsResult =
  | { readonly ok: true; readonly value: ParsedControlAction }
  | { readonly ok: false; readonly error: string };

type DelegationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type DelegationSpecialization = "explore" | "plan" | "verify" | "general";
type VerificationStatus = "pending" | "passed" | "failed" | "partial";
type ProposalStatus = "pending" | "accepted" | "rejected" | "applied" | "expired";

interface ParsedTaskStatusAction {
  readonly type: "task-status";
  readonly sessionId: string;
}

interface ParsedTaskWorkerMailboxAction {
  readonly type: "task-worker-mailbox";
  readonly sessionId: string;
  readonly workerId?: string;
}

interface ParsedTaskVerifierMailboxAction {
  readonly type: "task-verifier-mailbox";
  readonly sessionId: string;
  readonly verifierId?: string;
}

interface ParsedDelegationEnqueueAction {
  readonly type: "delegation-enqueue";
  readonly sessionId: string;
  readonly delegation: {
    readonly id: string;
    readonly workerId: string;
    readonly instruction: string;
    readonly taskId?: string;
    readonly specialization?: DelegationSpecialization;
    readonly targetAgent?: string;
    readonly verificationRequest?: DelegationVerificationRequestSnapshot;
  };
}

interface ParsedDelegationStatusAction {
  readonly type: "delegation-status";
  readonly sessionId: string;
  readonly update: {
    readonly id: string;
    readonly status: DelegationStatus;
    readonly error?: string;
  };
}

interface ParsedVerificationUpsertAction {
  readonly type: "verification-upsert";
  readonly sessionId: string;
  readonly verification: {
    readonly id: string;
    readonly verifierId: string;
    readonly requirement: string;
    readonly status?: VerificationStatus;
    readonly taskId?: string;
    readonly verdictSummary?: string;
  };
}

interface ParsedProposalEnqueueAction {
  readonly type: "proposal-enqueue";
  readonly sessionId: string;
  readonly proposal: {
    readonly id: string;
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly sourceSessionId: string;
    readonly sourceTurnId: string;
    readonly provenance: string;
    readonly expiresAtMs?: number;
  };
}

interface ParsedProposalTransitionAction {
  readonly type: "proposal-transition";
  readonly sessionId: string;
  readonly proposalId: string;
  readonly status: ProposalStatus;
  readonly decisionNote?: string;
}

interface ParsedProposalGetAction {
  readonly type: "proposal-get";
  readonly sessionId: string;
  readonly proposalId: string;
}

interface ParsedProposalListAction {
  readonly type: "proposal-list";
  readonly sessionId: string;
  readonly status?: ProposalStatus;
  readonly limit?: number;
}

interface ParsedProposalReviewAction {
  readonly type: "proposal-review";
  readonly sessionId: string;
  readonly proposalId: string;
}

interface ParsedProposalAcceptAction {
  readonly type: "proposal-accept";
  readonly sessionId: string;
  readonly proposalId: string;
  readonly decisionNote?: string;
}

interface ParsedProposalRejectAction {
  readonly type: "proposal-reject";
  readonly sessionId: string;
  readonly proposalId: string;
  readonly decisionNote?: string;
}

interface ParsedProposalExplainAction {
  readonly type: "proposal-explain";
  readonly sessionId: string;
  readonly proposalId: string;
}

interface ParsedProposalPreviewAction {
  readonly type: "proposal-preview";
  readonly sessionId: string;
  readonly proposalId: string;
}

interface ParsedProposalApplyAction {
  readonly type: "proposal-apply";
  readonly sessionId: string;
  readonly proposalId: string;
}

interface ParsedProposalRollbackAction {
  readonly type: "proposal-rollback";
  readonly sessionId: string;
  readonly version?: number;
}

interface ParsedProposalOutboxDrainAction {
  readonly type: "proposal-outbox-drain";
  readonly sessionId: string;
  readonly limit?: number;
}

type ParsedTaskAction =
  | ParsedTaskStatusAction
  | ParsedTaskWorkerMailboxAction
  | ParsedTaskVerifierMailboxAction
  | ParsedDelegationEnqueueAction
  | ParsedDelegationStatusAction
  | ParsedVerificationUpsertAction
  | ParsedProposalEnqueueAction
  | ParsedProposalTransitionAction
  | ParsedProposalListAction
  | ParsedProposalGetAction
  | ParsedProposalReviewAction
  | ParsedProposalAcceptAction
  | ParsedProposalRejectAction
  | ParsedProposalExplainAction
  | ParsedProposalPreviewAction
  | ParsedProposalApplyAction
  | ParsedProposalRollbackAction
  | ParsedProposalOutboxDrainAction;

type ParsedTaskArgsResult =
  | { readonly ok: true; readonly value: ParsedTaskAction }
  | { readonly ok: false; readonly error: string };

interface TaskLifecycleSnapshot {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly todoStatus?: string;
  readonly assignedAgent?: string;
  readonly verificationVerdict?: string;
  readonly latestDelegationId?: string;
  readonly latestVerificationId?: string;
}

interface TaskNotificationSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly recipientKind: string;
  readonly recipientId: string;
  readonly status: string;
  readonly summary: string;
  readonly taskId?: string;
  readonly delegationId?: string;
  readonly verificationId?: string;
  readonly acknowledgedAtMs?: number;
}

interface DelegationVerificationRequestSnapshot {
  readonly verifierId: string;
  readonly requirement: string;
  readonly verificationId?: string;
}

interface TaskBackedSubagentVerificationSnapshot {
  readonly verificationId: string;
  readonly verifierId: string;
  readonly status: string;
  readonly verdict?: string;
  readonly verdictSummary?: string;
  readonly requirement: string;
}

interface TaskBackedParentVisibleSubagentResultSnapshot {
  readonly status: string;
  readonly summary?: string;
  readonly verificationVerdict?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: "patch" | "diff" | "artifact";
}

interface TaskBackedSubagentSchedulingSnapshot {
  readonly parallelGroup?: string;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: "patch" | "diff" | "artifact";
  readonly undeclaredObservedWriteSet?: readonly string[];
  readonly observedConflictWith?: readonly string[];
  readonly canRunInParallel: boolean;
  readonly conflictsWith: readonly string[];
  readonly conflictReason?: string;
  readonly parallelBatch: number;
  readonly scheduleOrder: number;
  readonly readyToStart: boolean;
  readonly blockedBy: readonly string[];
}

interface TaskBackedSubagentRunSnapshot {
  readonly subagentId: string;
  readonly parentTurnId: string;
  readonly profileId: string;
  readonly workerId: string;
  readonly taskId?: string;
  readonly status: string;
  readonly role: DelegationSpecialization | "general";
  readonly targetAgent?: string;
  readonly isolatedContext: boolean;
  readonly instruction: string;
  readonly contextSnapshot?: string;
  readonly resultSummary?: string;
  readonly observedWriteSet?: readonly string[];
  readonly observedWriteSetSource?: "patch" | "diff" | "artifact";
  readonly verification?: TaskBackedSubagentVerificationSnapshot;
  readonly parentVisibleResult: TaskBackedParentVisibleSubagentResultSnapshot;
  readonly scheduling?: TaskBackedSubagentSchedulingSnapshot;
}

interface TaskBackedSubagentSchedulerHeartbeatSnapshot {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1";
  readonly parentTurnId?: string;
  readonly totalSubagentRuns: number;
  readonly queuedCount: number;
  readonly runningCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly schedulerTrackedCount: number;
  readonly readyCount: number;
  readonly blockedCount: number;
  readonly unscheduledQueuedCount: number;
  readonly nextReadySubagentIds: readonly string[];
  readonly blockedSubagentIds: readonly string[];
  readonly runningSubagentIds: readonly string[];
  readonly nextParallelBatch?: number;
  readonly canContinue: boolean;
  readonly stoppedReason: "ready" | "scheduler-blocked" | "mailbox-empty";
  readonly heartbeatOrdinal: number;
  readonly latestUpdatedAtMs?: number;
}

interface TaskBackedSubagentSchedulerDispatchWriteSetSnapshot {
  readonly subagentId: string;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
}

interface TaskBackedSubagentSchedulerDispatchBatchSnapshot {
  readonly parallelBatch: number;
  readonly subagentIds: readonly string[];
  readonly workerIds: readonly string[];
  readonly writeSets: readonly TaskBackedSubagentSchedulerDispatchWriteSetSnapshot[];
}

interface TaskBackedSubagentSchedulerDispatchPlanSnapshot {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1";
  readonly parentTurnId?: string;
  readonly planOrdinal: number;
  readonly heartbeatOrdinal: number;
  readonly canDispatch: boolean;
  readonly dispatchReason: "ready" | "scheduler-blocked" | "mailbox-empty";
  readonly maxDispatchableCount: number;
  readonly dispatchableSubagentIds: readonly string[];
  readonly dispatchBatches: readonly TaskBackedSubagentSchedulerDispatchBatchSnapshot[];
  readonly blockedSubagentIds: readonly string[];
  readonly runningSubagentIds: readonly string[];
}

interface TaskBackedSubagentSchedulerTickIntentSnapshot {
  readonly intentId: string;
  readonly delegationId: string;
  readonly workerId: string;
  readonly command: "run-delegation";
  readonly argv: readonly string[];
  readonly parallelBatch: number;
  readonly writeSet: readonly string[];
  readonly writeSetSource?: "explicit" | "inferred";
}

interface TaskBackedSubagentSchedulerTickSnapshot {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1";
  readonly sessionId: string;
  readonly latestTurnId: string | null;
  readonly dispatchIntents: readonly TaskBackedSubagentSchedulerTickIntentSnapshot[];
  readonly claimDryRun: true;
}

interface TaskBackedSubagentSchedulerRecoveryEvidenceSnapshot {
  readonly blockedBy: readonly string[];
  readonly conflictsWith: readonly string[];
  readonly observedConflictWith?: readonly string[];
}

interface TaskBackedSubagentSchedulerRecoveryActionSnapshot {
  readonly actionId: string;
  readonly subagentId: string;
  readonly actionType: "wait-for-running-subagent" | "review-observed-write-set";
  readonly severity: "info" | "warning";
  readonly reason: string;
  readonly relatedSubagentIds: readonly string[];
  readonly writeSet: readonly string[];
  readonly observedWriteSet?: readonly string[];
  readonly undeclaredObservedWriteSet?: readonly string[];
  readonly evidence: TaskBackedSubagentSchedulerRecoveryEvidenceSnapshot;
  readonly operatorSummary: string;
}

interface TaskBackedSubagentSchedulerRecoveryGroupSnapshot {
  readonly groupId: string;
  readonly groupType: "write-set-overlap" | "observed-write-set-overlap";
  readonly severity: "info" | "warning";
  readonly reason: string;
  readonly actionIds: readonly string[];
  readonly subagentIds: readonly string[];
  readonly runningSubagentIds: readonly string[];
  readonly blockedSubagentIds: readonly string[];
  readonly completedSubagentIds: readonly string[];
  readonly writeSet: readonly string[];
  readonly observedWriteSet?: readonly string[];
  readonly undeclaredObservedWriteSet?: readonly string[];
  readonly operatorSummary: string;
}

interface TaskBackedSubagentSchedulerRecoveryPlanSnapshot {
  readonly schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1";
  readonly parentTurnId?: string;
  readonly canRecover: boolean;
  readonly blockedSubagentIds: readonly string[];
  readonly conflictedSubagentIds: readonly string[];
  readonly recoveryActions: readonly TaskBackedSubagentSchedulerRecoveryActionSnapshot[];
  readonly recoveryGroups: readonly TaskBackedSubagentSchedulerRecoveryGroupSnapshot[];
  readonly recoveryOrdinal: number;
}

interface TaskOperationsSnapshot {
  readonly schemaVersion: string;
  readonly todos: {
    readonly items: ReadonlyArray<{
      readonly id: string;
      readonly content: string;
      readonly status: string;
    }>;
  };
  readonly delegation: ReadonlyArray<{
    readonly id: string;
    readonly workerId: string;
    readonly status: string;
    readonly taskId?: string;
    readonly specialization?: DelegationSpecialization;
    readonly targetAgent?: string;
    readonly verificationRequest?: DelegationVerificationRequestSnapshot;
  }>;
  readonly verification: ReadonlyArray<{
    readonly id: string;
    readonly verifierId: string;
    readonly status: string;
    readonly taskId?: string;
  }>;
  readonly proposalQueue: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly status: string;
    readonly provenance: string;
  }>;
  readonly proposalOutbox: ReadonlyArray<{
    readonly id: string;
    readonly eventType: string;
    readonly proposalId: string;
    readonly status: string;
  }>;
  readonly notifications?: ReadonlyArray<TaskNotificationSnapshot>;
  readonly lifecycle?: ReadonlyArray<TaskLifecycleSnapshot>;
  readonly subagentRuns?: ReadonlyArray<TaskBackedSubagentRunSnapshot>;
  readonly subagentSchedulerHeartbeat?: TaskBackedSubagentSchedulerHeartbeatSnapshot;
  readonly subagentSchedulerDispatchPlan?: TaskBackedSubagentSchedulerDispatchPlanSnapshot;
  readonly subagentSchedulerTick?: TaskBackedSubagentSchedulerTickSnapshot;
  readonly subagentSchedulerRecoveryPlan?: TaskBackedSubagentSchedulerRecoveryPlanSnapshot;
}

interface TaskWorkerMailboxItemSnapshot {
  readonly id: string;
  readonly workerId: string;
  readonly instruction: string;
  readonly status: string;
  readonly taskId?: string;
  readonly specialization?: DelegationSpecialization;
  readonly targetAgent?: string;
  readonly verificationRequest?: DelegationVerificationRequestSnapshot;
  readonly notificationId?: string;
  readonly notificationStatus?: string;
  readonly notificationSummary?: string;
}

interface TaskWorkerMailboxSnapshot {
  readonly workerId?: string;
  readonly mailboxSize: number;
  readonly notificationCount: number;
  readonly coverage: string;
  readonly delegationIds: ReadonlyArray<string>;
  readonly notificationIds: ReadonlyArray<string>;
  readonly unnotifiedDelegationIds: ReadonlyArray<string>;
  readonly orphanNotificationIds: ReadonlyArray<string>;
  readonly items: ReadonlyArray<TaskWorkerMailboxItemSnapshot>;
  readonly notifications: ReadonlyArray<TaskNotificationSnapshot>;
}

interface TaskVerifierMailboxItemSnapshot {
  readonly id: string;
  readonly verifierId: string;
  readonly requirement: string;
  readonly status: string;
  readonly taskId?: string;
  readonly notificationId?: string;
  readonly notificationStatus?: string;
  readonly notificationSummary?: string;
}

interface TaskVerifierMailboxSnapshot {
  readonly verifierId?: string;
  readonly mailboxSize: number;
  readonly notificationCount: number;
  readonly coverage: string;
  readonly verificationIds: ReadonlyArray<string>;
  readonly notificationIds: ReadonlyArray<string>;
  readonly unnotifiedVerificationIds: ReadonlyArray<string>;
  readonly orphanNotificationIds: ReadonlyArray<string>;
  readonly items: ReadonlyArray<TaskVerifierMailboxItemSnapshot>;
  readonly notifications: ReadonlyArray<TaskNotificationSnapshot>;
}

interface ProposalRecordSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sourceSessionId: string;
  readonly sourceTurnId: string;
  readonly provenance: string;
  readonly decisionNote?: string;
}

interface ProposalListEntrySnapshot {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly provenance?: string;
  readonly riskLevel?: string;
  readonly confidence?: number;
}

interface ProposalReviewSnapshot {
  readonly proposalId: string;
  readonly verdict: string;
  readonly decisionNote: string;
  readonly summary: {
    readonly fatal: number;
    readonly risky: number;
    readonly warning: number;
    readonly info: number;
  };
  readonly issues: ReadonlyArray<{
    readonly code: string;
    readonly field: string;
    readonly message: string;
    readonly severity: string;
  }>;
}

interface ProposalExplainSnapshot {
  readonly proposalId: string;
  readonly kind: string;
  readonly status: string;
  readonly provenance?: string;
  readonly trajectoryRef?: string;
  readonly trigger?: string;
  readonly evidenceSummary?: string;
  readonly riskLevel?: string;
  readonly confidence?: number;
  readonly dedupeKey?: string;
  readonly explanation?: string;
}

interface ProposalPreviewSnapshot {
  readonly proposalId: string;
  readonly proposalStatus: string;
  readonly skillId: string;
  readonly operation: string;
  readonly currentHeadVersion: number;
  readonly nextHeadVersion: number;
  readonly changedFields: ReadonlyArray<{
    readonly field: string;
  }>;
  readonly summary: string;
}

interface ProposalRollbackSnapshot {
  readonly currentVersionBefore: number;
  readonly restoredFromVersion: number;
  readonly currentVersionAfter: number;
  readonly previousSnapshotVersion?: number | null;
  readonly approvedSkillCount: number;
  readonly restoredSkillIds: ReadonlyArray<string>;
}

interface ControlPlaneDispatchResult {
  readonly ok: boolean;
  readonly action?: string;
  readonly data?: unknown;
  readonly error?: string;
}

interface ControlPlaneLike {
  dispatch(
    action: Record<string, unknown>,
  ): Promise<ControlPlaneDispatchResult> | ControlPlaneDispatchResult;
}

function hasExplicitPathHint(text: string): boolean {
  return (
    /\bread\s+["']?(?:\/|[a-z]:\\)/iu.test(text) ||
    /\bpath["':\s]+["']?(?:\/|[a-z]:\\)/iu.test(text)
  );
}

export function resolveWorkspacePath(workspaceRoot: string, inputPath: string): string {
  return isAbsolute(inputPath) ? inputPath : resolve(workspaceRoot, inputPath);
}

export function prepareRunUserText(
  providerId: string,
  userText: string,
  workspaceRoot: string,
): string {
  if (providerId !== "scripted") {
    return userText;
  }

  if (hasExplicitPathHint(userText)) {
    return userText;
  }

  return `${userText}\nRead ${workspaceRoot}/README.md before responding.`;
}

function createCliWorkbenchTurnReasoningInput(
  overrides: SurfaceTurnReasoningInput = {},
): SurfaceTurnReasoningInput {
  return createSurfaceTurnReasoningInput("cli-workbench", overrides);
}

function resolveProviderSelectionError(
  providerId: string,
  providerIds: readonly string[],
): string | undefined {
  if (providerIds.includes(providerId)) {
    return undefined;
  }

  const lines = [`Provider "${providerId}" is not registered.`];
  if (providerId === "openai-compatible") {
    lines.push("Hint: set HOTFLOW_OPENAI_BASE_URL to enable the OpenAI-compatible provider.");
  }
  lines.push(`Available providers: ${providerIds.join(", ")}`);
  return lines.join("\n");
}

function classifyRunFailure(error: unknown, providerId: string, model: string): RunFailureSurface {
  if (isEngineRunFailure(error)) {
    return {
      failureClass: error.failure.failureClass,
      kind: error.failure.kind,
      action: error.failure.action,
      providerId: error.failure.providerId,
      model: error.model,
      stage: error.failure.providerStage,
      code: error.failure.providerCode,
      message: error.failure.error.message,
      retryable: error.failure.retryable,
      ...(error.failure.statusCode !== undefined ? { statusCode: error.failure.statusCode } : {}),
      ...(error.failure.operatorVisible === undefined
        ? {}
        : { operatorVisible: error.failure.operatorVisible }),
    };
  }

  if (isContractError(error)) {
    return classifyContractRunFailure(error, providerId, model);
  }

  const failure = toModelProviderRuntimeFailureSurface(error);
  return {
    failureClass: failure.failureClass,
    kind: failure.kind,
    action: failure.action,
    providerId: failure.providerId === "unknown" ? providerId : failure.providerId,
    model,
    stage: failure.providerStage,
    code: failure.providerCode,
    message: failure.error.message,
    retryable: failure.retryable,
    ...(failure.statusCode !== undefined ? { statusCode: failure.statusCode } : {}),
    ...(failure.operatorVisible === undefined ? {} : { operatorVisible: failure.operatorVisible }),
  };
}

function classifyContractRunFailure(
  error: ContractError,
  providerId: string,
  model: string,
): RunFailureSurface {
  const metadata = error.metadata;
  const kind = typeof metadata?.kind === "string" ? metadata.kind : error.kind;
  const action = typeof metadata?.action === "string" ? metadata.action : error.defaultAction;
  const resolvedProviderId =
    typeof metadata?.providerId === "string" ? metadata.providerId : providerId;
  const stage = readRunFailureStage(metadata);
  const code = typeof metadata?.providerCode === "string" ? metadata.providerCode : error.code;
  const retryable = typeof metadata?.retryable === "boolean" ? metadata.retryable : error.retryable;
  const failureClass: RunFailureClass =
    kind === "provider-transient" || action === "failover" ? "transient" : "fatal";
  const statusCode = typeof metadata?.statusCode === "number" ? metadata.statusCode : undefined;
  const operatorVisible =
    typeof metadata?.operatorVisible === "boolean" ? metadata.operatorVisible : undefined;

  return {
    failureClass,
    kind,
    action,
    providerId: resolvedProviderId,
    model,
    stage,
    code,
    message: error.message,
    retryable,
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(operatorVisible === undefined ? {} : { operatorVisible }),
  };
}

function readRunFailureStage(
  metadata: Readonly<Record<string, unknown>> | undefined,
): RunFailureStage {
  if (metadata?.providerStage === "stream") {
    return "stream";
  }
  if (metadata?.providerStage === "generate") {
    return "generate";
  }
  if (
    metadata?.stage === "model" ||
    metadata?.stage === "runtime" ||
    metadata?.stage === "tool" ||
    metadata?.stage === "policy" ||
    metadata?.stage === "reasoning" ||
    metadata?.stage === "stream"
  ) {
    return metadata.stage;
  }
  return "generate";
}

function recordRunFailure(
  telemetry: ReturnType<typeof bootstrapCli>["telemetry"],
  sessionId: string,
  turnId: string,
  failure: RunFailureSurface,
  kind: "cli.run.failed" | "cli.resume.failed" = "cli.run.failed",
): void {
  telemetry.recordAuditEvent({
    sessionId,
    turnId,
    kind,
    payload: {
      providerId: failure.providerId,
      model: failure.model,
      failureClass: failure.failureClass,
      kind: failure.kind,
      action: failure.action,
      code: failure.code,
      message: failure.message,
      retryable: failure.retryable,
      ...(failure.statusCode !== undefined ? { statusCode: failure.statusCode } : {}),
    },
  });
}

function renderRunFailure(sessionId: string, failure: RunFailureSurface): void {
  process.stdout.write(`Session: ${sessionId}\n`);
  process.stdout.write(`Provider: ${failure.providerId}\n`);
  process.stdout.write(`Model: ${failure.model}\n`);
  process.stdout.write(`Failure class: ${failure.failureClass}\n`);
  process.stdout.write(`Failure code: ${failure.code}\n`);
  process.stdout.write(`Recommended action: ${failure.action}\n`);
  process.stdout.write(`Retryable: ${failure.retryable ? "yes" : "no"}\n`);
  process.stdout.write(`Error: ${failure.message}\n`);
}

export async function startCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { command, args } = parseCliInput(argv);

  if (command === "help") {
    process.stdout.write(renderHelp());
    return;
  }

  if (command === "director") {
    await runDirectorCommand(args);
    return;
  }

  if (command === "doctor") {
    const parsed = parseDoctorArgs(args);
    if (!parsed.ok) {
      process.stdout.write(`${parsed.error}\n${renderDoctorUsage()}\n`);
      process.exitCode = 1;
      return;
    }

    if (parsed.value.help) {
      process.stdout.write(`${renderDoctorUsage()}\n`);
      return;
    }

    try {
      const report = await runCliDoctorViaControlPlane();
      process.stdout.write(renderDoctorReport(report, parsed.value.format));
      if (report.status === "fail") {
        process.exitCode = 1;
      }
    } catch (error) {
      process.stdout.write(renderDoctorFailure(error, parsed.value.format));
      process.exitCode = 1;
    }
    return;
  }

  if (command === "preflight") {
    const preflight = await preflightModuleLoader();
    const parsed = preflight.parsePreflightArgs(args);
    if (!parsed.ok) {
      process.stdout.write(`${parsed.error}\n${preflight.renderPreflightUsage()}\n`);
      process.exitCode = 1;
      return;
    }

    if (parsed.value.help) {
      process.stdout.write(`${preflight.renderPreflightUsage()}\n`);
      return;
    }

    try {
      const report = await preflight.runCliPreflightViaControlPlane();
      process.stdout.write(preflight.renderPreflightReport(report, parsed.value.format));
      if (report.status === "fail") {
        process.exitCode = 1;
      }
    } catch (error) {
      process.stdout.write(preflight.renderPreflightFailure(error, parsed.value.format));
      process.exitCode = 1;
    }
    return;
  }

  const runtime = bootstrapCli() as ReturnType<typeof bootstrapCli> & {
    readonly controlPlane?: ControlPlaneLike;
  };
  const { config, engine, sessionStore, telemetry, controlPlane, providerIds } = runtime;

  try {
    switch (command) {
      case "golden-path": {
        const targetPath = args[0]
          ? resolveWorkspacePath(config.workspaceRoot, args[0])
          : `${config.workspaceRoot}/package.json`;
        const result = await engine.runTurn({
          userText: `Read ${targetPath}, summarize the project, and write 3 todo steps.`,
          providerId: config.defaultProvider,
          model: config.defaultModel,
          ...createCliWorkbenchTurnReasoningInput(),
        });

        process.stdout.write(`Session: ${result.sessionId}\n`);
        process.stdout.write(`Output: ${result.output}\n`);
        process.stdout.write("Todos:\n");
        result.taskState.items.forEach((item, index) => {
          process.stdout.write(`  ${index + 1}. ${item.content}\n`);
        });
        telemetry.recordAuditEvent({
          sessionId: result.sessionId,
          kind: "cli.golden_path.completed",
          payload: {
            providerId: config.defaultProvider,
            model: config.defaultModel,
            todoCount: result.taskState.items.length,
            targetPath,
          },
        });
        return;
      }
      case "run": {
        const parsed = parseRunArgs(args);
        if (!parsed.ok) {
          process.stdout.write(`${parsed.error}\n${renderRunUsage()}\n`);
          return;
        }

        const providerId = parsed.value.providerId ?? config.defaultProvider;
        const model = parsed.value.model ?? config.defaultModel;
        const providerError = resolveProviderSelectionError(providerId, providerIds);
        if (providerError) {
          process.stdout.write(`${providerError}\n`);
          process.exitCode = 1;
          return;
        }

        const session =
          (parsed.value.sessionId ? sessionStore.getSession(parsed.value.sessionId) : null) ??
          sessionStore.createSession(
            parsed.value.sessionId ? { sessionId: parsed.value.sessionId } : {},
          );
        const turnId = `turn_${Date.now()}`;
        const userText = prepareRunUserText(
          providerId,
          parsed.value.userText,
          config.workspaceRoot,
        );
        try {
          const result = await engine.runTurn({
            sessionId: session.sessionId,
            turnId,
            userText,
            providerId,
            model,
            ...createCliWorkbenchTurnReasoningInput(),
            ...(parsed.value.maxSteps !== undefined ? { maxSteps: parsed.value.maxSteps } : {}),
            ...(parsed.value.tokenBudget !== undefined
              ? { tokenBudget: parsed.value.tokenBudget }
              : {}),
          });

          process.stdout.write(`Session: ${result.sessionId}\n`);
          process.stdout.write(`Provider: ${providerId}\n`);
          process.stdout.write(`Model: ${model}\n`);
          process.stdout.write(`Output: ${result.output}\n`);
          if (result.taskState.items.length > 0) {
            process.stdout.write("Todos:\n");
            result.taskState.items.forEach((item, index) => {
              process.stdout.write(`  ${index + 1}. ${item.content}\n`);
            });
          }
          const toolOutcomes = summarizeRunToolOutcomes(result.toolResults);
          if (toolOutcomes.total > 0) {
            process.stdout.write(`Tool outcomes: ${formatToolOutcomeSummary(toolOutcomes)}\n`);
            process.stdout.write(`Runtime status: ${deriveRuntimeStatus(toolOutcomes)}\n`);
          }
          telemetry.recordAuditEvent({
            sessionId: result.sessionId,
            turnId,
            kind: "cli.run.completed",
            payload: {
              providerId,
              model,
              todoCount: result.taskState.items.length,
              maxSteps: parsed.value.maxSteps ?? null,
              tokenBudget: parsed.value.tokenBudget ?? null,
              toolOutcomes: { ...toolOutcomes },
              runtimeStatus: deriveRuntimeStatus(toolOutcomes),
            },
          });
        } catch (error) {
          const failure = classifyRunFailure(error, providerId, model);
          recordRunFailure(telemetry, session.sessionId, turnId, failure);
          renderRunFailure(session.sessionId, failure);
          process.exitCode = 1;
        }
        return;
      }
      case "control": {
        const parsed = parseControlArgs(args);
        if (!parsed.ok) {
          process.stdout.write(`${parsed.error}\n${renderControlUsage()}\n`);
          return;
        }
        if (!controlPlane) {
          process.stdout.write(
            "Control command is unavailable: control-plane adapter is not wired in this runtime.\n",
          );
          return;
        }

        let dispatchResult: ControlPlaneDispatchResult;
        try {
          dispatchResult = await controlPlane.dispatch(toControlPlaneAction(parsed.value));
        } catch (error) {
          process.stdout.write(`Control command failed: ${String(error)}\n`);
          return;
        }
        if (!dispatchResult.ok) {
          process.stdout.write(
            `Control command failed: ${dispatchResult.error ?? "unknown control-plane failure"}\n`,
          );
          return;
        }

        process.stdout.write(renderControlActionResult(parsed.value, dispatchResult.data, config));
        telemetry.recordAuditEvent({
          sessionId: parsed.value.sessionId,
          kind: "cli.control.completed",
          payload: {
            action: parsed.value.type,
          },
        });
        return;
      }
      case "resume": {
        const sessionId = args[0];
        if (!sessionId) {
          process.stdout.write("Usage: hotflow resume <sessionId>\n");
          return;
        }

        const snapshot = await createSessionResumeSnapshotWithControlPlane(
          sessionStore,
          controlPlane,
          {
            sessionId,
            defaultProviderId: config.defaultProvider,
            defaultModel: config.defaultModel,
          },
        );
        process.stdout.write(renderResumeSnapshot(snapshot));
        let resumeExecuted = false;
        let resumeExecutionReason = snapshot.resumable ? "not_attempted" : "not_resumable";
        let resumedProviderId: string | null = null;
        let resumedModel: string | null = null;
        let resumedTodoCount: number | null = null;
        let resumedToolOutcomes: ToolOutcomeSummary | null = null;
        let resumedRuntimeStatus: ReturnType<typeof deriveRuntimeStatus> | null = null;

        if (snapshot.resumable && snapshot.latestTurnId) {
          const recoveredUserText = recoverTurnUserInputText(sessionStore, {
            sessionId,
            turnId: snapshot.latestTurnId,
          });

          if (recoveredUserText === undefined) {
            resumeExecutionReason = "missing-user-input";
            process.stdout.write(
              `Resume execution skipped: could not recover original user input for turn ${snapshot.latestTurnId}.\n`,
            );
          } else {
            const providerId = snapshot.recoveryProviderId ?? config.defaultProvider;
            const model = snapshot.recoveryModel ?? config.defaultModel;
            const providerError = Array.isArray(providerIds)
              ? resolveProviderSelectionError(providerId, providerIds)
              : undefined;
            if (providerError) {
              resumeExecutionReason = "provider-unavailable";
              process.stdout.write(`${providerError}\n`);
              process.exitCode = 1;
            } else {
              try {
                const result = await engine.runTurn({
                  sessionId,
                  turnId: snapshot.latestTurnId,
                  userText: recoveredUserText,
                  providerId,
                  model,
                  ...createCliWorkbenchTurnReasoningInput({
                    ...(snapshot.recoveryReasoningStrategy === null
                      ? {}
                      : { reasoningStrategy: snapshot.recoveryReasoningStrategy }),
                  }),
                });
                const toolOutcomes = summarizeRunToolOutcomes(result.toolResults);
                const runtimeStatus =
                  toolOutcomes.total > 0 ? deriveRuntimeStatus(toolOutcomes) : null;

                resumeExecuted = true;
                resumeExecutionReason = "executed";
                resumedProviderId = providerId;
                resumedModel = model;
                resumedTodoCount = result.taskState.items.length;
                resumedToolOutcomes = toolOutcomes;
                resumedRuntimeStatus = runtimeStatus;

                process.stdout.write(`Provider: ${providerId}\n`);
                process.stdout.write(`Model: ${model}\n`);
                process.stdout.write(`Output: ${result.output}\n`);
                if (result.taskState.items.length > 0) {
                  process.stdout.write("Todos:\n");
                  result.taskState.items.forEach((item, index) => {
                    process.stdout.write(`  ${index + 1}. ${item.content}\n`);
                  });
                }
                if (toolOutcomes.total > 0) {
                  process.stdout.write(
                    `Tool outcomes: ${formatToolOutcomeSummary(toolOutcomes)}\n`,
                  );
                  process.stdout.write(`Runtime status: ${runtimeStatus}\n`);
                }
              } catch (error) {
                const failure = classifyRunFailure(error, providerId, model);
                recordRunFailure(
                  telemetry,
                  sessionId,
                  snapshot.latestTurnId,
                  failure,
                  "cli.resume.failed",
                );
                renderRunFailure(sessionId, failure);
                process.exitCode = 1;
              }
            }
          }
        }

        telemetry.recordAuditEvent({
          sessionId,
          kind: "cli.resume.completed",
          payload: {
            firstStep: snapshot.firstTodo,
            checkpointId: snapshot.checkpointId,
            checkpointUptoSeq: snapshot.checkpointUptoSeq,
            lastAppliedSeq: snapshot.lastAppliedSeq,
            journalEvents: snapshot.journalEvents,
            auditEvents: snapshot.auditEvents,
            streamEvents: snapshot.streamEvents,
            latestTurnId: snapshot.latestTurnId,
            latestTurnProviderId: snapshot.latestTurnProviderId,
            latestTurnModel: snapshot.latestTurnModel,
            recoveryProviderId: snapshot.recoveryProviderId,
            recoveryModel: snapshot.recoveryModel,
            recoverySelectionSource: snapshot.recoverySelectionSource,
            recoveryReasoningStrategy: snapshot.recoveryReasoningStrategy,
            recoveryReasoningSource: snapshot.recoveryReasoningSource,
            resumable: snapshot.resumable,
            guidance: snapshot.guidance,
            resumeAction: snapshot.resumeAction,
            replayWindow: snapshot.replayWindow ?? null,
            nextStepIndex: snapshot.nextStepIndex,
            lastStepEventType: snapshot.lastStepEventType ?? null,
            toolOutcomes: { ...snapshot.toolOutcomes },
            runtimeStatus: snapshot.runtimeStatus,
            resumeExecuted,
            resumeExecutionReason,
            resumedProviderId,
            resumedModel,
            resumedTodoCount,
            resumedToolOutcomes: resumedToolOutcomes === null ? null : { ...resumedToolOutcomes },
            resumedRuntimeStatus,
          },
        });
        return;
      }
      case "status": {
        const parsed = parseStatusArgs(args);
        if (!parsed.ok) {
          process.stdout.write(`${parsed.error}\n${renderStatusUsage()}\n`);
          return;
        }
        const snapshot = await createSessionObservationSnapshotWithControlPlane(
          sessionStore,
          controlPlane,
          parsed.value,
        );
        const statusSessionGuidance = resolveStatusSessionGuidance(snapshot);
        const statusEffectiveGuidance = resolveEffectiveGuidanceSummary(
          config,
          snapshot.effectiveGuidance,
          statusSessionGuidance,
        );
        const statusEffectiveGuidanceSources = resolveEffectiveGuidanceSourceSummary(
          snapshot.effectiveGuidanceSources,
          statusSessionGuidance,
        );
        const statusContinuity = resolveStatusContinuity(snapshot);
        const statusRuntimeState = resolveStatusRuntimeState(snapshot);
        const statusFinishState = resolveStatusFinishState(snapshot);
        const statusToolSummary = resolveStatusToolSummary(snapshot);
        const statusToolRuntimeStatus =
          statusToolSummary.toolOutcomes === undefined
            ? undefined
            : deriveRuntimeStatus(statusToolSummary.toolOutcomes);
        const statusRuntimeStatus = combineStatusRuntimeStatus(
          statusRuntimeState.runtimeStatus,
          statusToolRuntimeStatus,
        );

        process.stdout.write(`Session: ${parsed.value.sessionId}\n`);
        process.stdout.write(`First step: ${snapshot.firstTodo}\n`);
        process.stdout.write(`Last applied seq: ${snapshot.lastAppliedSeq}\n`);
        process.stdout.write(`Journal events: ${snapshot.journalEvents}\n`);
        if (snapshot.agentOsTimelineSummary !== undefined) {
          process.stdout.write(
            `Agent OS timeline: ${formatAgentOsTimelineObservationSummary(snapshot.agentOsTimelineSummary)}\n`,
          );
        }
        if (snapshot.workingMemoryEntries !== undefined) {
          process.stdout.write(`Working memory entries: ${snapshot.workingMemoryEntries}\n`);
        }
        if (snapshot.episodicMemoryEntries !== undefined) {
          process.stdout.write(`Episodic memory entries: ${snapshot.episodicMemoryEntries}\n`);
        }
        if (snapshot.latestMemoryControl !== undefined) {
          process.stdout.write(
            `Latest memory control: ${formatLatestMemoryControlHeader(snapshot.latestMemoryControl)}\n`,
          );
          const latestMemoryControlDetail = formatLatestMemoryControlDetail(
            snapshot.latestMemoryControl,
          );
          if (latestMemoryControlDetail !== undefined) {
            process.stdout.write(`Latest memory control detail: ${latestMemoryControlDetail}\n`);
          }
          const latestMemoryControlJournal = formatLatestMemoryControlJournal(
            snapshot.latestMemoryControl,
          );
          if (latestMemoryControlJournal !== undefined) {
            process.stdout.write(`Latest memory control journal: ${latestMemoryControlJournal}\n`);
          }
        }
        if (statusEffectiveGuidance !== undefined) {
          process.stdout.write(
            `Effective guidance: ${formatPromptSessionGuidance(statusEffectiveGuidance)}\n`,
          );
        }
        process.stdout.write(
          `Effective guidance sources: ${formatPromptSessionGuidanceSources(statusEffectiveGuidanceSources)}\n`,
        );
        if (statusRuntimeStatus !== undefined) {
          process.stdout.write(`Runtime status: ${statusRuntimeStatus}\n`);
        }
        if (snapshot.latestGuidanceControl !== undefined) {
          process.stdout.write(
            `Latest guidance control: ${formatLatestGuidanceControlHeader(snapshot.latestGuidanceControl)}\n`,
          );
          const latestGuidanceControlDetail = formatLatestGuidanceControlDetail(
            snapshot.latestGuidanceControl,
          );
          if (latestGuidanceControlDetail !== undefined) {
            process.stdout.write(
              `Latest guidance control detail: ${latestGuidanceControlDetail}\n`,
            );
          }
          const latestGuidanceControlJournal = formatLatestGuidanceControlJournal(
            snapshot.latestGuidanceControl,
          );
          if (latestGuidanceControlJournal !== undefined) {
            process.stdout.write(
              `Latest guidance control journal: ${latestGuidanceControlJournal}\n`,
            );
          }
        }
        if (
          snapshot.step?.promptSummary?.sessionGuidance === undefined &&
          statusSessionGuidance !== undefined
        ) {
          process.stdout.write(
            `Session guidance: ${formatPromptSessionGuidance(statusSessionGuidance)}\n`,
          );
        }
        process.stdout.write(`Latest turn: ${snapshot.latestTurnId ?? "(none)"}\n`);
        if (snapshot.latestTurnId) {
          process.stdout.write(
            `Latest turn provider: ${snapshot.latestTurnProviderId ?? "(unknown)"}\n`,
          );
          process.stdout.write(`Latest turn model: ${snapshot.latestTurnModel ?? "(unknown)"}\n`);
          if (
            snapshot.step?.promptSummary?.latestTurnGuidance === undefined &&
            snapshot.latestTurnReasoning !== undefined
          ) {
            const latestTurnReasoningSummary = formatPromptLatestTurnReasoningSummary(
              snapshot.latestTurnReasoning,
            );
            if (latestTurnReasoningSummary !== undefined) {
              process.stdout.write(`Latest turn reasoning: ${latestTurnReasoningSummary}\n`);
            }
            const latestTurnReasoningRationale = formatPromptLatestTurnReasoningRationale(
              snapshot.latestTurnReasoning,
            );
            if (latestTurnReasoningRationale !== undefined) {
              process.stdout.write(
                `Latest turn reasoning rationale: ${latestTurnReasoningRationale}\n`,
              );
            }
          }
          if (
            snapshot.step?.promptSummary === undefined &&
            snapshot.latestTurnToolRuntimeGuidance !== undefined
          ) {
            process.stdout.write(
              `Latest turn tool runtime guidance: ${formatPromptToolRuntimeGuidance(snapshot.latestTurnToolRuntimeGuidance)}\n`,
            );
            const latestTurnToolRuntimeDetail = formatPromptToolRuntimeGuidanceDetail(
              snapshot.latestTurnToolRuntimeGuidance,
            );
            if (latestTurnToolRuntimeDetail !== undefined) {
              process.stdout.write(
                `Latest turn tool runtime details: ${latestTurnToolRuntimeDetail}\n`,
              );
            }
            const latestTurnToolRuntimeMetadataDetail = formatPromptToolRuntimeMetadataDetail(
              snapshot.latestTurnToolRuntimeGuidance,
            );
            if (latestTurnToolRuntimeMetadataDetail !== undefined) {
              process.stdout.write(
                `Latest turn tool runtime metadata: ${latestTurnToolRuntimeMetadataDetail}\n`,
              );
            }
          }
          if (
            snapshot.step?.promptSummary === undefined &&
            snapshot.latestTurnRuntimeDegradationSummaries !== undefined &&
            snapshot.latestTurnRuntimeDegradationSummaries.length > 0
          ) {
            process.stdout.write(
              `Latest turn prompt degradations: ${formatPromptRuntimeDegradationSummaries(snapshot.latestTurnRuntimeDegradationSummaries)}\n`,
            );
          }
          if (
            snapshot.step?.promptSummary?.latestTurnGuidance === undefined &&
            statusRuntimeState.latestTurnStateSummary !== undefined
          ) {
            process.stdout.write(
              `Latest turn state: ${statusRuntimeState.latestTurnStateSummary}\n`,
            );
          }
          if (
            snapshot.step?.promptSummary?.latestTurnGuidance === undefined &&
            statusFinishState.latestTurnFinishSummary !== undefined
          ) {
            process.stdout.write(
              `Latest turn finish: ${statusFinishState.latestTurnFinishSummary}\n`,
            );
          }
          if (
            snapshot.step?.promptSummary?.latestTurnGuidance === undefined &&
            statusToolSummary.source === "latest-turn"
          ) {
            if (statusToolSummary.toolCount !== undefined) {
              process.stdout.write(`Latest turn tool count: ${statusToolSummary.toolCount}\n`);
            }
            if (statusToolSummary.toolOutcomes !== undefined) {
              process.stdout.write(
                `Latest turn tool outcomes: ${formatToolOutcomeSummary(statusToolSummary.toolOutcomes)}\n`,
              );
            }
          }
          if (snapshot.step === undefined && statusContinuity.source === "latest-turn") {
            if (statusContinuity.resumeAction !== undefined) {
              process.stdout.write(`Latest turn resume action: ${statusContinuity.resumeAction}\n`);
            }
            if (statusContinuity.nextStepIndex !== undefined) {
              process.stdout.write(
                `Latest turn next step index: ${statusContinuity.nextStepIndex}\n`,
              );
            }
            if (statusContinuity.lastStepEventType !== undefined) {
              process.stdout.write(
                `Latest turn last step event: ${statusContinuity.lastStepEventType}\n`,
              );
            }
          }
        }
        process.stdout.write(`Audit events: ${snapshot.auditEvents}\n`);
        process.stdout.write(`Latest audit: ${snapshot.latestAuditKind ?? "(none)"}\n`);
        process.stdout.write(`Stream events: ${snapshot.streamEvents}\n`);
        process.stdout.write(`Latest stream: ${snapshot.latestStreamKind ?? "(none)"}\n`);
        if (snapshot.step) {
          process.stdout.write("Step recovery:\n");
          process.stdout.write(`  Turn: ${snapshot.step.turnId}\n`);
          process.stdout.write(
            `  Resume action: ${statusContinuity.resumeAction ?? snapshot.step.resumeAction}\n`,
          );
          process.stdout.write(
            `  Replay window: (${snapshot.step.replayWindow.fromSeqExclusive}, ${snapshot.step.replayWindow.toSeqInclusive}]\n`,
          );
          process.stdout.write(
            `  Next step index: ${statusContinuity.nextStepIndex ?? snapshot.step.nextStepIndex}\n`,
          );
          process.stdout.write(
            `  Last step event: ${statusContinuity.lastStepEventType ?? snapshot.step.lastStepEventType ?? "(none)"}\n`,
          );
          process.stdout.write(`  Step events: ${snapshot.step.stepJournalEvents}\n`);
          process.stdout.write(`  Model outputs: ${snapshot.step.modelOutputEvents}\n`);
          process.stdout.write(`  Planned tools: ${snapshot.step.plannedToolEvents}\n`);
          process.stdout.write(`  Tool results: ${snapshot.step.toolResultEvents}\n`);
          process.stdout.write(`  Final outputs: ${snapshot.step.finalOutputEvents}\n`);
          process.stdout.write(
            `  Tool outcomes: ${formatToolOutcomeSummary(snapshot.step.toolOutcomes)}\n`,
          );
          process.stdout.write(
            `  Runtime status: ${statusRuntimeState.runtimeStatus ?? snapshot.step.runtimeStatus}\n`,
          );
          if (snapshot.step.promptSummary) {
            process.stdout.write(
              `  Latest prompt step: ${formatStatusPromptStep(snapshot.step.promptSummary)}\n`,
            );
            process.stdout.write(
              `  Prompt focus: ${formatPromptExplainIds(
                selectPromptSectionLabels(
                  snapshot.step.promptSummary.focusSectionSummaries,
                  snapshot.step.promptSummary.focusSectionIds,
                ),
              )}\n`,
            );
            process.stdout.write(
              `  Prompt omissions: ${formatPromptExplainIds(
                selectPromptSectionLabels(
                  snapshot.step.promptSummary.omittedSectionSummaries,
                  snapshot.step.promptSummary.omittedSectionIds,
                ),
              )}\n`,
            );
            if (
              snapshot.step.promptSummary.runtimeShellSectionIds &&
              snapshot.step.promptSummary.runtimeShellSectionIds.length > 0
            ) {
              process.stdout.write(
                `  Prompt runtime shell: ${formatPromptExplainIds(
                  selectPromptSectionLabels(
                    snapshot.step.promptSummary.runtimeShellSectionSummaries,
                    snapshot.step.promptSummary.runtimeShellSectionIds,
                  ),
                )}\n`,
              );
            }
            if (
              snapshot.step.promptSummary.staticGuidanceSectionIds &&
              snapshot.step.promptSummary.staticGuidanceSectionIds.length > 0
            ) {
              process.stdout.write(
                `  Prompt static guidance: ${formatPromptExplainIds(
                  selectPromptSectionLabels(
                    snapshot.step.promptSummary.staticGuidanceSectionSummaries,
                    snapshot.step.promptSummary.staticGuidanceSectionIds,
                  ),
                )}\n`,
              );
            }
            const promptEffectiveGuidance =
              snapshot.step.promptSummary.effectiveGuidance ?? statusEffectiveGuidance;
            const promptEffectiveGuidanceSources =
              snapshot.step.promptSummary.effectiveGuidanceSources ??
              statusEffectiveGuidanceSources;
            if (promptEffectiveGuidance) {
              process.stdout.write(
                `  Prompt guidance: ${formatPromptSessionGuidance(promptEffectiveGuidance)}\n`,
              );
            }
            process.stdout.write(
              `  Prompt guidance sources: ${formatPromptSessionGuidanceSources(promptEffectiveGuidanceSources)}\n`,
            );
            if (snapshot.step.promptSummary.toolRuntimeGuidance) {
              process.stdout.write(
                `  Tool runtime guidance: ${formatPromptToolRuntimeGuidance(snapshot.step.promptSummary.toolRuntimeGuidance)}\n`,
              );
              const toolRuntimeDetail = formatPromptToolRuntimeGuidanceDetail(
                snapshot.step.promptSummary.toolRuntimeGuidance,
              );
              if (toolRuntimeDetail !== undefined) {
                process.stdout.write(`  Tool runtime details: ${toolRuntimeDetail}\n`);
              }
              const toolRuntimeMetadataDetail = formatPromptToolRuntimeMetadataDetail(
                snapshot.step.promptSummary.toolRuntimeGuidance,
              );
              if (toolRuntimeMetadataDetail !== undefined) {
                process.stdout.write(`  Tool runtime metadata: ${toolRuntimeMetadataDetail}\n`);
              }
            }
            if (snapshot.step.promptSummary.turnResumeGuidance) {
              process.stdout.write(
                `  Turn resume guidance: ${formatPromptTurnResumeGuidance(snapshot.step.promptSummary.turnResumeGuidance)}\n`,
              );
            }
            if (snapshot.step.promptSummary.latestTurnGuidance) {
              process.stdout.write(
                `  Latest turn guidance: ${formatPromptLatestTurnGuidance(snapshot.step.promptSummary.latestTurnGuidance)}\n`,
              );
              const latestTurnReasoningRationale = formatPromptLatestTurnReasoningRationale(
                snapshot.step.promptSummary.latestTurnGuidance.reasoning,
              );
              if (latestTurnReasoningRationale !== undefined) {
                process.stdout.write(
                  `  Latest turn reasoning rationale: ${latestTurnReasoningRationale}\n`,
                );
              }
            }
            if (
              snapshot.step.promptSummary.runtimeDegradationSummaries &&
              snapshot.step.promptSummary.runtimeDegradationSummaries.length > 0
            ) {
              process.stdout.write(
                `  Prompt degradations: ${formatPromptRuntimeDegradationSummaries(snapshot.step.promptSummary.runtimeDegradationSummaries)}\n`,
              );
            } else if (snapshot.step.promptSummary.runtimeDegradations.length === 0) {
              process.stdout.write("  Prompt degradations: (none)\n");
            }
            process.stdout.write(
              `  Prompt changes: ${formatStatusPromptChanges(snapshot.step.promptSummary)}\n`,
            );
          }
        }

        telemetry.recordAuditEvent({
          sessionId: parsed.value.sessionId,
          kind: "cli.status.completed",
          payload: {
            turnId: parsed.value.turnId ?? null,
            limit: parsed.value.limit ?? null,
            lastAppliedSeq: snapshot.lastAppliedSeq,
            journalEvents: snapshot.journalEvents,
            agentOsTimelineSummary:
              snapshot.agentOsTimelineSummary === undefined
                ? null
                : { ...snapshot.agentOsTimelineSummary },
            workingMemoryEntries: snapshot.workingMemoryEntries ?? null,
            episodicMemoryEntries: snapshot.episodicMemoryEntries ?? null,
            latestMemoryControl:
              snapshot.latestMemoryControl === undefined
                ? null
                : { ...snapshot.latestMemoryControl },
            latestGuidanceControl:
              snapshot.latestGuidanceControl === undefined
                ? null
                : { ...snapshot.latestGuidanceControl },
            sessionOutputStyle: statusSessionGuidance?.outputStyle ?? null,
            sessionPermissionMode: statusSessionGuidance?.permissionMode ?? null,
            effectiveGuidance:
              statusEffectiveGuidance === undefined ? null : { ...statusEffectiveGuidance },
            effectiveGuidanceSources: { ...statusEffectiveGuidanceSources },
            latestTurnId: snapshot.latestTurnId ?? null,
            latestTurnProviderId: snapshot.latestTurnProviderId ?? null,
            latestTurnModel: snapshot.latestTurnModel ?? null,
            latestTurnRuntimeStatus: snapshot.latestTurnRuntimeStatus ?? null,
            latestTurnTurnBranch: snapshot.latestTurnTurnBranch ?? null,
            latestTurnFinishReason: snapshot.latestTurnFinishReason ?? null,
            latestTurnCompletedSteps: snapshot.latestTurnCompletedSteps ?? null,
            latestTurnToolCount: snapshot.latestTurnToolCount ?? null,
            latestTurnToolOutcomes:
              snapshot.latestTurnToolOutcomes === undefined
                ? null
                : { ...snapshot.latestTurnToolOutcomes },
            latestTurnReasoning:
              snapshot.latestTurnReasoning === undefined
                ? null
                : { ...snapshot.latestTurnReasoning },
            auditEvents: snapshot.auditEvents,
            streamEvents: snapshot.streamEvents,
            finishReason: statusFinishState.finishReason ?? null,
            completedSteps: statusFinishState.completedSteps ?? null,
            resumeAction: statusContinuity.resumeAction ?? null,
            replayWindow: snapshot.step?.replayWindow ?? null,
            nextStepIndex: statusContinuity.nextStepIndex ?? null,
            lastStepEventType: statusContinuity.lastStepEventType ?? null,
            toolCount: statusToolSummary.toolCount ?? null,
            toolOutcomes:
              statusToolSummary.toolOutcomes === undefined
                ? null
                : { ...statusToolSummary.toolOutcomes },
            runtimeStatus: statusRuntimeState.runtimeStatus ?? null,
            turnBranch: statusRuntimeState.turnBranch ?? null,
          },
        });
        return;
      }
      case "task": {
        const parsed = parseTaskArgs(args);
        if (!parsed.ok) {
          process.stdout.write(`${parsed.error}\n${renderTaskUsage()}\n`);
          return;
        }
        if (!controlPlane) {
          process.stdout.write(
            "Task command is unavailable: control-plane adapter is not wired in this runtime.\n",
          );
          return;
        }

        let dispatchResult: ControlPlaneDispatchResult;
        try {
          dispatchResult = await controlPlane.dispatch(toControlPlaneAction(parsed.value));
        } catch (error) {
          process.stdout.write(`Task command failed: ${String(error)}\n`);
          return;
        }
        if (!dispatchResult.ok) {
          process.stdout.write(
            `Task command failed: ${dispatchResult.error ?? "unknown control-plane failure"}\n`,
          );
          return;
        }

        process.stdout.write(`Task action: ${parsed.value.type}\n`);
        if (parsed.value.type === "proposal-outbox-drain") {
          const drained = coerceProposalOutboxEntries(dispatchResult.data);
          if (drained) {
            process.stdout.write(`Outbox drained: ${drained.length}\n`);
            for (const entry of drained) {
              process.stdout.write(
                `  - ${entry.id} ${entry.eventType} proposal=${entry.proposalId} status=${entry.status}\n`,
              );
            }
          } else {
            process.stdout.write("Outbox drained.\n");
          }
        } else if (parsed.value.type === "proposal-list") {
          const proposals = coerceProposalListEntries(dispatchResult.data);
          if (proposals) {
            process.stdout.write(renderProposalListEntries(proposals));
          } else {
            process.stdout.write("Proposal list completed.\n");
          }
        } else if (parsed.value.type === "proposal-review") {
          const review = coerceProposalReview(dispatchResult.data);
          if (review) {
            process.stdout.write(renderProposalReview(review));
          } else {
            process.stdout.write("Proposal review completed.\n");
          }
        } else if (parsed.value.type === "proposal-get") {
          const proposal = coerceProposalRecord(dispatchResult.data);
          if (proposal) {
            process.stdout.write(`${JSON.stringify(proposal, null, 2)}\n`);
          } else if (dispatchResult.data === null) {
            process.stdout.write("null\n");
          } else {
            process.stdout.write("Proposal read completed.\n");
          }
        } else if (parsed.value.type === "proposal-explain") {
          const explained = coerceProposalExplanation(dispatchResult.data);
          if (explained) {
            process.stdout.write(renderProposalExplanation(explained));
          } else {
            process.stdout.write("Proposal explain completed.\n");
          }
        } else if (parsed.value.type === "proposal-preview") {
          const preview = coerceProposalPreview(dispatchResult.data);
          if (preview) {
            process.stdout.write(renderProposalPreview(preview));
          } else {
            process.stdout.write("Proposal preview completed.\n");
          }
        } else if (parsed.value.type === "proposal-rollback") {
          const rollback = coerceProposalRollback(dispatchResult.data);
          if (rollback) {
            process.stdout.write(renderProposalRollback(rollback));
          } else {
            process.stdout.write("Proposal rollback completed.\n");
          }
        } else if (parsed.value.type === "task-worker-mailbox") {
          const mailbox = coerceTaskWorkerMailboxSnapshot(dispatchResult.data);
          if (mailbox) {
            process.stdout.write(renderTaskWorkerMailboxSnapshot(mailbox));
          } else {
            process.stdout.write("Task mailbox read completed.\n");
          }
        } else if (parsed.value.type === "task-verifier-mailbox") {
          const mailbox = coerceTaskVerifierMailboxSnapshot(dispatchResult.data);
          if (mailbox) {
            process.stdout.write(renderTaskVerifierMailboxSnapshot(mailbox));
          } else {
            process.stdout.write("Task verifier mailbox read completed.\n");
          }
        } else {
          const state = coerceTaskOperationsSnapshot(dispatchResult.data);
          if (state) {
            process.stdout.write(renderTaskOperationsSnapshot(state));
          } else {
            process.stdout.write("Task action completed.\n");
          }
        }

        telemetry.recordAuditEvent({
          sessionId: parsed.value.sessionId,
          kind: "cli.task.completed",
          payload: {
            action: parsed.value.type,
          },
        });
        return;
      }
      case "onboard": {
        const onboard = await onboardModuleLoader();
        const parsed = onboard.parseOnboardArgs(args);
        if (!parsed.ok) {
          process.stdout.write(`${parsed.error}\n${onboard.renderOnboardUsage()}\n`);
          process.exitCode = 1;
          return;
        }

        if (parsed.value.help) {
          process.stdout.write(`${onboard.renderOnboardUsage()}\n`);
          return;
        }

        if (!controlPlane) {
          process.stdout.write(
            onboard.renderOnboardingFailure(
              new Error(
                "Onboarding command is unavailable: control-plane adapter is not wired in this runtime.",
              ),
              parsed.value.format,
            ),
          );
          process.exitCode = 1;
          return;
        }

        const session =
          (parsed.value.sessionId ? sessionStore.getSession(parsed.value.sessionId) : null) ??
          sessionStore.createSession(
            parsed.value.sessionId ? { sessionId: parsed.value.sessionId } : {},
          );

        const dispatchResult = await controlPlane.dispatch({
          type: "onboarding",
          sessionId: session.sessionId,
        });
        if (!dispatchResult.ok) {
          process.stdout.write(
            onboard.renderOnboardingFailure(
              new Error(dispatchResult.error ?? "onboarding control-plane action failed"),
              parsed.value.format,
            ),
          );
          process.exitCode = 1;
          return;
        }

        process.stdout.write(
          onboard.renderOnboardingReport(dispatchResult.data, parsed.value.format),
        );
        if (readOnboardStatus(dispatchResult.data) === "fail") {
          process.exitCode = 1;
        }
        return;
      }
      default:
        return;
    }
  } finally {
    sessionStore.close();
  }
}

export function normalizeArgv(argv: readonly string[]): readonly string[] {
  if (argv[0] === "--") {
    return argv.slice(1);
  }
  return argv;
}

export function parseCliInput(argv: readonly string[]): ParsedCliInput {
  const normalized = normalizeArgv(argv);
  const [first, ...args] = normalized;

  return {
    command: parseCommand(first),
    args,
  };
}

function parseCommand(first: string | undefined): CliCommand {
  if (first === "golden-path") {
    return "golden-path";
  }
  if (first === "preflight") {
    return "preflight";
  }
  if (first === "run") {
    return "run";
  }
  if (first === "control") {
    return "control";
  }
  if (first === "resume") {
    return "resume";
  }
  if (first === "status") {
    return "status";
  }
  if (first === "task") {
    return "task";
  }
  if (first === "doctor") {
    return "doctor";
  }
  if (first === "onboard") {
    return "onboard";
  }
  if (first === "director") {
    return "director";
  }

  return "help";
}

function readOnboardStatus(report: unknown): OnboardReportStatus | undefined {
  if (!report || typeof report !== "object") {
    return undefined;
  }
  const status = (report as { status?: unknown }).status;
  if (status === "pass" || status === "warn" || status === "fail") {
    return status;
  }
  return undefined;
}

function parseRequiredValue(args: readonly string[], index: number): string | undefined {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    return undefined;
  }
  return value;
}

interface ParsedDirectorInputArgs {
  readonly input: string;
  readonly hostUrl?: string;
}

interface ParsedDirectorMessageArgs {
  readonly text: string;
  readonly hostUrl?: string;
  readonly hostId?: string;
  readonly agentId?: string;
  readonly channel?: string;
  readonly peerId?: string;
  readonly messageId?: string;
  readonly receivedAtMs?: number;
  readonly autoAdvance?: boolean;
  readonly autoStartRun?: boolean;
  readonly runWorkerOnce?: boolean;
  readonly workerId?: string;
  readonly json?: boolean;
}

interface ParsedDirectorRuntimeArgs {
  readonly hostUrl?: string;
}

interface ParsedDirectorApiProviderSetArgs {
  readonly providerId: string;
  readonly key: DirectorApiProviderSettingKey;
  readonly value: string | boolean;
}

interface ParsedDirectorApiProviderTestArgs {
  readonly providerId: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

interface ParsedDirectorSwitchSetArgs {
  readonly feature: DirectorFeatureSwitchKey;
  readonly enabled: boolean;
}

const DIRECTOR_API_PROVIDER_SETTING_KEYS = [
  "enabled",
  "apiKey",
  "baseUrl",
  "models",
  "defaultTextModel",
  "defaultVisionModel",
  "defaultImageModel",
  "defaultVideoModel",
] as const satisfies readonly DirectorApiProviderSettingKey[];

interface ParsedDirectorAdapterRegisterArgs {
  readonly manifestPath: string;
}

interface ParsedDirectorAdapterToggleArgs {
  readonly adapterId: string;
}

interface ParsedDirectorAdapterExplainArgs {
  readonly adapterId: string;
}

interface ParsedDirectorRunStatusArgs {
  readonly runId: string;
  readonly hostUrl?: string;
}

interface ParsedDirectorSelfReflectDailyArgs {
  readonly date?: string;
}

interface ParsedDirectorRunOnceArgs {
  readonly runId: string;
  readonly workerId?: string;
  readonly json?: boolean;
}

interface ParsedDirectorRunRetryArgs extends ParsedDirectorRunStatusArgs {
  readonly assignmentId: string;
}

interface ParsedDirectorRunRerouteArgs extends ParsedDirectorRunRetryArgs {
  readonly adapterId: string;
}

interface ParsedDirectorMemoryRecallArgs extends DirectorRecallQuery {}

type DirectorTraceProposalStatus = "pending" | "accepted" | "rejected";

interface ParsedDirectorTraceProposalListArgs {
  readonly status?: DirectorTraceProposalStatus;
  readonly projectId?: string;
  readonly groupId?: string;
  readonly limit?: number;
}

interface ParsedDirectorTraceProposalExplainArgs {
  readonly proposalId: string;
}

interface ParsedDirectorTraceProposalDecisionArgs {
  readonly proposalId: string;
  readonly note?: string;
}

interface ParsedDirectorTraceProposalReplayArgs {
  readonly proposalId: string;
  readonly workerId?: string;
}

interface ParsedDirectorKnowledgeExplainArgs {
  readonly packId: string;
}

interface ParsedDirectorKnowledgePublishArgs {
  readonly proposalId?: string;
  readonly packId?: string;
  readonly author?: string;
  readonly note?: string;
}

interface ParsedDirectorKnowledgeCandidateSyncArgs {
  readonly proposalId: string;
  readonly author?: string;
  readonly note?: string;
}

interface ParsedDirectorKnowledgeLearnArgs {
  readonly directories?: readonly string[];
  readonly urls?: readonly string[];
  readonly queries?: readonly string[];
  readonly privacy?: "public" | "internal" | "confidential" | "restricted";
  readonly maxDepth?: number;
  readonly maxResultsPerQuery?: number;
}

interface ParsedDirectorExperienceExplainArgs {
  readonly candidateId: string;
}

interface ParsedDirectorExperienceDecisionArgs {
  readonly candidateId: string;
  readonly author?: string;
  readonly note?: string;
}

interface ParsedDirectorExperienceTaxonomyArgs {
  readonly candidateId: string;
  readonly categoryId: string;
  readonly tagIds?: readonly string[];
  readonly author?: string;
}

interface ParsedDirectorExperienceTagArgs {
  readonly candidateId: string;
  readonly tagIds: readonly string[];
  readonly author?: string;
}

interface ParsedDirectorSkillProposalArgs {
  readonly candidateId: string;
  readonly author?: string;
}

interface ParsedDirectorSkillDecisionArgs {
  readonly proposalId: string;
  readonly note?: string;
}

interface ParsedDirectorSkillClassifyArgs {
  readonly skillId: string;
  readonly categoryId: string;
  readonly tagIds?: readonly string[];
  readonly author?: string;
}

interface ParsedDirectorSkillTagArgs {
  readonly skillId: string;
  readonly tagIds: readonly string[];
  readonly author?: string;
}

interface ParsedDirectorKnowledgeDecisionArgs {
  readonly packId: string;
  readonly author?: string;
  readonly note?: string;
}

interface ParsedDirectorKnowledgeRollbackArgs {
  readonly packId: string;
  readonly version: number;
  readonly author?: string;
  readonly note?: string;
}

interface ParsedDirectorKnowledgeRecallArgs {
  readonly projectId: string;
  readonly groupId?: string;
  readonly anchorIds?: readonly string[];
  readonly preferredAdapters?: readonly string[];
  readonly tags?: readonly string[];
  readonly generationType?: string;
  readonly generationStyle?: string;
  readonly includeGlobalExperience?: boolean;
  readonly maxHits?: number;
  readonly maxChars?: number;
}

function parseDirectorInputArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorInputArgs } | { ok: false; error: string } {
  let input: string | undefined;
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--input" || token === "-i") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --input." };
      }
      input = value;
      index += 1;
      continue;
    }

    if (token === "--host" || token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!input) {
    return { ok: false, error: "Missing --input <path>." };
  }

  return {
    ok: true,
    value: {
      input,
      ...(hostUrl === undefined ? {} : { hostUrl }),
    },
  };
}

function parseDirectorMessageArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorMessageArgs } | { ok: false; error: string } {
  let text: string | undefined;
  let hostUrl: string | undefined;
  let hostId: string | undefined;
  let agentId: string | undefined;
  let channel: string | undefined;
  let peerId: string | undefined;
  let messageId: string | undefined;
  let receivedAtMs: number | undefined;
  let autoAdvance: boolean | undefined;
  let autoStartRun: boolean | undefined;
  let runWorkerOnce: boolean | undefined;
  let workerId: string | undefined;
  let json: boolean | undefined;
  const positionalText: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--text" || token === "-t") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --text." };
      }
      text = value;
      index += 1;
      continue;
    }

    if (token === "--host" || token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    if (token === "--host-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --host-id." };
      }
      hostId = value;
      index += 1;
      continue;
    }

    if (token === "--agent-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --agent-id." };
      }
      agentId = value;
      index += 1;
      continue;
    }

    if (token === "--channel") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --channel." };
      }
      channel = value;
      index += 1;
      continue;
    }

    if (token === "--peer-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --peer-id." };
      }
      peerId = value;
      index += 1;
      continue;
    }

    if (token === "--message-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --message-id." };
      }
      messageId = value;
      index += 1;
      continue;
    }

    if (token === "--received-at-ms") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --received-at-ms." };
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { ok: false, error: "--received-at-ms must be a non-negative integer." };
      }
      receivedAtMs = parsed;
      index += 1;
      continue;
    }

    if (token === "--no-auto-advance") {
      autoAdvance = false;
      continue;
    }

    if (token === "--no-auto-start") {
      autoStartRun = false;
      continue;
    }

    if (token === "--no-worker") {
      runWorkerOnce = false;
      continue;
    }

    if (token === "--worker-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --worker-id." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    if (token.startsWith("--")) {
      return { ok: false, error: `Unknown option ${token}.` };
    }

    positionalText.push(token);
  }

  const resolvedText = text ?? positionalText.join(" ").trim();
  if (resolvedText.length === 0) {
    return { ok: false, error: "Missing --text <message>." };
  }

  return {
    ok: true,
    value: {
      text: resolvedText,
      ...(hostUrl === undefined ? {} : { hostUrl }),
      ...(hostId === undefined ? {} : { hostId }),
      ...(agentId === undefined ? {} : { agentId }),
      ...(channel === undefined ? {} : { channel }),
      ...(peerId === undefined ? {} : { peerId }),
      ...(messageId === undefined ? {} : { messageId }),
      ...(receivedAtMs === undefined ? {} : { receivedAtMs }),
      ...(autoAdvance === undefined ? {} : { autoAdvance }),
      ...(autoStartRun === undefined ? {} : { autoStartRun }),
      ...(runWorkerOnce === undefined ? {} : { runWorkerOnce }),
      ...(workerId === undefined ? {} : { workerId }),
      ...(json === undefined ? {} : { json }),
    },
  };
}

function parseDirectorRunStatusArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorRunStatusArgs } | { ok: false; error: string } {
  let runId: string | undefined;
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--run-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --run-id." };
      }
      runId = value;
      index += 1;
      continue;
    }

    if (token === "--host" || token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!runId) {
    return { ok: false, error: "Missing --run-id <id>." };
  }

  return {
    ok: true,
    value: {
      runId,
      ...(hostUrl === undefined ? {} : { hostUrl }),
    },
  };
}

function parseDirectorSelfReflectDailyArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorSelfReflectDailyArgs } | { ok: false; error: string } {
  let date: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--date") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --date." };
      }
      date = value;
      index += 1;
      continue;
    }
    if (/^\d{4}-\d{2}-\d{2}$/u.test(token)) {
      date = token;
      continue;
    }
    return { ok: false, error: `Unknown self-reflect daily argument: ${token}.` };
  }

  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return { ok: false, error: "--date must use YYYY-MM-DD." };
  }
  return { ok: true, value: date === undefined ? {} : { date } };
}

function parseDirectorRunOnceArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorRunOnceArgs } | { ok: false; error: string } {
  let runId: string | undefined;
  let workerId: string | undefined;
  let json: boolean | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--run-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --run-id." };
      }
      runId = value;
      index += 1;
      continue;
    }

    if (token === "--worker-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --worker-id." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!runId) {
    return { ok: false, error: "Missing --run-id <id>." };
  }

  return {
    ok: true,
    value: {
      runId,
      ...(workerId === undefined ? {} : { workerId }),
      ...(json === undefined ? {} : { json }),
    },
  };
}

function parseDirectorRunRetryArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorRunRetryArgs } | { ok: false; error: string } {
  let runId: string | undefined;
  let assignmentId: string | undefined;
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--run-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --run-id." };
      }
      runId = value;
      index += 1;
      continue;
    }

    if (token === "--assignment-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --assignment-id." };
      }
      assignmentId = value;
      index += 1;
      continue;
    }

    if (token === "--host" || token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!runId) {
    return { ok: false, error: "Missing --run-id <id>." };
  }
  if (!assignmentId) {
    return { ok: false, error: "Missing --assignment-id <id>." };
  }

  return {
    ok: true,
    value: {
      runId,
      assignmentId,
      ...(hostUrl === undefined ? {} : { hostUrl }),
    },
  };
}

function parseDirectorRunRerouteArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorRunRerouteArgs } | { ok: false; error: string } {
  let runId: string | undefined;
  let assignmentId: string | undefined;
  let adapterId: string | undefined;
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--run-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --run-id." };
      }
      runId = value;
      index += 1;
      continue;
    }

    if (token === "--assignment-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --assignment-id." };
      }
      assignmentId = value;
      index += 1;
      continue;
    }

    if (token === "--adapter-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --adapter-id." };
      }
      adapterId = value;
      index += 1;
      continue;
    }

    if (token === "--host" || token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!runId) {
    return { ok: false, error: "Missing --run-id <id>." };
  }
  if (!assignmentId) {
    return { ok: false, error: "Missing --assignment-id <id>." };
  }
  if (!adapterId) {
    return { ok: false, error: "Missing --adapter-id <id>." };
  }

  return {
    ok: true,
    value: {
      runId,
      assignmentId,
      adapterId,
      ...(hostUrl === undefined ? {} : { hostUrl }),
    },
  };
}

function parseDirectorRuntimeArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorRuntimeArgs } | { ok: false; error: string } {
  let hostUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--host" || token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      hostUrl = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  return {
    ok: true,
    value: hostUrl === undefined ? {} : { hostUrl },
  };
}

function parseDirectorApiProviderSetArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorApiProviderSetArgs } | { ok: false; error: string } {
  let providerId: string | undefined;
  let key: DirectorApiProviderSettingKey | undefined;
  let value: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--provider-id" || token === "--provider") {
      const parsed = parseRequiredValue(args, index + 1);
      if (!parsed) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      providerId = parsed;
      index += 1;
      continue;
    }

    if (token === "--key") {
      const parsed = parseRequiredValue(args, index + 1);
      if (!parsed) {
        return { ok: false, error: "Missing value for --key." };
      }
      key = normalizeDirectorApiProviderSettingKey(parsed);
      if (key === undefined) {
        return { ok: false, error: `Unknown API provider setting key: ${parsed}.` };
      }
      index += 1;
      continue;
    }

    if (token === "--value") {
      const parsed = parseRequiredValue(args, index + 1);
      if (!parsed) {
        return { ok: false, error: "Missing value for --value." };
      }
      value = parsed;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!providerId) {
    return { ok: false, error: "Missing --provider-id <id>." };
  }
  if (key === undefined) {
    return { ok: false, error: "Missing --key <setting>." };
  }
  if (value === undefined) {
    return { ok: false, error: "Missing --value <value>." };
  }

  let parsedValue: string | boolean = value;
  if (key === "enabled") {
    try {
      parsedValue = parseBooleanSettingValue(value);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    ok: true,
    value: {
      providerId,
      key,
      value: parsedValue,
    },
  };
}

function parseDirectorApiProviderTestArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorApiProviderTestArgs } | { ok: false; error: string } {
  let providerId: string | undefined;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--provider-id" || token === "--provider") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: `Missing value for ${token}.` };
      }
      providerId = value;
      index += 1;
      continue;
    }

    if (token === "--api-key") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --api-key." };
      }
      apiKey = value;
      index += 1;
      continue;
    }

    if (token === "--base-url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --base-url." };
      }
      baseUrl = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!providerId) {
    return { ok: false, error: "Missing --provider-id <id>." };
  }

  return {
    ok: true,
    value: {
      providerId,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    },
  };
}

function parseDirectorSwitchSetArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorSwitchSetArgs } | { ok: false; error: string } {
  let feature: DirectorFeatureSwitchKey | undefined;
  let enabled: boolean | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--feature") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --feature." };
      }
      feature = normalizeDirectorFeatureSwitchKey(value);
      if (feature === undefined) {
        return { ok: false, error: `Unknown Director feature switch: ${value}.` };
      }
      index += 1;
      continue;
    }

    if (token === "--enabled") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --enabled." };
      }
      try {
        enabled = parseBooleanSettingValue(value);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (feature === undefined) {
    return { ok: false, error: "Missing --feature <key>." };
  }
  if (enabled === undefined) {
    return { ok: false, error: "Missing --enabled <true|false>." };
  }

  return { ok: true, value: { feature, enabled } };
}

function normalizeDirectorApiProviderSettingKey(
  value: string,
): DirectorApiProviderSettingKey | undefined {
  const normalized = value.trim();
  return DIRECTOR_API_PROVIDER_SETTING_KEYS.find((key) => key === normalized);
}

function normalizeDirectorFeatureSwitchKey(value: string): DirectorFeatureSwitchKey | undefined {
  const normalized = value.trim();
  return DIRECTOR_FEATURE_SWITCH_KEYS.find((key) => key === normalized);
}

function parseBooleanSettingValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "off" || normalized === "no" || normalized === "0") {
    return false;
  }
  throw new Error(`Expected boolean value, got ${value}.`);
}

function parseDirectorAdapterRegisterArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorAdapterRegisterArgs } | { ok: false; error: string } {
  let manifestPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--manifest") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --manifest." };
      }
      manifestPath = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!manifestPath) {
    return { ok: false, error: "Missing --manifest <path>." };
  }

  return {
    ok: true,
    value: { manifestPath },
  };
}

function parseDirectorAdapterToggleArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorAdapterToggleArgs } | { ok: false; error: string } {
  let adapterId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--adapter-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --adapter-id." };
      }
      adapterId = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!adapterId) {
    return { ok: false, error: "Missing --adapter-id <id>." };
  }

  return {
    ok: true,
    value: { adapterId },
  };
}

function parseDirectorAdapterExplainArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorAdapterExplainArgs } | { ok: false; error: string } {
  return parseDirectorAdapterToggleArgs(args);
}

function parseDirectorMemoryRecallArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorMemoryRecallArgs } | { ok: false; error: string } {
  let projectId: string | undefined;
  let groupId: string | undefined;
  const anchorIds: string[] = [];
  const selectedAdapters: string[] = [];
  let generationType: string | undefined;
  let generationStyle: string | undefined;
  const knowledgeSignalTags: string[] = [];
  let maxHits = 3;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--project-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --project-id." };
      }
      projectId = value;
      index += 1;
      continue;
    }

    if (token === "--group-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --group-id." };
      }
      groupId = value;
      index += 1;
      continue;
    }

    if (token === "--anchor-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --anchor-id." };
      }
      anchorIds.push(value);
      index += 1;
      continue;
    }

    if (token === "--adapter-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --adapter-id." };
      }
      selectedAdapters.push(value);
      index += 1;
      continue;
    }

    if (token === "--generation-type") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --generation-type." };
      }
      generationType = value;
      index += 1;
      continue;
    }

    if (token === "--generation-style") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --generation-style." };
      }
      generationStyle = value;
      index += 1;
      continue;
    }

    if (token === "--tag") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --tag." };
      }
      knowledgeSignalTags.push(value);
      index += 1;
      continue;
    }

    if (token === "--max-hits") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --max-hits." };
      }
      const parsed = parsePositiveInteger(value, "--max-hits");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      maxHits = parsed;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!projectId) {
    return { ok: false, error: "Missing --project-id <id>." };
  }

  return {
    ok: true,
    value: {
      projectId,
      maxHits,
      ...(groupId === undefined ? {} : { groupId }),
      ...(anchorIds.length === 0 ? {} : { anchorIds }),
      ...(selectedAdapters.length === 0 ? {} : { selectedAdapters }),
      ...(generationType === undefined ? {} : { generationType }),
      ...(generationStyle === undefined ? {} : { generationStyle }),
      ...(knowledgeSignalTags.length === 0 ? {} : { knowledgeSignalTags }),
    },
  };
}

function parseDirectorTraceProposalListArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorTraceProposalListArgs } | { ok: false; error: string } {
  let status: DirectorTraceProposalStatus | undefined;
  let projectId: string | undefined;
  let groupId: string | undefined;
  let limit: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--status") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --status." };
      }
      if (value !== "pending" && value !== "accepted" && value !== "rejected") {
        return { ok: false, error: `Invalid trace proposal status: ${value}` };
      }
      status = value;
      index += 1;
      continue;
    }

    if (token === "--project-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --project-id." };
      }
      projectId = value;
      index += 1;
      continue;
    }

    if (token === "--group-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --group-id." };
      }
      groupId = value;
      index += 1;
      continue;
    }

    if (token === "--limit") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --limit." };
      }
      const parsed = parsePositiveInteger(value, "--limit");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  return {
    ok: true,
    value: {
      ...(status === undefined ? {} : { status }),
      ...(projectId === undefined ? {} : { projectId }),
      ...(groupId === undefined ? {} : { groupId }),
      ...(limit === undefined ? {} : { limit }),
    },
  };
}

function parseDirectorTraceProposalExplainArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorTraceProposalExplainArgs } | { ok: false; error: string } {
  let proposalId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--proposal-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!proposalId) {
    return { ok: false, error: "Missing --proposal-id <id>." };
  }

  return {
    ok: true,
    value: { proposalId },
  };
}

function parseDirectorTraceProposalDecisionArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorTraceProposalDecisionArgs } | { ok: false; error: string } {
  let proposalId: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--proposal-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    if (token === "--note") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --note." };
      }
      note = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!proposalId) {
    return { ok: false, error: "Missing --proposal-id <id>." };
  }

  return {
    ok: true,
    value: {
      proposalId,
      ...(note === undefined ? {} : { note }),
    },
  };
}

function parseDirectorTraceProposalReplayArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorTraceProposalReplayArgs } | { ok: false; error: string } {
  let proposalId: string | undefined;
  let workerId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--proposal-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    if (token === "--worker-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --worker-id." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!proposalId) {
    return { ok: false, error: "Missing --proposal-id <id>." };
  }

  return {
    ok: true,
    value: {
      proposalId,
      ...(workerId === undefined ? {} : { workerId }),
    },
  };
}

function parseDirectorKnowledgeExplainArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgeExplainArgs } | { ok: false; error: string } {
  let packId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--pack-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --pack-id." };
      }
      packId = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!packId) {
    return { ok: false, error: "Missing --pack-id <id>." };
  }

  return {
    ok: true,
    value: { packId },
  };
}

function parseDirectorKnowledgePublishArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgePublishArgs } | { ok: false; error: string } {
  let proposalId: string | undefined;
  let packId: string | undefined;
  let author: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--proposal-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }

    if (token === "--pack-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --pack-id." };
      }
      packId = value;
      index += 1;
      continue;
    }

    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }

    if (token === "--note") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --note." };
      }
      note = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (proposalId && packId) {
    return { ok: false, error: "Use either --proposal-id or --pack-id, not both." };
  }

  if (!proposalId && !packId) {
    return { ok: false, error: "Missing --proposal-id <id> or --pack-id <id>." };
  }

  return {
    ok: true,
    value: {
      ...(proposalId === undefined ? {} : { proposalId }),
      ...(packId === undefined ? {} : { packId }),
      ...(author === undefined ? {} : { author }),
      ...(note === undefined ? {} : { note }),
    },
  };
}

function parseDirectorKnowledgeCandidateSyncArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgeCandidateSyncArgs } | { ok: false; error: string } {
  const parsed = parseDirectorKnowledgePublishArgs(args);
  if (!parsed.ok) {
    return parsed;
  }
  if (!parsed.value.proposalId) {
    return { ok: false, error: "Missing --proposal-id <id>." };
  }
  return {
    ok: true,
    value: {
      proposalId: parsed.value.proposalId,
      ...(parsed.value.author === undefined ? {} : { author: parsed.value.author }),
      ...(parsed.value.note === undefined ? {} : { note: parsed.value.note }),
    },
  };
}

function parseDirectorKnowledgeLearnArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgeLearnArgs } | { ok: false; error: string } {
  const directories: string[] = [];
  const urls: string[] = [];
  const queries: string[] = [];
  let privacy: ParsedDirectorKnowledgeLearnArgs["privacy"];
  let maxDepth: number | undefined;
  let maxResultsPerQuery: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--directory") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --directory." };
      }
      directories.push(value);
      index += 1;
      continue;
    }

    if (token === "--url") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --url." };
      }
      urls.push(value);
      index += 1;
      continue;
    }

    if (token === "--query") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --query." };
      }
      queries.push(value);
      index += 1;
      continue;
    }

    if (token === "--privacy") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --privacy." };
      }
      if (!["public", "internal", "confidential", "restricted"].includes(value)) {
        return {
          ok: false,
          error: "Invalid --privacy. Use public, internal, confidential, or restricted.",
        };
      }
      privacy = value as ParsedDirectorKnowledgeLearnArgs["privacy"];
      index += 1;
      continue;
    }

    if (token === "--max-depth") {
      const value = parseRequiredValue(args, index + 1);
      const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed < 0) {
        return { ok: false, error: "Invalid --max-depth value." };
      }
      maxDepth = parsed;
      index += 1;
      continue;
    }

    if (token === "--max-results") {
      const value = parseRequiredValue(args, index + 1);
      const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: "Invalid --max-results value." };
      }
      maxResultsPerQuery = parsed;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (directories.length === 0 && urls.length === 0 && queries.length === 0) {
    return { ok: false, error: "Missing --directory <path>, --url <url>, or --query <text>." };
  }

  return {
    ok: true,
    value: {
      ...(directories.length === 0 ? {} : { directories }),
      ...(urls.length === 0 ? {} : { urls }),
      ...(queries.length === 0 ? {} : { queries }),
      ...(privacy === undefined ? {} : { privacy }),
      ...(maxDepth === undefined ? {} : { maxDepth }),
      ...(maxResultsPerQuery === undefined ? {} : { maxResultsPerQuery }),
    },
  };
}

function parseDirectorExperienceExplainArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorExperienceExplainArgs } | { ok: false; error: string } {
  let candidateId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--candidate-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --candidate-id." };
      }
      candidateId = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!candidateId) {
    return { ok: false, error: "Missing --candidate-id <id>." };
  }

  return {
    ok: true,
    value: { candidateId },
  };
}

function parseDirectorExperienceDecisionArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorExperienceDecisionArgs } | { ok: false; error: string } {
  let candidateId: string | undefined;
  let author: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--candidate-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --candidate-id." };
      }
      candidateId = value;
      index += 1;
      continue;
    }

    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }

    if (token === "--note") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --note." };
      }
      note = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!candidateId) {
    return { ok: false, error: "Missing --candidate-id <id>." };
  }

  return {
    ok: true,
    value: {
      candidateId,
      ...(author === undefined ? {} : { author }),
      ...(note === undefined ? {} : { note }),
    },
  };
}

function parseDirectorExperienceTaxonomyArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorExperienceTaxonomyArgs } | { ok: false; error: string } {
  let candidateId: string | undefined;
  let categoryId: string | undefined;
  let author: string | undefined;
  const tagIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--candidate-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --candidate-id." };
      }
      candidateId = value;
      index += 1;
      continue;
    }
    if (token === "--category-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --category-id." };
      }
      categoryId = value;
      index += 1;
      continue;
    }
    if (token === "--tag-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --tag-id." };
      }
      tagIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!candidateId || !categoryId) {
    return { ok: false, error: "Missing --candidate-id <id> or --category-id <id>." };
  }

  return {
    ok: true,
    value: {
      candidateId,
      categoryId,
      ...(tagIds.length === 0 ? {} : { tagIds }),
      ...(author === undefined ? {} : { author }),
    },
  };
}

function parseDirectorExperienceTagArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorExperienceTagArgs } | { ok: false; error: string } {
  let candidateId: string | undefined;
  let author: string | undefined;
  const tagIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--candidate-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --candidate-id." };
      }
      candidateId = value;
      index += 1;
      continue;
    }
    if (token === "--tag-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --tag-id." };
      }
      tagIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!candidateId || tagIds.length === 0) {
    return { ok: false, error: "Missing --candidate-id <id> or --tag-id <id>." };
  }

  return {
    ok: true,
    value: {
      candidateId,
      tagIds,
      ...(author === undefined ? {} : { author }),
    },
  };
}

function parseDirectorSkillProposalArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorSkillProposalArgs } | { ok: false; error: string } {
  let candidateId: string | undefined;
  let author: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--candidate-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --candidate-id." };
      }
      candidateId = value;
      index += 1;
      continue;
    }
    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!candidateId) {
    return { ok: false, error: "Missing --candidate-id <id>." };
  }

  return {
    ok: true,
    value: {
      candidateId,
      ...(author === undefined ? {} : { author }),
    },
  };
}

function parseDirectorSkillDecisionArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorSkillDecisionArgs } | { ok: false; error: string } {
  let proposalId: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    if (token === "--note") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --note." };
      }
      note = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!proposalId) {
    return { ok: false, error: "Missing --proposal-id <id>." };
  }

  return {
    ok: true,
    value: {
      proposalId,
      ...(note === undefined ? {} : { note }),
    },
  };
}

function parseDirectorSkillClassifyArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorSkillClassifyArgs } | { ok: false; error: string } {
  let skillId: string | undefined;
  let categoryId: string | undefined;
  let author: string | undefined;
  const tagIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--skill-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --skill-id." };
      }
      skillId = value;
      index += 1;
      continue;
    }
    if (token === "--category-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --category-id." };
      }
      categoryId = value;
      index += 1;
      continue;
    }
    if (token === "--tag-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --tag-id." };
      }
      tagIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!skillId || !categoryId) {
    return { ok: false, error: "Missing --skill-id <id> or --category-id <id>." };
  }

  return {
    ok: true,
    value: {
      skillId,
      categoryId,
      ...(tagIds.length === 0 ? {} : { tagIds }),
      ...(author === undefined ? {} : { author }),
    },
  };
}

function parseDirectorSkillTagArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorSkillTagArgs } | { ok: false; error: string } {
  let skillId: string | undefined;
  let author: string | undefined;
  const tagIds: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--skill-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --skill-id." };
      }
      skillId = value;
      index += 1;
      continue;
    }
    if (token === "--tag-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --tag-id." };
      }
      tagIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!skillId || tagIds.length === 0) {
    return { ok: false, error: "Missing --skill-id <id> or --tag-id <id>." };
  }

  return {
    ok: true,
    value: {
      skillId,
      tagIds,
      ...(author === undefined ? {} : { author }),
    },
  };
}

function parseDirectorKnowledgeDecisionArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgeDecisionArgs } | { ok: false; error: string } {
  let packId: string | undefined;
  let author: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--pack-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --pack-id." };
      }
      packId = value;
      index += 1;
      continue;
    }

    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }

    if (token === "--note") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --note." };
      }
      note = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!packId) {
    return { ok: false, error: "Missing --pack-id <id>." };
  }

  return {
    ok: true,
    value: {
      packId,
      ...(author === undefined ? {} : { author }),
      ...(note === undefined ? {} : { note }),
    },
  };
}

function parseDirectorKnowledgeRollbackArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgeRollbackArgs } | { ok: false; error: string } {
  let packId: string | undefined;
  let version: number | undefined;
  let author: string | undefined;
  let note: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--pack-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --pack-id." };
      }
      packId = value;
      index += 1;
      continue;
    }

    if (token === "--version") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --version." };
      }
      const parsed = parsePositiveInteger(value, "--version");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      version = parsed;
      index += 1;
      continue;
    }

    if (token === "--author") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --author." };
      }
      author = value;
      index += 1;
      continue;
    }

    if (token === "--note") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --note." };
      }
      note = value;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!packId) {
    return { ok: false, error: "Missing --pack-id <id>." };
  }
  if (version === undefined) {
    return { ok: false, error: "Missing --version <n>." };
  }

  return {
    ok: true,
    value: {
      packId,
      version,
      ...(author === undefined ? {} : { author }),
      ...(note === undefined ? {} : { note }),
    },
  };
}

function parseDirectorKnowledgeRecallArgs(
  args: readonly string[],
): { ok: true; value: ParsedDirectorKnowledgeRecallArgs } | { ok: false; error: string } {
  let projectId: string | undefined;
  let groupId: string | undefined;
  const anchorIds: string[] = [];
  const preferredAdapters: string[] = [];
  const tags: string[] = [];
  let generationType: string | undefined;
  let generationStyle: string | undefined;
  let includeGlobalExperience: boolean | undefined;
  let maxHits: number | undefined;
  let maxChars: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }

    if (token === "--project-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --project-id." };
      }
      projectId = value;
      index += 1;
      continue;
    }

    if (token === "--group-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --group-id." };
      }
      groupId = value;
      index += 1;
      continue;
    }

    if (token === "--anchor-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --anchor-id." };
      }
      anchorIds.push(value);
      index += 1;
      continue;
    }

    if (token === "--adapter-id") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --adapter-id." };
      }
      preferredAdapters.push(value);
      index += 1;
      continue;
    }

    if (token === "--tag") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --tag." };
      }
      tags.push(value);
      index += 1;
      continue;
    }

    if (token === "--generation-type") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --generation-type." };
      }
      generationType = value;
      index += 1;
      continue;
    }

    if (token === "--generation-style") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --generation-style." };
      }
      generationStyle = value;
      index += 1;
      continue;
    }

    if (token === "--include-global-experience") {
      includeGlobalExperience = true;
      continue;
    }

    if (token === "--max-hits") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --max-hits." };
      }
      const parsed = parsePositiveInteger(value, "--max-hits");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      maxHits = parsed;
      index += 1;
      continue;
    }

    if (token === "--max-chars") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --max-chars." };
      }
      const parsed = parsePositiveInteger(value, "--max-chars");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      maxChars = parsed;
      index += 1;
      continue;
    }

    if (token === "--help" || token === "-h") {
      return { ok: false, error: "" };
    }

    return { ok: false, error: `Unknown option ${token}.` };
  }

  if (!projectId) {
    return { ok: false, error: "Missing --project-id <id>." };
  }

  return {
    ok: true,
    value: {
      projectId,
      ...(groupId === undefined ? {} : { groupId }),
      ...(anchorIds.length === 0 ? {} : { anchorIds }),
      ...(preferredAdapters.length === 0 ? {} : { preferredAdapters }),
      ...(tags.length === 0 ? {} : { tags }),
      ...(generationType === undefined ? {} : { generationType }),
      ...(generationStyle === undefined ? {} : { generationStyle }),
      ...(includeGlobalExperience === undefined ? {} : { includeGlobalExperience }),
      ...(maxHits === undefined ? {} : { maxHits }),
      ...(maxChars === undefined ? {} : { maxChars }),
    },
  };
}

function parsePositiveInteger(value: string, flagName: string): number | string {
  if (!/^\d+$/u.test(value)) {
    return `${flagName} expects a positive integer.`;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return `${flagName} expects a positive integer.`;
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flagName: string): number | string {
  if (!/^\d+$/u.test(value)) {
    return `${flagName} expects a non-negative integer.`;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return `${flagName} expects a non-negative integer.`;
  }
  return parsed;
}

export function parseRunArgs(args: readonly string[]): ParsedRunArgsResult {
  const userTextTokens: string[] = [];
  let providerId: string | undefined;
  let model: string | undefined;
  let sessionId: string | undefined;
  let maxSteps: number | undefined;
  let tokenBudget: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--") {
      userTextTokens.push(...args.slice(index + 1));
      break;
    }

    if (token === "--provider") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --provider." };
      }
      providerId = value;
      index += 1;
      continue;
    }

    if (token === "--model") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --model." };
      }
      model = value;
      index += 1;
      continue;
    }

    if (token === "--session") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --session." };
      }
      sessionId = value;
      index += 1;
      continue;
    }

    if (token === "--max-steps") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --max-steps." };
      }
      const parsed = parsePositiveInteger(value, "--max-steps");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      maxSteps = parsed;
      index += 1;
      continue;
    }

    if (token === "--token-budget") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --token-budget." };
      }
      const parsed = parsePositiveInteger(value, "--token-budget");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      tokenBudget = parsed;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      return { ok: false, error: `Unknown run option: ${token}` };
    }

    userTextTokens.push(token);
  }

  const userText = userTextTokens.join(" ").trim();
  if (!userText) {
    return { ok: false, error: "Missing run prompt text." };
  }

  return {
    ok: true,
    value: {
      userText,
      ...(providerId ? { providerId } : {}),
      ...(model ? { model } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(maxSteps !== undefined ? { maxSteps } : {}),
      ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    },
  };
}

export function parseStatusArgs(args: readonly string[]): ParsedStatusArgsResult {
  const sessionId = args[0]?.trim();
  if (!sessionId) {
    return { ok: false, error: "Missing session id." };
  }

  let turnId: string | undefined;
  let limit: number | undefined;
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (!token) {
      continue;
    }
    if (token === "--turn") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --turn." };
      }
      turnId = value;
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const value = parseRequiredValue(args, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --limit." };
      }
      const parsed = parsePositiveInteger(value, "--limit");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown status option: ${token}` };
  }

  return {
    ok: true,
    value: {
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
  };
}

export function parseControlArgs(args: readonly string[]): ParsedControlArgsResult {
  const action = args[0]?.trim();
  if (!action) {
    return { ok: false, error: "Missing control action." };
  }
  const sessionId = args[1]?.trim();
  if (!sessionId) {
    return { ok: false, error: "Missing session id for control action." };
  }

  const options = args.slice(2);
  switch (action) {
    case "compact":
      return parseCompactControlArgs(sessionId, options);
    case "resume":
      return parseResumeControlArgs(sessionId, options);
    case "rewind":
      return parseRewindControlArgs(sessionId, options);
    case "prompt-inspect":
      return parsePromptInspectControlArgs(sessionId, options);
    case "prompt-explain":
      return parsePromptExplainControlArgs(sessionId, options);
    case "output-style":
      return parseOutputStyleControlArgs(sessionId, options);
    case "permissions":
      return parsePermissionsControlArgs(sessionId, options);
    case "language":
      return parseLanguageControlArgs(sessionId, options);
    case "memory-inspect":
      return parseMemoryControlArgs("memory-inspect", sessionId, options);
    case "memory-clear":
      return parseMemoryControlArgs("memory-clear", sessionId, options);
    default:
      return { ok: false, error: `Unknown control action: ${action}` };
  }
}

function parseCompactControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  let strategy: "soft" | "hard" | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }

    if (token === "--strategy") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --strategy." };
      }
      if (value !== "soft" && value !== "hard") {
        return { ok: false, error: `Invalid compact strategy: ${value}` };
      }
      strategy = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown compact option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "compact",
      sessionId,
      ...(strategy === undefined ? {} : { strategy }),
    },
  };
}

function parseResumeControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  let checkpointId: number | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }

    if (token === "--checkpoint") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --checkpoint." };
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: `Invalid checkpoint id: ${value}` };
      }
      checkpointId = parsed;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown resume option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "resume",
      sessionId,
      ...(checkpointId === undefined ? {} : { checkpointId }),
    },
  };
}

function parseRewindControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  let checkpointId: number | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }

    if (token === "--checkpoint") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --checkpoint." };
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { ok: false, error: `Invalid checkpoint id: ${value}` };
      }
      checkpointId = parsed;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown rewind option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "rewind",
      sessionId,
      ...(checkpointId === undefined ? {} : { checkpointId }),
    },
  };
}

function parsePromptInspectControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  return parsePromptSelectionControlArgs("prompt-inspect", sessionId, options);
}

function parsePromptExplainControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  return parsePromptSelectionControlArgs("prompt-explain", sessionId, options);
}

function parsePromptSelectionControlArgs(
  type: ParsedPromptInspectControlAction["type"] | ParsedPromptExplainControlAction["type"],
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  let turnId: string | undefined;
  let stepIndex: number | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }

    if (token === "--turn") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --turn." };
      }
      turnId = value;
      index += 1;
      continue;
    }

    if (token === "--step") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --step." };
      }
      const parsed = parseNonNegativeInteger(value, "--step");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      stepIndex = parsed;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown ${type} option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type,
      sessionId,
      ...(turnId === undefined ? {} : { turnId }),
      ...(stepIndex === undefined ? {} : { stepIndex }),
    },
  };
}

function parseOutputStyleControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  const style = options[0]?.trim();
  if (!style || style.startsWith("--")) {
    return { ok: false, error: "Output style action requires <style>." };
  }
  if (options.length > 1) {
    return { ok: false, error: `Unknown output-style option: ${options[1]}` };
  }
  return {
    ok: true,
    value: {
      type: "output-style",
      sessionId,
      style,
    },
  };
}

function parsePermissionsControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  const mode = options[0]?.trim();
  if (!mode || mode.startsWith("--")) {
    return { ok: false, error: "Permissions action requires <mode>." };
  }
  if (options.length > 1) {
    return { ok: false, error: `Unknown permissions option: ${options[1]}` };
  }
  return {
    ok: true,
    value: {
      type: "permissions",
      sessionId,
      mode,
    },
  };
}

function parseLanguageControlArgs(
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  const language = options[0]?.trim();
  if (!language || language.startsWith("--")) {
    return { ok: false, error: "Language action requires <language>." };
  }
  if (options.length > 1) {
    return { ok: false, error: `Unknown language option: ${options[1]}` };
  }
  return {
    ok: true,
    value: {
      type: "language",
      sessionId,
      language,
    },
  };
}

function parseMemoryControlArgs(
  type: ParsedMemoryInspectControlAction["type"] | ParsedMemoryClearControlAction["type"],
  sessionId: string,
  options: readonly string[],
): ParsedControlArgsResult {
  let scope: ControlMemoryScope | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }

    if (token === "--scope") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --scope." };
      }
      if (value !== "working" && value !== "episodic" && value !== "all") {
        return { ok: false, error: `Invalid memory scope: ${value}` };
      }
      scope = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown ${type} option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type,
      sessionId,
      ...(scope === undefined ? {} : { scope }),
    },
  };
}

export function parseTaskArgs(args: readonly string[]): ParsedTaskArgsResult {
  const action = args[0]?.trim();
  if (!action) {
    return { ok: false, error: "Missing task action." };
  }
  const sessionId = args[1]?.trim();
  if (!sessionId) {
    return { ok: false, error: "Missing session id for task action." };
  }

  const options = args.slice(2);
  switch (action) {
    case "status":
      if (options.length > 0) {
        return { ok: false, error: `Unknown task status option: ${options[0]}` };
      }
      return {
        ok: true,
        value: {
          type: "task-status",
          sessionId,
        },
      };
    case "mailbox":
      return parseTaskMailboxArgs(sessionId, options);
    case "verifier-mailbox":
      return parseTaskVerifierMailboxArgs(sessionId, options);
    case "delegation-enqueue":
      return parseDelegationEnqueueTaskArgs(sessionId, options);
    case "delegation-status":
      return parseDelegationStatusTaskArgs(sessionId, options);
    case "verification-upsert":
      return parseVerificationUpsertTaskArgs(sessionId, options);
    case "proposal-enqueue":
      return parseProposalEnqueueTaskArgs(sessionId, options);
    case "proposal-transition":
      return parseProposalTransitionTaskArgs(sessionId, options);
    case "proposal-list":
      return parseProposalListTaskArgs(sessionId, options);
    case "proposal-get":
      return parseProposalGetTaskArgs(sessionId, options);
    case "proposal-review":
      return parseProposalReviewTaskArgs(sessionId, options);
    case "proposal-accept":
      return parseProposalDecisionTaskArgs("proposal-accept", sessionId, options);
    case "proposal-reject":
      return parseProposalDecisionTaskArgs("proposal-reject", sessionId, options);
    case "proposal-explain":
      return parseProposalExplainTaskArgs(sessionId, options);
    case "proposal-preview":
      return parseProposalPreviewTaskArgs(sessionId, options);
    case "proposal-apply":
      return parseProposalApplyTaskArgs(sessionId, options);
    case "proposal-rollback":
      return parseProposalRollbackTaskArgs(sessionId, options);
    case "proposal-outbox-drain":
      return parseProposalOutboxDrainTaskArgs(sessionId, options);
    default:
      return { ok: false, error: `Unknown task action: ${action}` };
  }
}

function parseTaskMailboxArgs(sessionId: string, options: readonly string[]): ParsedTaskArgsResult {
  let workerId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    const value = options[index + 1];

    if (token === "--worker-id" || token === "--worker") {
      if (!value) {
        return { ok: false, error: "Missing value for --worker." };
      }
      workerId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown task mailbox option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "task-worker-mailbox",
      sessionId,
      ...(workerId === undefined ? {} : { workerId }),
    },
  };
}

function parseTaskVerifierMailboxArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let verifierId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    const value = options[index + 1];

    if (token === "--verifier-id" || token === "--verifier") {
      if (!value) {
        return { ok: false, error: "Missing value for --verifier." };
      }
      verifierId = value;
      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown task verifier-mailbox option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "task-verifier-mailbox",
      sessionId,
      ...(verifierId === undefined ? {} : { verifierId }),
    },
  };
}

function parseDelegationEnqueueTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let id: string | undefined;
  let workerId: string | undefined;
  let instruction: string | undefined;
  let taskId: string | undefined;
  let specialization: DelegationSpecialization | undefined;
  let targetAgent: string | undefined;
  let verifierId: string | undefined;
  let verificationId: string | undefined;
  let requirement: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --id." };
      }
      id = value;
      index += 1;
      continue;
    }
    if (token === "--worker") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --worker." };
      }
      workerId = value;
      index += 1;
      continue;
    }
    if (token === "--instruction") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --instruction." };
      }
      instruction = value;
      index += 1;
      continue;
    }
    if (token === "--task") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --task." };
      }
      taskId = value;
      index += 1;
      continue;
    }
    if (token === "--specialization") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --specialization." };
      }
      const parsed = parseDelegationSpecialization(value);
      if (parsed === undefined) {
        return {
          ok: false,
          error: "Delegation specialization must be explore, plan, verify, or general.",
        };
      }
      specialization = parsed;
      index += 1;
      continue;
    }
    if (token === "--target-agent") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --target-agent." };
      }
      targetAgent = value;
      index += 1;
      continue;
    }
    if (token === "--verifier") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --verifier." };
      }
      verifierId = value;
      index += 1;
      continue;
    }
    if (token === "--verification") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --verification." };
      }
      verificationId = value;
      index += 1;
      continue;
    }
    if (token === "--requirement") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --requirement." };
      }
      requirement = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown delegation enqueue option: ${token}` };
  }

  if (!id || !workerId || !instruction) {
    return { ok: false, error: "Delegation enqueue requires --id, --worker, and --instruction." };
  }
  if (verifierId !== undefined && requirement === undefined) {
    return {
      ok: false,
      error: "Delegation enqueue requires --requirement when --verifier is set.",
    };
  }
  if (verifierId === undefined && (verificationId !== undefined || requirement !== undefined)) {
    return {
      ok: false,
      error: "Delegation enqueue requires --verifier when verification handoff options are set.",
    };
  }
  if (targetAgent !== undefined && specialization === undefined) {
    return {
      ok: false,
      error: "Delegation enqueue requires --specialization when --target-agent is set.",
    };
  }

  return {
    ok: true,
    value: {
      type: "delegation-enqueue",
      sessionId,
      delegation: {
        id,
        workerId,
        instruction,
        ...(taskId ? { taskId } : {}),
        ...(specialization === undefined ? {} : { specialization }),
        ...(targetAgent === undefined ? {} : { targetAgent }),
        ...(verifierId === undefined
          ? {}
          : {
              verificationRequest: {
                verifierId,
                requirement: requirement as string,
                ...(verificationId === undefined ? {} : { verificationId }),
              },
            }),
      },
    },
  };
}

function parseDelegationSpecialization(value: string): DelegationSpecialization | undefined {
  if (value === "explore" || value === "plan" || value === "verify" || value === "general") {
    return value;
  }
  return undefined;
}

function parseDelegationStatusTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let id: string | undefined;
  let status: DelegationStatus | undefined;
  let error: string | undefined;
  const statuses = new Set<DelegationStatus>([
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
  ]);

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --id." };
      }
      id = value;
      index += 1;
      continue;
    }
    if (token === "--status") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --status." };
      }
      if (!statuses.has(value as DelegationStatus)) {
        return { ok: false, error: `Invalid delegation status: ${value}` };
      }
      status = value as DelegationStatus;
      index += 1;
      continue;
    }
    if (token === "--error") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --error." };
      }
      error = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown delegation status option: ${token}` };
  }

  if (!id || !status) {
    return { ok: false, error: "Delegation status requires --id and --status." };
  }

  return {
    ok: true,
    value: {
      type: "delegation-status",
      sessionId,
      update: {
        id,
        status,
        ...(error ? { error } : {}),
      },
    },
  };
}

function parseVerificationUpsertTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let id: string | undefined;
  let verifierId: string | undefined;
  let requirement: string | undefined;
  let status: VerificationStatus | undefined;
  let taskId: string | undefined;
  let verdictSummary: string | undefined;
  const statuses = new Set<VerificationStatus>(["pending", "passed", "failed", "partial"]);

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --id." };
      }
      id = value;
      index += 1;
      continue;
    }
    if (token === "--verifier") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --verifier." };
      }
      verifierId = value;
      index += 1;
      continue;
    }
    if (token === "--requirement") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --requirement." };
      }
      requirement = value;
      index += 1;
      continue;
    }
    if (token === "--status") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --status." };
      }
      if (!statuses.has(value as VerificationStatus)) {
        return { ok: false, error: `Invalid verification status: ${value}` };
      }
      status = value as VerificationStatus;
      index += 1;
      continue;
    }
    if (token === "--task") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --task." };
      }
      taskId = value;
      index += 1;
      continue;
    }
    if (token === "--verdict") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --verdict." };
      }
      verdictSummary = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown verification upsert option: ${token}` };
  }

  if (!id || !verifierId || !requirement) {
    return {
      ok: false,
      error: "Verification upsert requires --id, --verifier, and --requirement.",
    };
  }

  return {
    ok: true,
    value: {
      type: "verification-upsert",
      sessionId,
      verification: {
        id,
        verifierId,
        requirement,
        ...(status ? { status } : {}),
        ...(taskId ? { taskId } : {}),
        ...(verdictSummary ? { verdictSummary } : {}),
      },
    },
  };
}

function parseProposalEnqueueTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let id: string | undefined;
  let kind: string | undefined;
  let payload: Readonly<Record<string, unknown>> | undefined;
  let sourceSessionId: string | undefined;
  let sourceTurnId: string | undefined;
  let provenance: string | undefined;
  let expiresAtMs: number | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --id." };
      }
      id = value;
      index += 1;
      continue;
    }
    if (token === "--kind") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --kind." };
      }
      kind = value;
      index += 1;
      continue;
    }
    if (token === "--payload") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --payload." };
      }
      const parsed = parseJsonObject(value);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }
      payload = parsed.value;
      index += 1;
      continue;
    }
    if (token === "--source-session") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --source-session." };
      }
      sourceSessionId = value;
      index += 1;
      continue;
    }
    if (token === "--source-turn") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --source-turn." };
      }
      sourceTurnId = value;
      index += 1;
      continue;
    }
    if (token === "--provenance") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --provenance." };
      }
      provenance = value;
      index += 1;
      continue;
    }
    if (token === "--expires-at") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --expires-at." };
      }
      const parsed = parsePositiveInteger(value, "--expires-at");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      expiresAtMs = parsed;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal enqueue option: ${token}` };
  }

  if (!id || !kind || !payload || !sourceSessionId || !sourceTurnId || !provenance) {
    return {
      ok: false,
      error:
        "Proposal enqueue requires --id, --kind, --payload, --source-session, --source-turn, and --provenance.",
    };
  }

  return {
    ok: true,
    value: {
      type: "proposal-enqueue",
      sessionId,
      proposal: {
        id,
        kind,
        payload,
        sourceSessionId,
        sourceTurnId,
        provenance,
        ...(expiresAtMs !== undefined ? { expiresAtMs } : {}),
      },
    },
  };
}

function parseProposalTransitionTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;
  let status: ProposalStatus | undefined;
  let decisionNote: string | undefined;
  const statuses = new Set<ProposalStatus>(["pending", "accepted", "rejected", "expired"]);

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    if (token === "--status") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --status." };
      }
      if (!statuses.has(value as ProposalStatus)) {
        return { ok: false, error: `Invalid proposal status: ${value}` };
      }
      status = value as ProposalStatus;
      index += 1;
      continue;
    }
    if (token === "--decision-note") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --decision-note." };
      }
      decisionNote = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal transition option: ${token}` };
  }

  if (!proposalId || !status) {
    return { ok: false, error: "Proposal transition requires --proposal-id and --status." };
  }

  return {
    ok: true,
    value: {
      type: "proposal-transition",
      sessionId,
      proposalId,
      status,
      ...(decisionNote ? { decisionNote } : {}),
    },
  };
}

function parseProposalGetTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal get option: ${token}` };
  }

  if (!proposalId) {
    return { ok: false, error: "Proposal get requires --proposal-id." };
  }

  return {
    ok: true,
    value: {
      type: "proposal-get",
      sessionId,
      proposalId,
    },
  };
}

function parseProposalListTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let status: ProposalStatus | undefined;
  let limit: number | undefined;
  const statuses = new Set<ProposalStatus>([
    "pending",
    "accepted",
    "rejected",
    "applied",
    "expired",
  ]);

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--status") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --status." };
      }
      if (!statuses.has(value as ProposalStatus)) {
        return { ok: false, error: `Invalid proposal status: ${value}` };
      }
      status = value as ProposalStatus;
      index += 1;
      continue;
    }
    if (token === "--limit") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --limit." };
      }
      const parsed = parsePositiveInteger(value, "--limit");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal list option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "proposal-list",
      sessionId,
      ...(status === undefined ? {} : { status }),
      ...(limit === undefined ? {} : { limit }),
    },
  };
}

function parseProposalReviewTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal review option: ${token}` };
  }

  if (!proposalId) {
    return { ok: false, error: "Proposal review requires --proposal-id." };
  }

  return {
    ok: true,
    value: {
      type: "proposal-review",
      sessionId,
      proposalId,
    },
  };
}

function parseProposalDecisionTaskArgs(
  type: "proposal-accept" | "proposal-reject",
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;
  let decisionNote: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    if (token === "--decision-note") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --decision-note." };
      }
      decisionNote = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown ${type} option: ${token}` };
  }

  if (!proposalId) {
    return { ok: false, error: `${type} requires --proposal-id.` };
  }

  return {
    ok: true,
    value: {
      type,
      sessionId,
      proposalId,
      ...(decisionNote === undefined ? {} : { decisionNote }),
    },
  };
}

function parseProposalExplainTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal explain option: ${token}` };
  }

  if (!proposalId) {
    return { ok: false, error: "Proposal explain requires --proposal-id." };
  }

  return {
    ok: true,
    value: {
      type: "proposal-explain",
      sessionId,
      proposalId,
    },
  };
}

function parseProposalPreviewTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal preview option: ${token}` };
  }

  if (!proposalId) {
    return { ok: false, error: "Proposal preview requires --proposal-id." };
  }

  return {
    ok: true,
    value: {
      type: "proposal-preview",
      sessionId,
      proposalId,
    },
  };
}

function parseProposalApplyTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let proposalId: string | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--proposal-id") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --proposal-id." };
      }
      proposalId = value;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal apply option: ${token}` };
  }

  if (!proposalId) {
    return { ok: false, error: "Proposal apply requires --proposal-id." };
  }

  return {
    ok: true,
    value: {
      type: "proposal-apply",
      sessionId,
      proposalId,
    },
  };
}

function parseProposalRollbackTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let version: number | undefined;

  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--version") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --version." };
      }
      const parsedValue = Number.parseInt(value, 10);
      if (!Number.isInteger(parsedValue) || parsedValue < 1) {
        return { ok: false, error: "Proposal rollback requires a positive integer --version." };
      }
      version = parsedValue;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal rollback option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "proposal-rollback",
      sessionId,
      ...(version === undefined ? {} : { version }),
    },
  };
}

function parseProposalOutboxDrainTaskArgs(
  sessionId: string,
  options: readonly string[],
): ParsedTaskArgsResult {
  let limit: number | undefined;
  for (let index = 0; index < options.length; index += 1) {
    const token = options[index];
    if (!token) {
      continue;
    }
    if (token === "--limit") {
      const value = parseRequiredValue(options, index + 1);
      if (!value) {
        return { ok: false, error: "Missing value for --limit." };
      }
      const parsed = parsePositiveInteger(value, "--limit");
      if (typeof parsed === "string") {
        return { ok: false, error: parsed };
      }
      limit = parsed;
      index += 1;
      continue;
    }
    return { ok: false, error: `Unknown proposal outbox drain option: ${token}` };
  }

  return {
    ok: true,
    value: {
      type: "proposal-outbox-drain",
      sessionId,
      ...(limit !== undefined ? { limit } : {}),
    },
  };
}

function parseJsonObject(
  value: string,
):
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string } {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "--payload must be a JSON object." };
    }
    return { ok: true, value: parsed as Readonly<Record<string, unknown>> };
  } catch {
    return { ok: false, error: "--payload must be valid JSON." };
  }
}

async function createSessionObservationSnapshotWithControlPlane(
  sessionStore: ReturnType<typeof bootstrapCli>["sessionStore"],
  controlPlane: ControlPlaneLike | undefined,
  input: ParsedStatusInput,
): Promise<SessionObservationSnapshot> {
  if (!controlPlane) {
    return createSessionObservationSnapshot(sessionStore, input);
  }

  let result: ControlPlaneDispatchResult;
  try {
    result = await controlPlane.dispatch({
      type: "status",
      sessionId: input.sessionId,
      observe: {
        ...(input.turnId ? { turnId: input.turnId } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        includeRecovery: true,
        includeAudit: true,
        includeStream: true,
        includeToolOutcomes: true,
        includeRuntimeStatus: true,
      },
    });
  } catch {
    return createSessionObservationSnapshot(sessionStore, input);
  }
  if (!result.ok) {
    return createSessionObservationSnapshot(sessionStore, input);
  }
  const fromControlPlane =
    coerceSessionObservationSnapshot(result.data) ??
    coerceSessionObservationSnapshot(
      result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? (result.data as { snapshot?: unknown }).snapshot
        : undefined,
    );
  if (fromControlPlane) {
    return fromControlPlane;
  }

  return createSessionObservationSnapshot(sessionStore, input);
}

async function createSessionResumeSnapshotWithControlPlane(
  sessionStore: ReturnType<typeof bootstrapCli>["sessionStore"],
  controlPlane: ControlPlaneLike | undefined,
  input: {
    readonly sessionId: string;
    readonly checkpointId?: number;
    readonly defaultProviderId: string;
    readonly defaultModel: string;
  },
): Promise<SessionResumeSnapshot> {
  if (!controlPlane) {
    return createSessionResumeSnapshot(
      sessionStore,
      {
        sessionId: input.sessionId,
        ...(input.checkpointId === undefined ? {} : { requestedCheckpointId: input.checkpointId }),
      },
      {
        defaultProviderId: input.defaultProviderId,
        defaultModel: input.defaultModel,
      },
    );
  }

  let result: ControlPlaneDispatchResult;
  try {
    result = await controlPlane.dispatch({
      type: "resume",
      sessionId: input.sessionId,
      ...(input.checkpointId === undefined ? {} : { checkpointId: input.checkpointId }),
    });
  } catch {
    return createSessionResumeSnapshot(
      sessionStore,
      {
        sessionId: input.sessionId,
        ...(input.checkpointId === undefined ? {} : { requestedCheckpointId: input.checkpointId }),
      },
      {
        defaultProviderId: input.defaultProviderId,
        defaultModel: input.defaultModel,
      },
    );
  }
  if (!result.ok) {
    return createSessionResumeSnapshot(
      sessionStore,
      {
        sessionId: input.sessionId,
        ...(input.checkpointId === undefined ? {} : { requestedCheckpointId: input.checkpointId }),
      },
      {
        defaultProviderId: input.defaultProviderId,
        defaultModel: input.defaultModel,
      },
    );
  }

  const fromControlPlane =
    coerceSessionResumeSnapshot(result.data) ??
    coerceSessionResumeSnapshot(
      result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? (result.data as { snapshot?: unknown }).snapshot
        : undefined,
    );
  if (fromControlPlane) {
    return fromControlPlane;
  }

  return createSessionResumeSnapshot(
    sessionStore,
    {
      sessionId: input.sessionId,
      ...(input.checkpointId === undefined ? {} : { requestedCheckpointId: input.checkpointId }),
    },
    {
      defaultProviderId: input.defaultProviderId,
      defaultModel: input.defaultModel,
    },
  );
}

function renderResumeSnapshot(snapshot: SessionResumeSnapshot): string {
  const toolRuntimeStatus =
    snapshot.toolOutcomes.total > 0 ? deriveRuntimeStatus(snapshot.toolOutcomes) : undefined;
  const runtimeStatus = combineStatusRuntimeStatus(snapshot.runtimeStatus, toolRuntimeStatus);
  const lines = [
    `Session: ${snapshot.sessionId}`,
    `First step: ${snapshot.firstTodo}`,
    `Checkpoint: ${formatResumeCheckpoint(snapshot.checkpointId, snapshot.checkpointUptoSeq)}`,
    `Last applied seq: ${snapshot.lastAppliedSeq}`,
    `Journal events: ${snapshot.journalEvents}`,
    `Audit events: ${snapshot.auditEvents}`,
    `Stream events: ${snapshot.streamEvents}`,
    `Recovery turn: ${snapshot.latestTurnId ?? "(none)"}`,
    ...(snapshot.latestTurnId === null
      ? []
      : [`Recovery provider: ${snapshot.recoveryProviderId ?? "(unknown)"}`]),
    ...(snapshot.latestTurnId === null
      ? []
      : [`Recovery model: ${snapshot.recoveryModel ?? "(unknown)"}`]),
    ...(snapshot.latestTurnId === null
      ? []
      : [`Recovery selection source: ${snapshot.recoverySelectionSource}`]),
    ...(snapshot.latestTurnId === null
      ? []
      : [`Recovery reasoning source: ${snapshot.recoveryReasoningSource}`]),
    ...(snapshot.latestTurnId === null || snapshot.recoveryReasoningStrategy === null
      ? []
      : [`Recovery reasoning strategy: ${snapshot.recoveryReasoningStrategy}`]),
    `Resumable: ${snapshot.resumable ? "yes" : "no"}`,
    `Resume action: ${snapshot.resumeAction}`,
    `Next step index: ${snapshot.nextStepIndex}`,
    `Last step event: ${snapshot.lastStepEventType ?? "(none)"}`,
    `Tool outcomes: ${formatToolOutcomeSummary(snapshot.toolOutcomes)}`,
    `Runtime status: ${runtimeStatus}`,
    `Guidance: ${snapshot.guidance}`,
  ];
  if (snapshot.replayWindow !== undefined) {
    lines.splice(
      10,
      0,
      `Replay window: (${snapshot.replayWindow.fromSeqExclusive}, ${snapshot.replayWindow.toSeqInclusive}]`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function formatAgentOsTimelineObservationSummary(
  summary: SessionObservationSnapshot["agentOsTimelineSummary"],
): string {
  if (summary === undefined) {
    return "(none)";
  }

  const sequenceRange =
    summary.firstSequence === undefined || summary.lastSequence === undefined
      ? "seq=(none)"
      : `seq=${summary.firstSequence}..${summary.lastSequence}`;
  const latest = summary.latestEventType ?? summary.latestState ?? "(none)";

  return [
    `events=${summary.totalEvents}`,
    sequenceRange,
    `latest=${latest}`,
    `tools=${summary.toolEvents}`,
    `control=${summary.controlPlaneEvents}`,
    `final=${summary.finalDelivered ? "yes" : "no"}`,
  ].join(" ");
}

function formatResumeCheckpoint(
  checkpointId: number | null,
  checkpointUptoSeq: number | null,
): string {
  if (checkpointId === null) {
    return "(none)";
  }
  return checkpointUptoSeq === null
    ? String(checkpointId)
    : `${checkpointId} (seq ${checkpointUptoSeq})`;
}

function findLatestTurnId(journal: ReadonlyArray<{ turnId: string | null }>): string | undefined {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const turnId = journal[index]?.turnId;
    if (typeof turnId === "string" && turnId.length > 0) {
      return turnId;
    }
  }
  return undefined;
}

function recoverTurnUserInputText(
  sessionStore: Pick<ReturnType<typeof bootstrapCli>["sessionStore"], "recover">,
  input: {
    readonly sessionId: string;
    readonly turnId: string;
  },
): string | undefined {
  const recovered = sessionStore.recover(input.sessionId);
  for (let index = recovered.journal.length - 1; index >= 0; index -= 1) {
    const entry = recovered.journal[index];
    if (entry?.turnId !== input.turnId || entry.eventType !== "user.input") {
      continue;
    }
    const text = readUserInputText(entry.payload);
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

function readUserInputText(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const text = (payload as { text?: unknown }).text;
  return typeof text === "string" ? text : undefined;
}

export function pickLatestTurnIdFromTailEntries(
  entries: ReadonlyArray<{ turnId: string | null }>,
): string | undefined {
  return findLatestTurnId(entries);
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

export function summarizeRunToolOutcomes(
  toolResults: ReadonlyArray<{
    readonly resolution?: string;
    readonly ok?: boolean;
    readonly degradation?: unknown;
  }>,
): ToolOutcomeSummary {
  if (toolResults.length === 0) {
    return EMPTY_TOOL_OUTCOME_SUMMARY;
  }

  const counters = createToolOutcomeCounters();
  for (const result of toolResults) {
    countToolOutcome(
      counters,
      classifyToolOutcome({
        resolution: result.resolution,
        ok: result.ok,
        degradation: result.degradation,
      }),
    );
  }

  return toToolOutcomeSummary(counters);
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
  const total =
    counters.executed +
    counters.denied +
    counters.approvalRequired +
    counters.degraded +
    counters.failed +
    counters.missing +
    counters.unknown;
  return {
    total,
    ...counters,
  };
}

function classifyToolOutcome(input: {
  readonly resolution: string | undefined;
  readonly ok: boolean | undefined;
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
  if (input.ok === true) {
    return "executed";
  }
  return "unknown";
}

function extractToolOutcomesFromReplayPayload(payload: unknown): ToolOutcomeKey[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["unknown"];
  }

  const candidate = payload as { results?: unknown };
  if (!Array.isArray(candidate.results)) {
    return [
      classifyToolOutcome({
        resolution:
          typeof (payload as { resolution?: unknown }).resolution === "string"
            ? ((payload as { resolution?: unknown }).resolution as string)
            : undefined,
        ok:
          typeof (payload as { ok?: unknown }).ok === "boolean"
            ? ((payload as { ok?: unknown }).ok as boolean)
            : undefined,
        degradation: (payload as { degradation?: unknown }).degradation,
      }),
    ];
  }

  const outcomes: ToolOutcomeKey[] = [];
  for (const item of candidate.results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      outcomes.push("unknown");
      continue;
    }
    const resolution = (item as { resolution?: unknown }).resolution;
    const ok = (item as { ok?: unknown }).ok;
    const degradation = (item as { degradation?: unknown }).degradation;
    outcomes.push(
      classifyToolOutcome({
        resolution: typeof resolution === "string" ? resolution : undefined,
        ok: typeof ok === "boolean" ? ok : undefined,
        degradation,
      }),
    );
  }
  return outcomes.length > 0 ? outcomes : ["unknown"];
}

function resolveStatusContinuity(snapshot: SessionObservationSnapshot): {
  readonly source: "step" | "latest-turn" | "none";
  readonly resumeAction?: string;
  readonly nextStepIndex?: number;
  readonly lastStepEventType?: string;
} {
  const hasLatestTurnContinuity =
    snapshot.latestTurnResumeAction !== undefined ||
    snapshot.latestTurnNextStepIndex !== undefined ||
    snapshot.latestTurnLastStepEventType !== undefined;

  if (snapshot.step === undefined) {
    return hasLatestTurnContinuity
      ? {
          source: "latest-turn",
          ...(snapshot.latestTurnResumeAction === undefined
            ? {}
            : { resumeAction: snapshot.latestTurnResumeAction }),
          ...(snapshot.latestTurnNextStepIndex === undefined
            ? {}
            : { nextStepIndex: snapshot.latestTurnNextStepIndex }),
          ...(snapshot.latestTurnLastStepEventType === undefined
            ? {}
            : { lastStepEventType: snapshot.latestTurnLastStepEventType }),
        }
      : { source: "none" };
  }

  const checkpointShellOnly = isCheckpointShellOnly(snapshot.step);

  if (checkpointShellOnly && hasLatestTurnContinuity) {
    return {
      source: "latest-turn",
      resumeAction: snapshot.latestTurnResumeAction ?? snapshot.step.resumeAction,
      nextStepIndex: snapshot.latestTurnNextStepIndex ?? snapshot.step.nextStepIndex,
      ...(snapshot.latestTurnLastStepEventType === undefined
        ? {}
        : { lastStepEventType: snapshot.latestTurnLastStepEventType }),
    };
  }

  return {
    source: "step",
    resumeAction: snapshot.step.resumeAction,
    nextStepIndex: snapshot.step.nextStepIndex,
    ...(snapshot.step.lastStepEventType === undefined
      ? {}
      : { lastStepEventType: snapshot.step.lastStepEventType }),
  };
}

function resolveStatusSessionGuidance(
  snapshot: SessionObservationSnapshot,
): SessionObservationPromptSummary["sessionGuidance"] | undefined {
  return snapshot.sessionGuidance ?? snapshot.step?.promptSummary?.sessionGuidance;
}

function buildRuntimeDefaultGuidance(
  config: Pick<HotflowConfig, "outputStyle" | "permissionMode" | "responseLanguage">,
): PromptSessionGuidanceSummary {
  return {
    outputStyle: config.outputStyle ?? "normal",
    permissionMode: config.permissionMode ?? "ask",
    responseLanguage: config.responseLanguage ?? "follow-user",
  };
}

function hasSessionGuidanceOverride(
  guidance: PromptSessionGuidanceSummary | undefined,
  field: keyof PromptSessionGuidanceSummary,
): boolean {
  return (
    guidance !== undefined &&
    Object.prototype.hasOwnProperty.call(guidance, field) &&
    typeof guidance[field] === "string"
  );
}

function resolveEffectiveGuidanceSummary(
  config: Pick<HotflowConfig, "outputStyle" | "permissionMode" | "responseLanguage">,
  effectiveGuidance: PromptSessionGuidanceSummary | undefined,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSummary | undefined {
  if (effectiveGuidance !== undefined) {
    return effectiveGuidance;
  }

  const defaults = buildRuntimeDefaultGuidance(config);
  if (sessionGuidance === undefined) {
    return defaults;
  }

  return {
    ...defaults,
    ...sessionGuidance,
  };
}

function resolveEffectiveGuidanceSourceSummary(
  effectiveGuidanceSources: PromptSessionGuidanceSourceSummary | undefined,
  sessionGuidance: PromptSessionGuidanceSummary | undefined,
): PromptSessionGuidanceSourceSummary {
  if (effectiveGuidanceSources !== undefined) {
    return effectiveGuidanceSources;
  }

  return {
    outputStyle: hasSessionGuidanceOverride(sessionGuidance, "outputStyle")
      ? "session-override"
      : "runtime-default",
    permissionMode: hasSessionGuidanceOverride(sessionGuidance, "permissionMode")
      ? "session-override"
      : "runtime-default",
    responseLanguage: hasSessionGuidanceOverride(sessionGuidance, "responseLanguage")
      ? "session-override"
      : "runtime-default",
  };
}

function resolveStatusRuntimeState(snapshot: SessionObservationSnapshot): {
  readonly runtimeStatus?: string;
  readonly turnBranch?: string;
  readonly latestTurnStateSummary?: string;
} {
  const checkpointShellOnly = isCheckpointShellOnly(snapshot.step);
  const runtimeStatus = checkpointShellOnly
    ? (snapshot.latestTurnRuntimeStatus ?? snapshot.step?.runtimeStatus)
    : (snapshot.step?.runtimeStatus ?? snapshot.latestTurnRuntimeStatus);
  const turnBranch = snapshot.latestTurnTurnBranch;
  const latestTurnStateSummary = formatLatestTurnStateSummary({
    ...(snapshot.latestTurnRuntimeStatus === undefined
      ? {}
      : { runtimeStatus: snapshot.latestTurnRuntimeStatus }),
    ...(snapshot.latestTurnTurnBranch === undefined
      ? {}
      : { turnBranch: snapshot.latestTurnTurnBranch }),
  });

  return {
    ...(runtimeStatus === undefined ? {} : { runtimeStatus }),
    ...(turnBranch === undefined ? {} : { turnBranch }),
    ...(latestTurnStateSummary === undefined ? {} : { latestTurnStateSummary }),
  };
}

function combineStatusRuntimeStatus(
  primary: string | undefined,
  secondary: string | undefined,
): string | undefined {
  if (primary === undefined) {
    return secondary;
  }
  if (secondary === undefined) {
    return primary;
  }

  const priority: Record<string, number> = {
    healthy: 0,
    degraded: 1,
    blocked: 2,
    failed: 3,
  };
  return (priority[secondary] ?? -1) > (priority[primary] ?? -1) ? secondary : primary;
}

function resolveStatusFinishState(snapshot: SessionObservationSnapshot): {
  readonly finishReason?: string;
  readonly completedSteps?: number;
  readonly latestTurnFinishSummary?: string;
} {
  const finishReason = snapshot.latestTurnFinishReason;
  const completedSteps = snapshot.latestTurnCompletedSteps;
  const latestTurnFinishSummary = formatLatestTurnFinishSummary({
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(completedSteps === undefined ? {} : { completedSteps }),
  });

  return {
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(completedSteps === undefined ? {} : { completedSteps }),
    ...(latestTurnFinishSummary === undefined ? {} : { latestTurnFinishSummary }),
  };
}

function resolveStatusToolSummary(snapshot: SessionObservationSnapshot): {
  readonly source: "step" | "latest-turn" | "none";
  readonly toolCount?: number;
  readonly toolOutcomes?: ToolOutcomeSummary;
} {
  const hasLatestTurnToolSummary =
    snapshot.latestTurnToolCount !== undefined || snapshot.latestTurnToolOutcomes !== undefined;
  const latestTurnToolCount =
    snapshot.latestTurnToolCount ?? snapshot.latestTurnToolOutcomes?.total;

  if (snapshot.step === undefined) {
    return hasLatestTurnToolSummary
      ? {
          source: "latest-turn",
          ...(latestTurnToolCount === undefined ? {} : { toolCount: latestTurnToolCount }),
          ...(snapshot.latestTurnToolOutcomes === undefined
            ? {}
            : { toolOutcomes: snapshot.latestTurnToolOutcomes }),
        }
      : { source: "none" };
  }

  if (isCheckpointShellOnly(snapshot.step) && hasLatestTurnToolSummary) {
    return {
      source: "latest-turn",
      ...(latestTurnToolCount === undefined ? {} : { toolCount: latestTurnToolCount }),
      ...(snapshot.latestTurnToolOutcomes === undefined
        ? {}
        : { toolOutcomes: snapshot.latestTurnToolOutcomes }),
    };
  }

  return {
    source: "step",
    toolCount: snapshot.step.toolOutcomes.total,
    toolOutcomes: snapshot.step.toolOutcomes,
  };
}

function isCheckpointShellOnly(step: SessionObservationSnapshot["step"] | undefined): boolean {
  return (
    step !== undefined &&
    step.lastStepEventType === undefined &&
    step.stepJournalEvents === 0 &&
    step.modelOutputEvents === 0 &&
    step.plannedToolEvents === 0 &&
    step.toolResultEvents === 0 &&
    step.finalOutputEvents === 0
  );
}

function formatLatestTurnStateSummary(input: {
  readonly runtimeStatus?: string;
  readonly turnBranch?: string;
}): string | undefined {
  if (input.runtimeStatus === undefined && input.turnBranch === undefined) {
    return undefined;
  }

  const parts: string[] = [];
  if (input.runtimeStatus !== undefined) {
    parts.push(input.runtimeStatus);
  }
  if (input.turnBranch !== undefined) {
    parts.push(`(${summarizePromptTurnBranch(input.turnBranch)})`);
  }

  return parts.join(" ");
}

function formatLatestTurnFinishSummary(input: {
  readonly finishReason?: string;
  readonly completedSteps?: number;
}): string | undefined {
  if (input.finishReason === undefined && input.completedSteps === undefined) {
    return undefined;
  }

  const completedSteps =
    input.completedSteps === undefined
      ? undefined
      : `${input.completedSteps} completed step${input.completedSteps === 1 ? "" : "s"}`;

  if (input.finishReason !== undefined && completedSteps !== undefined) {
    return `${input.finishReason} (${completedSteps})`;
  }
  if (input.finishReason !== undefined) {
    return input.finishReason;
  }
  return completedSteps;
}

function renderControlActionResult(
  action: ParsedControlAction,
  data: unknown,
  config: Pick<HotflowConfig, "outputStyle" | "permissionMode" | "responseLanguage">,
): string {
  switch (action.type) {
    case "compact": {
      const compact = coerceCompactControlSnapshot(data);
      if (!compact) {
        return "Control action: compact\nControl action completed.\n";
      }
      const lines = [
        "Control action: compact",
        `Session: ${compact.sessionId}`,
        `Compacted: ${compact.compacted ? "yes" : "no"}`,
        `Strategy: ${compact.strategy}`,
      ];
      if (compact.beforeTokens !== undefined || compact.afterTokens !== undefined) {
        lines.push(
          `Memory tokens: ${compact.beforeTokens ?? "?"} -> ${compact.afterTokens ?? "?"}`,
        );
      }
      if (compact.reducedTokens !== undefined) {
        lines.push(`Reduced tokens: ${compact.reducedTokens}`);
      }
      if (compact.beforeEntryCount !== undefined || compact.afterEntryCount !== undefined) {
        lines.push(
          `Memory entries: ${compact.beforeEntryCount ?? "?"} -> ${compact.afterEntryCount ?? "?"}`,
        );
      }
      if (compact.removedEntryIds.length > 0) {
        lines.push(`Removed memory ids: ${compact.removedEntryIds.join(", ")}`);
      }
      if (compact.summaryEntryIds.length > 0) {
        lines.push(`Summary memory ids: ${compact.summaryEntryIds.join(", ")}`);
      }
      if (compact.reason !== undefined) {
        lines.push(`Reason: ${compact.reason}`);
      }
      return `${lines.join("\n")}\n`;
    }
    case "resume": {
      const resume = coerceSessionResumeSnapshot(data);
      if (!resume) {
        return "Control action: resume\nControl action completed.\n";
      }
      const lines = [
        "Control action: resume",
        `Session: ${resume.sessionId}`,
        `Requested checkpoint: ${resume.requestedCheckpointId ?? "(current)"}`,
        `Checkpoint: ${formatResumeCheckpoint(resume.checkpointId, resume.checkpointUptoSeq)}`,
        `Recovery turn: ${resume.latestTurnId ?? "(none)"}`,
        ...(resume.latestTurnId === null
          ? []
          : [`Recovery provider: ${resume.recoveryProviderId ?? "(unknown)"}`]),
        ...(resume.latestTurnId === null
          ? []
          : [`Recovery model: ${resume.recoveryModel ?? "(unknown)"}`]),
        ...(resume.latestTurnId === null
          ? []
          : [`Recovery selection source: ${resume.recoverySelectionSource}`]),
        ...(resume.latestTurnId === null
          ? []
          : [`Recovery reasoning source: ${resume.recoveryReasoningSource}`]),
        ...(resume.latestTurnId === null || resume.recoveryReasoningStrategy === null
          ? []
          : [`Recovery reasoning strategy: ${resume.recoveryReasoningStrategy}`]),
        `Resumable: ${resume.resumable ? "yes" : "no"}`,
        `Resume action: ${resume.resumeAction}`,
        `Next step index: ${resume.nextStepIndex}`,
        `Runtime status: ${resume.runtimeStatus}`,
        `Guidance: ${resume.guidance}`,
      ];
      if (resume.replayWindow !== undefined) {
        lines.push(
          `Replay window: (${resume.replayWindow.fromSeqExclusive}, ${resume.replayWindow.toSeqInclusive}]`,
        );
      }
      if (resume.lastStepEventType !== undefined) {
        lines.push(`Last step event: ${resume.lastStepEventType}`);
      }
      lines.push(`Tool outcomes: ${formatToolOutcomeSummary(resume.toolOutcomes)}`);
      return `${lines.join("\n")}\n`;
    }
    case "rewind": {
      const rewind = coerceRewindControlSnapshot(data);
      if (!rewind) {
        return "Control action: rewind\nControl action completed.\n";
      }
      const lines = [
        "Control action: rewind",
        `Session: ${rewind.sessionId}`,
        `Selection: ${rewind.selection}`,
        `Target checkpoint: ${rewind.targetCheckpointId} (seq ${rewind.targetUptoSeq})`,
        `Current checkpoint: ${rewind.currentCheckpointId} (seq ${rewind.currentUptoSeq})`,
        `Latest turn after rewind: ${rewind.latestTurnId ?? "(none)"}`,
        `Cleared latest-turn guidance: ${rewind.clearedLatestTurn ? "yes" : "no"}`,
      ];
      if (rewind.requestedCheckpointId !== null) {
        lines.push(`Requested checkpoint: ${rewind.requestedCheckpointId}`);
      }
      return `${lines.join("\n")}\n`;
    }
    case "prompt-inspect": {
      const promptInspect = coercePromptInspectControlSnapshot(data);
      if (!promptInspect) {
        return "Control action: prompt-inspect\nControl action completed.\n";
      }
      return renderPromptInspectControlSnapshot(promptInspect, config);
    }
    case "prompt-explain": {
      const promptExplain = coercePromptExplainControlSnapshot(data);
      if (!promptExplain) {
        return "Control action: prompt-explain\nControl action completed.\n";
      }
      return renderPromptExplainControlSnapshot(promptExplain, config);
    }
    case "output-style": {
      const outputStyle = coerceOutputStyleControlSnapshot(data);
      if (!outputStyle) {
        return "Control action: output-style\nControl action completed.\n";
      }
      const effectiveGuidance = resolveEffectiveGuidanceSummary(
        config,
        outputStyle.effectiveGuidance,
        outputStyle.sessionGuidance,
      );
      const effectiveGuidanceSources = resolveEffectiveGuidanceSourceSummary(
        outputStyle.effectiveGuidanceSources,
        outputStyle.sessionGuidance,
      );
      return `${[
        "Control action: output-style",
        `Session: ${outputStyle.sessionId}`,
        ...(outputStyle.previousStyle === undefined
          ? []
          : [`Previous output style: ${outputStyle.previousStyle}`]),
        `Output style: ${outputStyle.style}`,
        ...(effectiveGuidance === undefined
          ? []
          : [`Effective guidance: ${formatPromptSessionGuidance(effectiveGuidance)}`]),
        `Effective guidance sources: ${formatPromptSessionGuidanceSources(effectiveGuidanceSources)}`,
        ...(outputStyle.sessionGuidance === undefined
          ? []
          : [`Session guidance: ${formatPromptSessionGuidance(outputStyle.sessionGuidance)}`]),
      ].join("\n")}\n`;
    }
    case "permissions": {
      const permissions = coercePermissionsControlSnapshot(data);
      if (!permissions) {
        return "Control action: permissions\nControl action completed.\n";
      }
      const effectiveGuidance = resolveEffectiveGuidanceSummary(
        config,
        permissions.effectiveGuidance,
        permissions.sessionGuidance,
      );
      const effectiveGuidanceSources = resolveEffectiveGuidanceSourceSummary(
        permissions.effectiveGuidanceSources,
        permissions.sessionGuidance,
      );
      return `${[
        "Control action: permissions",
        `Session: ${permissions.sessionId}`,
        ...(permissions.previousMode === undefined
          ? []
          : [`Previous permission mode: ${permissions.previousMode}`]),
        `Permission mode: ${permissions.mode}`,
        ...(effectiveGuidance === undefined
          ? []
          : [`Effective guidance: ${formatPromptSessionGuidance(effectiveGuidance)}`]),
        `Effective guidance sources: ${formatPromptSessionGuidanceSources(effectiveGuidanceSources)}`,
        ...(permissions.sessionGuidance === undefined
          ? []
          : [`Session guidance: ${formatPromptSessionGuidance(permissions.sessionGuidance)}`]),
      ].join("\n")}\n`;
    }
    case "language": {
      const language = coerceLanguageControlSnapshot(data);
      if (!language) {
        return "Control action: language\nControl action completed.\n";
      }
      const effectiveGuidance = resolveEffectiveGuidanceSummary(
        config,
        language.effectiveGuidance,
        language.sessionGuidance,
      );
      const effectiveGuidanceSources = resolveEffectiveGuidanceSourceSummary(
        language.effectiveGuidanceSources,
        language.sessionGuidance,
      );
      return `${[
        "Control action: language",
        `Session: ${language.sessionId}`,
        ...(language.previousLanguage === undefined
          ? []
          : [`Previous response language: ${language.previousLanguage}`]),
        `Response language: ${language.language}`,
        ...(effectiveGuidance === undefined
          ? []
          : [`Effective guidance: ${formatPromptSessionGuidance(effectiveGuidance)}`]),
        `Effective guidance sources: ${formatPromptSessionGuidanceSources(effectiveGuidanceSources)}`,
        ...(language.sessionGuidance === undefined
          ? []
          : [`Session guidance: ${formatPromptSessionGuidance(language.sessionGuidance)}`]),
      ].join("\n")}\n`;
    }
    case "memory-inspect": {
      const inspection = coerceMemoryInspectControlSnapshot(data);
      if (!inspection) {
        return "Control action: memory-inspect\nControl action completed.\n";
      }
      return renderMemoryControlSnapshot("memory-inspect", inspection);
    }
    case "memory-clear": {
      const cleared = coerceMemoryClearControlSnapshot(data);
      if (!cleared) {
        return "Control action: memory-clear\nControl action completed.\n";
      }
      return renderMemoryControlSnapshot("memory-clear", cleared);
    }
    default:
      return assertNever(action);
  }
}

function renderMemoryControlSnapshot(
  action: "memory-inspect" | "memory-clear",
  snapshot: MemoryInspectControlSnapshot | MemoryClearControlSnapshot,
): string {
  const lines = [
    `Control action: ${action}`,
    `Session: ${snapshot.sessionId}`,
    `Scope: ${snapshot.scope}`,
  ];

  if ("layer0Count" in snapshot && snapshot.layer0Count !== undefined) {
    lines.push(`Working memory entries: ${snapshot.layer0Count}`);
  }
  if ("layer1Count" in snapshot && snapshot.layer1Count !== undefined) {
    lines.push(`Episodic memory entries: ${snapshot.layer1Count}`);
  }
  if (
    "beforeLayer0Count" in snapshot &&
    snapshot.beforeLayer0Count !== undefined &&
    snapshot.afterLayer0Count !== undefined
  ) {
    lines.push(
      `Working memory entries: ${snapshot.beforeLayer0Count} -> ${snapshot.afterLayer0Count}`,
    );
  }
  if (
    "beforeLayer1Count" in snapshot &&
    snapshot.beforeLayer1Count !== undefined &&
    snapshot.afterLayer1Count !== undefined
  ) {
    lines.push(
      `Episodic memory entries: ${snapshot.beforeLayer1Count} -> ${snapshot.afterLayer1Count}`,
    );
  }
  if ("layer0Cleared" in snapshot) {
    lines.push(`Working memory cleared: ${snapshot.layer0Cleared}`);
  }
  if ("layer1Cleared" in snapshot) {
    lines.push(`Episodic memory cleared: ${snapshot.layer1Cleared}`);
  }
  if (snapshot.layer0Ids.length > 0) {
    lines.push(`Working memory ids: ${snapshot.layer0Ids.join(", ")}`);
  }
  if (snapshot.layer1Ids.length > 0) {
    lines.push(`Episodic memory ids: ${snapshot.layer1Ids.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderPromptInspectControlSnapshot(
  snapshot: PromptInspectControlSnapshot,
  config: Pick<HotflowConfig, "outputStyle" | "permissionMode" | "responseLanguage">,
): string {
  const focusSectionIds =
    snapshot.focusSectionIds ?? snapshot.dynamicSections.map((section) => section.id);
  const omittedSectionIds =
    snapshot.omittedSectionIds ?? snapshot.omittedSections.map((section) => section.id);
  const lines = [
    "Control action: prompt-inspect",
    `Session: ${snapshot.sessionId}`,
    `Turn: ${snapshot.turnId}`,
    `Step index: ${snapshot.stepIndex}`,
    `Available prompt steps: ${snapshot.availableStepIndices.join(", ")}`,
    `Prompt tokens: used=${snapshot.usedTokens} remaining=${snapshot.remainingTokens}`,
    `Prompt focus: ${formatPromptExplainIds(
      selectPromptSectionLabels(snapshot.focusSectionSummaries, focusSectionIds),
    )}`,
    `Prompt omissions: ${formatPromptExplainIds(
      selectPromptSectionLabels(snapshot.omittedSectionSummaries, omittedSectionIds),
    )}`,
  ];

  const effectiveGuidance = resolveEffectiveGuidanceSummary(
    config,
    snapshot.effectiveGuidance,
    snapshot.sessionGuidance,
  );
  const effectiveGuidanceSources = resolveEffectiveGuidanceSourceSummary(
    snapshot.effectiveGuidanceSources,
    snapshot.sessionGuidance,
  );
  if (effectiveGuidance) {
    lines.push(`Effective guidance: ${formatPromptSessionGuidance(effectiveGuidance)}`);
  }
  lines.push(
    `Effective guidance sources: ${formatPromptSessionGuidanceSources(effectiveGuidanceSources)}`,
  );
  if (snapshot.sessionGuidance) {
    lines.push(`Session guidance: ${formatPromptSessionGuidance(snapshot.sessionGuidance)}`);
  }
  if (snapshot.runtimeShellSectionIds && snapshot.runtimeShellSectionIds.length > 0) {
    lines.push(
      `Runtime shell: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.runtimeShellSectionSummaries,
          snapshot.runtimeShellSectionIds,
        ),
      )}`,
    );
  }
  if (snapshot.staticGuidanceSectionIds && snapshot.staticGuidanceSectionIds.length > 0) {
    lines.push(
      `Static guidance: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.staticGuidanceSectionSummaries,
          snapshot.staticGuidanceSectionIds,
        ),
      )}`,
    );
  }
  if (snapshot.toolRuntimeGuidance) {
    lines.push(
      `Tool runtime guidance: ${formatPromptToolRuntimeGuidance(snapshot.toolRuntimeGuidance)}`,
    );
    const toolRuntimeDetail = formatPromptToolRuntimeGuidanceDetail(snapshot.toolRuntimeGuidance);
    if (toolRuntimeDetail !== undefined) {
      lines.push(`Tool runtime details: ${toolRuntimeDetail}`);
    }
    const toolRuntimeMetadataDetail = formatPromptToolRuntimeMetadataDetail(
      snapshot.toolRuntimeGuidance,
    );
    if (toolRuntimeMetadataDetail !== undefined) {
      lines.push(`Tool runtime metadata: ${toolRuntimeMetadataDetail}`);
    }
  }
  if (snapshot.turnResumeGuidance) {
    lines.push(
      `Turn resume guidance: ${formatPromptTurnResumeGuidance(snapshot.turnResumeGuidance)}`,
    );
  }
  if (snapshot.latestTurnGuidance) {
    lines.push(
      `Latest turn guidance: ${formatPromptLatestTurnGuidance(snapshot.latestTurnGuidance)}`,
    );
    const latestTurnReasoningRationale = formatPromptLatestTurnReasoningRationale(
      snapshot.latestTurnGuidance.reasoning,
    );
    if (latestTurnReasoningRationale !== undefined) {
      lines.push(`Latest turn reasoning rationale: ${latestTurnReasoningRationale}`);
    }
  }
  if (snapshot.runtimeDegradationSummaries && snapshot.runtimeDegradationSummaries.length > 0) {
    lines.push(
      `Prompt degradations: ${formatPromptRuntimeDegradationSummaries(snapshot.runtimeDegradationSummaries)}`,
    );
  } else if (snapshot.runtimeDegradations.length === 0) {
    lines.push("Prompt degradations: (none)");
  }
  if (snapshot.previousStepIndex === undefined) {
    lines.push("Change since previous prompt build: this is the first prompt build in the turn.");
  } else {
    lines.push(`Previous prompt step: ${snapshot.previousStepIndex}`);
    lines.push(
      `Added dynamic sections: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.addedDynamicSectionSummaries,
          snapshot.addedDynamicSectionIds,
        ),
      )}`,
    );
    lines.push(
      `Removed dynamic sections: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.removedDynamicSectionSummaries,
          snapshot.removedDynamicSectionIds,
        ),
      )}`,
    );
    lines.push(
      `Newly omitted sections: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.newlyOmittedSectionSummaries,
          snapshot.newlyOmittedSectionIds,
        ),
      )}`,
    );
    lines.push(
      `Restored omitted sections: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.restoredOmittedSectionSummaries,
          snapshot.restoredOmittedSectionIds,
        ),
      )}`,
    );
  }

  lines.push(`Static sections: ${snapshot.staticSections.length}`);
  lines.push(...renderPromptInspectSectionLines(snapshot.staticSections));
  lines.push(`Dynamic sections: ${snapshot.dynamicSections.length}`);
  lines.push(...renderPromptInspectSectionLines(snapshot.dynamicSections));
  lines.push(`Omitted sections: ${snapshot.omittedSections.length}`);
  lines.push(...renderPromptInspectSectionLines(snapshot.omittedSections));

  if (snapshot.runtimeDegradations.length === 0) {
    lines.push("Runtime degradations: (none)");
  } else {
    lines.push(`Runtime degradations: ${snapshot.runtimeDegradations.length}`);
    lines.push(...renderPromptInspectRuntimeDegradationLines(snapshot.runtimeDegradations));
  }

  return `${lines.join("\n")}\n`;
}

function renderPromptExplainControlSnapshot(
  snapshot: PromptExplainControlSnapshot,
  config: Pick<HotflowConfig, "outputStyle" | "permissionMode" | "responseLanguage">,
): string {
  const lines = [
    "Control action: prompt-explain",
    `Session: ${snapshot.sessionId}`,
    `Turn: ${snapshot.turnId}`,
    `Step index: ${snapshot.stepIndex}`,
    `Available prompt steps: ${snapshot.availableStepIndices.join(", ")}`,
    `Prompt tokens: used=${snapshot.usedTokens} remaining=${snapshot.remainingTokens}`,
    `Prompt focus: ${formatPromptExplainIds(selectPromptSectionLabels(snapshot.focusSectionSummaries, snapshot.focusSectionIds))}`,
    `Prompt omissions: ${formatPromptExplainIds(selectPromptSectionLabels(snapshot.omittedSectionSummaries, snapshot.omittedSectionIds))}`,
  ];
  if (snapshot.runtimeShellSectionIds && snapshot.runtimeShellSectionIds.length > 0) {
    lines.push(
      `Runtime shell: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.runtimeShellSectionSummaries,
          snapshot.runtimeShellSectionIds,
        ),
      )}`,
    );
  }
  if (snapshot.staticGuidanceSectionIds && snapshot.staticGuidanceSectionIds.length > 0) {
    lines.push(
      `Static guidance: ${formatPromptExplainIds(
        selectPromptSectionLabels(
          snapshot.staticGuidanceSectionSummaries,
          snapshot.staticGuidanceSectionIds,
        ),
      )}`,
    );
  }

  const effectiveGuidance = resolveEffectiveGuidanceSummary(
    config,
    snapshot.effectiveGuidance,
    snapshot.sessionGuidance,
  );
  const effectiveGuidanceSources = resolveEffectiveGuidanceSourceSummary(
    snapshot.effectiveGuidanceSources,
    snapshot.sessionGuidance,
  );
  if (effectiveGuidance) {
    lines.push(`Effective guidance: ${formatPromptSessionGuidance(effectiveGuidance)}`);
  }
  lines.push(
    `Effective guidance sources: ${formatPromptSessionGuidanceSources(effectiveGuidanceSources)}`,
  );
  if (snapshot.sessionGuidance) {
    lines.push(`Session guidance: ${formatPromptSessionGuidance(snapshot.sessionGuidance)}`);
  }
  if (snapshot.toolRuntimeGuidance) {
    lines.push(
      `Tool runtime guidance: ${formatPromptToolRuntimeGuidance(snapshot.toolRuntimeGuidance)}`,
    );
    const toolRuntimeDetail = formatPromptToolRuntimeGuidanceDetail(snapshot.toolRuntimeGuidance);
    if (toolRuntimeDetail !== undefined) {
      lines.push(`Tool runtime details: ${toolRuntimeDetail}`);
    }
    const toolRuntimeMetadataDetail = formatPromptToolRuntimeMetadataDetail(
      snapshot.toolRuntimeGuidance,
    );
    if (toolRuntimeMetadataDetail !== undefined) {
      lines.push(`Tool runtime metadata: ${toolRuntimeMetadataDetail}`);
    }
  }
  if (snapshot.turnResumeGuidance) {
    lines.push(
      `Turn resume guidance: ${formatPromptTurnResumeGuidance(snapshot.turnResumeGuidance)}`,
    );
  }
  if (snapshot.latestTurnGuidance) {
    lines.push(
      `Latest turn guidance: ${formatPromptLatestTurnGuidance(snapshot.latestTurnGuidance)}`,
    );
    const latestTurnReasoningRationale = formatPromptLatestTurnReasoningRationale(
      snapshot.latestTurnGuidance.reasoning,
    );
    if (latestTurnReasoningRationale !== undefined) {
      lines.push(`Latest turn reasoning rationale: ${latestTurnReasoningRationale}`);
    }
  }
  if (snapshot.runtimeDegradationSummaries && snapshot.runtimeDegradationSummaries.length > 0) {
    lines.push(
      `Prompt degradations: ${formatPromptRuntimeDegradationSummaries(snapshot.runtimeDegradationSummaries)}`,
    );
  } else if (snapshot.runtimeDegradations.length === 0) {
    lines.push("Prompt degradations: (none)");
  }

  if (snapshot.previousStepIndex === undefined) {
    lines.push("Change since previous prompt build: this is the first prompt build in the turn.");
  } else {
    lines.push(`Previous prompt step: ${snapshot.previousStepIndex}`);
    lines.push(
      `Added dynamic sections: ${formatPromptExplainIds(selectPromptSectionLabels(snapshot.addedDynamicSectionSummaries, snapshot.addedDynamicSectionIds))}`,
    );
    lines.push(
      `Removed dynamic sections: ${formatPromptExplainIds(selectPromptSectionLabels(snapshot.removedDynamicSectionSummaries, snapshot.removedDynamicSectionIds))}`,
    );
    lines.push(
      `Newly omitted sections: ${formatPromptExplainIds(selectPromptSectionLabels(snapshot.newlyOmittedSectionSummaries, snapshot.newlyOmittedSectionIds))}`,
    );
    lines.push(
      `Restored omitted sections: ${formatPromptExplainIds(selectPromptSectionLabels(snapshot.restoredOmittedSectionSummaries, snapshot.restoredOmittedSectionIds))}`,
    );
  }

  if (snapshot.runtimeDegradations.length === 0) {
    lines.push("Runtime degradations: (none)");
  } else {
    lines.push(`Runtime degradations: ${snapshot.runtimeDegradations.length}`);
    lines.push(...renderPromptInspectRuntimeDegradationLines(snapshot.runtimeDegradations));
  }

  return `${lines.join("\n")}\n`;
}

function formatLatestMemoryControlHeader(
  summary: NonNullable<SessionObservationSnapshot["latestMemoryControl"]>,
): string {
  return `${summary.action} (scope=${summary.scope})`;
}

function formatLatestMemoryControlDetail(
  summary: NonNullable<SessionObservationSnapshot["latestMemoryControl"]>,
): string | undefined {
  if (summary.action === "clear") {
    const parts = [];
    if (
      summary.beforeWorkingMemoryEntries !== undefined &&
      summary.afterWorkingMemoryEntries !== undefined
    ) {
      parts.push(
        `working ${summary.beforeWorkingMemoryEntries} -> ${summary.afterWorkingMemoryEntries}`,
      );
    }
    if (
      summary.beforeEpisodicMemoryEntries !== undefined &&
      summary.afterEpisodicMemoryEntries !== undefined
    ) {
      parts.push(
        `episodic ${summary.beforeEpisodicMemoryEntries} -> ${summary.afterEpisodicMemoryEntries}`,
      );
    }
    return parts.length > 0 ? parts.join("; ") : undefined;
  }

  const parts = [];
  if (summary.workingMemoryEntries !== undefined) {
    parts.push(`working=${summary.workingMemoryEntries}`);
  }
  if (summary.episodicMemoryEntries !== undefined) {
    parts.push(`episodic=${summary.episodicMemoryEntries}`);
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function formatLatestMemoryControlJournal(
  summary: NonNullable<SessionObservationSnapshot["latestMemoryControl"]>,
): string | undefined {
  const parts = [];
  if (summary.journalSeq !== undefined) {
    parts.push(`seq ${summary.journalSeq}`);
  }
  if (summary.occurredAtMs !== undefined) {
    parts.push(new Date(summary.occurredAtMs).toISOString());
  }
  return parts.length > 0 ? parts.join(" at ") : undefined;
}

function formatLatestGuidanceControlHeader(
  summary: NonNullable<SessionObservationSnapshot["latestGuidanceControl"]>,
): string {
  return `${summary.action}=${summary.value}`;
}

function formatLatestGuidanceControlDetail(
  summary: NonNullable<SessionObservationSnapshot["latestGuidanceControl"]>,
): string | undefined {
  if (summary.previousValue === undefined) {
    return undefined;
  }

  return `${summary.previousValue} -> ${summary.value}`;
}

function formatLatestGuidanceControlJournal(
  summary: NonNullable<SessionObservationSnapshot["latestGuidanceControl"]>,
): string | undefined {
  const parts = [];
  if (summary.journalSeq !== undefined) {
    parts.push(`seq ${summary.journalSeq}`);
  }
  if (summary.occurredAtMs !== undefined) {
    parts.push(new Date(summary.occurredAtMs).toISOString());
  }
  return parts.length > 0 ? parts.join(" at ") : undefined;
}

function renderPromptInspectSectionLines(
  sections: readonly PromptInspectSectionSummary[],
): readonly string[] {
  if (sections.length === 0) {
    return ["  - (none)"];
  }

  return sections.map((section) => {
    const suffix: string[] = [`cache=${section.cacheBucket}`];
    if (section.owner) {
      suffix.push(`owner=${section.owner}`);
    }
    if (section.priority !== undefined) {
      suffix.push(`priority=${section.priority}`);
    }
    if (section.metadataPreview && Object.keys(section.metadataPreview).length > 0) {
      suffix.push(`metadata=${formatPromptSectionMetadataPreview(section.metadataPreview)}`);
    } else if (section.metadataKeys && section.metadataKeys.length > 0) {
      suffix.push(`metadata=${section.metadataKeys.join(",")}`);
    }
    return `  - ${section.id} ${suffix.join(" ")}`;
  });
}

function renderPromptInspectRuntimeDegradationLines(
  degradations: readonly PromptInspectRuntimeDegradation[],
): readonly string[] {
  return degradations.map(
    (degradation) =>
      `  - stage=${degradation.stage} category=${degradation.category} severity=${degradation.severity} reason=${degradation.reason} message=${degradation.message}${formatPromptRuntimeDegradationMetadataSuffix(degradation)}`,
  );
}

function formatPromptRuntimeDegradationMetadataSuffix(
  degradation: PromptInspectRuntimeDegradation,
): string {
  if (
    degradation.metadataPreview === undefined ||
    Object.keys(degradation.metadataPreview).length === 0
  ) {
    return "";
  }

  return ` metadata=${formatPromptSectionMetadataPreview(degradation.metadataPreview)}`;
}

function formatPromptExplainIds(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(", ");
}

function selectPromptSectionLabels(
  summaries: readonly string[] | undefined,
  fallbackIds: readonly string[],
): readonly string[] {
  return summaries !== undefined ? summaries : fallbackIds;
}

function formatPromptSectionMetadataPreview(
  metadataPreview: Readonly<Record<string, string | number | boolean>>,
): string {
  return Object.entries(metadataPreview)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",");
}

function formatPromptSessionGuidance(
  guidance: NonNullable<SessionPromptExplainSnapshot["sessionGuidance"]>,
): string {
  const parts: string[] = [];
  if (guidance.outputStyle !== undefined) {
    parts.push(`output-style=${guidance.outputStyle}`);
  }
  if (guidance.permissionMode !== undefined) {
    parts.push(`permission-mode=${guidance.permissionMode}`);
  }
  if (guidance.responseLanguage !== undefined) {
    parts.push(`response-language=${guidance.responseLanguage}`);
  }
  return parts.length === 0 ? "(none)" : parts.join(" ");
}

function formatPromptSessionGuidanceSources(
  guidanceSources: PromptSessionGuidanceSourceSummary,
): string {
  const parts: string[] = [];
  if (guidanceSources.outputStyle !== undefined) {
    parts.push(`output-style=${guidanceSources.outputStyle}`);
  }
  if (guidanceSources.permissionMode !== undefined) {
    parts.push(`permission-mode=${guidanceSources.permissionMode}`);
  }
  if (guidanceSources.responseLanguage !== undefined) {
    parts.push(`response-language=${guidanceSources.responseLanguage}`);
  }
  return parts.length === 0 ? "(none)" : parts.join(" ");
}

function formatPromptToolRuntimeGuidance(
  guidance: NonNullable<SessionPromptExplainSnapshot["toolRuntimeGuidance"]>,
): string {
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
  return impactedTools ?? "(none)";
}

function formatPromptToolRuntimeGuidanceDetail(
  guidance: NonNullable<SessionPromptExplainSnapshot["toolRuntimeGuidance"]>,
): string | undefined {
  if (guidance.toolPreview === undefined || guidance.toolPreview.trim().length === 0) {
    return undefined;
  }

  const previewItems = guidance.toolPreview
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => formatPromptToolRuntimePreviewItem(item));

  if (previewItems.length === 0) {
    return undefined;
  }

  const previewedTools = guidance.previewedTools ?? previewItems.length;
  const additionalTools =
    guidance.previewTruncated === true && guidance.impactedTools !== undefined
      ? Math.max(0, guidance.impactedTools - previewedTools)
      : 0;

  return additionalTools > 0
    ? `${previewItems.join(", ")} (+${additionalTools} more)`
    : previewItems.join(", ");
}

function formatPromptToolRuntimeMetadataDetail(
  guidance: NonNullable<SessionPromptExplainSnapshot["toolRuntimeGuidance"]>,
): string | undefined {
  if (guidance.toolMetaPreview === undefined || guidance.toolMetaPreview.trim().length === 0) {
    return undefined;
  }

  const previewItems = guidance.toolMetaPreview
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => formatPromptToolRuntimeMetadataPreviewItem(item));

  if (previewItems.length === 0) {
    return undefined;
  }

  const previewedTools = guidance.metaPreviewedTools ?? previewItems.length;
  const additionalTools =
    guidance.metaPreviewTruncated === true && guidance.metaImpactedTools !== undefined
      ? Math.max(0, guidance.metaImpactedTools - previewedTools)
      : 0;

  return additionalTools > 0
    ? `${previewItems.join(", ")} (+${additionalTools} more)`
    : previewItems.join(", ");
}

function formatPromptToolRuntimePreviewItem(item: string): string {
  const separatorIndex = item.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === item.length - 1) {
    return item.replaceAll("_", " ");
  }

  const toolName = item.slice(0, separatorIndex);
  const status = item.slice(separatorIndex + 1).replaceAll("_", " ");
  return `${toolName}: ${status}`;
}

function formatPromptToolRuntimeMetadataPreviewItem(item: string): string {
  const bracketIndex = item.indexOf("[");
  if (bracketIndex <= 0 || !item.endsWith("]")) {
    return item;
  }

  const toolName = item.slice(0, bracketIndex);
  const detail = item.slice(bracketIndex + 1, -1);
  return detail.length === 0 ? toolName : `${toolName} [${detail}]`;
}

function formatPromptTurnResumeGuidance(
  guidance: NonNullable<SessionPromptExplainSnapshot["turnResumeGuidance"]>,
): string {
  const action =
    guidance.resumeAction === undefined
      ? undefined
      : summarizePromptResumeAction(guidance.resumeAction);
  const nextStep =
    guidance.nextStepIndex === undefined ? undefined : `step ${guidance.nextStepIndex}`;
  const recoveredToolResults =
    guidance.recoveredToolResults === undefined
      ? undefined
      : `${guidance.recoveredToolResults} recovered tool result${guidance.recoveredToolResults === 1 ? "" : "s"}`;

  const parts: string[] = [];
  if (action !== undefined && nextStep !== undefined) {
    parts.push(`${action} -> ${nextStep}`);
  } else if (action !== undefined) {
    parts.push(action);
  } else if (nextStep !== undefined) {
    parts.push(nextStep);
  }

  if (recoveredToolResults !== undefined) {
    parts.push(recoveredToolResults);
  }

  return parts.length === 0 ? "(none)" : parts.join(" ");
}

function formatPromptLatestTurnGuidance(
  guidance: NonNullable<SessionPromptExplainSnapshot["latestTurnGuidance"]>,
): string {
  const priorTurn = guidance.turnId === undefined ? undefined : `prior turn ${guidance.turnId}`;
  const runtimeStatus = guidance.runtimeStatus;
  const turnBranch =
    guidance.turnBranch === undefined ? undefined : summarizePromptTurnBranch(guidance.turnBranch);
  const reasoningSummary = formatPromptLatestTurnReasoningSummary(guidance.reasoning);

  const parts: string[] = [];
  if (priorTurn !== undefined) {
    parts.push(priorTurn);
  }
  if (runtimeStatus !== undefined) {
    parts.push(runtimeStatus);
  }
  if (turnBranch !== undefined) {
    parts.push(`(${turnBranch})`);
  }
  if (reasoningSummary !== undefined) {
    parts.push(reasoningSummary);
  }

  return parts.length === 0 ? "(none)" : parts.join(" ");
}

function formatPromptLatestTurnReasoningSummary(
  reasoning: PromptLatestTurnReasoningSummary | undefined,
): string | undefined {
  if (reasoning === undefined) {
    return undefined;
  }

  const strategy = reasoning.strategy === undefined ? undefined : `using ${reasoning.strategy}`;
  const modifiers: string[] = [];
  if (reasoning.confidence !== undefined) {
    modifiers.push(`confidence=${reasoning.confidence}`);
  }
  if (reasoning.suggestedAction !== undefined) {
    modifiers.push(`suggested action=${reasoning.suggestedAction.replaceAll("-", " ")}`);
  }

  if (strategy === undefined && modifiers.length === 0) {
    return undefined;
  }
  if (strategy === undefined) {
    return modifiers.join("; ");
  }
  return modifiers.length === 0 ? strategy : `${strategy} (${modifiers.join("; ")})`;
}

function formatPromptLatestTurnReasoningRationale(
  reasoning: PromptLatestTurnReasoningSummary | undefined,
): string | undefined {
  if (reasoning?.rationale === undefined || reasoning.rationale.trim().length === 0) {
    return undefined;
  }

  return reasoning.rationale;
}

function summarizePromptResumeAction(action: string): string {
  switch (action) {
    case "continue-current-step":
      return "continue current step";
    case "start-next-step":
      return "start next step";
    case "turn-complete":
      return "turn complete";
    case "no-progress":
      return "no progress";
    default:
      return action.replaceAll("-", " ");
  }
}

function summarizePromptTurnBranch(turnBranch: string): string {
  switch (turnBranch) {
    case "approval-required":
      return "approval required";
    case "policy-denied":
      return "policy denied";
    case "tool-degraded":
      return "tool degraded";
    case "tool-failed":
      return "tool failed";
    case "model-runtime-failed":
      return "model runtime failed";
    default:
      return turnBranch.replaceAll("-", " ");
  }
}

function formatPromptRuntimeDegradationSummaries(summaries: readonly string[]): string {
  return summaries.length === 0 ? "(none)" : summaries.join("; ");
}

function formatStatusPromptStep(summary: SessionObservationPromptSummary): string {
  return summary.previousStepIndex === undefined
    ? `${summary.stepIndex} (first prompt build in the turn)`
    : `${summary.stepIndex} (prev ${summary.previousStepIndex})`;
}

function formatStatusPromptChanges(summary: SessionObservationPromptSummary): string {
  if (summary.previousStepIndex === undefined) {
    return "first prompt build in the turn";
  }

  const dynamicChanges = [
    ...selectPromptSectionLabels(
      summary.addedDynamicSectionSummaries,
      summary.addedDynamicSectionIds,
    ).map((sectionId) => `+${sectionId}`),
    ...selectPromptSectionLabels(
      summary.removedDynamicSectionSummaries,
      summary.removedDynamicSectionIds,
    ).map((sectionId) => `-${sectionId}`),
  ];
  const omissionChanges = [
    ...selectPromptSectionLabels(
      summary.newlyOmittedSectionSummaries,
      summary.newlyOmittedSectionIds,
    ).map((sectionId) => `omit:+${sectionId}`),
    ...selectPromptSectionLabels(
      summary.restoredOmittedSectionSummaries,
      summary.restoredOmittedSectionIds,
    ).map((sectionId) => `restore:${sectionId}`),
  ];
  const changes = [...dynamicChanges, ...omissionChanges];
  if (changes.length > 0) {
    return changes.join(" ");
  }

  return "(none)";
}

interface CompactControlSnapshot {
  readonly sessionId: string;
  readonly compacted: boolean;
  readonly strategy: string;
  readonly beforeTokens?: number;
  readonly afterTokens?: number;
  readonly reducedTokens?: number;
  readonly beforeEntryCount?: number;
  readonly afterEntryCount?: number;
  readonly removedEntryIds: readonly string[];
  readonly summaryEntryIds: readonly string[];
  readonly reason?: string;
}

interface RewindControlSnapshot {
  readonly sessionId: string;
  readonly requestedCheckpointId: number | null;
  readonly selection: string;
  readonly targetCheckpointId: number;
  readonly targetUptoSeq: number;
  readonly currentCheckpointId: number;
  readonly currentUptoSeq: number;
  readonly latestTurnId: string | null;
  readonly clearedLatestTurn: boolean;
}

interface PromptInspectControlSnapshot extends SessionPromptInspectSnapshot {}
interface PromptExplainControlSnapshot extends SessionPromptExplainSnapshot {}

interface OutputStyleControlSnapshot {
  readonly sessionId: string;
  readonly style: string;
  readonly previousStyle?: string;
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
}

interface PermissionsControlSnapshot {
  readonly sessionId: string;
  readonly mode: string;
  readonly previousMode?: string;
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
}

interface LanguageControlSnapshot {
  readonly sessionId: string;
  readonly language: string;
  readonly previousLanguage?: string;
  readonly sessionGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidance?: PromptSessionGuidanceSummary;
  readonly effectiveGuidanceSources?: PromptSessionGuidanceSourceSummary;
}

interface MemoryInspectControlSnapshot {
  readonly sessionId: string;
  readonly scope: string;
  readonly layer0Count?: number;
  readonly layer1Count?: number;
  readonly layer0Ids: readonly string[];
  readonly layer1Ids: readonly string[];
}

interface MemoryClearControlSnapshot {
  readonly sessionId: string;
  readonly scope: string;
  readonly beforeLayer0Count?: number;
  readonly beforeLayer1Count?: number;
  readonly layer0Cleared: number;
  readonly layer1Cleared: number;
  readonly afterLayer0Count?: number;
  readonly afterLayer1Count?: number;
  readonly layer0Ids: readonly string[];
  readonly layer1Ids: readonly string[];
}

function coerceCompactControlSnapshot(data: unknown): CompactControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const compacted = readBooleanValue(record?.compacted);
  const strategy = readStringValue(record?.strategy);
  const reason = readStringValue(record?.reason);
  const beforeTokens = readNumberValue(record?.beforeTokens);
  const afterTokens = readNumberValue(record?.afterTokens);
  const reducedTokens = readNumberValue(record?.reducedTokens);
  const beforeEntryCount = readNumberValue(record?.beforeEntryCount);
  const afterEntryCount = readNumberValue(record?.afterEntryCount);

  if (sessionId === undefined || compacted === undefined || strategy === undefined) {
    return undefined;
  }

  return {
    sessionId,
    compacted,
    strategy,
    ...(beforeTokens === undefined ? {} : { beforeTokens }),
    ...(afterTokens === undefined ? {} : { afterTokens }),
    ...(reducedTokens === undefined ? {} : { reducedTokens }),
    ...(beforeEntryCount === undefined ? {} : { beforeEntryCount }),
    ...(afterEntryCount === undefined ? {} : { afterEntryCount }),
    removedEntryIds: readStringArray(record?.removedEntryIds),
    summaryEntryIds: readStringArray(record?.summaryEntryIds),
    ...(reason === undefined ? {} : { reason }),
  };
}

function coerceRewindControlSnapshot(data: unknown): RewindControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const selection = readStringValue(record?.selection);
  const targetCheckpointId = readNumberValue(record?.targetCheckpointId);
  const targetUptoSeq = readNumberValue(record?.targetUptoSeq);
  const currentCheckpointId = readNumberValue(record?.currentCheckpointId);
  const currentUptoSeq = readNumberValue(record?.currentUptoSeq);
  const clearedLatestTurn = readBooleanValue(record?.clearedLatestTurn);

  if (
    sessionId === undefined ||
    selection === undefined ||
    targetCheckpointId === undefined ||
    targetUptoSeq === undefined ||
    currentCheckpointId === undefined ||
    currentUptoSeq === undefined ||
    clearedLatestTurn === undefined
  ) {
    return undefined;
  }

  const requestedCheckpointId = readNumberValue(record?.requestedCheckpointId) ?? null;
  const latestTurnValue = record?.latestTurnId;
  const latestTurnId = latestTurnValue === null ? null : (readStringValue(latestTurnValue) ?? null);

  return {
    sessionId,
    requestedCheckpointId,
    selection,
    targetCheckpointId,
    targetUptoSeq,
    currentCheckpointId,
    currentUptoSeq,
    latestTurnId,
    clearedLatestTurn,
  };
}

function coercePromptInspectControlSnapshot(
  data: unknown,
): PromptInspectControlSnapshot | undefined {
  return coerceSessionPromptInspectSnapshot(data);
}

function coercePromptExplainControlSnapshot(
  data: unknown,
): PromptExplainControlSnapshot | undefined {
  return coerceSessionPromptExplainSnapshot(data);
}

function coerceOutputStyleControlSnapshot(data: unknown): OutputStyleControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const style = readStringValue(record?.style);
  const previousStyle = readStringValue(record?.previousStyle);
  const sessionGuidance = coerceControlSessionGuidance(record?.sessionGuidance);
  const effectiveGuidance = coerceControlSessionGuidance(record?.effectiveGuidance);
  const effectiveGuidanceSources = coerceControlSessionGuidanceSources(
    record?.effectiveGuidanceSources,
  );

  if (sessionId === undefined || style === undefined) {
    return undefined;
  }

  return {
    sessionId,
    style,
    ...(previousStyle === undefined ? {} : { previousStyle }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
  };
}

function coercePermissionsControlSnapshot(data: unknown): PermissionsControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const mode = readStringValue(record?.mode);
  const previousMode = readStringValue(record?.previousMode);
  const sessionGuidance = coerceControlSessionGuidance(record?.sessionGuidance);
  const effectiveGuidance = coerceControlSessionGuidance(record?.effectiveGuidance);
  const effectiveGuidanceSources = coerceControlSessionGuidanceSources(
    record?.effectiveGuidanceSources,
  );

  if (sessionId === undefined || mode === undefined) {
    return undefined;
  }

  return {
    sessionId,
    mode,
    ...(previousMode === undefined ? {} : { previousMode }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
  };
}

function coerceLanguageControlSnapshot(data: unknown): LanguageControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const language = readStringValue(record?.language);
  const previousLanguage = readStringValue(record?.previousLanguage);
  const sessionGuidance = coerceControlSessionGuidance(record?.sessionGuidance);
  const effectiveGuidance = coerceControlSessionGuidance(record?.effectiveGuidance);
  const effectiveGuidanceSources = coerceControlSessionGuidanceSources(
    record?.effectiveGuidanceSources,
  );

  if (sessionId === undefined || language === undefined) {
    return undefined;
  }

  return {
    sessionId,
    language,
    ...(previousLanguage === undefined ? {} : { previousLanguage }),
    ...(sessionGuidance === undefined ? {} : { sessionGuidance }),
    ...(effectiveGuidance === undefined ? {} : { effectiveGuidance }),
    ...(effectiveGuidanceSources === undefined ? {} : { effectiveGuidanceSources }),
  };
}

function coerceControlSessionGuidance(
  data: unknown,
): SessionPromptExplainSnapshot["sessionGuidance"] | undefined {
  const record = readObjectRecord(data);
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

function coerceControlSessionGuidanceSources(
  data: unknown,
): PromptSessionGuidanceSourceSummary | undefined {
  const record = readObjectRecord(data);
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

function coerceMemoryInspectControlSnapshot(
  data: unknown,
): MemoryInspectControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const scope = readStringValue(record?.scope);
  const layer0Count = readNumberValue(record?.layer0Count);
  const layer1Count = readNumberValue(record?.layer1Count);

  if (sessionId === undefined || scope === undefined) {
    return undefined;
  }

  return {
    sessionId,
    scope,
    ...(layer0Count === undefined ? {} : { layer0Count }),
    ...(layer1Count === undefined ? {} : { layer1Count }),
    layer0Ids: readStringArray(record?.layer0Ids),
    layer1Ids: readStringArray(record?.layer1Ids),
  };
}

function coerceMemoryClearControlSnapshot(data: unknown): MemoryClearControlSnapshot | undefined {
  const record = readObjectRecord(data);
  const sessionId = readStringValue(record?.sessionId);
  const scope = readStringValue(record?.scope);
  const beforeLayer0Count = readNumberValue(record?.beforeLayer0Count);
  const beforeLayer1Count = readNumberValue(record?.beforeLayer1Count);
  const layer0Cleared = readNumberValue(record?.layer0Cleared);
  const layer1Cleared = readNumberValue(record?.layer1Cleared);
  const afterLayer0Count = readNumberValue(record?.afterLayer0Count);
  const afterLayer1Count = readNumberValue(record?.afterLayer1Count);

  if (
    sessionId === undefined ||
    scope === undefined ||
    layer0Cleared === undefined ||
    layer1Cleared === undefined
  ) {
    return undefined;
  }

  return {
    sessionId,
    scope,
    ...(beforeLayer0Count === undefined ? {} : { beforeLayer0Count }),
    ...(beforeLayer1Count === undefined ? {} : { beforeLayer1Count }),
    layer0Cleared,
    layer1Cleared,
    ...(afterLayer0Count === undefined ? {} : { afterLayer0Count }),
    ...(afterLayer1Count === undefined ? {} : { afterLayer1Count }),
    layer0Ids: readStringArray(record?.layer0Ids),
    layer1Ids: readStringArray(record?.layer1Ids),
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

function readBooleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toControlPlaneAction(
  action: ParsedControlAction | ParsedTaskAction,
): Record<string, unknown> {
  switch (action.type) {
    case "compact":
      return {
        type: "compact",
        sessionId: action.sessionId,
        ...(action.strategy === undefined ? {} : { strategy: action.strategy }),
      };
    case "resume":
      return {
        type: "resume",
        sessionId: action.sessionId,
        ...(action.checkpointId === undefined ? {} : { checkpointId: action.checkpointId }),
      };
    case "rewind":
      return {
        type: "rewind",
        sessionId: action.sessionId,
        ...(action.checkpointId === undefined ? {} : { checkpointId: action.checkpointId }),
      };
    case "prompt-inspect":
      return {
        type: "prompt-inspect",
        sessionId: action.sessionId,
        ...(action.turnId === undefined ? {} : { turnId: action.turnId }),
        ...(action.stepIndex === undefined ? {} : { stepIndex: action.stepIndex }),
      };
    case "prompt-explain":
      return {
        type: "prompt-explain",
        sessionId: action.sessionId,
        ...(action.turnId === undefined ? {} : { turnId: action.turnId }),
        ...(action.stepIndex === undefined ? {} : { stepIndex: action.stepIndex }),
      };
    case "output-style":
      return {
        type: "output-style",
        sessionId: action.sessionId,
        style: action.style,
      };
    case "permissions":
      return {
        type: "permissions",
        sessionId: action.sessionId,
        mode: action.mode,
      };
    case "language":
      return {
        type: "language",
        sessionId: action.sessionId,
        language: action.language,
      };
    case "memory-inspect":
      return {
        type: "memory-inspect",
        sessionId: action.sessionId,
        ...(action.scope === undefined ? {} : { scope: action.scope }),
      };
    case "memory-clear":
      return {
        type: "memory-clear",
        sessionId: action.sessionId,
        ...(action.scope === undefined ? {} : { scope: action.scope }),
      };
    case "task-status":
      return {
        type: "task-status",
        sessionId: action.sessionId,
      };
    case "task-worker-mailbox":
      return {
        type: "task-worker-mailbox",
        sessionId: action.sessionId,
        ...(action.workerId === undefined ? {} : { workerId: action.workerId }),
      };
    case "task-verifier-mailbox":
      return {
        type: "task-verifier-mailbox",
        sessionId: action.sessionId,
        ...(action.verifierId === undefined ? {} : { verifierId: action.verifierId }),
      };
    case "delegation-enqueue":
      return {
        type: "delegation-enqueue",
        sessionId: action.sessionId,
        delegation: action.delegation,
      };
    case "delegation-status":
      return {
        type: "delegation-status",
        sessionId: action.sessionId,
        update: action.update,
      };
    case "verification-upsert":
      return {
        type: "verification-upsert",
        sessionId: action.sessionId,
        verification: action.verification,
      };
    case "proposal-enqueue":
      return {
        type: "proposal-enqueue",
        sessionId: action.sessionId,
        proposal: action.proposal,
      };
    case "proposal-transition":
      return {
        type: "proposal-transition",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
        status: action.status,
        ...(action.decisionNote ? { decisionNote: action.decisionNote } : {}),
      };
    case "proposal-list":
      return {
        type: "proposal-list",
        sessionId: action.sessionId,
        ...(action.status === undefined ? {} : { status: action.status }),
        ...(action.limit === undefined ? {} : { limit: action.limit }),
      };
    case "proposal-get":
      return {
        type: "proposal-get",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
      };
    case "proposal-review":
      return {
        type: "proposal-review",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
      };
    case "proposal-accept":
      return {
        type: "proposal-accept",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
        ...(action.decisionNote ? { decisionNote: action.decisionNote } : {}),
      };
    case "proposal-reject":
      return {
        type: "proposal-reject",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
        ...(action.decisionNote ? { decisionNote: action.decisionNote } : {}),
      };
    case "proposal-explain":
      return {
        type: "proposal-explain",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
      };
    case "proposal-preview":
      return {
        type: "proposal-preview",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
      };
    case "proposal-apply":
      return {
        type: "proposal-apply",
        sessionId: action.sessionId,
        proposalId: action.proposalId,
      };
    case "proposal-rollback":
      return {
        type: "proposal-rollback",
        sessionId: action.sessionId,
        ...(action.version === undefined ? {} : { version: action.version }),
      };
    case "proposal-outbox-drain":
      return {
        type: "proposal-outbox-drain",
        sessionId: action.sessionId,
        ...(action.limit === undefined ? {} : { limit: action.limit }),
      };
    default:
      return assertNever(action);
  }
}

function coerceTaskOperationsSnapshot(data: unknown): TaskOperationsSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    schemaVersion?: unknown;
    todos?: unknown;
    delegation?: unknown;
    verification?: unknown;
    proposalQueue?: unknown;
    proposalOutbox?: unknown;
    notifications?: unknown;
    lifecycle?: unknown;
    subagentRuns?: unknown;
    subagentSchedulerHeartbeat?: unknown;
    subagentSchedulerDispatchPlan?: unknown;
    subagentSchedulerTick?: unknown;
    subagentSchedulerRecoveryPlan?: unknown;
  };
  if (typeof candidate.schemaVersion !== "string") {
    return undefined;
  }
  if (
    !candidate.todos ||
    typeof candidate.todos !== "object" ||
    Array.isArray(candidate.todos) ||
    !Array.isArray((candidate.todos as { items?: unknown }).items) ||
    !Array.isArray(candidate.delegation) ||
    !Array.isArray(candidate.verification) ||
    !Array.isArray(candidate.proposalQueue) ||
    !Array.isArray(candidate.proposalOutbox)
  ) {
    return undefined;
  }
  const lifecycle =
    candidate.lifecycle === undefined ? undefined : coerceTaskLifecycleEntries(candidate.lifecycle);
  if (candidate.lifecycle !== undefined && lifecycle === undefined) {
    return undefined;
  }
  const notifications =
    candidate.notifications === undefined
      ? undefined
      : coerceTaskNotificationEntries(candidate.notifications);
  if (candidate.notifications !== undefined && notifications === undefined) {
    return undefined;
  }
  const subagentRuns =
    candidate.subagentRuns === undefined
      ? undefined
      : coerceTaskBackedSubagentRuns(candidate.subagentRuns);
  if (candidate.subagentRuns !== undefined && subagentRuns === undefined) {
    return undefined;
  }
  const subagentSchedulerHeartbeat =
    candidate.subagentSchedulerHeartbeat === undefined
      ? undefined
      : coerceTaskBackedSubagentSchedulerHeartbeat(candidate.subagentSchedulerHeartbeat);
  if (
    candidate.subagentSchedulerHeartbeat !== undefined &&
    subagentSchedulerHeartbeat === undefined
  ) {
    return undefined;
  }
  const subagentSchedulerDispatchPlan =
    candidate.subagentSchedulerDispatchPlan === undefined
      ? undefined
      : coerceTaskBackedSubagentSchedulerDispatchPlan(candidate.subagentSchedulerDispatchPlan);
  if (
    candidate.subagentSchedulerDispatchPlan !== undefined &&
    subagentSchedulerDispatchPlan === undefined
  ) {
    return undefined;
  }
  const subagentSchedulerTick =
    candidate.subagentSchedulerTick === undefined
      ? undefined
      : coerceTaskBackedSubagentSchedulerTick(candidate.subagentSchedulerTick);
  if (candidate.subagentSchedulerTick !== undefined && subagentSchedulerTick === undefined) {
    return undefined;
  }
  const subagentSchedulerRecoveryPlan =
    candidate.subagentSchedulerRecoveryPlan === undefined
      ? undefined
      : coerceTaskBackedSubagentSchedulerRecoveryPlan(candidate.subagentSchedulerRecoveryPlan);
  if (
    candidate.subagentSchedulerRecoveryPlan !== undefined &&
    subagentSchedulerRecoveryPlan === undefined
  ) {
    return undefined;
  }
  return {
    schemaVersion: candidate.schemaVersion,
    todos: candidate.todos as TaskOperationsSnapshot["todos"],
    delegation: candidate.delegation as TaskOperationsSnapshot["delegation"],
    verification: candidate.verification as TaskOperationsSnapshot["verification"],
    proposalQueue: candidate.proposalQueue as TaskOperationsSnapshot["proposalQueue"],
    proposalOutbox: candidate.proposalOutbox as TaskOperationsSnapshot["proposalOutbox"],
    ...(notifications === undefined ? {} : { notifications }),
    ...(lifecycle === undefined ? {} : { lifecycle }),
    ...(subagentRuns === undefined ? {} : { subagentRuns }),
    ...(subagentSchedulerHeartbeat === undefined ? {} : { subagentSchedulerHeartbeat }),
    ...(subagentSchedulerDispatchPlan === undefined ? {} : { subagentSchedulerDispatchPlan }),
    ...(subagentSchedulerTick === undefined ? {} : { subagentSchedulerTick }),
    ...(subagentSchedulerRecoveryPlan === undefined ? {} : { subagentSchedulerRecoveryPlan }),
  };
}

function coerceTaskBackedSubagentSchedulerHeartbeat(
  data: unknown,
): TaskBackedSubagentSchedulerHeartbeatSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    schemaId?: unknown;
    parentTurnId?: unknown;
    totalSubagentRuns?: unknown;
    queuedCount?: unknown;
    runningCount?: unknown;
    completedCount?: unknown;
    failedCount?: unknown;
    cancelledCount?: unknown;
    schedulerTrackedCount?: unknown;
    readyCount?: unknown;
    blockedCount?: unknown;
    unscheduledQueuedCount?: unknown;
    nextReadySubagentIds?: unknown;
    blockedSubagentIds?: unknown;
    runningSubagentIds?: unknown;
    nextParallelBatch?: unknown;
    canContinue?: unknown;
    stoppedReason?: unknown;
    heartbeatOrdinal?: unknown;
    latestUpdatedAtMs?: unknown;
  };
  const nextReadySubagentIds = coerceStringArray(candidate.nextReadySubagentIds);
  const blockedSubagentIds = coerceStringArray(candidate.blockedSubagentIds);
  const runningSubagentIds = coerceStringArray(candidate.runningSubagentIds);
  if (
    candidate.schemaId !== "hotflow.agent-os.subagent-scheduler-heartbeat.v1" ||
    typeof candidate.totalSubagentRuns !== "number" ||
    typeof candidate.queuedCount !== "number" ||
    typeof candidate.runningCount !== "number" ||
    typeof candidate.completedCount !== "number" ||
    typeof candidate.failedCount !== "number" ||
    typeof candidate.cancelledCount !== "number" ||
    typeof candidate.schedulerTrackedCount !== "number" ||
    typeof candidate.readyCount !== "number" ||
    typeof candidate.blockedCount !== "number" ||
    typeof candidate.unscheduledQueuedCount !== "number" ||
    nextReadySubagentIds === undefined ||
    blockedSubagentIds === undefined ||
    runningSubagentIds === undefined ||
    typeof candidate.canContinue !== "boolean" ||
    !isSubagentSchedulerStoppedReason(candidate.stoppedReason) ||
    typeof candidate.heartbeatOrdinal !== "number" ||
    (candidate.parentTurnId !== undefined && typeof candidate.parentTurnId !== "string") ||
    (candidate.nextParallelBatch !== undefined &&
      typeof candidate.nextParallelBatch !== "number") ||
    (candidate.latestUpdatedAtMs !== undefined && typeof candidate.latestUpdatedAtMs !== "number")
  ) {
    return undefined;
  }
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
    ...(candidate.parentTurnId === undefined ? {} : { parentTurnId: candidate.parentTurnId }),
    totalSubagentRuns: candidate.totalSubagentRuns,
    queuedCount: candidate.queuedCount,
    runningCount: candidate.runningCount,
    completedCount: candidate.completedCount,
    failedCount: candidate.failedCount,
    cancelledCount: candidate.cancelledCount,
    schedulerTrackedCount: candidate.schedulerTrackedCount,
    readyCount: candidate.readyCount,
    blockedCount: candidate.blockedCount,
    unscheduledQueuedCount: candidate.unscheduledQueuedCount,
    nextReadySubagentIds,
    blockedSubagentIds,
    runningSubagentIds,
    ...(candidate.nextParallelBatch === undefined
      ? {}
      : { nextParallelBatch: candidate.nextParallelBatch }),
    canContinue: candidate.canContinue,
    stoppedReason: candidate.stoppedReason,
    heartbeatOrdinal: candidate.heartbeatOrdinal,
    ...(candidate.latestUpdatedAtMs === undefined
      ? {}
      : { latestUpdatedAtMs: candidate.latestUpdatedAtMs }),
  };
}

function isSubagentSchedulerStoppedReason(
  data: unknown,
): data is "ready" | "scheduler-blocked" | "mailbox-empty" {
  return data === "ready" || data === "scheduler-blocked" || data === "mailbox-empty";
}

function coerceTaskBackedSubagentSchedulerDispatchPlan(
  data: unknown,
): TaskBackedSubagentSchedulerDispatchPlanSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    schemaId?: unknown;
    parentTurnId?: unknown;
    planOrdinal?: unknown;
    heartbeatOrdinal?: unknown;
    canDispatch?: unknown;
    dispatchReason?: unknown;
    maxDispatchableCount?: unknown;
    dispatchableSubagentIds?: unknown;
    dispatchBatches?: unknown;
    blockedSubagentIds?: unknown;
    runningSubagentIds?: unknown;
  };
  const dispatchableSubagentIds = coerceStringArray(candidate.dispatchableSubagentIds);
  const dispatchBatches = coerceSubagentSchedulerDispatchBatches(candidate.dispatchBatches);
  const blockedSubagentIds = coerceStringArray(candidate.blockedSubagentIds);
  const runningSubagentIds = coerceStringArray(candidate.runningSubagentIds);
  if (
    candidate.schemaId !== "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1" ||
    typeof candidate.planOrdinal !== "number" ||
    typeof candidate.heartbeatOrdinal !== "number" ||
    typeof candidate.canDispatch !== "boolean" ||
    !isSubagentSchedulerStoppedReason(candidate.dispatchReason) ||
    typeof candidate.maxDispatchableCount !== "number" ||
    dispatchableSubagentIds === undefined ||
    dispatchBatches === undefined ||
    blockedSubagentIds === undefined ||
    runningSubagentIds === undefined ||
    (candidate.parentTurnId !== undefined && typeof candidate.parentTurnId !== "string")
  ) {
    return undefined;
  }
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
    ...(candidate.parentTurnId === undefined ? {} : { parentTurnId: candidate.parentTurnId }),
    planOrdinal: candidate.planOrdinal,
    heartbeatOrdinal: candidate.heartbeatOrdinal,
    canDispatch: candidate.canDispatch,
    dispatchReason: candidate.dispatchReason,
    maxDispatchableCount: candidate.maxDispatchableCount,
    dispatchableSubagentIds,
    dispatchBatches,
    blockedSubagentIds,
    runningSubagentIds,
  };
}

function coerceSubagentSchedulerDispatchBatches(
  data: unknown,
): readonly TaskBackedSubagentSchedulerDispatchBatchSnapshot[] | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const batches: TaskBackedSubagentSchedulerDispatchBatchSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      parallelBatch?: unknown;
      subagentIds?: unknown;
      workerIds?: unknown;
      writeSets?: unknown;
    };
    const subagentIds = coerceStringArray(candidate.subagentIds);
    const workerIds = coerceStringArray(candidate.workerIds);
    const writeSets = coerceSubagentSchedulerDispatchWriteSets(candidate.writeSets);
    if (
      typeof candidate.parallelBatch !== "number" ||
      subagentIds === undefined ||
      workerIds === undefined ||
      writeSets === undefined
    ) {
      return undefined;
    }
    batches.push({
      parallelBatch: candidate.parallelBatch,
      subagentIds,
      workerIds,
      writeSets,
    });
  }
  return batches;
}

function coerceSubagentSchedulerDispatchWriteSets(
  data: unknown,
): readonly TaskBackedSubagentSchedulerDispatchWriteSetSnapshot[] | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const writeSets: TaskBackedSubagentSchedulerDispatchWriteSetSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      subagentId?: unknown;
      writeSet?: unknown;
      writeSetSource?: unknown;
    };
    const writeSet = coerceStringArray(candidate.writeSet);
    if (
      typeof candidate.subagentId !== "string" ||
      writeSet === undefined ||
      (candidate.writeSetSource !== undefined &&
        candidate.writeSetSource !== "explicit" &&
        candidate.writeSetSource !== "inferred")
    ) {
      return undefined;
    }
    writeSets.push({
      subagentId: candidate.subagentId,
      writeSet,
      ...(candidate.writeSetSource === undefined
        ? {}
        : { writeSetSource: candidate.writeSetSource }),
    });
  }
  return writeSets;
}

function coerceTaskBackedSubagentSchedulerTick(
  data: unknown,
): TaskBackedSubagentSchedulerTickSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    schemaId?: unknown;
    sessionId?: unknown;
    latestTurnId?: unknown;
    dispatchIntents?: unknown;
    claimDryRun?: unknown;
  };
  const dispatchIntents = coerceSubagentSchedulerTickIntents(candidate.dispatchIntents);
  if (
    candidate.schemaId !== "hotflow.agent-os.subagent-scheduler-tick.v1" ||
    typeof candidate.sessionId !== "string" ||
    (candidate.latestTurnId !== null && typeof candidate.latestTurnId !== "string") ||
    dispatchIntents === undefined ||
    candidate.claimDryRun !== true
  ) {
    return undefined;
  }
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-tick.v1",
    sessionId: candidate.sessionId,
    latestTurnId: candidate.latestTurnId,
    dispatchIntents,
    claimDryRun: true,
  };
}

function coerceSubagentSchedulerTickIntents(
  data: unknown,
): readonly TaskBackedSubagentSchedulerTickIntentSnapshot[] | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const intents: TaskBackedSubagentSchedulerTickIntentSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      intentId?: unknown;
      delegationId?: unknown;
      workerId?: unknown;
      command?: unknown;
      argv?: unknown;
      parallelBatch?: unknown;
      writeSet?: unknown;
      writeSetSource?: unknown;
    };
    const argv = coerceStringArray(candidate.argv);
    const writeSet = coerceStringArray(candidate.writeSet);
    if (
      typeof candidate.intentId !== "string" ||
      typeof candidate.delegationId !== "string" ||
      typeof candidate.workerId !== "string" ||
      candidate.command !== "run-delegation" ||
      argv === undefined ||
      typeof candidate.parallelBatch !== "number" ||
      writeSet === undefined ||
      (candidate.writeSetSource !== undefined &&
        candidate.writeSetSource !== "explicit" &&
        candidate.writeSetSource !== "inferred")
    ) {
      return undefined;
    }
    intents.push({
      intentId: candidate.intentId,
      delegationId: candidate.delegationId,
      workerId: candidate.workerId,
      command: "run-delegation",
      argv,
      parallelBatch: candidate.parallelBatch,
      writeSet,
      ...(candidate.writeSetSource === undefined
        ? {}
        : { writeSetSource: candidate.writeSetSource }),
    });
  }
  return intents;
}

function coerceTaskBackedSubagentSchedulerRecoveryPlan(
  data: unknown,
): TaskBackedSubagentSchedulerRecoveryPlanSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    schemaId?: unknown;
    parentTurnId?: unknown;
    canRecover?: unknown;
    blockedSubagentIds?: unknown;
    conflictedSubagentIds?: unknown;
    recoveryActions?: unknown;
    recoveryGroups?: unknown;
    recoveryOrdinal?: unknown;
  };
  const blockedSubagentIds = coerceStringArray(candidate.blockedSubagentIds);
  const conflictedSubagentIds = coerceStringArray(candidate.conflictedSubagentIds);
  const recoveryActions = coerceSubagentSchedulerRecoveryActions(candidate.recoveryActions);
  const recoveryGroups = coerceSubagentSchedulerRecoveryGroups(candidate.recoveryGroups);
  if (
    candidate.schemaId !== "hotflow.agent-os.subagent-scheduler-recovery-plan.v1" ||
    (candidate.parentTurnId !== undefined && typeof candidate.parentTurnId !== "string") ||
    typeof candidate.canRecover !== "boolean" ||
    blockedSubagentIds === undefined ||
    conflictedSubagentIds === undefined ||
    recoveryActions === undefined ||
    recoveryGroups === undefined ||
    typeof candidate.recoveryOrdinal !== "number"
  ) {
    return undefined;
  }
  return {
    schemaId: "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
    ...(candidate.parentTurnId === undefined ? {} : { parentTurnId: candidate.parentTurnId }),
    canRecover: candidate.canRecover,
    blockedSubagentIds,
    conflictedSubagentIds,
    recoveryActions,
    recoveryGroups,
    recoveryOrdinal: candidate.recoveryOrdinal,
  };
}

function coerceSubagentSchedulerRecoveryActions(
  data: unknown,
): readonly TaskBackedSubagentSchedulerRecoveryActionSnapshot[] | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const actions: TaskBackedSubagentSchedulerRecoveryActionSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      actionId?: unknown;
      subagentId?: unknown;
      actionType?: unknown;
      severity?: unknown;
      reason?: unknown;
      relatedSubagentIds?: unknown;
      writeSet?: unknown;
      observedWriteSet?: unknown;
      undeclaredObservedWriteSet?: unknown;
      evidence?: unknown;
      operatorSummary?: unknown;
    };
    const relatedSubagentIds = coerceStringArray(candidate.relatedSubagentIds);
    const writeSet = coerceStringArray(candidate.writeSet);
    const observedWriteSet =
      candidate.observedWriteSet === undefined
        ? undefined
        : coerceStringArray(candidate.observedWriteSet);
    const undeclaredObservedWriteSet =
      candidate.undeclaredObservedWriteSet === undefined
        ? undefined
        : coerceStringArray(candidate.undeclaredObservedWriteSet);
    const evidence = coerceSubagentSchedulerRecoveryEvidence(candidate.evidence);
    if (
      typeof candidate.actionId !== "string" ||
      typeof candidate.subagentId !== "string" ||
      (candidate.actionType !== "wait-for-running-subagent" &&
        candidate.actionType !== "review-observed-write-set") ||
      (candidate.severity !== "info" && candidate.severity !== "warning") ||
      typeof candidate.reason !== "string" ||
      relatedSubagentIds === undefined ||
      writeSet === undefined ||
      (candidate.observedWriteSet !== undefined && observedWriteSet === undefined) ||
      (candidate.undeclaredObservedWriteSet !== undefined &&
        undeclaredObservedWriteSet === undefined) ||
      evidence === undefined ||
      typeof candidate.operatorSummary !== "string"
    ) {
      return undefined;
    }
    actions.push({
      actionId: candidate.actionId,
      subagentId: candidate.subagentId,
      actionType: candidate.actionType,
      severity: candidate.severity,
      reason: candidate.reason,
      relatedSubagentIds,
      writeSet,
      ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
      ...(undeclaredObservedWriteSet === undefined ? {} : { undeclaredObservedWriteSet }),
      evidence,
      operatorSummary: candidate.operatorSummary,
    });
  }
  return actions;
}

function coerceSubagentSchedulerRecoveryGroups(
  data: unknown,
): readonly TaskBackedSubagentSchedulerRecoveryGroupSnapshot[] | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const groups: TaskBackedSubagentSchedulerRecoveryGroupSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      groupId?: unknown;
      groupType?: unknown;
      severity?: unknown;
      reason?: unknown;
      actionIds?: unknown;
      subagentIds?: unknown;
      runningSubagentIds?: unknown;
      blockedSubagentIds?: unknown;
      completedSubagentIds?: unknown;
      writeSet?: unknown;
      observedWriteSet?: unknown;
      undeclaredObservedWriteSet?: unknown;
      operatorSummary?: unknown;
    };
    const actionIds = coerceStringArray(candidate.actionIds);
    const subagentIds = coerceStringArray(candidate.subagentIds);
    const runningSubagentIds = coerceStringArray(candidate.runningSubagentIds);
    const blockedSubagentIds = coerceStringArray(candidate.blockedSubagentIds);
    const completedSubagentIds = coerceStringArray(candidate.completedSubagentIds);
    const writeSet = coerceStringArray(candidate.writeSet);
    const observedWriteSet =
      candidate.observedWriteSet === undefined
        ? undefined
        : coerceStringArray(candidate.observedWriteSet);
    const undeclaredObservedWriteSet =
      candidate.undeclaredObservedWriteSet === undefined
        ? undefined
        : coerceStringArray(candidate.undeclaredObservedWriteSet);
    if (
      typeof candidate.groupId !== "string" ||
      (candidate.groupType !== "write-set-overlap" &&
        candidate.groupType !== "observed-write-set-overlap") ||
      (candidate.severity !== "info" && candidate.severity !== "warning") ||
      typeof candidate.reason !== "string" ||
      actionIds === undefined ||
      subagentIds === undefined ||
      runningSubagentIds === undefined ||
      blockedSubagentIds === undefined ||
      completedSubagentIds === undefined ||
      writeSet === undefined ||
      (candidate.observedWriteSet !== undefined && observedWriteSet === undefined) ||
      (candidate.undeclaredObservedWriteSet !== undefined &&
        undeclaredObservedWriteSet === undefined) ||
      typeof candidate.operatorSummary !== "string"
    ) {
      return undefined;
    }
    groups.push({
      groupId: candidate.groupId,
      groupType: candidate.groupType,
      severity: candidate.severity,
      reason: candidate.reason,
      actionIds,
      subagentIds,
      runningSubagentIds,
      blockedSubagentIds,
      completedSubagentIds,
      writeSet,
      ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
      ...(undeclaredObservedWriteSet === undefined ? {} : { undeclaredObservedWriteSet }),
      operatorSummary: candidate.operatorSummary,
    });
  }
  return groups;
}

function coerceSubagentSchedulerRecoveryEvidence(
  data: unknown,
): TaskBackedSubagentSchedulerRecoveryEvidenceSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    blockedBy?: unknown;
    conflictsWith?: unknown;
    observedConflictWith?: unknown;
  };
  const blockedBy = coerceStringArray(candidate.blockedBy);
  const conflictsWith = coerceStringArray(candidate.conflictsWith);
  const observedConflictWith =
    candidate.observedConflictWith === undefined
      ? undefined
      : coerceStringArray(candidate.observedConflictWith);
  if (
    blockedBy === undefined ||
    conflictsWith === undefined ||
    (candidate.observedConflictWith !== undefined && observedConflictWith === undefined)
  ) {
    return undefined;
  }
  return {
    blockedBy,
    conflictsWith,
    ...(observedConflictWith === undefined ? {} : { observedConflictWith }),
  };
}

function coerceTaskBackedSubagentRuns(
  data: unknown,
): ReadonlyArray<TaskBackedSubagentRunSnapshot> | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const parsed: TaskBackedSubagentRunSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      subagentId?: unknown;
      parentTurnId?: unknown;
      profileId?: unknown;
      workerId?: unknown;
      taskId?: unknown;
      status?: unknown;
      role?: unknown;
      targetAgent?: unknown;
      isolatedContext?: unknown;
      instruction?: unknown;
      contextSnapshot?: unknown;
      resultSummary?: unknown;
      observedWriteSet?: unknown;
      observedWriteSetSource?: unknown;
      verification?: unknown;
      parentVisibleResult?: unknown;
    };
    const verification =
      candidate.verification === undefined
        ? undefined
        : coerceTaskBackedSubagentVerification(candidate.verification);
    const parentVisibleResult = coerceTaskBackedParentVisibleSubagentResult(
      candidate.parentVisibleResult,
    );
    const observedWriteSet =
      candidate.observedWriteSet === undefined
        ? undefined
        : coerceStringArray(candidate.observedWriteSet);
    const observedWriteSetSource =
      candidate.observedWriteSetSource === undefined
        ? undefined
        : coerceObservedWriteSetSource(candidate.observedWriteSetSource);

    if (
      typeof candidate.subagentId !== "string" ||
      typeof candidate.parentTurnId !== "string" ||
      typeof candidate.profileId !== "string" ||
      typeof candidate.workerId !== "string" ||
      typeof candidate.status !== "string" ||
      !isDelegationSpecialization(candidate.role) ||
      typeof candidate.isolatedContext !== "boolean" ||
      typeof candidate.instruction !== "string" ||
      (candidate.observedWriteSet !== undefined && observedWriteSet === undefined) ||
      (candidate.observedWriteSetSource !== undefined && observedWriteSetSource === undefined) ||
      (candidate.verification !== undefined && verification === undefined) ||
      parentVisibleResult === undefined
    ) {
      return undefined;
    }

    parsed.push({
      subagentId: candidate.subagentId,
      parentTurnId: candidate.parentTurnId,
      profileId: candidate.profileId,
      workerId: candidate.workerId,
      ...(typeof candidate.taskId === "string" ? { taskId: candidate.taskId } : {}),
      status: candidate.status,
      role: candidate.role,
      ...(typeof candidate.targetAgent === "string" ? { targetAgent: candidate.targetAgent } : {}),
      isolatedContext: candidate.isolatedContext,
      instruction: candidate.instruction,
      ...(typeof candidate.contextSnapshot === "string"
        ? { contextSnapshot: candidate.contextSnapshot }
        : {}),
      ...(typeof candidate.resultSummary === "string"
        ? { resultSummary: candidate.resultSummary }
        : {}),
      ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
      ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
      ...(verification === undefined ? {} : { verification }),
      parentVisibleResult,
    });
  }

  return parsed;
}

function coerceTaskBackedSubagentVerification(
  data: unknown,
): TaskBackedSubagentVerificationSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    verificationId?: unknown;
    verifierId?: unknown;
    status?: unknown;
    verdict?: unknown;
    verdictSummary?: unknown;
    requirement?: unknown;
  };
  if (
    typeof candidate.verificationId !== "string" ||
    typeof candidate.verifierId !== "string" ||
    typeof candidate.status !== "string" ||
    typeof candidate.requirement !== "string"
  ) {
    return undefined;
  }
  return {
    verificationId: candidate.verificationId,
    verifierId: candidate.verifierId,
    status: candidate.status,
    ...(typeof candidate.verdict === "string" ? { verdict: candidate.verdict } : {}),
    ...(typeof candidate.verdictSummary === "string"
      ? { verdictSummary: candidate.verdictSummary }
      : {}),
    requirement: candidate.requirement,
  };
}

function coerceStringArray(data: unknown): readonly string[] | undefined {
  if (!Array.isArray(data) || data.some((entry) => typeof entry !== "string")) {
    return undefined;
  }
  return data as readonly string[];
}

function coerceObservedWriteSetSource(data: unknown): "patch" | "diff" | "artifact" | undefined {
  if (data === "patch" || data === "diff" || data === "artifact") {
    return data;
  }
  return undefined;
}

function coerceTaskBackedParentVisibleSubagentResult(
  data: unknown,
): TaskBackedParentVisibleSubagentResultSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    status?: unknown;
    summary?: unknown;
    verificationVerdict?: unknown;
    observedWriteSet?: unknown;
    observedWriteSetSource?: unknown;
  };
  const observedWriteSet =
    candidate.observedWriteSet === undefined
      ? undefined
      : coerceStringArray(candidate.observedWriteSet);
  const observedWriteSetSource =
    candidate.observedWriteSetSource === undefined
      ? undefined
      : coerceObservedWriteSetSource(candidate.observedWriteSetSource);
  if (typeof candidate.status !== "string") {
    return undefined;
  }
  if (
    (candidate.observedWriteSet !== undefined && observedWriteSet === undefined) ||
    (candidate.observedWriteSetSource !== undefined && observedWriteSetSource === undefined)
  ) {
    return undefined;
  }
  return {
    status: candidate.status,
    ...(typeof candidate.summary === "string" ? { summary: candidate.summary } : {}),
    ...(typeof candidate.verificationVerdict === "string"
      ? { verificationVerdict: candidate.verificationVerdict }
      : {}),
    ...(observedWriteSet === undefined ? {} : { observedWriteSet }),
    ...(observedWriteSetSource === undefined ? {} : { observedWriteSetSource }),
  };
}

function coerceTaskWorkerMailboxSnapshot(data: unknown): TaskWorkerMailboxSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    workerId?: unknown;
    mailboxSize?: unknown;
    notificationCount?: unknown;
    coverage?: unknown;
    delegationIds?: unknown;
    notificationIds?: unknown;
    unnotifiedDelegationIds?: unknown;
    orphanNotificationIds?: unknown;
    items?: unknown;
    notifications?: unknown;
  };
  const items = coerceTaskWorkerMailboxItems(candidate.items);
  const notifications = coerceTaskNotificationEntries(candidate.notifications);
  if (
    typeof candidate.mailboxSize !== "number" ||
    typeof candidate.notificationCount !== "number" ||
    typeof candidate.coverage !== "string" ||
    !isStringArray(candidate.delegationIds) ||
    !isStringArray(candidate.notificationIds) ||
    !isStringArray(candidate.unnotifiedDelegationIds) ||
    !isStringArray(candidate.orphanNotificationIds) ||
    items === undefined ||
    notifications === undefined
  ) {
    return undefined;
  }

  return {
    ...(typeof candidate.workerId === "string" ? { workerId: candidate.workerId } : {}),
    mailboxSize: candidate.mailboxSize,
    notificationCount: candidate.notificationCount,
    coverage: candidate.coverage,
    delegationIds: [...candidate.delegationIds],
    notificationIds: [...candidate.notificationIds],
    unnotifiedDelegationIds: [...candidate.unnotifiedDelegationIds],
    orphanNotificationIds: [...candidate.orphanNotificationIds],
    items,
    notifications,
  };
}

function coerceTaskVerifierMailboxSnapshot(data: unknown): TaskVerifierMailboxSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    verifierId?: unknown;
    mailboxSize?: unknown;
    notificationCount?: unknown;
    coverage?: unknown;
    verificationIds?: unknown;
    notificationIds?: unknown;
    unnotifiedVerificationIds?: unknown;
    orphanNotificationIds?: unknown;
    items?: unknown;
    notifications?: unknown;
  };
  const items = coerceTaskVerifierMailboxItems(candidate.items);
  const notifications = coerceTaskNotificationEntries(candidate.notifications);
  if (
    typeof candidate.mailboxSize !== "number" ||
    typeof candidate.notificationCount !== "number" ||
    typeof candidate.coverage !== "string" ||
    !isStringArray(candidate.verificationIds) ||
    !isStringArray(candidate.notificationIds) ||
    !isStringArray(candidate.unnotifiedVerificationIds) ||
    !isStringArray(candidate.orphanNotificationIds) ||
    items === undefined ||
    notifications === undefined
  ) {
    return undefined;
  }

  return {
    ...(typeof candidate.verifierId === "string" ? { verifierId: candidate.verifierId } : {}),
    mailboxSize: candidate.mailboxSize,
    notificationCount: candidate.notificationCount,
    coverage: candidate.coverage,
    verificationIds: [...candidate.verificationIds],
    notificationIds: [...candidate.notificationIds],
    unnotifiedVerificationIds: [...candidate.unnotifiedVerificationIds],
    orphanNotificationIds: [...candidate.orphanNotificationIds],
    items,
    notifications,
  };
}

function coerceTaskNotificationEntries(
  data: unknown,
): ReadonlyArray<TaskNotificationSnapshot> | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const parsed: TaskNotificationSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      id?: unknown;
      kind?: unknown;
      recipientKind?: unknown;
      recipientId?: unknown;
      status?: unknown;
      summary?: unknown;
      taskId?: unknown;
      delegationId?: unknown;
      verificationId?: unknown;
      acknowledgedAtMs?: unknown;
    };
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.kind !== "string" ||
      typeof candidate.recipientKind !== "string" ||
      typeof candidate.recipientId !== "string" ||
      typeof candidate.status !== "string" ||
      typeof candidate.summary !== "string"
    ) {
      return undefined;
    }
    parsed.push({
      id: candidate.id,
      kind: candidate.kind,
      recipientKind: candidate.recipientKind,
      recipientId: candidate.recipientId,
      status: candidate.status,
      summary: candidate.summary,
      ...(typeof candidate.taskId === "string" ? { taskId: candidate.taskId } : {}),
      ...(typeof candidate.delegationId === "string"
        ? { delegationId: candidate.delegationId }
        : {}),
      ...(typeof candidate.verificationId === "string"
        ? { verificationId: candidate.verificationId }
        : {}),
      ...(typeof candidate.acknowledgedAtMs === "number"
        ? { acknowledgedAtMs: candidate.acknowledgedAtMs }
        : {}),
    });
  }

  return parsed;
}

function coerceTaskWorkerMailboxItems(
  data: unknown,
): ReadonlyArray<TaskWorkerMailboxItemSnapshot> | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const parsed: TaskWorkerMailboxItemSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      id?: unknown;
      workerId?: unknown;
      instruction?: unknown;
      status?: unknown;
      taskId?: unknown;
      specialization?: unknown;
      targetAgent?: unknown;
      verificationRequest?: unknown;
      notificationId?: unknown;
      notificationStatus?: unknown;
      notificationSummary?: unknown;
    };
    const verificationRequest =
      candidate.verificationRequest === undefined
        ? undefined
        : coerceDelegationVerificationRequest(candidate.verificationRequest);
    if (candidate.verificationRequest !== undefined && verificationRequest === undefined) {
      return undefined;
    }
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.workerId !== "string" ||
      typeof candidate.instruction !== "string" ||
      typeof candidate.status !== "string"
    ) {
      return undefined;
    }

    parsed.push({
      id: candidate.id,
      workerId: candidate.workerId,
      instruction: candidate.instruction,
      status: candidate.status,
      ...(typeof candidate.taskId === "string" ? { taskId: candidate.taskId } : {}),
      ...(isDelegationSpecialization(candidate.specialization)
        ? { specialization: candidate.specialization }
        : {}),
      ...(typeof candidate.targetAgent === "string" ? { targetAgent: candidate.targetAgent } : {}),
      ...(verificationRequest === undefined ? {} : { verificationRequest }),
      ...(typeof candidate.notificationId === "string"
        ? { notificationId: candidate.notificationId }
        : {}),
      ...(typeof candidate.notificationStatus === "string"
        ? { notificationStatus: candidate.notificationStatus }
        : {}),
      ...(typeof candidate.notificationSummary === "string"
        ? { notificationSummary: candidate.notificationSummary }
        : {}),
    });
  }

  return parsed;
}

function coerceDelegationVerificationRequest(
  data: unknown,
): DelegationVerificationRequestSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }
  const candidate = data as {
    verifierId?: unknown;
    requirement?: unknown;
    verificationId?: unknown;
  };
  if (typeof candidate.verifierId !== "string" || typeof candidate.requirement !== "string") {
    return undefined;
  }
  return {
    verifierId: candidate.verifierId,
    requirement: candidate.requirement,
    ...(typeof candidate.verificationId === "string"
      ? { verificationId: candidate.verificationId }
      : {}),
  };
}

function isDelegationSpecialization(value: unknown): value is DelegationSpecialization {
  return value === "explore" || value === "plan" || value === "verify" || value === "general";
}

function coerceTaskVerifierMailboxItems(
  data: unknown,
): ReadonlyArray<TaskVerifierMailboxItemSnapshot> | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const parsed: TaskVerifierMailboxItemSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      id?: unknown;
      verifierId?: unknown;
      requirement?: unknown;
      status?: unknown;
      taskId?: unknown;
      notificationId?: unknown;
      notificationStatus?: unknown;
      notificationSummary?: unknown;
    };
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.verifierId !== "string" ||
      typeof candidate.requirement !== "string" ||
      typeof candidate.status !== "string"
    ) {
      return undefined;
    }

    parsed.push({
      id: candidate.id,
      verifierId: candidate.verifierId,
      requirement: candidate.requirement,
      status: candidate.status,
      ...(typeof candidate.taskId === "string" ? { taskId: candidate.taskId } : {}),
      ...(typeof candidate.notificationId === "string"
        ? { notificationId: candidate.notificationId }
        : {}),
      ...(typeof candidate.notificationStatus === "string"
        ? { notificationStatus: candidate.notificationStatus }
        : {}),
      ...(typeof candidate.notificationSummary === "string"
        ? { notificationSummary: candidate.notificationSummary }
        : {}),
    });
  }

  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function coerceTaskLifecycleEntries(
  data: unknown,
): ReadonlyArray<TaskLifecycleSnapshot> | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const parsed: TaskLifecycleSnapshot[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      taskId?: unknown;
      title?: unknown;
      status?: unknown;
      todoStatus?: unknown;
      assignedAgent?: unknown;
      verificationVerdict?: unknown;
      latestDelegationId?: unknown;
      latestVerificationId?: unknown;
    };
    if (
      typeof candidate.taskId !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.status !== "string"
    ) {
      return undefined;
    }
    parsed.push({
      taskId: candidate.taskId,
      title: candidate.title,
      status: candidate.status,
      ...(typeof candidate.todoStatus === "string" ? { todoStatus: candidate.todoStatus } : {}),
      ...(typeof candidate.assignedAgent === "string"
        ? { assignedAgent: candidate.assignedAgent }
        : {}),
      ...(typeof candidate.verificationVerdict === "string"
        ? { verificationVerdict: candidate.verificationVerdict }
        : {}),
      ...(typeof candidate.latestDelegationId === "string"
        ? { latestDelegationId: candidate.latestDelegationId }
        : {}),
      ...(typeof candidate.latestVerificationId === "string"
        ? { latestVerificationId: candidate.latestVerificationId }
        : {}),
    });
  }

  return parsed;
}

function coerceProposalOutboxEntries(data: unknown):
  | ReadonlyArray<{
      readonly id: string;
      readonly eventType: string;
      readonly proposalId: string;
      readonly status: string;
    }>
  | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }
  const parsed: Array<{
    readonly id: string;
    readonly eventType: string;
    readonly proposalId: string;
    readonly status: string;
  }> = [];
  for (const entry of data) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return undefined;
    }
    const candidate = entry as {
      id?: unknown;
      eventType?: unknown;
      proposalId?: unknown;
      status?: unknown;
    };
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.eventType !== "string" ||
      typeof candidate.proposalId !== "string" ||
      typeof candidate.status !== "string"
    ) {
      return undefined;
    }
    parsed.push({
      id: candidate.id,
      eventType: candidate.eventType,
      proposalId: candidate.proposalId,
      status: candidate.status,
    });
  }
  return parsed;
}

function coerceProposalRecord(data: unknown): ProposalRecordSnapshot | null | undefined {
  if (data === null) {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const candidate = data as {
    id?: unknown;
    kind?: unknown;
    status?: unknown;
    payload?: unknown;
    sourceSessionId?: unknown;
    sourceTurnId?: unknown;
    provenance?: unknown;
    decisionNote?: unknown;
  };
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.status !== "string" ||
    !candidate.payload ||
    typeof candidate.payload !== "object" ||
    Array.isArray(candidate.payload) ||
    typeof candidate.sourceSessionId !== "string" ||
    typeof candidate.sourceTurnId !== "string" ||
    typeof candidate.provenance !== "string"
  ) {
    return undefined;
  }

  return {
    id: candidate.id,
    kind: candidate.kind,
    status: candidate.status,
    payload: candidate.payload as Readonly<Record<string, unknown>>,
    sourceSessionId: candidate.sourceSessionId,
    sourceTurnId: candidate.sourceTurnId,
    provenance: candidate.provenance,
    ...(typeof candidate.decisionNote === "string" ? { decisionNote: candidate.decisionNote } : {}),
  };
}

function coerceProposalListEntries(
  data: unknown,
): readonly ProposalListEntrySnapshot[] | undefined {
  if (!Array.isArray(data)) {
    return undefined;
  }

  const entries: ProposalListEntrySnapshot[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }
    const candidate = item as {
      id?: unknown;
      kind?: unknown;
      status?: unknown;
      provenance?: unknown;
      riskLevel?: unknown;
      confidence?: unknown;
    };
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.kind !== "string" ||
      typeof candidate.status !== "string"
    ) {
      return undefined;
    }
    entries.push({
      id: candidate.id,
      kind: candidate.kind,
      status: candidate.status,
      ...(typeof candidate.provenance === "string" ? { provenance: candidate.provenance } : {}),
      ...(typeof candidate.riskLevel === "string" ? { riskLevel: candidate.riskLevel } : {}),
      ...(typeof candidate.confidence === "number" ? { confidence: candidate.confidence } : {}),
    });
  }

  return entries;
}

function coerceProposalReview(data: unknown): ProposalReviewSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const candidate = data as {
    proposalId?: unknown;
    verdict?: unknown;
    decisionNote?: unknown;
    summary?: unknown;
    issues?: unknown;
  };
  if (
    typeof candidate.proposalId !== "string" ||
    typeof candidate.verdict !== "string" ||
    typeof candidate.decisionNote !== "string" ||
    !candidate.summary ||
    typeof candidate.summary !== "object" ||
    Array.isArray(candidate.summary) ||
    !Array.isArray(candidate.issues)
  ) {
    return undefined;
  }

  const summaryCandidate = candidate.summary as {
    fatal?: unknown;
    risky?: unknown;
    warning?: unknown;
    info?: unknown;
  };
  if (
    typeof summaryCandidate.fatal !== "number" ||
    typeof summaryCandidate.risky !== "number" ||
    typeof summaryCandidate.warning !== "number" ||
    typeof summaryCandidate.info !== "number"
  ) {
    return undefined;
  }

  const issues: Array<ProposalReviewSnapshot["issues"][number]> = [];
  for (const item of candidate.issues) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return undefined;
    }
    const issue = item as {
      code?: unknown;
      field?: unknown;
      message?: unknown;
      severity?: unknown;
    };
    if (
      typeof issue.code !== "string" ||
      typeof issue.field !== "string" ||
      typeof issue.message !== "string" ||
      typeof issue.severity !== "string"
    ) {
      return undefined;
    }
    issues.push({
      code: issue.code,
      field: issue.field,
      message: issue.message,
      severity: issue.severity,
    });
  }

  return {
    proposalId: candidate.proposalId,
    verdict: candidate.verdict,
    decisionNote: candidate.decisionNote,
    summary: {
      fatal: summaryCandidate.fatal,
      risky: summaryCandidate.risky,
      warning: summaryCandidate.warning,
      info: summaryCandidate.info,
    },
    issues,
  };
}

function coerceProposalExplanation(data: unknown): ProposalExplainSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const candidate = data as {
    proposalId?: unknown;
    kind?: unknown;
    status?: unknown;
    provenance?: unknown;
    trajectoryRef?: unknown;
    trigger?: unknown;
    evidenceSummary?: unknown;
    riskLevel?: unknown;
    confidence?: unknown;
    dedupeKey?: unknown;
    explanation?: unknown;
  };
  if (
    typeof candidate.proposalId !== "string" ||
    typeof candidate.kind !== "string" ||
    typeof candidate.status !== "string"
  ) {
    return undefined;
  }

  return {
    proposalId: candidate.proposalId,
    kind: candidate.kind,
    status: candidate.status,
    ...(typeof candidate.provenance === "string" ? { provenance: candidate.provenance } : {}),
    ...(typeof candidate.trajectoryRef === "string"
      ? { trajectoryRef: candidate.trajectoryRef }
      : {}),
    ...(typeof candidate.trigger === "string" ? { trigger: candidate.trigger } : {}),
    ...(typeof candidate.evidenceSummary === "string"
      ? { evidenceSummary: candidate.evidenceSummary }
      : {}),
    ...(typeof candidate.riskLevel === "string" ? { riskLevel: candidate.riskLevel } : {}),
    ...(typeof candidate.confidence === "number" ? { confidence: candidate.confidence } : {}),
    ...(typeof candidate.dedupeKey === "string" ? { dedupeKey: candidate.dedupeKey } : {}),
    ...(typeof candidate.explanation === "string" ? { explanation: candidate.explanation } : {}),
  };
}

function coerceProposalPreview(data: unknown): ProposalPreviewSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const candidate = data as {
    proposalId?: unknown;
    proposalStatus?: unknown;
    skillId?: unknown;
    operation?: unknown;
    currentHeadVersion?: unknown;
    nextHeadVersion?: unknown;
    changedFields?: unknown;
    summary?: unknown;
  };
  if (
    typeof candidate.proposalId !== "string" ||
    typeof candidate.proposalStatus !== "string" ||
    typeof candidate.skillId !== "string" ||
    typeof candidate.operation !== "string" ||
    typeof candidate.currentHeadVersion !== "number" ||
    typeof candidate.nextHeadVersion !== "number" ||
    !Array.isArray(candidate.changedFields) ||
    typeof candidate.summary !== "string"
  ) {
    return undefined;
  }

  const changedFields = candidate.changedFields
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const change = entry as { field?: unknown };
      if (typeof change.field !== "string") {
        return null;
      }
      return { field: change.field };
    })
    .filter((entry): entry is ProposalPreviewSnapshot["changedFields"][number] => entry !== null);

  if (changedFields.length !== candidate.changedFields.length) {
    return undefined;
  }

  return {
    proposalId: candidate.proposalId,
    proposalStatus: candidate.proposalStatus,
    skillId: candidate.skillId,
    operation: candidate.operation,
    currentHeadVersion: candidate.currentHeadVersion,
    nextHeadVersion: candidate.nextHeadVersion,
    changedFields,
    summary: candidate.summary,
  };
}

function coerceProposalRollback(data: unknown): ProposalRollbackSnapshot | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return undefined;
  }

  const candidate = data as {
    currentVersionBefore?: unknown;
    restoredFromVersion?: unknown;
    currentVersionAfter?: unknown;
    previousSnapshotVersion?: unknown;
    approvedSkillCount?: unknown;
    restoredSkillIds?: unknown;
  };
  if (
    typeof candidate.currentVersionBefore !== "number" ||
    typeof candidate.restoredFromVersion !== "number" ||
    typeof candidate.currentVersionAfter !== "number" ||
    typeof candidate.approvedSkillCount !== "number" ||
    !Array.isArray(candidate.restoredSkillIds) ||
    !candidate.restoredSkillIds.every((entry) => typeof entry === "string")
  ) {
    return undefined;
  }

  return {
    currentVersionBefore: candidate.currentVersionBefore,
    restoredFromVersion: candidate.restoredFromVersion,
    currentVersionAfter: candidate.currentVersionAfter,
    ...(candidate.previousSnapshotVersion === undefined
      ? {}
      : { previousSnapshotVersion: candidate.previousSnapshotVersion as number | null }),
    approvedSkillCount: candidate.approvedSkillCount,
    restoredSkillIds: [...candidate.restoredSkillIds],
  };
}

function renderTaskOperationsSnapshot(state: TaskOperationsSnapshot): string {
  const notifications = state.notifications ?? [];
  const lifecycle = state.lifecycle ?? [];
  const subagentRuns = state.subagentRuns ?? [];
  const lines: string[] = [
    `Task schema: ${state.schemaVersion}`,
    `Todos: ${state.todos.items.length}`,
    `Delegation: ${state.delegation.length}`,
    `Verification: ${state.verification.length}`,
    `Proposal queue: ${state.proposalQueue.length}`,
    `Proposal outbox: ${state.proposalOutbox.length}`,
    `Notifications: ${notifications.length}`,
    `Lifecycle: ${lifecycle.length}`,
    `Subagent runs: ${subagentRuns.length}`,
  ];

  if (notifications.length > 0) {
    lines.push(`Notification summary: ${formatTaskNotificationSummary(notifications)}`);
  }
  if (lifecycle.length > 0) {
    lines.push(`Lifecycle summary: ${formatTaskLifecycleSummary(lifecycle)}`);
  }
  if (subagentRuns.length > 0) {
    lines.push(`Subagent summary: ${formatSubagentRunSummary(subagentRuns)}`);
  }
  if (state.subagentSchedulerHeartbeat !== undefined) {
    lines.push(
      `Subagent scheduler: ${formatSubagentSchedulerHeartbeat(state.subagentSchedulerHeartbeat)}`,
    );
  }
  if (state.subagentSchedulerDispatchPlan !== undefined) {
    lines.push(
      `Subagent dispatch plan: ${formatSubagentSchedulerDispatchPlan(state.subagentSchedulerDispatchPlan)}`,
    );
  }
  if (state.subagentSchedulerTick !== undefined) {
    lines.push(
      `Subagent scheduler tick: ${formatSubagentSchedulerTick(state.subagentSchedulerTick)}`,
    );
  }
  if (state.subagentSchedulerRecoveryPlan !== undefined) {
    lines.push(
      `Subagent recovery plan: ${formatSubagentSchedulerRecoveryPlan(state.subagentSchedulerRecoveryPlan)}`,
    );
  }

  if (state.todos.items.length > 0) {
    lines.push("Todo items:");
    for (const item of state.todos.items.slice(0, 5)) {
      lines.push(`  - [${item.status}] ${item.content}`);
    }
  }
  if (state.delegation.length > 0) {
    lines.push("Delegation items:");
    for (const item of state.delegation.slice(0, 5)) {
      const detailParts = [`worker=${item.workerId}`, `status=${item.status}`];
      if (item.specialization) {
        detailParts.push(`specialization=${item.specialization}`);
      }
      if (item.targetAgent) {
        detailParts.push(`target=${item.targetAgent}`);
      }
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      if (item.verificationRequest) {
        detailParts.push(`verify=${item.verificationRequest.verifierId}`);
        if (item.verificationRequest.verificationId) {
          detailParts.push(`verification=${item.verificationRequest.verificationId}`);
        }
      }
      lines.push(`  - ${item.id} ${detailParts.join(" ")}`);
    }
  }
  if (state.verification.length > 0) {
    lines.push("Verification items:");
    for (const item of state.verification.slice(0, 5)) {
      lines.push(`  - ${item.id} verifier=${item.verifierId} status=${item.status}`);
    }
  }
  if (state.proposalQueue.length > 0) {
    lines.push("Proposal items:");
    for (const item of state.proposalQueue.slice(0, 5)) {
      lines.push(`  - ${item.id} kind=${item.kind} status=${item.status}`);
    }
  }
  if (notifications.length > 0) {
    lines.push("Notification items:");
    for (const item of notifications.slice(0, 5)) {
      const detailParts = [
        `kind=${item.kind}`,
        `status=${item.status}`,
        `recipient=${item.recipientKind}:${item.recipientId}`,
      ];
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      lines.push(`  - ${item.id} ${detailParts.join(" ")} summary=${item.summary}`);
    }
  }
  if (lifecycle.length > 0) {
    lines.push("Lifecycle items:");
    for (const item of lifecycle.slice(0, 5)) {
      const detailParts = [`status=${item.status}`, `title=${item.title}`];
      if (item.todoStatus) {
        detailParts.push(`todo=${item.todoStatus}`);
      }
      if (item.assignedAgent) {
        detailParts.push(`assigned=${item.assignedAgent}`);
      }
      if (item.verificationVerdict) {
        detailParts.push(`verification=${item.verificationVerdict}`);
      }
      lines.push(`  - ${item.taskId} ${detailParts.join(" ")}`);
    }
  }
  if (subagentRuns.length > 0) {
    lines.push("Subagent items:");
    for (const item of subagentRuns.slice(0, 5)) {
      const detailParts = [
        `parent=${item.parentTurnId}`,
        `profile=${item.profileId}`,
        `worker=${item.workerId}`,
        `status=${item.status}`,
        `role=${item.role}`,
      ];
      if (item.targetAgent) {
        detailParts.push(`target=${item.targetAgent}`);
      }
      detailParts.push(`isolated=${String(item.isolatedContext)}`);
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      if (item.parentVisibleResult.verificationVerdict) {
        detailParts.push(`verification=${item.parentVisibleResult.verificationVerdict}`);
      }
      if (item.parentVisibleResult.summary) {
        detailParts.push(`summary=${item.parentVisibleResult.summary}`);
      }
      lines.push(`  - ${item.subagentId} ${detailParts.join(" ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatSubagentSchedulerHeartbeat(
  heartbeat: TaskBackedSubagentSchedulerHeartbeatSnapshot,
): string {
  return [
    `ready=${heartbeat.readyCount}`,
    `blocked=${heartbeat.blockedCount}`,
    `running=${heartbeat.runningCount}`,
    `unscheduled=${heartbeat.unscheduledQueuedCount}`,
    `canContinue=${heartbeat.canContinue}`,
    `stopped=${heartbeat.stoppedReason}`,
    ...(heartbeat.nextParallelBatch === undefined
      ? []
      : [`nextBatch=${heartbeat.nextParallelBatch}`]),
    ...(heartbeat.nextReadySubagentIds.length === 0
      ? []
      : [`next=${heartbeat.nextReadySubagentIds.join(",")}`]),
    ...(heartbeat.blockedSubagentIds.length === 0
      ? []
      : [`blockedByScheduler=${heartbeat.blockedSubagentIds.join(",")}`]),
    `heartbeat=${heartbeat.heartbeatOrdinal}`,
  ].join(" ");
}

function formatSubagentSchedulerDispatchPlan(
  plan: TaskBackedSubagentSchedulerDispatchPlanSnapshot,
): string {
  return [
    `canDispatch=${plan.canDispatch}`,
    `reason=${plan.dispatchReason}`,
    `max=${plan.maxDispatchableCount}`,
    ...(plan.dispatchableSubagentIds.length === 0
      ? []
      : [`dispatchable=${plan.dispatchableSubagentIds.join(",")}`]),
    ...(plan.dispatchBatches.length === 0
      ? []
      : [`batches=${formatSubagentSchedulerDispatchBatches(plan.dispatchBatches)}`]),
    ...(plan.blockedSubagentIds.length === 0
      ? []
      : [`blocked=${plan.blockedSubagentIds.join(",")}`]),
    ...(plan.runningSubagentIds.length === 0
      ? []
      : [`running=${plan.runningSubagentIds.join(",")}`]),
    `plan=${plan.planOrdinal}`,
    `heartbeat=${plan.heartbeatOrdinal}`,
  ].join(" ");
}

function formatSubagentSchedulerDispatchBatches(
  batches: readonly TaskBackedSubagentSchedulerDispatchBatchSnapshot[],
): string {
  return batches
    .map(
      (batch) =>
        `${batch.parallelBatch}:${batch.subagentIds.join(",") || "none"}@${batch.workerIds.join(",") || "none"}`,
    )
    .join(";");
}

function formatSubagentSchedulerTick(tick: TaskBackedSubagentSchedulerTickSnapshot): string {
  return [
    `intents=${tick.dispatchIntents.length}`,
    `claimDryRun=${tick.claimDryRun}`,
    ...(tick.dispatchIntents.length === 0
      ? []
      : [`dispatch=${tick.dispatchIntents.map(formatSubagentSchedulerTickIntent).join(";")}`]),
  ].join(" ");
}

function formatSubagentSchedulerTickIntent(
  intent: TaskBackedSubagentSchedulerTickIntentSnapshot,
): string {
  return [
    intent.delegationId,
    `worker=${intent.workerId}`,
    `batch=${intent.parallelBatch}`,
    ...(intent.writeSet.length === 0 ? [] : [`writeSet=${intent.writeSet.join(",")}`]),
  ].join("@");
}

function formatSubagentSchedulerRecoveryPlan(
  plan: TaskBackedSubagentSchedulerRecoveryPlanSnapshot,
): string {
  return [
    `canRecover=${plan.canRecover}`,
    `actions=${plan.recoveryActions.length}`,
    `groups=${plan.recoveryGroups.length}`,
    ...(plan.blockedSubagentIds.length === 0
      ? []
      : [`blocked=${plan.blockedSubagentIds.join(",")}`]),
    ...(plan.conflictedSubagentIds.length === 0
      ? []
      : [`conflicted=${plan.conflictedSubagentIds.join(",")}`]),
    ...(plan.recoveryGroups.length === 0
      ? []
      : [`group=${plan.recoveryGroups.map(formatSubagentSchedulerRecoveryGroup).join(";")}`]),
    ...(plan.recoveryActions.length === 0
      ? []
      : [`next=${plan.recoveryActions.map(formatSubagentSchedulerRecoveryAction).join(";")}`]),
    `recovery=${plan.recoveryOrdinal}`,
  ].join(" ");
}

function formatSubagentSchedulerRecoveryGroup(
  group: TaskBackedSubagentSchedulerRecoveryGroupSnapshot,
): string {
  return [
    group.groupId,
    `type=${group.groupType}`,
    `severity=${group.severity}`,
    `writeSet=${group.writeSet.join(",") || "none"}`,
    `running=${group.runningSubagentIds.length}`,
    `blocked=${group.blockedSubagentIds.length}`,
    `completed=${group.completedSubagentIds.length}`,
  ].join("@");
}

function formatSubagentSchedulerRecoveryAction(
  action: TaskBackedSubagentSchedulerRecoveryActionSnapshot,
): string {
  return [
    action.subagentId,
    `type=${action.actionType}`,
    `severity=${action.severity}`,
    `reason=${action.reason}`,
    ...(action.relatedSubagentIds.length === 0
      ? []
      : [`related=${action.relatedSubagentIds.join(",")}`]),
  ].join("@");
}

function renderTaskWorkerMailboxSnapshot(snapshot: TaskWorkerMailboxSnapshot): string {
  const lines: string[] = [
    `Worker mailbox: ${snapshot.workerId ?? "(all workers)"}`,
    `Mailbox size: ${snapshot.mailboxSize}`,
    `Notification count: ${snapshot.notificationCount}`,
    `Coverage: ${snapshot.coverage}`,
  ];

  if (snapshot.delegationIds.length > 0) {
    lines.push(`Delegations: ${snapshot.delegationIds.join(", ")}`);
  }
  if (snapshot.notificationIds.length > 0) {
    lines.push(`Notifications: ${snapshot.notificationIds.join(", ")}`);
  }
  if (snapshot.unnotifiedDelegationIds.length > 0) {
    lines.push(`Unnotified delegations: ${snapshot.unnotifiedDelegationIds.join(", ")}`);
  }
  if (snapshot.orphanNotificationIds.length > 0) {
    lines.push(`Orphan notifications: ${snapshot.orphanNotificationIds.join(", ")}`);
  }
  if (snapshot.items.length > 0) {
    lines.push("Mailbox items:");
    for (const item of snapshot.items.slice(0, 10)) {
      const detailParts = [`worker=${item.workerId}`, `status=${item.status}`];
      if (item.specialization) {
        detailParts.push(`specialization=${item.specialization}`);
      }
      if (item.targetAgent) {
        detailParts.push(`target=${item.targetAgent}`);
      }
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      if (item.verificationRequest) {
        detailParts.push(`verify=${item.verificationRequest.verifierId}`);
        if (item.verificationRequest.verificationId) {
          detailParts.push(`verification=${item.verificationRequest.verificationId}`);
        }
      }
      if (item.notificationId) {
        detailParts.push(`notification=${item.notificationId}`);
      }
      if (item.notificationStatus) {
        detailParts.push(`notificationStatus=${item.notificationStatus}`);
      }
      if (item.verificationRequest) {
        detailParts.push(`requirement=${item.verificationRequest.requirement}`);
      }
      lines.push(`  - ${item.id} ${detailParts.join(" ")} instruction=${item.instruction}`);
    }
  }
  if (snapshot.notifications.length > 0) {
    lines.push("Notification items:");
    for (const item of snapshot.notifications.slice(0, 10)) {
      const detailParts = [
        `kind=${item.kind}`,
        `status=${item.status}`,
        `recipient=${item.recipientKind}:${item.recipientId}`,
      ];
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      if (item.delegationId) {
        detailParts.push(`delegation=${item.delegationId}`);
      }
      lines.push(`  - ${item.id} ${detailParts.join(" ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderTaskVerifierMailboxSnapshot(snapshot: TaskVerifierMailboxSnapshot): string {
  const lines: string[] = [
    `Verifier mailbox: ${snapshot.verifierId ?? "(all verifiers)"}`,
    `Mailbox size: ${snapshot.mailboxSize}`,
    `Notification count: ${snapshot.notificationCount}`,
    `Coverage: ${snapshot.coverage}`,
  ];

  if (snapshot.verificationIds.length > 0) {
    lines.push(`Verifications: ${snapshot.verificationIds.join(", ")}`);
  }
  if (snapshot.notificationIds.length > 0) {
    lines.push(`Notifications: ${snapshot.notificationIds.join(", ")}`);
  }
  if (snapshot.unnotifiedVerificationIds.length > 0) {
    lines.push(`Unnotified verifications: ${snapshot.unnotifiedVerificationIds.join(", ")}`);
  }
  if (snapshot.orphanNotificationIds.length > 0) {
    lines.push(`Orphan notifications: ${snapshot.orphanNotificationIds.join(", ")}`);
  }
  if (snapshot.items.length > 0) {
    lines.push("Mailbox items:");
    for (const item of snapshot.items.slice(0, 10)) {
      const detailParts = [`verifier=${item.verifierId}`, `status=${item.status}`];
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      if (item.notificationId) {
        detailParts.push(`notification=${item.notificationId}`);
      }
      if (item.notificationStatus) {
        detailParts.push(`notificationStatus=${item.notificationStatus}`);
      }
      lines.push(`  - ${item.id} ${detailParts.join(" ")} requirement=${item.requirement}`);
    }
  }
  if (snapshot.notifications.length > 0) {
    lines.push("Notification items:");
    for (const item of snapshot.notifications.slice(0, 10)) {
      const detailParts = [
        `kind=${item.kind}`,
        `status=${item.status}`,
        `recipient=${item.recipientKind}:${item.recipientId}`,
      ];
      if (item.taskId) {
        detailParts.push(`task=${item.taskId}`);
      }
      if (item.verificationId) {
        detailParts.push(`verification=${item.verificationId}`);
      }
      lines.push(`  - ${item.id} ${detailParts.join(" ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatTaskNotificationSummary(notifications: readonly TaskNotificationSnapshot[]): string {
  const counts = new Map<string, number>();
  for (const item of notifications) {
    const key = `${item.status}/${item.recipientKind}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function formatTaskLifecycleSummary(lifecycle: readonly TaskLifecycleSnapshot[]): string {
  const statuses = [
    "pending",
    "delegated",
    "running",
    "blocked",
    "done",
    "failed",
    "verified",
  ] as const;
  const counts = new Map<string, number>();
  for (const status of statuses) {
    counts.set(status, 0);
  }
  for (const entry of lifecycle) {
    counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  }
  return statuses
    .filter((status) => (counts.get(status) ?? 0) > 0)
    .map((status) => `${status}=${counts.get(status)}`)
    .join(", ");
}

function formatSubagentRunSummary(subagentRuns: readonly TaskBackedSubagentRunSnapshot[]): string {
  const counts = new Map<string, number>();
  for (const run of subagentRuns) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
}

function renderProposalListEntries(entries: readonly ProposalListEntrySnapshot[]): string {
  const lines = [`Proposal items: ${entries.length}`];
  for (const entry of entries.slice(0, 10)) {
    const suffix: string[] = [];
    if (entry.riskLevel) {
      suffix.push(`risk=${entry.riskLevel}`);
    }
    if (entry.confidence !== undefined) {
      suffix.push(`confidence=${entry.confidence}`);
    }
    lines.push(
      `  - ${entry.id} kind=${entry.kind} status=${entry.status}${
        suffix.length > 0 ? ` ${suffix.join(" ")}` : ""
      }`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderProposalReview(review: ProposalReviewSnapshot): string {
  const lines = [
    "Review summary:",
    `  proposal=${review.proposalId} verdict=${review.verdict}`,
    `  counts fatal=${review.summary.fatal} risky=${review.summary.risky} warning=${review.summary.warning} info=${review.summary.info}`,
    `  note: ${review.decisionNote}`,
  ];

  if (review.issues.length > 0) {
    lines.push("  issues:");
    for (const issue of review.issues.slice(0, 10)) {
      lines.push(
        `    - [${issue.severity}] ${issue.code} field=${issue.field} message=${issue.message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderProposalExplanation(explained: ProposalExplainSnapshot): string {
  const lines = [
    "Proposal explanation:",
    `  Id: ${explained.proposalId}`,
    `  Kind: ${explained.kind}`,
    `  Status: ${explained.status}`,
  ];

  if (explained.provenance) {
    lines.push(`  Provenance: ${explained.provenance}`);
  }
  if (explained.trigger) {
    lines.push(`  Trigger: ${explained.trigger}`);
  }
  if (explained.evidenceSummary) {
    lines.push(`  Evidence: ${explained.evidenceSummary}`);
  }
  if (explained.riskLevel) {
    lines.push(`  Risk: ${explained.riskLevel}`);
  }
  if (explained.confidence !== undefined) {
    lines.push(`  Confidence: ${explained.confidence}`);
  }
  if (explained.dedupeKey) {
    lines.push(`  Dedupe key: ${explained.dedupeKey}`);
  }
  if (explained.explanation) {
    lines.push(`  Why: ${explained.explanation}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderProposalPreview(preview: ProposalPreviewSnapshot): string {
  const lines = [
    "Proposal preview:",
    `  Proposal: ${preview.proposalId}`,
    `  Status: ${preview.proposalStatus}`,
    `  Skill: ${preview.skillId}`,
    `  Operation: ${preview.operation}`,
    `  Head version: ${preview.currentHeadVersion} -> ${preview.nextHeadVersion}`,
    `  Summary: ${preview.summary}`,
  ];

  if (preview.changedFields.length > 0) {
    lines.push(`  Changed fields: ${preview.changedFields.map((entry) => entry.field).join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderProposalRollback(rollback: ProposalRollbackSnapshot): string {
  const lines = [
    "Proposal rollback:",
    `  Head version: ${rollback.currentVersionBefore} -> ${rollback.currentVersionAfter}`,
    `  Restored from version: ${rollback.restoredFromVersion}`,
    `  Approved skills: ${rollback.approvedSkillCount}`,
  ];

  if (rollback.previousSnapshotVersion !== undefined) {
    lines.push(`  Previous snapshot version: ${rollback.previousSnapshotVersion ?? "(none)"}`);
  }
  if (rollback.restoredSkillIds.length > 0) {
    lines.push(`  Restored skill ids: ${rollback.restoredSkillIds.join(", ")}`);
  }

  return `${lines.join("\n")}\n`;
}

export function renderRunUsage(): string {
  return "Usage: hotflow run <prompt> [--provider <id>] [--model <name>] [--session <sessionId>] [--max-steps <n>] [--token-budget <n>]";
}

export function renderStatusUsage(): string {
  return "Usage: hotflow status <sessionId> [--turn <turnId>] [--limit <n>]";
}

export function renderControlUsage(): string {
  return [
    "Usage: hotflow control <action> <sessionId> [options]",
    "Actions:",
    "  compact <sessionId> [--strategy <soft|hard>]",
    "  resume <sessionId> [--checkpoint <id>]",
    "  rewind <sessionId> [--checkpoint <id>]",
    "  prompt-inspect <sessionId> [--turn <turnId>] [--step <n>]",
    "  prompt-explain <sessionId> [--turn <turnId>] [--step <n>]",
    "  output-style <sessionId> <style>",
    "  permissions <sessionId> <mode>",
    "  language <sessionId> <language>",
    "  memory-inspect <sessionId> [--scope <working|episodic|all>]",
    "  memory-clear <sessionId> [--scope <working|episodic|all>]",
  ].join("\n");
}

export function renderTaskUsage(): string {
  return [
    "Usage: hotflow task <action> <sessionId> [options]",
    "Actions:",
    "  status <sessionId>",
    "  mailbox <sessionId> [--worker <id>]",
    "  verifier-mailbox <sessionId> [--verifier <id>]",
    "  delegation-enqueue <sessionId> --id <id> --worker <id> --instruction <text> [--task <taskId>] [--verifier <id> --requirement <text> [--verification <id>]]",
    "  delegation-status <sessionId> --id <id> --status <queued|running|completed|failed|cancelled> [--error <msg>]",
    "  verification-upsert <sessionId> --id <id> --verifier <id> --requirement <text> [--status <pending|passed|failed|partial>] [--task <taskId>] [--verdict <text>]",
    "  proposal-enqueue <sessionId> --id <id> --kind <kind> --payload <json> --source-session <id> --source-turn <id> --provenance <text> [--expires-at <ms>]",
    "  proposal-transition <sessionId> --proposal-id <id> --status <pending|accepted|rejected|expired> [--decision-note <text>]",
    "  proposal-list <sessionId> [--status <pending|accepted|rejected|applied|expired>] [--limit <n>]",
    "  proposal-get <sessionId> --proposal-id <id>",
    "  proposal-review <sessionId> --proposal-id <id>",
    "  proposal-accept <sessionId> --proposal-id <id> [--decision-note <text>]",
    "  proposal-reject <sessionId> --proposal-id <id> [--decision-note <text>]",
    "  proposal-explain <sessionId> --proposal-id <id>",
    "  proposal-preview <sessionId> --proposal-id <id>",
    "  proposal-apply <sessionId> --proposal-id <id>",
    "  proposal-rollback <sessionId> [--version <n>]",
    "  proposal-outbox-drain <sessionId> [--limit <n>]",
  ].join("\n");
}

function renderSharedDirectorChannelCommandUsage(): readonly string[] {
  return [
    "Shared / commands:",
    ...getChannelCommandDefinitionsForSurface("cli").map((command) => {
      const argsHint = command.argsHint.length === 0 ? "" : ` ${command.argsHint}`;
      return `  /${command.canonicalName}${argsHint}  ${command.description}`;
    }),
  ];
}

export function renderDirectorUsage(): string {
  return [
    "Usage: hotflow director <action> [options]",
    "Actions:",
    "  bootstrap                     Prepare the Director Angel workspace layout",
    "  status                        Show workspace and knowledge counts",
    "  doctor [--host <url>] [--json] Diagnose runtime, bridge, memory, and operator lanes",
    "  acceptance [--json]           Summarize the latest benchmark gates for boundary review",
    "  message --text <text> [--peer-id <id>] [--host <url>] [--no-worker]  Send one CLI turn through the Host Entry session lane",
    "  binding list/create/delete    Manage V1 external client bindings",
    "  session create/list/messages  Manage V1 operator sessions",
    "  task submit/status/cancel/events  Manage V1 tasks and task event streams",
    "  catalog model-adapters        List V1 model adapter catalog entries",
    "  learning jobs list/create/run Manage V1 learning jobs",
    "  capabilities                  Show V1 Host API resource capabilities",
    "  reflect --run-id <id>          Reflect on a persisted Director run report and create review-gated candidates",
    "  heartbeat status              Run a safe local heartbeat scan and write heartbeat artifacts",
    "  heartbeat latest              Show the latest heartbeat snapshot without rescanning",
    "  self-reflect daily [--date D]  Generate a review-gated daily self-reflection report",
    "  soul view                     Show the current Director SOUL document",
    "  runtime                       Show the runtime capability snapshot",
    "  api-providers list            List local API provider settings",
    "  api-providers set --provider-id <id> --key <key> --value <value>",
    "  api-providers test --provider-id <id> [--api-key <key>] [--base-url <url>]",
    "  adapters list                 List Director adapters from the runtime snapshot",
    "  adapters register --manifest <path>      Register a persisted adapter manifest",
    "  adapters enable --adapter-id <id>        Force-enable an adapter via switch override",
    "  adapters disable --adapter-id <id>       Force-disable an adapter via switch override",
    "  adapters explain --adapter-id <id>       Explain one adapter's persisted and switch state",
    "  switches show                 Show Director switch defaults with runtime hints",
    "  switches set --feature <key> --enabled <true|false>",
    "  memory status                 Show local Director memory lane status",
    "  memory recall-preview --project-id <id> [--group-id <id>] [--anchor-id <id>] [--adapter-id <id>] [--generation-type <type>] [--generation-style <style>] [--tag <tag>] [--max-hits <n>]",
    "  trace-proposal status         Show local Director trace proposal lane status",
    "  trace-proposal list [--status <pending|accepted|rejected>] [--project-id <id>] [--group-id <id>] [--limit <n>]",
    "  trace-proposal explain --proposal-id <id>",
    "  trace-proposal review --proposal-id <id>",
    "  trace-proposal accept --proposal-id <id> [--note <text>]",
    "  trace-proposal reject --proposal-id <id> [--note <text>]",
    "  trace-proposal preview --proposal-id <id>",
    "  trace-proposal replay --proposal-id <id> [--worker-id <id>]",
    "  knowledge status              Show Director knowledge lane status",
    "  knowledge list                List published Director knowledge packs",
    "  knowledge explain --pack-id <id>",
    "  knowledge learn [--directory <path>] [--url <url>] [--query <text>] [--privacy <level>] [--max-depth <n>] [--max-results <n>]",
    "  knowledge experience-list",
    "  knowledge experience-explain --candidate-id <id>",
    "  knowledge experience-accept --candidate-id <id> [--author <name>] [--note <text>]",
    "  knowledge experience-reject --candidate-id <id> [--author <name>] [--note <text>]",
    "  knowledge experience-promote --candidate-id <id> [--author <name>] [--note <text>]",
    "  knowledge experience-classify --candidate-id <id> --category-id <id|name> [--tag-id <id|name>...] [--author <name>]",
    "  knowledge experience-tag --candidate-id <id> --tag-id <id|name>... [--author <name>]",
    "  knowledge experience-from-trace-proposal --proposal-id <id>",
    "  knowledge sync --proposal-id <id> [--author <name>] [--note <text>]",
    "  knowledge candidate-list",
    "  knowledge candidate-explain --pack-id <id>",
    "  knowledge diff --pack-id <id>        Show base/next summary for a candidate",
    "  knowledge review --pack-id <id>",
    "  knowledge accept --pack-id <id> [--author <name>] [--note <text>]",
    "  knowledge reject --pack-id <id> [--author <name>] [--note <text>]",
    "  knowledge publish --pack-id <id> [--author <name>] [--note <text>]",
    "  knowledge rollback --pack-id <id> --version <n> [--author <name>] [--note <text>]",
    "  knowledge recall-preview --project-id <id> [--group-id <id>] [--anchor-id <id>] [--adapter-id <id>] [--tag <tag>] [--generation-type <type>] [--generation-style <style>] [--include-global-experience] [--max-hits <n>] [--max-chars <n>]",
    "  skills list",
    "  skills propose-from-experience --candidate-id <id> [--author <name>]",
    "  skills accept --proposal-id <id> [--note <text>]",
    "  skills reject --proposal-id <id> [--note <text>]",
    "  skills apply --proposal-id <id>",
    "  skills classify --skill-id <id> --category-id <id|name> [--tag-id <id|name>...] [--author <name>]",
    "  skills tag --skill-id <id> --tag-id <id|name>... [--author <name>]",
    "  intake --input <path>         Normalize a snapshot and report missing information",
    "  clarify --input <path>        Ask the Director host API for clarification questions",
    "  evaluate --input <path>       Call the Director host API with a snapshot",
    "  blueprint --input <path>      Return preview + handoff for the snapshot",
    "  run create --input <path>     Materialize a reviewed blueprint into an execution run",
    "  run once --run-id <id> [--worker-id <id>] [--json]  Execute ready assignments through the local worker lane once",
    "  run status --run-id <id>      Inspect a persisted execution run",
    "  run start --run-id <id>       Start a created execution run",
    "  run pause --run-id <id>       Soft-pause dispatch while preserving in-flight work",
    "  run resume --run-id <id>      Resume a paused execution run",
    "  run abort --run-id <id>       Abort the run and close remaining assignments",
    "  run reroute --run-id <id> --assignment-id <id> --adapter-id <id>  Move one failed or blocked assignment onto another approved adapter",
    "  run retry --run-id <id> --assignment-id <id>  Retry one failed or blocked assignment",
    "  run approve --run-id <id> --assignment-id <id>  Approve one operator-gated assignment",
    "  run explain --run-id <id>     Explain the operator-facing diagnosis for one run",
    "  run audit --run-id <id>       Show the full operator-facing audit trail for one run",
    "  run report --run-id <id>      Collect a persisted run report",
    "  outcome --input <path>        Record an operator outcome JSON payload",
    "",
    renderDirectorV1Usage("director-angel"),
    "",
    ...renderSharedDirectorChannelCommandUsage(),
    "Options:",
    "  --host <url>                  Override the host API base URL",
    "  --help                        Show this usage information",
    "Example:",
    "  hotflow director runtime",
    "  hotflow director doctor",
    "  hotflow director doctor --json",
    "  hotflow director acceptance",
    '  hotflow director message --text "/制作 生成一个15秒短剧分镜蓝图"',
    '  hotflow director message --text "确认执行" --worker-id director-cli-message',
    "  hotflow director reflect --run-id run_123",
    "  hotflow director heartbeat status",
    "  hotflow director self-reflect daily",
    "  hotflow director adapters list",
    "  hotflow director adapters register --manifest fixtures/director/seedance.json",
    "  hotflow director adapters enable --adapter-id seedance-preview",
    "  hotflow director adapters disable --adapter-id seedance-preview",
    "  hotflow director adapters explain --adapter-id seedance-preview",
    "  hotflow director switches show",
    "  hotflow director memory status",
    "  hotflow director memory recall-preview --project-id project_123 --group-id group_123",
    "  hotflow director trace-proposal status",
    "  hotflow director trace-proposal list --project-id project_123",
    "  hotflow director trace-proposal explain --proposal-id proposal_record_123",
    "  hotflow director trace-proposal review --proposal-id proposal_record_123",
    "  hotflow director trace-proposal accept --proposal-id proposal_record_123 --note approved_for_reuse",
    "  hotflow director trace-proposal preview --proposal-id proposal_record_123",
    "  hotflow director trace-proposal replay --proposal-id proposal_record_123 --worker-id replay_worker_1",
    "  hotflow director knowledge status",
    "  hotflow director knowledge list",
    "  hotflow director knowledge explain --pack-id director-method-project-group-teaser",
    "  hotflow director knowledge learn --directory ~/Desktop/AngelLessons --privacy confidential",
    '  hotflow director knowledge learn --query "director agent learning workflow" --max-results 3',
    "  hotflow director knowledge experience-list",
    "  hotflow director knowledge experience-accept --candidate-id experience_desktop_lessons --author operator_1",
    "  hotflow director knowledge experience-promote --candidate-id experience_desktop_lessons --author operator_1",
    "  hotflow director knowledge sync --proposal-id proposal_record_123 --author operator_1",
    "  hotflow director knowledge candidate-list",
    "  hotflow director knowledge candidate-explain --pack-id director-method-project-group-teaser",
    "  hotflow director knowledge diff --pack-id director-method-project-group-teaser",
    "  hotflow director knowledge review --pack-id director-method-project-group-teaser",
    "  hotflow director knowledge accept --pack-id director-method-project-group-teaser --author operator_1",
    "  hotflow director knowledge publish --pack-id director-method-project-group-teaser --author operator_1",
    "  hotflow director knowledge rollback --pack-id director-method-project-group-teaser --version 1",
    "  hotflow director knowledge recall-preview --project-id project_123 --group-id group_123 --anchor-id anchor_a",
    "  hotflow director intake --input snapshot.json",
    "  hotflow director clarify --input snapshot.json",
    "  hotflow director evaluate --input snapshot.json",
    "  hotflow director blueprint --input snapshot.json",
    "  hotflow director run create --input blueprint.json",
    "  hotflow director run once --run-id run_123 --worker-id worker_local_1",
    "  hotflow director run status --run-id run_123",
    "  hotflow director run start --run-id run_123",
    "  hotflow director run pause --run-id run_123",
    "  hotflow director run resume --run-id run_123",
    "  hotflow director run abort --run-id run_123",
    "  hotflow director run reroute --run-id run_123 --assignment-id assignment_1 --adapter-id runway-preview",
    "  hotflow director run retry --run-id run_123 --assignment-id assignment_1",
    "  hotflow director run approve --run-id run_123 --assignment-id assignment_1",
    "  hotflow director run explain --run-id run_123",
    "  hotflow director run audit --run-id run_123",
    "  hotflow director run report --run-id run_123",
    "  hotflow director outcome --input outcome.json",
  ].join("\n");
}

function renderDirectorClarification(clarification: DirectorClarificationAssessment): string[] {
  const lines = [
    `  clarification: ${clarification.decision}`,
    `  summary: ${clarification.summary}`,
  ];
  if (clarification.missingFields.length > 0) {
    lines.push(`  missing fields: ${clarification.missingFields.join(" | ")}`);
  }
  if (clarification.conflictingFields.length > 0) {
    lines.push(`  conflicting fields: ${clarification.conflictingFields.join(" | ")}`);
  }
  if (clarification.questions.length > 0) {
    lines.push(
      `  questions: ${clarification.questions
        .map((question) => `${question.prompt} -> ${question.affectsFields.join(", ")}`)
        .join(" | ")}`,
    );
  }
  return lines;
}

function renderRuntimeCapabilitySnapshot(
  response: DirectorRuntimeCapabilitySnapshotResponse,
): string {
  const snapshot = response.capabilitySnapshot;
  const mediaAdapters = snapshot.adapters.filter((adapter) => adapter.adapterKind === "media");
  const dryRunCapable = snapshot.adapters.filter((adapter) => adapter.dryRunSupported);
  const notes = snapshot.notes ?? [];
  const lines = [
    "Director runtime snapshot:",
    `  runtime id: ${response.runtimeId}`,
    `  snapshot id: ${snapshot.snapshotId}`,
    `  captured at: ${snapshot.capturedAt}`,
    `  status: ${snapshot.status}`,
    `  adapters: ${snapshot.adapters.length}`,
    `  media adapters: ${mediaAdapters.length}`,
    `  dry-run capable: ${dryRunCapable.length}`,
  ];
  if (notes.length > 0) {
    lines.push(`  notes: ${notes.join(" | ")}`);
  }
  const ledger = response.agentOsProcessCapabilityLedger;
  if (ledger !== undefined) {
    lines.push(
      `  Agent OS process ledger: total=${ledger.totalEntries} risky-host=${ledger.riskyHostEntries}`,
    );
    for (const entry of ledger.entries.slice(0, 3)) {
      lines.push(`    - ${formatAgentOsProcessLedgerEntry(entry)}`);
    }
    if (ledger.entries.length > 3) {
      lines.push(`    - ... ${ledger.entries.length - 3} more`);
    }
  }
  const matrix = response.agentOsExtensionMatrix;
  if (matrix !== undefined) {
    lines.push(
      `  Agent OS extension matrix: total=${matrix.summary.total} ready=${matrix.summary.ready} needs-auth=${matrix.summary.needsAuth} needs-setup=${matrix.summary.needsSetup} problem=${matrix.summary.problem} disabled=${matrix.summary.disabled}`,
    );
    for (const entry of matrix.entries.slice(0, 3)) {
      lines.push(`    - ${formatAgentOsExtensionMatrixEntry(entry)}`);
    }
    if (matrix.entries.length > 3) {
      lines.push(`    - ... ${matrix.entries.length - 3} more`);
    }
  }
  const subagentRuns = response.agentOsSubagentRuns;
  if (subagentRuns !== undefined) {
    lines.push(
      `  Agent OS subagent runs: total=${subagentRuns.summary.total} queued=${subagentRuns.summary.queued} running=${subagentRuns.summary.running} completed=${subagentRuns.summary.completed} failed=${subagentRuns.summary.failed} cancelled=${subagentRuns.summary.cancelled} verified-pass=${subagentRuns.summary.verifiedPass} verified-fail=${subagentRuns.summary.verifiedFail} verified-partial=${subagentRuns.summary.verifiedPartial}`,
    );
    if (subagentRuns.schedulerHeartbeat !== undefined) {
      lines.push(
        `    scheduler=${formatAgentOsSubagentSchedulerHeartbeat(subagentRuns.schedulerHeartbeat)}`,
      );
    }
    const schedulerDispatchPlan = readAgentOsSubagentSchedulerDispatchPlan(subagentRuns);
    if (schedulerDispatchPlan !== undefined) {
      lines.push(
        `    dispatch=${formatAgentOsSubagentSchedulerDispatchPlan(schedulerDispatchPlan)}`,
      );
    }
    const schedulerTick = readAgentOsSubagentSchedulerTick(subagentRuns);
    if (schedulerTick !== undefined) {
      lines.push(`    tick=${formatAgentOsSubagentSchedulerTick(schedulerTick)}`);
    }
    const schedulerRecoveryPlan = readAgentOsSubagentSchedulerRecoveryPlan(subagentRuns);
    if (schedulerRecoveryPlan !== undefined) {
      lines.push(
        `    recovery=${formatAgentOsSubagentSchedulerRecoveryPlan(schedulerRecoveryPlan)}`,
      );
    }
    for (const entry of subagentRuns.entries.slice(0, 3)) {
      lines.push(`    - ${formatAgentOsSubagentRunEntry(entry)}`);
    }
    if (subagentRuns.entries.length > 3) {
      lines.push(`    - ... ${subagentRuns.entries.length - 3} more`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function formatAgentOsProcessLedgerEntry(
  entry: NonNullable<
    DirectorRuntimeCapabilitySnapshotResponse["agentOsProcessCapabilityLedger"]
  >["entries"][number],
): string {
  const fragments = [
    entry.runnerKind,
    ...(entry.backend === undefined ? [] : [`backend=${entry.backend}`]),
    `status=${entry.status}`,
    ...(entry.commandPattern === undefined
      ? []
      : [
          `command=${[entry.commandPattern.executable, ...(entry.commandPattern.argv ?? [])].join(" ")}`,
        ]),
    ...(entry.commandPattern?.operationId === undefined
      ? []
      : [`operation=${entry.commandPattern.operationId}`]),
    ...(entry.process?.pid === undefined ? [] : [`pid=${entry.process.pid}`]),
  ];
  return fragments.join(" ");
}

function formatAgentOsExtensionMatrixEntry(
  entry: NonNullable<
    DirectorRuntimeCapabilitySnapshotResponse["agentOsExtensionMatrix"]
  >["entries"][number],
): string {
  return [
    entry.displayName,
    `id=${entry.id}`,
    ...(entry.toolId === undefined ? [] : [`tool=${entry.toolId}`]),
    ...(entry.providerId === undefined ? [] : [`provider=${entry.providerId}`]),
    `status=${entry.health.status}`,
    `sandbox=${entry.sandbox.defaultMode}`,
    `network=${entry.sandbox.networkPolicy}`,
    `capabilities=${entry.capabilityIds.join(",") || "none"}`,
  ].join(" ");
}

function formatAgentOsSubagentSchedulerHeartbeat(
  heartbeat: NonNullable<
    DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
  >["schedulerHeartbeat"],
): string {
  if (heartbeat === undefined) {
    return "";
  }
  return [
    `ready=${heartbeat.readyCount}`,
    `blocked=${heartbeat.blockedCount}`,
    `running=${heartbeat.runningCount}`,
    `unscheduled=${heartbeat.unscheduledQueuedCount}`,
    `canContinue=${heartbeat.canContinue}`,
    `stopped=${heartbeat.stoppedReason}`,
    ...(heartbeat.nextParallelBatch === undefined
      ? []
      : [`nextBatch=${heartbeat.nextParallelBatch}`]),
    ...(heartbeat.nextReadySubagentIds.length === 0
      ? []
      : [`next=${heartbeat.nextReadySubagentIds.join(",")}`]),
    ...(heartbeat.blockedSubagentIds.length === 0
      ? []
      : [`blockedByScheduler=${heartbeat.blockedSubagentIds.join(",")}`]),
    `heartbeat=${heartbeat.heartbeatOrdinal}`,
  ].join(" ");
}

function formatAgentOsSubagentSchedulerDispatchPlan(
  plan: DirectorHostAgentOsSubagentSchedulerDispatchPlan,
): string {
  return [
    `canDispatch=${plan.canDispatch}`,
    `reason=${plan.dispatchReason}`,
    `max=${plan.maxDispatchableCount}`,
    ...(plan.dispatchableSubagentIds.length === 0
      ? []
      : [`dispatchable=${plan.dispatchableSubagentIds.join(",")}`]),
    ...(plan.dispatchBatches.length === 0
      ? []
      : [`batches=${formatAgentOsSubagentSchedulerDispatchBatches(plan.dispatchBatches)}`]),
    ...(plan.blockedSubagentIds.length === 0
      ? []
      : [`blocked=${plan.blockedSubagentIds.join(",")}`]),
    ...(plan.runningSubagentIds.length === 0
      ? []
      : [`running=${plan.runningSubagentIds.join(",")}`]),
    `plan=${plan.planOrdinal}`,
    `heartbeat=${plan.heartbeatOrdinal}`,
  ].join(" ");
}

function formatAgentOsSubagentSchedulerDispatchBatches(
  batches: readonly DirectorHostAgentOsSubagentSchedulerDispatchBatch[],
): string {
  return batches
    .map(
      (batch) =>
        `${batch.parallelBatch}:${batch.subagentIds.join(",") || "none"}@${batch.workerIds.join(",") || "none"}`,
    )
    .join(";");
}

function readAgentOsSubagentSchedulerDispatchPlan(
  subagentRuns: NonNullable<DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]>,
): DirectorHostAgentOsSubagentSchedulerDispatchPlan | undefined {
  return (
    subagentRuns as {
      readonly schedulerDispatchPlan?: DirectorHostAgentOsSubagentSchedulerDispatchPlan;
    }
  ).schedulerDispatchPlan;
}

function formatAgentOsSubagentSchedulerTick(
  tick: DirectorHostAgentOsSubagentSchedulerTick,
): string {
  return [
    `session=${tick.sessionId}`,
    `latestTurn=${tick.latestTurnId ?? "none"}`,
    `intents=${tick.dispatchIntents.length}`,
    `claimDryRun=${tick.claimDryRun}`,
    ...(tick.dispatchIntents.length === 0
      ? []
      : [
          `dispatch=${tick.dispatchIntents.map(formatAgentOsSubagentSchedulerTickIntent).join(";")}`,
        ]),
  ].join(" ");
}

function formatAgentOsSubagentSchedulerTickIntent(
  intent: DirectorHostAgentOsSubagentSchedulerTick["dispatchIntents"][number],
): string {
  return [
    `${intent.delegationId}->${intent.workerId}`,
    `batch=${intent.parallelBatch}`,
    ...(intent.writeSet.length === 0 ? [] : [`writeSet=${intent.writeSet.join(",")}`]),
    ...(intent.writeSetSource === undefined ? [] : [`source=${intent.writeSetSource}`]),
  ].join(" ");
}

function readAgentOsSubagentSchedulerTick(
  subagentRuns: NonNullable<DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]>,
): DirectorHostAgentOsSubagentSchedulerTick | undefined {
  return (
    subagentRuns as {
      readonly schedulerTick?: DirectorHostAgentOsSubagentSchedulerTick;
    }
  ).schedulerTick;
}

function formatAgentOsSubagentSchedulerRecoveryPlan(
  plan: NonNullable<
    NonNullable<
      DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
    >["schedulerRecoveryPlan"]
  >,
): string {
  return [
    `canRecover=${plan.canRecover}`,
    `actions=${plan.recoveryActions.length}`,
    `groups=${plan.recoveryGroups.length}`,
    ...(plan.blockedSubagentIds.length === 0
      ? []
      : [`blocked=${plan.blockedSubagentIds.join(",")}`]),
    ...(plan.conflictedSubagentIds.length === 0
      ? []
      : [`conflicted=${plan.conflictedSubagentIds.join(",")}`]),
    ...(plan.recoveryGroups.length === 0
      ? []
      : [
          `group=${plan.recoveryGroups.map(formatAgentOsSubagentSchedulerRecoveryGroup).join(";")}`,
        ]),
    ...(plan.recoveryActions.length === 0
      ? []
      : [
          `next=${plan.recoveryActions.map(formatAgentOsSubagentSchedulerRecoveryAction).join(";")}`,
        ]),
    `recovery=${plan.recoveryOrdinal}`,
  ].join(" ");
}

function formatAgentOsSubagentSchedulerRecoveryGroup(
  group: NonNullable<
    NonNullable<
      DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
    >["schedulerRecoveryPlan"]
  >["recoveryGroups"][number],
): string {
  return [
    group.groupId,
    `type=${group.groupType}`,
    `severity=${group.severity}`,
    `writeSet=${group.writeSet.join(",") || "none"}`,
    `running=${group.runningSubagentIds.length}`,
    `blocked=${group.blockedSubagentIds.length}`,
    `completed=${group.completedSubagentIds.length}`,
  ].join("@");
}

function formatAgentOsSubagentSchedulerRecoveryAction(
  action: NonNullable<
    NonNullable<
      DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
    >["schedulerRecoveryPlan"]
  >["recoveryActions"][number],
): string {
  return [
    action.subagentId,
    `type=${action.actionType}`,
    `severity=${action.severity}`,
    `reason=${action.reason}`,
    ...(action.relatedSubagentIds.length === 0
      ? []
      : [`related=${action.relatedSubagentIds.join(",")}`]),
  ].join("@");
}

function readAgentOsSubagentSchedulerRecoveryPlan(
  subagentRuns: NonNullable<DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]>,
):
  | NonNullable<
      NonNullable<
        DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
      >["schedulerRecoveryPlan"]
    >
  | undefined {
  return (
    subagentRuns as {
      readonly schedulerRecoveryPlan?: NonNullable<
        NonNullable<
          DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
        >["schedulerRecoveryPlan"]
      >;
    }
  ).schedulerRecoveryPlan;
}

function formatAgentOsSubagentRunEntry(
  entry: NonNullable<
    DirectorRuntimeCapabilitySnapshotResponse["agentOsSubagentRuns"]
  >["entries"][number],
): string {
  const summary = entry.parentVisibleResult.summary ?? entry.resultSummary;
  return [
    entry.subagentId,
    `status=${entry.status}`,
    `profile=${entry.profileId}`,
    `worker=${entry.workerId}`,
    `role=${entry.role}`,
    `parent=${entry.parentTurnId}`,
    ...(entry.taskId === undefined ? [] : [`task=${entry.taskId}`]),
    `isolated=${entry.isolatedContext}`,
    ...(entry.scheduling?.parallelGroup === undefined
      ? []
      : [`parallel=${entry.scheduling.parallelGroup}`]),
    ...(entry.scheduling === undefined ? [] : [`batch=${entry.scheduling.parallelBatch}`]),
    ...(entry.scheduling === undefined ? [] : [`order=${entry.scheduling.scheduleOrder}`]),
    ...(entry.scheduling === undefined ? [] : [`ready=${entry.scheduling.readyToStart}`]),
    ...(entry.scheduling?.blockedBy.length
      ? [`blockedBy=${entry.scheduling.blockedBy.join(",")}`]
      : []),
    ...(entry.scheduling?.writeSet.length
      ? [`writeSet=${entry.scheduling.writeSet.join(",")}`]
      : []),
    ...(entry.scheduling?.writeSetSource === undefined
      ? []
      : [`writeSetSource=${entry.scheduling.writeSetSource}`]),
    ...(entry.scheduling?.undeclaredObservedWriteSet?.length
      ? [`undeclaredObservedWriteSet=${entry.scheduling.undeclaredObservedWriteSet.join(",")}`]
      : []),
    ...(entry.scheduling?.observedConflictWith?.length
      ? [`observedConflictWith=${entry.scheduling.observedConflictWith.join(",")}`]
      : []),
    ...(entry.scheduling?.conflictReason === undefined
      ? []
      : [`conflictReason=${entry.scheduling.conflictReason}`]),
    ...(entry.observedWriteSet?.length
      ? [`observedWriteSet=${entry.observedWriteSet.join(",")}`]
      : []),
    ...(entry.observedWriteSetSource === undefined
      ? []
      : [`observedWriteSetSource=${entry.observedWriteSetSource}`]),
    ...(entry.verification?.verdict === undefined
      ? []
      : [`verification=${entry.verification.verdict}`]),
    ...(summary === undefined ? [] : [`summary=${summary}`]),
  ].join(" ");
}

function renderDirectorIntakeResponse(response: DirectorIntakeResponse): string {
  const lines = [
    "Director intake result:",
    `  intake id: ${response.intakeId}`,
    `  runtime: ${response.runtimeId}`,
    `  alignment state: ${response.alignmentState}`,
    `  capability adapters: ${response.capabilitySnapshot.adapters.length}`,
  ];
  if (response.alignmentLock) {
    lines.push(`  alignment lock: ${response.alignmentLock.lockId}`);
  }
  lines.push(...renderDirectorClarification(response.clarification));
  return `${lines.join("\n")}\n`;
}

function renderDirectorClarifyResponse(response: DirectorClarifyResponse): string {
  const lines = [
    "Director clarify result:",
    `  intake id: ${response.intakeId}`,
    `  runtime: ${response.runtimeId}`,
    `  alignment state: ${response.alignmentState}`,
  ];
  if (response.alignmentLock) {
    lines.push(`  alignment lock: ${response.alignmentLock.lockId}`);
  }
  lines.push(...renderDirectorClarification(response.clarification));
  return `${lines.join("\n")}\n`;
}

function renderDirectorBlueprintResponse(response: DirectorBlueprintResponse): string {
  const preview = response.preview;
  const actionGraph = response.actionGraph;
  const handoff = response.handoff;
  const lines = [
    "Director blueprint result:",
    `  review: ${response.review.overallDecision}`,
    `  blueprint id: ${response.blueprintId}`,
    `  graph id: ${actionGraph.graphId}`,
    `  nodes: ${actionGraph.nodes.length}`,
    `  edges: ${actionGraph.edges.length}`,
    `  handoff id: ${handoff.handoffId}`,
    `  preview only: ${handoff.sideEffectsAllowed ? "no" : "yes"}`,
    `  chosen adapters: ${handoff.chosenAdapters.join(", ") || "(none)"}`,
    `  required approvals: ${preview.requiredApprovals.join(" | ") || "(none)"}`,
  ];
  if (preview.blockedReasons.length > 0) {
    lines.push(`  blocked reasons: ${preview.blockedReasons.join(" | ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderDirectorRunResponse(run: ExecutionRun): string {
  const readyAssignments = run.assignments.filter((assignment) => assignment.status === "ready");
  const blockedAssignments = run.assignments.filter(
    (assignment) => assignment.status === "blocked",
  );
  const pendingAssignments = run.assignments.filter(
    (assignment) => assignment.status === "pending",
  );
  const runningAssignments = run.assignments.filter(
    (assignment) => assignment.status === "running",
  );
  const lines = [
    "Director run:",
    `  run id: ${run.runId}`,
    `  blueprint id: ${run.blueprintId}`,
    `  handoff id: ${run.handoffId}`,
    `  status: ${run.status}`,
    `  assignments: ${run.assignments.length}`,
    `  ready assignments: ${readyAssignments.length}`,
    `  pending assignments: ${pendingAssignments.length}`,
    `  blocked assignments: ${blockedAssignments.length}`,
    `  running assignments: ${runningAssignments.length}`,
  ];
  if (run.notes && run.notes.length > 0) {
    lines.push(`  notes: ${run.notes.join(" | ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderDirectorRunReport(report: ExecutionRunReport): string {
  const operatorSurface = report.operatorSurface;
  const holdingStateSurface = deriveDirectorRunHoldingStateSurface(report);
  const lines = [
    "Director run report:",
    `  report id: ${report.reportId}`,
    `  run id: ${report.runId}`,
    `  status: ${report.run.status}`,
    `  recorded at: ${report.recordedAt}`,
    `  flags: ${report.flags.join(" | ") || "(none)"}`,
    `  summary: ${report.summary.join(" | ")}`,
    `  events: ${report.events.length}`,
  ];
  const directorGoal = operatorSurface?.directorGoal ?? report.run.goal;
  if (directorGoal.trim().length > 0) {
    lines.push(`  director goal: ${directorGoal}`);
  }
  const operatorSummary =
    operatorSurface?.operatorSummary ??
    (report.run.previewSummary.trim().length > 0 && report.run.previewSummary !== report.run.goal
      ? report.run.previewSummary
      : undefined);
  if (operatorSummary !== undefined) {
    lines.push(`  operator summary: ${operatorSummary}`);
  }
  if (holdingStateSurface !== undefined) {
    lines.push(`  holding state: ${holdingStateSurface.verdictText}`);
  }
  if (operatorSurface !== undefined) {
    if (operatorSurface.objective !== undefined) {
      lines.push(`  objective: ${operatorSurface.objective}`);
    }
    if (operatorSurface.deliverable !== undefined) {
      lines.push(`  deliverable: ${operatorSurface.deliverable}`);
    }
    if (operatorSurface.adapterRoute !== undefined) {
      lines.push(`  adapter route: ${operatorSurface.adapterRoute}`);
    }
    if (operatorSurface.lastBridgeRoute !== undefined) {
      lines.push(`  last bridge route: ${operatorSurface.lastBridgeRoute}`);
    }
    if (operatorSurface.bridgeVerdict !== undefined) {
      lines.push(
        operatorSurface.bridgeVerdict === "failed" &&
          operatorSurface.bridgeFailureReason !== undefined
          ? `  bridge verdict: failed (${operatorSurface.bridgeFailureReason})`
          : `  bridge verdict: ${operatorSurface.bridgeVerdict}`,
      );
    }
    if (operatorSurface.requestAccepted !== undefined) {
      lines.push(`  request accepted: ${operatorSurface.requestAccepted ? "yes" : "no"}`);
    }
    if (operatorSurface.retryable !== undefined) {
      lines.push(`  retryable: ${operatorSurface.retryable ? "yes" : "no"}`);
    }
    if (operatorSurface.retryAllowed !== undefined) {
      lines.push(`  retry allowed: ${operatorSurface.retryAllowed ? "yes" : "no"}`);
    }
    if (operatorSurface.rerouteCandidates !== undefined) {
      lines.push(
        `  reroute candidates: ${operatorSurface.rerouteCandidates.join(", ") || "(none)"}`,
      );
    }
    if (operatorSurface.bridgeStatus !== undefined) {
      lines.push(`  bridge status: ${operatorSurface.bridgeStatus}`);
    }
    if (operatorSurface.requestId !== undefined) {
      lines.push(`  request id: ${operatorSurface.requestId}`);
    }
    if (operatorSurface.bridgeAttempts !== undefined) {
      lines.push(
        `  bridge attempts: ${operatorSurface.bridgeAttempts.attempts} (successes: ${operatorSurface.bridgeAttempts.successes}, failures: ${operatorSurface.bridgeAttempts.failures})`,
      );
    }
  } else {
    const primaryAssignment =
      report.run.assignments.find(
        (assignment) => assignment.result?.bridgeExecution !== undefined,
      ) ??
      report.run.assignments.find((assignment) => assignment.actionClass === "generate") ??
      report.run.assignments[0];

    if (primaryAssignment !== undefined) {
      lines.push(`  objective: ${primaryAssignment.objective}`);
      lines.push(`  deliverable: ${primaryAssignment.deliverable}`);

      const adapterRoute = primaryAssignment.result?.adapterId ?? primaryAssignment.selectedAdapter;
      if (adapterRoute !== undefined && adapterRoute !== null) {
        lines.push(`  adapter route: ${adapterRoute}`);
      }

      const bridgeExecution = primaryAssignment.result?.bridgeExecution;
      if (bridgeExecution !== undefined) {
        if (bridgeExecution.failure !== undefined) {
          lines.push(`  bridge verdict: failed (${bridgeExecution.failure.reason})`);
          lines.push(`  retryable: ${bridgeExecution.failure.retryable ? "yes" : "no"}`);
          if (bridgeExecution.failure.statusCode !== undefined) {
            lines.push(`  bridge status: ${bridgeExecution.failure.statusCode}`);
          }
          lines.push(`  next action: ${describeBridgeFailureNextAction(bridgeExecution.failure)}`);
        } else {
          const accepted = bridgeExecution.response?.accepted;
          lines.push(`  bridge verdict: ${accepted === true ? "accepted" : "responded"}`);
          lines.push(
            `  request accepted: ${accepted === undefined ? "unknown" : accepted ? "yes" : "no"}`,
          );
          if (bridgeExecution.response?.statusCode !== undefined) {
            lines.push(`  bridge status: ${bridgeExecution.response.statusCode}`);
          }
          if (bridgeExecution.response?.requestId !== undefined) {
            lines.push(`  request id: ${bridgeExecution.response.requestId}`);
          }
          lines.push(
            `  next action: ${describeBridgeSuccessNextAction(bridgeExecution.response?.requestId)}`,
          );
        }
      }
    }

    if (report.bridgeMetrics !== undefined) {
      lines.push(
        `  bridge attempts: ${report.bridgeMetrics.attempts} (successes: ${report.bridgeMetrics.successes}, failures: ${report.bridgeMetrics.failures})`,
      );
    }
  }
  if (operatorSurface?.nextAction !== undefined) {
    lines.push(`  next action: ${operatorSurface.nextAction}`);
  } else if (holdingStateSurface !== undefined) {
    lines.push(`  next action: ${holdingStateSurface.nextAction}`);
    lines.push(`  suggested commands: ${holdingStateSurface.suggestedCommands.join(" | ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderDirectorRunOnceResult(
  result: DirectorRunOnceExecutionResult,
  workerId: string,
): string {
  const assignmentCounts = countDirectorRunAssignments(result.run);
  const surface = summarizeDirectorRunOnceResult(result);
  const lines = [
    "Director run once:",
    `  status: ${surface.status.toUpperCase()}`,
    `  run id: ${result.run.runId}`,
    `  worker id: ${workerId}`,
    `  run status: ${result.run.status}`,
    `  report id: ${result.report.reportId}`,
    `  executed assignments: ${result.executedAssignments.length}`,
    `  assignment counts: ready=${assignmentCounts.ready} pending=${assignmentCounts.pending} running=${assignmentCounts.running} completed=${assignmentCounts.completed} failed=${assignmentCounts.failed} blocked=${assignmentCounts.blocked} skipped=${assignmentCounts.skipped} aborted=${assignmentCounts.aborted}`,
    `  summary: ${surface.summaryText}`,
    `  flags: ${result.report.flags.join(" | ") || "(none)"}`,
    `  report summary: ${result.report.summary.join(" | ")}`,
  ];

  if (result.executedAssignments.length > 0) {
    lines.push(`  assignment ids: ${result.executedAssignments.join(", ")}`);
  }
  if (surface.routeSummary !== undefined) {
    lines.push(`  route summary: ${surface.routeSummary}`);
  }
  if (surface.nextAction !== undefined) {
    lines.push(`  next action: ${surface.nextAction}`);
  }
  if (surface.suggestedCommands.length > 0) {
    lines.push(`  suggested commands: ${surface.suggestedCommands.join(" | ")}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderDirectorRunOnceJsonResult(
  result: DirectorRunOnceExecutionResult,
  workerId: string,
): string {
  const assignmentCounts = countDirectorRunAssignments(result.run);
  return `${JSON.stringify(
    {
      runId: result.run.runId,
      status: result.run.status,
      workerId,
      reportId: result.report.reportId,
      executedAssignments: result.executedAssignments,
      assignmentCounts,
      flags: result.report.flags,
      summary: result.report.summary,
    },
    null,
    2,
  )}\n`;
}

async function runDirectorMessageWorkerOnce(
  result: DirectorEntryMessageResult,
  input: {
    readonly workspaceRoot: string;
    readonly dataDir: string;
    readonly workerId: string;
  },
): Promise<DirectorRunOnceExecutionResult | null> {
  const runId =
    result.run?.run?.runId ?? result.status?.run?.runId ?? result.intake.session.latestRun?.runId;
  if (runId === undefined || runId.length === 0) {
    return null;
  }
  try {
    const directorWorker = await directorWorkerModuleLoader();
    return await directorWorker.runDirectorWorkerOnce(
      {
        runId,
        workerId: input.workerId,
      },
      {
        env: {
          ...process.env,
          HOTFLOW_WORKSPACE_ROOT: input.workspaceRoot,
          HOTFLOW_DATA_DIR: input.dataDir,
        },
      },
    );
  } catch {
    return null;
  }
}

function renderDirectorMessageResultWithWorker(
  entryResult: DirectorEntryMessageResult,
  workerResult: DirectorRunOnceExecutionResult | null | undefined,
  options: { readonly json?: boolean | undefined } = {},
): string {
  if (options.json === true) {
    return renderDirectorEntryMessageResult(entryResult, { json: true });
  }

  const workerText = humanizeProductionResultText(
    workerResult?.report.operatorSurface?.operatorSummary ??
      workerResult?.report.summary.join("\n") ??
      "",
  ).trim();
  if (workerText.length > 0) {
    return `${workerText}\n`;
  }

  return renderDirectorEntryMessageResult(entryResult);
}

function summarizeDirectorRunOnceResult(result: DirectorRunOnceExecutionResult): {
  readonly status: "pass" | "warn" | "fail";
  readonly summaryText: string;
  readonly nextAction?: string;
  readonly routeSummary?: string;
  readonly suggestedCommands: readonly string[];
} {
  const routeEntries = deriveDirectorRouteHealthEntries(result.report.run.assignments);
  const diagnosis =
    routeEntries.length === 0 ? undefined : summarizeDirectorRouteHealthForDoctor(routeEntries);
  const assignmentCounts = countDirectorRunAssignments(result.run);

  if (diagnosis !== undefined && diagnosis.status !== "pass") {
    return {
      status: diagnosis.status,
      summaryText:
        diagnosis.status === "fail"
          ? `Local worker lane stopped after ${result.executedAssignments.length} executed assignment(s); safe progress now needs operator repair.`
          : `Local worker lane advanced ${result.executedAssignments.length} assignment(s), but the run still needs bounded operator recovery.`,
      nextAction:
        diagnosis.entries.find((entry) => entry.nextAction !== undefined)?.nextAction ??
        result.report.operatorSurface?.nextAction ??
        "inspect the persisted run report before continuing.",
      routeSummary: diagnosis.summary,
      suggestedCommands: buildDirectorRunOnceSuggestedCommands(result.run.runId, diagnosis),
    };
  }

  if (result.run.status === "completed") {
    return {
      status: "pass",
      summaryText: `Local worker lane advanced ${result.executedAssignments.length} assignment(s) and the run reached completed.`,
      nextAction:
        result.report.operatorSurface?.nextAction ??
        "inspect the persisted run report and continue from the operator lane.",
      ...(diagnosis === undefined ? {} : { routeSummary: diagnosis.summary }),
      suggestedCommands: [`hotflow director run report --run-id ${result.run.runId}`],
    };
  }

  if (result.run.status === "created" || result.run.status === "paused") {
    const holdingPatternSurface = deriveDirectorRunHoldingStateSurface(result.report, {
      fromLocalWorkerPass: true,
      localWorkerAdvanceCount: result.executedAssignments.length,
    });
    if (holdingPatternSurface === undefined) {
      return {
        status: "warn",
        summaryText: `Local worker lane finished one bounded pass with run status ${result.run.status}.`,
        nextAction:
          result.report.operatorSurface?.nextAction ??
          "inspect the persisted run report before continuing.",
        ...(diagnosis === undefined ? {} : { routeSummary: diagnosis.summary }),
        suggestedCommands: [`hotflow director run report --run-id ${result.run.runId}`],
      };
    }

    return {
      status: "warn",
      summaryText: holdingPatternSurface.summaryText,
      nextAction: holdingPatternSurface.nextAction,
      ...(diagnosis === undefined ? {} : { routeSummary: diagnosis.summary }),
      suggestedCommands: holdingPatternSurface.suggestedCommands,
    };
  }

  return {
    status: "warn",
    summaryText: `Local worker lane finished one bounded pass with run status ${result.run.status}.`,
    nextAction:
      result.report.operatorSurface?.nextAction ??
      "inspect the persisted run report before continuing.",
    ...(diagnosis === undefined ? {} : { routeSummary: diagnosis.summary }),
    suggestedCommands: [`hotflow director run report --run-id ${result.run.runId}`],
  };
}

function buildDirectorRunOnceSuggestedCommands(
  runId: string,
  diagnosis: ReturnType<typeof summarizeDirectorRouteHealthForDoctor>,
): readonly string[] {
  const commands = new Set<string>();

  for (const entry of diagnosis.entries) {
    if (entry.verdict === "degraded" && entry.retryAllowed) {
      commands.add(
        `hotflow director run retry --run-id ${runId} --assignment-id ${entry.assignmentId}`,
      );
    } else if (entry.verdict === "reroutable" && entry.rerouteCandidates[0] !== undefined) {
      commands.add(
        `hotflow director run reroute --run-id ${runId} --assignment-id ${entry.assignmentId} --adapter-id ${entry.rerouteCandidates[0]}`,
      );
    } else if (entry.verdict === "blocked" || entry.verdict === "exhausted") {
      commands.add(`hotflow director run explain --run-id ${runId}`);
    }

    if (commands.size >= 2) {
      break;
    }
  }

  if (commands.size === 0) {
    commands.add(`hotflow director run explain --run-id ${runId}`);
  }

  return [...commands];
}

function describeBridgeFailureNextAction(failure: {
  readonly reason: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}): string {
  return describeDirectorBridgeFailureNextAction(failure);
}

function describeBridgeSuccessNextAction(requestId: string | undefined): string {
  if (requestId !== undefined) {
    return "track the remote request by request id and wait for the downstream result.";
  }
  return "wait for the downstream result and follow up from the operator lane.";
}

function renderDirectorOutcomeResponse(response: DirectorOutcomeResponse): string {
  const lines = [
    "Director outcome recorded:",
    `  stored: ${response.stored ? "yes" : "no"}`,
    `  blueprint id: ${response.blueprintId}`,
    `  handoff id: ${response.handoffId}`,
    `  outcome id: ${response.outcome.outcomeId}`,
    `  status: ${response.outcome.status}`,
    `  recorded at: ${response.outcome.recordedAt}`,
  ];
  if (response.outcome.notes) {
    lines.push(`  notes: ${response.outcome.notes}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderDirectorEvaluateResponse(response: DirectorEvaluateResponse): string {
  const lines = [
    "Director evaluation result:",
    `  decision: ${response.decision}`,
    `  summary: ${response.summary}`,
    `  plan id: ${response.plan.planId}`,
    `  plan status: ${response.plan.status}`,
    `  style: ${response.plan.selectedGenerationStyle}`,
    `  review decision: ${response.review.overallDecision}`,
  ];
  if (response.recommendations.length > 0) {
    lines.push(`  recommendations: ${response.recommendations.join(" | ")}`);
  }
  if (response.review.warnings && response.review.warnings.length > 0) {
    lines.push(`  warnings: ${response.review.warnings.join(" | ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function resolveDirectorProvidersRoot(workspaceRoot: string): string {
  return resolve(resolveDirectorWorkspace({ root: workspaceRoot }).root, "providers");
}

function resolveDirectorSwitchPath(workspaceRoot: string): string {
  return resolve(resolveDirectorWorkspace({ root: workspaceRoot }).runtime, "switches.json");
}

function isContentSafetyDeveloperDebugEnabled(workspaceRoot: string): boolean {
  const state = loadDirectorSwitchState(resolveDirectorSwitchPath(workspaceRoot));
  return state.features["contentSafety.developerDebug.enabled"] === true;
}

function renderDirectorApiProviders(workspaceRoot: string): string {
  const result = loadDirectorApiProviderConfig(resolveDirectorProvidersRoot(workspaceRoot));
  const lines = [
    "Director API providers:",
    `  source: ${result.source}`,
    `  config: ${result.configPath}`,
    `  providers: ${result.document.providers.length}`,
  ];
  for (const provider of result.document.providers) {
    lines.push(
      `  - ${provider.id} enabled=${provider.enabled ? "yes" : "no"} key=${provider.apiKeyConfigured ? provider.apiKeyMasked : "missing"} models=${provider.models.length}`,
    );
    lines.push(
      `    defaults: text=${provider.defaultModels.text} image=${provider.defaultModels.image_generation} video=${provider.defaultModels.video_generation}`,
    );
  }
  for (const issue of result.issues) {
    lines.push(`  issue: ${issue}`);
  }
  return `${lines.join("\n")}\n`;
}

async function updateDirectorApiProviderFromCli(
  workspaceRoot: string,
  input: ParsedDirectorApiProviderSetArgs,
): Promise<string> {
  const providersRoot = resolveDirectorProvidersRoot(workspaceRoot);
  const result = await updateDirectorApiProviderSetting(providersRoot, input);
  return [
    "Director API provider updated:",
    `  provider: ${input.providerId}`,
    `  key: ${input.key}`,
    `  config: ${result.configPath}`,
  ].join("\n");
}

async function testDirectorApiProviderFromCli(
  workspaceRoot: string,
  input: ParsedDirectorApiProviderTestArgs,
): Promise<string> {
  const result = await testDirectorApiProviderConnection(
    resolveDirectorProvidersRoot(workspaceRoot),
    input,
  );
  return [
    "Director API provider test:",
    `  provider: ${result.providerId}`,
    `  status: ${result.ok ? "pass" : "fail"}`,
    `  endpoint: ${result.endpoint}`,
    `  latency: ${result.latencyMs}ms`,
    `  message: ${result.message}`,
    ...(result.modelCount === undefined ? [] : [`  models: ${result.modelCount}`]),
  ].join("\n");
}

function updateDirectorSwitchFeature(
  workspaceRoot: string,
  input: ParsedDirectorSwitchSetArgs,
): string {
  const switchPath = resolveDirectorSwitchPath(workspaceRoot);
  writeDirectorFeatureOverride(switchPath, input.feature, input.enabled);
  return [
    "Director switch updated:",
    `  feature: ${input.feature}`,
    `  enabled: ${input.enabled ? "yes" : "no"}`,
    `  path: ${switchPath}`,
  ].join("\n");
}

export function renderHelp(): string {
  return [
    "Director Angel OS CLI",
    "Open-source agent runtime for inspectable local workflows.",
    "开源智能体操作系统 CLI，面向可审计、可恢复、可扩展的本地工作流。",
    "",
    "Use `hotflow` as the command name during the transition.",
    "品牌已切换为 Director Angel OS，命令名暂时仍保持 `hotflow`。",
    "",
    "Commands:",
    "  golden-path   Run the open-source quickstart demo flow",
    "  preflight     Summarize whether the workspace is ready for a bounded first or next run",
    "  run           Run a prompt through the configured provider",
    "  control       Run control-plane session, context, policy, and memory actions",
    "  resume        Show the persisted recovery summary for a session",
    "  status        Inspect recovery, step, stream, and audit state for a session",
    "  task          Run control-plane task actions",
    "  doctor        Check bootstrap, providers, storage, and runtime health",
    "  onboard       Preview workspace readiness and first-run next steps",
    "  director      Bootstrap/status/evaluate Director Angel preflight",
    "",
    "Examples:",
    "  hotflow preflight",
    "  hotflow onboard",
    '  hotflow run "Read README.md and summarize the project."',
    "  hotflow control memory-inspect <sessionId>",
    "  hotflow control prompt-inspect <sessionId>",
    "  hotflow control prompt-explain <sessionId>",
    "  hotflow status <sessionId>",
    "  hotflow director knowledge diff --pack-id director-method-project-group-teaser",
    "",
  ].join("\n");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${String(value)}`);
}

async function runDirectorCommand(args: readonly string[]): Promise<void> {
  const sharedCommandArgs = resolveDirectorCliSharedCommandArgs(args.join(" "));
  if (sharedCommandArgs !== null) {
    await runDirectorCommand(sharedCommandArgs);
    return;
  }

  const [action, ...actionArgs] = args;
  const { workspaceRoot, dataDir } = loadConfig();

  if (!action || action === "--help" || action === "-h") {
    process.stdout.write(`${renderDirectorUsage()}\n`);
    if (!action) {
      process.exitCode = 1;
    }
    return;
  }

  if (DIRECTOR_V1_ACTIONS.has(action)) {
    const exitCode = await runDirectorV1Command([action, ...actionArgs]);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return;
  }

  if (action === "bootstrap") {
    process.stdout.write(`${bootstrapDirectorWorkspace(workspaceRoot)}\n`);
    return;
  }

  if (action === "status") {
    const statusMessage = await describeDirectorStatus(workspaceRoot);
    process.stdout.write(`${statusMessage}\n`);
    return;
  }

  if (action === "doctor") {
    const parsed = parseDirectorDoctorArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorDoctorUsage()}\n`);
      return;
    }
    if (parsed.value.help) {
      process.stdout.write(`${renderDirectorDoctorUsage()}\n`);
      return;
    }

    const report = await runDirectorDoctor(workspaceRoot, {
      ...(parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl }),
    });
    process.stdout.write(renderDirectorDoctorReport(report, parsed.value.format));
    if (report.status === "fail") {
      process.exitCode = 1;
    }
    return;
  }

  if (action === "acceptance") {
    const parsed = parseDirectorAcceptanceArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorAcceptanceUsage()}\n`);
      return;
    }
    if (parsed.value.help) {
      process.stdout.write(`${renderDirectorAcceptanceUsage()}\n`);
      return;
    }

    const report = await runDirectorAcceptance(workspaceRoot);
    process.stdout.write(renderDirectorAcceptanceReport(report, parsed.value.format));
    if (report.status === "fail") {
      process.exitCode = 1;
    }
    return;
  }

  if (action === "reflect") {
    const parsed = parseDirectorRunStatusArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    try {
      const output = await createDirectorReflectionFromRunReport(workspaceRoot, {
        runId: parsed.value.runId,
      });
      process.stdout.write(`${output}\n`);
    } catch (error) {
      process.stdout.write(`Director reflection failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "message") {
    const parsed = parseDirectorMessageArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    if (isLowAdmissionText(parsed.value.text)) {
      process.stdout.write(
        [
          "Director message admission:",
          "  status: ignored-low-signal",
          "  reason: no production objective, learning source, or actionable operator request was detected",
          "  next action: provide a production objective, link, file directory, or concrete requirement",
        ].join("\n"),
      );
      process.stdout.write("\n");
      return;
    }
    const productionObjective =
      parseExplicitProductionObjective(parsed.value.text) ??
      parseNaturalDirectorProductionObjective(parsed.value.text);
    const safety =
      productionObjective === null
        ? { verdict: "allow" as const }
        : evaluateProductionContentSafety(productionObjective, {
            mode: isContentSafetyDeveloperDebugEnabled(workspaceRoot)
              ? "developer-debug"
              : "standard",
          });
    if (productionObjective !== null && safety.verdict === "rewrite-required") {
      process.stdout.write(
        `${[
          "这个方向不能按“拐卖后爱情美满”来做。",
          ...(safety.mode === "developer-debug"
            ? [
                "",
                `开发者调试：${safety.ruleId ?? "content-policy"} · ${safety.reason ?? "命中内容策略"}`,
                `策略层级：floor=${safety.floor}；canOverride=${String(safety.canOverride)}；requiresApproval=${String(safety.requiresApproval)}`,
                ...(safety.auditEvent === undefined ? [] : [`审计事件：${safety.auditEvent}`]),
                ...(safety.debugNotes ?? []).map((note) => `- ${note}`),
              ]
            : []),
          "",
          "可以改成：",
          safety.safeRewriteObjective ?? buildSafeRewriteObjective(productionObjective),
          "",
          "确认后我再按这个安全方向生成结果。",
        ].join("\n")}\n`,
      );
      return;
    }
    try {
      const result = await sendDirectorEntryMessage(parsed.value);
      const workerResult =
        parsed.value.runWorkerOnce === false || parsed.value.json === true
          ? undefined
          : await runDirectorMessageWorkerOnce(result, {
              workspaceRoot,
              dataDir,
              workerId: parsed.value.workerId ?? "director-cli-message",
            });
      process.stdout.write(
        renderDirectorMessageResultWithWorker(result, workerResult, {
          json: parsed.value.json,
        }),
      );
    } catch (error) {
      process.stdout.write(`Director message failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "heartbeat") {
    const subaction = actionArgs[0] ?? "status";
    try {
      if (subaction === "latest") {
        process.stdout.write(`${await describeDirectorHeartbeatStatus(workspaceRoot)}\n`);
      } else if (subaction === "status") {
        process.stdout.write(`${await runDirectorHeartbeat(workspaceRoot)}\n`);
      } else {
        process.stdout.write("Director heartbeat command supports: status, latest\n");
        process.exitCode = 1;
      }
    } catch (error) {
      process.stdout.write(`Director heartbeat failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "self-reflect" || action === "self-reflection") {
    const subaction = actionArgs[0] ?? "daily";
    if (subaction !== "daily" && subaction !== "today") {
      process.stdout.write("Director self-reflect command supports: daily\n");
      process.exitCode = 1;
      return;
    }
    const parsed = parseDirectorSelfReflectDailyArgs(actionArgs.slice(1));
    if (!parsed.ok) {
      process.stdout.write(`${parsed.error}\n`);
      process.stdout.write(`${renderDirectorUsage()}\n`);
      process.exitCode = 1;
      return;
    }
    try {
      const result = await runDirectorDailySelfReflection(workspaceRoot, {
        ...(parsed.value.date === undefined ? {} : { date: parsed.value.date }),
        dataDir,
      });
      process.stdout.write(
        `${formatDirectorDailySelfReflectionReport(result.report, result.reportPath)}\n`,
      );
    } catch (error) {
      process.stdout.write(`Director daily self-reflection failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "soul") {
    const subaction = actionArgs[0] ?? "view";
    if (subaction !== "view" && subaction !== "status") {
      process.stdout.write("Director soul command supports: view, status\n");
      process.exitCode = 1;
      return;
    }
    try {
      process.stdout.write(`${await viewDirectorSoul(workspaceRoot)}\n`);
    } catch (error) {
      process.stdout.write(`Director soul failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "runtime") {
    const parsed = parseDirectorRuntimeArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    try {
      const result = await fetchDirectorRuntimeSnapshot(
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderRuntimeCapabilitySnapshot(result));
    } catch (error) {
      process.stdout.write(`Director runtime failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "api-providers") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }
    if (subaction === "list") {
      process.stdout.write(renderDirectorApiProviders(workspaceRoot));
      return;
    }
    if (subaction === "set") {
      const parsed = parseDirectorApiProviderSetArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(
          `${await updateDirectorApiProviderFromCli(workspaceRoot, parsed.value)}\n`,
        );
      } catch (error) {
        process.stdout.write(`Director API provider update failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }
    if (subaction === "test") {
      const parsed = parseDirectorApiProviderTestArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(
          `${await testDirectorApiProviderFromCli(workspaceRoot, parsed.value)}\n`,
        );
      } catch (error) {
        process.stdout.write(`Director API provider test failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "skills") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "list") {
      try {
        process.stdout.write(`${await listDirectorSkills(dataDir)}\n`);
      } catch (error) {
        process.stdout.write(`Director skills list failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "propose-from-experience") {
      const parsed = parseDirectorSkillProposalArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(
          `${await proposeDirectorSkillFromExperience(workspaceRoot, dataDir, parsed.value)}\n`,
        );
      } catch (error) {
        process.stdout.write(`Director Skill proposal failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "accept" || subaction === "reject") {
      const parsed = parseDirectorSkillDecisionArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const output =
          subaction === "accept"
            ? await acceptDirectorSkillProposal(dataDir, parsed.value)
            : await rejectDirectorSkillProposal(dataDir, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director Skill ${subaction} failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "apply") {
      const parsed = parseDirectorSkillDecisionArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(
          `${await applyDirectorSkillProposal(dataDir, parsed.value.proposalId)}\n`,
        );
      } catch (error) {
        process.stdout.write(`Director Skill apply failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "classify") {
      const parsed = parseDirectorSkillClassifyArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(`${await classifyDirectorSkill(dataDir, parsed.value)}\n`);
      } catch (error) {
        process.stdout.write(`Director Skill classify failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "tag") {
      const parsed = parseDirectorSkillTagArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(`${await tagDirectorSkill(dataDir, parsed.value)}\n`);
      } catch (error) {
        process.stdout.write(`Director Skill tag failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "adapters") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }
    if (subaction === "list") {
      const parsed = parseDirectorRuntimeArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const result = await fetchDirectorRuntimeSnapshot(
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorAdapterInventory(workspaceRoot, result));
      } catch (error) {
        process.stdout.write(`Director adapters failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "register") {
      const parsed = parseDirectorAdapterRegisterArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(
          await registerDirectorAdapterManifest(workspaceRoot, parsed.value.manifestPath),
        );
      } catch (error) {
        process.stdout.write(`Director adapter register failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "enable" || subaction === "disable") {
      const parsed = parseDirectorAdapterToggleArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(
          await setDirectorAdapterEnabled(
            workspaceRoot,
            parsed.value.adapterId,
            subaction === "enable",
          ),
        );
      } catch (error) {
        process.stdout.write(`Director adapter ${subaction} failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "explain") {
      const parsed = parseDirectorAdapterExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(await explainDirectorAdapter(workspaceRoot, parsed.value.adapterId));
      } catch (error) {
        process.stdout.write(`Director adapter explain failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "switches") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }
    if (subaction === "set") {
      const parsed = parseDirectorSwitchSetArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        process.stdout.write(`${updateDirectorSwitchFeature(workspaceRoot, parsed.value)}\n`);
      } catch (error) {
        process.stdout.write(`Director switches update failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction !== "show") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      process.exitCode = 1;
      return;
    }

    const parsed = parseDirectorRuntimeArgs(subactionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    try {
      const result = await fetchDirectorRuntimeSnapshot(
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderDirectorSwitchSummary(workspaceRoot, result));
    } catch (error) {
      process.stdout.write(`Director switches failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "memory") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "status") {
      const output = await describeDirectorMemoryStatus(workspaceRoot);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "recall-preview") {
      const parsed = parseDirectorMemoryRecallArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      const output = await previewDirectorMemoryRecall(workspaceRoot, parsed.value);
      process.stdout.write(`${output}\n`);
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "trace-proposal") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "status") {
      const output = await describeDirectorTraceProposalStatus(workspaceRoot);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "list") {
      const parsed = parseDirectorTraceProposalListArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      const output = await listDirectorTraceProposals(workspaceRoot, parsed.value);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "explain") {
      const parsed = parseDirectorTraceProposalExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await explainDirectorTraceProposal(workspaceRoot, parsed.value.proposalId);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director trace proposal explain failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "review") {
      const parsed = parseDirectorTraceProposalExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await reviewDirectorTraceProposalForOperator(
          workspaceRoot,
          parsed.value.proposalId,
        );
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director trace proposal review failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "accept" || subaction === "reject") {
      const parsed = parseDirectorTraceProposalDecisionArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output =
          subaction === "accept"
            ? await acceptDirectorTraceProposal(workspaceRoot, parsed.value)
            : await rejectDirectorTraceProposal(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director trace proposal ${subaction} failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "preview") {
      const parsed = parseDirectorTraceProposalExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await previewDirectorTraceProposal(workspaceRoot, parsed.value.proposalId);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director trace proposal preview failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "replay") {
      const parsed = parseDirectorTraceProposalReplayArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await replayDirectorTraceProposal(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director trace proposal replay failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "knowledge") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "status") {
      const output = await describeDirectorKnowledgeStatus(workspaceRoot);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "list") {
      const output = await listDirectorKnowledgePacks(workspaceRoot);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "sync") {
      const parsed = parseDirectorKnowledgeCandidateSyncArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await syncDirectorKnowledgeCandidateFromProposal(
          workspaceRoot,
          parsed.value,
        );
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge candidate sync failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "learn") {
      const parsed = parseDirectorKnowledgeLearnArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await learnDirectorExperience(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director experience learn failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "experience-list") {
      const output = await listDirectorExperienceCandidates(workspaceRoot);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "experience-explain") {
      const parsed = parseDirectorExperienceExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await explainDirectorExperienceCandidate(
          workspaceRoot,
          parsed.value.candidateId,
        );
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director experience candidate explain failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "experience-accept" || subaction === "experience-reject") {
      const parsed = parseDirectorExperienceDecisionArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output =
          subaction === "experience-accept"
            ? await acceptDirectorExperienceCandidate(workspaceRoot, parsed.value)
            : await rejectDirectorExperienceCandidate(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge ${subaction} failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "experience-promote") {
      const parsed = parseDirectorExperienceDecisionArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await promoteDirectorExperienceCandidate(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director experience promote failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "experience-classify") {
      const parsed = parseDirectorExperienceTaxonomyArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await classifyDirectorExperienceCandidate(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director experience classify failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "experience-tag") {
      const parsed = parseDirectorExperienceTagArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await tagDirectorExperienceCandidate(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director experience tag failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "experience-from-trace-proposal") {
      const parsed = parseDirectorTraceProposalExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await createDirectorExperienceFromTraceProposal(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director trace experience failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "candidate-list") {
      const output = await listDirectorKnowledgeCandidates(workspaceRoot);
      process.stdout.write(`${output}\n`);
      return;
    }

    if (subaction === "candidate-explain") {
      const parsed = parseDirectorKnowledgeExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await explainDirectorKnowledgeCandidate(workspaceRoot, parsed.value.packId);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge candidate explain failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "diff") {
      const parsed = parseDirectorKnowledgeExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await diffDirectorKnowledgeCandidate(workspaceRoot, parsed.value.packId);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge candidate diff failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "explain") {
      const parsed = parseDirectorKnowledgeExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await explainDirectorKnowledgePack(workspaceRoot, parsed.value.packId);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge explain failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "publish") {
      const parsed = parseDirectorKnowledgePublishArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const packId = parsed.value.packId;
        if (parsed.value.proposalId !== undefined) {
          throw new Error(
            `knowledge publish no longer accepts --proposal-id. Run knowledge sync --proposal-id ${parsed.value.proposalId}, review/accept the candidate, then publish with --pack-id.`,
          );
        }
        const output =
          packId === undefined
            ? (() => {
                throw new Error("packId is required when publishing a knowledge candidate.");
              })()
            : await publishDirectorKnowledgeCandidate(workspaceRoot, {
                packId,
                ...(parsed.value.author === undefined ? {} : { author: parsed.value.author }),
                ...(parsed.value.note === undefined ? {} : { note: parsed.value.note }),
              });
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge publish failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "review") {
      const parsed = parseDirectorKnowledgeExplainArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await reviewDirectorKnowledgeCandidate(workspaceRoot, parsed.value.packId);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge review failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "accept" || subaction === "reject") {
      const parsed = parseDirectorKnowledgeDecisionArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output =
          subaction === "accept"
            ? await acceptDirectorKnowledgeCandidate(workspaceRoot, parsed.value)
            : await rejectDirectorKnowledgeCandidate(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge ${subaction} failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "rollback") {
      const parsed = parseDirectorKnowledgeRollbackArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await rollbackDirectorKnowledgePack(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge rollback failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "recall-preview") {
      const parsed = parseDirectorKnowledgeRecallArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }

      try {
        const output = await previewDirectorKnowledgeRecall(workspaceRoot, parsed.value);
        process.stdout.write(`${output}\n`);
      } catch (error) {
        process.stdout.write(`Director knowledge recall preview failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "run") {
    const [subaction, ...subactionArgs] = actionArgs;
    if (!subaction || subaction === "--help" || subaction === "-h") {
      process.stdout.write(`${renderDirectorUsage()}\n`);
      if (!subaction) {
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "create") {
      const parsed = parseDirectorInputArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      const inputPath = resolveWorkspacePath(workspaceRoot, parsed.value.input);
      try {
        const run = await submitDirectorRunCreate(
          inputPath,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run create failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "once") {
      const parsed = parseDirectorRunOnceArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const directorWorker = await directorWorkerModuleLoader();
        const workerId = parsed.value.workerId ?? "director-worker";
        const result = await directorWorker.runDirectorWorkerOnce(
          {
            runId: parsed.value.runId,
            workerId,
          },
          {
            env: {
              ...process.env,
              HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
              HOTFLOW_DATA_DIR: dataDir,
            },
          },
        );
        process.stdout.write(
          parsed.value.json
            ? renderDirectorRunOnceJsonResult(result, workerId)
            : renderDirectorRunOnceResult(result, workerId),
        );
      } catch (error) {
        process.stdout.write(`Director run once failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "status") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await fetchDirectorRunStatus(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run status failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "start") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunStart(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run start failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "pause") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunPause(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run pause failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "resume") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunResume(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run resume failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "abort") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunAbort(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run abort failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "retry") {
      const parsed = parseDirectorRunRetryArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunRetry(
          parsed.value.runId,
          parsed.value.assignmentId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run retry failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "approve") {
      const parsed = parseDirectorRunRetryArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunApprove(
          parsed.value.runId,
          parsed.value.assignmentId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run approve failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "reroute") {
      const parsed = parseDirectorRunRerouteArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const run = await submitDirectorRunReroute(
          parsed.value.runId,
          parsed.value.assignmentId,
          parsed.value.adapterId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunResponse(run));
      } catch (error) {
        process.stdout.write(`Director run reroute failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "report") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const report = await fetchDirectorRunReport(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunReport(report));
      } catch (error) {
        process.stdout.write(`Director run report failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "explain") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const report = await fetchDirectorRunReport(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunExplanation(report));
      } catch (error) {
        process.stdout.write(`Director run explain failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    if (subaction === "audit") {
      const parsed = parseDirectorRunStatusArgs(subactionArgs);
      if (!parsed.ok) {
        if (parsed.error) {
          process.stdout.write(`${parsed.error}\n`);
          process.exitCode = 1;
        }
        process.stdout.write(`${renderDirectorUsage()}\n`);
        return;
      }
      try {
        const report = await fetchDirectorRunReport(
          parsed.value.runId,
          parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
        );
        process.stdout.write(renderDirectorRunAudit(report));
      } catch (error) {
        process.stdout.write(`Director run audit failed: ${String(error)}\n`);
        process.exitCode = 1;
      }
      return;
    }

    process.stdout.write(`${renderDirectorUsage()}\n`);
    process.exitCode = 1;
    return;
  }

  if (action === "intake") {
    const parsed = parseDirectorInputArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    const snapshotPath = resolveWorkspacePath(workspaceRoot, parsed.value.input);
    try {
      const result = await submitDirectorIntake(
        snapshotPath,
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderDirectorIntakeResponse(result));
    } catch (error) {
      process.stdout.write(`Director intake failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "clarify") {
    const parsed = parseDirectorInputArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    const snapshotPath = resolveWorkspacePath(workspaceRoot, parsed.value.input);
    try {
      const result = await submitDirectorClarify(
        snapshotPath,
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderDirectorClarifyResponse(result));
    } catch (error) {
      process.stdout.write(`Director clarify failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "evaluate") {
    const parsed = parseDirectorInputArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    const snapshotPath = resolveWorkspacePath(workspaceRoot, parsed.value.input);
    try {
      const result = await evaluateSnapshotWithDirector(
        snapshotPath,
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderDirectorEvaluateResponse(result));
    } catch (error) {
      process.stdout.write(`Director evaluation failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "blueprint") {
    const parsed = parseDirectorInputArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    const snapshotPath = resolveWorkspacePath(workspaceRoot, parsed.value.input);
    try {
      const result = await submitDirectorBlueprint(
        snapshotPath,
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderDirectorBlueprintResponse(result));
    } catch (error) {
      process.stdout.write(`Director blueprint failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "outcome") {
    const parsed = parseDirectorInputArgs(actionArgs);
    if (!parsed.ok) {
      if (parsed.error) {
        process.stdout.write(`${parsed.error}\n`);
        process.exitCode = 1;
      }
      process.stdout.write(`${renderDirectorUsage()}\n`);
      return;
    }
    const outcomePath = resolveWorkspacePath(workspaceRoot, parsed.value.input);
    try {
      const result = await submitDirectorOutcome(
        outcomePath,
        parsed.value.hostUrl === undefined ? {} : { hostUrl: parsed.value.hostUrl },
      );
      process.stdout.write(renderDirectorOutcomeResponse(result));
    } catch (error) {
      process.stdout.write(`Director outcome failed: ${String(error)}\n`);
      process.exitCode = 1;
    }
    return;
  }

  process.stdout.write(`${renderDirectorUsage()}\n`);
  process.exitCode = 1;
}
