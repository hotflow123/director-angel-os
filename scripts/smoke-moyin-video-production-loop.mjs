#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshConversationRuntime } from "./smoke-runtime-import.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const mode =
  readEnvString(process.env.MOYIN_SMOKE_LOOP_MODE) ??
  (readEnvString(process.env.MOYIN_SMOKE_APPROVAL_PACKET_JSON) === undefined &&
  readEnvString(process.env.MOYIN_SMOKE_APPROVAL_PACKET_ARTIFACT_ID) === undefined
    ? "start"
    : "continue-approved");
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
const planFile = readEnvString(process.env.MOYIN_SMOKE_PLAN_FILE);
const scratchRoot = readEnvString(process.env.MOYIN_SMOKE_SCRATCH_ROOT);
const requireControlPlane = process.env.MOYIN_SMOKE_REQUIRE_CONTROL_PLANE === "1";
const autoAdapterDrafts = process.env.MOYIN_SMOKE_AUTO_ADAPTER_DRAFTS === "1";
const allowContinue = process.env.MOYIN_SMOKE_ALLOW_CONTINUE === "1";
const approvalMarker = readEnvString(process.env.MOYIN_SMOKE_APPROVAL);
const reissueExpiredApprovalPacket =
  process.env.MOYIN_SMOKE_REISSUE_EXPIRED_APPROVAL === "1";
const maxEventSummaryItems = readPositiveInteger(process.env.MOYIN_SMOKE_MAX_EVENT_SUMMARY, 50);

try {
  const result = await runVideoProductionLoopSmoke();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-video-production-loop-smoke] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runVideoProductionLoopSmoke() {
  if (mode !== "start" && mode !== "continue-approved") {
    return createBlockedSummary({
      reason: "unsupported-loop-mode",
      nextActions: ["Set MOYIN_SMOKE_LOOP_MODE to start or continue-approved."],
    });
  }

  if (mode === "start" && projectId === undefined) {
    return createBlockedSummary({
      reason: "project-id-not-provided",
      nextActions: [
        "Set MOYIN_SMOKE_PROJECT_ID and optionally MOYIN_SMOKE_PLAN_FILE to create a no-submit dry-run workflow-run.",
      ],
    });
  }
  if (mode === "continue-approved" && !hasApprovalPacketInput()) {
    return createBlockedSummary({
      reason: "approval-packet-not-provided",
      nextActions: [
        "Pass MOYIN_SMOKE_APPROVAL_PACKET_ARTIFACT_ID, MOYIN_SMOKE_APPROVAL_PACKET_JSON, or set project/run/step/action env values from an approval packet.",
      ],
    });
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

  const events = [];
  const onEvent = (event) => {
    events.push(event);
  };
  const approval = createApproval();
  const orchestration =
    mode === "start"
      ? await runtime.orchestrateMoyinVideoProductionLoop({
          mode: "start",
          registry,
          projectId,
          plan: loadVideoProductionPlan(projectId),
          resolveExecutionDrafts: autoAdapterDrafts,
          ...(scratchRoot === undefined ? {} : { scratchRoot }),
          turnId: `moyin-smoke-video-production-loop:${projectId}`,
          sessionKey: "moyin:smoke:video-production-loop",
          metadata: {
            smoke: "moyin.video-production-loop.start",
            submitAttempted: false,
            advanceAttempted: false,
          },
          artifactStore,
          handoffManifestDirectory,
          approvalPacketDirectory,
          onEvent,
        })
      : await runtime.orchestrateMoyinVideoProductionLoop({
          mode: "continue-approved",
          registry,
          approvalPacket: loadApprovalPacket(runtime, artifactStore),
          ...(approval === undefined ? {} : { approval }),
          ...(allowContinue && approvalMarker === "APPROVED"
            ? {
                sandboxPreflight: {
                  verdict: "allow",
                  sandboxMode: "workspace-write",
                  checkedAt: new Date().toISOString(),
                  providerId: "moyin",
                  reason: "explicit MOYIN_SMOKE_ALLOW_CONTINUE video production loop continuation",
                },
                sandboxRuntimePolicy: {
                  enabledBackends: ["workspace-write"],
                },
              }
            : {}),
          watchTimeoutMs: readPositiveInteger(
            process.env.MOYIN_SMOKE_WATCH_TIMEOUT_MS,
            10 * 60_000,
          ),
          heartbeatIntervalMs: Math.min(
            readPositiveInteger(process.env.MOYIN_SMOKE_HEARTBEAT_MS, 30_000),
            30_000,
          ),
          artifactStore,
          handoffManifestDirectory,
          approvalPacketDirectory,
          reissueExpiredApprovalPacket,
          metadata: {
            smoke: "moyin.video-production-loop.continue-approved",
          },
          onEvent,
        });

  const unavailable = orchestration.error?.code === "CONTROL_PLANE_NOT_FOUND";
  return createLoopSummary({ result: orchestration, unavailable, events });
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
  const idea =
    readEnvString(process.env.MOYIN_SMOKE_IDEA) ??
    "A young inventor reveals a tiny glowing robot in a safe cinematic workshop.";
  const scriptText = readEnvString(process.env.MOYIN_SMOKE_SCRIPT_TEXT);
  return {
    projectId: defaultProjectId,
    goal:
      readEnvString(process.env.MOYIN_SMOKE_GOAL) ??
      "Create a no-submit Moyin video production workflow from a Director Angel user goal.",
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
        name: readEnvString(process.env.MOYIN_SMOKE_SCENE_NAME) ?? "Production loop smoke scene",
        imagePrompt:
          readEnvString(process.env.MOYIN_SMOKE_IMAGE_PROMPT) ??
          "A safe production loop storyboard frame.",
        videoPrompt:
          readEnvString(process.env.MOYIN_SMOKE_VIDEO_PROMPT) ??
          "A safe production loop storyboard motion.",
        imageExecution: readJsonEnv("MOYIN_SMOKE_IMAGE_EXECUTION_JSON"),
        videoExecution: readJsonEnv("MOYIN_SMOKE_VIDEO_EXECUTION_JSON"),
      },
    ],
  };
}

function loadApprovalPacket(runtime, artifactStore) {
  const artifactId = readEnvString(process.env.MOYIN_SMOKE_APPROVAL_PACKET_ARTIFACT_ID);
  if (artifactId !== undefined) {
    const readResult = runtime.readMoyinWorkflowRunApprovalPacketFromArtifact({
      artifactStore,
      approvalPacketArtifactId: artifactId,
    });
    if (!readResult.ok || readResult.approvalPacket === undefined) {
      throw new Error(
        `MOYIN_SMOKE_APPROVAL_PACKET_ARTIFACT_ID could not be restored: ${readResult.error?.code ?? readResult.status}`,
      );
    }
    return readResult.approvalPacket;
  }

  const json = readEnvString(process.env.MOYIN_SMOKE_APPROVAL_PACKET_JSON);
  if (json !== undefined) {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("MOYIN_SMOKE_APPROVAL_PACKET_JSON must contain a JSON object.");
    }
    return parsed;
  }

  const packetProjectId = readEnvString(process.env.MOYIN_SMOKE_PROJECT_ID);
  const runId =
    readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
    readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
  const stepId = readEnvString(process.env.MOYIN_SMOKE_STEP_ID);
  const action = readEnvString(process.env.MOYIN_SMOKE_ADVANCE_ACTION);
  if (
    packetProjectId === undefined ||
    runId === undefined ||
    stepId === undefined ||
    action === undefined
  ) {
    throw new Error(
      "continue-approved mode requires MOYIN_SMOKE_APPROVAL_PACKET_ARTIFACT_ID, MOYIN_SMOKE_APPROVAL_PACKET_JSON, or project/run/step/action env values.",
    );
  }
  return {
    schemaVersion: "director.moyin.workflow-run.approval-packet.v1",
    type: "approval_request",
    providerId: "moyin",
    operationId: "workflow-run.advance",
    advanceAction: action,
    projectId: packetProjectId,
    runId,
    stepId,
    ...(readEnvString(process.env.MOYIN_SMOKE_SEALED_REQUEST_ID) === undefined
      ? {}
      : { sealedRequestId: readEnvString(process.env.MOYIN_SMOKE_SEALED_REQUEST_ID) }),
    ...(readEnvString(process.env.MOYIN_SMOKE_APPROVAL_ID) === undefined
      ? {}
      : { approvalId: readEnvString(process.env.MOYIN_SMOKE_APPROVAL_ID) }),
    ...(readPositiveInteger(process.env.MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS) === undefined
      ? {}
      : {
          approvalExpiresAtMs: readPositiveInteger(process.env.MOYIN_SMOKE_APPROVAL_EXPIRES_AT_MS),
        }),
    approvalBinding: {
      turnId:
        readEnvString(process.env.MOYIN_SMOKE_APPROVAL_TURN_ID) ??
        `moyin-smoke-production-loop:${packetProjectId}:${runId}:${stepId}:${action}`,
      sessionKey:
        readEnvString(process.env.MOYIN_SMOKE_APPROVAL_SESSION_KEY) ??
        "moyin:video-production-loop:approval-packet",
    },
    requiresApproval: true,
    riskLevel: action === "build_request" ? "medium" : "high",
    resumeToken:
      readEnvString(process.env.MOYIN_SMOKE_RESUME_TOKEN) ??
      `moyin-workflow-run:${packetProjectId}:${runId}:${stepId}:${action}`,
    nextInvocation: {
      packageScript: "moyin:smoke:production-loop",
      env: {},
      shellCommand: "pnpm -s moyin:smoke:production-loop",
    },
    mutation: {
      advanceAttempted: false,
      submitAttempted: false,
      executeAttempted: false,
    },
  };
}

function hasApprovalPacketInput() {
  if (readEnvString(process.env.MOYIN_SMOKE_APPROVAL_PACKET_ARTIFACT_ID) !== undefined) {
    return true;
  }
  if (readEnvString(process.env.MOYIN_SMOKE_APPROVAL_PACKET_JSON) !== undefined) {
    return true;
  }
  const runId =
    readEnvString(process.env.MOYIN_SMOKE_WORKFLOW_RUN_ID) ??
    readEnvString(process.env.MOYIN_SMOKE_RUN_ID);
  return (
    projectId !== undefined &&
    runId !== undefined &&
    readEnvString(process.env.MOYIN_SMOKE_STEP_ID) !== undefined &&
    readEnvString(process.env.MOYIN_SMOKE_ADVANCE_ACTION) !== undefined
  );
}

function createApproval() {
  if (!allowContinue) {
    return undefined;
  }
  if (approvalMarker === "APPROVED") {
    return { status: "approved", operatorId: "moyin-smoke-operator" };
  }
  if (approvalMarker === "REJECTED") {
    return { status: "rejected", operatorId: "moyin-smoke-operator" };
  }
  return undefined;
}

function createLoopSummary({ result, unavailable, events }) {
  const unavailableStatus = unavailable && !requireControlPlane;
  const approvalPacket = result.approvalPacket?.approvalPacket;
  const productionPackage =
    result.continuation?.execute?.package ??
    result.continuation?.nextGate?.package ??
    result.continuation?.nextGate?.resume?.package;
  return {
    schemaVersion: "director.moyin.video-production-loop-smoke.v1",
    status: unavailableStatus ? "unavailable" : result.status,
    exitCode:
      unavailableStatus ||
      result.ok ||
      result.status === "blocked" ||
      result.status === "approval-required"
        ? 0
        : 1,
    workspaceRoot,
    binary: moyinBinary,
    mode: result.mode,
    projectId: result.projectId,
    runId: result.runId,
    operationSequence: result.operationSequence,
    metadata: result.metadata,
    events: summarizeLoopEvents(events),
    approvalPacket:
      approvalPacket === undefined
        ? undefined
        : {
            operationId: approvalPacket.operationId,
            advanceAction: approvalPacket.advanceAction,
            stepId: approvalPacket.stepId,
            sealedRequestId: approvalPacket.sealedRequestId,
            approvalId: approvalPacket.approvalId,
            approvalExpiresAtMs: approvalPacket.approvalExpiresAtMs,
            resumeToken: approvalPacket.resumeToken,
            nextInvocation: approvalPacket.nextInvocation,
            artifact: summarizeApprovalPacketArtifact(result.approvalPacket),
          },
    package:
      productionPackage === undefined
        ? undefined
        : {
            status: productionPackage.status,
            artifactCount: productionPackage.artifacts.length,
            jsonExportOk: productionPackage.exports.json?.ok,
            comfyuiDraftExportOk: productionPackage.exports.comfyuiDraft?.ok,
            handoffManifestArtifact: productionPackage.handoffManifestArtifact,
          },
    ...(result.error === undefined ? {} : { error: result.error }),
    nextActions: createNextActions(result, unavailable),
  };
}

function summarizeApprovalPacketArtifact(packetResult) {
  if (packetResult?.approvalPacketArtifact === undefined) {
    return undefined;
  }
  return {
    id: packetResult.approvalPacketArtifact.id,
    kind: packetResult.approvalPacketArtifact.kind,
    path: packetResult.approvalPacketArtifact.path,
    persisted: packetResult.approvalPacketArtifactPersistence?.status === "ok",
    persistenceStatus: packetResult.approvalPacketArtifactPersistence?.status,
  };
}

function summarizeLoopEvents(events) {
  const items = events.slice(-maxEventSummaryItems).map((event) => ({
    kind: event.kind,
    projectId: event.projectId,
    runId: event.runId,
    stepId: event.stepId,
    ...(event.sealedRequestId === undefined ? {} : { sealedRequestId: event.sealedRequestId }),
    ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
    ...(event.resumeToken === undefined ? {} : { resumeToken: event.resumeToken }),
    occurredAtMs: event.occurredAtMs,
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
  }));
  return {
    count: events.length,
    emitted: items.length,
    omitted: Math.max(0, events.length - items.length),
    items,
  };
}

function createBlockedSummary({ reason, nextActions }) {
  return {
    schemaVersion: "director.moyin.video-production-loop-smoke.v1",
    status: "blocked",
    exitCode: 0,
    workspaceRoot,
    binary: moyinBinary,
    mode,
    projectId,
    runId: undefined,
    operationSequence: [],
    metadata: {
      submitAttempted: false,
      advanceAttempted: false,
      executeAttempted: false,
      packageAttempted: false,
    },
    blocked: {
      reason,
    },
    nextActions,
  };
}

function createNextActions(result, unavailable) {
  if (unavailable) {
    return ["Start the Moyin desktop app, then rerun the production loop smoke."];
  }
  if (result.approvalPacket?.approvalPacket?.nextInvocation !== undefined) {
    return [
      "Review the approval packet and ask for explicit approval before running its nextInvocation.",
    ];
  }
  if (result.status === "packaged") {
    return ["Review the handoff manifest, artifacts, JSON export, and ComfyUI draft."];
  }
  if (result.status === "approval-required") {
    return ["Do not continue until the user explicitly approves this approval packet."];
  }
  if (result.ok) {
    return ["Run the same shared production loop entry for the next safe boundary."];
  }
  return ["Inspect the structured error and retry only with a fresh approval packet if needed."];
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

function readEnvString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}
