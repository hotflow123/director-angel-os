import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ConversationRuntimeExternalArtifactStore } from "./external-artifact-store.js";
import type {
  ExternalToolInvokeRequest,
  ExternalToolInvokeResult,
  ExternalToolRegistry,
} from "./external-tools.js";
import { invokeExternalTool } from "./external-tools.js";
import type {
  MoyinWorkflowRunApprovalPacket,
  MoyinWorkflowRunApprovalPacketResult,
  MoyinWorkflowRunApprovedContinuationResult,
  MoyinWorkflowRunApprovedContinuationStatus,
  MoyinWorkflowRunExecuteAndPackageEvent,
  MoyinWorkflowRunUntilNextGateResult,
} from "./moyin-workflow-run-orchestrator.js";
import {
  createMoyinWorkflowRunApprovalPacket,
  orchestrateMoyinWorkflowRunContinueApproved,
  orchestrateMoyinWorkflowRunUntilNextGate,
} from "./moyin-workflow-run-orchestrator.js";

const SCHEMA_VERSION = "director.moyin.video-production-plan.v1" as const;
const DEFAULT_MOYIN_TOOL_ID = "moyin.provider";

const REFERENCE_PATTERNS = [
  "hermes.tool-executor",
  "hermes.approval-queue",
  "openclaw.provider-contract",
  "openclaw.event-stream",
] as const;

export type MoyinVideoProductionTarget = "director" | "sclass";
export type MoyinWorkflowRunActor = "angel";
export type MoyinWorkflowRunMode = "dry_run";
export type MoyinWorkflowRunComplexity = "linear" | "simple_dag";
export type MoyinVideoOperation = "t2v" | "i2v" | "r2v" | "first_last_frame" | "video_edit";
export interface MoyinVideoImageWithRole {
  readonly role: "first_frame" | "last_frame";
  readonly url: string;
}
export type MoyinTaskTemplateId =
  | "script.generate-from-idea"
  | "script.import-full-workflow"
  | "director.scene-image"
  | "director.scene-video"
  | "sclass.group-video"
  | "character.portrait-image"
  | "scene.reference-image";

export interface MoyinVideoProductionPlan {
  readonly projectId?: string;
  readonly goal: string;
  readonly idea?: string;
  readonly scriptText?: string;
  readonly target?: MoyinVideoProductionTarget;
  readonly aspectRatio?: string;
  readonly defaultDurationSeconds?: number;
  readonly scriptExecution?: Readonly<Record<string, unknown>>;
  readonly scenes?: readonly MoyinVideoProductionScenePlan[];
  readonly characters?: readonly MoyinVideoProductionCharacterPlan[];
  readonly sclassGroups?: readonly MoyinVideoProductionSclassGroupPlan[];
  readonly promptSnapshotIds?: readonly string[];
  readonly maxParallelSteps?: number;
}

export interface MoyinVideoProductionScenePlan {
  readonly sceneId?: string | number;
  readonly name: string;
  readonly imagePrompt?: string;
  readonly videoPrompt?: string;
  readonly imageExecution?: Readonly<Record<string, unknown>>;
  readonly videoExecution?: Readonly<Record<string, unknown>>;
  readonly referenceImages?: readonly string[];
  readonly firstFrameImage?: string;
  readonly lastFrameImage?: string;
  readonly imageWithRoles?: readonly MoyinVideoImageWithRole[];
  readonly width?: number;
  readonly height?: number;
  readonly persistLabel?: string;
  readonly durationSeconds?: number;
  readonly aspectRatio?: string;
  readonly operation?: MoyinVideoOperation;
}

export interface MoyinVideoProductionCharacterPlan {
  readonly characterId: string;
  readonly characterName: string;
  readonly prompt: string;
  readonly imageExecution?: Readonly<Record<string, unknown>>;
  readonly negativePrompt?: string;
  readonly referenceImages?: readonly string[];
  readonly styleId?: string;
  readonly visualTraits?: string;
  readonly viewType?: string;
}

export interface MoyinVideoProductionSclassGroupPlan {
  readonly groupId: string;
  readonly groupName: string;
  readonly sceneIds: readonly (string | number)[];
  readonly videoPrompt?: string;
  readonly videoExecution?: Readonly<Record<string, unknown>>;
  readonly gridValidation?: Readonly<Record<string, unknown>>;
  readonly historyAssetRefs?: readonly unknown[];
}

export interface MoyinWorkflowRunCreateRequestDraft {
  readonly projectId?: string;
  readonly goal: string;
  readonly actor: MoyinWorkflowRunActor;
  readonly mode: MoyinWorkflowRunMode;
  readonly complexity: MoyinWorkflowRunComplexity;
  readonly inputs: readonly Readonly<Record<string, unknown>>[];
  readonly promptSnapshotIds: readonly string[];
  readonly memoryPolicy: {
    readonly readProjectMemory: boolean;
    readonly writeBack: "none";
  };
  readonly approvalPolicy: {
    readonly requireBeforeSubmit: boolean;
  };
  readonly concurrencyPolicy: {
    readonly maxParallelSteps: number;
    readonly respectDependencies: boolean;
  };
  readonly steps: readonly MoyinWorkflowRunStepDraft[];
}

export interface MoyinWorkflowRunStepDraft {
  readonly stepId: string;
  readonly command: "task.template.build";
  readonly templateId: MoyinTaskTemplateId;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly dependencies: readonly string[];
  readonly requiresApproval: boolean;
  readonly retryable: boolean;
  readonly maxAttempts: number;
}

export interface MoyinVideoProductionPlanBlocker {
  readonly code: string;
  readonly message: string;
  readonly stepId?: string;
  readonly path?: string;
  readonly recoverable: boolean;
}

export interface MoyinVideoProductionPlanDraftDiagnostics {
  readonly blockerCount: number;
  readonly blockers: readonly MoyinVideoProductionPlanBlocker[];
  readonly warnings: readonly string[];
  readonly paidStepIds: readonly string[];
  readonly nonExecutableStepIds: readonly string[];
  readonly referencePatterns: typeof REFERENCE_PATTERNS;
}

export interface MoyinVideoProductionPlanDraft {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly request: MoyinWorkflowRunCreateRequestDraft;
  readonly diagnostics: MoyinVideoProductionPlanDraftDiagnostics;
}

export interface MoyinWorkflowRunCreateFromVideoProductionPlanInput {
  readonly registry: ExternalToolRegistry;
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId?: string;
  readonly toolId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly scratchRoot?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type MoyinWorkflowRunCreateFromVideoProductionPlanStatus = "blocked" | "created" | "failed";

export interface MoyinWorkflowRunCreateFromVideoProductionPlanResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunCreateFromVideoProductionPlanStatus;
  readonly draft: MoyinVideoProductionPlanDraft;
  readonly draftFilePath?: string;
  readonly createResult?: ExternalToolInvokeResult;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

export type MoyinVideoProductionExecutionDraftKind =
  | "character-image"
  | "image"
  | "script"
  | "sclass-video"
  | "video";

export interface MoyinVideoProductionExecutionDraftFailure {
  readonly kind: MoyinVideoProductionExecutionDraftKind;
  readonly path: string;
  readonly ok: boolean;
  readonly status: ExternalToolInvokeResult["status"];
  readonly error?: string;
  readonly contentPreview?: string;
}

export interface MoyinVideoProductionExecutionDraftSummary {
  readonly attempted: true;
  readonly scriptBuiltCount: number;
  readonly imageBuiltCount: number;
  readonly videoBuiltCount: number;
  readonly failureCount: number;
  readonly failures?: readonly MoyinVideoProductionExecutionDraftFailure[];
}

export interface MoyinVideoProductionPlanExecutionDraftResolutionInput {
  readonly registry: ExternalToolRegistry;
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId?: string;
  readonly toolId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly scratchRoot?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MoyinVideoProductionPlanExecutionDraftResolutionResult {
  readonly ok: boolean;
  readonly plan: MoyinVideoProductionPlan;
  readonly summary: MoyinVideoProductionExecutionDraftSummary;
}

export type MoyinVideoProductionDryRunAdapterDraftsSummary =
  | MoyinVideoProductionExecutionDraftSummary
  | {
      readonly attempted: false;
      readonly reason: "not-requested";
      readonly scriptBuiltCount: 0;
      readonly imageBuiltCount: 0;
      readonly videoBuiltCount: 0;
      readonly failureCount: 0;
    };

export interface MoyinVideoProductionDryRunWorkflowInput {
  readonly registry: ExternalToolRegistry;
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId?: string;
  readonly toolId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly scratchRoot?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly resolveExecutionDrafts?: boolean;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

export type MoyinVideoProductionDryRunWorkflowStatus =
  | "blocked"
  | "created"
  | "failed"
  | "unavailable";

export interface MoyinVideoProductionDryRunWorkflowResult {
  readonly ok: boolean;
  readonly status: MoyinVideoProductionDryRunWorkflowStatus;
  readonly plan: MoyinVideoProductionPlan;
  readonly adapterDrafts: MoyinVideoProductionDryRunAdapterDraftsSummary;
  readonly draft: MoyinVideoProductionPlanDraft;
  readonly create: MoyinWorkflowRunCreateFromVideoProductionPlanResult;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
  readonly metadata: {
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly resolveExecutionDrafts: boolean;
  };
}

export interface MoyinVideoProductionDryRunUntilNextGateInput
  extends MoyinVideoProductionDryRunWorkflowInput {
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly handoffManifestDirectory?: string;
  readonly handoffManifestPath?: string;
  readonly approvalPacketDirectory?: string;
  readonly approvalPacketPath?: string;
  readonly collectPackage?: boolean;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly resumeToken?: string;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

export type MoyinVideoProductionDryRunUntilNextGateStatus =
  | "approval-required"
  | "blocked"
  | "created"
  | "failed"
  | "packaged"
  | "partial"
  | "resumed"
  | "unavailable"
  | "waiting";

export interface MoyinVideoProductionDryRunUntilNextGateResult {
  readonly ok: boolean;
  readonly status: MoyinVideoProductionDryRunUntilNextGateStatus;
  readonly projectId?: string;
  readonly runId?: string;
  readonly dryRun: MoyinVideoProductionDryRunWorkflowResult;
  readonly nextGate?: MoyinWorkflowRunUntilNextGateResult;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacketResult;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
  readonly metadata: {
    readonly schemaVersion: "director.moyin.video-production.dry-run-until-next-gate.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly runCreated: boolean;
    readonly nextGateAttempted: boolean;
    readonly approvalPacketCreated: boolean;
  };
}

export interface MoyinVideoProductionLoopStartInput
  extends MoyinVideoProductionDryRunUntilNextGateInput {
  readonly mode?: "start";
}

export interface MoyinVideoProductionLoopContinueApprovedInput {
  readonly mode: "continue-approved";
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
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly handoffManifestDirectory?: string;
  readonly handoffManifestPath?: string;
  readonly approvalPacketDirectory?: string;
  readonly approvalPacketPath?: string;
  readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
}

export type MoyinVideoProductionLoopInput =
  | MoyinVideoProductionLoopContinueApprovedInput
  | MoyinVideoProductionLoopStartInput;

export type MoyinVideoProductionLoopMode = "continue-approved" | "start";

export type MoyinVideoProductionLoopStatus =
  | MoyinVideoProductionDryRunUntilNextGateStatus
  | MoyinWorkflowRunApprovedContinuationStatus;

export interface MoyinVideoProductionLoopResult {
  readonly ok: boolean;
  readonly mode: MoyinVideoProductionLoopMode;
  readonly status: MoyinVideoProductionLoopStatus;
  readonly projectId?: string;
  readonly runId?: string;
  readonly operationSequence: readonly string[];
  readonly start?: MoyinVideoProductionDryRunUntilNextGateResult;
  readonly continuation?: MoyinWorkflowRunApprovedContinuationResult;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacketResult;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
  readonly metadata: {
    readonly schemaVersion: "director.moyin.video-production.loop.v1";
    readonly submitAttempted: false;
    readonly advanceAttempted: boolean;
    readonly executeAttempted: boolean;
    readonly packageAttempted: boolean;
    readonly approvalPacketCreated: boolean;
  };
}

export function createMoyinWorkflowRunDraftFromVideoProductionPlan(
  plan: MoyinVideoProductionPlan,
): MoyinVideoProductionPlanDraft {
  const blockers: MoyinVideoProductionPlanBlocker[] = [];
  const warnings: string[] = [];
  const paidStepIds = new Set<string>();
  const nonExecutableStepIds = new Set<string>();
  const steps: MoyinWorkflowRunStepDraft[] = [];
  const projectId = readNonEmptyString(plan.projectId);
  const target = plan.target ?? "director";
  const goal = readNonEmptyString(plan.goal) ?? "Moyin video production run";

  if (projectId === undefined) {
    blockers.push({
      code: "MOYIN_PROJECT_ID_REQUIRED",
      message: "A Moyin projectId is required before workflow-run.create can be invoked.",
      path: "projectId",
      recoverable: true,
    });
  }
  if (readNonEmptyString(plan.goal) === undefined) {
    blockers.push({
      code: "MOYIN_WORKFLOW_GOAL_REQUIRED",
      message: "A non-empty production goal is required for the Moyin workflow-run draft.",
      path: "goal",
      recoverable: true,
    });
  }

  const scriptStepId = appendScriptStep({
    plan,
    projectId,
    steps,
    blockers,
    nonExecutableStepIds,
  });
  const characterStepIds = appendCharacterSteps({
    plan,
    projectId,
    scriptStepId,
    steps,
    blockers,
    paidStepIds,
    nonExecutableStepIds,
  });

  if (target === "sclass") {
    appendSclassSteps({
      plan,
      projectId,
      scriptStepId,
      characterStepIds,
      steps,
      blockers,
      paidStepIds,
      nonExecutableStepIds,
    });
  } else {
    appendDirectorSteps({
      plan,
      projectId,
      scriptStepId,
      characterStepIds,
      steps,
      blockers,
      paidStepIds,
      nonExecutableStepIds,
    });
  }

  if (steps.length === 0) {
    blockers.push({
      code: "MOYIN_WORKFLOW_STEPS_REQUIRED",
      message:
        "The video production plan did not contain script, scene, character, or S-Class work.",
      path: "steps",
      recoverable: true,
    });
  }

  const request: MoyinWorkflowRunCreateRequestDraft = {
    ...(projectId === undefined ? {} : { projectId }),
    goal,
    actor: "angel",
    mode: "dry_run",
    complexity: inferWorkflowRunComplexity(steps),
    inputs: [createInputSummary(plan, target)],
    promptSnapshotIds: normalizeStringArray(plan.promptSnapshotIds),
    memoryPolicy: {
      readProjectMemory: true,
      writeBack: "none",
    },
    approvalPolicy: {
      requireBeforeSubmit: true,
    },
    concurrencyPolicy: {
      maxParallelSteps: normalizePositiveInteger(plan.maxParallelSteps) ?? 1,
      respectDependencies: true,
    },
    steps,
  };

  if (nonExecutableStepIds.size > 0) {
    warnings.push("Some Moyin media steps are draft-only until execution payloads are resolved.");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    request,
    diagnostics: {
      blockerCount: blockers.length,
      blockers,
      warnings,
      paidStepIds: [...paidStepIds],
      nonExecutableStepIds: [...nonExecutableStepIds],
      referencePatterns: REFERENCE_PATTERNS,
    },
  };
}

export async function orchestrateMoyinVideoProductionDryRunWorkflow(
  input: MoyinVideoProductionDryRunWorkflowInput,
): Promise<MoyinVideoProductionDryRunWorkflowResult> {
  emitMoyinVideoProductionLoopEvent(input, {
    kind: "moyin.video_production.plan.started",
    stepId: "video-production.plan",
    metadata: {
      phase: "plan",
      resolveExecutionDrafts: input.resolveExecutionDrafts === true,
      submitAttempted: false,
      advanceAttempted: false,
    },
  });

  const resolved =
    input.resolveExecutionDrafts === true
      ? await resolveMoyinVideoProductionPlanExecutionDrafts(input)
      : {
          ok: true,
          plan: {
            ...input.plan,
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          },
          summary: {
            attempted: false,
            reason: "not-requested",
            scriptBuiltCount: 0,
            imageBuiltCount: 0,
            videoBuiltCount: 0,
            failureCount: 0,
          } satisfies MoyinVideoProductionDryRunAdapterDraftsSummary,
        };

  const plannedDraft = createMoyinWorkflowRunDraftFromVideoProductionPlan({
    ...resolved.plan,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
  });
  emitMoyinVideoProductionLoopEvent(input, {
    kind: "moyin.video_production.plan.completed",
    stepId: "video-production.plan",
    metadata: {
      phase: "plan",
      blockerCount: plannedDraft.diagnostics.blockerCount,
      paidStepCount: plannedDraft.diagnostics.paidStepIds.length,
      stepCount: plannedDraft.request.steps.length,
      adapterDraftFailureCount: resolved.summary.failureCount,
      submitAttempted: false,
      advanceAttempted: false,
    },
  });

  if (plannedDraft.diagnostics.blockerCount === 0) {
    emitMoyinVideoProductionLoopEvent(input, {
      kind: "moyin.workflow_run.create.started",
      stepId: "workflow-run.create",
      metadata: {
        phase: "workflow-run.create",
        mode: plannedDraft.request.mode,
        stepCount: plannedDraft.request.steps.length,
        submitAttempted: false,
        advanceAttempted: false,
      },
    });
  }

  const create = await createMoyinWorkflowRunFromVideoProductionPlan({
    registry: input.registry,
    plan: resolved.plan,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.toolId === undefined ? {} : { toolId: input.toolId }),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(input.scratchRoot === undefined ? {} : { scratchRoot: input.scratchRoot }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.video-production.dry-run-workflow",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const createRunId = readMoyinWorkflowRunId(create.createResult);
  if (create.status === "created") {
    emitMoyinVideoProductionLoopEvent(input, {
      kind: "moyin.workflow_run.create.completed",
      stepId: "workflow-run.create",
      ...(createRunId === undefined ? {} : { runId: createRunId }),
      metadata: {
        phase: "workflow-run.create",
        status: create.status,
        submitAttempted: false,
        advanceAttempted: false,
      },
    });
  } else if (plannedDraft.diagnostics.blockerCount === 0) {
    emitMoyinVideoProductionLoopEvent(input, {
      kind: "moyin.workflow_run.create.failed",
      stepId: "workflow-run.create",
      metadata: {
        phase: "workflow-run.create",
        status: create.status,
        errorCode: create.error?.code,
        submitAttempted: false,
        advanceAttempted: false,
      },
    });
  }
  const unavailable = hasMoyinExecutionDraftFailure(resolved.summary, "CONTROL_PLANE_NOT_FOUND");
  const status: MoyinVideoProductionDryRunWorkflowStatus = unavailable
    ? "unavailable"
    : !resolved.ok && create.status === "created"
      ? "blocked"
      : create.status;
  return {
    ok: resolved.ok && create.ok,
    status,
    plan: resolved.plan,
    adapterDrafts: resolved.summary,
    draft: create.draft,
    create,
    ...(create.error === undefined
      ? {}
      : {
          error: unavailable
            ? {
                code: "CONTROL_PLANE_NOT_FOUND",
                message:
                  "Moyin control-plane was unavailable while resolving video production execution drafts.",
                recoverable: true,
              }
            : create.error,
        }),
    metadata: {
      submitAttempted: false,
      advanceAttempted: false,
      resolveExecutionDrafts: input.resolveExecutionDrafts === true,
    },
  };
}

export async function orchestrateMoyinVideoProductionDryRunUntilNextGate(
  input: MoyinVideoProductionDryRunUntilNextGateInput,
): Promise<MoyinVideoProductionDryRunUntilNextGateResult> {
  const dryRun = await orchestrateMoyinVideoProductionDryRunWorkflow(input);
  const projectId =
    readNonEmptyString(input.projectId) ??
    readNonEmptyString(dryRun.plan.projectId) ??
    readNonEmptyString(dryRun.draft.request.projectId);

  if (!dryRun.ok || dryRun.status !== "created") {
    return createMoyinVideoProductionDryRunUntilNextGateResult({
      input,
      dryRun,
      projectId,
      status: dryRun.status,
      error: dryRun.error,
      runCreated: false,
      nextGateAttempted: false,
      approvalPacketCreated: false,
    });
  }

  const runId = readMoyinWorkflowRunId(dryRun.create.createResult);
  if (projectId === undefined || runId === undefined) {
    return createMoyinVideoProductionDryRunUntilNextGateResult({
      input,
      dryRun,
      projectId,
      runId,
      status: "blocked",
      error: {
        code: "MOYIN_WORKFLOW_RUN_ID_MISSING",
        message:
          "Moyin workflow-run.create succeeded but did not return a runId for until-next-gate.",
        recoverable: true,
      },
      runCreated: true,
      nextGateAttempted: false,
      approvalPacketCreated: false,
    });
  }

  emitMoyinVideoProductionLoopEvent(input, {
    kind: "moyin.workflow_run.next_gate.started",
    projectId,
    runId,
    stepId: "workflow-run.until-next-gate",
    metadata: {
      phase: "workflow-run.until-next-gate",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const nextGate = await orchestrateMoyinWorkflowRunUntilNextGate({
    registry: input.registry,
    toolId: input.toolId ?? DEFAULT_MOYIN_TOOL_ID,
    projectId,
    runId,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
    ...(input.handoffManifestDirectory === undefined
      ? {}
      : { handoffManifestDirectory: input.handoffManifestDirectory }),
    ...(input.handoffManifestPath === undefined
      ? {}
      : { handoffManifestPath: input.handoffManifestPath }),
    ...(input.collectPackage === undefined ? {} : { collectPackage: input.collectPackage }),
    ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
    ...(input.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
    ...(input.resumeToken === undefined ? {} : { resumeToken: input.resumeToken }),
    ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.video-production.dry-run-until-next-gate",
      orchestrationPhase: "until-next-gate",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const nextGateStepId =
    nextGate.plan.nextAction.stepId ?? nextGate.resume?.stepId ?? "workflow-run.until-next-gate";
  emitMoyinVideoProductionLoopEvent(input, {
    kind: nextGate.ok
      ? "moyin.workflow_run.next_gate.completed"
      : "moyin.workflow_run.next_gate.failed",
    projectId,
    runId,
    stepId: nextGateStepId,
    metadata: {
      phase: "workflow-run.until-next-gate",
      status: nextGate.status,
      nextActionKind: nextGate.plan.nextAction.kind,
      submitAttempted: false,
      advanceAttempted: false,
    },
  });

  const approvalPacket =
    nextGate.status === "approval-required"
      ? await createMoyinWorkflowRunApprovalPacket({
          registry: input.registry,
          toolId: input.toolId ?? DEFAULT_MOYIN_TOOL_ID,
          projectId,
          runId,
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
            orchestration: "moyin.video-production.dry-run-until-next-gate",
            orchestrationPhase: "approval-packet",
            submitAttempted: false,
            advanceAttempted: false,
          },
        })
      : undefined;
  if (approvalPacket?.ok === true && approvalPacket.approvalPacket !== undefined) {
    emitMoyinVideoProductionLoopEvent(input, {
      kind: "moyin.workflow_run.approval_packet.created",
      projectId,
      runId,
      stepId: approvalPacket.approvalPacket.stepId,
      metadata: {
        phase: "workflow-run.approval-packet",
        operationId: approvalPacket.approvalPacket.operationId,
        advanceAction: approvalPacket.approvalPacket.advanceAction,
        approvalId: approvalPacket.approvalPacket.approvalId,
        artifactId: approvalPacket.approvalPacketArtifact?.id,
        submitAttempted: false,
        advanceAttempted: false,
      },
    });
  }

  return createMoyinVideoProductionDryRunUntilNextGateResult({
    input,
    dryRun,
    projectId,
    runId,
    nextGate,
    approvalPacket,
    status: normalizeMoyinVideoProductionDryRunUntilNextGateStatus(nextGate.status),
    error:
      approvalPacket !== undefined && !approvalPacket.ok
        ? {
            code: approvalPacket.error?.code ?? "MOYIN_WORKFLOW_RUN_APPROVAL_PACKET_FAILED",
            message: approvalPacket.error?.message ?? "Moyin workflow-run approval packet failed.",
            recoverable: true,
          }
        : nextGate.error === undefined
          ? undefined
          : {
              code: nextGate.error.code,
              message: nextGate.error.message,
              recoverable: nextGate.error.recoverable ?? true,
            },
    runCreated: true,
    nextGateAttempted: true,
    approvalPacketCreated: approvalPacket?.ok === true,
  });
}

export async function orchestrateMoyinVideoProductionLoop(
  input: MoyinVideoProductionLoopInput,
): Promise<MoyinVideoProductionLoopResult> {
  if (input.mode === "continue-approved") {
    const continuation = await orchestrateMoyinWorkflowRunContinueApproved({
      registry: input.registry,
      ...(input.toolId === undefined ? {} : { toolId: input.toolId }),
      approvalPacket: input.approvalPacket,
      ...(input.approval === undefined ? {} : { approval: input.approval }),
      ...(input.sandboxPreflight === undefined ? {} : { sandboxPreflight: input.sandboxPreflight }),
      ...(input.sandboxRuntimePolicy === undefined
        ? {}
        : { sandboxRuntimePolicy: input.sandboxRuntimePolicy }),
      ...(input.sandboxPolicy === undefined ? {} : { sandboxPolicy: input.sandboxPolicy }),
      ...(input.requestedNetworkPolicy === undefined
        ? {}
        : { requestedNetworkPolicy: input.requestedNetworkPolicy }),
      ...(input.file === undefined ? {} : { file: input.file }),
      ...(input.execution === undefined ? {} : { execution: input.execution }),
      ...(input.collectPackage === undefined ? {} : { collectPackage: input.collectPackage }),
      ...(input.watchTask === undefined ? {} : { watchTask: input.watchTask }),
      ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
      ...(input.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
      ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      ...(input.nowMs === undefined ? {} : { nowMs: input.nowMs }),
      ...(input.reissueExpiredApprovalPacket === undefined
        ? {}
        : { reissueExpiredApprovalPacket: input.reissueExpiredApprovalPacket }),
      ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
      ...(input.handoffManifestDirectory === undefined
        ? {}
        : { handoffManifestDirectory: input.handoffManifestDirectory }),
      ...(input.handoffManifestPath === undefined
        ? {}
        : { handoffManifestPath: input.handoffManifestPath }),
      ...(input.approvalPacketDirectory === undefined
        ? {}
        : { approvalPacketDirectory: input.approvalPacketDirectory }),
      ...(input.approvalPacketPath === undefined
        ? {}
        : { approvalPacketPath: input.approvalPacketPath }),
      ...(input.onEvent === undefined ? {} : { onEvent: input.onEvent }),
    });
    return createMoyinVideoProductionLoopResult({
      mode: "continue-approved",
      status: continuation.status,
      ok: continuation.ok,
      projectId: continuation.projectId,
      runId: continuation.runId,
      continuation,
      approvalPacket: continuation.nextApprovalPacket,
      operationSequence: createMoyinVideoProductionContinuationOperationSequence(continuation),
      error: normalizeMoyinVideoProductionLoopError(continuation.error),
      metadata: {
        advanceAttempted: continuation.metadata.advanceAttempted,
        executeAttempted: continuation.metadata.executeAttempted,
        packageAttempted: continuation.metadata.packageAttempted,
        approvalPacketCreated: continuation.metadata.nextApprovalPacketCreated,
      },
    });
  }

  const start = await orchestrateMoyinVideoProductionDryRunUntilNextGate(input);
  return createMoyinVideoProductionLoopResult({
    mode: "start",
    status: start.status,
    ok: start.ok,
    projectId: start.projectId,
    runId: start.runId,
    start,
    approvalPacket: start.approvalPacket,
    operationSequence: createMoyinVideoProductionStartOperationSequence(start),
    error: start.error,
    metadata: {
      advanceAttempted: start.metadata.advanceAttempted,
      executeAttempted: false,
      packageAttempted:
        start.nextGate?.metadata.packageAttempted === true ||
        start.nextGate?.resume?.metadata.packageCollected === true,
      approvalPacketCreated: start.metadata.approvalPacketCreated,
    },
  });
}

export async function createMoyinWorkflowRunFromVideoProductionPlan(
  input: MoyinWorkflowRunCreateFromVideoProductionPlanInput,
): Promise<MoyinWorkflowRunCreateFromVideoProductionPlanResult> {
  const projectId = readNonEmptyString(input.projectId) ?? readNonEmptyString(input.plan.projectId);
  const draft = createMoyinWorkflowRunDraftFromVideoProductionPlan({
    ...input.plan,
    ...(projectId === undefined ? {} : { projectId }),
  });
  if (projectId === undefined || draft.diagnostics.blockerCount > 0) {
    return {
      ok: false,
      status: "blocked",
      draft,
      error: {
        code: "MOYIN_VIDEO_PLAN_BLOCKED",
        message:
          "The Moyin workflow-run draft has unresolved blockers and was not sent to the provider.",
        recoverable: true,
      },
    };
  }

  const draftFilePath = await writeMoyinWorkflowRunDraftFile(draft.request, input.scratchRoot);
  const createResult = await invokeExternalTool(input.registry, {
    toolId: input.toolId ?? DEFAULT_MOYIN_TOOL_ID,
    operationId: "workflow-run.create",
    args: {
      projectId,
      file: draftFilePath,
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      schemaVersion: SCHEMA_VERSION,
      orchestrationPhase: "workflow-run.create",
      source: "moyin-video-production-plan",
    },
  });

  return {
    ok: createResult.ok,
    status: createResult.ok ? "created" : "failed",
    draft,
    draftFilePath,
    createResult,
    ...(createResult.ok
      ? {}
      : {
          error: {
            code: createResult.error ?? "MOYIN_WORKFLOW_RUN_CREATE_FAILED",
            message: createResult.content,
            recoverable: createResult.status !== "permission-denied",
          },
        }),
  };
}

export async function resolveMoyinVideoProductionPlanExecutionDrafts(
  input: MoyinVideoProductionPlanExecutionDraftResolutionInput,
): Promise<MoyinVideoProductionPlanExecutionDraftResolutionResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const projectId = readNonEmptyString(input.projectId) ?? readNonEmptyString(input.plan.projectId);
  const target = input.plan.target ?? "director";
  const root = await mkdtemp(join(input.scratchRoot ?? tmpdir(), "director-moyin-plan-drafts-"));
  const failures: MoyinVideoProductionExecutionDraftFailure[] = [];
  let scriptBuiltCount = 0;
  let imageBuiltCount = 0;
  let videoBuiltCount = 0;
  let scriptExecution = readRecord(input.plan.scriptExecution);

  if (
    scriptExecution === undefined &&
    (readNonEmptyString(input.plan.idea) !== undefined ||
      readNonEmptyString(input.plan.scriptText) !== undefined)
  ) {
    const result = await buildMoyinAdapterExecutionDraft(input, {
      toolId,
      root,
      operationId: "adapter.script-execution",
      kind: "script",
      path: "scriptExecution",
      fileStem: "adapter-script-execution",
      request: {
        panel: "script",
        mediaType: "text",
        workflowTarget: target,
        sceneCount: normalizePositiveInteger(input.plan.scenes?.length),
        targetDuration:
          normalizePositiveInteger(input.plan.defaultDurationSeconds) === undefined
            ? undefined
            : `${normalizePositiveInteger(input.plan.defaultDurationSeconds)}s`,
        ...(projectId === undefined ? {} : { projectId }),
      },
    });
    if (result.draft !== undefined) {
      scriptExecution = result.draft;
      scriptBuiltCount += 1;
    } else {
      failures.push(result.failure);
    }
  }

  const characters = [];
  for (const [index, character] of (input.plan.characters ?? []).entries()) {
    let imageExecution = readRecord(character.imageExecution);
    if (imageExecution === undefined && readNonEmptyString(character.prompt) !== undefined) {
      const aspectRatio = readNonEmptyString(input.plan.aspectRatio) ?? "16:9";
      const result = await buildMoyinAdapterExecutionDraft(input, {
        toolId,
        root,
        operationId: "adapter.image-execution",
        kind: "character-image",
        path: `characters.${index}.imageExecution`,
        fileStem: `adapter-character-image-execution-${index + 1}`,
        request: {
          panel: "character",
          prompt: character.prompt,
          aspectRatio,
          operation: normalizeStringArray(character.referenceImages).length > 0 ? "i2i" : "t2i",
          referenceImages: normalizeStringArray(character.referenceImages),
          ...(projectId === undefined ? {} : { projectId }),
        },
      });
      if (result.draft !== undefined) {
        imageExecution = result.draft;
        imageBuiltCount += 1;
      } else {
        failures.push(result.failure);
      }
    }
    characters.push({
      ...character,
      ...(imageExecution === undefined ? {} : { imageExecution }),
    });
  }

  const scenes = [];
  for (const [index, scene] of (input.plan.scenes ?? []).entries()) {
    let imageExecution = readRecord(scene.imageExecution);
    let videoExecution = readRecord(scene.videoExecution);
    const aspectRatio =
      readNonEmptyString(scene.aspectRatio) ?? readNonEmptyString(input.plan.aspectRatio) ?? "16:9";
    const referenceImages = normalizeStringArray(scene.referenceImages);
    const imageWithRoles = collectSceneVideoImageWithRoles(scene, videoExecution);
    const operation = inferSceneVideoOperation(scene, videoExecution);

    if (imageExecution === undefined && readNonEmptyString(scene.imagePrompt) !== undefined) {
      const result = await buildMoyinAdapterExecutionDraft(input, {
        toolId,
        root,
        operationId: "adapter.image-execution",
        kind: "image",
        path: `scenes.${index}.imageExecution`,
        fileStem: `adapter-image-execution-${index + 1}`,
        request: {
          panel: target,
          prompt: scene.imagePrompt,
          aspectRatio,
          operation: referenceImages.length > 0 ? "i2i" : "t2i",
          referenceImages,
          ...(projectId === undefined ? {} : { projectId }),
        },
      });
      if (result.draft !== undefined) {
        imageExecution = result.draft;
        imageBuiltCount += 1;
      } else {
        failures.push(result.failure);
      }
    }

    if (videoExecution === undefined && readNonEmptyString(scene.videoPrompt) !== undefined) {
      const result = await buildMoyinAdapterExecutionDraft(input, {
        toolId,
        root,
        operationId: "adapter.video-execution",
        kind: "video",
        path: `scenes.${index}.videoExecution`,
        fileStem: `adapter-video-execution-${index + 1}`,
        request: {
          panel: target,
          prompt: scene.videoPrompt,
          duration:
            normalizePositiveInteger(scene.durationSeconds) ??
            input.plan.defaultDurationSeconds ??
            5,
          aspectRatio,
          operation,
          referenceImages,
          ...(imageWithRoles.length === 0 ? {} : { imageWithRoles }),
          ...(projectId === undefined ? {} : { projectId }),
        },
      });
      if (result.draft !== undefined) {
        videoExecution = result.draft;
        videoBuiltCount += 1;
      } else {
        failures.push(result.failure);
      }
    }

    scenes.push({
      ...scene,
      ...(imageExecution === undefined ? {} : { imageExecution }),
      ...(videoExecution === undefined ? {} : { videoExecution }),
    });
  }

  const sclassGroups = [];
  for (const [index, group] of (input.plan.sclassGroups ?? []).entries()) {
    let videoExecution = readRecord(group.videoExecution);
    if (videoExecution === undefined && readNonEmptyString(group.videoPrompt) !== undefined) {
      const result = await buildMoyinAdapterExecutionDraft(input, {
        toolId,
        root,
        operationId: "adapter.video-execution",
        kind: "sclass-video",
        path: `sclassGroups.${index}.videoExecution`,
        fileStem: `adapter-sclass-video-execution-${index + 1}`,
        request: {
          panel: "sclass",
          prompt: group.videoPrompt,
          duration: input.plan.defaultDurationSeconds ?? 5,
          aspectRatio: readNonEmptyString(input.plan.aspectRatio) ?? "16:9",
          operation: "t2v",
          ...(projectId === undefined ? {} : { projectId }),
        },
      });
      if (result.draft !== undefined) {
        videoExecution = result.draft;
        videoBuiltCount += 1;
      } else {
        failures.push(result.failure);
      }
    }
    sclassGroups.push({
      ...group,
      ...(videoExecution === undefined ? {} : { videoExecution }),
    });
  }

  return {
    ok: failures.length === 0,
    plan: {
      ...input.plan,
      ...(projectId === undefined ? {} : { projectId }),
      ...(scriptExecution === undefined ? {} : { scriptExecution }),
      ...(characters.length === 0 ? {} : { characters }),
      ...(scenes.length === 0 ? {} : { scenes }),
      ...(sclassGroups.length === 0 ? {} : { sclassGroups }),
    },
    summary: {
      attempted: true,
      scriptBuiltCount,
      imageBuiltCount,
      videoBuiltCount,
      failureCount: failures.length,
      ...(failures.length === 0 ? {} : { failures }),
    },
  };
}

type MoyinAdapterExecutionDraftBuildResult =
  | {
      readonly draft: Readonly<Record<string, unknown>>;
      readonly failure?: never;
    }
  | {
      readonly draft?: never;
      readonly failure: MoyinVideoProductionExecutionDraftFailure;
    };

async function buildMoyinAdapterExecutionDraft(
  input: MoyinVideoProductionPlanExecutionDraftResolutionInput,
  options: {
    readonly toolId: string;
    readonly root: string;
    readonly operationId:
      | "adapter.image-execution"
      | "adapter.script-execution"
      | "adapter.video-execution";
    readonly kind: MoyinVideoProductionExecutionDraftKind;
    readonly path: string;
    readonly fileStem: string;
    readonly request: Readonly<Record<string, unknown>>;
  },
): Promise<MoyinAdapterExecutionDraftBuildResult> {
  const requestPath = join(options.root, `${options.fileStem}.json`);
  await writeFile(requestPath, `${JSON.stringify(options.request, null, 2)}\n`, "utf8");
  const result = await invokeExternalTool(input.registry, {
    toolId: options.toolId,
    operationId: options.operationId,
    args: { file: requestPath },
    ...(input.turnId === undefined ? {} : { turnId: `${input.turnId}:${options.path}` }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.video-production-plan.execution-drafts",
      orchestrationPhase: options.operationId,
      executionDraftKind: options.kind,
      executionDraftPath: options.path,
    },
  });
  const draft = readMoyinExecutionDraftFromInvokeResult(result);
  if (result.ok && draft !== undefined) {
    const validationError = validateMoyinSelectedExecutionDraft(draft, options.kind);
    if (validationError !== undefined) {
      return {
        failure: {
          kind: options.kind,
          path: options.path,
          ok: false,
          status: result.status,
          error: validationError.code,
          contentPreview: validationError.message,
        },
      };
    }
    return { draft };
  }
  const contentPreview = truncateText(result.content, 300);
  return {
    failure: {
      kind: options.kind,
      path: options.path,
      ok: result.ok,
      status: result.status,
      ...(result.error === undefined ? {} : { error: result.error }),
      ...(contentPreview === undefined ? {} : { contentPreview }),
    },
  };
}

function validateMoyinSelectedExecutionDraft(
  draft: Readonly<Record<string, unknown>>,
  kind: MoyinVideoProductionExecutionDraftKind,
): { readonly code: string; readonly message: string } | undefined {
  if (kind === "script") {
    return undefined;
  }
  const model = readNonEmptyString(draft.model);
  const providerId = readNonEmptyString(draft.providerId);
  if (model === undefined || providerId === undefined) {
    return {
      code: "MOYIN_USER_SELECTED_MODEL_REQUIRED",
      message:
        "Moyin adapter execution drafts for media generation must include the user-selected providerId and model. Configure Moyin models first; Director Angel must not inject provider/model defaults.",
    };
  }
  return undefined;
}

function readMoyinExecutionDraftFromInvokeResult(
  result: ExternalToolInvokeResult,
): Readonly<Record<string, unknown>> | undefined {
  const output = readRecord(result.output);
  const nestedOutput = readRecord(output?.output);
  const nestedPayload = readRecord(output?.payload) ?? readRecord(nestedOutput?.payload);
  return (
    readRecord(output?.executionDraft) ??
    readRecord(output?.execution) ??
    readRecord(nestedOutput?.executionDraft) ??
    readRecord(nestedOutput?.execution) ??
    readRecord(nestedPayload?.executionDraft) ??
    readRecord(nestedPayload?.execution)
  );
}

function hasMoyinExecutionDraftFailure(
  summary: MoyinVideoProductionDryRunAdapterDraftsSummary,
  code: string,
): boolean {
  return (
    summary.attempted === true && (summary.failures ?? []).some((failure) => failure.error === code)
  );
}

function appendScriptStep(input: {
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId: string | undefined;
  readonly steps: MoyinWorkflowRunStepDraft[];
  readonly blockers: MoyinVideoProductionPlanBlocker[];
  readonly nonExecutableStepIds: Set<string>;
}): string | undefined {
  const idea = readNonEmptyString(input.plan.idea);
  const scriptText = readNonEmptyString(input.plan.scriptText);
  if (scriptText === undefined && idea === undefined) {
    return undefined;
  }

  const isImport = scriptText !== undefined;
  const stepId = isImport ? "script-import-full-workflow" : "script-generate-from-idea";
  const execution = readRecord(input.plan.scriptExecution);
  const values: Record<string, unknown> = {};
  addOptional(values, "projectId", input.projectId);
  if (isImport) {
    addOptional(values, "text", scriptText);
  } else {
    addOptional(values, "idea", idea);
  }
  addOptional(values, "execution", execution);
  input.steps.push(
    createTemplateStep({
      stepId,
      templateId: isImport ? "script.import-full-workflow" : "script.generate-from-idea",
      values,
      execution,
      requiresApproval: false,
    }),
  );

  if (execution === undefined) {
    input.nonExecutableStepIds.add(stepId);
    input.blockers.push({
      code: "MOYIN_SCRIPT_EXECUTION_REQUIRED",
      message: "Moyin script template build requires a resolved script execution payload.",
      stepId,
      path: "scriptExecution",
      recoverable: true,
    });
  }
  return stepId;
}

function appendCharacterSteps(input: {
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId: string | undefined;
  readonly scriptStepId: string | undefined;
  readonly steps: MoyinWorkflowRunStepDraft[];
  readonly blockers: MoyinVideoProductionPlanBlocker[];
  readonly paidStepIds: Set<string>;
  readonly nonExecutableStepIds: Set<string>;
}): readonly string[] {
  const stepIds: string[] = [];
  for (const [index, character] of (input.plan.characters ?? []).entries()) {
    const stepId = `character-${index + 1}-portrait-image`;
    const values: Record<string, unknown> = {
      characterId: character.characterId,
      characterName: character.characterName,
      prompt: character.prompt,
    };
    addOptional(values, "projectId", input.projectId);
    addOptional(values, "execution", readRecord(character.imageExecution));
    addOptional(values, "negativePrompt", readNonEmptyString(character.negativePrompt));
    addOptional(values, "referenceImages", normalizeStringArray(character.referenceImages));
    addOptional(values, "styleId", readNonEmptyString(character.styleId));
    addOptional(values, "visualTraits", readNonEmptyString(character.visualTraits));
    addOptional(values, "viewType", readNonEmptyString(character.viewType));
    input.steps.push(
      createTemplateStep({
        stepId,
        templateId: "character.portrait-image",
        values,
        execution: readRecord(character.imageExecution),
        dependencies: optionalDependency(input.scriptStepId),
        requiresApproval: true,
        maxAttempts: 2,
      }),
    );
    input.paidStepIds.add(stepId);
    stepIds.push(stepId);
    if (readRecord(character.imageExecution) === undefined) {
      input.nonExecutableStepIds.add(stepId);
      input.blockers.push({
        code: "MOYIN_CHARACTER_IMAGE_EXECUTION_REQUIRED",
        message: "Moyin character portrait image steps require a resolved image execution payload.",
        stepId,
        path: `characters.${index}.imageExecution`,
        recoverable: true,
      });
    }
  }
  return stepIds;
}

function createSceneVideoExecutionWithInputs(
  scene: MoyinVideoProductionScenePlan,
): Readonly<Record<string, unknown>> | undefined {
  const videoExecution = readRecord(scene.videoExecution);
  if (videoExecution === undefined) {
    return undefined;
  }
  const imageWithRoles = collectSceneVideoImageWithRoles(scene, videoExecution);
  const referenceImages = collectSceneVideoReferenceImages(scene, videoExecution);
  return {
    ...videoExecution,
    ...(imageWithRoles.length === 0 ? {} : { imageWithRoles }),
    ...(referenceImages.length === 0 ? {} : { referenceImages }),
  };
}

function inferSceneVideoOperation(
  scene: MoyinVideoProductionScenePlan,
  videoExecution: Readonly<Record<string, unknown>> | undefined,
): MoyinVideoOperation {
  const explicitOperation =
    readMoyinVideoOperation(scene.operation) ?? readMoyinVideoOperation(videoExecution?.operation);
  if (explicitOperation !== undefined) {
    return explicitOperation;
  }

  const selectedOperation = readMoyinVideoOperationFromSelected(videoExecution?.selectedOperation);
  if (selectedOperation !== undefined) {
    return selectedOperation;
  }

  const imageWithRoles = collectSceneVideoImageWithRoles(scene, videoExecution);
  if (
    imageWithRoles.some((item) => item.role === "first_frame") &&
    imageWithRoles.some((item) => item.role === "last_frame")
  ) {
    return "first_last_frame";
  }
  if (imageWithRoles.length > 0) {
    return "i2v";
  }
  if (collectSceneVideoReferenceImages(scene, videoExecution).length > 0) {
    return "r2v";
  }
  return "t2v";
}

function readMoyinVideoOperation(value: unknown): MoyinVideoOperation | undefined {
  const operation = readNonEmptyString(value);
  return operation === "t2v" ||
    operation === "i2v" ||
    operation === "r2v" ||
    operation === "first_last_frame" ||
    operation === "video_edit"
    ? operation
    : undefined;
}

function readMoyinVideoOperationFromSelected(value: unknown): MoyinVideoOperation | undefined {
  const selected = readNonEmptyString(value);
  if (selected === "text_to_video") {
    return "t2v";
  }
  if (selected === "image_to_video") {
    return "i2v";
  }
  if (selected === "reference_to_video" || selected === "multi_reference_video") {
    return "r2v";
  }
  if (selected === "first_last_frame_video") {
    return "first_last_frame";
  }
  if (selected === "video_edit") {
    return "video_edit";
  }
  return undefined;
}

function collectSceneVideoImageWithRoles(
  scene: MoyinVideoProductionScenePlan,
  videoExecution: Readonly<Record<string, unknown>> | undefined,
): readonly MoyinVideoImageWithRole[] {
  const imageWithRoles: MoyinVideoImageWithRole[] = [];
  appendVideoImageWithRoles(imageWithRoles, normalizeVideoImageWithRoles(scene.imageWithRoles));
  appendVideoImageRole(imageWithRoles, "first_frame", scene.firstFrameImage);
  appendVideoImageRole(imageWithRoles, "last_frame", scene.lastFrameImage);
  appendVideoImageWithRoles(
    imageWithRoles,
    normalizeVideoImageWithRoles(videoExecution?.imageWithRoles),
  );
  return imageWithRoles;
}

function collectSceneVideoReferenceImages(
  scene: MoyinVideoProductionScenePlan,
  videoExecution: Readonly<Record<string, unknown>> | undefined,
): readonly string[] {
  const values: string[] = [];
  appendUniqueStrings(values, normalizeStringArray(scene.referenceImages));
  appendUniqueStrings(values, normalizeStringArray(videoExecution?.referenceImages));
  return values;
}

function normalizeVideoImageWithRoles(value: unknown): readonly MoyinVideoImageWithRole[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const imageWithRoles: MoyinVideoImageWithRole[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const url = readNonEmptyString(record?.url);
    if (url === undefined) {
      continue;
    }
    if (record?.role === "first_frame" || record?.role === "last_frame") {
      imageWithRoles.push({ role: record.role, url });
    }
  }
  return imageWithRoles;
}

function appendVideoImageWithRoles(
  target: MoyinVideoImageWithRole[],
  values: readonly MoyinVideoImageWithRole[],
): void {
  for (const value of values) {
    appendVideoImageRole(target, value.role, value.url);
  }
}

function appendVideoImageRole(
  target: MoyinVideoImageWithRole[],
  role: MoyinVideoImageWithRole["role"],
  value: unknown,
): void {
  const url = readNonEmptyString(value);
  if (url === undefined) {
    return;
  }
  if (!target.some((item) => item.role === role && item.url === url)) {
    target.push({ role, url });
  }
}

function appendUniqueStrings(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) {
      target.push(value);
    }
  }
}

function appendSceneVideoOperationBlockers(input: {
  readonly sceneIndex: number;
  readonly stepId: string;
  readonly operation: MoyinVideoOperation;
  readonly imageWithRoles: readonly MoyinVideoImageWithRole[];
  readonly referenceImages: readonly string[];
  readonly blockers: MoyinVideoProductionPlanBlocker[];
  readonly nonExecutableStepIds: Set<string>;
}): void {
  const hasFirstFrame = input.imageWithRoles.some((item) => item.role === "first_frame");
  const hasLastFrame = input.imageWithRoles.some((item) => item.role === "last_frame");

  if (input.operation === "i2v" && !hasFirstFrame) {
    input.nonExecutableStepIds.add(input.stepId);
    input.blockers.push({
      code: "MOYIN_VIDEO_I2V_FIRST_FRAME_REQUIRED",
      message: "Moyin image-to-video steps require a first-frame image before paid execution.",
      stepId: input.stepId,
      path: `scenes.${input.sceneIndex}.firstFrameImage`,
      recoverable: true,
    });
    return;
  }

  if (input.operation === "first_last_frame" && (!hasFirstFrame || !hasLastFrame)) {
    input.nonExecutableStepIds.add(input.stepId);
    input.blockers.push({
      code: "MOYIN_VIDEO_FIRST_LAST_FRAME_REQUIRED",
      message: "Moyin first/last-frame video steps require both first and last frame images.",
      stepId: input.stepId,
      path: hasFirstFrame
        ? `scenes.${input.sceneIndex}.lastFrameImage`
        : hasLastFrame
          ? `scenes.${input.sceneIndex}.firstFrameImage`
          : `scenes.${input.sceneIndex}.imageWithRoles`,
      recoverable: true,
    });
    return;
  }

  if (input.operation === "r2v" && input.referenceImages.length === 0) {
    input.nonExecutableStepIds.add(input.stepId);
    input.blockers.push({
      code: "MOYIN_VIDEO_R2V_REFERENCE_IMAGES_REQUIRED",
      message: "Moyin reference-to-video steps require at least one reference image.",
      stepId: input.stepId,
      path: `scenes.${input.sceneIndex}.referenceImages`,
      recoverable: true,
    });
  }
}

function appendDirectorSteps(input: {
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId: string | undefined;
  readonly scriptStepId: string | undefined;
  readonly characterStepIds: readonly string[];
  readonly steps: MoyinWorkflowRunStepDraft[];
  readonly blockers: MoyinVideoProductionPlanBlocker[];
  readonly paidStepIds: Set<string>;
  readonly nonExecutableStepIds: Set<string>;
}): void {
  for (const [index, scene] of (input.plan.scenes ?? []).entries()) {
    const sceneNumber = normalizeSceneNumber(scene.sceneId, index);
    const sceneName = readNonEmptyString(scene.name) ?? `Scene ${index + 1}`;
    const imageStepId = `director-scene-${index + 1}-image-first`;
    if (readNonEmptyString(scene.imagePrompt) !== undefined) {
      const imageExecution = readRecord(scene.imageExecution);
      const values: Record<string, unknown> = {
        sceneId: sceneNumber,
        sceneName,
        frameType: "first",
      };
      addOptional(values, "projectId", input.projectId);
      addOptional(values, "execution", imageExecution);
      addOptional(values, "persistLabel", readNonEmptyString(scene.persistLabel));
      addOptional(values, "width", normalizePositiveInteger(scene.width));
      addOptional(values, "height", normalizePositiveInteger(scene.height));
      input.steps.push(
        createTemplateStep({
          stepId: imageStepId,
          templateId: "director.scene-image",
          values,
          execution: imageExecution,
          dependencies: [...optionalDependency(input.scriptStepId), ...input.characterStepIds],
          requiresApproval: true,
          maxAttempts: 2,
        }),
      );
      input.paidStepIds.add(imageStepId);
      if (imageExecution === undefined) {
        input.nonExecutableStepIds.add(imageStepId);
        input.blockers.push({
          code: "MOYIN_IMAGE_EXECUTION_REQUIRED",
          message: "Moyin director scene image steps require a resolved image execution payload.",
          stepId: imageStepId,
          path: `scenes.${index}.imageExecution`,
          recoverable: true,
        });
      }
    }

    if (readNonEmptyString(scene.videoPrompt) === undefined) {
      continue;
    }
    const videoStepId = `director-scene-${index + 1}-video`;
    const videoExecution = createSceneVideoExecutionWithInputs(scene);
    const operation = inferSceneVideoOperation(scene, videoExecution);
    const imageWithRoles = collectSceneVideoImageWithRoles(scene, videoExecution);
    const referenceImages = collectSceneVideoReferenceImages(scene, videoExecution);
    const values: Record<string, unknown> = {
      sceneId: sceneNumber,
    };
    addOptional(values, "projectId", input.projectId);
    addOptional(values, "execution", videoExecution);
    addOptional(values, "operation", operation);
    if (imageWithRoles.length > 0) {
      addOptional(values, "imageWithRoles", imageWithRoles);
    }
    if (referenceImages.length > 0) {
      addOptional(values, "referenceImages", referenceImages);
    }
    addOptional(values, "persistLabel", readNonEmptyString(scene.persistLabel));
    addOptional(values, "extractEndFrame", true);
    input.steps.push(
      createTemplateStep({
        stepId: videoStepId,
        templateId: "director.scene-video",
        values,
        execution: videoExecution,
        dependencies: input.steps.some((step) => step.stepId === imageStepId)
          ? [imageStepId]
          : [...optionalDependency(input.scriptStepId), ...input.characterStepIds],
        requiresApproval: true,
        maxAttempts: 2,
      }),
    );
    input.paidStepIds.add(videoStepId);
    if (videoExecution === undefined) {
      input.nonExecutableStepIds.add(videoStepId);
      input.blockers.push({
        code: "MOYIN_VIDEO_EXECUTION_REQUIRED",
        message: "Moyin director scene video steps require a resolved video execution payload.",
        stepId: videoStepId,
        path: `scenes.${index}.videoExecution`,
        recoverable: true,
      });
    }
    appendSceneVideoOperationBlockers({
      sceneIndex: index,
      stepId: videoStepId,
      operation,
      imageWithRoles,
      referenceImages,
      blockers: input.blockers,
      nonExecutableStepIds: input.nonExecutableStepIds,
    });
  }
}

function appendSclassSteps(input: {
  readonly plan: MoyinVideoProductionPlan;
  readonly projectId: string | undefined;
  readonly scriptStepId: string | undefined;
  readonly characterStepIds: readonly string[];
  readonly steps: MoyinWorkflowRunStepDraft[];
  readonly blockers: MoyinVideoProductionPlanBlocker[];
  readonly paidStepIds: Set<string>;
  readonly nonExecutableStepIds: Set<string>;
}): void {
  const referenceStepIds = new Map<string, string>();
  for (const [index, scene] of (input.plan.scenes ?? []).entries()) {
    if (readNonEmptyString(scene.imagePrompt) === undefined) {
      continue;
    }
    const stepId = `scene-reference-${index + 1}-image`;
    const sceneKey = String(scene.sceneId ?? index + 1);
    const imageExecution = readRecord(scene.imageExecution);
    const values: Record<string, unknown> = {
      sceneId: sceneKey,
      sceneName: readNonEmptyString(scene.name) ?? `Scene ${index + 1}`,
      prompt: readNonEmptyString(scene.imagePrompt),
    };
    addOptional(values, "projectId", input.projectId);
    addOptional(values, "execution", imageExecution);
    addOptional(values, "referenceImages", normalizeStringArray(scene.referenceImages));
    input.steps.push(
      createTemplateStep({
        stepId,
        templateId: "scene.reference-image",
        values,
        execution: imageExecution,
        dependencies: [...optionalDependency(input.scriptStepId), ...input.characterStepIds],
        requiresApproval: true,
        maxAttempts: 2,
      }),
    );
    input.paidStepIds.add(stepId);
    referenceStepIds.set(sceneKey, stepId);
    if (imageExecution === undefined) {
      input.nonExecutableStepIds.add(stepId);
      input.blockers.push({
        code: "MOYIN_SCENE_REFERENCE_EXECUTION_REQUIRED",
        message: "Moyin scene reference image steps require a resolved image execution payload.",
        stepId,
        path: `scenes.${index}.imageExecution`,
        recoverable: true,
      });
    }
  }

  for (const [index, group] of (input.plan.sclassGroups ?? []).entries()) {
    const stepId = `sclass-group-${index + 1}-video`;
    const videoExecution = readRecord(group.videoExecution);
    const dependencies = group.sceneIds.flatMap((sceneId) => {
      const referenceStepId = referenceStepIds.get(String(sceneId));
      return referenceStepId === undefined ? [] : [referenceStepId];
    });
    const values: Record<string, unknown> = {
      groupId: group.groupId,
      groupName: group.groupName,
      sceneIds: [...group.sceneIds],
    };
    addOptional(values, "projectId", input.projectId);
    addOptional(values, "execution", videoExecution);
    addOptional(values, "gridValidation", readRecord(group.gridValidation));
    addOptional(values, "historyAssetRefs", normalizeUnknownArray(group.historyAssetRefs));
    input.steps.push(
      createTemplateStep({
        stepId,
        templateId: "sclass.group-video",
        values,
        execution: videoExecution,
        dependencies,
        requiresApproval: true,
        maxAttempts: 2,
      }),
    );
    input.paidStepIds.add(stepId);
    if (videoExecution === undefined) {
      input.nonExecutableStepIds.add(stepId);
      input.blockers.push({
        code: "MOYIN_SCLASS_VIDEO_EXECUTION_REQUIRED",
        message: "Moyin S-Class group video steps require a resolved video execution payload.",
        stepId,
        path: `sclassGroups.${index}.videoExecution`,
        recoverable: true,
      });
    }
  }
}

function createTemplateStep(input: {
  readonly stepId: string;
  readonly templateId: MoyinTaskTemplateId;
  readonly values: Readonly<Record<string, unknown>>;
  readonly execution?: Readonly<Record<string, unknown>> | undefined;
  readonly dependencies?: readonly string[];
  readonly requiresApproval: boolean;
  readonly maxAttempts?: number;
}): MoyinWorkflowRunStepDraft {
  const payload: Record<string, unknown> = {
    values: input.values,
  };
  addOptional(payload, "execution", input.execution);
  return {
    stepId: input.stepId,
    command: "task.template.build",
    templateId: input.templateId,
    payload,
    dependencies: input.dependencies ?? [],
    requiresApproval: input.requiresApproval,
    retryable: true,
    maxAttempts: input.maxAttempts ?? 1,
  };
}

function createInputSummary(
  plan: MoyinVideoProductionPlan,
  target: MoyinVideoProductionTarget,
): Readonly<Record<string, unknown>> {
  const summary: Record<string, unknown> = {
    kind: "director.videoProductionPlan",
    source: "director-angel",
    target,
    sceneCount: plan.scenes?.length ?? 0,
    characterCount: plan.characters?.length ?? 0,
    sclassGroupCount: plan.sclassGroups?.length ?? 0,
  };
  addOptional(summary, "ideaPreview", truncateText(readNonEmptyString(plan.idea), 500));
  addOptional(summary, "scriptTextPreview", truncateText(readNonEmptyString(plan.scriptText), 500));
  addOptional(summary, "aspectRatio", readNonEmptyString(plan.aspectRatio));
  addOptional(
    summary,
    "defaultDurationSeconds",
    normalizePositiveInteger(plan.defaultDurationSeconds),
  );
  return summary;
}

function inferWorkflowRunComplexity(
  steps: readonly MoyinWorkflowRunStepDraft[],
): MoyinWorkflowRunComplexity {
  return steps.length > 1 || steps.some((step) => step.dependencies.length > 0)
    ? "simple_dag"
    : "linear";
}

function optionalDependency(stepId: string | undefined): readonly string[] {
  return stepId === undefined ? [] : [stepId];
}

function normalizeSceneNumber(sceneId: string | number | undefined, index: number): number {
  if (typeof sceneId === "number" && Number.isFinite(sceneId)) {
    return Math.max(1, Math.floor(sceneId));
  }
  if (typeof sceneId === "string") {
    const parsed = Number.parseInt(sceneId, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed);
    }
  }
  return index + 1;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function normalizeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = readNonEmptyString(item);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
}

function normalizeUnknownArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function createMoyinVideoProductionLoopResult(input: {
  readonly mode: MoyinVideoProductionLoopMode;
  readonly status: MoyinVideoProductionLoopStatus;
  readonly ok: boolean;
  readonly projectId?: string | undefined;
  readonly runId?: string | undefined;
  readonly operationSequence: readonly string[];
  readonly start?: MoyinVideoProductionDryRunUntilNextGateResult | undefined;
  readonly continuation?: MoyinWorkflowRunApprovedContinuationResult | undefined;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacketResult | undefined;
  readonly error?: MoyinVideoProductionLoopResult["error"] | undefined;
  readonly metadata: {
    readonly advanceAttempted: boolean;
    readonly executeAttempted: boolean;
    readonly packageAttempted: boolean;
    readonly approvalPacketCreated: boolean;
  };
}): MoyinVideoProductionLoopResult {
  return {
    ok: input.ok,
    mode: input.mode,
    status: input.status,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    operationSequence: input.operationSequence,
    ...(input.start === undefined ? {} : { start: input.start }),
    ...(input.continuation === undefined ? {} : { continuation: input.continuation }),
    ...(input.approvalPacket === undefined ? {} : { approvalPacket: input.approvalPacket }),
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      schemaVersion: "director.moyin.video-production.loop.v1",
      submitAttempted: false,
      advanceAttempted: input.metadata.advanceAttempted,
      executeAttempted: input.metadata.executeAttempted,
      packageAttempted: input.metadata.packageAttempted,
      approvalPacketCreated: input.metadata.approvalPacketCreated,
    },
  };
}

function createMoyinVideoProductionStartOperationSequence(
  result: MoyinVideoProductionDryRunUntilNextGateResult,
): readonly string[] {
  return [
    "video-production.plan",
    ...(result.metadata.runCreated ? ["workflow-run.create"] : []),
    ...(result.metadata.nextGateAttempted ? ["workflow-run.until-next-gate"] : []),
    ...(result.metadata.approvalPacketCreated ? ["workflow-run.approval-packet"] : []),
  ];
}

function createMoyinVideoProductionContinuationOperationSequence(
  result: MoyinWorkflowRunApprovedContinuationResult,
): readonly string[] {
  return [
    "workflow-run.continue-approved",
    ...(result.metadata.advanceAttempted ? ["workflow-run.advance"] : []),
    ...(result.metadata.executeAttempted ? ["workflow-run.execute"] : []),
    ...(result.execute?.watch === undefined ? [] : ["task.watch"]),
    ...(result.metadata.nextGateAttempted ? ["workflow-run.until-next-gate"] : []),
    ...(result.metadata.nextApprovalPacketCreated ? ["workflow-run.approval-packet"] : []),
    ...(result.metadata.packageAttempted ? ["workflow-run.package"] : []),
  ];
}

function normalizeMoyinVideoProductionLoopError(
  error: MoyinWorkflowRunApprovedContinuationResult["error"] | undefined,
): MoyinVideoProductionLoopResult["error"] | undefined {
  if (error === undefined) {
    return undefined;
  }
  return {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable ?? true,
  };
}

function emitMoyinVideoProductionLoopEvent(
  input: {
    readonly onEvent?: (event: MoyinWorkflowRunExecuteAndPackageEvent) => void;
    readonly projectId?: string;
    readonly plan: MoyinVideoProductionPlan;
  },
  event: Omit<MoyinWorkflowRunExecuteAndPackageEvent, "occurredAtMs" | "projectId"> & {
    readonly projectId?: string;
  },
): void {
  const projectId =
    readNonEmptyString(event.projectId) ??
    readNonEmptyString(input.projectId) ??
    readNonEmptyString(input.plan.projectId);
  if (projectId === undefined) {
    return;
  }
  input.onEvent?.({
    ...event,
    projectId,
    occurredAtMs: Date.now(),
  });
}

function createMoyinVideoProductionDryRunUntilNextGateResult(input: {
  readonly input: MoyinVideoProductionDryRunUntilNextGateInput;
  readonly dryRun: MoyinVideoProductionDryRunWorkflowResult;
  readonly projectId?: string | undefined;
  readonly runId?: string | undefined;
  readonly nextGate?: MoyinWorkflowRunUntilNextGateResult | undefined;
  readonly approvalPacket?: MoyinWorkflowRunApprovalPacketResult | undefined;
  readonly status: MoyinVideoProductionDryRunUntilNextGateStatus;
  readonly error?: MoyinVideoProductionDryRunUntilNextGateResult["error"] | undefined;
  readonly runCreated: boolean;
  readonly nextGateAttempted: boolean;
  readonly approvalPacketCreated: boolean;
}): MoyinVideoProductionDryRunUntilNextGateResult {
  return {
    ok:
      input.error === undefined &&
      input.dryRun.ok &&
      (input.nextGate === undefined || input.nextGate.ok) &&
      (input.approvalPacket === undefined || input.approvalPacket.ok),
    status: input.status,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    dryRun: input.dryRun,
    ...(input.nextGate === undefined ? {} : { nextGate: input.nextGate }),
    ...(input.approvalPacket === undefined ? {} : { approvalPacket: input.approvalPacket }),
    ...(input.error === undefined ? {} : { error: input.error }),
    metadata: {
      schemaVersion: "director.moyin.video-production.dry-run-until-next-gate.v1",
      submitAttempted: false,
      advanceAttempted: false,
      runCreated: input.runCreated,
      nextGateAttempted: input.nextGateAttempted,
      approvalPacketCreated: input.approvalPacketCreated,
    },
  };
}

function normalizeMoyinVideoProductionDryRunUntilNextGateStatus(
  status: MoyinWorkflowRunUntilNextGateResult["status"],
): MoyinVideoProductionDryRunUntilNextGateStatus {
  return status;
}

function readMoyinWorkflowRunId(result: ExternalToolInvokeResult | undefined): string | undefined {
  const output = readRecord(result?.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(output?.payload) ?? readRecord(nestedOutput?.payload);
  return (
    recordString(output, "runId") ??
    recordString(nestedOutput, "runId") ??
    recordString(payload, "runId") ??
    recordString(output, "id") ??
    recordString(nestedOutput, "id") ??
    recordString(payload, "id")
  );
}

function recordString(value: unknown, key: string): string | undefined {
  const record = readRecord(value);
  const nested = record?.[key];
  return readNonEmptyString(nested);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function addOptional(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

async function writeMoyinWorkflowRunDraftFile(
  request: MoyinWorkflowRunCreateRequestDraft,
  scratchRoot: string | undefined,
): Promise<string> {
  const workDir = await mkdtemp(join(scratchRoot ?? tmpdir(), "director-moyin-video-plan-"));
  const draftFilePath = join(workDir, "workflow-run.json");
  await writeFile(draftFilePath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return draftFilePath;
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined || value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
