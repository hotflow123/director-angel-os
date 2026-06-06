import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

describe("director desktop CLI process runner", () => {
  it("records timeout SIGTERM as process evidence for sandbox ledger consumers", async () => {
    const { createRunCliProcessCommand } = require("./desktop-cli-process-runner.cjs");
    const killedSignals = [];
    const child = new EventEmitter();
    child.pid = 4321;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn((signal) => {
      killedSignals.push(signal);
      setTimeout(() => child.emit("close", null, signal), 0);
      return true;
    });
    const spawn = vi.fn(() => child);
    const events = [];
    const runCliProcessCommand = createRunCliProcessCommand({
      spawn,
      workspaceRoot: "/tmp/director-workspace",
      commandTimeoutMs: 5,
      processEnv: { BASE_ENV: "1" },
      emitDesktopEvent: (event) => events.push(event),
    });

    const result = await runCliProcessCommand({
      executable: "/usr/local/bin/node",
      argv: ["/workspace/apps/cli/dist/main.js", "director", "status"],
      cwd: "/tmp/director-workspace",
      env: { HOTFLOW_DATA_DIR: "/tmp/director-workspace/.hotflow" },
    });

    expect(spawn).toHaveBeenCalledWith(
      "/usr/local/bin/node",
      ["/workspace/apps/cli/dist/main.js", "director", "status"],
      expect.objectContaining({
        cwd: "/tmp/director-workspace",
        env: expect.objectContaining({
          BASE_ENV: "1",
          HOTFLOW_DATA_DIR: "/tmp/director-workspace/.hotflow",
        }),
        windowsHide: true,
      }),
    );
    expect(killedSignals).toEqual(["SIGTERM"]);
    expect(result).toMatchObject({
      exitCode: 1,
      metadata: {
        signal: "SIGTERM",
        process: {
          pid: 4321,
          signal: "SIGTERM",
          ownedProcess: true,
          terminationReason: "timeout",
          signals: [{ signal: "SIGTERM", reason: "timeout" }],
        },
      },
    });
    expect(result.stderr).toContain("Command timed out after 5ms.");
    expect(events).toEqual([]);
  });

  it("blocks bare Electron, Moyin, and private browser bridge launches before spawning a process", async () => {
    const { createRunCliProcessCommand } = require("./desktop-cli-process-runner.cjs");
    const spawn = vi.fn();
    const runCliProcessCommand = createRunCliProcessCommand({
      spawn,
      workspaceRoot: "/tmp/director-workspace",
      commandTimeoutMs: 5,
      processEnv: {},
    });

    const bareElectron = await runCliProcessCommand({
      executable:
        "/Users/example/Apps/moyin-creator/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      argv: ["path-to-app"],
    });
    const moyinApp = await runCliProcessCommand({
      executable: "open",
      argv: ["-a", "/Applications/魔因漫创.app"],
    });
    const bridgeChrome = await runCliProcessCommand({
      executable: "open",
      argv: [
        "-gj",
        "-n",
        "/Volumes/work/.director-angel/external-tools/opencli/chrome-for-testing/chrome-mac-arm64/Google Chrome for Testing.app",
        "--args",
        "--remote-debugging-port=9333",
        "--user-data-dir=/Volumes/work/.director-angel/external-tools/opencli/profile",
        "about:blank",
      ],
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(bareElectron).toMatchObject({
      exitCode: 126,
      metadata: {
        process: {
          ownedProcess: false,
          terminationReason: "blocked",
          denied: {
            reason: "blocked-moyin-launch",
          },
        },
      },
    });
    expect(moyinApp).toMatchObject({
      exitCode: 126,
      metadata: {
        process: {
          denied: {
            reason: "blocked-moyin-launch",
          },
        },
      },
    });
    expect(bridgeChrome).toMatchObject({
      exitCode: 126,
      metadata: {
        process: {
          denied: {
            reason: "blocked-private-browser-launch",
          },
        },
      },
    });
  });
});
