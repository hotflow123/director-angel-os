import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapCli } from "../../apps/cli/dist/bootstrap.js";
import { bootstrapWorkerJobs } from "../../apps/worker-jobs/dist/bootstrap.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import { SkillPromptIndex } from "../../packages/skills/dist/index.js";
import { SessionStoreTaskPlanePort } from "../../packages/tasks-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function compareSubset(actual, expected, path = "value") {
  const failures = [];

  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    if (actual !== expected) {
      failures.push(
        `Expected ${path}=${JSON.stringify(expected)} but received ${JSON.stringify(actual)}.`,
      );
    }
    return failures;
  }

  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
    failures.push(`Expected ${path} to be an object.`);
    return failures;
  }

  for (const [key, expectedValue] of Object.entries(expected)) {
    failures.push(...compareSubset(actual[key], expectedValue, `${path}.${key}`));
  }

  return failures;
}

function replaceReadmePlaceholder(value, readmePath) {
  if (typeof value === "string") {
    return value.replaceAll("__README__", readmePath);
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceReadmePlaceholder(item, readmePath));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceReadmePlaceholder(item, readmePath)]),
    );
  }
  return value;
}

function runHotflowCli(repoRoot, command, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, ["--filter", "@hotflow/cli", "dev", "--", ...command], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs,
  };
}

function toPreview(output, lines = 40) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function verifyCommandRun(run, expectedAction, expectedNeedle) {
  const failures = [];
  if (run.status !== 0) {
    failures.push(`Expected ${expectedAction} exit status 0 but received ${run.status}.`);
  }
  if (!run.stdout.includes(`Task action: ${expectedAction}`)) {
    failures.push(`Missing action marker for ${expectedAction}.`);
  }
  if (expectedNeedle && !run.stdout.includes(expectedNeedle)) {
    failures.push(`Expected ${expectedAction} stdout to include: ${expectedNeedle}`);
  }
  return failures;
}

function extractControlActionEvidence(sessionDbPath, sessionId, requiredActions) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const events = store.listAuditEvents(sessionId);
    const controlEvents = events.filter((entry) => entry.event.kind === "control.action");
    const actionsWithEvidence = new Set();

    for (const entry of controlEvents) {
      const payload = entry.event.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        continue;
      }
      if (payload.ok !== true || typeof payload.action !== "string") {
        continue;
      }
      if (requiredActions.includes(payload.action)) {
        actionsWithEvidence.add(payload.action);
      }
    }

    return {
      totalControlActions: controlEvents.length,
      actionsWithEvidence: [...actionsWithEvidence].sort(),
    };
  } finally {
    store.close();
  }
}

function closeCliRuntime(runtime) {
  if (!runtime) {
    return;
  }
  try {
    runtime.sessionStore?.close?.();
  } catch {
    // Ignore cleanup failures for benchmark runtimes.
  }
  try {
    runtime.close?.();
  } catch {
    // Ignore cleanup failures for benchmark runtimes.
  }
}

async function readProposalStatus(sessionDbPath, sessionId, proposalId) {
  const store = new SessionStore({ dbPath: sessionDbPath });
  try {
    const taskPlane = new SessionStoreTaskPlanePort(store, sessionId, {
      createIfMissing: false,
    });
    return await taskPlane.getProposal(proposalId);
  } finally {
    store.close();
  }
}

async function runCase(benchmarkCase, paths) {
  const started = process.hrtime.bigint();
  const workspaceRoot = mkdtempSync(join(tmpdir(), `hotflow-bench-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const readmePath = join(workspaceRoot, "README.md");
  const requiredActions = benchmarkCase.requiredActions ?? [
    "proposal-list",
    "proposal-review",
    "proposal-accept",
    "proposal-preview",
    "proposal-apply",
  ];

  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(readmePath, "Phase 4 golden path benchmark README.\n", "utf8");

  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_WORKER_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };

  let turnRuntime = null;
  let runtimeBeforeReload = null;
  let reloadedRuntime = null;
  let worker = null;

  try {
    const commandRuns = [];
    const failures = [];

    turnRuntime = bootstrapCli({ env });
    const prompt = replaceReadmePlaceholder(benchmarkCase.prompt, readmePath);
    const turnResult = await turnRuntime.engine.runTurn({
      userText: prompt,
      providerId: "scripted",
      model: "hotflow-phase1",
      sessionId: benchmarkCase.sessionId,
      turnId: benchmarkCase.turnId,
    });
    closeCliRuntime(turnRuntime);
    turnRuntime = null;

    worker = bootstrapWorkerJobs({ env });
    const workerResult = await worker.jobs.trajectorySkillProposal({
      sessionId: turnResult.sessionId,
      proposalId: benchmarkCase.proposalId,
      provenance: benchmarkCase.provenance,
    });
    worker.close();
    worker = null;

    runtimeBeforeReload = bootstrapCli({ env });

    const commandPlan = [
      {
        action: "proposal-list",
        command: ["task", "proposal-list", turnResult.sessionId, "--limit", "10"],
        expectedNeedle: workerResult.proposalId,
      },
      {
        action: "proposal-review",
        command: [
          "task",
          "proposal-review",
          turnResult.sessionId,
          "--proposal-id",
          workerResult.proposalId,
        ],
        expectedNeedle: "verdict=accepted",
      },
      {
        action: "proposal-accept",
        command: [
          "task",
          "proposal-accept",
          turnResult.sessionId,
          "--proposal-id",
          workerResult.proposalId,
          "--decision-note",
          "bench-wave29-accept",
        ],
        expectedNeedle: "status=accepted",
      },
      {
        action: "proposal-preview",
        command: [
          "task",
          "proposal-preview",
          turnResult.sessionId,
          "--proposal-id",
          workerResult.proposalId,
        ],
        expectedNeedle: "Proposal preview:",
      },
      {
        action: "proposal-apply",
        command: [
          "task",
          "proposal-apply",
          turnResult.sessionId,
          "--proposal-id",
          workerResult.proposalId,
        ],
        expectedNeedle: "status=applied",
      },
    ];

    for (const step of commandPlan) {
      const run = runHotflowCli(paths.repoRoot, step.command, env);
      commandRuns.push({
        action: step.action,
        command: step.command,
        status: run.status,
        durationMs: Number(run.durationMs.toFixed(2)),
        stdoutPreview: toPreview(run.stdout),
        stderr: run.stderr.trim(),
      });
      failures.push(...verifyCommandRun(run, step.action, step.expectedNeedle));
    }

    const proposalAfterApply = await readProposalStatus(
      sessionDbPath,
      turnResult.sessionId,
      workerResult.proposalId,
    );
    const liveSkillCountBeforeReload = runtimeBeforeReload.skillRepository.listApproved().length;
    const approvedSkillCountBeforeReload =
      runtimeBeforeReload.approvedSkillRepository.listApproved().length;

    if (liveSkillCountBeforeReload !== 0) {
      failures.push("Applied skill became visible before runtime reload.");
    }
    if (approvedSkillCountBeforeReload !== 1) {
      failures.push(
        `Expected approved head count 1 before reload, received ${approvedSkillCountBeforeReload}.`,
      );
    }
    if (proposalAfterApply?.status !== "applied") {
      failures.push(
        `Expected proposal ${workerResult.proposalId} status=applied after golden path apply.`,
      );
    }

    closeCliRuntime(runtimeBeforeReload);
    runtimeBeforeReload = null;

    reloadedRuntime = bootstrapCli({ env });
    const promptSections = new SkillPromptIndex(reloadedRuntime.skillRepository).buildSections({
      userText: "Read the README and summarize the repository.",
      limit: 1,
    });
    const liveSkillCountAfterReload = reloadedRuntime.skillRepository.listApproved().length;
    if (liveSkillCountAfterReload !== 1) {
      failures.push(
        `Expected runtime approved skill count 1 after reload, received ${liveSkillCountAfterReload}.`,
      );
    }
    if (promptSections.length !== 1) {
      failures.push(`Expected one prompt section after reload, received ${promptSections.length}.`);
    }

    const auditEvidence = extractControlActionEvidence(
      sessionDbPath,
      turnResult.sessionId,
      requiredActions,
    );
    const missingAuditedActions = requiredActions.filter(
      (action) => !auditEvidence.actionsWithEvidence.includes(action),
    );
    if (missingAuditedActions.length > 0) {
      failures.push(
        `Missing control.action audit evidence for: ${missingAuditedActions.join(", ")}.`,
      );
    }

    const proposalListRun = commandRuns.find((run) => run.action === "proposal-list");
    const proposalReviewRun = commandRuns.find((run) => run.action === "proposal-review");

    const actual = {
      sessionId: turnResult.sessionId,
      sourceTurnId: workerResult.sourceTurnId,
      proposalId: workerResult.proposalId,
      proposalKind: workerResult.proposal.kind,
      proposalStatusAfterApply: proposalAfterApply?.status ?? null,
      operatorListSawProposal:
        proposalListRun?.stdoutPreview.includes(workerResult.proposalId) ?? false,
      operatorReviewVerdictAccepted:
        proposalReviewRun?.stdoutPreview.includes("verdict=accepted") ?? false,
      allOperatorStepsPassed: commandRuns.every((run) => run.status === 0),
      allRequiredActionsAudited: missingAuditedActions.length === 0,
      liveSkillCountBeforeReload,
      approvedSkillCountBeforeReload,
      liveSkillCountAfterReload,
      promptSectionsAfterReload: promptSections.length,
    };

    failures.push(...compareSubset(actual, benchmarkCase.expect, "result"));

    return {
      caseId: benchmarkCase.id,
      durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      ok: failures.length === 0,
      failures,
      actual,
      commandRuns,
      auditEvidence,
    };
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      durationMs: Number(process.hrtime.bigint() - started) / 1_000_000,
      ok: false,
      failures: [String(error)],
      actual: null,
      commandRuns: [],
    };
  } finally {
    closeCliRuntime(turnRuntime);
    closeCliRuntime(runtimeBeforeReload);
    closeCliRuntime(reloadedRuntime);
    try {
      worker?.close();
    } catch {
      // Ignore cleanup failures for benchmark runtimes.
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir, repoRoot } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave29-phase4-golden-path-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase, { repoRoot }));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave29-phase4-golden-path-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave29-phase4-golden-path-gate",
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
  `Wave 29 Phase 4 golden path gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
