import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  ConversationRuntimeExternalArtifactRecord,
  ConversationRuntimeExternalArtifactStore,
  ConversationRuntimeExternalArtifactStoreWriteResult,
} from "./external-artifact-store.js";
import type {
  ExternalToolArtifact,
  ExternalToolInvokeRequest,
  ExternalToolInvokeResult,
  ExternalToolRegistry,
} from "./external-tools.js";
import { invokeExternalTool } from "./external-tools.js";
import type { MoyinWorkflowRunProductionPackageResult } from "./moyin-production-package.js";
import { collectMoyinWorkflowRunProductionPackage } from "./moyin-production-package.js";

const DEFAULT_MOYIN_TOOL_ID = "moyin.provider";
const DEFAULT_NO_PROGRESS_THRESHOLD = 3;
const DEFAULT_MOYIN_WORKFLOW_RUN_WATCH_HEARTBEAT_INTERVAL_MS = 30_000;
const WORKFLOW_RUN_PACKAGE_EVENT_STEP_ID = "workflow-run.package";

export type MoyinWorkflowRunAdvanceAction =
  | "build_request"
  | "build_sealed_request"
  | "execute"
  | "retry"
  | "skip"
  | (string & {});

export interface MoyinWorkflowRunStepState {
  readonly stepId: string;
  readonly status?: string;
  readonly action?: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly requiresApproval?: boolean;
  readonly retryable?: boolean;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly recoverable?: boolean;
  };
  readonly warnings?: readonly string[];
  readonly artifacts?: readonly unknown[];
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface MoyinWorkflowRunAdvanceHistoryEntry {
  readonly projectId?: string;
  readonly runId: string;
  readonly stepId: string;
  readonly action: string;
  readonly result: "blocked" | "failed" | "succeeded";
  readonly status?: string;
  readonly errorCode?: string;
  readonly error?: string;
}

export interface MoyinWorkflowRunAdvanceOrchestrationInput {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly action: MoyinWorkflowRunAdvanceAction;
  readonly file?: string;
  readonly execution?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly approval?: ExternalToolInvokeRequest["approval"];
  readonly sandboxPreflight?: ExternalToolInvokeRequest["sandboxPreflight"];
  readonly sandboxRuntimePolicy?: ExternalToolInvokeRequest["sandboxRuntimePolicy"];
  readonly sandboxPolicy?: ExternalToolInvokeRequest["sandboxPolicy"];
  readonly requestedNetworkPolicy?: ExternalToolInvokeRequest["requestedNetworkPolicy"];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly history?: readonly MoyinWorkflowRunAdvanceHistoryEntry[];
  readonly noProgressThreshold?: number;
}

export type MoyinWorkflowRunAdvanceOrchestrationStatus =
  | "advanced"
  | "approval-required"
  | "blocked"
  | "failed"
  | "post-read-failed"
  | "pre-read-failed";

export interface MoyinWorkflowRunAdvanceOrchestrationError {
  readonly code: string;
  readonly message: string;
  readonly stopReason?: string;
  readonly recoverable?: boolean;
}

export interface MoyinWorkflowRunAdvanceOrchestrationResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunAdvanceOrchestrationStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly action: string;
  readonly preAdvanceSteps: ExternalToolInvokeResult;
  readonly sealedPreflight?: ExternalToolInvokeResult;
  readonly advance?: ExternalToolInvokeResult;
  readonly postAdvanceSteps?: ExternalToolInvokeResult;
  readonly artifacts?: ExternalToolInvokeResult;
  readonly preAdvanceStep?: MoyinWorkflowRunStepState;
  readonly postAdvanceStep?: MoyinWorkflowRunStepState;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MoyinWorkflowRunExecuteAndPackageInput
  extends Omit<MoyinWorkflowRunAdvanceOrchestrationInput, "action">,
    MoyinWorkflowRunPackageArtifactOptions {
  readonly watchTask?: boolean;
  readonly collectPackage?: boolean;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly resumeToken?: string;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

interface MoyinWorkflowRunWatchPackageBaseInput extends MoyinWorkflowRunPackageArtifactOptions {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly resumeToken?: string;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

interface MoyinWorkflowRunPackageArtifactOptions {
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly handoffManifestDirectory?: string;
  readonly handoffManifestPath?: string;
}

interface MoyinWorkflowRunApprovalPacketArtifactOptions {
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly approvalPacketDirectory?: string;
  readonly approvalPacketPath?: string;
}

export interface MoyinWorkflowRunResumeAndPackageInput
  extends MoyinWorkflowRunWatchPackageBaseInput {
  readonly taskId: string;
  readonly sealedRequestId?: string;
  readonly collectPackage?: boolean;
}

export interface MoyinWorkflowRunCancelInput {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId?: string;
  readonly taskId?: string;
  readonly sealedRequestId?: string;
  readonly reason?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly approval?: ExternalToolInvokeRequest["approval"];
  readonly sandboxPreflight?: ExternalToolInvokeRequest["sandboxPreflight"];
  readonly sandboxRuntimePolicy?: ExternalToolInvokeRequest["sandboxRuntimePolicy"];
  readonly sandboxPolicy?: ExternalToolInvokeRequest["sandboxPolicy"];
  readonly requestedNetworkPolicy?: ExternalToolInvokeRequest["requestedNetworkPolicy"];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

export interface MoyinWorkflowRunExecuteAndPackageEvent {
  readonly kind:
    | "moyin.video_production.plan.completed"
    | "moyin.video_production.plan.started"
    | "moyin.workflow_run.approval_packet.created"
    | "moyin.workflow_run.cancel.completed"
    | "moyin.workflow_run.cancel.failed"
    | "moyin.workflow_run.cancel.started"
    | "moyin.workflow_run.create.completed"
    | "moyin.workflow_run.create.failed"
    | "moyin.workflow_run.create.started"
    | "moyin.workflow_run.execute.failed"
    | "moyin.workflow_run.execute.started"
    | "moyin.workflow_run.next_gate.completed"
    | "moyin.workflow_run.next_gate.failed"
    | "moyin.workflow_run.next_gate.started"
    | "moyin.workflow_run.package.completed"
    | "moyin.workflow_run.package.failed"
    | "moyin.workflow_run.package.started"
    | "moyin.workflow_run.resume.started"
    | "moyin.workflow_run.task_cancel.completed"
    | "moyin.workflow_run.task_cancel.failed"
    | "moyin.workflow_run.task_watch.completed"
    | "moyin.workflow_run.task_watch.failed"
    | "moyin.workflow_run.task_watch.heartbeat"
    | "moyin.workflow_run.task_watch.started"
    | "moyin.workflow_run.task_watch.timeout";
  readonly projectId: string;
  readonly runId?: string;
  readonly stepId: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly resumeToken?: string;
  readonly occurredAtMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type MoyinWorkflowRunExecuteAndPackageStatus =
  | "approval-required"
  | "blocked"
  | "execute-failed"
  | "executed"
  | "packaged"
  | "partial"
  | "watch-failed";

export interface MoyinWorkflowRunExecuteAndPackageResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunExecuteAndPackageStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly advance: MoyinWorkflowRunAdvanceOrchestrationResult;
  readonly watch?: ExternalToolInvokeResult;
  readonly package?: MoyinWorkflowRunProductionPackageResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type MoyinWorkflowRunResumeAndPackageStatus =
  | "packaged"
  | "partial"
  | "resumed"
  | "watch-failed";

export interface MoyinWorkflowRunResumeAndPackageResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunResumeAndPackageStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly sealedRequestId?: string;
  readonly taskId: string;
  readonly watch?: ExternalToolInvokeResult;
  readonly package?: MoyinWorkflowRunProductionPackageResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type MoyinWorkflowRunCancelStatus =
  | "approval-required"
  | "blocked"
  | "cancelled"
  | "pre-read-failed"
  | "task-cancel-failed"
  | "workflow-run-cancel-failed";

export interface MoyinWorkflowRunCancelResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunCancelStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId?: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly stepsResult: ExternalToolInvokeResult;
  readonly steps: readonly MoyinWorkflowRunStepState[];
  readonly taskCancel?: ExternalToolInvokeResult;
  readonly workflowRunCancel?: ExternalToolInvokeResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.cancel.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly taskCancelAttempted: boolean;
    readonly workflowRunCancelAttempted: boolean;
    readonly stoppedAt: string;
  };
}

export interface MoyinWorkflowRunNextActionPlanInput {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId: string;
  readonly runId: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly approvalPacketDirectory?: string;
  readonly approvalPacketPath?: string;
}

export type MoyinWorkflowRunNextActionPlanStatus =
  | "approval-required"
  | "blocked"
  | "completed"
  | "failed"
  | "ready-to-advance"
  | "resumable"
  | "waiting";

export type MoyinWorkflowRunNextActionKind =
  | "build_request"
  | "build_sealed_request"
  | "collect_package"
  | "execute"
  | "none"
  | "resume_watch"
  | "retry"
  | "wait";

export interface MoyinWorkflowRunNextActionPlanAction {
  readonly kind: MoyinWorkflowRunNextActionKind;
  readonly operationId?: "task.watch" | "workflow-run.advance" | "workflow-run.package";
  readonly advanceAction?: MoyinWorkflowRunAdvanceAction;
  readonly stepId?: string;
  readonly requiresApproval: boolean;
  readonly reason: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
}

export interface MoyinWorkflowRunNextActionPlanResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunNextActionPlanStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly stepsResult: ExternalToolInvokeResult;
  readonly steps: readonly MoyinWorkflowRunStepState[];
  readonly nextAction: MoyinWorkflowRunNextActionPlanAction;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.next-action-plan.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly stepCount: number;
  };
}

export interface MoyinWorkflowRunUntilNextGateInput
  extends MoyinWorkflowRunNextActionPlanInput,
    MoyinWorkflowRunPackageArtifactOptions {
  readonly createApprovalPacket?: boolean;
  readonly collectPackage?: boolean;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly resumeToken?: string;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

export type MoyinWorkflowRunUntilNextGateStatus =
  | "approval-required"
  | "blocked"
  | "failed"
  | "packaged"
  | "partial"
  | "resumed"
  | "waiting";

export interface MoyinWorkflowRunUntilNextGateResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunUntilNextGateStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly plan: MoyinWorkflowRunNextActionPlanResult;
  readonly effectiveNextAction: MoyinWorkflowRunNextActionPlanAction;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacketResult;
  readonly resume?: MoyinWorkflowRunResumeAndPackageResult;
  readonly package?: MoyinWorkflowRunProductionPackageResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.until-next-gate.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly resumeAttempted: boolean;
    readonly packageAttempted: boolean;
    readonly stoppedAt: string;
  };
}

export type MoyinWorkflowRunApprovalPacketStatus =
  | "approval-required"
  | "blocked"
  | "failed"
  | "not-required";

export interface MoyinWorkflowRunApprovalPacketNextInvocation {
  readonly packageScript:
    | "moyin:smoke:advance"
    | "moyin:smoke:continue-approved"
    | "moyin:smoke:execute-package";
  readonly env: Readonly<Record<string, string>>;
  readonly shellCommand: string;
}

export interface MoyinWorkflowRunApprovalPacket {
  readonly schemaVersion: "director.moyin.workflow-run.approval-packet.v1";
  readonly type: "approval_request";
  readonly providerId: "moyin";
  readonly operationId: "workflow-run.advance";
  readonly advanceAction: MoyinWorkflowRunAdvanceAction;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly sealedRequestId?: string;
  readonly approvalId?: string;
  readonly approvalExpiresAtMs?: number;
  readonly approvalSummary?: string;
  readonly approvalBinding?: {
    readonly turnId: string;
    readonly sessionKey: string;
  };
  readonly requiresApproval: true;
  readonly riskLevel: "high" | "medium";
  readonly resumeToken: string;
  readonly nextInvocation: MoyinWorkflowRunApprovalPacketNextInvocation;
  readonly mutation: {
    readonly advanceAttempted: false;
    readonly submitAttempted: false;
    readonly executeAttempted: false;
  };
}

export interface MoyinWorkflowRunApprovalPacketResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunApprovalPacketStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly plan: MoyinWorkflowRunNextActionPlanResult;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacket;
  readonly approvalPacketArtifact?: ExternalToolArtifact;
  readonly approvalPacketArtifactPersistence?: ConversationRuntimeExternalArtifactStoreWriteResult;
  readonly advancePreflight?: MoyinWorkflowRunAdvanceOrchestrationResult;
  readonly executePreflight?: MoyinWorkflowRunExecuteAndPackageResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.approval-packet-result.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly preflightAttempted: boolean;
  };
}

export interface MoyinWorkflowRunApprovedContinuationInput
  extends MoyinWorkflowRunPackageArtifactOptions,
    MoyinWorkflowRunApprovalPacketArtifactOptions {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly approvalPacket: MoyinWorkflowRunApprovalPacket;
  readonly approval?: ExternalToolInvokeRequest["approval"];
  readonly sandboxPreflight?: ExternalToolInvokeRequest["sandboxPreflight"];
  readonly sandboxRuntimePolicy?: ExternalToolInvokeRequest["sandboxRuntimePolicy"];
  readonly sandboxPolicy?: ExternalToolInvokeRequest["sandboxPolicy"];
  readonly requestedNetworkPolicy?: ExternalToolInvokeRequest["requestedNetworkPolicy"];
  readonly file?: string;
  readonly execution?: string;
  readonly collectPackage?: boolean;
  readonly watchTask?: boolean;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly nowMs?: () => number;
  readonly reissueExpiredApprovalPacket?: boolean;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

export type MoyinWorkflowRunApprovedContinuationStatus =
  | "advanced"
  | "approval-required"
  | "blocked"
  | "failed"
  | "packaged"
  | "partial"
  | "resumed"
  | "waiting";

export interface MoyinWorkflowRunApprovedContinuationResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunApprovedContinuationStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly action: MoyinWorkflowRunAdvanceAction;
  readonly approvalId?: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
  readonly advance?: MoyinWorkflowRunAdvanceOrchestrationResult;
  readonly execute?: MoyinWorkflowRunExecuteAndPackageResult;
  readonly nextGate?: MoyinWorkflowRunUntilNextGateResult;
  readonly nextApprovalPacket?: MoyinWorkflowRunApprovalPacketResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.approved-continuation.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: boolean;
    readonly executeAttempted: boolean;
    readonly nextGateAttempted: boolean;
    readonly nextApprovalPacketCreated: boolean;
    readonly packageAttempted: boolean;
    readonly approvalBindingTurnId?: string;
    readonly approvalBindingSessionKey?: string;
  };
}

export type MoyinWorkflowRunApprovalPacketArtifactReadStatus =
  | "found"
  | "invalid"
  | "missing"
  | "unreadable";

export interface MoyinWorkflowRunApprovalPacketArtifactReadResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunApprovalPacketArtifactReadStatus;
  readonly artifactId: string;
  readonly artifactRecord?: ConversationRuntimeExternalArtifactRecord;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacket;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.approval-packet-artifact-read.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly executeAttempted: false;
  };
}

export interface MoyinWorkflowRunApprovedContinuationFromArtifactInput
  extends Omit<MoyinWorkflowRunApprovedContinuationInput, "approvalPacket" | "artifactStore"> {
  readonly artifactStore: ConversationRuntimeExternalArtifactStore;
  readonly approvalPacketArtifactId: string;
}

export interface MoyinWorkflowRunApprovedContinuationFromArtifactResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunApprovedContinuationStatus | "blocked";
  readonly packetRead: MoyinWorkflowRunApprovalPacketArtifactReadResult;
  readonly continuation?: MoyinWorkflowRunApprovedContinuationResult;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
  readonly metadata: {
    readonly schemaVersion: "director.moyin.workflow-run.approved-continuation-from-artifact.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: boolean;
    readonly executeAttempted: boolean;
    readonly nextGateAttempted: boolean;
    readonly nextApprovalPacketCreated: boolean;
    readonly packageAttempted: boolean;
  };
}

export async function createMoyinWorkflowRunApprovalPacket(
  input: MoyinWorkflowRunNextActionPlanInput,
): Promise<MoyinWorkflowRunApprovalPacketResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const plan = await planMoyinWorkflowRunNextAction(input);
  if (!plan.ok) {
    return createMoyinWorkflowRunApprovalPacketResult(input, {
      status: plan.status === "blocked" ? "blocked" : "failed",
      plan,
      error: plan.error,
      preflightAttempted: false,
    });
  }
  if (!plan.nextAction.requiresApproval) {
    return createMoyinWorkflowRunApprovalPacketResult(input, {
      status: "not-required",
      plan,
      preflightAttempted: false,
    });
  }
  if (plan.nextAction.stepId === undefined || plan.nextAction.advanceAction === undefined) {
    return createMoyinWorkflowRunApprovalPacketResult(input, {
      status: "blocked",
      plan,
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_TARGET_MISSING",
        message: "Moyin workflow-run approval packet requires stepId and advanceAction.",
        stopReason: "approval-packet-target-missing",
        recoverable: true,
      },
      preflightAttempted: false,
    });
  }

  const turnId =
    input.turnId ??
    createMoyinWorkflowRunApprovalPacketTurnId(
      input.projectId,
      input.runId,
      plan.nextAction.stepId,
      plan.nextAction.advanceAction,
    );
  const sessionKey = input.sessionKey ?? "moyin:workflow-run:approval-packet";
  const baseMetadata = {
    ...(input.metadata ?? {}),
    orchestration: "moyin.workflow-run.approval-packet",
    orchestrationPhase: "approval-preflight",
    submitAttempted: false,
    advanceAttempted: false,
  };

  if (plan.nextAction.advanceAction === "execute") {
    const executePreflight = await orchestrateMoyinWorkflowRunExecuteAndPackage({
      registry: input.registry,
      toolId,
      projectId: input.projectId,
      runId: input.runId,
      stepId: plan.nextAction.stepId,
      turnId,
      sessionKey,
      collectPackage: false,
      watchTask: false,
      metadata: baseMetadata,
    });
    if (
      !executePreflight.ok &&
      isMoyinWorkflowRunSealedRequestRebuildableError(executePreflight.error)
    ) {
      return createMoyinWorkflowRunApprovalPacketResult(input, {
        status: "blocked",
        plan,
        executePreflight,
        error: createMoyinWorkflowRunSealedRequestRebuildUnsupportedError(executePreflight.error),
        preflightAttempted: true,
      });
    }
    return createMoyinWorkflowRunApprovalPacketFromPreflight(input, {
      plan,
      preflightAttempted: true,
      executePreflight,
      invokeResult: executePreflight.advance.advance,
      advanceAction: plan.nextAction.advanceAction,
      stepId: plan.nextAction.stepId,
      sealedRequestId: executePreflight.sealedRequestId ?? plan.nextAction.sealedRequestId,
    });
  }

  const advancePreflight = await orchestrateMoyinWorkflowRunAdvance({
    registry: input.registry,
    toolId,
    projectId: input.projectId,
    runId: input.runId,
    stepId: plan.nextAction.stepId,
    action: plan.nextAction.advanceAction,
    turnId,
    sessionKey,
    metadata: baseMetadata,
  });
  return createMoyinWorkflowRunApprovalPacketFromPreflight(input, {
    plan,
    preflightAttempted: true,
    advancePreflight,
    invokeResult: advancePreflight.advance,
    advanceAction: plan.nextAction.advanceAction,
    stepId: plan.nextAction.stepId,
    sealedRequestId:
      plan.nextAction.sealedRequestId ??
      advancePreflight.preAdvanceStep?.sealedRequestId ??
      advancePreflight.postAdvanceStep?.sealedRequestId,
  });
}

function isMoyinWorkflowRunSealedRequestRebuildableError(
  error: MoyinWorkflowRunAdvanceOrchestrationError | undefined,
): error is MoyinWorkflowRunAdvanceOrchestrationError {
  return (
    error?.stopReason === "sealed-request-read-failed" ||
    error?.code === "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_EXPIRED" ||
    error?.code === "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_READ_FAILED" ||
    error?.code === "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_UNREADABLE"
  );
}

function createMoyinWorkflowRunSealedRequestRebuildUnsupportedError(
  error: MoyinWorkflowRunAdvanceOrchestrationError,
): MoyinWorkflowRunAdvanceOrchestrationError {
  return {
    code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_REBUILD_UNSUPPORTED",
    message: `Moyin sealed request cannot be executed (${error.stopReason ?? error.code}), and the current workflow-run contract does not support rebuilding a sealed request from approval_required state. Create a fresh workflow run or recover the failed step in Moyin before continuing.`,
    stopReason: "approval-required-sealed-request-rebuild-unsupported",
    recoverable: true,
  };
}

async function createMoyinWorkflowRunExpiredApprovalReissuePacket(
  input: MoyinWorkflowRunApprovedContinuationInput,
  toolId: string,
  orchestrationPhase: string,
): Promise<MoyinWorkflowRunApprovalPacketResult> {
  const packet = input.approvalPacket;
  const reissueTurnId = input.turnId ?? packet.approvalBinding?.turnId;
  const reissueSessionKey = input.sessionKey ?? packet.approvalBinding?.sessionKey;
  return createMoyinWorkflowRunApprovalPacket({
    registry: input.registry,
    toolId,
    projectId: packet.projectId,
    runId: packet.runId,
    ...(reissueTurnId === undefined ? {} : { turnId: reissueTurnId }),
    ...(reissueSessionKey === undefined ? {} : { sessionKey: reissueSessionKey }),
    ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
    ...(input.approvalPacketDirectory === undefined
      ? {}
      : { approvalPacketDirectory: input.approvalPacketDirectory }),
    ...(input.approvalPacketPath === undefined
      ? {}
      : { approvalPacketPath: input.approvalPacketPath }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.approved-continuation",
      orchestrationPhase,
      previousApprovalId: packet.approvalId,
      previousResumeToken: packet.resumeToken,
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
}

function isMoyinWorkflowRunExternalApprovalExpiredError(
  error: MoyinWorkflowRunAdvanceOrchestrationError | undefined,
): boolean {
  return (
    error?.code === "external-tool-approval-ledger-expired" ||
    error?.code === "external-tool-approval-ledger-approval-not-found"
  );
}

export async function orchestrateMoyinWorkflowRunContinueApproved(
  input: MoyinWorkflowRunApprovedContinuationInput,
): Promise<MoyinWorkflowRunApprovedContinuationResult> {
  const packet = input.approvalPacket;
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const validationError = validateMoyinWorkflowRunApprovedContinuationInput(input);
  if (validationError !== undefined) {
    const nextApprovalPacket =
      input.reissueExpiredApprovalPacket === true &&
      validationError.error.code === "MOYIN_WORKFLOW_RUN_APPROVAL_EXPIRED"
        ? await createMoyinWorkflowRunExpiredApprovalReissuePacket(
            input,
            toolId,
            "expired-approval-reissue",
          )
        : undefined;
    return createMoyinWorkflowRunApprovedContinuationResult(input, {
      status: nextApprovalPacket?.ok === true ? "approval-required" : validationError.status,
      error: validationError.error,
      nextApprovalPacket,
      advanceAttempted: false,
      executeAttempted: false,
      nextGateAttempted: false,
      nextApprovalPacketCreated: nextApprovalPacket?.ok === true,
      packageAttempted: false,
    });
  }

  const binding = resolveMoyinWorkflowRunApprovalBinding(input);
  const metadata = {
    ...(input.metadata ?? {}),
    orchestration: "moyin.workflow-run.approved-continuation",
    approvalId: packet.approvalId,
    resumeToken: packet.resumeToken,
    submitAttempted: false,
    approvalBindingTurnId: binding.turnId,
    approvalBindingSessionKey: binding.sessionKey,
  };

  if (packet.advanceAction === "execute") {
    const execute = await orchestrateMoyinWorkflowRunExecuteAndPackage({
      registry: input.registry,
      toolId,
      projectId: packet.projectId,
      runId: packet.runId,
      stepId: packet.stepId,
      ...(input.execution === undefined ? {} : { execution: input.execution }),
      turnId: binding.turnId,
      sessionKey: binding.sessionKey,
      approval: input.approval,
      ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
      ...(input.sandboxRuntimePolicy === undefined
        ? {}
        : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
      ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
      ...(input.requestedNetworkPolicy === undefined
        ? {}
        : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
      ...(input.collectPackage === undefined ? {} : { collectPackage: input.collectPackage }),
      ...(input.watchTask === undefined ? {} : { watchTask: input.watchTask }),
      ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
      ...(input.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
      resumeToken: packet.resumeToken,
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      ...createMoyinWorkflowRunPackageArtifactOptions(input),
      metadata: {
        ...metadata,
        orchestrationPhase: "execute-package",
      },
    });
    if (!execute.ok) {
      const nextApprovalPacket =
        input.reissueExpiredApprovalPacket === true &&
        isMoyinWorkflowRunExternalApprovalExpiredError(execute.error)
          ? await createMoyinWorkflowRunExpiredApprovalReissuePacket(
              input,
              toolId,
              "ledger-expired-approval-reissue",
            )
          : undefined;
      if (nextApprovalPacket !== undefined) {
        return createMoyinWorkflowRunApprovedContinuationResult(input, {
          status: nextApprovalPacket.ok ? "approval-required" : "failed",
          execute,
          nextApprovalPacket,
          error: execute.error,
          sealedRequestId: execute.sealedRequestId,
          taskId: execute.taskId,
          advanceAttempted: false,
          executeAttempted: false,
          nextGateAttempted: false,
          nextApprovalPacketCreated: nextApprovalPacket.ok,
          packageAttempted: execute.package !== undefined,
        });
      }
      return createMoyinWorkflowRunApprovedContinuationResult(input, {
        status: normalizeMoyinWorkflowRunApprovedContinuationStatus(execute.status),
        execute,
        error: execute.error,
        sealedRequestId: execute.sealedRequestId,
        taskId: execute.taskId,
        advanceAttempted: true,
        executeAttempted: true,
        nextGateAttempted: false,
        nextApprovalPacketCreated: false,
        packageAttempted: execute.package !== undefined,
      });
    }

    const nextGate = await orchestrateMoyinWorkflowRunUntilNextGate({
      registry: input.registry,
      toolId,
      projectId: packet.projectId,
      runId: packet.runId,
      turnId: binding.turnId,
      sessionKey: binding.sessionKey,
      ...(input.collectPackage === undefined ? {} : { collectPackage: input.collectPackage }),
      ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
      ...(input.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
      resumeToken: packet.resumeToken,
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      ...createMoyinWorkflowRunPackageArtifactOptions(input),
      metadata: {
        ...metadata,
        orchestrationPhase: "post-execute-until-next-gate",
      },
    });
    const nextApprovalPacket =
      nextGate.status === "approval-required"
        ? await createMoyinWorkflowRunApprovalPacket({
            registry: input.registry,
            toolId,
            projectId: packet.projectId,
            runId: packet.runId,
            ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
            ...(input.approvalPacketDirectory === undefined
              ? {}
              : { approvalPacketDirectory: input.approvalPacketDirectory }),
            ...(input.approvalPacketPath === undefined
              ? {}
              : { approvalPacketPath: input.approvalPacketPath }),
            metadata: {
              ...metadata,
              orchestrationPhase: "post-execute-next-approval-packet",
            },
          })
        : undefined;
    return createMoyinWorkflowRunApprovedContinuationResult(input, {
      status: normalizeMoyinWorkflowRunApprovedContinuationStatus(nextGate.status),
      execute,
      nextGate,
      nextApprovalPacket,
      error:
        nextApprovalPacket !== undefined && !nextApprovalPacket.ok
          ? nextApprovalPacket.error
          : (nextGate.error ?? execute.error),
      sealedRequestId:
        nextApprovalPacket?.approvalPacket?.sealedRequestId ??
        nextGate.plan.nextAction.sealedRequestId ??
        execute.sealedRequestId,
      taskId: nextGate.plan.nextAction.taskId ?? execute.taskId,
      advanceAttempted: true,
      executeAttempted: true,
      nextGateAttempted: true,
      nextApprovalPacketCreated: nextApprovalPacket?.ok === true,
      packageAttempted:
        execute.package !== undefined ||
        nextGate.package !== undefined ||
        nextGate.resume?.package !== undefined,
    });
  }

  const advance = await orchestrateMoyinWorkflowRunAdvance({
    registry: input.registry,
    toolId,
    projectId: packet.projectId,
    runId: packet.runId,
    stepId: packet.stepId,
    action: packet.advanceAction,
    ...(input.file === undefined ? {} : { file: input.file }),
    ...(input.execution === undefined ? {} : { execution: input.execution }),
    turnId: binding.turnId,
    sessionKey: binding.sessionKey,
    approval: input.approval,
    ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
    ...(input.sandboxRuntimePolicy === undefined
      ? {}
      : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
    ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
    ...(input.requestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
    metadata: {
      ...metadata,
      orchestrationPhase: "advance",
    },
  });

  if (!advance.ok) {
    const nextApprovalPacket =
      input.reissueExpiredApprovalPacket === true &&
      isMoyinWorkflowRunExternalApprovalExpiredError(advance.error)
        ? await createMoyinWorkflowRunExpiredApprovalReissuePacket(
            input,
            toolId,
            "ledger-expired-approval-reissue",
          )
        : undefined;
    if (nextApprovalPacket !== undefined) {
      return createMoyinWorkflowRunApprovedContinuationResult(input, {
        status: nextApprovalPacket.ok ? "approval-required" : "failed",
        advance,
        nextApprovalPacket,
        error: advance.error,
        sealedRequestId:
          advance.postAdvanceStep?.sealedRequestId ?? advance.preAdvanceStep?.sealedRequestId,
        taskId: advance.postAdvanceStep?.taskId ?? advance.preAdvanceStep?.taskId,
        advanceAttempted: false,
        executeAttempted: false,
        nextGateAttempted: false,
        nextApprovalPacketCreated: nextApprovalPacket.ok,
        packageAttempted: false,
      });
    }
    return createMoyinWorkflowRunApprovedContinuationResult(input, {
      status: normalizeMoyinWorkflowRunApprovedContinuationStatus(advance.status),
      advance,
      error: advance.error,
      sealedRequestId:
        advance.postAdvanceStep?.sealedRequestId ?? advance.preAdvanceStep?.sealedRequestId,
      taskId: advance.postAdvanceStep?.taskId ?? advance.preAdvanceStep?.taskId,
      advanceAttempted: true,
      executeAttempted: false,
      nextGateAttempted: false,
      nextApprovalPacketCreated: false,
      packageAttempted: false,
    });
  }

  const nextGate = await orchestrateMoyinWorkflowRunUntilNextGate({
    registry: input.registry,
    toolId,
    projectId: packet.projectId,
    runId: packet.runId,
    turnId: binding.turnId,
    sessionKey: binding.sessionKey,
    ...(input.collectPackage === undefined ? {} : { collectPackage: input.collectPackage }),
    ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
    ...(input.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
    resumeToken: packet.resumeToken,
    ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    ...createMoyinWorkflowRunPackageArtifactOptions(input),
    metadata: {
      ...metadata,
      orchestrationPhase: "until-next-gate",
    },
  });
  const nextApprovalPacket =
    nextGate.status === "approval-required"
      ? await createMoyinWorkflowRunApprovalPacket({
          registry: input.registry,
          toolId,
          projectId: packet.projectId,
          runId: packet.runId,
          ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
          ...(input.approvalPacketDirectory === undefined
            ? {}
            : { approvalPacketDirectory: input.approvalPacketDirectory }),
          ...(input.approvalPacketPath === undefined
            ? {}
            : { approvalPacketPath: input.approvalPacketPath }),
          metadata: {
            ...metadata,
            orchestrationPhase: "next-approval-packet",
          },
        })
      : undefined;

  return createMoyinWorkflowRunApprovedContinuationResult(input, {
    status: normalizeMoyinWorkflowRunApprovedContinuationStatus(nextGate.status),
    advance,
    nextGate,
    nextApprovalPacket,
    error:
      nextApprovalPacket !== undefined && !nextApprovalPacket.ok
        ? nextApprovalPacket.error
        : nextGate.error,
    sealedRequestId:
      nextApprovalPacket?.approvalPacket?.sealedRequestId ??
      nextGate.plan.nextAction.sealedRequestId ??
      advance.postAdvanceStep?.sealedRequestId ??
      advance.preAdvanceStep?.sealedRequestId,
    taskId:
      nextGate.plan.nextAction.taskId ??
      advance.postAdvanceStep?.taskId ??
      advance.preAdvanceStep?.taskId,
    advanceAttempted: true,
    executeAttempted: false,
    nextGateAttempted: true,
    nextApprovalPacketCreated: nextApprovalPacket?.ok === true,
    packageAttempted: nextGate.package !== undefined || nextGate.resume?.package !== undefined,
  });
}

export function readMoyinWorkflowRunApprovalPacketFromArtifact(input: {
  readonly artifactStore: ConversationRuntimeExternalArtifactStore;
  readonly approvalPacketArtifactId: string;
}): MoyinWorkflowRunApprovalPacketArtifactReadResult {
  const artifactId = input.approvalPacketArtifactId;
  const artifactRecord = input.artifactStore.readArtifact(artifactId);
  if (artifactRecord === undefined) {
    return createMoyinWorkflowRunApprovalPacketArtifactReadResult({
      artifactId,
      status: "missing",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_ARTIFACT_MISSING",
        message: "Moyin workflow-run approval packet artifact was not found.",
        stopReason: "approval-packet-artifact-missing",
        recoverable: true,
      },
    });
  }

  if (
    artifactRecord.providerId !== "moyin" ||
    artifactRecord.operationId !== "workflow-run.approval-packet" ||
    artifactRecord.localPath === undefined
  ) {
    return createMoyinWorkflowRunApprovalPacketArtifactReadResult({
      artifactId,
      artifactRecord,
      status: "invalid",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_ARTIFACT_INVALID",
        message: "Moyin workflow-run approval packet artifact record is not resumable.",
        stopReason: "approval-packet-artifact-invalid",
        recoverable: true,
      },
    });
  }

  if (!existsSync(artifactRecord.localPath)) {
    return createMoyinWorkflowRunApprovalPacketArtifactReadResult({
      artifactId,
      artifactRecord,
      status: "unreadable",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_FILE_MISSING",
        message: "Moyin workflow-run approval packet file is missing.",
        stopReason: "approval-packet-file-missing",
        recoverable: true,
      },
    });
  }

  try {
    const parsed = JSON.parse(readFileSync(artifactRecord.localPath, "utf8")) as unknown;
    const approvalPacket = readMoyinWorkflowRunApprovalPacket(parsed);
    if (approvalPacket === undefined) {
      return createMoyinWorkflowRunApprovalPacketArtifactReadResult({
        artifactId,
        artifactRecord,
        status: "invalid",
        error: {
          code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_FILE_INVALID",
          message: "Moyin workflow-run approval packet file did not contain a valid packet.",
          stopReason: "approval-packet-file-invalid",
          recoverable: true,
        },
      });
    }
    return createMoyinWorkflowRunApprovalPacketArtifactReadResult({
      artifactId,
      artifactRecord,
      approvalPacket,
      status: "found",
    });
  } catch (error) {
    return createMoyinWorkflowRunApprovalPacketArtifactReadResult({
      artifactId,
      artifactRecord,
      status: "unreadable",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_FILE_UNREADABLE",
        message: `Moyin workflow-run approval packet file could not be read: ${toErrorMessage(error)}.`,
        stopReason: "approval-packet-file-unreadable",
        recoverable: true,
      },
    });
  }
}

export async function orchestrateMoyinWorkflowRunContinueApprovedFromArtifact(
  input: MoyinWorkflowRunApprovedContinuationFromArtifactInput,
): Promise<MoyinWorkflowRunApprovedContinuationFromArtifactResult> {
  const packetRead = readMoyinWorkflowRunApprovalPacketFromArtifact(input);
  if (!packetRead.ok || packetRead.approvalPacket === undefined) {
    return createMoyinWorkflowRunApprovedContinuationFromArtifactResult({
      packetRead,
      status: "blocked",
      error: packetRead.error,
    });
  }

  const continuation = await orchestrateMoyinWorkflowRunContinueApproved({
    ...input,
    artifactStore: input.artifactStore,
    approvalPacket: packetRead.approvalPacket,
  });
  return createMoyinWorkflowRunApprovedContinuationFromArtifactResult({
    packetRead,
    continuation,
    status: continuation.status,
    error: continuation.error,
  });
}

export async function planMoyinWorkflowRunNextAction(
  input: MoyinWorkflowRunNextActionPlanInput,
): Promise<MoyinWorkflowRunNextActionPlanResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const stepsResult = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "workflow-run.steps",
    args: {
      projectId: input.projectId,
      runId: input.runId,
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.next-action-plan",
      orchestrationPhase: "steps-read",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const steps = readMoyinWorkflowRunStepsFromInvokeResult(stepsResult);
  if (!stepsResult.ok) {
    return createMoyinWorkflowRunNextActionPlanResult(input, {
      status: "failed",
      stepsResult,
      steps,
      nextAction: {
        kind: "none",
        requiresApproval: false,
        reason: "workflow-run.steps failed; no write operation was attempted.",
      },
      error: {
        code: stepsResult.error ?? "MOYIN_WORKFLOW_RUN_STEPS_READ_FAILED",
        message: stepsResult.content,
        recoverable: true,
      },
    });
  }
  return createMoyinWorkflowRunNextActionPlanResult(input, {
    ...selectMoyinWorkflowRunNextAction(steps),
    stepsResult,
    steps,
  });
}

export async function orchestrateMoyinWorkflowRunUntilNextGate(
  input: MoyinWorkflowRunUntilNextGateInput,
): Promise<MoyinWorkflowRunUntilNextGateResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const plan = await planMoyinWorkflowRunNextAction(input);

  if (!plan.ok) {
    return createMoyinWorkflowRunUntilNextGateResult(input, {
      status: plan.status === "blocked" ? "blocked" : "failed",
      plan,
      error: plan.error,
      metadata: {
        stoppedAt: "next-action-plan",
        resumeAttempted: false,
        packageAttempted: false,
      },
    });
  }

  if (plan.nextAction.requiresApproval) {
    const approvalPacket =
      input.createApprovalPacket === true
        ? await createMoyinWorkflowRunApprovalPacket({
            registry: input.registry,
            toolId,
            projectId: input.projectId,
            runId: input.runId,
            ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
            ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
            ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
            ...(input.approvalPacketDirectory === undefined
              ? {}
              : { approvalPacketDirectory: input.approvalPacketDirectory }),
            ...(input.approvalPacketPath === undefined
              ? {}
              : { approvalPacketPath: input.approvalPacketPath }),
            metadata: {
              ...(input.metadata ?? {}),
              orchestration: "moyin.workflow-run.until-next-gate",
              orchestrationPhase: "approval-packet-preflight",
              submitAttempted: false,
              advanceAttempted: false,
            },
          })
        : undefined;
    const approvalPacketError =
      approvalPacket !== undefined && !approvalPacket.ok
        ? {
            code: approvalPacket.error?.code ?? "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_FAILED",
            message: approvalPacket.error?.message ?? "Moyin workflow-run approval packet failed.",
            stopReason: approvalPacket.error?.stopReason ?? "approval-packet-preflight-failed",
            recoverable: true,
          }
        : undefined;
    return createMoyinWorkflowRunUntilNextGateResult(input, {
      status: approvalPacketError === undefined ? "approval-required" : "blocked",
      plan,
      approvalPacket,
      error: approvalPacketError,
      metadata: {
        stoppedAt:
          approvalPacketError === undefined ? "approval-gate" : "approval-packet-preflight",
        resumeAttempted: false,
        packageAttempted: false,
      },
    });
  }

  if (plan.nextAction.kind === "collect_package") {
    const packageEventInput = {
      ...input,
      stepId: WORKFLOW_RUN_PACKAGE_EVENT_STEP_ID,
    };
    emitMoyinWorkflowRunExecuteEvent(packageEventInput, {
      kind: "moyin.workflow_run.package.started",
      metadata: {
        source: "until-next-gate",
        stepCount: plan.steps.length,
      },
    });
    const productionPackage = await collectMoyinWorkflowRunProductionPackage({
      registry: input.registry,
      toolId,
      projectId: input.projectId,
      runId: input.runId,
      ...createMoyinWorkflowRunPackageArtifactOptions(input),
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
      metadata: {
        ...(input.metadata ?? {}),
        orchestration: "moyin.workflow-run.until-next-gate",
        orchestrationPhase: "collect-package",
      },
    });
    emitMoyinWorkflowRunExecuteEvent(packageEventInput, {
      kind: productionPackage.ok
        ? "moyin.workflow_run.package.completed"
        : "moyin.workflow_run.package.failed",
      metadata: {
        source: "until-next-gate",
        status: productionPackage.status,
        artifactCount: productionPackage.artifacts.length,
        stepCount: productionPackage.stepStates.length,
      },
    });
    return createMoyinWorkflowRunUntilNextGateResult(input, {
      status: productionPackage.status === "packaged" ? "packaged" : "partial",
      plan,
      productionPackage,
      ...(productionPackage.ok
        ? {}
        : {
            error: {
              code: productionPackage.error?.code ?? "MOYIN_WORKFLOW_RUN_PACKAGE_FAILED",
              message:
                productionPackage.error?.message ?? "Moyin workflow-run package collection failed.",
              stopReason: "package-failed",
              recoverable: true,
            },
          }),
      metadata: {
        stoppedAt: "package",
        resumeAttempted: false,
        packageAttempted: true,
      },
    });
  }

  if (plan.nextAction.kind === "resume_watch") {
    if (plan.nextAction.stepId === undefined || plan.nextAction.taskId === undefined) {
      return createMoyinWorkflowRunUntilNextGateResult(input, {
        status: "blocked",
        plan,
        error: {
          code: "MOYIN_WORKFLOW_RUN_RESUME_TARGET_MISSING",
          message: "Moyin workflow-run resume requires both stepId and taskId.",
          stopReason: "resume-target-missing",
          recoverable: true,
        },
        metadata: {
          stoppedAt: "resume-preflight",
          resumeAttempted: false,
          packageAttempted: false,
        },
      });
    }
    const resume = await orchestrateMoyinWorkflowRunResumeAndPackage({
      registry: input.registry,
      toolId,
      projectId: input.projectId,
      runId: input.runId,
      stepId: plan.nextAction.stepId,
      taskId: plan.nextAction.taskId,
      ...(plan.nextAction.sealedRequestId === undefined
        ? {}
        : { sealedRequestId: plan.nextAction.sealedRequestId }),
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
      ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
      ...(input.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
      ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
      ...(input.collectPackage === undefined ? {} : { collectPackage: input.collectPackage }),
      ...createMoyinWorkflowRunPackageArtifactOptions(input),
      metadata: {
        ...(input.metadata ?? {}),
        orchestration: "moyin.workflow-run.until-next-gate",
        orchestrationPhase: "resume-watch",
      },
    });
    return createMoyinWorkflowRunUntilNextGateResult(input, {
      status: resume.ok ? (resume.status === "watch-failed" ? "failed" : resume.status) : "failed",
      plan,
      resume,
      error: resume.error,
      metadata: {
        stoppedAt: "resume-watch",
        resumeAttempted: true,
        packageAttempted: input.collectPackage !== false,
      },
    });
  }

  return createMoyinWorkflowRunUntilNextGateResult(input, {
    status: plan.status === "blocked" ? "blocked" : "waiting",
    plan,
    error: plan.error,
    metadata: {
      stoppedAt: plan.nextAction.kind,
      resumeAttempted: false,
      packageAttempted: false,
    },
  });
}

function createMoyinWorkflowRunPackageArtifactOptions(
  input: MoyinWorkflowRunPackageArtifactOptions,
): MoyinWorkflowRunPackageArtifactOptions {
  return {
    ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
    ...(input.handoffManifestDirectory === undefined
      ? {}
      : { handoffManifestDirectory: input.handoffManifestDirectory }),
    ...(input.handoffManifestPath === undefined
      ? {}
      : { handoffManifestPath: input.handoffManifestPath }),
  };
}

export async function orchestrateMoyinWorkflowRunExecuteAndPackage(
  input: MoyinWorkflowRunExecuteAndPackageInput,
): Promise<MoyinWorkflowRunExecuteAndPackageResult> {
  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: "moyin.workflow_run.execute.started",
    metadata: {
      watchTask: input.watchTask !== false,
      collectPackage: input.collectPackage !== false,
    },
  });
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const advance = await orchestrateMoyinWorkflowRunAdvance({
    ...input,
    action: "execute",
  });
  const sealedRequestId =
    advance.postAdvanceStep?.sealedRequestId ??
    advance.preAdvanceStep?.sealedRequestId ??
    readMoyinTaskFieldFromInvokeResult(advance.advance, "sealedRequestId");
  const taskId =
    advance.postAdvanceStep?.taskId ??
    readMoyinTaskFieldFromInvokeResult(advance.advance, "taskId");

  if (!advance.ok) {
    emitMoyinWorkflowRunExecuteEvent(input, {
      kind: "moyin.workflow_run.execute.failed",
      ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
      ...(taskId === undefined ? {} : { taskId }),
      metadata: {
        status: advance.status,
        ...(advance.error === undefined ? {} : { errorCode: advance.error.code }),
      },
    });
    return createMoyinWorkflowRunExecuteAndPackageResult(input, {
      status:
        advance.status === "approval-required"
          ? "approval-required"
          : advance.status === "blocked"
            ? "blocked"
            : "execute-failed",
      advance,
      sealedRequestId,
      taskId,
      error: advance.error,
      metadata: {
        taskWatchCompleted: false,
        packageCollected: false,
      },
    });
  }

  if (input.watchTask === false) {
    return createMoyinWorkflowRunExecuteAndPackageResult(input, {
      status: "executed",
      advance,
      sealedRequestId,
      taskId,
      metadata: {
        taskWatchCompleted: false,
        packageCollected: false,
        watchSkipped: true,
      },
    });
  }

  if (taskId === undefined) {
    return createMoyinWorkflowRunExecuteAndPackageResult(input, {
      status: "partial",
      advance,
      sealedRequestId,
      error: {
        code: "MOYIN_WORKFLOW_RUN_EXECUTE_TASK_ID_MISSING",
        message: "Moyin workflow-run execute succeeded but did not return a taskId to watch.",
        stopReason: "execute-task-id-missing",
        recoverable: true,
      },
      metadata: {
        taskWatchCompleted: false,
        packageCollected: false,
      },
    });
  }

  const watch = await invokeMoyinWorkflowRunTaskWatchWithLifecycle(input, toolId, {
    sealedRequestId,
    taskId,
  });
  if (!watch.ok) {
    return createMoyinWorkflowRunExecuteAndPackageResult(input, {
      status: "watch-failed",
      advance,
      sealedRequestId,
      taskId,
      watch,
      error: {
        code: watch.error ?? "MOYIN_WORKFLOW_RUN_TASK_WATCH_FAILED",
        message: watch.content,
        stopReason:
          watch.error === "MOYIN_TASK_WATCH_TIMEOUT" ? "task-watch-timeout" : "task-watch-failed",
        recoverable: true,
      },
      metadata: {
        taskWatchCompleted: false,
        packageCollected: false,
        ...createMoyinWorkflowRunWatchMetadata(input, watch),
      },
    });
  }

  if (input.collectPackage === false) {
    return createMoyinWorkflowRunExecuteAndPackageResult(input, {
      status: "executed",
      advance,
      sealedRequestId,
      taskId,
      watch,
      metadata: {
        taskWatchCompleted: true,
        packageCollected: false,
        packageSkipped: true,
        ...createMoyinWorkflowRunWatchMetadata(input, watch),
      },
    });
  }

  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: "moyin.workflow_run.package.started",
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    taskId,
  });
  const productionPackage = await collectMoyinWorkflowRunProductionPackage({
    registry: input.registry,
    toolId,
    projectId: input.projectId,
    runId: input.runId,
    ...createMoyinWorkflowRunPackageArtifactOptions(input),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.execute-package",
      orchestrationPhase: "package-after-watch",
      stepId: input.stepId,
      ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
      taskId,
    },
  });
  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: productionPackage.ok
      ? "moyin.workflow_run.package.completed"
      : "moyin.workflow_run.package.failed",
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    taskId,
    metadata: {
      status: productionPackage.status,
      artifactCount: productionPackage.artifacts.length,
    },
  });
  return createMoyinWorkflowRunExecuteAndPackageResult(input, {
    status: productionPackage.status === "packaged" ? "packaged" : "partial",
    advance,
    sealedRequestId,
    taskId,
    watch,
    productionPackage,
    ...(productionPackage.ok
      ? {}
      : {
          error: {
            code: productionPackage.error?.code ?? "MOYIN_WORKFLOW_RUN_PACKAGE_FAILED",
            message: productionPackage.error?.message ?? "Moyin workflow-run package failed.",
            stopReason: "package-failed",
            recoverable: true,
          },
        }),
    metadata: {
      taskWatchCompleted: true,
      packageCollected: productionPackage.ok,
      ...createMoyinWorkflowRunWatchMetadata(input, watch),
    },
  });
}

export async function orchestrateMoyinWorkflowRunResumeAndPackage(
  input: MoyinWorkflowRunResumeAndPackageInput,
): Promise<MoyinWorkflowRunResumeAndPackageResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: "moyin.workflow_run.resume.started",
    ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
    taskId: input.taskId,
    ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
    metadata: {
      collectPackage: input.collectPackage !== false,
    },
  });

  const watch = await invokeMoyinWorkflowRunTaskWatchWithLifecycle(input, toolId, {
    sealedRequestId: input.sealedRequestId,
    taskId: input.taskId,
  });
  if (!watch.ok) {
    return createMoyinWorkflowRunResumeAndPackageResult(input, {
      status: "watch-failed",
      watch,
      error: {
        code: watch.error ?? "MOYIN_WORKFLOW_RUN_TASK_RESUME_WATCH_FAILED",
        message: watch.content,
        stopReason:
          watch.error === "MOYIN_TASK_WATCH_TIMEOUT"
            ? "resume-task-watch-timeout"
            : "resume-task-watch-failed",
        recoverable: true,
      },
      metadata: {
        resumed: true,
        taskWatchCompleted: false,
        packageCollected: false,
        ...createMoyinWorkflowRunWatchMetadata(input, watch),
      },
    });
  }

  if (input.collectPackage === false) {
    return createMoyinWorkflowRunResumeAndPackageResult(input, {
      status: "resumed",
      watch,
      metadata: {
        resumed: true,
        taskWatchCompleted: true,
        packageCollected: false,
        packageSkipped: true,
        ...createMoyinWorkflowRunWatchMetadata(input, watch),
      },
    });
  }

  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: "moyin.workflow_run.package.started",
    ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
    taskId: input.taskId,
  });
  const productionPackage = await collectMoyinWorkflowRunProductionPackage({
    registry: input.registry,
    toolId,
    projectId: input.projectId,
    runId: input.runId,
    ...createMoyinWorkflowRunPackageArtifactOptions(input),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.resume-package",
      orchestrationPhase: "package-after-resume-watch",
      stepId: input.stepId,
      ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
      taskId: input.taskId,
    },
  });
  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: productionPackage.ok
      ? "moyin.workflow_run.package.completed"
      : "moyin.workflow_run.package.failed",
    ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
    taskId: input.taskId,
    metadata: {
      status: productionPackage.status,
      artifactCount: productionPackage.artifacts.length,
    },
  });

  return createMoyinWorkflowRunResumeAndPackageResult(input, {
    status: productionPackage.status === "packaged" ? "packaged" : "partial",
    watch,
    productionPackage,
    ...(productionPackage.ok
      ? {}
      : {
          error: {
            code: productionPackage.error?.code ?? "MOYIN_WORKFLOW_RUN_RESUME_PACKAGE_FAILED",
            message:
              productionPackage.error?.message ?? "Moyin workflow-run resume package failed.",
            stopReason: "resume-package-failed",
            recoverable: true,
          },
        }),
    metadata: {
      resumed: true,
      taskWatchCompleted: true,
      packageCollected: productionPackage.ok,
      ...createMoyinWorkflowRunWatchMetadata(input, watch),
    },
  });
}

export async function orchestrateMoyinWorkflowRunCancel(
  input: MoyinWorkflowRunCancelInput,
): Promise<MoyinWorkflowRunCancelResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const stepsResult = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "workflow-run.steps",
    args: {
      projectId: input.projectId,
      runId: input.runId,
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.cancel",
      orchestrationPhase: "pre-cancel-steps-read",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const steps = readMoyinWorkflowRunStepsFromInvokeResult(stepsResult);
  if (!stepsResult.ok) {
    return createMoyinWorkflowRunCancelResult(input, {
      status: "pre-read-failed",
      stepsResult,
      steps,
      error: {
        code: stepsResult.error ?? "MOYIN_WORKFLOW_RUN_CANCEL_STEPS_READ_FAILED",
        message: stepsResult.content,
        stopReason: "cancel-steps-read-failed",
        recoverable: true,
      },
      stoppedAt: "pre-cancel-steps-read",
    });
  }

  const target = selectMoyinWorkflowRunCancelTarget(input, steps);
  if (target === undefined) {
    return createMoyinWorkflowRunCancelResult(input, {
      status: "blocked",
      stepsResult,
      steps,
      error: {
        code: "MOYIN_WORKFLOW_RUN_CANCEL_TARGET_MISSING",
        message:
          "Moyin workflow-run cancellation requires an active run, a non-terminal step, or an explicit taskId.",
        stopReason: "cancel-target-missing",
        recoverable: true,
      },
      stoppedAt: "cancel-target-selection",
    });
  }

  emitMoyinWorkflowRunCancelEvent(input, target, {
    kind: "moyin.workflow_run.cancel.started",
    metadata: {
      reason: readString(input.reason) ?? "operator-requested",
      hasTaskCancel: target.taskId !== undefined,
    },
  });

  const taskCancel =
    target.taskId === undefined
      ? undefined
      : await invokeMoyinWorkflowRunCancelOperation(input, toolId, {
          operationId: "task.cancel",
          args: {
            projectId: input.projectId,
            taskId: target.taskId,
          },
          target,
          orchestrationPhase: "task-cancel",
        });

  if (taskCancel !== undefined) {
    emitMoyinWorkflowRunCancelEvent(input, target, {
      kind: taskCancel.ok
        ? "moyin.workflow_run.task_cancel.completed"
        : "moyin.workflow_run.task_cancel.failed",
      ...(target.taskId === undefined ? {} : { taskId: target.taskId }),
      metadata: {
        status: taskCancel.status,
        ...(taskCancel.error === undefined ? {} : { error: taskCancel.error }),
      },
    });
    if (!taskCancel.ok) {
      return createMoyinWorkflowRunCancelResult(input, {
        status:
          taskCancel.status === "approval-required" ? "approval-required" : "task-cancel-failed",
        stepsResult,
        steps,
        target,
        taskCancel,
        error: {
          code: taskCancel.error ?? "MOYIN_WORKFLOW_RUN_TASK_CANCEL_FAILED",
          message: taskCancel.content,
          stopReason:
            taskCancel.status === "approval-required"
              ? "task-cancel-approval-required"
              : "task-cancel-failed",
          recoverable: taskCancel.status !== "permission-denied",
        },
        stoppedAt: "task-cancel",
      });
    }
  }

  const workflowRunCancel = await invokeMoyinWorkflowRunCancelOperation(input, toolId, {
    operationId: "workflow-run.cancel",
    args: {
      projectId: input.projectId,
      runId: input.runId,
    },
    target,
    orchestrationPhase: "workflow-run-cancel",
  });

  emitMoyinWorkflowRunCancelEvent(input, target, {
    kind: workflowRunCancel.ok
      ? "moyin.workflow_run.cancel.completed"
      : "moyin.workflow_run.cancel.failed",
    metadata: {
      status: workflowRunCancel.status,
      ...(workflowRunCancel.error === undefined ? {} : { error: workflowRunCancel.error }),
    },
  });

  if (!workflowRunCancel.ok) {
    return createMoyinWorkflowRunCancelResult(input, {
      status:
        workflowRunCancel.status === "approval-required"
          ? "approval-required"
          : "workflow-run-cancel-failed",
      stepsResult,
      steps,
      target,
      taskCancel,
      workflowRunCancel,
      error: {
        code: workflowRunCancel.error ?? "MOYIN_WORKFLOW_RUN_CANCEL_FAILED",
        message: workflowRunCancel.content,
        stopReason:
          workflowRunCancel.status === "approval-required"
            ? "workflow-run-cancel-approval-required"
            : "workflow-run-cancel-failed",
        recoverable: workflowRunCancel.status !== "permission-denied",
      },
      stoppedAt: "workflow-run-cancel",
    });
  }

  return createMoyinWorkflowRunCancelResult(input, {
    status: "cancelled",
    stepsResult,
    steps,
    target,
    taskCancel,
    workflowRunCancel,
    stoppedAt: "cancelled",
  });
}

export async function orchestrateMoyinWorkflowRunAdvance(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
): Promise<MoyinWorkflowRunAdvanceOrchestrationResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const preAdvanceSteps = await invokeMoyinWorkflowRunSteps(input, toolId, "pre-advance");
  const preAdvanceStep = findMoyinWorkflowRunStep(preAdvanceSteps, input.stepId);
  if (!preAdvanceSteps.ok) {
    return createMoyinWorkflowRunOrchestratorResult(input, {
      status: "pre-read-failed",
      preAdvanceSteps,
      error: {
        code: preAdvanceSteps.error ?? "MOYIN_WORKFLOW_RUN_STEPS_READ_FAILED",
        message: preAdvanceSteps.content,
        recoverable: true,
      },
    });
  }

  const sequenceBlock = createMoyinWorkflowRunSequenceBlock(input, preAdvanceStep);
  if (sequenceBlock !== undefined) {
    return createMoyinWorkflowRunOrchestratorResult(input, {
      status: "blocked",
      preAdvanceSteps,
      preAdvanceStep,
      error: sequenceBlock,
    });
  }

  const noProgressBlock = createMoyinWorkflowRunNoProgressBlock(input);
  if (noProgressBlock !== undefined) {
    return createMoyinWorkflowRunOrchestratorResult(input, {
      status: "blocked",
      preAdvanceSteps,
      preAdvanceStep,
      error: noProgressBlock.error,
      metadata: noProgressBlock.metadata,
    });
  }

  const sealedPreflight = await readMoyinWorkflowRunExecuteSealedPreflight(
    input,
    toolId,
    preAdvanceStep,
  );
  if (sealedPreflight?.error !== undefined) {
    return createMoyinWorkflowRunOrchestratorResult(input, {
      status: "blocked",
      preAdvanceSteps,
      sealedPreflight: sealedPreflight.sealedPreflight,
      preAdvanceStep,
      error: sealedPreflight.error,
      metadata: sealedPreflight.metadata,
    });
  }

  const advance = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "workflow-run.advance",
    args: createMoyinWorkflowRunAdvanceArgs(input),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
    ...(input.sandboxRuntimePolicy === undefined
      ? {}
      : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
    ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
    ...(input.requestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestrationPhase: "advance",
      preAdvanceStepStatus: preAdvanceStep?.status,
    },
  });

  if (!advance.ok) {
    return createMoyinWorkflowRunOrchestratorResult(input, {
      status: advance.status === "approval-required" ? "approval-required" : "failed",
      preAdvanceSteps,
      sealedPreflight: sealedPreflight?.sealedPreflight,
      advance,
      preAdvanceStep,
      error: {
        code: advance.error ?? "MOYIN_WORKFLOW_RUN_ADVANCE_FAILED",
        message: advance.content,
        recoverable: advance.status !== "permission-denied",
      },
    });
  }

  const postAdvanceSteps = await invokeMoyinWorkflowRunSteps(input, toolId, "post-advance");
  const postAdvanceStep = findMoyinWorkflowRunStep(postAdvanceSteps, input.stepId);
  if (!postAdvanceSteps.ok) {
    return createMoyinWorkflowRunOrchestratorResult(input, {
      status: "post-read-failed",
      preAdvanceSteps,
      sealedPreflight: sealedPreflight?.sealedPreflight,
      advance,
      postAdvanceSteps,
      preAdvanceStep,
      error: {
        code: postAdvanceSteps.error ?? "MOYIN_WORKFLOW_RUN_POST_STEPS_READ_FAILED",
        message: postAdvanceSteps.content,
        recoverable: true,
      },
      metadata: {
        rereadStepsAfterAdvance: false,
      },
    });
  }
  const artifactRecovery =
    postAdvanceStep?.status === "completed"
      ? await readMoyinWorkflowRunArtifactsWithBackfill(input, toolId, postAdvanceStep)
      : undefined;

  return createMoyinWorkflowRunOrchestratorResult(input, {
    status: "advanced",
    preAdvanceSteps,
    sealedPreflight: sealedPreflight?.sealedPreflight,
    advance,
    postAdvanceSteps,
    artifacts: artifactRecovery?.artifacts,
    preAdvanceStep,
    postAdvanceStep,
    metadata: {
      rereadStepsAfterAdvance: true,
      ...(artifactRecovery === undefined
        ? {}
        : {
            artifactsReadAfterCompleted: artifactRecovery.artifacts.ok,
            ...artifactRecovery.metadata,
          }),
    },
  });
}

async function invokeMoyinWorkflowRunSteps(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
  toolId: string,
  orchestrationPhase: "pre-advance" | "post-advance",
): Promise<ExternalToolInvokeResult> {
  return invokeExternalTool(input.registry, {
    toolId,
    operationId: "workflow-run.steps",
    args: {
      projectId: input.projectId,
      runId: input.runId,
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestrationPhase,
    },
  });
}

async function readMoyinWorkflowRunExecuteSealedPreflight(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
  toolId: string,
  step: MoyinWorkflowRunStepState | undefined,
): Promise<
  | {
      readonly sealedPreflight: ExternalToolInvokeResult;
      readonly error?: MoyinWorkflowRunAdvanceOrchestrationError;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined
> {
  if (input.action !== "execute" || step?.sealedRequestId === undefined) {
    return undefined;
  }
  const sealedRequestId = step.sealedRequestId;
  const checkedAtMs = Date.now();
  const sealedPreflight = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "sealed.get",
    args: { sealedRequestId },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestrationPhase: "sealed-preflight",
      projectId: input.projectId,
      runId: input.runId,
      stepId: input.stepId,
      sealedRequestId,
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const metadataBase = {
    sealedRequestCheckedAtMs: checkedAtMs,
    sealedRequestId,
  };
  if (!sealedPreflight.ok) {
    return {
      sealedPreflight,
      error: {
        code: sealedPreflight.error ?? "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_READ_FAILED",
        message: sealedPreflight.content,
        stopReason: "sealed-request-read-failed",
        recoverable: true,
      },
      metadata: {
        ...metadataBase,
        sealedRequestPreflightOk: false,
      },
    };
  }

  const sealed = readMoyinSealedRequestFromInvokeResult(sealedPreflight);
  if (sealed === undefined) {
    return {
      sealedPreflight,
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_UNREADABLE",
        message: "Moyin sealed request preflight succeeded but did not return a readable request.",
        stopReason: "sealed-request-unreadable",
        recoverable: true,
      },
      metadata: {
        ...metadataBase,
        sealedRequestPreflightOk: true,
      },
    };
  }

  const returnedSealedRequestId = readString(sealed.sealedRequestId) ?? readString(sealed.id);
  const sealedRequestStatus = readString(sealed.status);
  const sealedRequestExpiresAt = readString(sealed.expiresAt);
  const sealedRequestExpiresAtMs =
    sealedRequestExpiresAt === undefined ? undefined : Date.parse(sealedRequestExpiresAt);
  const metadata = {
    ...metadataBase,
    sealedRequestPreflightOk: true,
    ...(returnedSealedRequestId === undefined
      ? {}
      : { sealedRequestReturnedId: returnedSealedRequestId }),
    ...(sealedRequestStatus === undefined ? {} : { sealedRequestStatus }),
    ...(sealedRequestExpiresAt === undefined ? {} : { sealedRequestExpiresAt }),
    ...(sealedRequestExpiresAtMs === undefined || !Number.isFinite(sealedRequestExpiresAtMs)
      ? {}
      : { sealedRequestExpiresAtMs }),
  };

  if (returnedSealedRequestId !== undefined && returnedSealedRequestId !== sealedRequestId) {
    return {
      sealedPreflight,
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_MISMATCH",
        message: "Moyin sealed request preflight returned a different sealedRequestId.",
        stopReason: "sealed-request-mismatch",
        recoverable: true,
      },
      metadata,
    };
  }
  if (sealedRequestStatus !== undefined && sealedRequestStatus !== "sealed") {
    return {
      sealedPreflight,
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_NOT_SEALED",
        message: `Moyin sealed request is not executable because its status is ${sealedRequestStatus}.`,
        stopReason: "sealed-request-not-sealed",
        recoverable: true,
      },
      metadata,
    };
  }
  if (
    sealedRequestExpiresAt !== undefined &&
    (sealedRequestExpiresAtMs === undefined || !Number.isFinite(sealedRequestExpiresAtMs))
  ) {
    return {
      sealedPreflight,
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_EXPIRY_UNREADABLE",
        message: "Moyin sealed request expiration could not be parsed.",
        stopReason: "sealed-request-expiry-unreadable",
        recoverable: true,
      },
      metadata,
    };
  }
  if (sealedRequestExpiresAtMs !== undefined && sealedRequestExpiresAtMs <= checkedAtMs) {
    return {
      sealedPreflight,
      error: {
        code: "MOYIN_WORKFLOW_RUN_SEALED_REQUEST_EXPIRED",
        message: "Moyin sealed request has expired and must be rebuilt before execute.",
        stopReason: "sealed-request-expired",
        recoverable: true,
      },
      metadata,
    };
  }

  return { sealedPreflight, metadata };
}

async function readMoyinWorkflowRunArtifacts(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
  toolId: string,
): Promise<ExternalToolInvokeResult> {
  return invokeExternalTool(input.registry, {
    toolId,
    operationId: "workflow-run.artifacts",
    args: {
      projectId: input.projectId,
      runId: input.runId,
      stepId: input.stepId,
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestrationPhase: "post-completed-artifacts",
    },
  });
}

async function readMoyinWorkflowRunArtifactsWithBackfill(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
  toolId: string,
  step: MoyinWorkflowRunStepState,
): Promise<{
  readonly artifacts: ExternalToolInvokeResult;
  readonly metadata: Readonly<Record<string, unknown>>;
}> {
  const listed = await readMoyinWorkflowRunArtifacts(input, toolId);
  const initialArtifactCount = readExternalToolArtifactCount(listed);
  if (!listed.ok || initialArtifactCount !== 0 || step.taskId === undefined) {
    return {
      artifacts: listed,
      metadata: {
        ...(initialArtifactCount === undefined
          ? {}
          : { initialArtifactCountAfterCompleted: initialArtifactCount }),
        artifactBackfillAttemptedAfterCompleted: false,
      },
    };
  }

  const backfilled = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "artifact.backfill",
    args: {
      projectId: input.projectId,
      taskId: step.taskId,
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestrationPhase: "post-completed-artifact-backfill",
      runId: input.runId,
      stepId: input.stepId,
    },
  });
  const recoveredArtifactCount = readExternalToolArtifactCount(backfilled);
  return {
    artifacts: backfilled,
    metadata: {
      initialArtifactCountAfterCompleted: initialArtifactCount,
      artifactBackfillAttemptedAfterCompleted: true,
      artifactsBackfilledAfterCompleted: backfilled.ok && (recoveredArtifactCount ?? 0) > 0,
      ...(recoveredArtifactCount === undefined
        ? {}
        : { recoveredArtifactCountAfterCompleted: recoveredArtifactCount }),
    },
  };
}

async function invokeMoyinWorkflowRunTaskWatchWithLifecycle(
  input: MoyinWorkflowRunWatchPackageBaseInput,
  toolId: string,
  task: {
    readonly sealedRequestId?: string | undefined;
    readonly taskId: string;
  },
): Promise<ExternalToolInvokeResult> {
  const heartbeatIntervalMs = normalizeMoyinWorkflowRunWatchHeartbeatIntervalMs(
    input.heartbeatIntervalMs,
  );
  const watchTimeoutMs = normalizePositiveInteger(input.watchTimeoutMs);
  emitMoyinWorkflowRunExecuteEvent(input, {
    kind: "moyin.workflow_run.task_watch.started",
    ...(task.sealedRequestId === undefined ? {} : { sealedRequestId: task.sealedRequestId }),
    taskId: task.taskId,
    ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
    metadata: {
      heartbeatIntervalMs,
      ...(watchTimeoutMs === undefined ? {} : { watchTimeoutMs }),
    },
  });

  const watchPromise = invokeExternalTool(input.registry, {
    toolId,
    operationId: "task.watch",
    args: {
      projectId: input.projectId,
      taskId: task.taskId,
      ...(watchTimeoutMs === undefined ? {} : { timeoutMs: watchTimeoutMs }),
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.execute-package",
      orchestrationPhase: "task-watch",
      runId: input.runId,
      stepId: input.stepId,
      ...(task.sealedRequestId === undefined ? {} : { sealedRequestId: task.sealedRequestId }),
      taskId: task.taskId,
      ...createMoyinWorkflowRunWatchMetadata(input),
    },
  });
  void watchPromise.catch(() => undefined);

  const heartbeat = setInterval(() => {
    emitMoyinWorkflowRunExecuteEvent(input, {
      kind: "moyin.workflow_run.task_watch.heartbeat",
      ...(task.sealedRequestId === undefined ? {} : { sealedRequestId: task.sealedRequestId }),
      taskId: task.taskId,
      ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
      metadata: {
        heartbeatIntervalMs,
        ...(watchTimeoutMs === undefined ? {} : { watchTimeoutMs }),
      },
    });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    const watch =
      watchTimeoutMs === undefined
        ? await watchPromise
        : await Promise.race([
            watchPromise,
            createMoyinWorkflowRunTaskWatchTimeoutResult({
              input,
              toolId,
              taskId: task.taskId,
              timeoutMs: watchTimeoutMs,
            }),
          ]);
    emitMoyinWorkflowRunExecuteEvent(input, {
      kind:
        watch.error === "MOYIN_TASK_WATCH_TIMEOUT"
          ? "moyin.workflow_run.task_watch.timeout"
          : watch.ok
            ? "moyin.workflow_run.task_watch.completed"
            : "moyin.workflow_run.task_watch.failed",
      ...(task.sealedRequestId === undefined ? {} : { sealedRequestId: task.sealedRequestId }),
      taskId: task.taskId,
      ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
      metadata: {
        status: watch.status,
        ...(watch.error === undefined ? {} : { error: watch.error }),
      },
    });
    return watch;
  } finally {
    clearInterval(heartbeat);
  }
}

function createMoyinWorkflowRunTaskWatchTimeoutResult(input: {
  readonly input: MoyinWorkflowRunWatchPackageBaseInput;
  readonly toolId: string;
  readonly taskId: string;
  readonly timeoutMs: number;
}): Promise<ExternalToolInvokeResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: false,
        status: "error",
        toolId: input.toolId,
        operationId: "task.watch",
        content: `Moyin workflow-run task watch timed out after ${input.timeoutMs}ms.`,
        error: "MOYIN_TASK_WATCH_TIMEOUT",
        trace: [
          {
            stage: "moyin.workflow-run.watch.timeout",
            detail: "Moyin workflow-run task watch exceeded the orchestration timeout.",
            metadata: {
              projectId: input.input.projectId,
              runId: input.input.runId,
              stepId: input.input.stepId,
              taskId: input.taskId,
              timeoutMs: input.timeoutMs,
              ...(input.input.resumeToken === undefined
                ? {}
                : { resumeToken: input.input.resumeToken }),
            },
          },
        ],
        metadata: {
          timeoutMs: input.timeoutMs,
          ...(input.input.resumeToken === undefined
            ? {}
            : { resumeToken: input.input.resumeToken }),
        },
      });
    }, input.timeoutMs);
  });
}

function createMoyinWorkflowRunExecuteAndPackageResult(
  input: MoyinWorkflowRunExecuteAndPackageInput,
  result: {
    readonly status: MoyinWorkflowRunExecuteAndPackageStatus;
    readonly advance: MoyinWorkflowRunAdvanceOrchestrationResult;
    readonly sealedRequestId?: string | undefined;
    readonly taskId?: string | undefined;
    readonly watch?: ExternalToolInvokeResult | undefined;
    readonly productionPackage?: MoyinWorkflowRunProductionPackageResult | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
): MoyinWorkflowRunExecuteAndPackageResult {
  return {
    ok: result.status === "executed" || result.status === "packaged" || result.status === "partial",
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    ...(result.sealedRequestId === undefined ? {} : { sealedRequestId: result.sealedRequestId }),
    ...(result.taskId === undefined ? {} : { taskId: result.taskId }),
    advance: result.advance,
    ...(result.watch === undefined ? {} : { watch: result.watch }),
    ...(result.productionPackage === undefined ? {} : { package: result.productionPackage }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.execute-package.v1",
      ...(result.metadata ?? {}),
    },
  };
}

function createMoyinWorkflowRunResumeAndPackageResult(
  input: MoyinWorkflowRunResumeAndPackageInput,
  result: {
    readonly status: MoyinWorkflowRunResumeAndPackageStatus;
    readonly watch?: ExternalToolInvokeResult | undefined;
    readonly productionPackage?: MoyinWorkflowRunProductionPackageResult | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
): MoyinWorkflowRunResumeAndPackageResult {
  return {
    ok: result.status === "resumed" || result.status === "packaged" || result.status === "partial",
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    ...(input.sealedRequestId === undefined ? {} : { sealedRequestId: input.sealedRequestId }),
    taskId: input.taskId,
    ...(result.watch === undefined ? {} : { watch: result.watch }),
    ...(result.productionPackage === undefined ? {} : { package: result.productionPackage }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.resume-package.v1",
      ...(result.metadata ?? {}),
    },
  };
}

interface MoyinWorkflowRunCancelTarget {
  readonly stepId?: string;
  readonly sealedRequestId?: string;
  readonly taskId?: string;
}

function createMoyinWorkflowRunCancelResult(
  input: MoyinWorkflowRunCancelInput,
  result: {
    readonly status: MoyinWorkflowRunCancelStatus;
    readonly stepsResult: ExternalToolInvokeResult;
    readonly steps: readonly MoyinWorkflowRunStepState[];
    readonly target?: MoyinWorkflowRunCancelTarget | undefined;
    readonly taskCancel?: ExternalToolInvokeResult | undefined;
    readonly workflowRunCancel?: ExternalToolInvokeResult | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly stoppedAt: string;
  },
): MoyinWorkflowRunCancelResult {
  const taskCancelAttempted = isMoyinCancelMutationAttempted(result.taskCancel);
  const workflowRunCancelAttempted = isMoyinCancelMutationAttempted(result.workflowRunCancel);
  return {
    ok: result.status === "cancelled",
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    ...(result.target?.stepId === undefined ? {} : { stepId: result.target.stepId }),
    ...(result.target?.sealedRequestId === undefined
      ? {}
      : { sealedRequestId: result.target.sealedRequestId }),
    ...(result.target?.taskId === undefined ? {} : { taskId: result.target.taskId }),
    stepsResult: result.stepsResult,
    steps: result.steps,
    ...(result.taskCancel === undefined ? {} : { taskCancel: result.taskCancel }),
    ...(result.workflowRunCancel === undefined
      ? {}
      : { workflowRunCancel: result.workflowRunCancel }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.cancel.v1",
      submitAttempted: false,
      advanceAttempted: false,
      taskCancelAttempted,
      workflowRunCancelAttempted,
      stoppedAt: result.stoppedAt,
    },
  };
}

function isMoyinCancelMutationAttempted(result: ExternalToolInvokeResult | undefined): boolean {
  return (
    result !== undefined &&
    result.status !== "approval-required" &&
    result.status !== "permission-denied"
  );
}

async function invokeMoyinWorkflowRunCancelOperation(
  input: MoyinWorkflowRunCancelInput,
  toolId: string,
  options: {
    readonly operationId: "task.cancel" | "workflow-run.cancel";
    readonly args: Readonly<Record<string, unknown>>;
    readonly target: MoyinWorkflowRunCancelTarget;
    readonly orchestrationPhase: string;
  },
): Promise<ExternalToolInvokeResult> {
  return invokeExternalTool(input.registry, {
    toolId,
    operationId: options.operationId,
    args: options.args,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(input.approval === undefined ? {} : { approval: input.approval }),
    ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
    ...(input.sandboxRuntimePolicy === undefined
      ? {}
      : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
    ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
    ...(input.requestedNetworkPolicy === undefined
      ? {}
      : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.workflow-run.cancel",
      orchestrationPhase: options.orchestrationPhase,
      runId: input.runId,
      ...(options.target.stepId === undefined ? {} : { stepId: options.target.stepId }),
      ...(options.target.sealedRequestId === undefined
        ? {}
        : { sealedRequestId: options.target.sealedRequestId }),
      ...(options.target.taskId === undefined ? {} : { taskId: options.target.taskId }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
}

function emitMoyinWorkflowRunCancelEvent(
  input: MoyinWorkflowRunCancelInput,
  target: MoyinWorkflowRunCancelTarget,
  event: Omit<
    MoyinWorkflowRunExecuteAndPackageEvent,
    "occurredAtMs" | "projectId" | "runId" | "stepId"
  >,
): void {
  input.onEvent?.({
    ...event,
    projectId: input.projectId,
    runId: input.runId,
    stepId: target.stepId ?? "workflow-run.cancel",
    ...(target.sealedRequestId === undefined ? {} : { sealedRequestId: target.sealedRequestId }),
    occurredAtMs: Date.now(),
  });
}

function selectMoyinWorkflowRunCancelTarget(
  input: MoyinWorkflowRunCancelInput,
  steps: readonly MoyinWorkflowRunStepState[],
): MoyinWorkflowRunCancelTarget | undefined {
  const explicitStep =
    input.stepId === undefined ? undefined : steps.find((step) => step.stepId === input.stepId);
  const running = steps.find((step) => isMoyinStepStatus(step, "running"));
  const nonTerminal = steps.find((step) => !isMoyinWorkflowRunCancelTerminalStep(step));
  const step = explicitStep ?? running ?? nonTerminal;
  const stepId = input.stepId ?? step?.stepId;
  const taskId = input.taskId ?? step?.taskId;
  const sealedRequestId = input.sealedRequestId ?? step?.sealedRequestId;
  if (stepId === undefined && taskId === undefined) {
    return undefined;
  }
  if (
    step !== undefined &&
    isMoyinWorkflowRunCancelTerminalStep(step) &&
    input.taskId === undefined
  ) {
    return undefined;
  }
  return {
    ...(stepId === undefined ? {} : { stepId }),
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    ...(taskId === undefined ? {} : { taskId }),
  };
}

function isMoyinWorkflowRunCancelTerminalStep(step: MoyinWorkflowRunStepState): boolean {
  return (
    isMoyinStepStatus(step, "completed") ||
    isMoyinStepStatus(step, "cancelled") ||
    isMoyinStepStatus(step, "skipped")
  );
}

function emitMoyinWorkflowRunExecuteEvent(
  input: MoyinWorkflowRunWatchPackageBaseInput,
  event: Omit<
    MoyinWorkflowRunExecuteAndPackageEvent,
    "occurredAtMs" | "projectId" | "runId" | "stepId"
  >,
): void {
  input.onEvent?.({
    ...event,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    occurredAtMs: Date.now(),
  });
}

function createMoyinWorkflowRunWatchMetadata(
  input: MoyinWorkflowRunWatchPackageBaseInput,
  result?: ExternalToolInvokeResult,
): Readonly<Record<string, unknown>> {
  return {
    heartbeatIntervalMs: normalizeMoyinWorkflowRunWatchHeartbeatIntervalMs(
      input.heartbeatIntervalMs,
    ),
    ...(input.watchTimeoutMs === undefined
      ? {}
      : { watchTimeoutMs: normalizePositiveInteger(input.watchTimeoutMs) }),
    ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
    ...(result?.error === "MOYIN_TASK_WATCH_TIMEOUT" ? { watchTimedOut: true } : {}),
  };
}

function normalizeMoyinWorkflowRunWatchHeartbeatIntervalMs(value: number | undefined): number {
  const normalized = normalizePositiveInteger(value);
  return normalized === undefined
    ? DEFAULT_MOYIN_WORKFLOW_RUN_WATCH_HEARTBEAT_INTERVAL_MS
    : Math.min(normalized, DEFAULT_MOYIN_WORKFLOW_RUN_WATCH_HEARTBEAT_INTERVAL_MS);
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function readMoyinTaskFieldFromInvokeResult(
  result: ExternalToolInvokeResult | undefined,
  field: "sealedRequestId" | "taskId",
): string | undefined {
  const output = readRecord(result?.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(nestedOutput?.payload ?? output?.payload);
  const step = readRecord(nestedOutput?.step ?? payload?.step ?? payload?.currentStep);
  const task = readRecord(nestedOutput?.task ?? payload?.task);
  return (
    readString(nestedOutput?.[field]) ??
    readString(payload?.[field]) ??
    readString(step?.[field]) ??
    readString(task?.[field])
  );
}

function readMoyinSealedRequestFromInvokeResult(
  result: ExternalToolInvokeResult,
): Readonly<Record<string, unknown>> | undefined {
  const output = readRecord(result.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(nestedOutput?.payload ?? output?.payload);
  const candidates = [
    readRecord(nestedOutput?.sealedRequest),
    readRecord(payload?.sealedRequest),
    readRecord(output?.sealedRequest),
    nestedOutput,
    payload,
    output,
  ];
  return candidates.find((candidate) => isMoyinSealedRequestRecord(candidate));
}

function isMoyinSealedRequestRecord(
  value: Readonly<Record<string, unknown>> | undefined,
): value is Readonly<Record<string, unknown>> {
  if (value === undefined) {
    return false;
  }
  return (
    readString(value.sealedRequestId) !== undefined ||
    readString(value.id) !== undefined ||
    readString(value.status) !== undefined ||
    readString(value.expiresAt) !== undefined
  );
}

function createMoyinWorkflowRunAdvanceArgs(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
): Readonly<Record<string, unknown>> {
  return {
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    action: input.action,
    ...(input.action === "execute" ? { confirmSubmit: "SUBMIT" } : {}),
    ...(input.file === undefined ? {} : { file: input.file }),
    ...(input.execution === undefined ? {} : { execution: input.execution }),
  };
}

function createMoyinWorkflowRunSequenceBlock(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
  step: MoyinWorkflowRunStepState | undefined,
): MoyinWorkflowRunAdvanceOrchestrationError | undefined {
  if (step === undefined) {
    return {
      code: "MOYIN_WORKFLOW_RUN_STEP_NOT_FOUND",
      message: `Moyin workflow run step ${input.stepId} was not found.`,
      stopReason: "step-not-found",
      recoverable: true,
    };
  }
  if (step.status === "failed" && input.action !== "retry" && input.action !== "skip") {
    return {
      code: "MOYIN_WORKFLOW_RUN_FAILED_STEP_REQUIRES_RETRY",
      message: "Failed Moyin workflow-run steps must use retry or skip before other actions.",
      stopReason: "failed-step-action",
      recoverable: true,
    };
  }
  if (input.action === "execute") {
    const readyNonGatedStep = step.status === "ready" && step.requiresApproval === false;
    const sealedApprovalStep =
      step.status === "approval_required" && step.sealedRequestId !== undefined;
    if (!readyNonGatedStep && !sealedApprovalStep) {
      return {
        code: "MOYIN_WORKFLOW_RUN_EXECUTE_NOT_READY",
        message:
          "Moyin workflow-run execute requires either a ready non-approval step or an approval_required sealed step with a sealedRequestId.",
        stopReason: "execute-before-approval-required",
        recoverable: true,
      };
    }
  }
  if (input.action === "retry" && step.status !== "failed") {
    return {
      code: "MOYIN_WORKFLOW_RUN_RETRY_NOT_FAILED",
      message: "Moyin workflow-run retry is only allowed when the target step is failed.",
      stopReason: "retry-before-failed",
      recoverable: true,
    };
  }
  if (
    input.action === "build_sealed_request" &&
    step.status !== undefined &&
    step.status !== "ready"
  ) {
    return {
      code: "MOYIN_WORKFLOW_RUN_BUILD_SEALED_REQUEST_NOT_READY",
      message: "Moyin workflow-run build_sealed_request is only allowed from ready state.",
      stopReason: "build-sealed-request-before-ready",
      recoverable: true,
    };
  }
  return undefined;
}

function createMoyinWorkflowRunNoProgressBlock(input: MoyinWorkflowRunAdvanceOrchestrationInput):
  | {
      readonly error: MoyinWorkflowRunAdvanceOrchestrationError;
      readonly metadata: Readonly<Record<string, unknown>>;
    }
  | undefined {
  const threshold = normalizeNoProgressThreshold(input.noProgressThreshold);
  const history = input.history ?? [];
  const matching = history.filter(
    (entry) =>
      entry.runId === input.runId &&
      entry.stepId === input.stepId &&
      entry.action === input.action &&
      entry.result !== "succeeded",
  );
  const repeated = findRepeatedNoProgressGroup(matching, threshold);
  if (repeated === undefined) {
    return undefined;
  }
  return {
    error: {
      code: "MOYIN_WORKFLOW_RUN_NO_PROGRESS",
      message:
        "Moyin workflow-run advance stopped because the same step, action, and error repeated without progress.",
      stopReason: "same-step-action-error-threshold",
      recoverable: true,
    },
    metadata: {
      noProgressThreshold: threshold,
      noProgressMatches: repeated.count,
      noProgressError: repeated.key,
    },
  };
}

function normalizeNoProgressThreshold(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_NO_PROGRESS_THRESHOLD;
}

function findRepeatedNoProgressGroup(
  history: readonly MoyinWorkflowRunAdvanceHistoryEntry[],
  threshold: number,
): { readonly key: string; readonly count: number } | undefined {
  const counts = new Map<string, number>();
  for (const entry of history) {
    const key = entry.errorCode ?? entry.error ?? entry.status ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of counts) {
    if (count >= threshold) {
      return { key, count };
    }
  }
  return undefined;
}

function createMoyinWorkflowRunOrchestratorResult(
  input: MoyinWorkflowRunAdvanceOrchestrationInput,
  result: {
    readonly status: MoyinWorkflowRunAdvanceOrchestrationStatus;
    readonly preAdvanceSteps: ExternalToolInvokeResult;
    readonly sealedPreflight?: ExternalToolInvokeResult | undefined;
    readonly advance?: ExternalToolInvokeResult | undefined;
    readonly postAdvanceSteps?: ExternalToolInvokeResult | undefined;
    readonly artifacts?: ExternalToolInvokeResult | undefined;
    readonly preAdvanceStep?: MoyinWorkflowRunStepState | undefined;
    readonly postAdvanceStep?: MoyinWorkflowRunStepState | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  },
): MoyinWorkflowRunAdvanceOrchestrationResult {
  return {
    ok: result.status === "advanced",
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    action: input.action,
    preAdvanceSteps: result.preAdvanceSteps,
    ...(result.sealedPreflight === undefined ? {} : { sealedPreflight: result.sealedPreflight }),
    ...(result.advance === undefined ? {} : { advance: result.advance }),
    ...(result.postAdvanceSteps === undefined ? {} : { postAdvanceSteps: result.postAdvanceSteps }),
    ...(result.artifacts === undefined ? {} : { artifacts: result.artifacts }),
    ...(result.preAdvanceStep === undefined ? {} : { preAdvanceStep: result.preAdvanceStep }),
    ...(result.postAdvanceStep === undefined ? {} : { postAdvanceStep: result.postAdvanceStep }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.orchestrator.v1",
      sequenceGuard: result.error === undefined ? "passed" : "blocked",
      ...(result.metadata ?? {}),
    },
  };
}

function createMoyinWorkflowRunNextActionPlanResult(
  input: MoyinWorkflowRunNextActionPlanInput,
  result: {
    readonly status: MoyinWorkflowRunNextActionPlanStatus;
    readonly stepsResult: ExternalToolInvokeResult;
    readonly steps: readonly MoyinWorkflowRunStepState[];
    readonly nextAction: MoyinWorkflowRunNextActionPlanAction;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
  },
): MoyinWorkflowRunNextActionPlanResult {
  return {
    ok: result.error === undefined,
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    stepsResult: result.stepsResult,
    steps: result.steps,
    nextAction: result.nextAction,
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.next-action-plan.v1",
      submitAttempted: false,
      advanceAttempted: false,
      stepCount: result.steps.length,
    },
  };
}

function createMoyinWorkflowRunUntilNextGateResult(
  input: MoyinWorkflowRunUntilNextGateInput,
  result: {
    readonly status: MoyinWorkflowRunUntilNextGateStatus;
    readonly plan: MoyinWorkflowRunNextActionPlanResult;
    readonly approvalPacket?: MoyinWorkflowRunApprovalPacketResult | undefined;
    readonly resume?: MoyinWorkflowRunResumeAndPackageResult | undefined;
    readonly productionPackage?: MoyinWorkflowRunProductionPackageResult | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly metadata: {
      readonly stoppedAt: string;
      readonly resumeAttempted: boolean;
      readonly packageAttempted: boolean;
    };
  },
): MoyinWorkflowRunUntilNextGateResult {
  return {
    ok:
      result.status === "approval-required" ||
      result.status === "packaged" ||
      result.status === "partial" ||
      result.status === "resumed" ||
      result.status === "waiting",
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    plan: result.plan,
    effectiveNextAction: result.approvalPacket?.plan?.nextAction ?? result.plan.nextAction,
    ...(result.approvalPacket === undefined ? {} : { approvalPacket: result.approvalPacket }),
    ...(result.resume === undefined ? {} : { resume: result.resume }),
    ...(result.productionPackage === undefined ? {} : { package: result.productionPackage }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.until-next-gate.v1",
      submitAttempted: false,
      advanceAttempted: false,
      resumeAttempted: result.metadata.resumeAttempted,
      packageAttempted: result.metadata.packageAttempted,
      stoppedAt: result.metadata.stoppedAt,
    },
  };
}

function createMoyinWorkflowRunApprovalPacketFromPreflight(
  input: MoyinWorkflowRunNextActionPlanInput,
  result: {
    readonly plan: MoyinWorkflowRunNextActionPlanResult;
    readonly preflightAttempted: boolean;
    readonly advancePreflight?: MoyinWorkflowRunAdvanceOrchestrationResult | undefined;
    readonly executePreflight?: MoyinWorkflowRunExecuteAndPackageResult | undefined;
    readonly invokeResult?: ExternalToolInvokeResult | undefined;
    readonly advanceAction: MoyinWorkflowRunAdvanceAction;
    readonly stepId: string;
    readonly sealedRequestId?: string | undefined;
  },
): MoyinWorkflowRunApprovalPacketResult {
  if (result.invokeResult?.status !== "approval-required") {
    const error =
      result.advancePreflight?.error ??
      result.executePreflight?.error ??
      ({
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_PREFLIGHT_NOT_READY",
        message:
          "Moyin workflow-run approval packet preflight did not return an approval-required gate.",
        stopReason: "approval-packet-preflight-not-ready",
        recoverable: true,
      } satisfies MoyinWorkflowRunAdvanceOrchestrationError);
    return createMoyinWorkflowRunApprovalPacketResult(input, {
      status:
        result.advancePreflight?.status === "blocked" ||
        result.executePreflight?.status === "blocked"
          ? "blocked"
          : "failed",
      plan: result.plan,
      advancePreflight: result.advancePreflight,
      executePreflight: result.executePreflight,
      error,
      preflightAttempted: result.preflightAttempted,
    });
  }

  return createMoyinWorkflowRunApprovalPacketResult(input, {
    status: "approval-required",
    plan: result.plan,
    approvalPacket: createMoyinWorkflowRunApprovalPacketEnvelope(input, {
      plan: result.plan,
      invokeResult: result.invokeResult,
      advanceAction: result.advanceAction,
      stepId: result.stepId,
      sealedRequestId: result.sealedRequestId,
    }),
    advancePreflight: result.advancePreflight,
    executePreflight: result.executePreflight,
    preflightAttempted: result.preflightAttempted,
  });
}

function createMoyinWorkflowRunApprovalPacketEnvelope(
  input: MoyinWorkflowRunNextActionPlanInput,
  result: {
    readonly plan: MoyinWorkflowRunNextActionPlanResult;
    readonly invokeResult: ExternalToolInvokeResult;
    readonly advanceAction: MoyinWorkflowRunAdvanceAction;
    readonly stepId: string;
    readonly sealedRequestId?: string | undefined;
  },
): MoyinWorkflowRunApprovalPacket {
  const turnId =
    input.turnId ??
    createMoyinWorkflowRunApprovalPacketTurnId(
      input.projectId,
      input.runId,
      result.stepId,
      result.advanceAction,
    );
  const sessionKey = input.sessionKey ?? "moyin:workflow-run:approval-packet";
  const approvalExpiresAtMs = readNumber(
    readRecord(result.invokeResult.metadata)?.approvalExpiresAtMs,
  );
  const nextInvocation = createMoyinWorkflowRunApprovalPacketNextInvocation({
    projectId: input.projectId,
    runId: input.runId,
    stepId: result.stepId,
    action: result.advanceAction,
    ...(result.sealedRequestId === undefined ? {} : { sealedRequestId: result.sealedRequestId }),
    ...(result.invokeResult.approval?.id === undefined
      ? {}
      : { approvalId: result.invokeResult.approval.id }),
    ...(approvalExpiresAtMs === undefined ? {} : { approvalExpiresAtMs }),
    turnId,
    sessionKey,
  });
  return {
    schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
    type: "approval_request",
    providerId: "moyin",
    operationId: "workflow-run.advance",
    advanceAction: result.advanceAction,
    projectId: input.projectId,
    runId: input.runId,
    stepId: result.stepId,
    ...(result.sealedRequestId === undefined ? {} : { sealedRequestId: result.sealedRequestId }),
    ...(result.invokeResult.approval?.id === undefined
      ? {}
      : { approvalId: result.invokeResult.approval.id }),
    ...optionalNumberField("approvalExpiresAtMs", approvalExpiresAtMs),
    ...(result.invokeResult.approval?.summary === undefined
      ? {}
      : { approvalSummary: result.invokeResult.approval.summary }),
    approvalBinding: {
      turnId,
      sessionKey,
    },
    requiresApproval: true,
    riskLevel: result.advanceAction === "build_request" ? "medium" : "high",
    resumeToken: createMoyinWorkflowRunApprovalPacketResumeToken(
      input.projectId,
      input.runId,
      result.stepId,
      result.advanceAction,
    ),
    nextInvocation,
    mutation: {
      advanceAttempted: false,
      submitAttempted: false,
      executeAttempted: false,
    },
  };
}

function createMoyinWorkflowRunApprovalPacketResult(
  input: MoyinWorkflowRunNextActionPlanInput,
  result: {
    readonly status: MoyinWorkflowRunApprovalPacketStatus;
    readonly plan: MoyinWorkflowRunNextActionPlanResult;
    readonly approvalPacket?: MoyinWorkflowRunApprovalPacket | undefined;
    readonly advancePreflight?: MoyinWorkflowRunAdvanceOrchestrationResult | undefined;
    readonly executePreflight?: MoyinWorkflowRunExecuteAndPackageResult | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly preflightAttempted: boolean;
  },
): MoyinWorkflowRunApprovalPacketResult {
  const approvalPacketArtifact =
    result.approvalPacket === undefined
      ? undefined
      : writeMoyinWorkflowRunApprovalPacketArtifact({
          input,
          toolId: input.toolId ?? DEFAULT_MOYIN_TOOL_ID,
          packet: result.approvalPacket,
        });
  return {
    ok: result.status === "approval-required" || result.status === "not-required",
    status: result.status,
    projectId: input.projectId,
    runId: input.runId,
    plan: result.plan,
    ...(result.approvalPacket === undefined ? {} : { approvalPacket: result.approvalPacket }),
    ...(approvalPacketArtifact === undefined
      ? {}
      : { approvalPacketArtifact: approvalPacketArtifact.artifact }),
    ...(approvalPacketArtifact?.persistence === undefined
      ? {}
      : { approvalPacketArtifactPersistence: approvalPacketArtifact.persistence }),
    ...(result.advancePreflight === undefined ? {} : { advancePreflight: result.advancePreflight }),
    ...(result.executePreflight === undefined ? {} : { executePreflight: result.executePreflight }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.approval-packet-result.v1",
      submitAttempted: false,
      advanceAttempted: false,
      preflightAttempted: result.preflightAttempted,
    },
  };
}

function writeMoyinWorkflowRunApprovalPacketArtifact(input: {
  readonly input: MoyinWorkflowRunApprovalPacketArtifactOptions &
    Pick<MoyinWorkflowRunNextActionPlanInput, "projectId" | "runId" | "sessionKey" | "turnId">;
  readonly toolId: string;
  readonly packet: MoyinWorkflowRunApprovalPacket;
}):
  | {
      readonly artifact: ExternalToolArtifact;
      readonly persistence?: ConversationRuntimeExternalArtifactStoreWriteResult;
    }
  | undefined {
  const packetPath = createMoyinWorkflowRunApprovalPacketPath(input.input, input.packet);
  if (packetPath === undefined) {
    return undefined;
  }
  mkdirSync(dirname(packetPath), { recursive: true });
  writeFileSync(packetPath, `${JSON.stringify(input.packet, null, 2)}\n`, "utf8");
  const artifact: ExternalToolArtifact = {
    id: `moyin-approval-packet:${input.packet.projectId}:${input.packet.runId}:${input.packet.stepId}:${input.packet.advanceAction}`,
    kind: "json",
    path: packetPath,
    metadata: {
      provider: "moyin",
      projectId: input.packet.projectId,
      runId: input.packet.runId,
      stepId: input.packet.stepId,
      operationId: input.packet.operationId,
      advanceAction: input.packet.advanceAction,
      ...(input.packet.sealedRequestId === undefined
        ? {}
        : { sealedRequestId: input.packet.sealedRequestId }),
      ...(input.packet.approvalId === undefined ? {} : { approvalId: input.packet.approvalId }),
      ...(input.packet.approvalExpiresAtMs === undefined
        ? {}
        : { approvalExpiresAtMs: input.packet.approvalExpiresAtMs }),
      resumeToken: input.packet.resumeToken,
      role: "workflow-run-approval-packet",
      schemaVersion: input.packet.schemaVersion,
      packageScript: input.packet.nextInvocation.packageScript,
      retention: "user_controlled",
      sensitivity: "internal",
      cleanupPolicyRef: "artifactPolicy.moyin.approval-packet.user-controlled",
    },
  };
  const persistence = input.input.artifactStore?.upsertArtifacts({
    providerId: "moyin",
    toolId: input.toolId,
    operationId: "workflow-run.approval-packet",
    ...(input.input.turnId === undefined ? {} : { turnId: input.input.turnId }),
    ...(input.input.sessionKey === undefined ? {} : { sessionKey: input.input.sessionKey }),
    projectId: input.packet.projectId,
    runId: input.packet.runId,
    stepId: input.packet.stepId,
    artifacts: [artifact],
    retention: "user_controlled",
    sensitivity: "internal",
    cleanupPolicyRef: "artifactPolicy.moyin.approval-packet.user-controlled",
  });
  return persistence === undefined ? { artifact } : { artifact, persistence };
}

function createMoyinWorkflowRunApprovalPacketPath(
  input: MoyinWorkflowRunApprovalPacketArtifactOptions,
  packet: MoyinWorkflowRunApprovalPacket,
): string | undefined {
  if (input.approvalPacketPath !== undefined) {
    return input.approvalPacketPath;
  }
  if (input.approvalPacketDirectory === undefined) {
    return undefined;
  }
  return join(
    input.approvalPacketDirectory,
    safeMoyinWorkflowRunApprovalPacketPathToken(packet.projectId),
    safeMoyinWorkflowRunApprovalPacketPathToken(packet.runId),
    `${safeMoyinWorkflowRunApprovalPacketPathToken(packet.stepId)}-${safeMoyinWorkflowRunApprovalPacketPathToken(packet.advanceAction)}.approval-packet.json`,
  );
}

function safeMoyinWorkflowRunApprovalPacketPathToken(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.length === 0 ? "unknown" : safe;
}

function createMoyinWorkflowRunApprovalPacketNextInvocation(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly action: MoyinWorkflowRunAdvanceAction;
  readonly sealedRequestId?: string;
  readonly approvalId?: string;
  readonly approvalExpiresAtMs?: number;
  readonly turnId: string;
  readonly sessionKey: string;
}): MoyinWorkflowRunApprovalPacketNextInvocation {
  const packageScript = "moyin:smoke:continue-approved";
  const env = {
    MOYIN_SMOKE_PROJECT_ID: input.projectId,
    MOYIN_SMOKE_WORKFLOW_RUN_ID: input.runId,
    MOYIN_SMOKE_STEP_ID: input.stepId,
    MOYIN_SMOKE_ADVANCE_ACTION: input.action,
    MOYIN_SMOKE_ALLOW_CONTINUE: "1",
    MOYIN_SMOKE_APPROVAL: "APPROVED",
    MOYIN_SMOKE_APPROVAL_TURN_ID: input.turnId,
    MOYIN_SMOKE_APPROVAL_SESSION_KEY: input.sessionKey,
    MOYIN_SMOKE_RESUME_TOKEN: createMoyinWorkflowRunApprovalPacketResumeToken(
      input.projectId,
      input.runId,
      input.stepId,
      input.action,
    ),
    ...(input.sealedRequestId === undefined
      ? {}
      : { MOYIN_SMOKE_SEALED_REQUEST_ID: input.sealedRequestId }),
    ...(input.approvalId === undefined ? {} : { MOYIN_SMOKE_APPROVAL_ID: input.approvalId }),
    ...(input.approvalExpiresAtMs === undefined
      ? {}
      : { MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS: String(input.approvalExpiresAtMs) }),
  };
  return {
    packageScript,
    env,
    shellCommand: formatMoyinWorkflowRunApprovalPacketCommand(packageScript, env),
  };
}

function createMoyinWorkflowRunApprovalPacketTurnId(
  projectId: string,
  runId: string,
  stepId: string,
  action: MoyinWorkflowRunAdvanceAction,
): string {
  return action === "execute"
    ? `moyin-smoke-execute:${projectId}:${runId}:${stepId}`
    : `moyin-smoke-advance:${projectId}:${runId}:${stepId}:${action}`;
}

function createMoyinWorkflowRunApprovalPacketResumeToken(
  projectId: string,
  runId: string,
  stepId: string,
  action: MoyinWorkflowRunAdvanceAction,
): string {
  return `moyin-workflow-run:${projectId}:${runId}:${stepId}:${action}`;
}

function formatMoyinWorkflowRunApprovalPacketCommand(
  packageScript: string,
  env: Readonly<Record<string, string>>,
): string {
  return [
    ...Object.entries(env).map(([key, value]) => `${key}=${shellQuoteMoyinEnvValue(value)}`),
    "pnpm",
    "-s",
    packageScript,
  ].join(" ");
}

function shellQuoteMoyinEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function validateMoyinWorkflowRunApprovedContinuationInput(
  input: MoyinWorkflowRunApprovedContinuationInput,
):
  | {
      readonly status: MoyinWorkflowRunApprovedContinuationStatus;
      readonly error: MoyinWorkflowRunAdvanceOrchestrationError;
    }
  | undefined {
  const packet = input.approvalPacket;
  if (
    packet.schemaVersion !== "director.moyin.workflow-run.approval-packet.v1" ||
    packet.type !== "approval_request" ||
    packet.providerId !== "moyin" ||
    packet.operationId !== "workflow-run.advance"
  ) {
    return {
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_INVALID",
        message: "Moyin workflow-run continuation requires a Moyin workflow-run approval packet.",
        stopReason: "approval-packet-invalid",
        recoverable: true,
      },
    };
  }
  if (input.approval?.status !== "approved") {
    return {
      status: input.approval?.status === "rejected" ? "blocked" : "approval-required",
      error: {
        code:
          input.approval?.status === "rejected"
            ? "MOYIN_WORKFLOW_RUN_APPROVAL_REJECTED"
            : "MOYIN_WORKFLOW_RUN_APPROVAL_MISSING",
        message:
          input.approval?.status === "rejected"
            ? "Moyin workflow-run continuation was rejected by the operator."
            : "Moyin workflow-run continuation requires explicit approved consent.",
        stopReason:
          input.approval?.status === "rejected" ? "approval-rejected" : "approval-missing",
        recoverable: input.approval?.status !== "rejected",
      },
    };
  }
  if (
    packet.approvalExpiresAtMs !== undefined &&
    packet.approvalExpiresAtMs <= (input.nowMs?.() ?? Date.now())
  ) {
    return {
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_APPROVAL_EXPIRED",
        message:
          "Moyin workflow-run continuation approval has expired and must be requested again.",
        stopReason: "approval-expired",
        recoverable: true,
      },
    };
  }
  return undefined;
}

function resolveMoyinWorkflowRunApprovalBinding(input: MoyinWorkflowRunApprovedContinuationInput): {
  readonly turnId: string;
  readonly sessionKey: string;
} {
  return {
    turnId:
      input.approvalPacket.approvalBinding?.turnId ??
      input.turnId ??
      createMoyinWorkflowRunApprovalPacketTurnId(
        input.approvalPacket.projectId,
        input.approvalPacket.runId,
        input.approvalPacket.stepId,
        input.approvalPacket.advanceAction,
      ),
    sessionKey:
      input.approvalPacket.approvalBinding?.sessionKey ??
      input.sessionKey ??
      "moyin:workflow-run:approval-packet",
  };
}

function normalizeMoyinWorkflowRunApprovedContinuationStatus(
  status:
    | MoyinWorkflowRunAdvanceOrchestrationStatus
    | MoyinWorkflowRunExecuteAndPackageStatus
    | MoyinWorkflowRunUntilNextGateStatus,
): MoyinWorkflowRunApprovedContinuationStatus {
  switch (status) {
    case "advanced":
    case "approval-required":
    case "blocked":
    case "packaged":
    case "partial":
    case "resumed":
    case "waiting":
      return status;
    case "executed":
      return "advanced";
    default:
      return "failed";
  }
}

function createMoyinWorkflowRunApprovedContinuationResult(
  input: MoyinWorkflowRunApprovedContinuationInput,
  result: {
    readonly status: MoyinWorkflowRunApprovedContinuationStatus;
    readonly advance?: MoyinWorkflowRunAdvanceOrchestrationResult | undefined;
    readonly execute?: MoyinWorkflowRunExecuteAndPackageResult | undefined;
    readonly nextGate?: MoyinWorkflowRunUntilNextGateResult | undefined;
    readonly nextApprovalPacket?: MoyinWorkflowRunApprovalPacketResult | undefined;
    readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
    readonly sealedRequestId?: string | undefined;
    readonly taskId?: string | undefined;
    readonly advanceAttempted: boolean;
    readonly executeAttempted: boolean;
    readonly nextGateAttempted: boolean;
    readonly nextApprovalPacketCreated: boolean;
    readonly packageAttempted: boolean;
  },
): MoyinWorkflowRunApprovedContinuationResult {
  const binding = resolveMoyinWorkflowRunApprovalBinding(input);
  return {
    ok:
      (result.error === undefined ||
        result.status === "partial" ||
        (result.status === "approval-required" && result.nextApprovalPacketCreated)) &&
      (result.status === "advanced" ||
        result.status === "approval-required" ||
        result.status === "packaged" ||
        result.status === "partial" ||
        result.status === "resumed" ||
        result.status === "waiting"),
    status: result.status,
    projectId: input.approvalPacket.projectId,
    runId: input.approvalPacket.runId,
    stepId: input.approvalPacket.stepId,
    action: input.approvalPacket.advanceAction,
    ...(input.approvalPacket.approvalId === undefined
      ? {}
      : { approvalId: input.approvalPacket.approvalId }),
    ...(result.sealedRequestId === undefined ? {} : { sealedRequestId: result.sealedRequestId }),
    ...(result.taskId === undefined ? {} : { taskId: result.taskId }),
    ...(result.advance === undefined ? {} : { advance: result.advance }),
    ...(result.execute === undefined ? {} : { execute: result.execute }),
    ...(result.nextGate === undefined ? {} : { nextGate: result.nextGate }),
    ...(result.nextApprovalPacket === undefined
      ? {}
      : { nextApprovalPacket: result.nextApprovalPacket }),
    ...(result.error === undefined ? {} : { error: result.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.approved-continuation.v1",
      submitAttempted: false,
      advanceAttempted: result.advanceAttempted,
      executeAttempted: result.executeAttempted,
      nextGateAttempted: result.nextGateAttempted,
      nextApprovalPacketCreated: result.nextApprovalPacketCreated,
      packageAttempted: result.packageAttempted,
      approvalBindingTurnId: binding.turnId,
      approvalBindingSessionKey: binding.sessionKey,
    },
  };
}

function createMoyinWorkflowRunApprovalPacketArtifactReadResult(input: {
  readonly artifactId: string;
  readonly status: MoyinWorkflowRunApprovalPacketArtifactReadStatus;
  readonly artifactRecord?: ConversationRuntimeExternalArtifactRecord | undefined;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacket | undefined;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
}): MoyinWorkflowRunApprovalPacketArtifactReadResult {
  return {
    ok: input.status === "found" && input.approvalPacket !== undefined,
    status: input.status,
    artifactId: input.artifactId,
    ...(input.artifactRecord === undefined ? {} : { artifactRecord: input.artifactRecord }),
    ...(input.approvalPacket === undefined ? {} : { approvalPacket: input.approvalPacket }),
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.approval-packet-artifact-read.v1",
      submitAttempted: false,
      advanceAttempted: false,
      executeAttempted: false,
    },
  };
}

function createMoyinWorkflowRunApprovedContinuationFromArtifactResult(input: {
  readonly packetRead: MoyinWorkflowRunApprovalPacketArtifactReadResult;
  readonly status: MoyinWorkflowRunApprovedContinuationFromArtifactResult["status"];
  readonly continuation?: MoyinWorkflowRunApprovedContinuationResult | undefined;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
}): MoyinWorkflowRunApprovedContinuationFromArtifactResult {
  return {
    ok: input.continuation?.ok === true,
    status: input.status,
    packetRead: input.packetRead,
    ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      schemaVersion: "director.moyin.workflow-run.approved-continuation-from-artifact.v1",
      submitAttempted: false,
      advanceAttempted: input.continuation?.metadata.advanceAttempted ?? false,
      executeAttempted: input.continuation?.metadata.executeAttempted ?? false,
      nextGateAttempted: input.continuation?.metadata.nextGateAttempted ?? false,
      nextApprovalPacketCreated: input.continuation?.metadata.nextApprovalPacketCreated ?? false,
      packageAttempted: input.continuation?.metadata.packageAttempted ?? false,
    },
  };
}

function readMoyinWorkflowRunApprovalPacket(
  value: unknown,
): MoyinWorkflowRunApprovalPacket | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const nextInvocation = readMoyinWorkflowRunApprovalPacketNextInvocation(record.nextInvocation);
  const mutation = readRecord(record.mutation);
  const advanceAction = readString(record.advanceAction) as
    | MoyinWorkflowRunAdvanceAction
    | undefined;
  const projectId = readString(record.projectId);
  const runId = readString(record.runId);
  const stepId = readString(record.stepId);
  const resumeToken = readString(record.resumeToken);
  const riskLevel =
    record.riskLevel === "high" || record.riskLevel === "medium" ? record.riskLevel : undefined;
  if (
    record.schemaVersion !== "director.moyin.workflow-run.approval-packet.v1" ||
    record.type !== "approval_request" ||
    record.providerId !== "moyin" ||
    record.operationId !== "workflow-run.advance" ||
    advanceAction === undefined ||
    projectId === undefined ||
    runId === undefined ||
    stepId === undefined ||
    record.requiresApproval !== true ||
    riskLevel === undefined ||
    resumeToken === undefined ||
    nextInvocation === undefined ||
    mutation?.advanceAttempted !== false ||
    mutation.submitAttempted !== false ||
    mutation.executeAttempted !== false
  ) {
    return undefined;
  }
  const approvalBinding = readMoyinWorkflowRunApprovalBinding(record.approvalBinding);
  const sealedRequestId = readString(record.sealedRequestId);
  const approvalId = readString(record.approvalId);
  const approvalExpiresAtMs = readNumber(record.approvalExpiresAtMs);
  const approvalSummary = readString(record.approvalSummary);
  return {
    schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
    type: "approval_request",
    providerId: "moyin",
    operationId: "workflow-run.advance",
    advanceAction,
    projectId,
    runId,
    stepId,
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    ...(approvalId === undefined ? {} : { approvalId }),
    ...(approvalExpiresAtMs === undefined ? {} : { approvalExpiresAtMs }),
    ...(approvalSummary === undefined ? {} : { approvalSummary }),
    ...(approvalBinding === undefined ? {} : { approvalBinding }),
    requiresApproval: true,
    riskLevel,
    resumeToken,
    nextInvocation,
    mutation: {
      advanceAttempted: false,
      submitAttempted: false,
      executeAttempted: false,
    },
  };
}

function readMoyinWorkflowRunApprovalPacketNextInvocation(
  value: unknown,
): MoyinWorkflowRunApprovalPacketNextInvocation | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const packageScript = readString(record.packageScript);
  const shellCommand = readString(record.shellCommand);
  const envRecord = readRecord(record.env);
  if (
    (packageScript !== "moyin:smoke:advance" &&
      packageScript !== "moyin:smoke:continue-approved" &&
      packageScript !== "moyin:smoke:execute-package") ||
    shellCommand === undefined ||
    envRecord === undefined
  ) {
    return undefined;
  }
  const env = Object.fromEntries(
    Object.entries(envRecord).flatMap(([key, value]) => {
      const parsed = readString(value);
      return parsed === undefined ? [] : [[key, parsed]];
    }),
  );
  return {
    packageScript,
    env,
    shellCommand,
  };
}

function readMoyinWorkflowRunApprovalBinding(
  value: unknown,
): MoyinWorkflowRunApprovalPacket["approvalBinding"] | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const turnId = readString(record.turnId);
  const sessionKey = readString(record.sessionKey);
  return turnId === undefined || sessionKey === undefined ? undefined : { turnId, sessionKey };
}

function optionalNumberField<K extends string>(
  key: K,
  value: number | undefined,
): { readonly [P in K]: number } | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]: number });
}

function selectMoyinWorkflowRunNextAction(steps: readonly MoyinWorkflowRunStepState[]): {
  readonly status: MoyinWorkflowRunNextActionPlanStatus;
  readonly nextAction: MoyinWorkflowRunNextActionPlanAction;
  readonly error?: MoyinWorkflowRunAdvanceOrchestrationError | undefined;
} {
  if (steps.length === 0) {
    return {
      status: "blocked",
      nextAction: {
        kind: "none",
        requiresApproval: false,
        reason: "workflow-run.steps returned no steps to plan.",
      },
      error: {
        code: "MOYIN_WORKFLOW_RUN_STEPS_EMPTY",
        message: "Moyin workflow-run has no steps to advance.",
        recoverable: true,
      },
    };
  }

  const running = steps.find((step) => isMoyinStepStatus(step, "running"));
  if (running !== undefined) {
    if (running.taskId !== undefined) {
      return {
        status: "resumable",
        nextAction: {
          kind: "resume_watch",
          operationId: "task.watch",
          stepId: running.stepId,
          requiresApproval: false,
          reason:
            "A workflow-run step is already running; resume watch/package without resubmitting.",
          ...(running.sealedRequestId === undefined
            ? {}
            : { sealedRequestId: running.sealedRequestId }),
          taskId: running.taskId,
        },
      };
    }
    return {
      status: "waiting",
      nextAction: {
        kind: "wait",
        stepId: running.stepId,
        requiresApproval: false,
        reason: "A workflow-run step is running but has not exposed a taskId yet.",
      },
    };
  }

  const approvalRequired = steps.find((step) => isMoyinStepStatus(step, "approval_required"));
  if (approvalRequired !== undefined) {
    return {
      status: "approval-required",
      nextAction: {
        kind: "execute",
        operationId: "workflow-run.advance",
        advanceAction: "execute",
        stepId: approvalRequired.stepId,
        requiresApproval: true,
        reason: "The step has a sealed request and needs explicit approval before execute.",
        ...(approvalRequired.sealedRequestId === undefined
          ? {}
          : { sealedRequestId: approvalRequired.sealedRequestId }),
      },
    };
  }

  const failed = steps.find((step) => isMoyinStepStatus(step, "failed"));
  if (failed !== undefined) {
    if (!isMoyinWorkflowRunFailedStepRetryable(failed)) {
      return {
        status: "blocked",
        nextAction: {
          kind: "none",
          stepId: failed.stepId,
          requiresApproval: false,
          reason:
            "The workflow-run step failed and Moyin reports it cannot be retried; create a fresh run or inspect the step in Moyin.",
          ...(failed.sealedRequestId === undefined
            ? {}
            : { sealedRequestId: failed.sealedRequestId }),
        },
        error: {
          code: "MOYIN_WORKFLOW_RUN_STEP_UNRECOVERABLE",
          message:
            "Moyin workflow-run step is failed but not retryable; Director Angel will not issue another retry approval packet.",
          stopReason: "failed-step-not-retryable",
          recoverable: true,
        },
      };
    }
    return {
      status: "failed",
      nextAction: {
        kind: "retry",
        operationId: "workflow-run.advance",
        advanceAction: "retry",
        stepId: failed.stepId,
        requiresApproval: true,
        reason: "The step failed; retry is a workflow-run mutation and requires approval.",
      },
    };
  }

  const ready = steps.find((step) => isMoyinStepStatus(step, "ready"));
  if (ready !== undefined) {
    const advanceAction = ready.requiresApproval === false ? "execute" : "build_sealed_request";
    return {
      status: "ready-to-advance",
      nextAction: {
        kind: advanceAction,
        operationId: "workflow-run.advance",
        advanceAction,
        stepId: ready.stepId,
        requiresApproval: true,
        reason:
          advanceAction === "build_sealed_request"
            ? "The step is ready; build a sealed request before any paid execute."
            : "The step is ready and not approval-gated by Moyin; execute it through workflow-run.advance and watch the task.",
      },
    };
  }

  if (steps.every((step) => isMoyinStepStatus(step, "completed"))) {
    return {
      status: "completed",
      nextAction: {
        kind: "collect_package",
        operationId: "workflow-run.package",
        requiresApproval: false,
        reason: "All workflow-run steps are completed; collect artifacts and exports.",
      },
    };
  }

  return {
    status: "waiting",
    nextAction: {
      kind: "wait",
      requiresApproval: false,
      reason: "No runnable step is ready yet; wait for dependencies or refresh steps.",
    },
  };
}

function isMoyinStepStatus(step: MoyinWorkflowRunStepState, status: string): boolean {
  return step.status === status;
}

function isMoyinWorkflowRunFailedStepRetryable(step: MoyinWorkflowRunStepState): boolean {
  if (step.retryable === false) {
    return false;
  }
  if (
    step.attempt !== undefined &&
    step.maxAttempts !== undefined &&
    step.maxAttempts > 0 &&
    step.attempt >= step.maxAttempts
  ) {
    return false;
  }
  const errorText = `${step.error?.code ?? ""} ${step.error?.message ?? ""}`.toLowerCase();
  if (errorText.includes("cannot be retried")) {
    return false;
  }
  return true;
}

function findMoyinWorkflowRunStep(
  result: ExternalToolInvokeResult,
  stepId: string,
): MoyinWorkflowRunStepState | undefined {
  return readMoyinWorkflowRunStepsFromInvokeResult(result).find((step) => step.stepId === stepId);
}

function readMoyinWorkflowRunStepsFromInvokeResult(
  result: ExternalToolInvokeResult,
): readonly MoyinWorkflowRunStepState[] {
  const output = readRecord(result.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(nestedOutput?.payload ?? output?.payload);
  return uniqueMoyinWorkflowRunSteps([
    ...readMoyinWorkflowRunSteps(nestedOutput?.steps),
    ...readMoyinWorkflowRunSteps(payload?.items),
    ...readMoyinWorkflowRunSteps(payload?.steps),
    ...readMoyinWorkflowRunSteps(output?.items),
    ...readMoyinWorkflowRunSteps(output?.steps),
  ]);
}

function uniqueMoyinWorkflowRunSteps(
  steps: readonly MoyinWorkflowRunStepState[],
): readonly MoyinWorkflowRunStepState[] {
  const seen = new Set<string>();
  return steps.flatMap((step) => {
    if (seen.has(step.stepId)) {
      return [];
    }
    seen.add(step.stepId);
    return [step];
  });
}

function readMoyinWorkflowRunSteps(value: unknown): readonly MoyinWorkflowRunStepState[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const step = readMoyinWorkflowRunStep(item);
    if (step === undefined || seen.has(step.stepId)) {
      return [];
    }
    seen.add(step.stepId);
    return [step];
  });
}

function readMoyinWorkflowRunStep(value: unknown): MoyinWorkflowRunStepState | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const stepId = readString(record.stepId) ?? readString(record.id);
  if (stepId === undefined) {
    return undefined;
  }
  const status = readString(record.status);
  const action = readString(record.action);
  const sealedRequestId = readString(record.sealedRequestId);
  const taskId = readString(record.taskId);
  const requiresApproval = readBoolean(record.requiresApproval);
  const retryable = readBoolean(record.retryable);
  const attempt = readNumber(record.attempt);
  const maxAttempts = readNumber(record.maxAttempts);
  const error = readMoyinWorkflowRunStepError(record.error);
  const warnings = readStringArray(record.warnings);
  const artifacts = Array.isArray(record.artifacts) ? [...record.artifacts] : [];
  return {
    stepId,
    ...(status === undefined ? {} : { status }),
    ...(action === undefined ? {} : { action }),
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(requiresApproval === undefined ? {} : { requiresApproval }),
    ...(retryable === undefined ? {} : { retryable }),
    ...(attempt === undefined ? {} : { attempt }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(error === undefined ? {} : { error }),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
    payload: record,
  };
}

function readMoyinWorkflowRunStepError(
  value: unknown,
): MoyinWorkflowRunStepState["error"] | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const code = readString(record.code);
  const message = readString(record.message);
  const recoverable = readBoolean(record.recoverable);
  if (code === undefined && message === undefined && recoverable === undefined) {
    return undefined;
  }
  return {
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(recoverable === undefined ? {} : { recoverable }),
  };
}

function readExternalToolArtifactCount(result: ExternalToolInvokeResult): number | undefined {
  if (result.artifacts !== undefined) {
    return result.artifacts.length;
  }
  const output = readRecord(result.output);
  const payload = readRecord(output?.output);
  const items = payload?.items;
  if (Array.isArray(items)) {
    return items.length;
  }
  const total = payload?.total;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = readString(item);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
