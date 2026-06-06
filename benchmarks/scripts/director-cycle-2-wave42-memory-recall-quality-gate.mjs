import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateDirectorRecallTraceSuite } from "../../packages/director-knowledge/dist/recall-eval.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const { resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave42-memory-recall-quality-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const thresholds = {
  recallAtK: 0.8,
  recallAnyAtK: 1,
  ndcgAtK: 0.7,
};

const qualityCases = [
  {
    queryId: "seedance-latest-experience",
    expectedIds: ["knowledge:seedance-latest-workflow", "skill:web-source-learning"],
    hits: [
      {
        id: "knowledge:seedance-latest-workflow",
        source: "knowledge",
        status: "hit",
        score: 0.94,
      },
      {
        id: "skill:web-source-learning",
        source: "skill",
        status: "hit",
        score: 0.88,
      },
      {
        id: "memory:user-prefers-result-first",
        source: "memory",
        status: "hit",
        score: 0.72,
      },
    ],
    k: 3,
  },
  {
    queryId: "wechat-sogou-search-route",
    expectedIds: ["memory:wechat-sogou-route", "tool:sogou-wechat-search"],
    hits: [
      {
        id: "tool:sogou-wechat-search",
        source: "tool",
        status: "hit",
        score: 0.91,
      },
      {
        id: "memory:wechat-sogou-route",
        source: "memory",
        status: "hit",
        score: 0.86,
      },
      {
        id: "knowledge:generic-web-search",
        source: "knowledge",
        status: "hit",
        score: 0.53,
      },
    ],
    k: 2,
  },
  {
    queryId: "comfyui-script-image-video-workflow",
    expectedIds: ["skill:comfyui-workflow-runner", "knowledge:scene-level-image-video-prompts"],
    hits: [
      {
        id: "skill:comfyui-workflow-runner",
        source: "skill",
        status: "hit",
        score: 0.92,
      },
      {
        id: "knowledge:scene-level-image-video-prompts",
        source: "knowledge",
        status: "hit",
        score: 0.89,
      },
      {
        id: "memory:external-tool-boundary",
        source: "memory",
        status: "hit",
        score: 0.79,
      },
    ],
    k: 2,
  },
];

const diagnosticCases = [
  {
    queryId: "missing-report-diagnostic",
    expectedIds: ["knowledge:must-be-reported-missing"],
    hits: [
      {
        id: "memory:nearby-but-wrong",
        source: "memory",
        status: "hit",
        score: 0.55,
      },
    ],
    k: 3,
  },
];

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

function assertThreshold(name, actual, expected, failures) {
  if (actual < expected) {
    failures.push(`${name} expected >= ${expected} but received ${actual}.`);
  }
}

async function main() {
  mkdirSync(resultsDir, { recursive: true });

  const qualitySuite = evaluateDirectorRecallTraceSuite(qualityCases);
  const diagnosticSuite = evaluateDirectorRecallTraceSuite(diagnosticCases);
  const failures = [];

  assertThreshold(
    "average recall@k",
    qualitySuite.averages.recallAtK,
    thresholds.recallAtK,
    failures,
  );
  assertThreshold(
    "average recallAny@k",
    qualitySuite.averages.recallAnyAtK,
    thresholds.recallAnyAtK,
    failures,
  );
  assertThreshold("average ndcg@k", qualitySuite.averages.ndcgAtK, thresholds.ndcgAtK, failures);

  if (qualitySuite.failures.length > 0) {
    failures.push(
      `quality suite should not miss expected IDs: ${JSON.stringify(qualitySuite.failures)}`,
    );
  }

  const diagnosticFailure = diagnosticSuite.failures.find(
    (item) => item.queryId === "missing-report-diagnostic",
  );
  if (!diagnosticFailure) {
    failures.push("diagnostic suite should report a missing expected ID.");
  } else if (!diagnosticFailure.missingExpectedIds.includes("knowledge:must-be-reported-missing")) {
    failures.push(
      `diagnostic suite reported unexpected missing IDs: ${diagnosticFailure.missingExpectedIds.join(", ")}`,
    );
  }

  const report = {
    suiteId,
    generatedAt: new Date().toISOString(),
    summary: {
      status: failures.length === 0 ? "passed" : "failed",
      qualityCaseCount: qualitySuite.caseCount,
      diagnosticCaseCount: diagnosticSuite.caseCount,
      thresholds,
      averages: qualitySuite.averages,
      failed: failures.length,
    },
    qualitySuite,
    diagnosticSuite,
    failures,
  };

  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Cycle 2 Wave 42 memory recall quality gate completed: ${report.summary.status}\n`,
  );
  process.stdout.write(
    `Quality averages: recall@k ${qualitySuite.averages.recallAtK}, ndcg@k ${qualitySuite.averages.ndcgAtK}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failures.length > 0) {
    fail("Director Cycle 2 Wave 42 memory recall quality gate failed.", failures.join("\n"));
  }
}

await main();
