import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  ConversationRuntimeExternalArtifactStore,
  ConversationRuntimeExternalArtifactStoreWriteResult,
} from "./external-artifact-store.js";
import type {
  ExternalToolArtifact,
  ExternalToolInvokeResult,
  ExternalToolRegistry,
} from "./external-tools.js";
import { invokeExternalTool } from "./external-tools.js";

const DEFAULT_MOYIN_TOOL_ID = "moyin.provider";
const SCHEMA_VERSION = "director.moyin.production-package.v1" as const;
const HANDOFF_MANIFEST_SCHEMA_VERSION = "director.moyin.production-handoff-manifest.v1" as const;

export interface MoyinWorkflowRunProductionPackageInput {
  readonly registry: ExternalToolRegistry;
  readonly toolId?: string;
  readonly projectId: string;
  readonly runId: string;
  readonly includeJsonExport?: boolean;
  readonly includeComfyUiDraft?: boolean;
  readonly backfillMissingArtifacts?: boolean;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly artifactStore?: ConversationRuntimeExternalArtifactStore;
  readonly handoffManifestDirectory?: string;
  readonly handoffManifestPath?: string;
}

export type MoyinWorkflowRunProductionPackageStatus = "failed" | "packaged" | "partial";

export interface MoyinWorkflowRunProductionPackageStep {
  readonly stepId: string;
  readonly status?: string;
  readonly taskId?: string;
  readonly sealedRequestId?: string;
  readonly artifacts?: readonly unknown[];
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface MoyinWorkflowRunProductionHandoffStep {
  readonly stepId: string;
  readonly status?: string;
  readonly taskId?: string;
  readonly sealedRequestId?: string;
  readonly artifactIds: readonly string[];
  readonly missingArtifact: boolean;
}

export interface MoyinWorkflowRunProductionHandoffArtifact {
  readonly artifactId: string;
  readonly kind: string;
  readonly path?: string;
  readonly url?: string;
  readonly taskId?: string;
  readonly stepId?: string;
}

export interface MoyinWorkflowRunProductionHandoffExportConversion {
  readonly executable: boolean;
  readonly lossiness?: string;
  readonly unmappedFields?: readonly string[];
  readonly missingDependencies?: readonly string[];
}

export interface MoyinWorkflowRunProductionHandoffExport {
  readonly ok: boolean;
  readonly target: string;
  readonly packagePath?: string;
  readonly conversion?: MoyinWorkflowRunProductionHandoffExportConversion;
}

export interface MoyinWorkflowRunProductionHandoffManifest {
  readonly schemaVersion: typeof HANDOFF_MANIFEST_SCHEMA_VERSION;
  readonly provider: "moyin";
  readonly projectId: string;
  readonly runId: string;
  readonly status: MoyinWorkflowRunProductionPackageStatus;
  readonly steps: readonly MoyinWorkflowRunProductionHandoffStep[];
  readonly artifacts: readonly MoyinWorkflowRunProductionHandoffArtifact[];
  readonly exports: {
    readonly json?: MoyinWorkflowRunProductionHandoffExport;
    readonly comfyuiDraft?: MoyinWorkflowRunProductionHandoffExport;
  };
  readonly readiness: {
    readonly packageStatus: MoyinWorkflowRunProductionPackageStatus;
    readonly readyForThirdPartyHandoff: boolean;
    readonly readyForComfyUi: boolean;
    readonly blockers: readonly string[];
  };
  readonly mutation: {
    readonly submitAttempted: false;
    readonly advanceAttempted: false;
    readonly cancelAttempted: false;
    readonly deleteAttempted: false;
  };
}

export interface MoyinWorkflowRunProductionPackageResult {
  readonly ok: boolean;
  readonly status: MoyinWorkflowRunProductionPackageStatus;
  readonly projectId: string;
  readonly runId: string;
  readonly run?: ExternalToolInvokeResult;
  readonly steps?: ExternalToolInvokeResult;
  readonly artifactsRead?: ExternalToolInvokeResult;
  readonly backfills: readonly ExternalToolInvokeResult[];
  readonly exports: {
    readonly json?: ExternalToolInvokeResult;
    readonly comfyuiDraft?: ExternalToolInvokeResult;
  };
  readonly stepStates: readonly MoyinWorkflowRunProductionPackageStep[];
  readonly artifacts: readonly ExternalToolArtifact[];
  readonly handoffManifest?: MoyinWorkflowRunProductionHandoffManifest;
  readonly handoffManifestArtifact?: ExternalToolArtifact;
  readonly handoffManifestArtifactPersistence?: ConversationRuntimeExternalArtifactStoreWriteResult;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
  readonly metadata: Readonly<Record<string, unknown>>;
}

export async function collectMoyinWorkflowRunProductionPackage(
  input: MoyinWorkflowRunProductionPackageInput,
): Promise<MoyinWorkflowRunProductionPackageResult> {
  const toolId = input.toolId ?? DEFAULT_MOYIN_TOOL_ID;
  const run = await invokeMoyinPackageTool(input, toolId, "workflow-run.get", {
    projectId: input.projectId,
    runId: input.runId,
  });
  if (!run.ok) {
    return createMoyinProductionPackageFailure(input, {
      run,
      code: run.error ?? "MOYIN_WORKFLOW_RUN_GET_FAILED",
      message: run.content,
    });
  }

  const steps = await invokeMoyinPackageTool(input, toolId, "workflow-run.steps", {
    projectId: input.projectId,
    runId: input.runId,
  });
  if (!steps.ok) {
    return createMoyinProductionPackageFailure(input, {
      run,
      steps,
      code: steps.error ?? "MOYIN_WORKFLOW_RUN_STEPS_FAILED",
      message: steps.content,
    });
  }

  const stepStates = readMoyinPackageSteps(steps);
  const artifactsRead = await invokeMoyinPackageTool(input, toolId, "workflow-run.artifacts", {
    projectId: input.projectId,
    runId: input.runId,
  });
  if (!artifactsRead.ok) {
    return createMoyinProductionPackageFailure(input, {
      run,
      steps,
      artifactsRead,
      stepStates,
      code: artifactsRead.error ?? "MOYIN_WORKFLOW_RUN_ARTIFACTS_FAILED",
      message: artifactsRead.content,
    });
  }

  const initialArtifacts = readExternalToolArtifacts(artifactsRead);
  const completedSteps = stepStates.filter((step) => step.status === "completed");
  const completedStepsWithTaskIds = completedSteps.filter((step) => step.taskId !== undefined);
  const backfills =
    input.backfillMissingArtifacts === false || initialArtifacts.length > 0
      ? []
      : await backfillMoyinCompletedStepArtifacts(input, toolId, completedStepsWithTaskIds);
  const artifacts = dedupeMoyinArtifacts([
    ...initialArtifacts,
    ...backfills.flatMap((backfill) => readExternalToolArtifacts(backfill)),
  ]);

  const jsonExport =
    input.includeJsonExport === false
      ? undefined
      : await exportMoyinWorkflowRunPackage(input, toolId, "json");
  const comfyuiDraft =
    input.includeComfyUiDraft === false
      ? undefined
      : await exportMoyinWorkflowRunPackage(input, toolId, "comfyui-draft");

  const exportFailures = [jsonExport, comfyuiDraft].filter(
    (result): result is ExternalToolInvokeResult => result !== undefined && !result.ok,
  );
  const runStatus = readMoyinPackageRunStatus(run);
  const terminalStepCount = stepStates.filter((step) =>
    isMoyinTerminalStepStatus(step.status),
  ).length;
  const completedStepCount = completedSteps.length;
  const failedStepCount = stepStates.filter((step) => step.status === "failed").length;
  const missingArtifactStepCount = countMoyinMissingCompletedTaskArtifacts(
    completedStepsWithTaskIds,
    artifacts,
  );
  const status =
    exportFailures.length > 0
      ? "partial"
      : runStatus === "completed" &&
          stepStates.length > 0 &&
          terminalStepCount === stepStates.length &&
          failedStepCount === 0 &&
          missingArtifactStepCount === 0
        ? "packaged"
        : "partial";
  const exports = {
    ...(jsonExport === undefined ? {} : { json: jsonExport }),
    ...(comfyuiDraft === undefined ? {} : { comfyuiDraft }),
  };
  const handoffManifest = createMoyinProductionHandoffManifest({
    input,
    status,
    stepStates,
    artifacts,
    exports,
  });
  const handoffManifestArtifact = writeMoyinProductionHandoffManifestArtifact({
    input,
    toolId,
    manifest: handoffManifest,
  });

  return {
    ok: exportFailures.length === 0,
    status,
    projectId: input.projectId,
    runId: input.runId,
    run,
    steps,
    artifactsRead,
    backfills,
    exports,
    stepStates,
    artifacts,
    handoffManifest,
    ...(handoffManifestArtifact === undefined
      ? {}
      : { handoffManifestArtifact: handoffManifestArtifact.artifact }),
    ...(handoffManifestArtifact?.persistence === undefined
      ? {}
      : { handoffManifestArtifactPersistence: handoffManifestArtifact.persistence }),
    ...(exportFailures.length === 0
      ? {}
      : {
          error: {
            code: exportFailures[0]?.error ?? "MOYIN_WORKFLOW_RUN_EXPORT_FAILED",
            message: exportFailures[0]?.content ?? "Moyin workflow-run export failed.",
            recoverable: true,
          },
        }),
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      runStatus: runStatus ?? "unknown",
      stepCount: stepStates.length,
      terminalStepCount,
      completedStepCount,
      failedStepCount,
      backfillEligibleStepCount: completedStepsWithTaskIds.length,
      initialArtifactCount: initialArtifacts.length,
      artifactCount: artifacts.length,
      missingArtifactStepCount,
      backfillAttemptedCount: backfills.length,
      backfillRecoveredCount: backfills.flatMap((backfill) => readExternalToolArtifacts(backfill))
        .length,
      jsonExportRequested: input.includeJsonExport !== false,
      comfyuiDraftRequested: input.includeComfyUiDraft !== false,
      exportFailureCount: exportFailures.length,
    },
  };
}

function writeMoyinProductionHandoffManifestArtifact(input: {
  readonly input: MoyinWorkflowRunProductionPackageInput;
  readonly toolId: string;
  readonly manifest: MoyinWorkflowRunProductionHandoffManifest;
}):
  | {
      readonly artifact: ExternalToolArtifact;
      readonly persistence?: ConversationRuntimeExternalArtifactStoreWriteResult;
    }
  | undefined {
  const manifestPath = createMoyinProductionHandoffManifestPath(input.input);
  if (manifestPath === undefined) {
    return undefined;
  }
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
  const artifact: ExternalToolArtifact = {
    id: `moyin-handoff:${input.input.projectId}:${input.input.runId}`,
    kind: "json",
    path: manifestPath,
    metadata: {
      provider: "moyin",
      projectId: input.input.projectId,
      runId: input.input.runId,
      role: "production-handoff-manifest",
      schemaVersion: input.manifest.schemaVersion,
      packageStatus: input.manifest.status,
      stepCount: input.manifest.steps.length,
      artifactCount: input.manifest.artifacts.length,
      readyForThirdPartyHandoff: input.manifest.readiness.readyForThirdPartyHandoff,
      readyForComfyUi: input.manifest.readiness.readyForComfyUi,
      retention: "user_controlled",
      sensitivity: "internal",
      cleanupPolicyRef: "artifactPolicy.moyin.handoff-manifest.user-controlled",
    },
  };
  const persistence = input.input.artifactStore?.upsertArtifacts({
    providerId: "moyin",
    toolId: input.toolId,
    operationId: "workflow-run.production-package",
    ...(input.input.turnId === undefined ? {} : { turnId: input.input.turnId }),
    ...(input.input.sessionKey === undefined ? {} : { sessionKey: input.input.sessionKey }),
    projectId: input.input.projectId,
    runId: input.input.runId,
    artifacts: [artifact],
    retention: "user_controlled",
    sensitivity: "internal",
    cleanupPolicyRef: "artifactPolicy.moyin.handoff-manifest.user-controlled",
  });
  return persistence === undefined ? { artifact } : { artifact, persistence };
}

function createMoyinProductionHandoffManifestPath(
  input: MoyinWorkflowRunProductionPackageInput,
): string | undefined {
  if (input.handoffManifestPath !== undefined) {
    return input.handoffManifestPath;
  }
  if (input.handoffManifestDirectory === undefined) {
    return undefined;
  }
  return join(
    input.handoffManifestDirectory,
    safeMoyinHandoffPathToken(input.projectId),
    `${safeMoyinHandoffPathToken(input.runId)}.handoff.json`,
  );
}

function safeMoyinHandoffPathToken(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return safe.length === 0 ? "unknown" : safe;
}

function createMoyinProductionHandoffManifest(input: {
  readonly input: MoyinWorkflowRunProductionPackageInput;
  readonly status: MoyinWorkflowRunProductionPackageStatus;
  readonly stepStates: readonly MoyinWorkflowRunProductionPackageStep[];
  readonly artifacts: readonly ExternalToolArtifact[];
  readonly exports: {
    readonly json?: ExternalToolInvokeResult;
    readonly comfyuiDraft?: ExternalToolInvokeResult;
  };
}): MoyinWorkflowRunProductionHandoffManifest {
  const steps = input.stepStates.map((step) => {
    const artifactIds = input.artifacts
      .filter((artifact) => isMoyinArtifactForStep(artifact, step))
      .map((artifact) => artifact.id);
    return {
      stepId: step.stepId,
      ...(step.status === undefined ? {} : { status: step.status }),
      ...(step.taskId === undefined ? {} : { taskId: step.taskId }),
      ...(step.sealedRequestId === undefined ? {} : { sealedRequestId: step.sealedRequestId }),
      artifactIds,
      missingArtifact:
        step.status === "completed" && step.taskId !== undefined && artifactIds.length === 0,
    };
  });
  const exports = {
    ...(input.exports.json === undefined
      ? {}
      : { json: readMoyinHandoffExport(input.exports.json, "json") }),
    ...(input.exports.comfyuiDraft === undefined
      ? {}
      : { comfyuiDraft: readMoyinHandoffExport(input.exports.comfyuiDraft, "comfyui-draft") }),
  };
  const readiness = createMoyinHandoffReadiness(input.status, steps, exports);
  return {
    schemaVersion: HANDOFF_MANIFEST_SCHEMA_VERSION,
    provider: "moyin",
    projectId: input.input.projectId,
    runId: input.input.runId,
    status: input.status,
    steps,
    artifacts: input.artifacts.map((artifact) => ({
      artifactId: artifact.id,
      kind: artifact.kind,
      ...(artifact.path === undefined ? {} : { path: artifact.path }),
      ...(artifact.url === undefined ? {} : { url: artifact.url }),
      ...optionalStringField("taskId", readString(artifact.metadata?.taskId)),
      ...optionalStringField("stepId", readString(artifact.metadata?.stepId)),
    })),
    exports,
    readiness,
    mutation: {
      submitAttempted: false,
      advanceAttempted: false,
      cancelAttempted: false,
      deleteAttempted: false,
    },
  };
}

function isMoyinArtifactForStep(
  artifact: ExternalToolArtifact,
  step: MoyinWorkflowRunProductionPackageStep,
): boolean {
  return (
    (step.taskId !== undefined && readString(artifact.metadata?.taskId) === step.taskId) ||
    readString(artifact.metadata?.stepId) === step.stepId
  );
}

function readMoyinHandoffExport(
  result: ExternalToolInvokeResult,
  fallbackTarget: string,
): MoyinWorkflowRunProductionHandoffExport {
  const output = readRecord(result.output);
  const nestedOutput = readRecord(output?.output);
  const payload =
    readRecord(nestedOutput?.payload) ?? readRecord(output?.payload) ?? nestedOutput ?? output;
  const interopPackage =
    readRecord(nestedOutput?.interopPackage) ?? readRecord(output?.interopPackage);
  const interopSource = readRecord(interopPackage?.source);
  const interopTarget = readRecord(interopPackage?.target);
  const conversion =
    readMoyinHandoffExportConversion(payload?.conversion) ??
    readMoyinHandoffExportConversion(interopPackage?.conversion);
  return {
    ok: result.ok,
    target: readString(payload?.target) ?? readString(interopTarget?.format) ?? fallbackTarget,
    ...optionalStringField(
      "packagePath",
      readString(payload?.packagePath) ?? readString(interopSource?.uri),
    ),
    ...(conversion === undefined ? {} : { conversion }),
  };
}

function readMoyinHandoffExportConversion(
  value: unknown,
): MoyinWorkflowRunProductionHandoffExportConversion | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const unmappedFields = readStringArray(record.unmappedFields);
  const missingDependencies = readStringArray(record.missingDependencies);
  return {
    executable: record.executable === true,
    ...optionalStringField("lossiness", readString(record.lossiness)),
    ...(unmappedFields.length === 0 ? {} : { unmappedFields }),
    ...(missingDependencies.length === 0 ? {} : { missingDependencies }),
  };
}

function createMoyinHandoffReadiness(
  status: MoyinWorkflowRunProductionPackageStatus,
  steps: readonly MoyinWorkflowRunProductionHandoffStep[],
  exports: MoyinWorkflowRunProductionHandoffManifest["exports"],
): MoyinWorkflowRunProductionHandoffManifest["readiness"] {
  const blockers: string[] = [];
  const missingArtifactCount = steps.filter((step) => step.missingArtifact).length;
  const jsonExportReady = exports.json?.ok === true;
  if (status !== "packaged") {
    blockers.push(`package-${status}`);
  }
  if (missingArtifactCount > 0) {
    blockers.push("missing-step-artifacts");
  }
  if (exports.json === undefined) {
    blockers.push("json-export-missing");
  } else if (!exports.json.ok) {
    blockers.push("json-export-failed");
  }

  const comfyuiDraft = exports.comfyuiDraft;
  if (comfyuiDraft === undefined) {
    blockers.push("comfyui-draft-export-missing");
  } else if (!comfyuiDraft.ok) {
    blockers.push("comfyui-draft-export-failed");
  } else {
    if (comfyuiDraft.conversion?.executable !== true) {
      blockers.push("comfyui-draft-not-executable");
    }
    if (
      comfyuiDraft.conversion?.lossiness !== undefined &&
      comfyuiDraft.conversion.lossiness !== "lossless"
    ) {
      blockers.push("comfyui-draft-lossy");
    }
    if ((comfyuiDraft.conversion?.missingDependencies ?? []).length > 0) {
      blockers.push("comfyui-draft-missing-dependencies");
    }
  }

  return {
    packageStatus: status,
    readyForThirdPartyHandoff:
      status === "packaged" && missingArtifactCount === 0 && jsonExportReady,
    readyForComfyUi:
      status === "packaged" &&
      missingArtifactCount === 0 &&
      comfyuiDraft?.ok === true &&
      comfyuiDraft.conversion?.executable === true &&
      comfyuiDraft.conversion.lossiness === "lossless" &&
      (comfyuiDraft.conversion.missingDependencies ?? []).length === 0,
    blockers,
  };
}

async function backfillMoyinCompletedStepArtifacts(
  input: MoyinWorkflowRunProductionPackageInput,
  toolId: string,
  steps: readonly MoyinWorkflowRunProductionPackageStep[],
): Promise<readonly ExternalToolInvokeResult[]> {
  const results: ExternalToolInvokeResult[] = [];
  const seenTaskIds = new Set<string>();
  for (const step of steps) {
    if (step.taskId === undefined || seenTaskIds.has(step.taskId)) {
      continue;
    }
    seenTaskIds.add(step.taskId);
    results.push(
      await invokeMoyinPackageTool(input, toolId, "artifact.backfill", {
        projectId: input.projectId,
        taskId: step.taskId,
      }),
    );
  }
  return results;
}

function exportMoyinWorkflowRunPackage(
  input: MoyinWorkflowRunProductionPackageInput,
  toolId: string,
  target: "comfyui-draft" | "json",
): Promise<ExternalToolInvokeResult> {
  return invokeMoyinPackageTool(input, toolId, "workflow.export", {
    projectId: input.projectId,
    runId: input.runId,
    target,
  });
}

function invokeMoyinPackageTool(
  input: MoyinWorkflowRunProductionPackageInput,
  toolId: string,
  operationId: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ExternalToolInvokeResult> {
  return invokeExternalTool(input.registry, {
    toolId,
    operationId,
    args,
    ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
    ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
    metadata: {
      ...(input.metadata ?? {}),
      orchestration: "moyin.production-package",
      orchestrationPhase: operationId,
      schemaVersion: SCHEMA_VERSION,
    },
  });
}

function createMoyinProductionPackageFailure(
  input: MoyinWorkflowRunProductionPackageInput,
  result: {
    readonly run?: ExternalToolInvokeResult | undefined;
    readonly steps?: ExternalToolInvokeResult | undefined;
    readonly artifactsRead?: ExternalToolInvokeResult | undefined;
    readonly stepStates?: readonly MoyinWorkflowRunProductionPackageStep[] | undefined;
    readonly code: string;
    readonly message: string;
  },
): MoyinWorkflowRunProductionPackageResult {
  return {
    ok: false,
    status: "failed",
    projectId: input.projectId,
    runId: input.runId,
    ...(result.run === undefined ? {} : { run: result.run }),
    ...(result.steps === undefined ? {} : { steps: result.steps }),
    ...(result.artifactsRead === undefined ? {} : { artifactsRead: result.artifactsRead }),
    backfills: [],
    exports: {},
    stepStates: result.stepStates ?? [],
    artifacts: [],
    error: {
      code: result.code,
      message: result.message,
      recoverable: true,
    },
    metadata: {
      schemaVersion: SCHEMA_VERSION,
      failedBeforePackage: true,
    },
  };
}

function readMoyinPackageRunStatus(result: ExternalToolInvokeResult): string | undefined {
  const output = readRecord(result.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(nestedOutput?.payload ?? output?.payload);
  return (
    readString(nestedOutput?.status) ?? readString(payload?.status) ?? readString(output?.status)
  );
}

function readMoyinPackageSteps(
  result: ExternalToolInvokeResult,
): readonly MoyinWorkflowRunProductionPackageStep[] {
  const output = readRecord(result.output);
  const nestedOutput = readRecord(output?.output);
  const payload = readRecord(nestedOutput?.payload ?? output?.payload);
  return dedupeMoyinPackageSteps([
    ...readMoyinPackageStepsArray(nestedOutput?.steps),
    ...readMoyinPackageStepsArray(payload?.items),
    ...readMoyinPackageStepsArray(payload?.steps),
    ...readMoyinPackageStepsArray(output?.items),
    ...readMoyinPackageStepsArray(output?.steps),
  ]);
}

function readMoyinPackageStepsArray(
  value: unknown,
): readonly MoyinWorkflowRunProductionPackageStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const step = readMoyinPackageStep(item);
    return step === undefined ? [] : [step];
  });
}

function readMoyinPackageStep(value: unknown): MoyinWorkflowRunProductionPackageStep | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const stepId = readString(record.stepId) ?? readString(record.id);
  if (stepId === undefined) {
    return undefined;
  }
  const status = readString(record.status);
  const taskId = readString(record.taskId);
  const sealedRequestId = readString(record.sealedRequestId);
  const artifacts = Array.isArray(record.artifacts) ? [...record.artifacts] : [];
  return {
    stepId,
    ...(status === undefined ? {} : { status }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    ...(artifacts.length === 0 ? {} : { artifacts }),
    payload: record,
  };
}

function dedupeMoyinPackageSteps(
  steps: readonly MoyinWorkflowRunProductionPackageStep[],
): readonly MoyinWorkflowRunProductionPackageStep[] {
  const seen = new Set<string>();
  return steps.filter((step) => {
    if (seen.has(step.stepId)) {
      return false;
    }
    seen.add(step.stepId);
    return true;
  });
}

function readExternalToolArtifacts(
  result: ExternalToolInvokeResult,
): readonly ExternalToolArtifact[] {
  if (result.artifacts !== undefined) {
    return [...result.artifacts];
  }
  return extractArtifactsFromUnknown(result.output);
}

function extractArtifactsFromUnknown(value: unknown): readonly ExternalToolArtifact[] {
  const record = readRecord(value);
  if (record === undefined) {
    return [];
  }
  const nestedOutput = readRecord(record.output);
  const payload = readRecord(nestedOutput?.payload ?? record.payload);
  return [
    ...extractArtifactArray(record.artifacts),
    ...extractArtifactArray(record.items),
    ...extractArtifactArray(nestedOutput?.artifacts),
    ...extractArtifactArray(nestedOutput?.items),
    ...extractArtifactArray(payload?.artifacts),
    ...extractArtifactArray(payload?.items),
  ];
}

function extractArtifactArray(value: unknown): readonly ExternalToolArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const artifact = readExternalToolArtifact(item);
    return artifact === undefined ? [] : [artifact];
  });
}

function readExternalToolArtifact(value: unknown): ExternalToolArtifact | undefined {
  const record = readRecord(value);
  if (record === undefined) {
    return undefined;
  }
  const id =
    readString(record.id) ?? readString(record.artifactId) ?? readString(record.artifact_id);
  const kind = readString(record.kind) ?? readString(record.type);
  if (id === undefined || kind === undefined) {
    return undefined;
  }
  const path = readString(record.path) ?? readString(record.localPath);
  const url = readString(record.url) ?? readString(record.uri);
  return {
    id,
    kind,
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
    metadata: {
      provider: "moyin",
      ...(readRecord(record.metadata) ?? {}),
      ...optionalStringField("runId", readString(record.runId)),
      ...optionalStringField("stepId", readString(record.stepId)),
      ...optionalStringField("taskId", readString(record.taskId)),
      ...optionalStringField("source", readString(record.source)),
    },
  };
}

function dedupeMoyinArtifacts(
  artifacts: readonly ExternalToolArtifact[],
): readonly ExternalToolArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.id)) {
      return false;
    }
    seen.add(artifact.id);
    return true;
  });
}

function countMoyinMissingCompletedTaskArtifacts(
  steps: readonly MoyinWorkflowRunProductionPackageStep[],
  artifacts: readonly ExternalToolArtifact[],
): number {
  return steps.filter(
    (step) =>
      !artifacts.some(
        (artifact) =>
          readString(artifact.metadata?.taskId) === step.taskId ||
          readString(artifact.metadata?.stepId) === step.stepId,
      ),
  ).length;
}

function isMoyinTerminalStepStatus(status: string | undefined): boolean {
  return status === "completed" || status === "failed" || status === "skipped";
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = readString(item);
        return text === undefined ? [] : [text];
      })
    : [];
}

function optionalStringField(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}
