import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ConversationRuntimeExternalArtifactStore } from "./external-artifact-store.js";
import type { ExternalToolInvokeResult, ExternalToolRegistry } from "./external-tools.js";
import type { ExternalToolArtifact } from "./external-tools.js";
import { invokeExternalTool } from "./external-tools.js";
import { evaluateMoyinProjectReadiness } from "./moyin-project-readiness.js";
import type {
  MoyinWorkflowRunNextActionPlanAction,
  MoyinWorkflowRunUntilNextGateResult,
} from "./moyin-workflow-run-orchestrator.js";
import { orchestrateMoyinWorkflowRunUntilNextGate } from "./moyin-workflow-run-orchestrator.js";

const DEFAULT_MOYIN_TOOL_ID = "moyin.provider";

export type MoyinProductionReadinessStatus =
  | "blocked"
  | "complete_ready"
  | "partial"
  | "ready_for_workflow_run"
  | "waiting"
  | "waiting_for_approval";

export interface MoyinProductionReadinessInput {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId?: string;
  readonly runId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly approvalPacketDirectory?: string;
  readonly handoffManifestDirectory?: string;
  readonly readinessReportDirectory?: string;
  readonly readinessReportPath?: string;
  readonly collectPackage?: boolean;
  readonly watchTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MoyinProductionReadinessGate {
  readonly id:
    | "artifact-package"
    | "control-plane"
    | "model-catalog"
    | "moyin-project"
    | "provider-api-key"
    | "run-next-action"
    | "workflow-run";
  readonly status: "blocked" | "passed" | "unknown" | "waiting";
  readonly summary: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface MoyinProductionReadinessReport {
  readonly schemaVersion: "director.moyin.production-readiness.v1";
  readonly provider: "moyin";
  readonly status: MoyinProductionReadinessStatus;
  readonly blockerCode?:
    | "MOYIN_PROJECT_REQUIRED"
    | "MOYIN_PROVIDER_API_KEY_REQUIRED"
    | "MOYIN_USER_SELECTED_MODEL_REQUIRED";
  readonly projectId?: string;
  readonly runId?: string;
  readonly gates: readonly MoyinProductionReadinessGate[];
  readonly handshake: ExternalToolInvokeResult;
  readonly nextGate?: MoyinWorkflowRunUntilNextGateResult;
  readonly effectiveNextAction?: MoyinWorkflowRunNextActionPlanAction;
  readonly readinessArtifact?: ExternalToolArtifact;
  readonly nextActions: readonly string[];
  readonly mutation: {
    readonly advanceAttempted: false;
    readonly executeAttempted: false;
    readonly submitAttempted: false;
  };
  readonly metadata: {
    readonly schemaVersion: "director.moyin.production-readiness.metadata.v1";
    readonly referencePatterns: readonly string[];
    readonly collectPackageAttempted: boolean;
    readonly approvalPacketAttempted: boolean;
    readonly readinessArtifactPersisted: boolean;
  };
}

export async function evaluateMoyinProductionReadiness(
  input: MoyinProductionReadinessInput,
): Promise<MoyinProductionReadinessReport> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const handshake = await invokeExternalTool(input.registry, {
    toolId,
    operationId: "capabilities.handshake",
    args: {
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    },
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.production-readiness",
      orchestrationPhase: "capability-handshake",
      submitAttempted: false,
      advanceAttempted: false,
      executeAttempted: false,
    },
  });
  const handshakeOutput = readMoyinHandshakeOutput(handshake.output);
  const handshakeGates = createMoyinHandshakeGates(handshake, handshakeOutput);

  if (!handshake.ok) {
    return createMoyinProductionReadinessReport(input, {
      handshake,
      gates: handshakeGates,
      status: "blocked",
      nextActions: [
        "Start Moyin and fix the capability handshake before creating or resuming a run.",
      ],
    });
  }

  const projectReadiness = await evaluateMoyinProjectReadiness({
    registry: input.registry,
    toolId,
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.production-readiness",
      orchestrationPhase: "project-readiness",
      submitAttempted: false,
      advanceAttempted: false,
      executeAttempted: false,
    },
  });
  const projectGate = projectReadiness.gates.find((gate) => gate.id === "moyin-project");
  const effectiveProjectId = input.projectId ?? projectReadiness.project?.projectId;
  if (projectReadiness.status === "blocked" || effectiveProjectId === undefined) {
    return createMoyinProductionReadinessReport(input, {
      handshake,
      gates: [
        ...handshakeGates,
        ...(projectGate === undefined
          ? [createMissingMoyinProjectGate()]
          : [mapMoyinProjectReadinessGate(projectGate)]),
      ],
      status: "blocked",
      blockerCode: mapMoyinProjectReadinessBlocker(projectReadiness.blockerCode),
      nextActions: projectReadiness.nextActions,
      ...(effectiveProjectId === undefined ? {} : { projectId: effectiveProjectId }),
    });
  }

  if (input.runId === undefined) {
    return createMoyinProductionReadinessReport(input, {
      handshake,
      gates: [
        ...handshakeGates,
        ...(projectGate === undefined ? [] : [mapMoyinProjectReadinessGate(projectGate)]),
        {
          id: "workflow-run",
          status: "waiting",
          summary:
            "No workflow-run was supplied; readiness is limited to provider capability discovery.",
        },
      ],
      status: "ready_for_workflow_run",
      nextActions: [
        "Create a no-submit Moyin workflow-run through the shared runtime, then rerun readiness with projectId and runId.",
      ],
      projectId: effectiveProjectId,
    });
  }

  const nextGate = await orchestrateMoyinWorkflowRunUntilNextGate({
    registry: input.registry,
    toolId,
    projectId: effectiveProjectId,
    runId: input.runId,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(input.artifactStore === undefined ? {} : { artifactStore: input.artifactStore }),
    ...(input.approvalPacketDirectory === undefined
      ? {}
      : { approvalPacketDirectory: input.approvalPacketDirectory }),
    ...(input.handoffManifestDirectory === undefined
      ? {}
      : { handoffManifestDirectory: input.handoffManifestDirectory }),
    collectPackage: input.collectPackage ?? true,
    createApprovalPacket: true,
    ...(input.watchTimeoutMs === undefined ? {} : { watchTimeoutMs: input.watchTimeoutMs }),
    ...(input.heartbeatIntervalMs === undefined
      ? {}
      : { heartbeatIntervalMs: input.heartbeatIntervalMs }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.production-readiness",
      submitAttempted: false,
      advanceAttempted: false,
      executeAttempted: false,
    },
  });

  const gates = [
    ...handshakeGates,
    ...(projectGate === undefined ? [] : [mapMoyinProjectReadinessGate(projectGate)]),
    createMoyinWorkflowRunGate(nextGate),
    createMoyinNextActionGate(nextGate),
    createMoyinArtifactPackageGate(nextGate),
  ];

  return createMoyinProductionReadinessReport(input, {
    handshake,
    nextGate,
    gates,
    status: mapMoyinReadinessStatus(nextGate),
    nextActions: createMoyinReadinessNextActions(nextGate),
  });
}

function createMoyinProductionReadinessReport(
  input: MoyinProductionReadinessInput,
  result: {
    readonly handshake: ExternalToolInvokeResult;
    readonly gates: readonly MoyinProductionReadinessGate[];
    readonly status: MoyinProductionReadinessStatus;
    readonly blockerCode?: MoyinProductionReadinessReport["blockerCode"];
    readonly nextActions: readonly string[];
    readonly nextGate?: MoyinWorkflowRunUntilNextGateResult | undefined;
    readonly projectId?: string;
  },
): MoyinProductionReadinessReport {
  const reportWithoutArtifact = {
    schemaVersion: "director.moyin.production-readiness.v1",
    provider: "moyin",
    status: result.status,
    ...(result.blockerCode === undefined ? {} : { blockerCode: result.blockerCode }),
    ...((result.projectId ?? input.projectId) === undefined
      ? {}
      : { projectId: result.projectId ?? input.projectId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    gates: result.gates,
    handshake: result.handshake,
    ...(result.nextGate === undefined ? {} : { nextGate: result.nextGate }),
    ...(result.nextGate === undefined
      ? {}
      : { effectiveNextAction: result.nextGate.effectiveNextAction }),
    nextActions: result.nextActions,
    mutation: {
      advanceAttempted: false,
      executeAttempted: false,
      submitAttempted: false,
    },
    metadata: {
      schemaVersion: "director.moyin.production-readiness.metadata.v1",
      referencePatterns: [
        "hermes.run-status-handoff",
        "hermes.approval-queue",
        "openclaw.provider-contract",
        "openclaw.tool-policy",
        "openclaw.event-artifact-handoff",
      ],
      collectPackageAttempted: input.projectId !== undefined && input.runId !== undefined,
      approvalPacketAttempted: input.projectId !== undefined && input.runId !== undefined,
      readinessArtifactPersisted: false,
    },
  } satisfies Omit<MoyinProductionReadinessReport, "readinessArtifact">;
  const readinessArtifact = writeMoyinProductionReadinessArtifact(input, reportWithoutArtifact);
  if (readinessArtifact === undefined) {
    return reportWithoutArtifact;
  }
  const reportWithArtifact = {
    ...reportWithoutArtifact,
    readinessArtifact: readinessArtifact.artifact,
    metadata: {
      ...reportWithoutArtifact.metadata,
      readinessArtifactPersisted: readinessArtifact.persistenceStatus === "ok",
    },
  };
  if (readinessArtifact.artifact.path !== undefined) {
    writeFileSync(
      readinessArtifact.artifact.path,
      `${JSON.stringify(reportWithArtifact, null, 2)}\n`,
      "utf8",
    );
  }
  return reportWithArtifact;
}

function writeMoyinProductionReadinessArtifact(
  input: MoyinProductionReadinessInput,
  report: Omit<MoyinProductionReadinessReport, "readinessArtifact">,
):
  | {
      readonly artifact: ExternalToolArtifact;
      readonly persistenceStatus?: "degraded" | "ok";
    }
  | undefined {
  const readinessPath = createMoyinProductionReadinessPath(input, report);
  if (readinessPath === undefined) {
    return undefined;
  }
  mkdirSync(dirname(readinessPath), { recursive: true });
  const artifact: ExternalToolArtifact = {
    id: createMoyinProductionReadinessArtifactId(report),
    kind: "json",
    path: readinessPath,
    metadata: {
      provider: "moyin",
      role: "production-readiness-report",
      schemaVersion: report.schemaVersion,
      status: report.status,
      ...(report.projectId === undefined ? {} : { projectId: report.projectId }),
      ...(report.runId === undefined ? {} : { runId: report.runId }),
      effectiveNextAction: report.effectiveNextAction?.kind,
      gateCount: report.gates.length,
      blockedGateCount: report.gates.filter((gate) => gate.status === "blocked").length,
      waitingGateCount: report.gates.filter((gate) => gate.status === "waiting").length,
      advanceAttempted: false,
      executeAttempted: false,
      submitAttempted: false,
      retention: "user_controlled",
      sensitivity: "internal",
      cleanupPolicyRef: "artifactPolicy.moyin.readiness-report.user-controlled",
    },
  };
  const persistence = input.artifactStore?.upsertArtifacts({
    providerId: "moyin",
    toolId: input.toolId ?? DEFAULT_MOYIN_TOOL_ID,
    operationId: "workflow-run.production-readiness",
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    ...(report.projectId === undefined ? {} : { projectId: report.projectId }),
    ...(report.runId === undefined ? {} : { runId: report.runId }),
    artifacts: [artifact],
    retention: "user_controlled",
    sensitivity: "internal",
    cleanupPolicyRef: "artifactPolicy.moyin.readiness-report.user-controlled",
  });
  return {
    artifact,
    ...(persistence === undefined ? {} : { persistenceStatus: persistence.status }),
  };
}

function createMoyinProductionReadinessPath(
  input: MoyinProductionReadinessInput,
  report: Omit<MoyinProductionReadinessReport, "readinessArtifact">,
): string | undefined {
  if (input.readinessReportPath !== undefined) {
    return input.readinessReportPath;
  }
  if (input.readinessReportDirectory === undefined) {
    return undefined;
  }
  const projectSegment = safeMoyinReadinessPathToken(report.projectId ?? "provider");
  const runSegment = safeMoyinReadinessPathToken(report.runId ?? "no-run");
  return join(input.readinessReportDirectory, projectSegment, `${runSegment}.readiness.json`);
}

function createMoyinProductionReadinessArtifactId(
  report: Omit<MoyinProductionReadinessReport, "readinessArtifact">,
): string {
  return `moyin-readiness:${report.projectId ?? "provider"}:${report.runId ?? "no-run"}`;
}

function safeMoyinReadinessPathToken(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.length === 0 ? "unknown" : safe;
}

function createMoyinHandshakeGates(
  handshake: ExternalToolInvokeResult,
  handshakeOutput: Readonly<Record<string, unknown>> | undefined,
): readonly MoyinProductionReadinessGate[] {
  const providersPayloads = readHandshakePayloads(handshakeOutput, "discover.providers");
  const modelsPayloads = readHandshakePayloads(handshakeOutput, "discover.models");
  const hasApiKey = providersPayloads.some((payload) =>
    containsRecordValue(payload, "hasApiKey", true),
  );
  const modelCount = countListItems(modelsPayloads);
  return [
    {
      id: "control-plane",
      status: handshake.ok ? "passed" : "blocked",
      summary: handshake.ok ? "Moyin control-plane is reachable." : handshake.content,
      evidence: {
        status: handshake.status,
        operationId: handshake.operationId,
      },
    },
    {
      id: "provider-api-key",
      status: hasApiKey ? "passed" : "blocked",
      summary: hasApiKey
        ? "At least one Moyin provider reports an API key."
        : "No Moyin provider API key was detected in capability discovery.",
    },
    {
      id: "model-catalog",
      status: modelCount > 0 ? "passed" : "unknown",
      summary:
        modelCount > 0
          ? `Moyin model catalog is readable (${modelCount} model entries detected).`
          : "Moyin model catalog did not expose model entries in the readiness probe.",
      evidence: { modelCount },
    },
  ];
}

function mapMoyinProjectReadinessBlocker(
  blockerCode: string | undefined,
): NonNullable<MoyinProductionReadinessReport["blockerCode"]> {
  if (blockerCode === "MOYIN_PROVIDER_API_KEY_REQUIRED") {
    return "MOYIN_PROVIDER_API_KEY_REQUIRED";
  }
  if (blockerCode === "MOYIN_USER_SELECTED_MODEL_REQUIRED") {
    return "MOYIN_USER_SELECTED_MODEL_REQUIRED";
  }
  return "MOYIN_PROJECT_REQUIRED";
}

function mapMoyinProjectReadinessGate(gate: {
  readonly id: string;
  readonly status: "blocked" | "passed" | "unknown";
  readonly summary: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}): MoyinProductionReadinessGate {
  return {
    id: "moyin-project",
    status: gate.status,
    summary: gate.summary,
    ...(gate.evidence === undefined ? {} : { evidence: gate.evidence }),
  };
}

function createMissingMoyinProjectGate(): MoyinProductionReadinessGate {
  return {
    id: "moyin-project",
    status: "blocked",
    summary: "A real Moyin project is required before creating workflow-runs.",
    evidence: {
      blockerCode: "MOYIN_PROJECT_REQUIRED",
      activeProjectId: null,
      projectCount: 0,
    },
  };
}

function createMoyinWorkflowRunGate(
  nextGate: MoyinWorkflowRunUntilNextGateResult,
): MoyinProductionReadinessGate {
  return {
    id: "workflow-run",
    status: nextGate.ok ? "passed" : "blocked",
    summary: nextGate.ok
      ? `Workflow-run ${nextGate.runId} is readable.`
      : (nextGate.error?.message ?? "Workflow-run could not be read."),
    evidence: {
      status: nextGate.status,
      stepCount: nextGate.plan.metadata.stepCount,
      stoppedAt: nextGate.metadata.stoppedAt,
    },
  };
}

function createMoyinNextActionGate(
  nextGate: MoyinWorkflowRunUntilNextGateResult,
): MoyinProductionReadinessGate {
  const nextAction = nextGate.effectiveNextAction;
  return {
    id: "run-next-action",
    status: nextAction.requiresApproval ? "waiting" : nextGate.ok ? "passed" : "blocked",
    summary: nextAction.requiresApproval
      ? `Next effective action is ${nextAction.kind}; explicit approval is required before mutation.`
      : `Next effective action is ${nextAction.kind}.`,
    evidence: {
      kind: nextAction.kind,
      operationId: nextAction.operationId,
      advanceAction: nextAction.advanceAction,
      stepId: nextAction.stepId,
      sealedRequestId: nextAction.sealedRequestId,
      taskId: nextAction.taskId,
      requiresApproval: nextAction.requiresApproval,
    },
  };
}

function createMoyinArtifactPackageGate(
  nextGate: MoyinWorkflowRunUntilNextGateResult,
): MoyinProductionReadinessGate {
  const productionPackage = nextGate.package ?? nextGate.resume?.package;
  if (productionPackage === undefined) {
    return {
      id: "artifact-package",
      status: nextGate.status === "approval-required" ? "waiting" : "unknown",
      summary:
        nextGate.status === "approval-required"
          ? "Artifact package is waiting for the next approved Moyin step."
          : "Artifact package was not collected in this readiness pass.",
    };
  }
  return {
    id: "artifact-package",
    status: productionPackage.status === "packaged" ? "passed" : "waiting",
    summary:
      productionPackage.status === "packaged"
        ? "Production package has artifacts and handoff exports."
        : "Production package is partial; generated artifacts or completed steps are still missing.",
    evidence: {
      status: productionPackage.status,
      artifactCount: productionPackage.artifacts.length,
      jsonExportOk: productionPackage.exports.json?.ok,
      comfyuiDraftExportOk: productionPackage.exports.comfyuiDraft?.ok,
      readyForThirdPartyHandoff:
        productionPackage.handoffManifest?.readiness.readyForThirdPartyHandoff,
      readyForComfyUi: productionPackage.handoffManifest?.readiness.readyForComfyUi,
    },
  };
}

function mapMoyinReadinessStatus(
  nextGate: MoyinWorkflowRunUntilNextGateResult,
): MoyinProductionReadinessStatus {
  if (nextGate.status === "approval-required") {
    return "waiting_for_approval";
  }
  if (nextGate.status === "packaged") {
    return "complete_ready";
  }
  if (nextGate.status === "partial" || nextGate.resume?.package?.status === "partial") {
    return "partial";
  }
  if (nextGate.status === "waiting" || nextGate.status === "resumed") {
    return "waiting";
  }
  return "blocked";
}

function createMoyinReadinessNextActions(
  nextGate: MoyinWorkflowRunUntilNextGateResult,
): readonly string[] {
  if (nextGate.status === "approval-required") {
    const action = nextGate.effectiveNextAction;
    return [
      `Review the approval packet for ${action.stepId ?? "the next Moyin step"} / ${action.kind}.`,
      "Continue only after explicit user approval; do not execute submit/advance automatically.",
    ];
  }
  if (nextGate.status === "packaged") {
    return ["Review the handoff manifest, artifacts, JSON export, and ComfyUI draft."];
  }
  if (nextGate.status === "partial") {
    return [
      "Inspect the partial package blockers before claiming the video production loop is complete.",
    ];
  }
  return [nextGate.error?.message ?? "Inspect Moyin workflow-run state before continuing."];
}

function readMoyinHandshakeOutput(output: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(output)) {
    return undefined;
  }
  const nested = output.output;
  return isRecord(nested) ? nested : output;
}

function readHandshakePayloads(
  handshakeOutput: Readonly<Record<string, unknown>> | undefined,
  capability: string,
): readonly unknown[] {
  if (!isRecord(handshakeOutput)) {
    return [];
  }
  const checks = handshakeOutput.checks;
  if (!Array.isArray(checks)) {
    return [];
  }
  return checks.flatMap((check) => {
    if (!isRecord(check) || check.capability !== capability) {
      return [];
    }
    return check.payload === undefined ? [] : [check.payload];
  });
}

function countListItems(values: readonly unknown[]): number {
  return values.reduce<number>((total, value) => total + countListItemsInValue(value), 0);
}

function countListItemsInValue(value: unknown): number {
  if (!isRecord(value)) {
    return 0;
  }
  const items = value.items;
  if (Array.isArray(items)) {
    return items.length;
  }
  const providers = value.providers;
  if (Array.isArray(providers)) {
    return providers.length;
  }
  return 0;
}

function containsRecordValue(value: unknown, key: string, expected: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsRecordValue(item, key, expected));
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value[key] === expected) {
    return true;
  }
  return Object.values(value).some((item) => containsRecordValue(item, key, expected));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
