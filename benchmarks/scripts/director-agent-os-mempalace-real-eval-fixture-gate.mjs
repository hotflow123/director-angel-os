import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateMempalaceRecallBenchmarkFixture,
  evaluateMempalaceRecallBenchmarkThresholds,
} from "../../services/mempalace-adapter/dist/index.js";
import { getBenchmarksPaths } from "./cli-command.mjs";

const { repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  repoRoot,
  "benchmarks/fixtures/director-agent-os-mempalace-real-eval-mini.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const suiteId = fixture.suiteId ?? "director-agent-os-mempalace-real-eval-fixture-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

const qualityReport = evaluateMempalaceRecallBenchmarkFixture(fixture);
const qualityThresholds = evaluateMempalaceRecallBenchmarkThresholds(
  qualityReport,
  qualityReport.thresholds,
);
const diagnosticReport =
  Array.isArray(fixture.diagnosticCases) && fixture.diagnosticCases.length > 0
    ? evaluateMempalaceRecallBenchmarkFixture({
        ...fixture,
        suiteId: `${suiteId}-diagnostic`,
        cases: fixture.diagnosticCases,
      })
    : undefined;
const diagnosticThresholds =
  diagnosticReport === undefined
    ? undefined
    : evaluateMempalaceRecallBenchmarkThresholds(diagnosticReport, diagnosticReport.thresholds);

const failures = [...qualityThresholds.failures];

if (qualityThresholds.status !== "passed") {
  failures.push("quality fixture thresholds failed.");
}

if (diagnosticReport !== undefined && diagnosticThresholds?.status !== "failed") {
  failures.push("diagnostic fixture should fail thresholds to prove missing-evidence detection.");
}

if (
  diagnosticThresholds !== undefined &&
  !diagnosticThresholds.failures.some((item) => item.includes("missing expected IDs"))
) {
  failures.push("diagnostic fixture should report missing expected IDs.");
}

if (
  diagnosticThresholds !== undefined &&
  !diagnosticThresholds.failures.some((item) => item.includes("missing verbatim text"))
) {
  failures.push("diagnostic fixture should report missing verbatim evidence.");
}

if (
  diagnosticThresholds !== undefined &&
  !diagnosticThresholds.failures.some((item) => item.includes("missing provenance"))
) {
  failures.push("diagnostic fixture should report missing provenance evidence.");
}

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  fixturePath,
  source: qualityReport.source,
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    qualityCaseCount: qualityReport.summary.caseCount,
    diagnosticCaseCount: diagnosticReport?.summary.caseCount ?? 0,
    thresholds: qualityReport.thresholds,
    qualityAverages: qualityReport.summary.averages,
    failed: failures.length,
  },
  qualityReport,
  qualityThresholds,
  ...(diagnosticReport === undefined ? {} : { diagnosticReport }),
  ...(diagnosticThresholds === undefined ? {} : { diagnosticThresholds }),
  failures,
};

mkdirSync(resultsDir, { recursive: true });
writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Agent OS MemPalace real-eval fixture gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Quality averages: recall@k ${qualityReport.summary.averages.recallAtK}, ndcg@k ${qualityReport.summary.averages.ndcgAtK}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Agent OS MemPalace real-eval fixture gate failed.", failures.join("\n"));
}
