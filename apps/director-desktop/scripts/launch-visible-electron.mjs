import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(scriptDir);
const workspaceRoot = resolve(appDir, "../..");
const mainPath = join(appDir, "src", "electron-main.cjs");
const userDataDir = join(workspaceRoot, ".hotflow", "director-desktop-user-data");
const singletonLockPath = join(userDataDir, "SingletonLock");
const visibleWindowTimeoutMs = Number.parseInt(
  process.env.DIRECTOR_DESKTOP_VISIBLE_WINDOW_TIMEOUT_MS ?? "10000",
  10,
);

if (!existsSync(mainPath)) {
  console.error(`Director Angel desktop main file is missing: ${mainPath}`);
  process.exit(1);
}

mkdirSync(userDataDir, { recursive: true });
cleanStaleSingletonLock();

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
childEnv.DIRECTOR_ANGEL_WORKSPACE_ROOT = workspaceRoot;
childEnv.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
childEnv.HOTFLOW_DATA_DIR = join(workspaceRoot, ".hotflow");
childEnv.DIRECTOR_DESKTOP_EXPECT_APP_PATH = appDir;
childEnv.DIRECTOR_DESKTOP_LAUNCHED_BY = "director-angel-visible-launcher";

const child = launchElectronVisible(childEnv);
await waitForVisibleDirectorWindow(visibleWindowTimeoutMs);

console.log(`Director Angel desktop window is visible: ${appDir}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child?.kill?.(signal);
  });
}

await waitForElectronExit(child);

function launchElectronVisible(env) {
  const electronBin = join(
    appDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron",
  );
  const electronExecutable =
    process.platform === "darwin"
      ? join(
          appDir,
          "node_modules",
          "electron",
          "dist",
          "Electron.app",
          "Contents",
          "MacOS",
          "Electron",
        )
      : electronBin;
  return spawn(electronExecutable, [appDir], {
    cwd: appDir,
    env,
    stdio: "inherit",
  });
}

function cleanStaleSingletonLock() {
  if (!existsSync(singletonLockPath)) {
    return;
  }
  const pid = readSingletonLockPid(singletonLockPath);
  if (pid !== null && isProcessAlive(pid)) {
    return;
  }
  const backupDir = `/tmp/director-desktop-stale-singleton-${Date.now()}`;
  mkdirSync(backupDir, { recursive: true });
  renameSync(singletonLockPath, join(backupDir, "SingletonLock"));
  console.warn(`Moved stale Director Angel SingletonLock to ${backupDir}`);
}

function readSingletonLockPid(path) {
  try {
    const stats = statSync(path);
    if (stats.isSymbolicLink()) {
      return null;
    }
    const content = readFileSync(path, "utf8");
    const match = content.match(/\d+/u);
    if (!match) {
      return null;
    }
    const pid = Number.parseInt(match[0], 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForVisibleDirectorWindow(timeoutMs) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (process.platform === "darwin") {
        const state = await readMacDirectorWindowState();
        if (state.visible && state.frontmost && state.titleMatched && state.defaultElectron === false) {
          return;
        }
        lastError = JSON.stringify(state);
      } else {
        const listed = await readWindowList();
        if (/Director Angel(?: Desktop)?/u.test(listed)) {
          return;
        }
        lastError = listed.trim();
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(500);
  }
  throw new Error(
    `Director Angel window was not visible after ${timeoutMs}ms. Last state: ${
      lastError || "unavailable"
    }`,
  );
}

async function readMacDirectorWindowState() {
  const script = [
    'tell application "System Events"',
    "set titleMatched to false",
    "set matchedFrontmost to false",
    "set defaultElectronFrontmost to false",
    "repeat with proc in processes",
    'if name of proc is "Electron" or name of proc contains "Director Angel" then',
    "set processHasDirectorWindow to false",
    "repeat with win in windows of proc",
    "try",
    "set winName to name of win as text",
    'if winName contains "Director Angel" then',
    "set titleMatched to true",
    "set processHasDirectorWindow to true",
    "end if",
    'if winName is "Electron" and frontmost of proc then',
    "set defaultElectronFrontmost to true",
    "end if",
    "end try",
    "end repeat",
    "if processHasDirectorWindow and frontmost of proc then",
    "set matchedFrontmost to true",
    "end if",
    "end if",
    "end repeat",
    "return (titleMatched as text) & \",\" & (matchedFrontmost as text) & \",\" & (defaultElectronFrontmost as text)",
    "end tell",
  ].join("\n");
  const stdout = await execFileText("/usr/bin/osascript", ["-e", script]);
  const [titleMatched, frontmost, defaultElectron] = stdout
    .trim()
    .split(",")
    .map((item) => item === "true");
  return { titleMatched, visible: titleMatched, frontmost, defaultElectron };
}

async function readWindowList() {
  if (process.platform === "linux") {
    return execFileText("wmctrl", ["-l"]);
  }
  return "";
}

function execFileText(file, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(file, args, { timeout: 5000 }, (error, stdout, stderr) => {
      if (error !== null) {
        rejectPromise(new Error(stderr.trim() || error.message));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function waitForElectronExit(childProcess) {
  return new Promise((resolvePromise) => {
    childProcess.once("error", (error) => {
      console.error(`Director Angel failed to launch Electron: ${error.message}`);
      process.exitCode = 1;
      resolvePromise();
    });
    childProcess.once("exit", (code, signal) => {
      if (typeof code === "number") {
        process.exitCode = code;
        resolvePromise();
        return;
      }
      console.error(`Director Angel Electron exited from signal ${signal ?? "unknown"}.`);
      process.exitCode = 1;
      resolvePromise();
    });
  });
}
