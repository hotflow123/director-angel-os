import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const suiteId = "director-phase-f-agent-os-subagents-gate";
const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const forbiddenVoiceSideEffectPatterns = [
  /navigator\.mediaDevices\.getUserMedia\s*\(/iu,
  /new\s+MediaRecorder\s*\(/iu,
  /new\s+AudioContext\s*\(/iu,
  /\bspeechSynthesis\.speak\s*\(/iu,
  /\b(?:SpeechRecognition|webkitSpeechRecognition)\b/iu,
  /\bmicrophoneAccessed:\s*true\b/iu,
  /\bwhisperStarted:\s*true\b/iu,
  /\bliveRunnerStarted:\s*true\b/iu,
  /\bspeechTranscribed:\s*true\b/iu,
  /\bspeechSynthesized:\s*true\b/iu,
  /\baudioBytesRead:\s*true\b/iu,
  /\brawAudioPersisted:\s*true\b/iu,
];
const nonVoiceTouchedFiles = [
  "packages/agent-os-kernel-contracts/src/types.ts",
  "packages/agent-os-kernel-contracts/src/subagent.ts",
  "packages/agent-os-kernel-contracts/tests/kernel-contracts.test.ts",
  "packages/tasks-core/src/subagent-runtime.ts",
  "packages/tasks-core/src/subagent-runtime.test.ts",
  "packages/tasks-core/src/index.ts",
  "apps/worker-jobs/src/run-delegation.ts",
  "apps/worker-jobs/tests/delegation-flow.test.ts",
  "apps/cli/src/control-plane.ts",
  "apps/cli/src/control-plane-adapter.ts",
  "apps/cli/src/control-plane-adapter.test.ts",
  "apps/cli/src/shell.ts",
  "apps/cli/src/shell.test.ts",
  "packages/director-host-contracts/src/types.ts",
  "packages/director-host-contracts/tests/guards.test.ts",
  "apps/director-host-api/src/beta1.ts",
  "apps/director-host-api/src/server.ts",
  "apps/director-host-api/tests/server.test.ts",
  "packages/conversation-runtime/src/agent-delegate-tool.ts",
  "packages/conversation-runtime/src/director-tools.ts",
  "packages/conversation-runtime/src/default-tool-policy.ts",
  "packages/conversation-runtime/tests/tool-registry.test.ts",
  "packages/conversation-runtime/tests/model-tool-loop.test.ts",
  "apps/director-desktop/src/desktop-system-handlers.js",
  "apps/director-desktop/src/app.js",
  "apps/weixin-gateway/src/adapter.ts",
];
const noNewRunnerScanFiles = [
  "packages/agent-os-kernel-contracts/src/subagent.ts",
  "packages/tasks-core/src/subagent-runtime.ts",
  "apps/worker-jobs/src/run-delegation.ts",
  "apps/cli/src/control-plane.ts",
  "packages/conversation-runtime/src/agent-delegate-tool.ts",
];

function preview(output, lines = 40) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runPnpm(repoRoot, label, args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    label,
    command: `pnpm ${args.join(" ")}`,
    status: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

function runCase(label, fn) {
  const started = process.hrtime.bigint();
  try {
    fn();
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      label,
      command: "node assertion",
      status: 0,
      durationMs: Number(durationMs.toFixed(2)),
      stdoutPreview: "",
      stderrPreview: "",
    };
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    return {
      label,
      command: "node assertion",
      status: 1,
      durationMs: Number(durationMs.toFixed(2)),
      stdoutPreview: "",
      stderrPreview: error instanceof Error ? error.message : String(error),
    };
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertSourceContains(repoRoot, relPath, snippets) {
  const source = readFileSync(resolve(repoRoot, relPath), "utf8");
  for (const snippet of snippets) {
    assert(source.includes(snippet), `${relPath} missing ${snippet}`);
  }
}

function assertVoiceWorkStaysFailClosed(repoRoot) {
  const issues = [];
  for (const relPath of nonVoiceTouchedFiles) {
    const source = readFileSync(resolve(repoRoot, relPath), "utf8");
    for (const pattern of forbiddenVoiceSideEffectPatterns) {
      if (pattern.test(source)) {
        issues.push(`${relPath} contains live voice side effect ${pattern}`);
      }
    }
  }

  assert(issues.length === 0, issues.join("\n"));
}

function assertNoNewRunnerInSubagentSlice(repoRoot) {
  const issues = [];
  for (const relPath of noNewRunnerScanFiles) {
    const source = readFileSync(resolve(repoRoot, relPath), "utf8");
    if (source.includes("child_process") || source.includes("spawn(") || source.includes("exec(")) {
      issues.push(`${relPath} should not introduce an OS/process runner in Phase F`);
    }
  }

  assert(issues.length === 0, issues.join("\n"));
}

function assertHostApiSubagentProjectionNoRunner(repoRoot) {
  const relPath = "apps/director-host-api/src/server.ts";
  const source = readFileSync(resolve(repoRoot, relPath), "utf8");
  const start = source.indexOf("async function createHostApiAgentOsSubagentRuns");
  const end = source.indexOf("function createHostApiProcessCapabilityLedger");
  assert(start >= 0 && end > start, `${relPath} missing Host API subagent projection section`);
  const section = source.slice(start, end);
  if (
    section.includes("child_process") ||
    section.includes("spawn(") ||
    section.includes("exec(")
  ) {
    throw new Error(`${relPath} Host API subagent projection must stay read-only`);
  }
}

function assertAgentDelegateToolNoRunner(repoRoot) {
  const relPath = "packages/conversation-runtime/src/agent-delegate-tool.ts";
  const source = readFileSync(resolve(repoRoot, relPath), "utf8");
  if (source.includes("child_process") || source.includes("spawn(") || source.includes("exec(")) {
    throw new Error(`${relPath} must stay task-plane backed and must not start a runner`);
  }
}

function assertDesktopAgentDelegateSectionNoRunner(repoRoot) {
  const relPath = "apps/director-desktop/src/desktop-system-handlers.js";
  const source = readFileSync(resolve(repoRoot, relPath), "utf8");
  const start = source.indexOf("async function executeDesktopAgentDelegateTool");
  const end = source.indexOf("function readToolString", start);
  assert(start >= 0 && end > start, `${relPath} missing desktop agent delegate section`);
  const section = source.slice(start, end);
  if (
    section.includes("child_process") ||
    section.includes("spawn(") ||
    section.includes("exec(")
  ) {
    throw new Error(`${relPath} desktop agent delegate section must not start a runner`);
  }
}

function assertSchedulerRecoveryPlanStaysReadOnly(repoRoot) {
  const relPath = "packages/tasks-core/src/subagent-runtime.ts";
  const source = readFileSync(resolve(repoRoot, relPath), "utf8");
  const start = source.indexOf("export function projectSubagentSchedulerRecoveryPlanFromTaskState");
  const end = source.indexOf(
    "export function projectSubagentSchedulerDispatchPlanFromSubagentRuns",
    start,
  );
  assert(
    start >= 0 && end > start,
    `${relPath} missing scheduler recovery plan projection section`,
  );
  const section = source.slice(start, end);
  const forbiddenSnippets = [
    "child_process",
    "spawn(",
    "exec(",
    "claimDelegation",
    "claimDryRun",
    "dispatchIntents",
    '"--delegation-id"',
    "argv",
  ];
  const hits = forbiddenSnippets.filter((snippet) => section.includes(snippet));
  assert(
    hits.length === 0,
    `${relPath} scheduler recovery plan must stay read-only; found ${hits.join(", ")}`,
  );
}

function assertWeixinAgentDelegateSectionNoRunner(repoRoot) {
  const relPath = "apps/weixin-gateway/src/adapter.ts";
  const source = readFileSync(resolve(repoRoot, relPath), "utf8");
  const start = source.indexOf('if (input.call.name === "agent.delegate"');
  const end = source.indexOf("const hostSharedToolResult", start);
  assert(start >= 0 && end > start, `${relPath} missing Weixin agent.delegate fail-closed section`);
  const section = source.slice(start, end);
  if (
    section.includes("child_process") ||
    section.includes("spawn(") ||
    section.includes("exec(")
  ) {
    throw new Error(`${relPath} Weixin agent.delegate section must not start a runner`);
  }
}

function assertAppleDoubleIgnored(repoRoot) {
  const issues = [];
  for (const relPath of walk(resolve(repoRoot, "packages/agent-os-kernel-contracts/src"))) {
    if (
      relative(repoRoot, relPath)
        .split("/")
        .some((part) => part.startsWith("._"))
    ) {
      issues.push(
        `active source scan should ignore AppleDouble file ${relative(repoRoot, relPath)}`,
      );
    }
  }
  assert(issues.length === 0, issues.join("\n"));
}

function walk(root) {
  const paths = [];
  for (const entry of readdirSync(root)) {
    if (
      entry.startsWith("._") ||
      entry === "dist" ||
      entry === "node_modules" ||
      entry === ".turbo"
    ) {
      continue;
    }
    const fullPath = join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      paths.push(...walk(fullPath));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

const { repoRoot, resultsDir } = getBenchmarksPaths();
const runs = [
  runPnpm(repoRoot, "agent os kernel subagent contract tests", [
    "--filter",
    "@hotflow/agent-os-kernel-contracts",
    "test",
    "--",
    "tests/kernel-contracts.test.ts",
  ]),
  runPnpm(repoRoot, "tasks-core subagent runtime projection tests", [
    "--filter",
    "@hotflow/tasks-core",
    "test",
    "--",
    "src/subagent-runtime.test.ts",
  ]),
  runPnpm(repoRoot, "tasks-core subagent scheduler claim guard tests", [
    "--filter",
    "@hotflow/tasks-core",
    "test",
    "--",
    "src/task-plane-port.test.ts",
    "src/session-task-plane-port.test.ts",
    "-t",
    "scheduler|claims queued",
  ]),
  runPnpm(repoRoot, "worker-jobs delegation exposes subagent run", [
    "--filter",
    "@hotflow/worker-jobs",
    "test",
    "--",
    "tests/delegation-flow.test.ts",
  ]),
  runPnpm(repoRoot, "cli task status exposes subagent runs through control-plane", [
    "--filter",
    "@hotflow/cli",
    "exec",
    "vitest",
    "run",
    "src/control-plane-adapter.test.ts",
    "-t",
    "persists delegation and verification",
  ]),
  runPnpm(repoRoot, "cli task status renders subagent runs", [
    "--filter",
    "@hotflow/cli",
    "exec",
    "vitest",
    "run",
    "src/shell.test.ts",
    "-t",
    "dispatches task status through control-plane",
  ]),
  runPnpm(repoRoot, "host contracts runtime snapshot validates subagent projection", [
    "--filter",
    "@hotflow/director-host-contracts",
    "test",
    "--",
    "tests/guards.test.ts",
    "-t",
    "validates runtime",
  ]),
  runPnpm(repoRoot, "host api runtime snapshot exposes task-backed subagent runs", [
    "--filter",
    "@hotflow/director-host-api",
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "tests/server.test.ts",
    "-t",
    "surfaces task-backed Agent OS subagent runs",
  ]),
  runPnpm(repoRoot, "cli runtime snapshot renders host subagent runs", [
    "--filter",
    "@hotflow/cli",
    "exec",
    "vitest",
    "run",
    "src/shell.test.ts",
    "-t",
    "prints Agent OS subagent run summary",
  ]),
  runPnpm(repoRoot, "conversation runtime AgentTool registry exposes agent.delegate", [
    "--filter",
    "@hotflow/conversation-runtime",
    "exec",
    "vitest",
    "run",
    "tests/tool-registry.test.ts",
    "-t",
    "Claude Code style",
  ]),
  runPnpm(repoRoot, "conversation runtime AgentTool delegates to task plane", [
    "--filter",
    "@hotflow/conversation-runtime",
    "exec",
    "vitest",
    "run",
    "tests/model-tool-loop.test.ts",
    "-t",
    "AgentTool",
  ]),
  runPnpm(repoRoot, "conversation runtime AgentTool blocks cross-profile worker routing", [
    "--filter",
    "@hotflow/conversation-runtime",
    "exec",
    "vitest",
    "run",
    "tests/model-tool-loop.test.ts",
    "-t",
    "targets a worker outside",
  ]),
  runPnpm(repoRoot, "conversation runtime AgentTool blocks overlapping write sets", [
    "--filter",
    "@hotflow/conversation-runtime",
    "exec",
    "vitest",
    "run",
    "tests/model-tool-loop.test.ts",
    "-t",
    "write set overlaps",
  ]),
  runPnpm(repoRoot, "conversation runtime AgentTool blocks inferred writable roots overlap", [
    "--filter",
    "@hotflow/conversation-runtime",
    "exec",
    "vitest",
    "run",
    "tests/model-tool-loop.test.ts",
    "-t",
    "inferred writable roots",
  ]),
  runPnpm(repoRoot, "conversation runtime AgentTool projects scheduler batches", [
    "--filter",
    "@hotflow/conversation-runtime",
    "exec",
    "vitest",
    "run",
    "tests/model-tool-loop.test.ts",
    "-t",
    "scheduling batches",
  ]),
  runPnpm(repoRoot, "desktop Run/Review exposes task-backed Agent OS subagent runs", [
    "--filter",
    "@hotflow/director-desktop",
    "exec",
    "vitest",
    "run",
    "src/desktop-system-handlers.test.js",
    "-t",
    "run delegation|trace proposal and execution run",
  ]),
  runPnpm(repoRoot, "desktop Run/Review exposes scheduler batches", [
    "--filter",
    "@hotflow/director-desktop",
    "exec",
    "vitest",
    "run",
    "src/desktop-system-handlers.test.js",
    "-t",
    "subagent scheduler",
  ]),
  runPnpm(repoRoot, "agent os kernel typecheck", [
    "--filter",
    "@hotflow/agent-os-kernel-contracts",
    "typecheck",
  ]),
  runPnpm(repoRoot, "tasks-core typecheck", ["--filter", "@hotflow/tasks-core", "typecheck"]),
  runPnpm(repoRoot, "worker-jobs typecheck", ["--filter", "@hotflow/worker-jobs", "typecheck"]),
  runPnpm(repoRoot, "director host contracts typecheck", [
    "--filter",
    "@hotflow/director-host-contracts",
    "typecheck",
  ]),
  runPnpm(repoRoot, "director host api typecheck", [
    "--filter",
    "@hotflow/director-host-api",
    "typecheck",
  ]),
  runPnpm(repoRoot, "cli typecheck", ["--filter", "@hotflow/cli", "typecheck"]),
  runPnpm(repoRoot, "conversation-runtime typecheck", [
    "--filter",
    "@hotflow/conversation-runtime",
    "typecheck",
  ]),
  runPnpm(repoRoot, "desktop lint", ["--filter", "@hotflow/director-desktop", "lint"]),
  runPnpm(repoRoot, "weixin gateway typecheck", [
    "--filter",
    "@hotflow/weixin-gateway",
    "typecheck",
  ]),
  runPnpm(repoRoot, "agent os kernel build", [
    "--filter",
    "@hotflow/agent-os-kernel-contracts",
    "build",
  ]),
  runPnpm(repoRoot, "tasks-core build", ["--filter", "@hotflow/tasks-core", "build"]),
  runPnpm(repoRoot, "worker-jobs build", ["--filter", "@hotflow/worker-jobs", "build"]),
  runPnpm(repoRoot, "director host contracts build", [
    "--filter",
    "@hotflow/director-host-contracts",
    "build",
  ]),
  runPnpm(repoRoot, "director host api build", ["--filter", "@hotflow/director-host-api", "build"]),
  runPnpm(repoRoot, "cli build", ["--filter", "@hotflow/cli", "build"]),
  runPnpm(repoRoot, "conversation-runtime build", [
    "--filter",
    "@hotflow/conversation-runtime",
    "build",
  ]),
  runPnpm(repoRoot, "agent os kernel lint", [
    "--filter",
    "@hotflow/agent-os-kernel-contracts",
    "lint",
  ]),
  runPnpm(repoRoot, "tasks-core lint", ["--filter", "@hotflow/tasks-core", "lint"]),
  runPnpm(repoRoot, "worker-jobs lint", ["--filter", "@hotflow/worker-jobs", "lint"]),
  runPnpm(repoRoot, "director host contracts lint", [
    "--filter",
    "@hotflow/director-host-contracts",
    "lint",
  ]),
  runPnpm(repoRoot, "director host api lint", ["--filter", "@hotflow/director-host-api", "lint"]),
  runPnpm(repoRoot, "cli lint", ["--filter", "@hotflow/cli", "lint"]),
  runPnpm(repoRoot, "conversation-runtime lint", [
    "--filter",
    "@hotflow/conversation-runtime",
    "lint",
  ]),
  runPnpm(repoRoot, "weixin gateway lint", ["--filter", "@hotflow/weixin-gateway", "lint"]),
  runCase("contract exports AgentTool and SubagentProfile primitives", () =>
    assertSourceContains(repoRoot, "packages/agent-os-kernel-contracts/src/subagent.ts", [
      "createAgentToolDelegationEnvelope",
      "createParentVisibleSubagentResult",
      "Subagent scope escalation blocked",
    ]),
  ),
  runCase("tasks-core projects delegation as subagent runtime actor", () =>
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "projectSubagentRunsFromTaskState",
      "parentVisibleResult",
      "isolatedContext",
      "createSubagentSchedulingByDelegationId",
      "write-set-overlap",
      "resolveSchedulingWriteSet",
      "writableRoots",
      "writeSetSource",
      "parallelBatch",
      "readyToStart",
      "blockedBy",
    ]),
  ),
  runCase("worker-jobs exposes parent-visible task-backed subagent runs", () =>
    assertSourceContains(repoRoot, "apps/worker-jobs/src/run-delegation.ts", [
      "projectSubagentRunsFromTaskState",
      "subagentRun",
      "TaskBackedSubagentRun",
    ]),
  ),
  runCase("cli operator task status exposes task-backed subagent runs", () =>
    assertSourceContains(repoRoot, "apps/cli/src/control-plane.ts", [
      "projectSubagentRunsFromTaskState",
      "CliTaskOperationsState",
      "subagentRuns",
    ]),
  ),
  runCase("cli task renderer shows subagent run summary", () =>
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "Subagent runs:",
      "Subagent summary:",
      "formatSubagentRunSummary",
    ]),
  ),
  runCase("host api runtime snapshot contract declares subagent runs", () =>
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "agentOsSubagentRuns",
      "DirectorHostAgentOsSubagentRunProjection",
      "DirectorHostAgentOsSubagentScheduling",
      "isDirectorHostAgentOsSubagentRunProjection",
      "isDirectorHostAgentOsSubagentScheduling",
    ]),
  ),
  runCase("host api projects task-backed subagent runs without new runner", () =>
    assertSourceContains(repoRoot, "apps/director-host-api/src/server.ts", [
      "createHostApiAgentOsSubagentRuns",
      "projectSubagentRunsFromTaskState",
      "discoverDirectorWorkerTaskPlaneSessionIds",
      "scheduling",
    ]),
  ),
  runCase("cli runtime renderer shows host subagent projection", () =>
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "Agent OS subagent runs:",
      "formatAgentOsSubagentRunEntry",
      "agentOsSubagentRuns",
      "parallelBatch",
      "blockedBy",
    ]),
  ),
  runCase("conversation runtime exposes model-visible AgentTool delegation surface", () =>
    assertSourceContains(repoRoot, "packages/conversation-runtime/src/agent-delegate-tool.ts", [
      "AGENT_DELEGATE_TOOL_NAME",
      "createAgentDelegateModelTool",
      "createAgentDelegateTaskBackedToolExecutor",
      "createAgentToolDelegationEnvelope",
      "enqueueDelegation",
      "agent-delegate-worker-route-blocked",
      "agent-delegate-write-set-conflict",
      "detectAgentDelegateWriteSetConflict",
      "resolveAgentDelegateSchedulingWriteSet",
      "writableRoots",
      "writeSetSource",
      "parallelBatch",
      "readyToStart",
      "blockedBy",
      "cannot target worker",
    ]),
  ),
  runCase("director tools mount agent.delegate with approval gate", () =>
    assertSourceContains(repoRoot, "packages/conversation-runtime/src/director-tools.ts", [
      "createAgentDelegateModelTool",
      "agent.delegate",
    ]),
  ),
  runCase("conversation runtime default policy approval-gates agent.delegate", () =>
    assertSourceContains(repoRoot, "packages/conversation-runtime/src/default-tool-policy.ts", [
      '"agent.delegate"',
      "子代理委托",
    ]),
  ),
  runCase("desktop connects agent.delegate to run task-plane without runner", () =>
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.js", [
      "executeDesktopAgentDelegateTool",
      "createAgentDelegateTaskBackedToolExecutor",
      "withDesktopRunTaskPlane",
      "activeRunId",
    ]),
  ),
  runCase("desktop Run/Review projects task-backed Agent OS subagent runs", () =>
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.js", [
      "projectSubagentRunsFromTaskState",
      "formatDesktopRunSubagentRun",
      "subagentRuns",
      "scheduling",
      "readyToStart",
      "Agent OS 子代理",
    ]),
  ),
  runCase("Phase F.7 infers subagent write sets from bounded writable roots", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "resolveSchedulingWriteSet",
      'extractContextField(snapshot, "writableRoots")',
      'writeSetSource: "inferred"',
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "projects inferred write sets from writable roots",
      'writeSetSource: "inferred"',
    ]);
    assertSourceContains(repoRoot, "packages/conversation-runtime/src/agent-delegate-tool.ts", [
      "resolveAgentDelegateSchedulingWriteSet",
      "writableRoots: input.envelope.writableRoots",
      'writeSetSource: "inferred"',
    ]);
    assertSourceContains(repoRoot, "packages/conversation-runtime/tests/model-tool-loop.test.ts", [
      "inferred writable roots",
      "write-set-overlap",
      "/workspace/project/src/App.tsx",
    ]);
  }),
  runCase("Phase F.8 gates worker claims on scheduler readiness", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/mailbox.ts", [
      "respectScheduler",
      "projectSubagentRunsFromTaskState",
      "is blocked by subagent scheduler",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/run-delegation.ts", [
      "schedulerReadyMailbox",
      "skippedSchedulerBlockedDelegationIds",
      "claimDelegation",
      "respectScheduler: true",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/tests/delegation-flow.test.ts", [
      "run-delegation skips scheduler-blocked queued children",
      "d_ready",
      "d_blocked",
    ]);
  }),
  runCase("Phase F.9 runs a bounded scheduler loop over ready children", () => {
    assertSourceContains(repoRoot, "apps/worker-jobs/src/run-delegation.ts", [
      "maxClaims",
      "claimedDelegationIds",
      "finalDelegationStatuses",
      "schedulerLoop",
      "stoppedReason",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/main.ts", ["--max-claims", "maxClaims"]);
    assertSourceContains(repoRoot, "apps/worker-jobs/tests/delegation-flow.test.ts", [
      "bounded scheduler loop consumes multiple ready children",
      "d_ready_beta",
      "d_ready_gamma",
      "claimedDelegationIds",
    ]);
  }),
  runCase("Phase F.10 exposes observed write-set evidence from child output", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "observedWriteSet",
      "observedWriteSetSource",
      "parentVisibleResult",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/main.ts", [
      "--observed-write-set",
      "--observed-write-set-source",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/tests/delegation-flow.test.ts", [
      "records observed write-set evidence",
      "observedWriteSet",
      "src/beta.ts",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "observedWriteSet=",
      "observedWriteSetSource=",
    ]);
  }),
  runCase("Phase F.11 extracts observed write-set evidence from patch artifacts", () => {
    assertSourceContains(repoRoot, "apps/worker-jobs/src/run-delegation.ts", [
      "observedWriteSetArtifact",
      "MAX_OBSERVED_WRITE_SET_ARTIFACT_BYTES",
      "extractObservedWriteSetFromArtifact",
      "getObservedWriteSetArtifactReadableRoots",
      "isPathInsideAnyRoot",
      "diff --git",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/main.ts", [
      "--observed-write-set-artifact",
      "observedWriteSetArtifact",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/tests/delegation-flow.test.ts", [
      "extracts observed write-set evidence from patch artifact",
      "rejects observed write-set artifacts outside worker roots",
      "--observed-write-set-artifact",
      "docs/plan.md",
    ]);
  }),
  runCase("Phase F.12 surfaces observed write-set drift diagnostics", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "undeclaredObservedWriteSet",
      "observedConflictWith",
      "observed-write-set-overlap",
      "createObservedWriteSetDiagnosticsByDelegationId",
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "surfaces observed write-set drift against declared scheduling write sets",
      "undeclaredObservedWriteSet",
      "observedConflictWith",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "undeclaredObservedWriteSet",
      "observedConflictWith",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "undeclaredObservedWriteSet=",
      "observedConflictWith=",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "声明外写入",
      "实际写集冲突",
    ]);
  }),
  runCase("Phase F.13 projects continuous scheduler heartbeat without new runner", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "projectSubagentSchedulerHeartbeatFromTaskState",
      "projectSubagentSchedulerHeartbeatFromSubagentRuns",
      "hotflow.agent-os.subagent-scheduler-heartbeat.v1",
      "nextReadySubagentIds",
      "unscheduledQueuedCount",
      "stoppedReason",
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "projects a continuous scheduler heartbeat from task-backed subagent runs",
      "delegate_ready_beta",
      "delegate_blocked_alpha",
      "scheduler-blocked",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/run-delegation.ts", [
      "schedulerHeartbeat",
      "projectSubagentSchedulerHeartbeatFromTaskState",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "DirectorHostAgentOsSubagentSchedulerHeartbeat",
      "schedulerHeartbeat",
      "nextReadySubagentIds",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "formatAgentOsSubagentSchedulerHeartbeat",
      "Subagent scheduler:",
      "blockedByScheduler=",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "formatReviewSubagentSchedulerHeartbeat",
      "调度心跳",
      "blockedByScheduler=",
    ]);
  }),
  runCase("Phase F.14 projects read-only scheduler dispatch plan without new runner", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "projectSubagentSchedulerDispatchPlanFromTaskState",
      "projectSubagentSchedulerDispatchPlanFromSubagentRuns",
      "hotflow.agent-os.subagent-scheduler-dispatch-plan.v1",
      "dispatchableSubagentIds",
      "dispatchBatches",
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "projects a read-only scheduler dispatch plan from ready queued subagent runs",
      "delegate_ready_beta",
      "delegate_ready_unscheduled",
      "dispatchBatches",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/run-delegation.ts", [
      "schedulerDispatchPlan",
      "projectSubagentSchedulerDispatchPlanFromTaskState",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "DirectorHostAgentOsSubagentSchedulerDispatchPlan",
      "schedulerDispatchPlan",
      "dispatchBatches",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "formatAgentOsSubagentSchedulerDispatchPlan",
      "Subagent dispatch plan:",
      "dispatchable=",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "formatReviewSubagentSchedulerDispatchPlan",
      "调度计划",
      "dispatchable=",
    ]);
  }),
  runCase("Phase F.15 projects read-only scheduler tick intents without claiming", () => {
    assertSourceContains(repoRoot, "apps/worker-jobs/src/scheduler-tick.ts", [
      "projectSubagentSchedulerTickFromTaskState",
      "TaskBackedSubagentSchedulerTick",
      'status: "ok"',
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "hotflow.agent-os.subagent-scheduler-tick.v1",
      "dispatchIntents",
      '"--delegation-id"',
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/main.ts", [
      "scheduler-tick",
      "parseSchedulerTickCommand",
      "runSchedulerTickJob",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/tests/delegation-flow.test.ts", [
      "scheduler-tick projects dispatch intents without claiming queued children",
      "dispatch_d_ready_beta",
      "claimDryRun",
      "queued",
    ]);
  }),
  runCase("Phase F.16 surfaces scheduler tick intents in CLI task status", () => {
    assertSourceContains(repoRoot, "apps/cli/src/control-plane.ts", [
      "subagentSchedulerTick",
      "TaskBackedSubagentSchedulerTick",
      "projectSubagentSchedulerTickFromTaskState",
      "schedulerTick.dispatchPlan",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "coerceTaskBackedSubagentSchedulerTick",
      "formatSubagentSchedulerTick",
      "Subagent scheduler tick:",
      "claimDryRun=",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.test.ts", [
      "subagentSchedulerTick",
      "Subagent scheduler tick: intents=0 claimDryRun=true",
    ]);
  }),
  runCase("Phase F.17 centralizes scheduler tick projection in tasks-core", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "TaskBackedSubagentSchedulerTick",
      "TaskBackedSubagentSchedulerTickIntent",
      "projectSubagentSchedulerTickFromTaskState",
      "projectSubagentSchedulerTickFromSubagentRuns",
      "createSubagentSchedulerTickDispatchIntents",
      "claimDryRun: true",
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "projects read-only scheduler tick intents from the shared task-backed runtime",
      "dispatch_delegate_ready_beta",
      'writeSetSource: "inferred"',
      "expect(board.snapshotOperations()).toEqual(before)",
    ]);
    assertSourceContains(repoRoot, "apps/worker-jobs/src/scheduler-tick.ts", [
      "projectSubagentSchedulerTickFromTaskState",
      "TaskBackedSubagentSchedulerTickIntent",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/control-plane.ts", [
      "CliSubagentSchedulerTick = TaskBackedSubagentSchedulerTick",
      "projectSubagentSchedulerTickFromTaskState",
    ]);
  }),
  runCase("Phase F.18 surfaces scheduler tick in Host API runtime snapshots", () => {
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "DirectorHostAgentOsSubagentSchedulerTick",
      "DirectorHostAgentOsSubagentSchedulerTickIntent",
      "schedulerTick?: DirectorHostAgentOsSubagentSchedulerTick",
      "isDirectorHostAgentOsSubagentSchedulerTick",
      "hotflow.agent-os.subagent-scheduler-tick.v1",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/tests/guards.test.ts", [
      "schedulerTick",
      "dispatch_delegation-run-1-shot-planner",
      "claimDryRun: true",
    ]);
    assertSourceContains(repoRoot, "apps/director-host-api/src/server.ts", [
      "projectSubagentSchedulerTickFromTaskState",
      "mergeHostApiAgentOsSubagentSchedulerTicks",
      "schedulerTick:",
      "claimDryRun: true",
    ]);
    assertSourceContains(repoRoot, "apps/director-host-api/tests/server.test.ts", [
      "schedulerTick",
      "dispatchIntent.delegationId",
      "scheduling.readyToStart",
      "claimDryRun: true",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "DirectorHostAgentOsSubagentSchedulerTick",
      "formatAgentOsSubagentSchedulerTick",
      "readAgentOsSubagentSchedulerTick",
      "latestTurn=",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.test.ts", [
      "schedulerTick",
      "tick=session=run-1 latestTurn=turn-1 intents=1 claimDryRun=true",
    ]);
  }),
  runCase("Phase F.19 surfaces scheduler tick in Desktop Run/Review", () => {
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.js", [
      "projectSubagentSchedulerTickFromTaskState",
      "subagentSchedulerTick",
      "调度意图",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.test.js", [
      "projects desktop Run/Review subagent scheduler tick intents",
      "dispatch_delegate_scheduler_gamma_ready",
      "claimDryRun: true",
      "调度意图 1 个",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "formatReviewSubagentSchedulerTick",
      "formatReviewSubagentSchedulerTickIntents",
      "调度意图",
      "claimDryRun=",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app-structure.test.js", [
      "formatReviewSubagentSchedulerTick",
      "formatReviewSubagentSchedulerTickIntents",
      "claimDryRun=",
    ]);
  }),
  runCase("Phase F.20 surfaces read-only scheduler recovery plan", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "projectSubagentSchedulerRecoveryPlanFromTaskState",
      "projectSubagentSchedulerRecoveryPlanFromSubagentRuns",
      "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
      "wait-for-running-subagent",
      "review-observed-write-set",
      "operatorSummary",
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "projects read-only scheduler conflict recovery recommendations",
      "recover_delegate_alpha_followup_write_set_overlap",
      "recover_delegate_beta_done_observed_write_set_overlap",
      "expect(board.snapshotOperations()).toEqual(before)",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "DirectorHostAgentOsSubagentSchedulerRecoveryPlan",
      "schedulerRecoveryPlan?: DirectorHostAgentOsSubagentSchedulerRecoveryPlan",
      "isDirectorHostAgentOsSubagentSchedulerRecoveryPlan",
      "hotflow.agent-os.subagent-scheduler-recovery-plan.v1",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/tests/guards.test.ts", [
      "schedulerRecoveryPlan",
      "review-observed-write-set",
      "recover_delegation-run-1-researcher_observed_write_set_overlap",
    ]);
    assertSourceContains(repoRoot, "apps/director-host-api/src/server.ts", [
      "projectSubagentSchedulerRecoveryPlanFromSubagentRuns",
      "schedulerRecoveryPlan:",
    ]);
    assertSourceContains(repoRoot, "apps/director-host-api/tests/server.test.ts", [
      "schedulerRecoveryPlan",
      "recover_delegation-run-subagent-snapshot-1-polish_write_set_overlap",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/control-plane.ts", [
      "subagentSchedulerRecoveryPlan",
      "projectSubagentSchedulerRecoveryPlanFromTaskState",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "Subagent recovery plan:",
      "formatAgentOsSubagentSchedulerRecoveryPlan",
      "readAgentOsSubagentSchedulerRecoveryPlan",
      "recovery=",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.test.ts", [
      "subagentSchedulerRecoveryPlan",
      "Subagent recovery plan: canRecover=true actions=1",
      "recovery=canRecover=true actions=1",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.js", [
      "projectSubagentSchedulerRecoveryPlanFromTaskState",
      "subagentSchedulerRecoveryPlan",
      "恢复建议",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "formatReviewSubagentSchedulerRecoveryPlan",
      "formatReviewSubagentSchedulerRecoveryActions",
      "恢复建议",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.test.js", [
      "subagentSchedulerRecoveryPlan",
      "恢复建议 2 个",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app-structure.test.js", [
      "formatReviewSubagentSchedulerRecoveryPlan",
      "formatReviewSubagentSchedulerRecoveryActions",
      "canRecover=",
    ]);
    assertSourceContains(
      repoRoot,
      "docs/plans/_active-execution/director-angel-agent-os-hardcore-upgrade-plan.md",
      [
        "Phase F.20 read-only scheduler conflict recovery/operator plan",
        "subagentSchedulerRecoveryPlan",
      ],
    );
    assertSchedulerRecoveryPlanStaysReadOnly(repoRoot);
  }),
  runCase("Phase F.21 surfaces read-only scheduler recovery drilldown groups", () => {
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.ts", [
      "TaskBackedSubagentSchedulerRecoveryGroup",
      "recoveryGroups",
      "createSubagentSchedulerRecoveryGroups",
      "resolveRecoveryGroupWriteSet",
      "Review observed-write-set-overlap recovery group",
    ]);
    assertSourceContains(repoRoot, "packages/tasks-core/src/subagent-runtime.test.ts", [
      "recovery_group_write_set_overlap_src_alpha_ts",
      "recovery_group_observed_write_set_overlap_src_gamma_ts",
      "runningSubagentIds",
      "completedSubagentIds",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/src/types.ts", [
      "DirectorHostAgentOsSubagentSchedulerRecoveryGroup",
      "recoveryGroups: readonly DirectorHostAgentOsSubagentSchedulerRecoveryGroup[]",
      "isDirectorHostAgentOsSubagentSchedulerRecoveryGroup",
    ]);
    assertSourceContains(repoRoot, "packages/director-host-contracts/tests/guards.test.ts", [
      "recoveryGroups",
      "recovery_group_observed_write_set_overlap_shots_plan_md",
    ]);
    assertSourceContains(repoRoot, "apps/director-host-api/tests/server.test.ts", [
      "recoveryGroups",
      "recovery_group_write_set_overlap_shots_plan_md",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.ts", [
      "coerceSubagentSchedulerRecoveryGroups",
      "formatSubagentSchedulerRecoveryGroup",
      "formatAgentOsSubagentSchedulerRecoveryGroup",
      "groups=",
    ]);
    assertSourceContains(repoRoot, "apps/cli/src/shell.test.ts", [
      "recovery_group_observed_write_set_overlap_shots_risk_md",
      "groups=1",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "formatReviewSubagentSchedulerRecoveryGroups",
      "groups=",
      "completed=",
    ]);
    assertSourceContains(repoRoot, "apps/director-desktop/src/desktop-system-handlers.test.js", [
      "recoveryGroups",
      "recovery_group_write_set_overlap_src_alpha_ts",
    ]);
    assertSourceContains(
      repoRoot,
      "docs/plans/_active-execution/director-angel-agent-os-hardcore-upgrade-plan.md",
      ["Phase F.21 read-only scheduler recovery drilldown groups", "recoveryGroups"],
    );
    assertSchedulerRecoveryPlanStaysReadOnly(repoRoot);
  }),
  runCase("desktop Review UI prefers subagent run visibility over raw delegation mailbox", () =>
    assertSourceContains(repoRoot, "apps/director-desktop/src/app.js", [
      "createReviewSubagentRunRow",
      "formatReviewSubagentVerification",
      "parentVisibleResult",
      "writeSet",
      "writeSetSource",
      "parallelBatch",
      "blockedBy",
      "Agent OS 子代理",
    ]),
  ),
  runCase("weixin remote agent.delegate fails closed", () =>
    assertSourceContains(repoRoot, "apps/weixin-gateway/src/adapter.ts", [
      'input.call.name === "agent.delegate"',
      "remote-channel-agent-delegate-fail-closed",
      "微信远程通道不能直接创建子代理任务",
    ]),
  ),
  runCase("host api subagent projection stays read-only", () =>
    assertHostApiSubagentProjectionNoRunner(repoRoot),
  ),
  runCase("conversation runtime AgentTool executor stays task-plane backed", () =>
    assertAgentDelegateToolNoRunner(repoRoot),
  ),
  runCase("desktop AgentTool section does not introduce a runner", () =>
    assertDesktopAgentDelegateSectionNoRunner(repoRoot),
  ),
  runCase("weixin AgentTool section does not introduce a runner", () =>
    assertWeixinAgentDelegateSectionNoRunner(repoRoot),
  ),
  runCase("Phase F slice keeps voice/live audio fail-closed", () =>
    assertVoiceWorkStaysFailClosed(repoRoot),
  ),
  runCase("Phase F slice does not introduce a new OS runner", () =>
    assertNoNewRunnerInSubagentSlice(repoRoot),
  ),
  runCase("Phase F source scan ignores AppleDouble files", () =>
    assertAppleDoubleIgnored(repoRoot),
  ),
];
const failedRuns = runs.filter((run) => run.status !== 0);

mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, `${suiteId}-latest.json`);
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId,
        timestamp: new Date().toISOString(),
        totalRuns: runs.length,
        failedRuns: failedRuns.length,
      },
      runs,
    },
    null,
    2,
  ),
);

process.stdout.write(
  `Director Agent OS subagents gate completed: ${runs.length} checks, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  for (const failedRun of failedRuns) {
    process.stderr.write(
      [failedRun.label, failedRun.stderrPreview, failedRun.stdoutPreview]
        .filter(Boolean)
        .join("\n"),
    );
    process.stderr.write("\n");
  }
  process.exitCode = 1;
}
