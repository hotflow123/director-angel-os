import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = dirname(scriptDir);
const workspaceRoot = resolve(appDir, "../..");
const mainPath = join(appDir, "src", "electron-main.cjs");
const electronBin = join(
  appDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron",
);

if (!existsSync(mainPath)) {
  console.error(`Director Angel desktop main file is missing: ${mainPath}`);
  process.exit(1);
}

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
childEnv.DIRECTOR_ANGEL_WORKSPACE_ROOT = workspaceRoot;
childEnv.HOTFLOW_WORKSPACE_ROOT = workspaceRoot;
childEnv.HOTFLOW_DATA_DIR = join(workspaceRoot, ".hotflow");
childEnv.DIRECTOR_DESKTOP_EXPECT_APP_PATH = appDir;
childEnv.DIRECTOR_DESKTOP_LAUNCHED_BY = "director-angel-launcher";
const child = spawn(electronBin, [appDir], {
  cwd: appDir,
  env: childEnv,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Director Angel failed to launch Electron: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (typeof code === "number") {
    process.exitCode = code;
    return;
  }
  console.error(`Director Angel Electron exited from signal ${signal ?? "unknown"}.`);
  process.exitCode = 1;
});
