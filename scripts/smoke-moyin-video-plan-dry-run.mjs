#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshConversationRuntime } from "./smoke-runtime-import.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const projectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
const planFile = readEnvString(process.env.MOYIN_SMOKE_PLAN_FILE);
const scratchRoot = readEnvString(process.env.MOYIN_SMOKE_SCRATCH_ROOT);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";
const autoAdapterDrafts = process.env.MOYIN_SMOKE_AUTO_ADAPTER_DRAFTS === "1";
const untilNextGate = process.env.MOYIN_SMOKE_UNTIL_NEXT_GATE === "1";
const artifactStoreRoot =
  process.env.MOYIN_SMOKE_ARTIFACT_STORE_ROOT ||
  join(workspaceRoot, ".hotflow/conversation-runtime/external-artifacts");
const approvalPacketDirectory =
  process.env.MOYIN_SMOKE_APPROVAL_PACKET_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-approval-packets");

try {
  const result = await runVideoPlanDryRunSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-video-plan-dry-run-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runVideoPlanDryRunSmoke() {
  if (projectId === undefined) {
    return {
      schemaVersion: "director.moyin.video-plan-dry-run-smoke.v1",
      status: "blocked",
      exitCode: 0,
      workspaceRoot,
      binary: moyinBinary,
      create: {
        attempted: false,
        reason: "project-id-not-provided",
      },
      submit: {
        attempted: false,
        reason: "video-plan-dry-run-smoke-never-submits",
      },
      advance: {
        attempted: false,
        reason: "video-plan-dry-run-smoke-never-advances",
      },
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and optionally MOYIN_SMOKE_PLAN_FILE to create a no-submit dry-run workflow-run.",
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
  const registry = new runtime.ExternalToolRegistry({ nowMs: () => Date.now(), artifactStore });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: readPositiveInteger(process.env.MOYIN_SMOKE_COMMAND_TIMEOUT_MS, 30_000),
    }),
  );

  const basePlan = loadVideoProductionPlan(projectId);
  const commonInput = {
    registry,
    projectId,
    plan: basePlan,
    resolveExecutionDrafts: autoAdapterDrafts,
    ...(scratchRoot === undefined ? {} : { scratchRoot }),
    turnId: `moyin-smoke-video-plan-dry-run:${projectId}`,
    sessionKey: "moyin:smoke:video-plan-dry-run",
    artifactStore,
    approvalPacketDirectory,
    metadata: {
      smoke: "moyin.video-plan-dry-run",
      submitAttempted: false,
      advanceAttempted: false,
    },
  };
  const orchestration = untilNextGate
    ? await runtime.orchestrateMoyinVideoProductionDryRunUntilNextGate(commonInput)
    : await runtime.orchestrateMoyinVideoProductionDryRunWorkflow(commonInput);
  const result = untilNextGate ? orchestration.dryRun : orchestration;
  const unavailable =
    orchestration.status === "unavailable" ||
    result.status === "unavailable" ||
    orchestration.error?.code === "CONTROL_PLANE_NOT_FOUND" ||
    result.error?.code === "CONTROL_PLANE_NOT_FOUND";
  const runId =
    untilNextGate && orchestration.runId !== undefined
      ? orchestration.runId
      : readInvokeResultString(result.create.createResult, "runId");
  return {
    schemaVersion: "director.moyin.video-plan-dry-run-smoke.v1",
    status: unavailable && !requireControlPlane ? "unavailable" : orchestration.status,
    exitCode:
      unavailable && !requireControlPlane
        ? 0
        : orchestration.ok || orchestration.status === "blocked"
          ? 0
          : 1,
    workspaceRoot,
    binary: moyinBinary,
    projectId,
    ...(runId === undefined ? {} : { runId }),
    draft: {
      blockerCount: result.draft.diagnostics.blockerCount,
      blockers: result.draft.diagnostics.blockers,
      warnings: result.draft.diagnostics.warnings,
      stepCount: result.draft.request.steps.length,
      paidStepCount: result.draft.diagnostics.paidStepIds.length,
      nonExecutableStepCount: result.draft.diagnostics.nonExecutableStepIds.length,
      mode: result.draft.request.mode,
      requireBeforeSubmit: result.draft.request.approvalPolicy.requireBeforeSubmit,
    },
    adapterDrafts: result.adapterDrafts,
    create: {
      attempted: result.create.createResult !== undefined,
      ...(result.create.createResult === undefined
        ? { reason: "draft-blocked-before-provider" }
        : {
            ok: result.create.createResult.ok,
            status: result.create.createResult.status,
            operationId: result.create.createResult.operationId,
          }),
    },
    submit: {
      attempted: false,
      reason: "video-plan-dry-run-smoke-never-submits",
    },
    advance: {
      attempted: false,
      reason: "video-plan-dry-run-smoke-never-advances",
    },
    ...(untilNextGate
      ? {
          untilNextGate: {
            attempted: true,
            status: orchestration.nextGate?.status,
            nextAction: orchestration.nextGate?.plan.nextAction,
          },
          approvalPacket: summarizeApprovalPacket(orchestration.approvalPacket),
        }
      : {
          untilNextGate: {
            attempted: false,
            reason: "set-MOYIN_SMOKE_UNTIL_NEXT_GATE-to-1",
          },
        }),
    ...(orchestration.error === undefined ? {} : { error: orchestration.error }),
    nextActions: createNextActions(orchestration, unavailable),
  };
}

async function importRuntime() {
  return importFreshConversationRuntime(workspaceRoot);
}

function loadVideoProductionPlan(defaultProjectId) {
  if (planFile !== undefined) {
    const parsed = JSON.parse(readFileSync(planFile, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MOYIN_SMOKE_PLAN_FILE must contain a JSON object.");
    }
    return { ...parsed, projectId: readEnvString(parsed.projectId) ?? defaultProjectId };
  }
  const goal =
    readEnvString(process.env.MOYIN_SMOKE_GOAL) ??
    "Create a no-submit Moyin dry-run workflow from a Director Angel user goal.";
  const idea =
    readEnvString(process.env.MOYIN_SMOKE_IDEA) ??
    "A young inventor reveals a tiny glowing robot in a safe cinematic workshop.";
  const scriptText = readEnvString(process.env.MOYIN_SMOKE_SCRIPT_TEXT);
  return {
    projectId: defaultProjectId,
    goal,
    ...(scriptText === undefined ? { idea } : { scriptText }),
    target: "director",
    scriptExecution: readJsonEnv("MOYIN_SMOKE_SCRIPT_EXECUTION_JSON"),
    characters: [
      {
        characterId: "smoke-inventor",
        characterName: readEnvString(process.env.MOYIN_SMOKE_CHARACTER_NAME) ?? "Inventor",
        prompt:
          readEnvString(process.env.MOYIN_SMOKE_CHARACTER_PROMPT) ??
          "A curious young inventor wearing practical workshop clothes.",
        imageExecution: readJsonEnv("MOYIN_SMOKE_CHARACTER_IMAGE_EXECUTION_JSON"),
      },
    ],
    scenes: [
      {
        sceneId: 1,
        name: readEnvString(process.env.MOYIN_SMOKE_SCENE_NAME) ?? "Dry-run scene",
        imagePrompt:
          readEnvString(process.env.MOYIN_SMOKE_IMAGE_PROMPT) ??
          "A safe dry-run storyboard frame.",
        videoPrompt:
          readEnvString(process.env.MOYIN_SMOKE_VIDEO_PROMPT) ??
          "A safe dry-run storyboard motion.",
        imageExecution: readJsonEnv("MOYIN_SMOKE_IMAGE_EXECUTION_JSON"),
        videoExecution: readJsonEnv("MOYIN_SMOKE_VIDEO_EXECUTION_JSON"),
      },
    ],
  };
}

function createNextActions(result, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun `pnpm moyin:smoke:plan-dry-run`."];
  }
  if (result.status === "approval-required") {
    return [
      "Ask the user for explicit approval before running the approvalPacket.nextInvocation command.",
      "Do not run advance/submit from this smoke without the explicit gated approval env.",
    ];
  }
  if (result.status === "created") {
    return [
      "Inspect the dry-run workflow-run steps before any approval-gated execute.",
      "Use package/export smoke to verify the dry-run remains no-submit.",
    ];
  }
  if (result.status === "blocked") {
    return [
      "Resolve draft blockers by providing execution payloads or a MOYIN_SMOKE_PLAN_FILE.",
      "Do not add hardcoded provider/model defaults in Director Angel.",
    ];
  }
  return ["Inspect the returned provider error before retrying."];
}

function summarizeApprovalPacket(result) {
  if (result === undefined) {
    return undefined;
  }
  return {
    status: result.status,
    preflightAttempted: result.metadata?.preflightAttempted,
    ...(result.approvalPacket === undefined
      ? {}
      : {
          operationId: result.approvalPacket.operationId,
          advanceAction: result.approvalPacket.advanceAction,
          stepId: result.approvalPacket.stepId,
          sealedRequestId: result.approvalPacket.sealedRequestId,
          approvalId: result.approvalPacket.approvalId,
          approvalExpiresAtMs: result.approvalPacket.approvalExpiresAtMs,
          resumeToken: result.approvalPacket.resumeToken,
          nextInvocation: result.approvalPacket.nextInvocation,
          artifact:
            result.approvalPacketArtifact === undefined
              ? undefined
              : {
                  id: result.approvalPacketArtifact.id,
                  kind: result.approvalPacketArtifact.kind,
                  path: result.approvalPacketArtifact.path,
                  persisted: result.approvalPacketArtifactPersistence?.status === "ok",
                  persistenceStatus: result.approvalPacketArtifactPersistence?.status,
                },
        }),
  };
}

function readJsonEnv(name) {
  const value = readEnvString(process.env[name]);
  if (value === undefined) {
    return undefined;
  }
  const parsed = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed;
}

function readInvokeResultString(result, key) {
  if (result === undefined) {
    return undefined;
  }
  return (
    readRecordString(result.output, key) ??
    readRecordString(readRecord(result.output)?.output, key) ??
    readRecordString(readRecord(result.output)?.payload, key) ??
    readRecordString(readRecord(readRecord(result.output)?.output)?.payload, key)
  );
}

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

function readRecordString(value, key) {
  const record = readRecord(value);
  const nested = record?.[key];
  return typeof nested === "string" && nested.trim().length > 0 ? nested.trim() : undefined;
}
