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
const approvalLedgerRoot =
  readEnvString(process.env.MOYIN_SMOKE_APPROVAL_LEDGER_ROOT) ??
  join(workspaceRoot, ".hotflow/conversation-runtime/approval-ledger");
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
const runId =
  readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
  readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";
const createApprovalPacket = readBooleanEnv(process.env.MOYIN_SMOKE_CREATE_APPROVAL_PACKET, true);

try {
  const result = await runWorkflowUntilNextGateSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(
    `[moyin-workflow-until-next-gate-smoke] ${String(error?.stack ?? error)}\n`,
  );
  process.exit(1);
}

async function runWorkflowUntilNextGateSmoke() {
  if (projectId === undefined || runId === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-until-next-gate-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      read: {
        attempted: false,
        reason: "project-id-or-workflow-run-id-not-provided",
      },
      submit: {
        attempted: false,
        reason: "until-next-gate-smoke-never-submits",
      },
      advance: {
        attempted: false,
        reason: "until-next-gate-smoke-never-advances",
      },
      resume: {
        attempted: false,
        reason: "until-next-gate-smoke-needs-runtime-plan",
      },
      package: {
        attempted: false,
        reason: "until-next-gate-smoke-needs-runtime-plan",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and MOYIN_SMOKE_WORKFLOW_RUN_ID to run until the next safe gate.",
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
    rootPath: approvalLedgerRoot,
    nowMs: () => Date.now(),
  });
  const registry = new runtime.ExternalToolRegistry({
    nowMs: () => Date.now(),
    artifactStore,
    approvalLedger,
    approvalTtlMs: readPositiveInteger(process.env.MOYIN_SMOKE_APPROVAL_TTL_MS, 5 * 60_000),
  });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000),
    }),
  );

  const result = await runtime.orchestrateMoyinWorkflowRunUntilNextGate({
    registry,
    projectId,
    runId,
    turnId: `moyin-smoke-until-next-gate:${projectId}:${runId}`,
    sessionKey: "moyin:smoke:workflow-until-next-gate",
    collectPackage: readBooleanEnv(process.env.MOYIN_SMOKE_COLLECT_PACKAGE, true),
    createApprovalPacket,
    watchTimeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS, 10 * 60_000),
    heartbeatIntervalMs: Math.min(
      readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
      30_000,
    ),
    artifactStore,
    handoffManifestDirectory,
    resumeToken: `moyin-watch:${projectId}:${runId}:until-next-gate`,
    metadata: {
      smoke: "moyin.workflow-until-next-gate",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const unavailable = isControlPlaneUnavailable(result);
  const productionPackage = result.package ?? result.resume?.package;
  const watch = result.resume?.watch;
  const status = unavailable && !requireControlPlane ? "unavailable" : result.status;

  return {
    schemaVersion: "director.moyin.workflow-until-next-gate-smoke.v1",
    status,
    exitCode: unavailable && !requireControlPlane ? 0 : result.ok ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    artifactStoreRoot,
    approvalLedgerRoot,
    handoffManifestDirectory,
    projectId: result.projectId,
    runId: result.runId,
    read: {
      attempted: true,
      ok: result.plan.stepsResult.ok,
      status: result.plan.stepsResult.status,
      operationId: result.plan.stepsResult.operationId,
      stepCount: result.plan.metadata.stepCount,
    },
    plan: {
      status: result.plan.status,
      nextAction: result.plan.nextAction,
      metadata: result.plan.metadata,
    },
    effectiveNextAction: result.effectiveNextAction,
    approvalPacket: summarizeApprovalPacket(result.approvalPacket),
    submit: {
      attempted: false,
      reason: "until-next-gate-smoke-never-submits",
    },
    advance: {
      attempted: false,
      reason: "until-next-gate-smoke-never-advances",
    },
    resume: {
      attempted: result.metadata.resumeAttempted,
      status: result.resume?.status,
      stepId: result.resume?.stepId,
      taskId: result.resume?.taskId,
    },
    watch: {
      attempted: watch !== undefined,
      ok: watch?.ok,
      status: watch?.status,
    },
    package: {
      attempted: result.metadata.packageAttempted,
      ok: productionPackage?.ok,
      status: productionPackage?.status,
      artifactCount: productionPackage?.artifacts.length,
      jsonExportOk: productionPackage?.exports.json?.ok,
      comfyuiDraftExportOk: productionPackage?.exports.comfyuiDraft?.ok,
      handoffManifestArtifact: summarizeHandoffManifestArtifact(productionPackage),
    },
    artifacts:
      productionPackage?.artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        path: artifact.path,
        url: artifact.url,
        taskId: readMetadataString(artifact.metadata, "taskId"),
        stepId: readMetadataString(artifact.metadata, "stepId"),
      })) ?? [],
    metadata: result.metadata,
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: createNextActions(result, unavailable),
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

function summarizeApprovalPacket(packet) {
  if (packet?.approvalPacket === undefined) {
    return undefined;
  }
  return {
    status: packet.status,
    operationId: packet.approvalPacket.operationId,
    advanceAction: packet.approvalPacket.advanceAction,
    stepId: packet.approvalPacket.stepId,
    sealedRequestId: packet.approvalPacket.sealedRequestId,
    approvalId: packet.approvalPacket.approvalId,
    approvalExpiresAtMs: packet.approvalPacket.approvalExpiresAtMs,
    artifactId: packet.approvalPacketArtifact?.id,
    nextInvocation: packet.approvalPacket.nextInvocation,
    preflightAttempted: packet.metadata.preflightAttempted,
    executePreflight: packet.executePreflight
      ? {
          status: packet.executePreflight.status,
          error: packet.executePreflight.error,
        }
      : undefined,
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function createNextActions(result, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:until-next-gate`."];
  }
  if (result.status === "approval-required") {
    return ["Ask the user for explicit approval before running the matching gated mutation smoke."];
  }
  if (result.status === "packaged") {
    return ["Review artifacts and workflow exports before downstream handoff."];
  }
  if (result.status === "partial" || result.status === "resumed") {
    return [
      "If package is partial, inspect run status and artifact registry before retrying.",
      "If watch timed out, rerun until-next-gate after Moyin reports progress.",
    ];
  }
  if (result.status === "waiting") {
    return ["Wait for dependencies or taskId, then rerun until-next-gate."];
  }
  return ["Inspect the structured error before retrying or asking for approval."];
}

function isControlPlaneUnavailable(result) {
  return (
    result.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    result.plan.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    result.resume?.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    result.package?.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    result.resume?.package?.error?.code === "CONTROL_PLANE_NOT_FOUND"
  );
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
