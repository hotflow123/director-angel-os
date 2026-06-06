import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pnpmBin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const benchmarksDir = resolve(scriptDir, "..");
const repoRoot = resolve(benchmarksDir, "..");
const tempDir = resolve(benchmarksDir, ".tmp");
const hotflowBenchmarkCliPath = resolve(
  repoRoot,
  "apps",
  "cli",
  "scripts",
  "director-benchmark-cli.ts",
);

function ensureTempDir() {
  mkdirSync(tempDir, { recursive: true });
}

function runPnpmCli(args, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync(pnpmBin, args, {
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

function createCommandResult(status, stdoutChunks, stderrChunks, started) {
  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  return {
    status,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
    durationMs: Number(durationMs.toFixed(2)),
  };
}

export function runCliCommand(commandArgs, options = {}) {
  ensureTempDir();
  const sessionDbPath = options.sessionDbPath ?? resolve(tempDir, "cli-bench.sqlite");
  const env = {
    ...process.env,
    HOTFLOW_WORKSPACE_ROOT: repoRoot,
    HOTFLOW_CLI_SESSION_DB_PATH: sessionDbPath,
  };

  return runPnpmCli(["--filter", "@hotflow/cli", "dev", "--", ...commandArgs], env);
}

export function runHotflowCliCommand(commandArgs, env) {
  return runPnpmCli(["--filter", "@hotflow/cli", "dev", "--", ...commandArgs], env);
}

export function runWorkspaceBuild(target, env = process.env) {
  return runPnpmCli(["--filter", target, "build"], env);
}

export function getBenchmarksPaths() {
  return {
    repoRoot,
    benchmarksDir,
    tempDir,
    resultsDir: resolve(benchmarksDir, "results"),
  };
}

export function runHotflowCliWithBuiltWorker(commandArgs, env) {
  return new Promise((resolveRun, rejectRun) => {
    const started = process.hrtime.bigint();
    const stdoutChunks = [];
    const stderrChunks = [];
    const normalizedCommandArgs =
      commandArgs[0] === "director" &&
      commandArgs[1] === "run" &&
      commandArgs[2] === "once" &&
      !commandArgs.includes("--json")
        ? [...commandArgs, "--json"]
        : commandArgs;
    const child = spawn(
      pnpmBin,
      [
        "--filter",
        "@hotflow/cli",
        "exec",
        "tsx",
        "--tsconfig",
        "./tsconfig.dev.json",
        hotflowBenchmarkCliPath,
        ...normalizedCommandArgs,
      ],
      {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    child.stdout?.on("data", (chunk) => {
      stdoutChunks.push(String(chunk));
    });
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
    });
    child.once("error", rejectRun);
    child.once("close", (code) => {
      resolveRun(createCommandResult(code ?? -1, stdoutChunks, stderrChunks, started));
    });
  });
}
