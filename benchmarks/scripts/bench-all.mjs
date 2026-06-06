import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";
import { waveSuites } from "./wave-suite-manifest.mjs";

const nodeBin = process.execPath;
const { benchmarksDir, resultsDir } = getBenchmarksPaths();

const suites = waveSuites;

function toPreview(output, lineCount = 25) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lineCount)
    .join("\n");
}

function findReportPath(stdout) {
  const lines = String(stdout ?? "").split("\n");
  for (const line of lines) {
    const match = line.match(/Report:\s*(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

function runSuite(suite) {
  const started = process.hrtime.bigint();
  const result = spawnSync(nodeBin, [resolve(benchmarksDir, "scripts", suite.script)], {
    cwd: benchmarksDir,
    env: process.env,
    encoding: "utf8",
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const success = result.status === 0;

  return {
    id: suite.id,
    kind: suite.kind,
    required: suite.required,
    success,
    exitCode: typeof result.status === "number" ? result.status : -1,
    durationMs: Number(durationMs.toFixed(2)),
    reportPath: findReportPath(result.stdout),
    stdoutPreview: toPreview(result.stdout),
    stderrPreview: toPreview(result.stderr),
  };
}

function renderMarkdownReport(report) {
  const rows = report.runs.map((run) => {
    const status = run.success ? "PASS" : "FAIL";
    const required = run.required ? "required" : "optional";
    const ms = run.durationMs.toFixed(2);
    const reportPath = run.reportPath ?? "-";
    return `| ${run.id} | ${run.kind} | ${required} | ${status} | ${run.exitCode} | ${ms} | ${reportPath} |`;
  });

  return [
    "# Bench All Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- overallStatus: ${report.summary.requiredFailed === 0 ? "pass" : "fail"}`,
    `- requiredPassed: ${report.summary.requiredPassed}/${report.summary.requiredTotal}`,
    `- optionalPassed: ${report.summary.optionalPassed}/${report.summary.optionalTotal}`,
    `- totalDurationMs: ${report.summary.totalDurationMs.toFixed(2)}`,
    "",
    "| Suite | Type | Scope | Status | Exit | DurationMs | ScriptReport |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

mkdirSync(resultsDir, { recursive: true });

const runs = [];
for (const suite of suites) {
  process.stdout.write(`[bench:all] Running ${suite.id} (${suite.kind})...\n`);
  runs.push(runSuite(suite));
}

const requiredRuns = runs.filter((run) => run.required);
const optionalRuns = runs.filter((run) => !run.required);
const summary = {
  requiredTotal: requiredRuns.length,
  requiredPassed: requiredRuns.filter((run) => run.success).length,
  requiredFailed: requiredRuns.filter((run) => !run.success).length,
  optionalTotal: optionalRuns.length,
  optionalPassed: optionalRuns.filter((run) => run.success).length,
  optionalFailed: optionalRuns.filter((run) => !run.success).length,
  totalDurationMs: Number(runs.reduce((acc, run) => acc + run.durationMs, 0).toFixed(2)),
};

const report = {
  suiteId: "bench-all",
  generatedAt: new Date().toISOString(),
  summary,
  runs,
};

const jsonOutputPath = resolve(resultsDir, "bench-all-latest.json");
const mdOutputPath = resolve(resultsDir, "bench-all-latest.md");
writeFileSync(jsonOutputPath, JSON.stringify(report, null, 2));
writeFileSync(mdOutputPath, renderMarkdownReport(report));

process.stdout.write(
  `[bench:all] completed: required failed ${summary.requiredFailed}, optional failed ${summary.optionalFailed}\n`,
);
process.stdout.write(`[bench:all] JSON report: ${jsonOutputPath}\n`);
process.stdout.write(`[bench:all] Markdown report: ${mdOutputPath}\n`);

if (summary.requiredFailed > 0) {
  process.exitCode = 1;
}
