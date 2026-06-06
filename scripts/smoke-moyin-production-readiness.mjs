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
const approvalPacketDirectory =
  process.env.MOYIN_SMOKE_APPROVAL_PACKET_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-approval-packets");
const handoffManifestDirectory =
  process.env.MOYIN_SMOKE_HANDOFF_MANIFEST_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-handoff-manifests");
const readinessReportDirectory =
  process.env.MOYIN_SMOKE_READINESS_REPORT_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-readiness-reports");
const approvalLedgerRoot =
  readEnvString(process.env.MOYIN_SMOKE_APPROVAL_LEDGER_ROOT) ??
  join(workspaceRoot, ".hotflow/conversation-runtime/approval-ledger");
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
const runId =
  readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
  readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

try {
  const result = await runMoyinProductionReadinessSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-production-readiness-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runMoyinProductionReadinessSmoke() {
  const runtime = await importFreshConversationRuntime(workspaceRoot);
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

  const report = await runtime.evaluateMoyinProductionReadiness({
    registry,
    projectId,
    runId,
    artifactStore,
    approvalPacketDirectory,
    handoffManifestDirectory,
    readinessReportDirectory,
    watchTimeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS, 10 * 60_000),
    heartbeatIntervalMs: Math.min(
      readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
      30_000,
    ),
    turnId:
      projectId === undefined || runId === undefined
        ? "moyin-smoke-production-readiness"
        : `moyin-smoke-production-readiness:${projectId}:${runId}`,
    sessionKey: "moyin:smoke:production-readiness",
    metadata: {
      smoke: "moyin.production-readiness",
      submitAttempted: false,
      advanceAttempted: false,
      executeAttempted: false,
    },
  });
  const controlPlaneUnavailable =
    report.handshake.status === "unavailable" ||
    String(report.handshake.error ?? "").includes("unavailable");

  return {
    schemaVersion: "director.moyin.production-readiness-smoke.v1",
    status: controlPlaneUnavailable && !requireControlPlane ? "unavailable" : report.status,
    exitCode: controlPlaneUnavailable && !requireControlPlane ? 0 : report.status === "blocked" ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    artifactStoreRoot,
    approvalPacketDirectory,
    handoffManifestDirectory,
    readinessReportDirectory,
    projectId,
    runId,
    readiness: summarizeReadiness(report),
    mutation: report.mutation,
    nextActions: report.nextActions,
  };
}

function summarizeReadiness(report) {
  return {
    schemaVersion: report.schemaVersion,
    status: report.status,
    gates: report.gates,
    effectiveNextAction: report.effectiveNextAction,
    approvalPacket:
      report.nextGate?.approvalPacket?.approvalPacket === undefined
        ? undefined
        : {
            status: report.nextGate.approvalPacket.status,
            advanceAction: report.nextGate.approvalPacket.approvalPacket.advanceAction,
            stepId: report.nextGate.approvalPacket.approvalPacket.stepId,
            sealedRequestId: report.nextGate.approvalPacket.approvalPacket.sealedRequestId,
            approvalId: report.nextGate.approvalPacket.approvalPacket.approvalId,
            artifactId: report.nextGate.approvalPacket.approvalPacketArtifact?.id,
          },
    readinessArtifact:
      report.readinessArtifact === undefined
        ? undefined
        : {
            id: report.readinessArtifact.id,
            kind: report.readinessArtifact.kind,
            path: report.readinessArtifact.path,
          },
    package:
      report.nextGate?.package === undefined
        ? undefined
        : {
            status: report.nextGate.package.status,
            artifactCount: report.nextGate.package.artifacts.length,
            jsonExportOk: report.nextGate.package.exports.json?.ok,
            comfyuiDraftExportOk: report.nextGate.package.exports.comfyuiDraft?.ok,
            handoffManifestArtifactId: report.nextGate.package.handoffManifestArtifact?.id,
          },
    metadata: report.metadata,
  };
}

function readEnvString(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
