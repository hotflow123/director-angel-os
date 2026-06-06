import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { bootstrapCli } from "../../apps/cli/dist/bootstrap.js";
import { SessionStore } from "../../packages/sessions/dist/index.js";
import { projectSessionTaskState } from "../../packages/tasks-core/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

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

async function dispatchOrThrow(controlPlane, action) {
  const result = await controlPlane.dispatch(action);
  if (!result.ok) {
    throw new Error(result.error ?? `Control-plane action failed: ${action.type}`);
  }
  return result.data;
}

async function runCase(benchmarkCase) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `hotflow-bench-${benchmarkCase.id}-`));
  const dataDir = join(workspaceRoot, ".hotflow");
  const sessionDbPath = join(dataDir, "sessions", `${benchmarkCase.id}.sqlite`);
  const readmePath = join(workspaceRoot, "README.md");
  mkdirSync(join(dataDir, "sessions"), { recursive: true });
  writeFileSync(readmePath, "Agent OS repository details for reconcile benchmark.\n", "utf8");

  const env = {
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
    HOTFLOW_DEFAULT_PROVIDER: "scripted",
    HOTFLOW_DEFAULT_MODEL: "hotflow-phase1",
  };

  const cli = bootstrapCli({ env });
  try {
    const prompt = replaceReadmePlaceholder(benchmarkCase.prompt, readmePath);
    const turnResult = await cli.engine.runTurn({
      userText: prompt,
      providerId: "scripted",
      model: "hotflow-phase1",
      turnId: benchmarkCase.turnId,
    });

    await dispatchOrThrow(cli.controlPlane, {
      type: "proposal-enqueue",
      sessionId: turnResult.sessionId,
      proposal: {
        id: benchmarkCase.proposalId,
        kind: "tasks.todo_write",
        payload: benchmarkCase.proposalPayload,
        sourceSessionId: turnResult.sessionId,
        sourceTurnId: benchmarkCase.turnId,
        provenance: benchmarkCase.provenance,
      },
    });
    await dispatchOrThrow(cli.controlPlane, {
      type: "proposal-transition",
      sessionId: turnResult.sessionId,
      proposalId: benchmarkCase.proposalId,
      status: "accepted",
    });

    const proposalBeforeApply = await dispatchOrThrow(cli.controlPlane, {
      type: "proposal-get",
      sessionId: turnResult.sessionId,
      proposalId: benchmarkCase.proposalId,
    });

    const started = process.hrtime.bigint();
    await dispatchOrThrow(cli.controlPlane, {
      type: "proposal-apply",
      sessionId: turnResult.sessionId,
      proposalId: benchmarkCase.proposalId,
    });
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    const proposalAfterApply = await dispatchOrThrow(cli.controlPlane, {
      type: "proposal-get",
      sessionId: turnResult.sessionId,
      proposalId: benchmarkCase.proposalId,
    });

    cli.sessionStore.close();
    const store = new SessionStore({ dbPath: sessionDbPath });
    try {
      const taskState = projectSessionTaskState(store, turnResult.sessionId, {
        createIfMissing: false,
      });
      const actual = {
        sessionId: turnResult.sessionId,
        proposalStatusBeforeApply: proposalBeforeApply?.status ?? null,
        proposalStatusAfterApply: proposalAfterApply?.status ?? null,
        initialTodoCount: turnResult.taskState.items.length,
        appliedTodoCount: taskState.todos.items.length,
        firstAppliedTodo: taskState.todos.items[0]?.content ?? null,
        proposalOutboxSize: taskState.proposalOutbox.length,
        appliedOutboxFound: taskState.proposalOutbox.some((entry) => entry.status === "applied"),
        sourceSessionIdMatched: proposalAfterApply?.sourceSessionId === turnResult.sessionId,
        sourceTurnId: proposalAfterApply?.sourceTurnId ?? null,
        provenance: proposalAfterApply?.provenance ?? null,
      };
      const failures = compareSubset(actual, benchmarkCase.expect, "result");

      return {
        caseId: benchmarkCase.id,
        durationMs,
        ok: failures.length === 0,
        failures,
        actual,
      };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      caseId: benchmarkCase.id,
      durationMs: 0,
      ok: false,
      failures: [String(error)],
      actual: null,
    };
  } finally {
    try {
      cli.sessionStore.close();
    } catch {
      // Ignore double-close when replay verification already closed the store.
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave13-proposal-reconcile-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const runs = [];

for (const benchmarkCase of fixture.cases ?? []) {
  runs.push(await runCase(benchmarkCase));
}

const failedRuns = runs.filter((run) => !run.ok);
mkdirSync(resultsDir, { recursive: true });
const outputPath = resolve(resultsDir, "wave13-proposal-reconcile-gate-latest.json");
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      summary: {
        suiteId: fixture.suiteId ?? "wave13-proposal-reconcile-gate",
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
  `Wave 13 proposal reconcile gate completed: ${runs.length} runs, failed ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${outputPath}\n`);

if (failedRuns.length > 0) {
  process.exitCode = 1;
}
