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
const taskId = readEnvString(process.env.MOYIN_SMOKE_TASK_ID);
const sealedRequestId = readEnvString(process.env.MOYIN_SMOKE_SEALED_REQUEST_ID);
const reason = readEnvString(process.env.MOYIN_SMOKE_CANCEL_REASON) ?? "operator requested stop";
const allowCancel = process.env.MOYIN_SMOKE_ALLOW_CANCEL === "1";
const cancelApproval = process.env.MOYIN_SMOKE_APPROVAL === "CANCEL";
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";

try {
  const result = await runWorkflowCancelSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-cancel-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowCancelSmoke() {
  if (projectId === undefined || runId === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-cancel-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      projectId,
      runId,
      cancel: {
        attempted: false,
        reason: "project-or-run-not-provided",
      },
      submit: {
        attempted: false,
        reason: "workflow-cancel-smoke-never-submits",
      },
      advance: {
        attempted: false,
        reason: "workflow-cancel-smoke-never-advances",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and MOYIN_SMOKE_WORKFLOW_RUN_ID to inspect cancellation readiness.",
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
    ...(stepId === undefined ? {} : { stepId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(sealedRequestId === undefined ? {} : { sealedRequestId }),
    reason,
    turnId: `moyin-smoke-cancel:${projectId}:${runId}`,
    sessionKey: "moyin:smoke:workflow-cancel",
    metadata: {
      smoke: "moyin.workflow-cancel",
      submitAttempted: false,
      advanceAttempted: false,
    },
  };

  const preflight = await runtime.orchestrateMoyinWorkflowRunCancel(baseInput);
  const unavailable = preflight.error?.code === "CONTROL_PLANE_NOT_FOUND";
  if (!allowCancel || !cancelApproval || preflight.status !== "approval-required") {
    return createSmokeSummary({
      result: preflight,
      unavailable,
      cancelAttempted: false,
      reason:
        preflight.status === "approval-required"
          ? "explicit-cancel-approval-required"
          : "cancel-preflight-not-ready",
      nextActions:
        preflight.status === "approval-required"
          ? [
              "Review the runId, stepId, taskId, and approval id before cancelling.",
              "Only rerun with MOYIN_SMOKE_ALLOW_CANCEL=1 MOYIN_SMOKE_APPROVAL=CANCEL when you want to stop this workflow-run.",
            ]
          : ["Inspect the structured preflight result before retrying cancellation."],
    });
  }

  const cancelled = await runtime.orchestrateMoyinWorkflowRunCancel({
    ...baseInput,
    approval: { status: "approved", operatorId: "moyin-smoke-operator" },
    sandboxPreflight: {
      verdict: "allow",
      sandboxMode: "workspace-write",
      checkedAt: new Date().toISOString(),
      providerId: "moyin",
      reason: "explicit MOYIN_SMOKE_ALLOW_CANCEL workflow-run cancellation approval",
    },
    sandboxRuntimePolicy: {
      enabledBackends: ["workspace-write"],
    },
  });
  return createSmokeSummary({
    result: cancelled,
    unavailable: false,
    cancelAttempted: true,
    reason: "explicit-cancel-approved",
    nextActions: cancelled.ok
      ? ["Run next-action smoke to confirm the workflow-run stopped."]
      : ["Inspect the returned cancellation error before retrying."],
  });
}

function createSmokeSummary(input) {
  const result = input.result;
  return {
    schemaVersion: "director.moyin.workflow-cancel-smoke.v1",
    status: input.unavailable && !requireControlPlane ? "unavailable" : result.status,
    exitCode:
      input.unavailable && !requireControlPlane ? 0 : input.cancelAttempted && !result.ok ? 1 : 0,
    workspaceRoot,
    binary: moyinBinary,
    projectId: result.projectId,
    runId: result.runId,
    stepId: result.stepId,
    sealedRequestId: result.sealedRequestId,
    taskId: result.taskId,
    cancel: {
      attempted: input.cancelAttempted,
      reason: input.reason,
      taskCancelAttempted: result.metadata.taskCancelAttempted,
      workflowRunCancelAttempted: result.metadata.workflowRunCancelAttempted,
      taskCancelStatus: result.taskCancel?.status,
      workflowRunCancelStatus: result.workflowRunCancel?.status,
    },
    submit: {
      attempted: false,
      reason: "workflow-cancel-smoke-never-submits",
    },
    advance: {
      attempted: false,
      reason: "workflow-cancel-smoke-never-advances",
    },
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: input.nextActions,
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
