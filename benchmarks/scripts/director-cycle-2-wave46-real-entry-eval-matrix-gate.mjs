import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const nodeBin = process.execPath;
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-cycle-2-wave46-real-entry-eval-matrix-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const dependencySuites = [
  {
    id: "director-cycle-2-wave43-unified-conversation-tool-recall-gate",
    script: "director-cycle-2-wave43-unified-conversation-tool-recall-gate.mjs",
    report: "director-cycle-2-wave43-unified-conversation-tool-recall-gate-latest.json",
  },
  {
    id: "director-cycle-2-wave44-real-entry-runtime-gate",
    script: "director-cycle-2-wave44-real-entry-runtime-gate.mjs",
    report: "director-cycle-2-wave44-real-entry-runtime-gate-latest.json",
  },
  {
    id: "director-cycle-2-wave45-mempalace-recall-benchmark-gate",
    script: "director-cycle-2-wave45-mempalace-recall-benchmark-gate.mjs",
    report: "director-cycle-2-wave45-mempalace-recall-benchmark-gate-latest.json",
  },
];

const requiredCoverage = [
  {
    id: "desktop-entry-tool-use",
    sourceSuite: "director-cycle-2-wave44-real-entry-runtime-gate",
    reportNeedles: ["desktop workbench real entry"],
    sourceNeedles: [
      {
        path: "apps/director-desktop/src/desktop-system-handlers.test.js",
        needles: [
          'it("records model-requested web tools',
          'it("routes model-requested WeChat article searches through Sogou Weixin web tools',
        ],
      },
    ],
  },
  {
    id: "weixin-entry-tool-use",
    sourceSuite: "director-cycle-2-wave44-real-entry-runtime-gate",
    reportNeedles: ["Weixin real entry", "conversation-runtime", "Sogou Weixin"],
  },
  {
    id: "conversation-tool-loop",
    sourceSuite: "director-cycle-2-wave43-unified-conversation-tool-recall-gate",
    reportNeedles: ["model/tool loop", "source-grounding", "X/Twitter", "learning follow-ups"],
  },
  {
    id: "learning-path",
    sourceSuite: "director-cycle-2-wave44-real-entry-runtime-gate",
    reportNeedles: ["desktop workbench real entry"],
    sourceNeedles: [
      {
        path: "apps/director-desktop/src/desktop-system-handlers.test.js",
        needles: [
          'it("runs the real directory learning review and promotion path through bridge actions',
          'it("turns accepted experience into a review-gated Skill proposal and safely applies it',
        ],
      },
    ],
  },
  {
    id: "mempalace-recall-evidence",
    sourceSuite: "director-cycle-2-wave45-mempalace-recall-benchmark-gate",
    reportNeedles: ["retrievalEngine", "hasVerbatim", "provenance", "sogou-weixin-route-memory"],
  },
];

function preview(output, lines = 25) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runNodeScript(script) {
  const started = process.hrtime.bigint();
  const result = spawnSync(nodeBin, [resolve(benchmarksDir, "scripts", script)], {
    cwd: benchmarksDir,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return {
    status: result.status ?? -1,
    durationMs: Number(durationMs.toFixed(2)),
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  };
}

function readReport(reportFile) {
  return JSON.parse(readFileSync(resolve(resultsDir, reportFile), "utf8"));
}

function reportText(report) {
  return JSON.stringify(report);
}

function readSourceText(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function isReportPassing(report) {
  if (report.summary?.status === "passed") {
    return true;
  }
  if (report.summary?.failed === 0) {
    return true;
  }
  return false;
}

function evaluateCoverage(reports) {
  return requiredCoverage.map((item) => {
    const report = reports[item.sourceSuite];
    const text = reportText(report);
    const reportNeedles = item.reportNeedles ?? [];
    const missingReportNeedles = reportNeedles.filter((needle) => !text.includes(needle));
    const sourceNeedleResults = (item.sourceNeedles ?? []).map((source) => {
      let sourceText = "";
      let sourceLoadError = null;
      try {
        sourceText = readSourceText(source.path);
      } catch (error) {
        sourceLoadError = error instanceof Error ? error.message : String(error);
      }
      const missingNeedles =
        sourceLoadError === null
          ? source.needles.filter((needle) => !sourceText.includes(needle))
          : source.needles;
      return {
        path: source.path,
        needles: source.needles,
        missingNeedles,
        ...(sourceLoadError === null ? {} : { sourceLoadError }),
      };
    });
    const missingSourceNeedles = sourceNeedleResults.flatMap((source) =>
      source.missingNeedles.map((needle) => `${source.path}: ${needle}`),
    );
    const missingNeedles = [...missingReportNeedles, ...missingSourceNeedles];
    return {
      id: item.id,
      sourceSuite: item.sourceSuite,
      status: missingNeedles.length === 0 ? "passed" : "failed",
      reportNeedles,
      sourceNeedleResults,
      missingNeedles,
    };
  });
}

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

mkdirSync(resultsDir, { recursive: true });

const suiteRuns = dependencySuites.map((suite) => {
  const run = runNodeScript(suite.script);
  let report = null;
  let reportLoadError = null;
  try {
    report = readReport(suite.report);
  } catch (error) {
    reportLoadError = error instanceof Error ? error.message : String(error);
  }
  return {
    ...suite,
    ...run,
    reportPath: resolve(resultsDir, suite.report),
    reportStatus:
      reportLoadError === null && report !== null && isReportPassing(report) ? "passed" : "failed",
    ...(reportLoadError === null ? {} : { reportLoadError }),
    report,
  };
});

const reports = Object.fromEntries(
  suiteRuns.filter((suite) => suite.report !== null).map((suite) => [suite.id, suite.report]),
);
const coverageResults = evaluateCoverage(reports);
const failedRuns = suiteRuns.filter(
  (suite) => suite.status !== 0 || suite.reportStatus !== "passed",
);
const failedCoverage = coverageResults.filter((item) => item.status !== "passed");
const failures = [
  ...failedRuns.map(
    (suite) =>
      `${suite.id} failed: exit=${suite.status}, reportStatus=${suite.reportStatus}${
        suite.reportLoadError ? `, reportLoadError=${suite.reportLoadError}` : ""
      }`,
  ),
  ...failedCoverage.map(
    (item) => `${item.id} missing ${item.missingNeedles.join(", ")} in ${item.sourceSuite}`,
  ),
];

const report = {
  suiteId,
  generatedAt: new Date().toISOString(),
  summary: {
    status: failures.length === 0 ? "passed" : "failed",
    dependencySuites: dependencySuites.length,
    dependencyFailures: failedRuns.length,
    coverageItems: coverageResults.length,
    coverageFailures: failedCoverage.length,
    failed: failures.length,
    note: "This is a systematic regression/eval matrix over desktop, Weixin, tool-use, learning, and recall evidence. It does not replace manual real-device release smoke.",
  },
  suiteRuns: suiteRuns.map(({ report, ...suite }) => suite),
  coverageResults,
  manualReleaseSmokeStillRequired: true,
  failures,
};

writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(
  `Director Cycle 2 Wave 46 real-entry eval matrix gate completed: ${report.summary.status}\n`,
);
process.stdout.write(
  `Coverage: ${coverageResults.length - failedCoverage.length}/${coverageResults.length}, dependency failures: ${failedRuns.length}\n`,
);
process.stdout.write(`Report: ${latestPath}\n`);

if (failures.length > 0) {
  fail("Director Cycle 2 Wave 46 real-entry eval matrix gate failed.", failures.join("\n"));
}
