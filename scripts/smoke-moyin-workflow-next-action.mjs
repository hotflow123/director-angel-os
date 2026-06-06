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

try {
  const result = await runWorkflowNextActionSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-workflow-next-action-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runWorkflowNextActionSmoke() {
  if (projectId === undefined || runId === undefined) {
    return {
      schemaVersion: "director.moyin.workflow-next-action-smoke.v1",
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
        reason: "next-action-smoke-never-submits",
      },
      advance: {
        attempted: false,
        reason: "next-action-smoke-never-advances",
      },
      package: {
        attempted: false,
        reason: "next-action-smoke-only-plans",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and MOYIN_SMOKE_WORKFLOW_RUN_ID to inspect the next workflow-run action.",
      ],
    };
  }

  const runtime = await importRuntime();
  const registry = new runtime.ExternalToolRegistry({ nowMs: () => Date.now() });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000),
    }),
  );

  const result = await runtime.planMoyinWorkflowRunNextAction({
    registry,
    projectId,
    runId,
    turnId: `moyin-smoke-next-action:${projectId}:${runId}`,
    sessionKey: "moyin:smoke:workflow-next-action",
    metadata: {
      smoke: "moyin.workflow-next-action",
      submitAttempted: false,
      advanceAttempted: false,
    },
  });
  const unavailable = result.error?.code === "CONTROL_PLANE_NOT_FOUND";

  return {
    schemaVersion: "director.moyin.workflow-next-action-smoke.v1",
    status: unavailable && !requireControlPlane ? "unavailable" : result.status,
    exitCode: unavailable && !requireControlPlane ? 0 : result.ok ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    projectId: result.projectId,
    runId: result.runId,
    read: {
      attempted: true,
      ok: result.stepsResult.ok,
      status: result.stepsResult.status,
      operationId: result.stepsResult.operationId,
      stepCount: result.metadata.stepCount,
    },
    nextAction: result.nextAction,
    steps: result.steps.map((step) => ({
      stepId: step.stepId,
      status: step.status,
      action: step.action,
      requiresApproval: step.requiresApproval,
      sealedRequestId: step.sealedRequestId,
      taskId: step.taskId,
    })),
    submit: {
      attempted: false,
      reason: "next-action-smoke-never-submits",
    },
    advance: {
      attempted: false,
      reason: "next-action-smoke-never-advances",
    },
    package: {
      attempted: false,
      reason: "next-action-smoke-only-plans",
    },
    metadata: result.metadata,
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: createNextActions(result, unavailable),
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function createNextActions(result, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:next-action`."];
  }
  if (result.status === "approval-required") {
    return ["Ask the user for explicit approval before running execute-package smoke."];
  }
  if (result.status === "resumable") {
    return ["Use resume-package smoke with the returned taskId to recover watch/package."];
  }
  if (result.status === "completed") {
    return ["Use package smoke to collect artifacts and workflow exports."];
  }
  if (result.status === "ready-to-advance") {
    if (result.nextAction?.advanceAction === "execute") {
      return [
        "Prepare approval for workflow-run.advance execute, then watch the Moyin task for this non-gated step.",
      ];
    }
    return ["Build the sealed request only after explicit approval and sandbox preflight."];
  }
  if (result.status === "failed") {
    return ["Inspect the failed step before asking for retry approval."];
  }
  if (result.status === "waiting") {
    return ["Wait for dependency steps to become ready before advancing the workflow-run."];
  }
  return ["Inspect the returned workflow-run step state before choosing the next operation."];
}

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
