#!/usr/bin/env node

import { execFile, spawn, spawnSync } from "node:child_process";
import { closeSync, createWriteStream, existsSync, openSync } from "node:fs";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

prependToolPaths();

const workspaceRoot = resolve(
  process.env.HOTFLOW_WORKSPACE_ROOT ??
    process.env.DIRECTOR_ANGEL_WORKSPACE_ROOT ??
    process.cwd(),
);
const stateRoot = resolve(
  process.env.OPENCLI_BRIDGE_STATE_ROOT ??
    join(workspaceRoot, ".director-angel", "external-tools", "opencli"),
);
const runtimeLogRoot = resolve(
  process.env.OPENCLI_BRIDGE_LOG_ROOT ??
    join(workspaceRoot, ".director-angel", "runtime", "logs"),
);
const sourceExtensionDir = resolve(
  process.env.OPENCLI_EXTENSION_SOURCE ??
    join(workspaceRoot, "参考仓库", "OpenCLI", "extension"),
);
const openCliBinary = process.env.OPENCLI_BINARY?.trim() || "opencli";
const remoteDebuggingPort = parsePositiveInteger(
  process.env.OPENCLI_BRIDGE_DEBUG_PORT,
  9333,
);
const chromeForTestingVersion = process.env.OPENCLI_CHROME_FOR_TESTING_VERSION?.trim();
const showBridgeChrome = parseBoolean(process.env.OPENCLI_BRIDGE_SHOW_CHROME);
const resetBridgeProfile = parseBoolean(process.env.OPENCLI_BRIDGE_RESET_PROFILE);
const allowBridgeChromeLaunch = parseBoolean(process.env.OPENCLI_BRIDGE_ALLOW_PRIVATE_CHROME);
const extraChromeArgs = parseChromeArgs(process.env.OPENCLI_BRIDGE_EXTRA_ARGS);

const browserRoot = join(stateRoot, "chrome-for-testing");
const tmpBrowserRoot = "/tmp/chrome-for-testing-opencli";
const extensionDir = join(stateRoot, "extension");
const profileDir = join(stateRoot, "profile");
const stdoutLog = join(runtimeLogRoot, "opencli-bridge-chrome.out.log");
const stderrLog = join(runtimeLogRoot, "opencli-bridge-chrome.err.log");

async function main() {
  await mkdir(stateRoot, { recursive: true });
  await mkdir(runtimeLogRoot, { recursive: true });

  await assertOpenCliAvailable();
  await reportOptionalTool("yt-dlp", ["--version"], "required for Bilibili video downloads");

  if (!allowBridgeChromeLaunch) {
    await restartOpenCliDaemon();
    log(
      "chrome: private Chrome for Testing launch is disabled. Use the existing system Chrome Browser Bridge profile, or set OPENCLI_BRIDGE_ALLOW_PRIVATE_CHROME=1 for an explicit manual bridge recovery.",
    );
    return;
  }

  await prepareExtension();
  const chromeBinary = await ensureChromeForTesting();

  await restartOpenCliDaemon();
  await stopExistingBridgeChrome();
  await launchBridgeChrome(chromeBinary);
  await hideBridgeChromeIfNeeded();
  await waitForBridgeReady();
  await hideBridgeChromeIfNeeded();
}

async function assertOpenCliAvailable() {
  try {
    const result = await execFileAsync(openCliBinary, ["--version"], { timeout: 10_000 });
    const version = String(result.stdout ?? "").trim();
    log(`opencli: ${version || "installed"}`);
  } catch (error) {
    fail(
      `OpenCLI binary is not available: ${openCliBinary}\n` +
        "Install it first, for example: npm install -g opencli",
      error,
    );
  }
}

async function reportOptionalTool(binary, args, purpose) {
  try {
    const result = await execFileAsync(binary, args, { timeout: 10_000 });
    const version = String(result.stdout ?? "").trim().split(/\r?\n/u)[0];
    log(`${binary}: ${version || "installed"} (${purpose})`);
  } catch {
    log(`warn: ${binary} is not on PATH (${purpose})`);
  }
}

async function prepareExtension() {
  if (!existsSync(join(sourceExtensionDir, "manifest.json"))) {
    fail(`OpenCLI extension source is missing: ${sourceExtensionDir}`);
  }
  await rm(extensionDir, { recursive: true, force: true });
  await mkdir(dirname(extensionDir), { recursive: true });
  await cp(sourceExtensionDir, extensionDir, { recursive: true });
  await removeAppleDoubleFiles(extensionDir);
  spawnSync("chmod", ["-R", "u+rwX", extensionDir], { stdio: "ignore" });
  spawnSync("xattr", ["-cr", extensionDir], { stdio: "ignore" });
  log(`extension: ${extensionDir}`);
}

async function ensureChromeForTesting() {
  const explicit = process.env.OPENCLI_CHROME_FOR_TESTING_BINARY?.trim();
  if (explicit && existsSync(explicit)) {
    log(`chrome-for-testing: ${explicit}`);
    return explicit;
  }

  const existing = await findChromeForTestingBinary(browserRoot);
  if (existing !== undefined) {
    log(`chrome-for-testing: ${existing}`);
    return existing;
  }

  const tmpExisting = await findChromeForTestingBinary(tmpBrowserRoot);
  if (tmpExisting !== undefined) {
    await rm(browserRoot, { recursive: true, force: true });
    await mkdir(dirname(browserRoot), { recursive: true });
    await cp(tmpBrowserRoot, browserRoot, { recursive: true });
    spawnSync("xattr", ["-cr", browserRoot], { stdio: "ignore" });
    const copied = await findChromeForTestingBinary(browserRoot);
    if (copied !== undefined) {
      log(`chrome-for-testing: copied from ${tmpBrowserRoot}`);
      log(`chrome-for-testing: ${copied}`);
      return copied;
    }
  }

  await mkdir(browserRoot, { recursive: true });
  const download = await resolveChromeForTestingDownload();
  const zipPath = join(browserRoot, `chrome-${download.version}-${download.platform}.zip`);
  log(`download: ${download.url}`);
  await downloadFile(download.url, zipPath);
  await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", browserRoot], {
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  spawnSync("xattr", ["-cr", browserRoot], { stdio: "ignore" });

  const binary = await findChromeForTestingBinary(browserRoot);
  if (binary === undefined) {
    fail(`Chrome for Testing binary was not found after download in ${browserRoot}`);
  }
  log(`chrome-for-testing: ${binary}`);
  return binary;
}

async function resolveChromeForTestingDownload() {
  const platform = chromeForTestingPlatform();
  if (chromeForTestingVersion) {
    return {
      version: chromeForTestingVersion,
      platform,
      url: `https://storage.googleapis.com/chrome-for-testing-public/${chromeForTestingVersion}/${platform}/chrome-${platform}.zip`,
    };
  }

  const response = await fetch(
    "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
  );
  if (!response.ok) {
    fail(`Failed to resolve Chrome for Testing download: HTTP ${response.status}`);
  }
  const body = await response.json();
  const stable = body?.channels?.Stable;
  const match = stable?.downloads?.chrome?.find((item) => item.platform === platform);
  if (typeof stable?.version !== "string" || typeof match?.url !== "string") {
    fail(`Chrome for Testing download metadata does not contain platform ${platform}`);
  }
  return { version: stable.version, platform, url: match.url };
}

function chromeForTestingPlatform() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "mac-arm64";
  }
  if (process.platform === "darwin") {
    return "mac-x64";
  }
  if (process.platform === "linux") {
    return "linux64";
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return "win64";
  }
  fail(`Unsupported Chrome for Testing platform: ${process.platform}/${process.arch}`);
}

async function findChromeForTestingBinary(root) {
  const candidates = [
    join(root, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    join(root, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
    join(root, "chrome-linux64", "chrome"),
    join(root, "chrome-win64", "chrome.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function restartOpenCliDaemon() {
  try {
    await execFileAsync(openCliBinary, ["daemon", "restart"], {
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    log("daemon: restarted");
  } catch (error) {
    fail("OpenCLI daemon restart failed.", error);
  }
}

async function stopExistingBridgeChrome() {
  spawnSync("screen", ["-S", "opencli-bridge-chrome", "-X", "quit"], { stdio: "ignore" });

  const pidSets = await Promise.all([
    findPidsByOpenTcpPort(remoteDebuggingPort),
    findPidsByProcessPattern(profileDir),
    findPidsByProcessPattern("/tmp/opencli-bridge-chrome-profile"),
  ]);
  const pids = [...new Set(pidSets.flat())].filter((pid) => pid > 0 && pid !== process.pid);
  if (pids.length === 0) {
    log("chrome: no existing bridge process found");
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
  await sleep(1_500);
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
      process.kill(pid, "SIGKILL");
    } catch {
      // Process exited after SIGTERM.
    }
  }
  log(`chrome: stopped existing bridge pids=${pids.join(",")}`);
}

async function findPidsByOpenTcpPort(port) {
  try {
    const result = await execFileAsync("lsof", ["-ti", `tcp:${port}`], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return parsePids(result.stdout);
  } catch {
    return [];
  }
}

async function findPidsByProcessPattern(pattern) {
  try {
    const result = await execFileAsync("pgrep", ["-f", pattern], {
      timeout: 5_000,
      maxBuffer: 1024 * 1024,
    });
    return parsePids(result.stdout);
  } catch {
    return [];
  }
}

function parsePids(text) {
  return String(text)
    .split(/\s+/u)
    .map((value) => Number.parseInt(value, 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

async function launchBridgeChrome(chromeBinary) {
  if (resetBridgeProfile) {
    await rm(profileDir, { recursive: true, force: true });
    log("chrome: reset bridge profile because OPENCLI_BRIDGE_RESET_PROFILE is enabled");
  }
  await mkdir(profileDir, { recursive: true });

  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-logging=stderr",
    "--v=1",
    "--window-size=1200,800",
    ...extraChromeArgs,
  ];

  if (!showBridgeChrome) {
    if (!hasChromeFlag(args, "--window-position")) {
      args.push("--window-position=-32000,-32000");
    }
    if (!hasChromeFlag(args, "--start-minimized")) {
      args.push("--start-minimized");
    }
  }

  if (showBridgeChrome) {
    args.push("about:blank");
  } else {
    args.push("about:blank");
  }
  const outFd = openSync(stdoutLog, "a");
  const errFd = openSync(stderrLog, "a");
  let child;
  try {
    const launchCommand = createChromeLaunchCommand(chromeBinary, args);
    child = spawn(launchCommand.command, launchCommand.args, {
      detached: true,
      stdio: ["ignore", outFd, errFd],
    });
    log(`chrome: ${launchCommand.description}`);
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
  child.unref();
  log(`chrome: launched pid=${child.pid ?? "unknown"} profile=${profileDir}`);
}

async function hideBridgeChromeIfNeeded() {
  if (showBridgeChrome) {
    log("chrome: left visible because OPENCLI_BRIDGE_SHOW_CHROME is enabled");
    return;
  }
  if (process.platform !== "darwin") {
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
      { timeout: 10_000 },
    );
    log("chrome: hidden from foreground");
  } catch (error) {
    log(`warn: failed to hide bridge chrome: ${String(error?.message ?? error)}`);
  }
}

async function waitForBridgeReady() {
  const deadline = Date.now() + 45_000;
  let lastStatus = undefined;
  while (Date.now() < deadline) {
    lastStatus = await readDaemonStatus().catch(() => undefined);
    if (lastStatus?.extensionConnected === true) {
      const doctor = await runOpenCli(["doctor"]);
      log("doctor: ready");
      process.stdout.write(`${doctor.stdout.trim()}\n`);
      return;
    }
    await sleep(1_000);
  }

  const doctor = await runOpenCli(["doctor"]).catch((error) => ({
    stdout: "",
    stderr: String(error?.message ?? error),
  }));
  fail(
    [
      "OpenCLI Browser Bridge did not become ready in time.",
      `lastStatus=${JSON.stringify(lastStatus ?? null)}`,
      `doctor=${String(doctor.stdout || doctor.stderr).trim()}`,
      `stderrLog=${stderrLog}`,
    ].join("\n"),
  );
}

async function readDaemonStatus() {
  const response = await fetch("http://127.0.0.1:19825/status", {
    headers: { "X-OpenCLI": "1" },
  });
  if (!response.ok) {
    throw new Error(`status HTTP ${response.status}`);
  }
  return response.json();
}

async function runOpenCli(args) {
  return execFileAsync(openCliBinary, args, {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
}

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    fail(`Download failed: ${url} HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(targetPath));
}

async function removeAppleDoubleFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.name.startsWith("._")) {
      await rm(path, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory()) {
      await removeAppleDoubleFiles(path);
    }
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value) {
  return /^(1|true|yes|on)$/iu.test(String(value ?? "").trim());
}

function parseChromeArgs(value) {
  return String(value ?? "")
    .split(/\s+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasChromeFlag(args, flag) {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function createChromeLaunchCommand(chromeBinary, chromeArgs) {
  if (!showBridgeChrome && process.platform === "darwin") {
    const appBundle = findMacAppBundle(chromeBinary);
    if (appBundle !== undefined) {
      return {
        command: "open",
        args: ["-gj", "-n", appBundle, "--args", ...chromeArgs],
        description: `launch requested hidden via macOS open app=${appBundle}`,
      };
    }
  }

  return {
    command: chromeBinary,
    args: chromeArgs,
    description: `launched directly binary=${chromeBinary}`,
  };
}

function findMacAppBundle(binaryPath) {
  const marker = ".app/";
  const index = binaryPath.indexOf(marker);
  if (index < 0) {
    return undefined;
  }
  return binaryPath.slice(0, index + marker.length - 1);
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function log(message) {
  process.stdout.write(`[opencli-bridge] ${message}\n`);
}

function fail(message, error) {
  process.stderr.write(`[opencli-bridge] ERROR: ${message}\n`);
  if (error !== undefined) {
    process.stderr.write(`${String(error?.stack ?? error)}\n`);
  }
  process.exit(1);
}

main().catch((error) => {
  fail("Unexpected failure while ensuring OpenCLI Browser Bridge.", error);
});
