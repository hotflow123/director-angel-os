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
const stepId = readEnvString(process.env.MOYIN_SMOKE_STEP_ID);
const action = readEnvString(process.env.MOYIN_SMOKE_ADVANCE_ACTION);
const file = readEnvString(process.env.MOYIN_SMOKE_ADVANCE_FILE);
const execution = readEnvString(process.env.MOYIN_SMOKE_ADVANCE_EXECUTION);
const allowAdvance = process.env.MOYIN_SMOKE_ALLOW_ADVANCE === "1";
const advanceApproval = process.env.MOYIN_SMOKE_APPROVAL === "ADVANCE";
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

try {
  const result = await runWorkflowAdvanceSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-advance-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowAdvanceSmoke() {
  if (projectId === undefined || runId === undefined || stepId === undefined || action === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-advance-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      stepId,
      action,
      advance: {
        attempted: false,
        reason: "project-run-step-or-action-not-provided",
      },
      submit: {
        attempted: false,
        reason: "workflow-advance-smoke-never-submits",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID, MOYIN_SMOKE_WORKFLOW_RUN_ID, MOYIN_SMOKE_STEP_ID, and MOYIN_SMOKE_ADVANCE_ACTION.",
      ],
    };
  }

  if (action === "execute") {
    return {
      schemaVersion: "director.moyin.workflow-advance-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      stepId,
      action,
      advance: {
        attempted: false,
        reason: "execute-must-use-execute-package-smoke",
      },
      submit: {
        attempted: false,
        reason: "workflow-advance-smoke-never-submits",
      },
      nextActions: [
        "Use `pnpm moyin:smoke:execute-package` for workflow-run execute so task watch and artifact packaging stay attached.",
      ],
    };
  }

  const runtime = await importRuntime();
  const approvalLedger = runtime.createFileConversationRuntimeApprovalLedger({
    rootPath:
      readEnvString(process.env.MOYIN_SMOKE_APPROVAL_LEDGER_ROOT) ??
      join(workspaceRoot, ".hotflow/conversation-runtime/approval-ledger"),
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

  const baseInput = {
    registry,
    projectId,
    runId,
    stepId,
    action,
    ...(file === undefined ? {} : { file }),
    ...(execution === undefined ? {} : { execution }),
    turnId: `moyin-smoke-advance:${projectId}:${runId}:${stepId}:${action}`,
    sessionKey: "moyin:smoke:workflow-advance",
    metadata: {
      smoke: "moyin.workflow-advance",
    },
  };
  const preflight = await runtime.orchestrateMoyinWorkflowRunAdvance(baseInput);
  const unavailable = preflight.error?.code === "CONTROL_PLANE_NOT_FOUND";
  if (!allowAdvance || !advanceApproval || preflight.status !== "approval-required") {
    return createSmokeSummary({
      result: preflight,
      unavailable,
      advanceAttempted: false,
      reason:
        preflight.status === "approval-required"
          ? "explicit-advance-approval-required"
          : "advance-preflight-not-ready",
      nextActions:
        preflight.status === "approval-required"
          ? [
              "Review the approval id, runId, stepId, action, and pre-advance step state.",
              "Only rerun with MOYIN_SMOKE_ALLOW_ADVANCE=1 MOYIN_SMOKE_APPROVAL=ADVANCE when you want this workflow-run mutation.",
            ]
          : ["Fix the reported preflight blocker before attempting workflow-run advance."],
    });
  }

  const advanced = await runtime.orchestrateMoyinWorkflowRunAdvance({
    ...baseInput,
    approval: { status: "approved", operatorId: "moyin-smoke-operator" },
    sandboxPreflight: {
      verdict: "allow",
      sandboxMode: "workspace-write",
      checkedAt: new Date().toISOString(),
      providerId: "moyin",
      reason: "explicit MOYIN_SMOKE_ALLOW_ADVANCE workflow-run advance smoke approval",
    },
    sandboxRuntimePolicy: {
      enabledBackends: ["workspace-write"],
    },
  });
  return createSmokeSummary({
    result: advanced,
    unavailable: false,
    advanceAttempted: true,
    reason: "explicit-advance-approved",
    nextActions: advanced.ok
      ? ["Run next-action smoke again to inspect the next approval-gated step."]
      : ["Inspect the returned advance error before retrying."],
  });
}

function createSmokeSummary(input) {
  const result = input.result;
  return {
    schemaVersion: "director.moyin.workflow-advance-smoke.v1",
    status: input.unavailable && !requireControlPlane ? "unavailable" : result.status,
    exitCode:
      input.unavailable && !requireControlPlane ? 0 : input.advanceAttempted && !result.ok ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    projectId: result.projectId,
    runId: result.runId,
    stepId: result.stepId,
    action: result.action,
    approvalId: result.advance?.approval?.id,
    approvalExpiresAtMs: readMetadataNumber(result.advance?.metadata, "approvalExpiresAtMs"),
    sealedRequestId:
      readStepString(result.postAdvanceStep, "sealedRequestId") ??
      readStepString(result.preAdvanceStep, "sealedRequestId") ??
      readOutputString(result.advance?.output, "sealedRequestId"),
    taskId:
      readStepString(result.postAdvanceStep, "taskId") ??
      readStepString(result.preAdvanceStep, "taskId") ??
      readOutputString(result.advance?.output, "taskId"),
    preAdvanceStep: summarizeStep(result.preAdvanceStep),
    postAdvanceStep: summarizeStep(result.postAdvanceStep),
    advance: {
      attempted: input.advanceAttempted,
      reason: input.reason,
      ok: result.advance?.ok,
      status: result.advance?.status,
      operationId: result.advance?.operationId,
    },
    submit: {
      attempted: false,
      reason: "workflow-advance-smoke-never-submits",
    },
    artifacts: {
      attempted: result.artifacts !== undefined,
      ok: result.artifacts?.ok,
      status: result.artifacts?.status,
      count: Array.isArray(result.artifacts?.artifacts) ? result.artifacts.artifacts.length : undefined,
    },
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: input.nextActions,
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function summarizeStep(step) {
  if (step === undefined) {
    return undefined;
  }
  return {
    stepId: step.stepId,
    status: step.status,
    action: step.action,
    requiresApproval: step.requiresApproval,
    sealedRequestId: step.sealedRequestId,
    taskId: step.taskId,
  };
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

function readStepString(step, key) {
  if (step === undefined || step === null || typeof step !== "object") {
    return undefined;
  }
  const value = step[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOutputString(output, key) {
  if (output === undefined || output === null || typeof output !== "object") {
    return undefined;
  }
  const direct = output[key];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const nestedOutput = output.output;
  if (nestedOutput !== undefined && nestedOutput !== output) {
    return readOutputString(nestedOutput, key);
  }
  const payload = output.payload;
  if (payload !== undefined && payload !== output) {
    return readOutputString(payload, key);
  }
  return undefined;
}
