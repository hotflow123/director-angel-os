#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshConversationRuntime } from "./smoke-runtime-import.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
const runId =
  readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
  readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";
const artifactStoreRoot =
  process.env.MOYIN_SMOKE_ARTIFACT_STORE_ROOT ||
  join(workspaceRoot, ".hotflow/conversation-runtime/external-artifacts");
const approvalPacketDirectory =
  process.env.MOYIN_SMOKE_APPROVAL_PACKET_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-approval-packets");

try {
  const result = await runWorkflowApprovalPacketSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-approval-packet-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowApprovalPacketSmoke() {
  if (projectId === undefined || runId === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-approval-packet-smoke.v1",
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
      approvalPacket: undefined,
      submit: {
        attempted: false,
        reason: "approval-packet-smoke-never-submits",
      },
      advance: {
        attempted: false,
        reason: "approval-packet-smoke-never-advances",
      },
      execute: {
        attempted: false,
        reason: "approval-packet-smoke-never-executes",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and MOYIN_SMOKE_WORKFLOW_RUN_ID to build an approval packet.",
      ],
    };
  }

  const runtime = await importRuntime();
  const artifactStore = runtime.createFileConversationRuntimeExternalArtifactStore({
    rootPath: artifactStoreRoot,
    defaultRetention: "user_controlled",
    defaultSensitivity: "internal",
    defaultCleanupPolicyRef: "artifactPolicy.moyin.approval-packet.user-controlled",
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

  const packet = await runtime.createMoyinWorkflowRunApprovalPacket({
    registry,
    projectId,
    runId,
    sessionKey: "moyin:smoke:workflow-approval-packet",
    artifactStore,
    approvalPacketDirectory,
    metadata: {
      smoke: "moyin.workflow-approval-packet",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const unavailable = isControlPlaneUnavailable(packet);
  const status = unavailable && !requireControlPlane ? "unavailable" : packet.status;

  return {
    schemaVersion: "director.moyin.workflow-approval-packet-smoke.v1",
    status,
    exitCode: unavailable && !requireControlPlane ? 0 : packet.ok ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    projectId: packet.projectId,
    runId: packet.runId,
    read: {
      attempted: true,
      ok: packet.plan.stepsResult.ok,
      status: packet.plan.stepsResult.status,
      operationId: packet.plan.stepsResult.operationId,
      stepCount: packet.plan.metadata.stepCount,
    },
    plan: {
      status: packet.plan.status,
      nextAction: packet.plan.nextAction,
      metadata: packet.plan.metadata,
    },
    approvalPacket: packet.approvalPacket,
    approvalPacketArtifact: summarizeApprovalPacketArtifact(packet),
    submit: {
      attempted: false,
      reason: "approval-packet-smoke-never-submits",
    },
    advance: {
      attempted: false,
      reason: "approval-packet-smoke-never-advances",
    },
    execute: {
      attempted: false,
      reason: "approval-packet-smoke-never-executes",
    },
    metadata: packet.metadata,
    ...(packet.error === undefined ? {} : { error: packet.error }),
    nextActions: createNextActions(packet, unavailable),
  };
}

function summarizeApprovalPacketArtifact(packet) {
  if (packet.approvalPacketArtifact === undefined) {
    return undefined;
  }
  return {
    id: packet.approvalPacketArtifact.id,
    kind: packet.approvalPacketArtifact.kind,
    path: packet.approvalPacketArtifact.path,
    persisted: packet.approvalPacketArtifactPersistence?.status === "ok",
    persistenceStatus: packet.approvalPacketArtifactPersistence?.status,
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function createNextActions(packet, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:approval-packet`."];
  }
  if (packet.status === "approval-required" && packet.approvalPacket?.nextInvocation) {
    return [
      "Show this approval packet to the user.",
      "Only after explicit approval, run approvalPacket.nextInvocation.shellCommand.",
    ];
  }
  if (packet.status === "not-required") {
    return ["No approval is needed for the next runtime action; inspect the plan nextAction."];
  }
  return ["Inspect the structured error before retrying or asking for approval."];
}

function isControlPlaneUnavailable(packet) {
  return (
    packet.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    packet.plan.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    packet.advancePreflight?.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    packet.executePreflight?.error?.code === "CONTROL_PLANE_NOT_FOUND"
  );
}

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
