#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshConversationRuntime } from "./smoke-runtime-import.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const approvalLedgerRoot =
  readEnvString(process.env.MOYIN_SMOKE_APPROVAL_LEDGER_ROOT) ??
  join(workspaceRoot, ".hotflow/conversation-runtime/approval-ledger");
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);

try {
  const result = await runMoyinProjectReadinessSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-project-readiness-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runMoyinProjectReadinessSmoke() {
  const runtime = await importFreshConversationRuntime(workspaceRoot);
  const approvalLedger = runtime.createFileConversationRuntimeApprovalLedger({
    rootPath: approvalLedgerRoot,
    nowMs: () => Date.now(),
  });
  const registry = new runtime.ExternalToolRegistry({
    nowMs: () => Date.now(),
    approvalLedger,
    approvalTtlMs: readPositiveInteger(process.env.MOYIN_SMOKE_APPROVAL_TTL_MS, 5 * 60_000),
  });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000),
    }),
  );

  const report = await runtime.evaluateMoyinProjectReadiness({
    registry,
    ...(projectId === undefined ? {} : { projectId }),
    turnId:
      projectId === undefined
        ? "moyin-smoke-project-readiness"
        : `moyin-smoke-project-readiness:${projectId}`,
    sessionKey: "moyin:smoke:project-readiness",
    metadata: {
      smoke: "moyin.project-readiness",
      submitAttempted: false,
      projectCreateAttempted: false,
      workflowRunCreateAttempted: false,
    },
  });

  return {
    schemaVersion: "director.moyin.project-readiness-smoke.v1",
    status: report.status,
    exitCode: report.status === "ready" ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    projectId,
    readiness: summarizeProjectReadiness(report),
    mutation: report.mutation,
    nextActions: report.nextActions,
  };
}

function summarizeProjectReadiness(report) {
  return {
    schemaVersion: report.schemaVersion,
    status: report.status,
    blockerCode: report.blockerCode,
    project: report.project,
    gates: report.gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
      summary: gate.summary,
      hardValidation: summarizeHardValidation(gate.evidence),
      itemCount: readRecordNumber(gate.evidence, "itemCount"),
    })),
  };
}

function summarizeHardValidation(evidence) {
  const hardValidation = readRecord(evidence)?.hardValidation;
  if (!isRecord(hardValidation)) {
    return undefined;
  }
  return hardValidation;
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

function readRecord(value) {
  return isRecord(value) ? value : undefined;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecordNumber(value, key) {
  const record = readRecord(value);
  const candidate = record?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}
