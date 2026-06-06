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
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

try {
  const result = await runProductionPackageSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-production-package-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runProductionPackageSmoke() {
  if (projectId === undefined || runId === undefined) {
    return {
      schemaVersion: "director.moyin.production-package-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      submit: {
        attempted: false,
        reason: "project-or-run-id-not-provided",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and MOYIN_SMOKE_WORKFLOW_RUN_ID to collect a read-only workflow-run package.",
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

  const result = await runtime.collectMoyinWorkflowRunProductionPackage({
    registry,
    projectId,
    runId,
    includeJsonExport: readBooleanEnv(process.env.MOYIN_SMOKE_INCLUDE_JSON_EXPORT, true),
    includeComfyUiDraft: readBooleanEnv(process.env.MOYIN_SMOKE_INCLUDE_COMFYUI_DRAFT, true),
    backfillMissingArtifacts: readBooleanEnv(
      process.env.MOYIN_SMOKE_BACKFILL_MISSING_ARTIFACTS,
      true,
    ),
    artifactStore,
    handoffManifestDirectory,
    metadata: {
      smoke: "moyin.production-package",
      submitAttempted: false,
    },
  });

  const unavailable = result.error?.code === "CONTROL_PLANE_NOT_FOUND";
  return {
    schemaVersion: "director.moyin.production-package-smoke.v1",
    status: unavailable && !requireControlPlane ? "unavailable" : result.status,
    exitCode: unavailable && !requireControlPlane ? 0 : result.status === "failed" ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    artifactStoreRoot,
    handoffManifestDirectory,
    projectId,
    runId,
    ok: result.ok,
    runStatus: result.metadata.runStatus,
    stepCount: result.metadata.stepCount,
    terminalStepCount: result.metadata.terminalStepCount,
    completedStepCount: result.metadata.completedStepCount,
    failedStepCount: result.metadata.failedStepCount,
    artifactCount: result.metadata.artifactCount,
    backfillAttemptedCount: result.metadata.backfillAttemptedCount,
    backfillRecoveredCount: result.metadata.backfillRecoveredCount,
    exportFailureCount: result.metadata.exportFailureCount,
    jsonExportOk: result.exports.json?.ok,
    comfyuiDraftExportOk: result.exports.comfyuiDraft?.ok,
    handoffManifest:
      result.handoffManifest === undefined
        ? undefined
        : {
            schemaVersion: result.handoffManifest.schemaVersion,
            status: result.handoffManifest.status,
            stepCount: result.handoffManifest.steps.length,
            artifactCount: result.handoffManifest.artifacts.length,
            readyForThirdPartyHandoff:
              result.handoffManifest.readiness.readyForThirdPartyHandoff,
            readyForComfyUi: result.handoffManifest.readiness.readyForComfyUi,
            blockers: result.handoffManifest.readiness.blockers,
            exports: {
              json: summarizeHandoffExport(result.handoffManifest.exports.json),
              comfyuiDraft: summarizeHandoffExport(
                result.handoffManifest.exports.comfyuiDraft,
              ),
            },
            mutation: result.handoffManifest.mutation,
          },
    handoffManifestArtifact:
      result.handoffManifestArtifact === undefined
        ? undefined
        : {
            id: result.handoffManifestArtifact.id,
            kind: result.handoffManifestArtifact.kind,
            path: result.handoffManifestArtifact.path,
            url: result.handoffManifestArtifact.url,
            persisted:
              result.handoffManifestArtifactPersistence?.status === undefined
                ? false
                : result.handoffManifestArtifactPersistence.status === "ok",
            persistenceStatus: result.handoffManifestArtifactPersistence?.status,
          },
    submit: {
      attempted: false,
      reason: "production-package-smoke-is-read-only",
    },
    artifacts: result.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.path,
      url: artifact.url,
      taskId: readMetadataString(artifact.metadata, "taskId"),
      stepId: readMetadataString(artifact.metadata, "stepId"),
    })),
    ...(result.error === undefined
      ? {}
      : {
          error: result.error,
        }),
    nextActions: createNextActions(result.status, unavailable),
  };
}

function summarizeHandoffExport(value) {
  if (value === undefined) {
    return undefined;
  }
  return {
    ok: value.ok,
    target: value.target,
    packagePath: value.packagePath,
    conversion: value.conversion,
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function createNextActions(status, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:package`."];
  }
  if (status === "packaged") {
    return [
      "Review the package exports and artifact registry refs before handing off downstream.",
    ];
  }
  if (status === "partial") {
    return [
      "If the run is approval_required, execute only after explicit operator approval.",
      "If the run is completed but artifactCount is 0, inspect Moyin artifact.backfill output.",
    ];
  }
  return ["Inspect the failed provider envelope before retrying."];
}

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readBooleanEnv(value, fallback) {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
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
