import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { evaluateMempalaceRecallBenchmark } from "../../services/mempalace-adapter/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const { resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave45-mempalace-recall-benchmark-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const thresholds = {
  recallAtK: 0.8,
  recallAnyAtK: 1,
  ndcgAtK: 0.75,
};

const qualityReport = evaluateMempalaceRecallBenchmark({
  suiteId,
  cases: [
    {
      queryId: "scene-level-video-workflow",
      query: "scene level image video prompt workflow",
      expectedIds: ["mempalace:drawer_scene_video_01"],
      result: {
        outcome: "ok",
        items: [
          {
            id: "drawer_scene_video_01",
            content:
              "For script+image+video workflows, keep each scene prompt scoped to that scene.",
            score: 0.96,
            updatedAt: 1_777_000,
            wing: "director-angel",
            room: "external-tools",
            metadata: {
              retrievalEngine: "mempalace",
              matchMode: "drawer+closet",
              vectorSimilarity: 0.96,
              bm25Score: 0.83,
              sourceFile: "comfyui-workflows.md",
              verbatim:
                "For script+image+video workflows, keep each scene prompt scoped to that scene. Do not pass all scenes into every video node.",
              provenance: {
                engine: "mempalace",
                sourceFile: "comfyui-workflows.md",
                wing: "director-angel",
                room: "external-tools",
                drawerIndex: 3,
                totalDrawers: 9,
              },
            },
          },
          {
            id: "drawer_generic_tool_02",
            content: "Generic external tool setup note.",
            score: 0.52,
            updatedAt: 1_777_000,
          },
        ],
        details: {
          retrieval: {
            engine: "mempalace",
            mode: "hybrid",
            query: "scene level image video prompt workflow",
            requested: 2,
            returned: 2,
          },
        },
      },
      k: 2,
    },
    {
      queryId: "sogou-weixin-route-memory",
      query: "微信公众号 搜狗 搜索 公众号文章",
      expectedIds: ["mempalace:drawer_sogou_weixin_01"],
      result: {
        outcome: "ok",
        items: [
          {
            id: "drawer_sogou_weixin_01",
            content: "WeChat public-account article search should route through Sogou Weixin.",
            score: 0.91,
            updatedAt: 1_777_001,
            wing: "director-angel",
            room: "source-grounding",
            metadata: {
              retrievalEngine: "mempalace",
              matchMode: "drawer",
              vectorSimilarity: 0.91,
              sourceFile: "source-grounding.md",
              verbatim:
                "WeChat public-account article search should route through Sogou Weixin before falling back to generic web search.",
              provenance: {
                engine: "mempalace",
                sourceFile: "source-grounding.md",
                wing: "director-angel",
                room: "source-grounding",
                drawerIndex: 1,
                totalDrawers: 4,
              },
            },
          },
        ],
        details: {
          retrieval: {
            engine: "mempalace",
            mode: "vector",
            query: "微信公众号 搜狗 搜索 公众号文章",
            requested: 3,
            returned: 1,
          },
        },
      },
      k: 3,
    },
  ],
});

const diagnosticReport = evaluateMempalaceRecallBenchmark({
  suiteId: `${suiteId}-diagnostic`,
  cases: [
    {
      queryId: "missing-expected-id-diagnostic",
      query: "missing expected memory diagnostic",
      expectedIds: ["mempalace:drawer_required_missing"],
      result: {
        outcome: "degraded",
        items: [
          {
            id: "drawer_nearby_wrong",
            content: "Nearby but not expected.",
            score: 0.5,
            updatedAt: 1_777_002,
          },
        ],
        degraded: {
          reason: "mempalace-timeout",
          message: "simulated timeout",
        },
        details: {},
      },
      k: 3,
    },
  ],
});

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

mkdirSync(resultsDir, { recursive: true });

const failures = [];
assertThreshold(
  "recall@k",
  qualityReport.summary.averages.recallAtK,
  thresholds.recallAtK,
  failures,
);
assertThreshold(
  "recallAny@k",
  qualityReport.summary.averages.recallAnyAtK,
  thresholds.recallAnyAtK,
  failures,
);
assertThreshold("ndcg@k", qualityReport.summary.averages.ndcgAtK, thresholds.ndcgAtK, failures);

if (qualityReport.failures.length > 0) {
  failures.push(
    `quality report should have no failures: ${JSON.stringify(qualityReport.failures)}`,
  );
}

const diagnosticFailure = diagnosticReport.failures.find(
  (item) => item.queryId === "missing-expected-id-diagnostic",
);
if (!diagnosticFailure) {
  failures.push("diagnostic report should surface a missing expected ID.");
} else if (!diagnosticFailure.missingExpectedIds.includes("mempalace:drawer_required_missing")) {
  failures.push(
    `diagnostic report surfaced unexpected missing IDs: ${diagnosticFailure.missingExpectedIds.join(", ")}`,
  );
}

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    thresholds,
    qualityAverages: qualityReport.summary.averages,
    qualityCaseCount: qualityReport.summary.caseCount,
    diagnosticCaseCount: diagnosticReport.summary.caseCount,
    failed: failures.length,
  },
  qualityReport,
  diagnosticReport,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Cycle 2 Wave 45 MemPalace recall benchmark gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Quality averages: recall@k ${qualityReport.summary.averages.recallAtK}, ndcg@k ${qualityReport.summary.averages.ndcgAtK}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Cycle 2 Wave 45 MemPalace recall benchmark gate failed.", failures.join("\n"));
}
