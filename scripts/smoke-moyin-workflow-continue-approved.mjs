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
const approvalPacketDirectory =
  process.env.MOYIN_SMOKE_APPROVAL_PACKET_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-approval-packets");
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
const runId =
  readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
  readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
const stepId = readEnvString(process.env.MOYIN_SMOKE_STEP_ID);
const action = readEnvString(process.env.MOYIN_SMOKE_ADVANCE_ACTION);
const sealedRequestId = readEnvString(process.env.MOYIN_SMOKE_SEALED_REQUEST_ID);
const approvalId = readEnvString(process.env.MOYIN_SMOKE_APPROVAL_ID);
const approvalTurnId = readEnvString(process.env.MOYIN_SMOKE_APPROVAL_TURN_ID);
const approvalSessionKey = readEnvString(process.env.MOYIN_SMOKE_APPROVAL_SESSION_KEY);
const resumeToken = readEnvString(process.env.MOYIN_SMOKE_RESUME_TOKEN);
const approvalExpiresAtMs = readPositiveInteger(process.env.MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS);
const allowContinue = process.env.MOYIN_SMOKE_ALLOW_CONTINUE === "1";
const approvalMarker = readEnvString(process.env.MOYIN_SMOKE_APPROVAL);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";
const reissueExpiredApprovalPacket =
  readBooleanEnv(process.env.MOYIN_SMOKE_REISSUE_EXPIRED_APPROVAL, true);

try {
  const result = await runWorkflowContinueApprovedSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-continue-approved-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowContinueApprovedSmoke() {
  if (projectId === undefined || runId === undefined || stepId === undefined || action === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-continue-approved-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      stepId,
      action,
      continue: {
        attempted: false,
        reason: "project-run-step-or-action-not-provided",
      },
      submit: {
        attempted: false,
        reason: "workflow-continue-approved-smoke-never-submits-directly",
      },
      nextActions: [
        "Run this from approvalPacket.nextInvocation, or set MOYIN_SMOKE_PROJECT_ID, MOYIN_SMOKE_WORKFLOW_RUN_ID, MOYIN_SMOKE_STEP_ID, and MOYIN_SMOKE_ADVANCE_ACTION.",
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

  const packet = createApprovalPacket();
  const approved = allowContinue && approvalMarker === "APPROVED";
  const rejected = allowContinue && approvalMarker === "REJECTED";
  const result = await runtime.orchestrateMoyinWorkflowRunContinueApproved({
    registry,
    approvalPacket: packet,
    ...(approved
      ? { approval: { status: "approved", operatorId: "moyin-smoke-operator" } }
      : rejected
        ? { approval: { status: "rejected", operatorId: "moyin-smoke-operator" } }
        : {}),
    ...(approved
      ? {
          sandboxPreflight: {
            verdict: "allow",
            sandboxMode: "workspace-write",
            checkedAt: new Date().toISOString(),
            providerId: "moyin",
            reason: "explicit MOYIN_SMOKE_ALLOW_CONTINUE approval packet continuation",
          },
          sandboxRuntimePolicy: {
            enabledBackends: ["workspace-write"],
          },
        }
      : {}),
    watchTimeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS, 10 * 60_000),
    heartbeatIntervalMs: Math.min(
      readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
      30_000,
    ),
    artifactStore,
    handoffManifestDirectory,
    approvalPacketDirectory,
    reissueExpiredApprovalPacket,
    metadata: {
      smoke: "moyin.workflow-continue-approved",
    },
  });
  const unavailable = result.error?.code === "CONTROL_PLANE_NOT_FOUND";
  return createSmokeSummary({
    result,
    unavailable,
    approved,
    reason: approved ? "explicit-continuation-approved" : "explicit-continuation-approval-required",
  });
}

function createApprovalPacket() {
  const binding = {
    turnId:
      approvalTurnId ??
      (action === "execute"
        ? `moyin-smoke-execute:${projectId}:${runId}:${stepId}`
        : `moyin-smoke-advance:${projectId}:${runId}:${stepId}:${action}`),
    sessionKey: approvalSessionKey ?? "moyin:workflow-run:approval-packet",
  };
  return {
    schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
    type: "approval_request",
    providerId: "moyin",
    operationId: "workflow-run.advance",
    advanceAction: action,
    projectId,
    runId,
    stepId,
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    ...(approvalId === undefined ? {} : { approvalId }),
    ...(approvalExpiresAtMs === undefined ? {} : { approvalExpiresAtMs }),
    approvalBinding: binding,
    requiresApproval: true,
    riskLevel: action === "build_request" ? "medium" : "high",
    resumeToken:
      resumeToken ?? `moyin-workflow-run:${projectId}:${runId}:${stepId}:${action}`,
    nextInvocation: {
      packageScript: "moyin:smoke:continue-approved",
      env: {},
      shellCommand: "pnpm -s moyin:smoke:continue-approved",
    },
    mutation: {
      advanceAttempted: false,
      submitAttempted: false,
      executeAttempted: false,
    },
  };
}

function createSmokeSummary(input) {
  const result = input.result;
  const packageResult = result.execute?.package ?? result.nextGate?.package ?? result.nextGate?.resume?.package;
  const unavailableStatus = input.unavailable && !requireControlPlane;
  return {
    schemaVersion: "director.moyin.workflow-continue-approved-smoke.v1",
    status: unavailableStatus ? "unavailable" : result.status,
    exitCode: unavailableStatus ? 0 : input.approved && !result.ok ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    artifactStoreRoot,
    handoffManifestDirectory,
    projectId: result.projectId,
    runId: result.runId,
    stepId: result.stepId,
    action: result.action,
    approvalId: result.approvalId,
    sealedRequestId: result.sealedRequestId,
    taskId: result.taskId,
    continue: {
      attempted: result.metadata.advanceAttempted,
      reason: input.reason,
      reissueExpiredApprovalPacket,
    },
    advance: {
      attempted: result.metadata.advanceAttempted,
      ok: result.advance?.ok ?? result.execute?.advance.ok,
      status: result.advance?.status ?? result.execute?.advance.status,
      operationId: result.advance?.advance?.operationId ?? result.execute?.advance.advance?.operationId,
    },
    execute: {
      attempted: result.metadata.executeAttempted,
      ok: result.execute?.ok,
      status: result.execute?.status,
    },
    submit: {
      attempted: false,
      reason: "workflow-continue-approved-smoke-never-submits-directly",
    },
    nextGate: summarizeNextGate(result.nextGate),
    nextApprovalPacket: summarizeApprovalPacket(result.nextApprovalPacket),
    package: {
      attempted: result.metadata.packageAttempted,
      ok: packageResult?.ok,
      status: packageResult?.status,
      artifactCount: packageResult?.artifacts.length,
      jsonExportOk: packageResult?.exports.json?.ok,
      comfyuiDraftExportOk: packageResult?.exports.comfyuiDraft?.ok,
      handoffManifestArtifact: summarizeHandoffManifestArtifact(packageResult),
    },
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: createNextActions(result),
  };
}

function summarizeNextGate(nextGate) {
  if (nextGate === undefined) {
    return undefined;
  }
  return {
    status: nextGate.status,
    stoppedAt: nextGate.metadata.stoppedAt,
    nextAction: nextGate.plan.nextAction,
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
    resumeToken: packet.approvalPacket.resumeToken,
    nextInvocation: packet.approvalPacket.nextInvocation,
    artifact:
      packet.approvalPacketArtifact === undefined
        ? undefined
        : {
            id: packet.approvalPacketArtifact.id,
            kind: packet.approvalPacketArtifact.kind,
            path: packet.approvalPacketArtifact.path,
            persisted: packet.approvalPacketArtifactPersistence?.status === "ok",
            persistenceStatus: packet.approvalPacketArtifactPersistence?.status,
          },
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

function createNextActions(result) {
  if (result.nextApprovalPacket?.approvalPacket?.nextInvocation !== undefined) {
    return ["Review the next approval packet before running its nextInvocation command."];
  }
  if (result.status === "packaged") {
    return ["Review artifacts, workflow export, and ComfyUI draft before downstream handoff."];
  }
  if (result.status === "approval-required") {
    return ["Ask for explicit approval before continuing the next Moyin workflow-run mutation."];
  }
  if (result.ok) {
    return ["Run until-next-gate again to inspect the next Moyin workflow-run state."];
  }
  return ["Inspect the returned error and request a fresh approval packet before retrying."];
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

function readBooleanEnv(value, fallback) {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true";
}
