#!/usr/bin/env node
import { mkdtempSync, writeFileSync } from "node:fs";
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
  mkdtempSync(join(tmpdir(), "director-moyin-script-import-sclass-"));
const watchTimeoutMs = readPositiveInteger(process.env.MOYIN_GOAL_WATCH_TIMEOUT_MS, 20 * 60_000);
const commandTimeoutMs = readPositiveInteger(
  process.env.MOYIN_GOAL_COMMAND_TIMEOUT_MS,
  Math.max(30_000, watchTimeoutMs + 30_000),
);
const sclassSceneShotAiTimeoutMs = readPositiveInteger(
  process.env.MOYIN_GOAL_SCLASS_SCENE_SHOT_AI_TIMEOUT_MS,
  90_000,
);
const goalMode = readGoalMode(process.argv.slice(2), process.env.MOYIN_GOAL_MODE);
const isGenerateMode = goalMode === "generate";
const schemaVersion = isGenerateMode
  ? "director.moyin.goal.script-generate-sclass.v1"
  : "director.moyin.goal.script-import-sclass.v1";
const goalLabel = isGenerateMode ? "script-generate-sclass" : "script-import-sclass";
const sessionKey = `moyin:goal:${goalLabel}`;
const turnPrefix = `moyin-goal-${goalLabel}`;

const SCRIPT_TEXT = process.env.MOYIN_GOAL_SCRIPT_TEXT || `《疯狂的石头》
大纲：
濒临倒闭的重庆工艺品厂在厕所墙里发现了一块价值连城的翡翠。为挽救工厂，厂长决定在破旧的文庙举办展览，并让保卫科长包世宏组建保安队负责安保。与此同时，房地产商冯董为强占工厂土地，雇佣国际大盗麦克前来偷窃翡翠。而本地以道哥为首的三个笨贼，也阴差阳错地将翡翠定为目标。几方人马围绕这块“疯狂的石头”，在狭小的文庙内外展开了一系列令人啼笑皆非的明争暗斗与阴差阳错，上演了一出环环相扣的黑色幽默闹剧。
人物小传：
谢小盟（25岁）： 厂长儿子，自诩香港归来艺术家，实则游手好闲、坑蒙拐骗。油嘴滑舌，善于用“艺术”、“感觉”泡妞，对美女菁菁一见钟情。
第1集：祸不单行
1-1 日 外 缆车
人物：谢小盟、美女、莫西干头青年
【字幕：山城重庆】
△江雾朦胧，缆车缓缓划过江面。谢小盟倚窗，对身旁美女深情款款。
谢小盟：（港腔普通话）这是我儿时的城市……这感觉好亲切，好强烈……你知道你什么气质吸引我？忧郁！
△谢小盟去拉美女的手。美女身后的莫西干头青年摘下耳机，站起身。
莫西干头青年：（一拳挥来）……`;
const SCRIPT_IDEA = process.env.MOYIN_GOAL_SCRIPT_IDEA || [
  "写一个 60 秒真人电影感黑色幽默短剧。",
  "故事发生在重庆旧工艺品厂和文庙附近，核心冲突是一块意外发现的高价翡翠。",
  "人物要有落魄保卫科长、贪婪地产商、笨贼三人组、假装艺术家的厂长儿子。",
  "要求输出可被 Moyin 剧本板块导入的完整短剧剧本：标题、大纲、人物小传、分集/场景、动作和对白。",
].join("\n");

const SCLASS_ADAPTATION_PROFILE = {
  entryTarget: "standard",
  entryGroupStyle: "standard",
  enabled: true,
  standardGroupMode: "novel",
  standardGroupLevel: 7,
  nineGridGroupMode: "cinematic",
  nineGridGroupLevel: 7,
  mergedSingleMode: "novel",
  mergedSingleLevel: 6,
  singleVideoMode: "cinematic",
  singleVideoLevel: 6,
  rhythmEngine: {
    enabled: true,
    preferredStrategy: "auto",
    confidenceThreshold: 0.5,
    debugMode: true,
    useAdvancedLingering: true,
    useContrastTransition: true,
  },
};

try {
  const result = await runGoal();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.exitCode);
} catch (error) {
  process.stderr.write(`[moyin-goal-${goalLabel}] ${String(error?.stack ?? error)}\n`);
  process.exit(1);
}

async function runGoal() {
  const runtime = await importFreshConversationRuntime(workspaceRoot);
  const artifactStore = runtime.createFileConversationRuntimeExternalArtifactStore({
    rootPath: artifactStoreRoot,
    defaultRetention: "user_controlled",
    defaultSensitivity: "internal",
    defaultCleanupPolicyRef: "artifactPolicy.moyin.goal-script-import.user-controlled",
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
  const projectName =
    process.env.MOYIN_GOAL_PROJECT_NAME ||
    `Director Angel - 疯狂的石头 S级${isGenerateMode ? "生成" : "导入"} ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
  const projectCreate = await invokeMoyin(runtime, registry, {
    operationId: "project.create",
    args: { name: projectName, setActive: true },
    turnSuffix: "project-create",
    events,
  });
  const projectPayload = unwrapPayload(projectCreate.result);
  const projectId = readString(projectPayload?.project?.id) ?? readString(projectPayload?.projectId);
  if (!projectCreate.result.ok || projectId === undefined) {
    return createFailureSummary({
      status: projectCreate.result.status,
      phase: "project.create",
      projectName,
      events,
      result: projectCreate.result,
    });
  }

  const scriptExecutionRequest = {
    projectId,
    panel: "script",
    mediaType: "text",
    feature: "script_analysis",
    workflowTarget: "sclass",
    styleId: "real_movie",
    language: "zh",
    promptLanguage: "zh",
    targetDuration: "60s",
    calibrationStrictness: "normal",
    sclassAdaptationProfile: SCLASS_ADAPTATION_PROFILE,
    sclassSceneShotAiTimeoutMs,
  };
  const scriptExecutionRequestPath = writeScratchJson(
    "script-execution-request.json",
    scriptExecutionRequest,
  );
  const scriptExecution = await invokeMoyin(runtime, registry, {
    operationId: "adapter.script-execution",
    args: { file: scriptExecutionRequestPath },
    turnSuffix: "script-execution",
    events,
  });
  const scriptExecutionPayload = unwrapPayload(scriptExecution.result);
  const executionDraft = readRecord(scriptExecutionPayload?.executionDraft);
  if (!scriptExecution.result.ok || executionDraft === undefined) {
    return createFailureSummary({
      status: scriptExecution.result.status,
      phase: "adapter.script-execution",
      projectId,
      projectName,
      events,
      result: scriptExecution.result,
    });
  }

  const stepId = isGenerateMode ? "script-generate-from-idea" : "script-import-full-workflow";
  const stepCommand = isGenerateMode ? "script.generate" : "script.import";
  const templateId = isGenerateMode ? "script.generate-from-idea" : "script.import-full-workflow";
  const stepValues = isGenerateMode
    ? {
        projectId,
        idea: SCRIPT_IDEA,
        execution: executionDraft,
      }
    : {
        projectId,
        text: SCRIPT_TEXT,
        execution: executionDraft,
      };

  const runPath = writeScratchJson(
    isGenerateMode ? "workflow-run-script-generate.json" : "workflow-run-script-import.json",
    {
      projectId,
      actor: "angel",
      mode: "interactive",
      goal: isGenerateMode
        ? "按 S级流程从创意生成《疯狂的石头》短剧剧本"
        : "按 S级流程导入《疯狂的石头》完整剧本片段",
      inputs: [
        {
          kind: isGenerateMode ? "idea" : "script-text",
          title: isGenerateMode ? "《疯狂的石头》生成创意" : "《疯狂的石头》导入片段",
          source: "director-angel-cli",
        },
      ],
      approvalPolicy: {
        requireBeforeSubmit: true,
      },
      steps: [
        {
          stepId,
          command: stepCommand,
          templateId,
          requiresApproval: false,
          retryable: true,
          maxAttempts: 1,
          payload: {
            values: stepValues,
          },
        },
      ],
      memoryPolicy: {
        readProjectMemory: true,
        writeBack: "manual",
      },
    },
  );
  const runCreate = await invokeMoyin(runtime, registry, {
    operationId: "workflow-run.create",
    args: { projectId, file: runPath },
    turnSuffix: "workflow-run-create",
    events,
  });
  const runPayload = unwrapPayload(runCreate.result);
  const runId = readString(runPayload?.runId) ?? readString(runPayload?.run?.runId);
  if (!runCreate.result.ok || runId === undefined) {
    return createFailureSummary({
      status: runCreate.result.status,
      phase: "workflow-run.create",
      projectId,
      projectName,
      events,
      result: runCreate.result,
    });
  }

  const executePreflight = await runtime.orchestrateMoyinWorkflowRunExecuteAndPackage({
    registry,
    projectId,
    runId,
    stepId,
    turnId: `${turnPrefix}:${projectId}:${runId}:execute`,
    sessionKey,
    watchTimeoutMs,
    heartbeatIntervalMs: 5_000,
    collectPackage: false,
    artifactStore,
    handoffManifestDirectory,
    metadata: {
      goal: goalLabel,
      scriptTitle: "疯狂的石头",
      visualStyleId: "real_movie",
      workflowTarget: "sclass",
      flowMode: goalMode,
    },
    onEvent: (event) => events.push({ source: "orchestrator", event }),
  });

  if (executePreflight.status !== "approval-required") {
    return createFailureSummary({
      status: executePreflight.status,
      phase: "workflow-run.execute.preflight",
      projectId,
      projectName,
      runId,
      events,
      result: executePreflight,
    });
  }

  const executed = await runtime.orchestrateMoyinWorkflowRunExecuteAndPackage({
    registry,
    projectId,
    runId,
    stepId,
    approval: { status: "approved", operatorId: "director-angel-cli" },
    sandboxPreflight: createAllowSandboxPreflight(`execute script ${goalMode} workflow-run`),
    sandboxRuntimePolicy: { enabledBackends: ["workspace-write"] },
    turnId: `${turnPrefix}:${projectId}:${runId}:execute`,
    sessionKey,
    watchTimeoutMs,
    heartbeatIntervalMs: 5_000,
    collectPackage: false,
    artifactStore,
    handoffManifestDirectory,
    metadata: {
      goal: goalLabel,
      scriptTitle: "疯狂的石头",
      visualStyleId: "real_movie",
      workflowTarget: "sclass",
      flowMode: goalMode,
    },
    onEvent: (event) => events.push({ source: "orchestrator", event }),
  });

  const finalSteps = await invokeMoyin(runtime, registry, {
    operationId: "workflow-run.steps",
    args: { projectId, runId },
    turnSuffix: "workflow-run-steps-final",
    events,
  });
  const projectDetail = await invokeMoyin(runtime, registry, {
    operationId: "project.get",
    args: { projectId },
    turnSuffix: "project-get-final",
    events,
  });

  return {
    schemaVersion,
    status: executed.ok ? executed.status : "failed",
    exitCode: executed.ok ? 0 : 1,
    workspaceRoot,
    binary: moyinBinary,
    scratchRoot,
    projectName,
    projectId,
    runId,
    stepId,
    requestedFlow: {
      projectCreated: Boolean(projectId),
      scriptPanelImport: !isGenerateMode,
      scriptPanelGenerate: isGenerateMode,
      inputKind: isGenerateMode ? "idea" : "script-text",
      visualStyle: { id: "real_movie", label: "真人电影" },
      workflowTarget: "sclass",
      sclassImport: {
        enabled: true,
        target: "standard",
        mode: "novel",
        level: 7,
        sceneShotAiTimeoutMs: sclassSceneShotAiTimeoutMs,
        rhythm: "auto",
        confidenceThreshold: 0.5,
        debugMode: true,
        advancedLingering: true,
        contrastTransition: true,
      },
    },
    approvals: events
      .filter((item) => item.approvalRequired)
      .map((item) => ({
        operationId: item.operationId,
        approvalId: item.approvalId,
      })),
    execution: summarizeExecution(executed),
    finalSteps: summarizeProviderPayload(finalSteps.result),
    projectDetail: summarizeProviderPayload(projectDetail.result),
    events: summarizeEvents(events),
    error: executed.error,
    nextActions: executed.ok
      ? ["Open Moyin and inspect the new project script/S级 panels; do not advance to image or video generation yet."]
      : [`Inspect the workflow-run task error before retrying the ${goalMode}.`],
  };
}

async function invokeMoyin(runtime, registry, input) {
  const baseRequest = {
    toolId: "moyin.provider",
    operationId: input.operationId,
    args: input.args,
    turnId: `${turnPrefix}:${input.turnSuffix}`,
    sessionKey,
    metadata: {
      goal: goalLabel,
      turnSuffix: input.turnSuffix,
      flowMode: goalMode,
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
    items: events.slice(-80).map((item) => {
      if (item.source !== "orchestrator") {
        return item;
      }
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
    exitCode: 1,
    workspaceRoot,
    binary: moyinBinary,
    scratchRoot,
    phase: input.phase,
    projectName: input.projectName,
    projectId: input.projectId,
    runId: input.runId,
    result: input.result,
    events: summarizeEvents(input.events),
  };
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

function readGoalMode(args, envValue) {
  const fromArg = args.includes("--generate")
    ? "generate"
    : args.includes("--import")
      ? "import"
      : undefined;
  const value = String(fromArg ?? envValue ?? "import").trim().toLowerCase();
  if (value === "generate" || value === "script-generate") {
    return "generate";
  }
  return "import";
}
