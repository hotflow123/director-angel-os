import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { getBenchmarksPaths } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { repoRoot, resultsDir } = getBenchmarksPaths();
const suiteId = "director-phase-p2-wave11-run-once-preflight-guidance-gate";
const latestPath = resolve(resultsDir, `${suiteId}-latest.json`);

const cases = [
  {
    id: "phase_p2_wave11_onboarding_run_once_guidance",
    label:
      "Onboarding surfaces a run-once next step when the latest director chain is healthy and ready",
    args: ["--filter", "@hotflow/cli", "test", "--", "src/control-plane-adapter.test.ts"],
  },
  {
    id: "phase_p2_wave11_preflight_run_once_guidance",
    label:
      "Preflight prefers the run-once command when healthy director execution already has ready work",
    args: ["--filter", "@hotflow/cli", "test", "--", "src/preflight.test.ts"],
  },
  {
    id: "phase_p2_wave11_acceptance_surface",
    label: "Director acceptance requires the run-once preflight guidance artifact",
    args: ["--filter", "@hotflow/cli", "test", "--", "src/director-acceptance.test.ts"],
  },
];

function preview(output, lines = 25) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runPnpm(args) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: Number(durationMs.toFixed(2)),
  };
}

function fail(message, details) {
  process.stderr.write(`${message}\n`);
  if (details) {
    process.stderr.write(`${details}\n`);
  }
  process.exit(1);
}

async function main() {
  mkdirSync(resultsDir, { recursive: true });

  const caseResults = cases.map((benchmarkCase) => {
    const result = runPnpm(benchmarkCase.args);
    return {
      id: benchmarkCase.id,
      label: benchmarkCase.label,
      status: result.status === 0 ? "passed" : "failed",
      durationMs: result.durationMs,
      command: `${pnpmBin} ${benchmarkCase.args.join(" ")}`,
      stdoutPreview: preview(result.stdout),
      stderrPreview: preview(result.stderr),
      failures:
        result.status === 0
          ? []
          : [`command exited with ${result.status}`, preview(result.stderr || result.stdout)],
    };
  });

  const failed = caseResults.filter((result) => result.status !== "passed");
  const report = {
    suiteId,
    generatedAt: new Date().toISOString(),
    summary: {
      total: caseResults.length,
      failed: failed.length,
      passed: caseResults.length - failed.length,
      totalDurationMs: Number(
        caseResults.reduce((sum, result) => sum + result.durationMs, 0).toFixed(2),
      ),
    },
    caseResults,
  };

  writeFileSync(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Director Phase P2 Wave 11 run-once preflight guidance gate completed: ${caseResults.length} cases, failed ${failed.length}\n`,
  );
  process.stdout.write(`Report: ${latestPath}\n`);

  if (failed.length > 0) {
    fail(
      "Director Phase P2 Wave 11 run-once preflight guidance gate failed.",
      failed.map((result) => `${result.id}: ${result.failures.join(" | ")}`).join("\n"),
    );
  }
}

await main();
