#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

prependToolPaths();

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = dirname(scriptPath);
const workspaceRoot = resolve(
  process.env.HOTFLOW_WORKSPACE_ROOT ??
    process.env.DIRECTOR_ANGEL_WORKSPACE_ROOT ??
    resolve(scriptDir, ".."),
);
const runtimeLogRoot = resolve(
  process.env.OPENCLI_BRIDGE_LOG_ROOT ??
    join(workspaceRoot, ".director-angel", "runtime", "logs"),
);
const statusUrl = process.env.OPENCLI_DAEMON_STATUS_URL ?? "http://127.0.0.1:19825/status";
const openCliBinary = process.env.OPENCLI_BINARY?.trim() || "opencli";
const remoteDebuggingPort = parsePositiveInteger(process.env.OPENCLI_BRIDGE_DEBUG_PORT, 9333);
const intervalMs = parsePositiveInteger(process.env.OPENCLI_WATCHDOG_INTERVAL_MS, 3_000);
const runDoctorProbe = parseBoolean(process.env.OPENCLI_WATCHDOG_DOCTOR);
const hideBridgeChrome = !parseBoolean(process.env.OPENCLI_WATCHDOG_DISABLE_HIDE);
const once = process.argv.includes("--once");
const startDetached = process.argv.includes("--start-detached");
const stopDetached = process.argv.includes("--stop-detached");
const screenName = process.env.OPENCLI_WATCHDOG_SCREEN_NAME?.trim() || "opencli-bridge-watchdog";

const stdoutLog = join(runtimeLogRoot, "opencli-bridge-watchdog.out.log");
const stderrLog = join(runtimeLogRoot, "opencli-bridge-watchdog.err.log");

async function main() {
  mkdirSync(runtimeLogRoot, { recursive: true });

  if (stopDetached) {
    stopDetachedWatchdog();
    return;
  }

  if (startDetached) {
    startDetachedWatchdog();
    return;
  }

  log(`workspace: ${workspaceRoot}`);
  log(`status-url: ${statusUrl}`);
  log(`mode: ${once ? "once" : `loop every ${intervalMs}ms`}`);

  if (once) {
    const result = await checkAndRecover();
    process.exitCode = result.ready ? 0 : 1;
    return;
  }

  while (true) {
    await checkAndRecover();
    await sleep(intervalMs);
  }
}

async function checkAndRecover() {
  const status = await readBridgeStatus();
  if (status.ready) {
    log(`ready: daemon=${status.daemonVersion} extension=${status.extensionVersion} context=${status.contextId}`);
    return status;
  }

  log(`not-ready: ${status.reason}`);
  const recovered = await runEnsureBridge();
  if (!recovered) {
    return { ready: false, reason: "recover-failed" };
  }

  const postStatus = await waitForReadyAfterRecover();
  if (postStatus.ready) {
    log(
      `recovered: daemon=${postStatus.daemonVersion} extension=${postStatus.extensionVersion} context=${postStatus.contextId}`,
    );
    return postStatus;
  }

  log(`recover-incomplete: ${postStatus.reason}`);
  return postStatus;
}

async function readBridgeStatus() {
  try {
    const status = await fetchJson(statusUrl, { headers: { "X-OpenCLI": "1" }, timeoutMs: 10_000 });
    if (status?.ok !== true) {
      return { ready: false, reason: `daemon status not ok: ${JSON.stringify(status)}` };
    }
    if (status?.extensionConnected !== true) {
      return {
        ready: false,
        reason: "Browser Bridge extension is not connected",
        daemonVersion: status.daemonVersion,
        contextId: status.contextId,
      };
    }

    await hideBridgeChromeIfNeeded();

    if (runDoctorProbe) {
      const doctor = await runDoctor();
      if (!doctor.ready) {
        return { ready: false, reason: doctor.reason };
      }
      await hideBridgeChromeIfNeeded();
    }
    return {
      ready: true,
      daemonVersion: status.daemonVersion,
      extensionVersion: status.extensionVersion,
      contextId: status.contextId,
    };
  } catch (error) {
    return { ready: false, reason: String(error?.message ?? error) };
  }
}

async function hideBridgeChromeIfNeeded() {
  if (!hideBridgeChrome || process.platform !== "darwin") {
    return;
  }
  try {
    await execFileAsync(
      "osascript",
      [
        "-e",
        [
          'tell application "System Events"',
          'if exists process "Google Chrome for Testing" then',
          'set visible of process "Google Chrome for Testing" to false',
          "end if",
          "end tell",
        ].join("\n"),
      ],
      { timeout: 5_000 },
    );
  } catch (error) {
    log(`warn: failed to hide bridge chrome: ${String(error?.message ?? error)}`);
  }
}

async function runDoctor() {
  try {
    const result = await execFileAsync(openCliBinary, ["doctor"], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (/Everything looks good!/u.test(text)) {
      return { ready: true };
    }
    return { ready: false, reason: `doctor not ready: ${text.trim().slice(0, 500)}` };
  } catch (error) {
    const stdout = String(error?.stdout ?? "");
    const stderr = String(error?.stderr ?? "");
    const detail = `${stdout}\n${stderr}\n${String(error?.message ?? error)}`.trim();
    return { ready: false, reason: `doctor failed: ${detail.slice(0, 500)}` };
  }
}

async function runEnsureBridge() {
  const ensureScript = join(scriptDir, "ensure-opencli-browser-bridge.mjs");
  log(`recover: ${ensureScript}`);
  try {
    const result = await execFileAsync(process.execPath, [ensureScript], {
      cwd: workspaceRoot,
      timeout: 90_000,
      maxBuffer: 5 * 1024 * 1024,
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        DIRECTOR_ANGEL_WORKSPACE_ROOT: workspaceRoot,
      },
    });
    writeChildOutput(result.stdout, result.stderr);
    return true;
  } catch (error) {
    writeChildOutput(error?.stdout, error?.stderr);
    log(`recover failed: ${String(error?.message ?? error)}`);
    return false;
  }
}

async function waitForReadyAfterRecover() {
  const deadline = Date.now() + 20_000;
  let latest = { ready: false, reason: "not checked" };
  while (Date.now() < deadline) {
    latest = await readBridgeStatus();
    if (latest.ready) {
      return latest;
    }
    await sleep(1_000);
  }
  return latest;
}

function startDetachedWatchdog() {
  stopDetachedWatchdog();
  const outFd = openSync(stdoutLog, "a");
  const errFd = openSync(stderrLog, "a");
  let child;
  try {
    child = spawn("screen", [
      "-dmS",
      screenName,
      process.execPath,
      scriptPath,
    ], {
      cwd: workspaceRoot,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      env: {
        ...process.env,
        HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
        DIRECTOR_ANGEL_WORKSPACE_ROOT: workspaceRoot,
      },
    });
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  child.unref();
  log(`watchdog started: screen=${screenName} stdout=${stdoutLog} stderr=${stderrLog}`);
}

function stopDetachedWatchdog() {
  const result = spawn("screen", ["-S", screenName, "-X", "quit"], { stdio: "ignore" });
  result.on("exit", () => {});
  log(`watchdog stop requested: screen=${screenName}`);
}

async function fetchJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(init.timeoutMs ?? 10_000));
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

function writeChildOutput(stdout, stderr) {
  const out = String(stdout ?? "").trim();
  const err = String(stderr ?? "").trim();
  if (out.length > 0) {
    log(`recover stdout:\n${out}`);
  }
  if (err.length > 0) {
    log(`recover stderr:\n${err}`);
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/iu.test(String(value ?? "").trim());
}

function prependToolPaths() {
  const home = homedir();
  const candidates = [
    join(home, ".local", "node-current", "bin"),
    join(home, "Library", "Python", "3.9", "bin"),
    join(home, ".local", "bin"),
  ];
  const existingPath = process.env.PATH ?? "";
  const parts = existingPath.split(":").filter(Boolean);
  process.env.PATH = [
    ...candidates.filter((path) => existsSync(path) && !parts.includes(path)),
    ...parts,
  ].join(":");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message) {
  const line = `[opencli-watchdog] ${new Date().toISOString()} ${message}`;
  process.stdout.write(`${line}\n`);
}

main().catch((error) => {
  process.stderr.write(`[opencli-watchdog] ERROR: ${String(error?.stack ?? error)}\n`);
  process.exit(1);
});
