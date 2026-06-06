import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getBenchmarksPaths, runHotflowCliCommand } from "./cli-command.mjs";

const pnpmBin = process.env.npm_execpath ?? (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
const { benchmarksDir, repoRoot, resultsDir } = getBenchmarksPaths();
const fixturePath = resolve(
  benchmarksDir,
  "fixtures",
  "director-beta7-wave1-adapter-registry-gate.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

function fail(message, details) {
  if (details) {
    process.stderr.write(`${message}\n${details}\n`);
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
}

function preview(output, lines = 30) {
  return String(output ?? "")
    .split("\n")
    .slice(0, lines)
    .join("\n");
}

function runHotflowCli(command, env) {
  return runHotflowCliCommand(command, env);
}

function verifyNeedles(output, label, needles, failures) {
  for (const needle of needles ?? []) {
    if (!output.includes(needle)) {
      failures.push(`${label} should include "${needle}".`);
    }
  }
}

function recordCommandRun(commandRuns, action, command, result) {
  commandRuns.push({
    action,
    command,
    status: result.status,
    durationMs: result.durationMs,
    stdoutPreview: preview(result.stdout),
    stderrPreview: preview(result.stderr),
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  const body = text.length === 0 ? null : JSON.parse(text);

  return { response, body };
}

async function reservePort(host = "127.0.0.1") {
  return await new Promise((resolvePort, rejectPort) => {
    const server = createNetServer();
    server.unref();
    server.once("error", rejectPort);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => rejectPort(new Error("Failed to reserve TCP port.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          rejectPort(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function startDirectorHostApi(workspaceEnv) {
  const host = "127.0.0.1";
  const port = await reservePort(host);
  const baseUrl = `http://${host}:${port}`;
  const stdoutChunks = [];
  const stderrChunks = [];

  const child = spawn(pnpmBin, ["--filter", "@hotflow/director-host-api", "dev"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...workspaceEnv,
      DIRECTOR_HOST_API_HOST: host,
      DIRECTOR_HOST_API_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    stdoutChunks.push(String(chunk));
  });
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(String(chunk));
  });

  const getLogs = () => ({
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  });

  const waitForHealthy = async () => {
    const started = Date.now();

    while (Date.now() - started < 10000) {
      if (child.exitCode !== null) {
        const logs = getLogs();
        throw new Error(
          [
            `Director host API exited early with code ${child.exitCode}.`,
            logs.stdout.length > 0 ? `stdout:\n${logs.stdout}` : "",
            logs.stderr.length > 0 ? `stderr:\n${logs.stderr}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      }

      try {
        const { response } = await requestJson(`${baseUrl}/health`);
        if (response.ok) {
          return;
        }
      } catch {
        // Keep polling until healthy.
      }

      await delay(100);
    }

    const logs = getLogs();
    throw new Error(
      [
        `Timed out waiting for Director host API health at ${baseUrl}.`,
        logs.stdout.length > 0 ? `stdout:\n${logs.stdout}` : "",
        logs.stderr.length > 0 ? `stderr:\n${logs.stderr}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  };

  const close = async () => {
    if (child.exitCode !== null) {
      return;
    }

    child.kill("SIGTERM");
    const exited = await Promise.race([
      new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
      delay(3000, false),
    ]);

    if (exited === false && child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([
        new Promise((resolveExit) => child.once("exit", () => resolveExit(true))),
        delay(1000, false),
      ]);
    }
  };

  await waitForHealthy();

  return {
    baseUrl,
    close,
  };
}

async function main() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "director-beta7-wave1-"));
  const commandRuns = [];
  const failures = [];
  let hostApi = null;

  try {
    const manifestPath = join(workspaceRoot, "seedance-preview.json");
    writeFileSync(manifestPath, `${JSON.stringify(fixture.adapterManifest, null, 2)}\n`, "utf8");

    const workspaceEnv = {
      ...process.env,
      HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    };

    const registerRun = runHotflowCli(
      ["director", "adapters", "register", "--manifest", manifestPath],
      workspaceEnv,
    );
    recordCommandRun(
      commandRuns,
      "register",
      ["director", "adapters", "register", "--manifest", manifestPath],
      registerRun,
    );
    if (registerRun.status !== 0) {
      failures.push(`register command exited with ${registerRun.status}.`);
    }
    verifyNeedles(registerRun.stdout, "register stdout", fixture.cliNeedles.register, failures);

    const disableRun = runHotflowCli(
      ["director", "adapters", "disable", "--adapter-id", fixture.expected.adapterId],
      workspaceEnv,
    );
    recordCommandRun(
      commandRuns,
      "disable",
      ["director", "adapters", "disable", "--adapter-id", fixture.expected.adapterId],
      disableRun,
    );
    if (disableRun.status !== 0) {
      failures.push(`disable command exited with ${disableRun.status}.`);
    }
    verifyNeedles(disableRun.stdout, "disable stdout", fixture.cliNeedles.disable, failures);

    const explainRun = runHotflowCli(
      ["director", "adapters", "explain", "--adapter-id", fixture.expected.adapterId],
      workspaceEnv,
    );
    recordCommandRun(
      commandRuns,
      "explain",
      ["director", "adapters", "explain", "--adapter-id", fixture.expected.adapterId],
      explainRun,
    );
    if (explainRun.status !== 0) {
      failures.push(`explain command exited with ${explainRun.status}.`);
    }
    verifyNeedles(explainRun.stdout, "explain stdout", fixture.cliNeedles.explain, failures);

    const switchDocument = JSON.parse(
      readFileSync(join(workspaceRoot, ".director-angel", "runtime", "switches.json"), "utf8"),
    );
    if (switchDocument.adapterOverrides?.[fixture.expected.adapterId] !== false) {
      failures.push(
        "switches.json should persist a forced-off override for the registered adapter.",
      );
    }

    hostApi = await startDirectorHostApi(workspaceEnv);
    const runtimeSnapshot = await requestJson(`${hostApi.baseUrl}/v1/runtime/snapshot`);
    if (!runtimeSnapshot.response.ok) {
      failures.push(`/v1/runtime/snapshot returned ${runtimeSnapshot.response.status}.`);
    }

    const adapter =
      runtimeSnapshot.body?.capabilitySnapshot?.adapters?.find(
        (entry) => entry.adapterId === fixture.expected.adapterId,
      ) ?? null;
    if (!adapter) {
      failures.push("runtime snapshot did not include the persisted adapter.");
    } else {
      if (adapter.adapterKind !== fixture.expected.adapterKind) {
        failures.push(
          `adapter kind expected ${fixture.expected.adapterKind} but received ${adapter.adapterKind}.`,
        );
      }
      if (adapter.provider !== fixture.expected.provider) {
        failures.push(
          `adapter provider expected ${fixture.expected.provider} but received ${adapter.provider}.`,
        );
      }
      if (adapter.enabled !== fixture.expected.enabled) {
        failures.push(
          `adapter enabled expected ${fixture.expected.enabled} but received ${adapter.enabled}.`,
        );
      }
      if (adapter.healthStatus !== fixture.expected.healthStatus) {
        failures.push(
          `adapter health expected ${fixture.expected.healthStatus} but received ${adapter.healthStatus}.`,
        );
      }
    }

    const resultPath = join(
      resultsDir,
      `director-beta7-wave1-adapter-registry-gate-${Date.now()}.json`,
    );
    writeFileSync(
      resultPath,
      `${JSON.stringify(
        {
          gateId: "director-beta7-wave1-adapter-registry-gate",
          status: failures.length === 0 ? "pass" : "fail",
          workspaceRoot,
          commandRuns,
          runtimeSnapshot: runtimeSnapshot.body,
          failures,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    if (failures.length > 0) {
      fail("Director Beta-7 Wave 1 adapter registry gate failed.", failures.join("\n"));
    }

    process.stdout.write(
      `Director Beta-7 Wave 1 adapter registry gate passed.\nResult: ${resultPath}\n`,
    );
  } catch (error) {
    const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
    fail("Director Beta-7 Wave 1 adapter registry gate crashed.", details);
  } finally {
    if (hostApi) {
      await hostApi.close();
    }
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

await main();
