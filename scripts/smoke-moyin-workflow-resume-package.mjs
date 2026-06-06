#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshConversationRuntime } from "./smoke-runtime-import.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const artifactStoreRoot =
  process.env.MOYIN_SMOKE_ARTIFACT_STORE_ROOT ||
  join(workspaceRoot, ".hotflow/conversation-runtime/external-artifacts");
const handoffManifestDirectory =
  process.env.MOYIN_SMOKE_HANDOFF_MANIFEST_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-handoff-manifests");
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
const runId =
  readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
  readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
const stepId = readEnvString(process.env.MOYIN_SMOKE_STEP_ID);
const taskId = readEnvString(process.env.MOYIN_SMOKE_TASK_ID);
const sealedRequestId = readEnvString(process.env.MOYIN_SMOKE_SEALED_REQUEST_ID);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

try {
  const result = await runWorkflowResumePackageSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-resume-package-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowResumePackageSmoke() {
  if (projectId === undefined || runId === undefined || stepId === undefined || taskId === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-resume-package-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      stepId,
      taskId,
      resume: {
        attempted: false,
        reason: "project-run-step-or-task-id-not-provided",
      },
      execute: {
        attempted: false,
        reason: "resume-smoke-never-executes",
      },
      submit: {
        attempted: false,
        reason: "resume-smoke-never-submits",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID, MOYIN_SMOKE_WORKFLOW_RUN_ID, MOYIN_SMOKE_STEP_ID, and MOYIN_SMOKE_TASK_ID.",
      ],
    };
  }

  const runtime = await importRuntime();
  const artifactStore = runtime.createFileConversationRuntimeExternalArtifactStore({
    rootPath: artifactStoreRoot,
    defaultRetention: "user_controlled",
    defaultSensitivity: "internal",
    defaultCleanupPolicyRef: "artifactPolicy.moyin.handoff-manifest.user-controlled",
  });
  const registry = new runtime.ExternalToolRegistry({ nowMs: () => Date.now(), artifactStore });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000),
    }),
  );

  const result = await runtime.orchestrateMoyinWorkflowRunResumeAndPackage({
    registry,
    projectId,
    runId,
    stepId,
    taskId,
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    turnId: `moyin-smoke-resume:${projectId}:${runId}:${stepId}:${taskId}`,
    sessionKey: "moyin:smoke:workflow-resume-package",
    watchTimeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS, 10 * 60_000),
    heartbeatIntervalMs: Math.min(
      readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
      30_000,
    ),
    artifactStore,
    handoffManifestDirectory,
    resumeToken: `moyin-watch:${projectId}:${runId}:${stepId}:${taskId}`,
    metadata: {
      smoke: "moyin.workflow-resume-package",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const unavailable = result.error?.code === "CONTROL_PLANE_NOT_FOUND";
  return {
    schemaVersion: "director.moyin.workflow-resume-package-smoke.v1",
    status: unavailable && !requireControlPlane ? "unavailable" : result.status,
    exitCode: unavailable && !requireControlPlane ? 0 : result.ok ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    artifactStoreRoot,
    handoffManifestDirectory,
    projectId: result.projectId,
    runId: result.runId,
    stepId: result.stepId,
    sealedRequestId: result.sealedRequestId,
    taskId: result.taskId,
    resume: {
      attempted: true,
      reason: "resume-existing-task",
    },
    execute: {
      attempted: false,
      reason: "resume-smoke-never-executes",
    },
    submit: {
      attempted: false,
      reason: "resume-smoke-never-submits",
    },
    watch: {
      attempted: result.watch !== undefined,
      ok: result.watch?.ok,
      status: result.watch?.status,
    },
    package: {
      attempted: result.package !== undefined,
      ok: result.package?.ok,
      status: result.package?.status,
      artifactCount: result.package?.artifacts.length,
      jsonExportOk: result.package?.exports.json?.ok,
      comfyuiDraftExportOk: result.package?.exports.comfyuiDraft?.ok,
      handoffManifestArtifact: summarizeHandoffManifestArtifact(result.package),
    },
    artifacts:
      result.package?.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        path: artifact.path,
        url: artifact.url,
        taskId: readMetadataString(artifact.metadata, "taskId"),
        stepId: readMetadataString(artifact.metadata, "stepId"),
      })) ?? [],
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: createNextActions(result.status, unavailable),
  };
}

function summarizeHandoffManifestArtifact(productionPackage) {
  if (productionPackage?.handoffManifestArtifact === undefined) {
    return undefined;
  }
  return {
    id: productionPackage.handoffManifestArtifact.id,
    kind: productionPackage.handoffManifestArtifact.kind,
    path: productionPackage.handoffManifestArtifact.path,
    persisted: productionPackage.handoffManifestArtifactPersistence?.status === "ok",
    persistenceStatus: productionPackage.handoffManifestArtifactPersistence?.status,
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function createNextActions(status, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:resume-package`."];
  }
  if (status === "packaged") {
    return ["Review recovered artifacts and workflow exports before downstream handoff."];
  }
  if (status === "partial" || status === "resumed") {
    return [
      "If package is partial, inspect run status and artifact registry before retrying.",
      "If watch timed out, rerun with the same taskId after Moyin reports progress.",
    ];
  }
  return ["Inspect the returned watch/package error before retrying."];
}

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readMetadataString(metadata, key) {
  if (metadata === undefined || metadata === null || typeof metadata !== "object") {
    return undefined;
  }
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
