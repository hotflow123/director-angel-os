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
const allowExecute = process.env.MOYIN_SMOKE_ALLOW_EXECUTE === "1";
const executeApproval = process.env.MOYIN_SMOKE_APPROVAL === "EXECUTE";
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

try {
  const result = await runWorkflowExecutePackageSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-execute-package-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowExecutePackageSmoke() {
  if (projectId === undefined || runId === undefined || stepId === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-execute-package-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      stepId,
      execute: {
        attempted: false,
        reason: "project-run-or-step-id-not-provided",
      },
      submit: {
        attempted: false,
        reason: "project-run-or-step-id-not-provided",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID, MOYIN_SMOKE_WORKFLOW_RUN_ID, and MOYIN_SMOKE_STEP_ID.",
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
  const approvalLedger = runtime.createFileConversationRuntimeApprovalLedger({
    rootPath:
      readEnvString(process.env.MOYIN_SMOKE_APPROVAL_LEDGER_ROOT) ??
      join(workspaceRoot, ".hotflow/conversation-runtime/approval-ledger"),
    nowMs: () => Date.now(),
  });
  const registry = new runtime.ExternalToolRegistry({
    nowMs: () => Date.now(),
    approvalLedger,
    artifactStore,
    approvalTtlMs: readPositiveInteger(process.env.MOYIN_SMOKE_APPROVAL_TTL_MS, 5 * 60_000),
  });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000),
    }),
  );

  const baseInput = {
    registry,
    projectId,
    runId,
    stepId,
    turnId: `moyin-smoke-execute:${projectId}:${runId}:${stepId}`,
    sessionKey: "moyin:smoke:workflow-execute-package",
    watchTimeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS, 10 * 60_000),
    heartbeatIntervalMs: Math.min(
      readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
      30_000,
    ),
    artifactStore,
    handoffManifestDirectory,
    metadata: {
      smoke: "moyin.workflow-execute-package",
    },
  };
  const preflight = await runtime.orchestrateMoyinWorkflowRunExecuteAndPackage(baseInput);
  const unavailable = preflight.error?.code === "CONTROL_PLANE_NOT_FOUND";
  if (!allowExecute || !executeApproval || preflight.status !== "approval-required") {
    return createSmokeSummary({
      result: preflight,
      unavailable,
      executeAttempted: false,
      reason:
        preflight.status === "approval-required"
          ? "explicit-execute-approval-required"
          : "execute-preflight-not-ready",
      nextActions:
        preflight.status === "approval-required"
          ? [
              "Review the approval id, sealedRequestId, and run/step status.",
              "Only rerun with MOYIN_SMOKE_ALLOW_EXECUTE=1 MOYIN_SMOKE_APPROVAL=EXECUTE when you want a real workflow-run execute.",
            ]
          : ["Fix the reported preflight blocker before attempting workflow-run execute."],
    });
  }

  const executed = await runtime.orchestrateMoyinWorkflowRunExecuteAndPackage({
    ...baseInput,
    approval: { status: "approved", operatorId: "moyin-smoke-operator" },
    sandboxPreflight: {
      verdict: "allow",
      sandboxMode: "workspace-write",
      checkedAt: new Date().toISOString(),
      providerId: "moyin",
      reason: "explicit MOYIN_SMOKE_ALLOW_EXECUTE workflow-run execute smoke approval",
    },
    sandboxRuntimePolicy: {
      enabledBackends: ["workspace-write"],
    },
  });
  return createSmokeSummary({
    result: executed,
    unavailable: false,
    executeAttempted: true,
    reason: "explicit-execute-approved",
    nextActions:
      executed.status === "packaged"
        ? ["Review artifacts and workflow exports before downstream handoff."]
        : ["Inspect the returned error/watch/package status before retrying."],
  });
}

function createSmokeSummary(input) {
  const result = input.result;
  const invoke = result.advance.advance;
  return {
    schemaVersion: "director.moyin.workflow-execute-package-smoke.v1",
    status: input.unavailable && !requireControlPlane ? "unavailable" : result.status,
    exitCode:
      input.unavailable && !requireControlPlane ? 0 : input.executeAttempted && !result.ok ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    artifactStoreRoot,
    handoffManifestDirectory,
    projectId: result.projectId,
    runId: result.runId,
    stepId: result.stepId,
    sealedRequestId: result.sealedRequestId,
    taskId: result.taskId,
    approvalId: invoke?.approval?.id,
    approvalExpiresAtMs: readMetadataNumber(invoke?.metadata, "approvalExpiresAtMs"),
    execute: {
      attempted: input.executeAttempted,
      reason: input.reason,
    },
    submit: {
      attempted: input.executeAttempted,
      reason: input.reason,
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
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: input.nextActions,
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

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readMetadataNumber(metadata, key) {
  if (metadata === undefined || metadata === null || typeof metadata !== "object") {
    return undefined;
  }
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
