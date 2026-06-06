#!/usr/bin/env node
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importFreshConversationRuntime } from "./smoke-runtime-import.mjs";

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultMoyinCli = "moyin";
const moyinBinary = process.env.MOYIN_BINARY || defaultMoyinCli;
const artifactStoreRoot =
  process.env.MOYIN_GOAL_ARTIFACT_STORE_ROOT ||
  join(workspaceRoot, ".hotflow/conversation-runtime/external-artifacts");
const handoffManifestDirectory =
  process.env.MOYIN_GOAL_HANDOFF_MANIFEST_DIR ||
  join(workspaceRoot, ".hotflow/conversation-runtime/moyin-handoff-manifests");
const approvalLedgerRoot =
  process.env.MOYIN_GOAL_APPROVAL_LEDGER_ROOT ||
  join(workspaceRoot, ".hotflow/conversation-runtime/approval-ledger");
const scratchRoot =
  process.env.MOYIN_GOAL_SCRATCH_ROOT ||
  mkdtempSync(join(tmpdir(), "director-moyin-sclass-nine-grid-reference-"));
const watchTimeoutMs = readPositiveInteger(process.env.MOYIN_GOAL_WATCH_TIMEOUT_MS, 20 * 60_000);
const commandTimeoutMs = readPositiveInteger(
  process.env.MOYIN_GOAL_COMMAND_TIMEOUT_MS,
  Math.max(30_000, watchTimeoutMs + 30_000),
);
const sessionKey = "moyin:goal:sclass-nine-grid-reference";
const turnPrefix = "moyin-goal-sclass-nine-grid-reference";
const schemaVersion = "director.moyin.goal.sclass-nine-grid-reference.v1";
const secondStepUiPath = [
  "分组生成-九宫格分组（更连贯）",
  "生成构图方案",
  "九宫格图-生成九宫格参考图",
  "复核九宫格图",
];

try {
  const result = await runGoal();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-goal-sclass-nine-grid-reference] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runGoal() {
  const runtime = await importFreshConversationRuntime(workspaceRoot);
  const artifactStore = runtime.createFileConversationRuntimeExternalArtifactStore({
    rootPath: artifactStoreRoot,
    defaultRetention: "user_controlled",
    defaultSensitivity: "internal",
    defaultCleanupPolicyRef: "artifactPolicy.moyin.sclass-nine-grid-reference.user-controlled",
  });
  const approvalLedger = runtime.createFileConversationRuntimeApprovalLedger({
    rootPath: approvalLedgerRoot,
    nowMs: () => Date.now(),
  });
  const registry = new runtime.ExternalToolRegistry({
    nowMs: () => Date.now(),
    approvalLedger,
    artifactStore,
    approvalTtlMs: readPositiveInteger(process.env.MOYIN_GOAL_APPROVAL_TTL_MS, 5 * 60_000),
  });
  registry.register(
    runtime.createMoyinProviderRegistration({
      binary: moyinBinary,
      timeoutMs: commandTimeoutMs,
    }),
  );

  const events = [];
  const status = await invokeMoyin(runtime, registry, {
    operationId: "health",
    args: {},
    turnSuffix: "status",
    events,
  });
  if (!status.result.ok) {
    return createFailureSummary({
      status: status.result.status,
      phase: "status",
      events,
      result: status.result,
    });
  }
  const statusPayload = unwrapPayload(status.result);
  const session = readRecord(statusPayload?.session);
  const projectDataRoot = readString(session?.projectDataRoot)
    ?? (readString(session?.userDataPath) ? join(readString(session?.userDataPath), "workspace-data/projects") : undefined);

  const projectList = await invokeMoyin(runtime, registry, {
    operationId: "project.list",
    args: {},
    turnSuffix: "project-list",
    events,
  });
  const projectListPayload = unwrapPayload(projectList.result);
  const projectId =
    readString(process.env.MOYIN_GOAL_PROJECT_ID) ??
    readString(projectListPayload?.activeProjectId) ??
    readString(projectListPayload?.items?.find?.((item) => item?.active)?.id);
  if (!projectList.result.ok || projectId === undefined || projectDataRoot === undefined) {
    return createFailureSummary({
      status: "blocked",
      phase: "project.resolve",
      events,
      result: projectList.result,
      extra: {
        projectId,
        projectDataRoot,
        nextActions: [
          "Start Moyin, open or create a project that already passed script -> S-Class, then rerun.",
          "Optionally set MOYIN_GOAL_PROJECT_ID and MOYIN_GOAL_GROUP_ID.",
        ],
      },
    });
  }

  const beforeSclass = readSclassProject(projectDataRoot, projectId);
  const groupId = readString(process.env.MOYIN_GOAL_GROUP_ID) ?? selectFirstGroupId(beforeSclass);
  if (groupId === undefined) {
    return createFailureSummary({
      status: "blocked",
      phase: "group.resolve",
      projectId,
      events,
      extra: {
        projectDataRoot,
        nextActions: ["The Moyin S-Class project has no shotGroups; pass the first script/S-Class gate first."],
      },
    });
  }

  const initialGroup = findGroup(beforeSclass, groupId);
  const forceRegenerateGrid = process.env.MOYIN_GOAL_FORCE_REGENERATE_GRID === "1";
  const reuseExistingGridReference = !forceRegenerateGrid && isReusableNineGridReference(initialGroup);
  const existingGridReferenceReason = "existing-moyin-grid-reference";

  let compositionRunId = null;
  let gridRunId = null;
  let gridTaskId = null;
  let backfill = null;
  let imageExecutionSummary = {
    status: "skipped",
    reason: existingGridReferenceReason,
    promptSource: "moyin-existing-group-grid-asset",
  };
  let compositionSummary = createSkippedExecutionSummary(existingGridReferenceReason, summarizeNineGridReferenceState(initialGroup));
  let gridImageSummary = createSkippedExecutionSummary(existingGridReferenceReason, summarizeNineGridReferenceState(initialGroup));

  if (reuseExistingGridReference) {
    events.push({
      source: "script",
      kind: "moyin.sclass.grid_reference.reuse_existing",
      status: "skipped",
      reason: existingGridReferenceReason,
      projectId,
      groupId,
      state: summarizeNineGridReferenceState(initialGroup),
    });
  } else {
    const compositionRun = await createSingleStepRun(runtime, registry, {
      projectId,
      stepId: "nine-grid-composition",
      command: "sclass.nine-grid-composition",
      templateId: "sclass.nine-grid-composition",
      requiresApproval: false,
      values: {
        projectId,
        groupId,
        analysisTarget: "nine-grid",
      },
      goal: `${secondStepUiPath[0]} -> ${secondStepUiPath[1]}`,
      events,
    });
    if (!compositionRun.ok) return compositionRun.failure;
    compositionRunId = compositionRun.runId;

    const compositionExecution = await executeWorkflowStep(runtime, registry, {
      projectId,
      runId: compositionRun.runId,
      stepId: "nine-grid-composition",
      label: "nine-grid-composition",
      artifactStore,
      events,
    });
    if (!compositionExecution.ok) {
      return createFailureSummary({
        status: compositionExecution.result.status,
        phase: "composition.execute",
        projectId,
        runId: compositionRun.runId,
        events,
        result: compositionExecution.result,
      });
    }
    compositionSummary = summarizeExecution(compositionExecution.result);

    const afterComposition = readSclassProject(projectDataRoot, projectId);
    const compositionGroup = findGroup(afterComposition, groupId);
    const boardSlotHintCount = compositionGroup?.blockingContinuityPlan?.boardSlotHints?.length ?? 0;
    if (compositionGroup?.generationStyle !== "nine-grid" || boardSlotHintCount <= 0) {
      return createFailureSummary({
        status: "failed",
        phase: "composition.verify",
        projectId,
        runId: compositionRun.runId,
        events,
        extra: {
          generationStyle: compositionGroup?.generationStyle,
          boardSlotHintCount,
          reason: "composition did not persist nine-grid style plus boardSlotHints",
        },
      });
    }

    const gridPrompt = readString(process.env.MOYIN_GOAL_GRID_PROMPT) ?? buildGridPromptFromSclassGroup(afterComposition, compositionGroup);
    const imageExecutionRequest = {
      projectId,
      panel: "sclass",
      mediaType: "image",
      feature: readString(process.env.MOYIN_GOAL_IMAGE_FEATURE) ?? "character_generation",
      prompt: gridPrompt,
      aspectRatio: readString(process.env.MOYIN_GOAL_IMAGE_ASPECT_RATIO) ?? "9:16",
      resolution: readString(process.env.MOYIN_GOAL_IMAGE_RESOLUTION) ?? "2K",
    };
    const imageExecutionRequestPath = writeScratchJson("sclass-grid-image-execution-request.json", imageExecutionRequest);
    const imageExecutionProbe = await invokeMoyin(runtime, registry, {
      operationId: "adapter.image-execution",
      args: { file: imageExecutionRequestPath },
      turnSuffix: "image-execution-probe",
      events,
    });
    const imageExecutionProbePayload = unwrapPayload(imageExecutionProbe.result);
    if (!imageExecutionProbe.result.ok || imageExecutionProbePayload?.executable === false && Array.isArray(imageExecutionProbePayload?.missing) && imageExecutionProbePayload.missing.length > 0) {
      return createFailureSummary({
        status: imageExecutionProbe.result.status,
        phase: "adapter.image-execution",
        projectId,
        events,
        result: imageExecutionProbe.result,
      });
    }
    imageExecutionSummary = {
      promptSource: readString(process.env.MOYIN_GOAL_GRID_PROMPT) ? "env" : "moyin-sclass-readonly-derived",
      probeStatus: imageExecutionProbe.result.status,
      missing: imageExecutionProbePayload?.missing,
      warnings: imageExecutionProbePayload?.warnings,
    };

    const gridRun = await createSingleStepRun(runtime, registry, {
      projectId,
      stepId: "group-grid-image",
      command: "sclass.group-grid-image",
      templateId: "sclass.group-grid-image",
      requiresApproval: true,
      values: {
        projectId,
        groupId,
        execution: imageExecutionRequest,
      },
      goal: `${secondStepUiPath[2]}，停止在图片阶段`,
      events,
    });
    if (!gridRun.ok) return gridRun.failure;
    gridRunId = gridRun.runId;

    const gridSealedRequest = await prepareWorkflowStepSealedRequest(runtime, registry, {
      projectId,
      runId: gridRun.runId,
      stepId: "group-grid-image",
      label: "group-grid-image",
      events,
    });
    if (!gridSealedRequest.ok) {
      return createFailureSummary({
        status: gridSealedRequest.result.status,
        phase: "grid-image.build-sealed-request",
        projectId,
        runId: gridRun.runId,
        events,
        result: gridSealedRequest.result,
      });
    }

    const gridExecution = await executeWorkflowStep(runtime, registry, {
      projectId,
      runId: gridRun.runId,
      stepId: "group-grid-image",
      label: "group-grid-image",
      artifactStore,
      events,
    });
    if (!gridExecution.ok) {
      return createFailureSummary({
        status: gridExecution.result.status,
        phase: "grid-image.execute",
        projectId,
        runId: gridRun.runId,
        events,
        result: gridExecution.result,
      });
    }
    gridImageSummary = summarizeExecution(gridExecution.result);

    gridTaskId = readString(gridExecution.result.taskId) ?? readTaskIdFromExecution(gridExecution.result);
    backfill = gridTaskId
      ? await invokeMoyin(runtime, registry, {
          operationId: "artifact.backfill",
          args: { projectId, taskId: gridTaskId },
          turnSuffix: "artifact-backfill",
          events,
        })
      : null;
  }

  const reviewRun = await createSingleStepRun(runtime, registry, {
    projectId,
    stepId: "group-grid-review",
    command: "sclass.group-grid-review",
    templateId: "sclass.group-grid-review",
    requiresApproval: false,
    values: {
      projectId,
      groupId,
    },
    goal: secondStepUiPath[3],
    events,
  });
  if (!reviewRun.ok) return reviewRun.failure;

  const reviewExecution = await executeWorkflowStep(runtime, registry, {
    projectId,
    runId: reviewRun.runId,
    stepId: "group-grid-review",
    label: "group-grid-review",
    artifactStore,
    events,
  });
  if (!reviewExecution.ok) {
    return createFailureSummary({
      status: reviewExecution.result.status,
      phase: "grid-review.execute",
      projectId,
      runId: reviewRun.runId,
      events,
      result: reviewExecution.result,
    });
  }

  const artifactList = await invokeMoyin(runtime, registry, {
    operationId: "artifact.list",
    args: { projectId },
    turnSuffix: "artifact-list",
    events,
  });
  const finalSclass = readSclassProject(projectDataRoot, projectId);
  const finalGroup = findGroup(finalSclass, groupId);
  const artifacts = readArray(unwrapPayload(artifactList.result)?.items);
  const gridArtifacts = artifacts.filter((artifact) => artifact?.role === "sclass-group-grid-image");
  const videoArtifacts = artifacts.filter((artifact) => artifact?.type === "video" || String(artifact?.role ?? "").includes("video"));
  const boardReviewAcceptable = finalGroup?.boardReviewStatus === "passed" || finalGroup?.boardReviewStatus === "warning";
  const verification = {
    generationStyle: finalGroup?.generationStyle,
    boardSlotHintCount: finalGroup?.blockingContinuityPlan?.boardSlotHints?.length ?? 0,
    gridGenerationStatus: finalGroup?.gridGenerationStatus,
    hasGroupGridAsset: Boolean(finalGroup?.groupGridAsset?.localUrl || finalGroup?.groupGridAsset?.httpUrl),
    groupGridMediaId: finalGroup?.groupGridMediaId ?? null,
    boardReviewStatus: finalGroup?.boardReviewStatus ?? null,
    boardReviewAcceptable,
    boardReviewSignature: finalGroup?.boardReviewSignature ?? null,
    boardReviewSummary: finalGroup?.boardReviewSummary ?? null,
    gridArtifactCount: gridArtifacts.length,
    videoArtifactCount: videoArtifacts.length,
  };
  const verified = verification.generationStyle === "nine-grid"
    && verification.boardSlotHintCount > 0
    && verification.gridGenerationStatus === "completed"
    && verification.hasGroupGridAsset
    && Boolean(verification.groupGridMediaId)
    && verification.boardReviewAcceptable
    && Boolean(verification.boardReviewSignature)
    && verification.gridArtifactCount > 0
    && verification.videoArtifactCount === 0;

  return {
    schemaVersion,
    status: verified ? "completed" : "failed",
    exitCode: verified ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    scratchRoot,
    projectId,
    groupId,
    uiPath: secondStepUiPath,
    reuseExistingGridReference,
    compositionRunId,
    gridRunId,
    reviewRunId: reviewRun.runId,
    gridTaskId,
    imageExecution: imageExecutionSummary,
    composition: compositionSummary,
    gridImage: gridImageSummary,
    gridReview: summarizeExecution(reviewExecution.result),
    backfill: backfill ? summarizeProviderPayload(backfill.result) : undefined,
    verification,
    artifacts: {
      gridArtifacts,
      videoArtifacts,
    },
    events: summarizeEvents(events),
    nextActions: verified
      ? ["九宫格图已完成复核；本目标仍停止在图片/复核阶段，不生成视频。"]
      : ["Inspect verification fields; do not advance to video until grid-image and board review checks pass."],
  };
}

async function createSingleStepRun(runtime, registry, input) {
  const runPath = writeScratchJson(`${input.stepId}-workflow-run.json`, {
    projectId: input.projectId,
    actor: "angel",
    mode: "interactive",
    goal: input.goal,
    approvalPolicy: {
      requireBeforeSubmit: true,
    },
    steps: [
      {
        stepId: input.stepId,
        command: input.command,
        templateId: input.templateId,
        requiresApproval: input.requiresApproval,
        retryable: true,
        maxAttempts: 1,
        payload: {
          values: input.values,
        },
      },
    ],
  });
  const created = await invokeMoyin(runtime, registry, {
    operationId: "workflow-run.create",
    args: { projectId: input.projectId, file: runPath },
    turnSuffix: `${input.stepId}-workflow-run-create`,
    events: input.events,
  });
  const payload = unwrapPayload(created.result);
  const runId = readString(payload?.runId) ?? readString(payload?.run?.runId);
  if (!created.result.ok || runId === undefined) {
    return {
      ok: false,
      failure: createFailureSummary({
        status: created.result.status,
        phase: `${input.stepId}.workflow-run.create`,
        projectId: input.projectId,
        events: input.events,
        result: created.result,
      }),
    };
  }
  return { ok: true, runId };
}

async function prepareWorkflowStepSealedRequest(runtime, registry, input) {
  const base = {
    registry,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    action: "build_sealed_request",
    turnId: `${turnPrefix}:${input.projectId}:${input.runId}:${input.stepId}:build-sealed-request`,
    sessionKey,
    metadata: {
      goal: "sclass-nine-grid-reference",
      label: input.label,
      noVideo: true,
      uiPath: secondStepUiPath,
      orchestrationPhase: "build-sealed-request",
    },
  };
  const preflight = await runtime.orchestrateMoyinWorkflowRunAdvance(base);
  if (preflight.status !== "approval-required") {
    input.events.push({
      source: "orchestrator",
      kind: "moyin.workflow_run.build_sealed_request.preflight",
      status: preflight.status,
      ok: preflight.ok,
      projectId: input.projectId,
      runId: input.runId,
      stepId: input.stepId,
      sealedRequestId: preflight.sealedRequestId,
    });
    return { ok: preflight.ok, result: preflight };
  }

  const built = await runtime.orchestrateMoyinWorkflowRunAdvance({
    ...base,
    approval: { status: "approved", operatorId: "director-angel-cli" },
    sandboxPreflight: createAllowSandboxPreflight(`build sealed request for ${input.label}`),
    sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
  });
  input.events.push({
    source: "orchestrator",
    kind: "moyin.workflow_run.build_sealed_request.completed",
    status: built.status,
    ok: built.ok,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    sealedRequestId: built.sealedRequestId,
  });
  return { ok: built.ok, result: built };
}

async function executeWorkflowStep(runtime, registry, input) {
  const base = {
    registry,
    projectId: input.projectId,
    runId: input.runId,
    stepId: input.stepId,
    turnId: `${turnPrefix}:${input.projectId}:${input.runId}:${input.stepId}`,
    sessionKey,
    watchTimeoutMs,
    heartbeatIntervalMs: 5_000,
    collectPackage: false,
    artifactStore: input.artifactStore,
    handoffManifestDirectory,
    metadata: {
      goal: "sclass-nine-grid-reference",
      label: input.label,
      noVideo: true,
      uiPath: secondStepUiPath,
    },
    onEvent: (event) => input.events.push({ source: "orchestrator", event }),
  };
  const preflight = await runtime.orchestrateMoyinWorkflowRunExecuteAndPackage(base);
  if (preflight.status !== "approval-required") {
    return { ok: preflight.ok, result: preflight };
  }
  const executed = await runtime.orchestrateMoyinWorkflowRunExecuteAndPackage({
    ...base,
    approval: { status: "approved", operatorId: "director-angel-cli" },
    sandboxPreflight: createAllowSandboxPreflight(`execute ${input.label}`),
    sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
  });
  return { ok: executed.ok, result: executed };
}

async function invokeMoyin(runtime, registry, input) {
  const baseRequest = {
    toolId: "moyin.provider",
    operationId: input.operationId,
    args: input.args,
    turnId: `${turnPrefix}:${input.turnSuffix}`,
    sessionKey,
    metadata: {
      goal: "sclass-nine-grid-reference",
      turnSuffix: input.turnSuffix,
      noVideo: true,
      uiPath: secondStepUiPath,
    },
  };
  const preflight = await runtime.invokeExternalTool(registry, baseRequest);
  if (preflight.status !== "approval-required") {
    input.events.push({
      source: "provider",
      operationId: input.operationId,
      status: preflight.status,
      ok: preflight.ok,
    });
    return { result: preflight };
  }
  input.events.push({
    source: "provider",
    operationId: input.operationId,
    status: preflight.status,
    approvalRequired: true,
    approvalId: preflight.approval?.id,
  });
  const result = await runtime.invokeExternalTool(registry, {
    ...baseRequest,
    approval: { status: "approved", operatorId: "director-angel-cli" },
    sandboxPreflight: createAllowSandboxPreflight(`approved ${input.operationId}`),
    sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
  });
  input.events.push({
    source: "provider",
    operationId: input.operationId,
    status: result.status,
    ok: result.ok,
  });
  return { result, preflight };
}

function readSclassProject(projectDataRoot, projectId) {
  const filePath = join(projectDataRoot, "_p", projectId, "sclass.json");
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  return readRecord(raw.state?.projectData) ?? readRecord(raw.projectData) ?? {};
}

function selectFirstGroupId(projectData) {
  const groups = readArray(projectData.shotGroups);
  return readString(groups[0]?.id);
}

function findGroup(projectData, groupId) {
  return readArray(projectData.shotGroups).find((group) => group?.id === groupId);
}

function isReusableNineGridReference(group) {
  return summarizeNineGridReferenceState(group).reusable;
}

function summarizeNineGridReferenceState(group) {
  const boardSlotHintCount = readArray(group?.blockingContinuityPlan?.boardSlotHints).length;
  const groupGridAsset = readRecord(group?.groupGridAsset);
  const hasGroupGridAsset = Boolean(readString(groupGridAsset?.localUrl) || readString(groupGridAsset?.httpUrl));
  return {
    reusable: group?.generationStyle === "nine-grid"
      && boardSlotHintCount > 0
      && group?.gridGenerationStatus === "completed"
      && hasGroupGridAsset,
    generationStyle: group?.generationStyle,
    boardSlotHintCount,
    gridGenerationStatus: group?.gridGenerationStatus,
    hasGroupGridAsset,
    groupGridMediaId: group?.groupGridMediaId ?? null,
    boardReviewStatus: group?.boardReviewStatus ?? null,
  };
}

function createSkippedExecutionSummary(reason, summary = {}) {
  return {
    ok: true,
    status: "skipped",
    reason,
    summary,
  };
}

function buildGridPromptFromSclassGroup(projectData, group) {
  const sceneMap = new Map(readArray(projectData.splitScenes).map((scene) => [scene.id, scene]));
  const scenes = readArray(group.sceneIds)
    .map((sceneId) => sceneMap.get(sceneId))
    .filter(Boolean);
  const hints = readArray(group.blockingContinuityPlan?.boardSlotHints);
  const lines = [
    "Generate a cinematic 9-grid S-Class storyboard reference image for this Moyin shot group.",
    "Stop at a reference board image; do not create video.",
    `Group: ${group.name || group.id}`,
    `Composition summary: ${group.blockingContinuityPlan?.summary || "use the board slot hints and script scenes"}`,
    "Board slot hints:",
    ...hints.map((hint) => [
      `Slot ${hint.slotIndex}`,
      hint.sceneId === undefined || hint.sceneId === null ? "" : `scene ${hint.sceneId}`,
      readArray(hint.visibleCharacters).length ? `characters: ${readArray(hint.visibleCharacters).join(", ")}` : "",
      hint.actionHint ? `action: ${hint.actionHint}` : "",
      hint.compositionHint ? `composition: ${hint.compositionHint}` : "",
      hint.dialogueCue ? `dialogue: ${hint.dialogueCue}` : "",
    ].filter(Boolean).join(" | ")),
    "Scene source:",
    ...scenes.map((scene, index) => {
      const text = scene.videoPromptZh || scene.videoPrompt || scene.imagePromptZh || scene.imagePrompt || scene.actionSummary || scene.visualDescription || "";
      return `${index + 1}. ${text}`;
    }),
    "Use clean panel separation, consistent characters, stable spatial continuity, and no video UI overlays.",
  ];
  return lines.filter(Boolean).join("\n");
}

function readTaskIdFromExecution(result) {
  return readString(result?.watch?.taskId)
    ?? readString(result?.metadata?.taskId)
    ?? readString(unwrapPayload(result?.watch)?.taskId)
    ?? readString(unwrapPayload(result?.watch)?.id);
}

function createAllowSandboxPreflight(reason) {
  return {
    verdict: "allow",
    sandboxMode: "workspace-write",
    checkedAt: new Date().toISOString(),
    providerId: "moyin",
    reason,
  };
}

function writeScratchJson(fileName, value) {
  const filePath = join(scratchRoot, fileName);
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function unwrapPayload(result) {
  const envelope = readRecord(result?.output);
  const output = readRecord(envelope?.output);
  return readRecord(output?.payload) ?? output ?? readRecord(envelope?.payload) ?? envelope;
}

function summarizeExecution(result) {
  return {
    ok: result.ok,
    status: result.status,
    taskId: result.taskId,
    watchStatus: result.watch?.status,
    watchOk: result.watch?.ok,
    packageCollected: result.metadata?.packageCollected,
    summary: unwrapPayload(result.watch)?.summary ?? unwrapPayload(result.watch),
  };
}

function summarizeProviderPayload(result) {
  const payload = unwrapPayload(result);
  if (payload === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(payload));
}

function summarizeEvents(events) {
  return {
    count: events.length,
    items: events.slice(-100).map((item) => {
      if (item.source !== "orchestrator" || item.event === undefined) return item;
      const event = item.event;
      return {
        source: item.source,
        kind: event.kind,
        projectId: event.projectId,
        runId: event.runId,
        stepId: event.stepId,
        taskId: event.taskId,
        occurredAtMs: event.occurredAtMs,
        metadata: event.metadata,
      };
    }),
  };
}

function createFailureSummary(input) {
  return {
    schemaVersion,
    status: input.status ?? "failed",
    exitCode: input.status === "blocked" ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    scratchRoot,
    phase: input.phase,
    projectId: input.projectId,
    runId: input.runId,
    result: input.result,
    extra: input.extra,
    events: summarizeEvents(input.events),
  };
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function readRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

function readString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
