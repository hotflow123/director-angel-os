import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DynamicContextAssembler,
  MultiStepTurnContext,
} from "../../packages/context/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function toPositiveInteger(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function assert(condition, message) {
  if (!condition) {
    fail("Assertion failed", message);
  }
}

function inspectSectionIds(context, rebuild) {
  return rebuild.cacheBoundary.dynamicSections.map((section) => section.id);
}

function runIteration(config, iteration) {
  const context = new MultiStepTurnContext(new DynamicContextAssembler());
  context.setUserInput(config.userInput);

  const first = context.rebuild({ tokenBudget: config.tokenBudget });
  assert(
    inspectSectionIds(context, first).length === 1,
    `Expected user input only on first rebuild, got ${inspectSectionIds(context, first).join(", ")}`,
  );

  context.appendToolResult({
    toolName: "tasks.todo_write",
    ok: true,
    output: {
      items: [{ id: "wave6-1", content: "Ship beta" }],
    },
  });
  context.setTaskState("Current todo: Ship beta");
  context.replaceRecallBlock({
    blockId: config.recallBlock.blockId,
    items: config.recallBlock.items,
    summary: config.recallBlock.summary,
    degraded: config.recallBlock.degraded,
  });

  const second = context.rebuild({ tokenBudget: config.tokenBudget });
  const secondIds = inspectSectionIds(context, second);
  for (const expectedId of config.expectedSecondOrder) {
    assert(
      secondIds.includes(expectedId),
      `Second rebuild missing expected section ${expectedId}, got ${secondIds.join(", ")}`,
    );
  }

  if (config.recallBlock.degraded?.reason !== undefined) {
    assert(
      second.prompt.includes(config.recallBlock.degraded.reason),
      `Second rebuild prompt should mention degrade reason ${config.recallBlock.degraded.reason}`,
    );
  }
  if (config.recallBlock.degraded?.message !== undefined) {
    assert(
      second.prompt.includes(config.recallBlock.degraded.message),
      `Second rebuild prompt should include degrade message ${config.recallBlock.degraded.message}`,
    );
  }

  context.setCustomDynamicSections([config.customSection]);
  const third = context.rebuild({ tokenBudget: config.lowBudget });
  assert(
    third.budget.omitted.some((section) => section.id === config.customSection.id),
    `Expected custom section "${config.customSection.id}" to be omitted under budget ${config.lowBudget}`,
  );

  const latestBudget = context.getLastBudget();
  assert(
    latestBudget !== undefined,
    "Expected MultiStepTurnContext to expose the last TokenBudgetResult",
  );
  assert(
    Array.isArray(latestBudget.omitted) &&
      latestBudget.omitted.map((section) => section.id).join(",") ===
        third.budget.omitted.map((section) => section.id).join(","),
    "Expected cached budget to match actual omitted sections",
  );

  return {
    ok: true,
    iteration,
    phase: "dynamic-context",
    sections: {
      first: inspectSectionIds(context, first),
      second: secondIds,
      thirdOmitted: third.budget.omitted.map((section) => section.id),
    },
  };
}

const { benchmarksDir, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(benchmarksDir, "fixtures", "wave6-dynamic-context-gate.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const suiteId =
  typeof fixture.suiteId === "string" ? fixture.suiteId : "wave6-dynamic-context-gate";
const iterations = toPositiveInteger(fixture.iterations, 1);
const config = {
  userInput: fixture.userInput ?? "Plan the rollout",
  tokenBudget: typeof fixture.tokenBudget === "number" ? fixture.tokenBudget : 256,
  lowBudget: typeof fixture.lowBudget === "number" ? fixture.lowBudget : 5,
  expectedSecondOrder: Array.isArray(fixture.expectedSecondOrder)
    ? fixture.expectedSecondOrder
    : [
        "user-input",
        "tool-result-1",
        "task-state",
        "working-memory.degraded",
        "working-memory.recall-1",
      ],
  recallBlock: fixture.recallBlock ?? {
    blockId: "working-memory",
    items: [
      {
        layer: "working-memory",
        content: "Milestone stored",
      },
    ],
    summary: "Working memory snapshot",
    degraded: {
      reason: "memory-timeout",
      message: "Recall backend timed out",
    },
  },
  customSection: fixture.customSection ?? {
    id: "huge",
    cacheBucket: "dynamic",
    priority: 10,
    content: "x".repeat(4_000),
    tokenCost: 4_000,
  },
};

mkdirSync(resultsDir, { recursive: true });
const runs = [];
const startTime = new Date().toISOString();
for (let iteration = 1; iteration <= iterations; iteration += 1) {
  runs.push(runIteration(config, iteration));
}

const reportPath = resolve(resultsDir, "wave6-dynamic-context-gate-latest.json");
const report = {
  summary: {
    suiteId,
    startedAt: startTime,
    finishedAt: new Date().toISOString(),
    iterations,
    totalRuns: runs.length,
    failedRuns: runs.filter((run) => !run.ok).length,
  },
  runs,
};

writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Wave 6 dynamic context gate succeeded: ${runs.length} runs`);
console.log(`Report: ${reportPath}`);
