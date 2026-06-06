import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createDirectorDesktopCliSandboxRunner } from "./desktop-cli-sandbox-runner.js";

describe("director desktop CLI sandbox runner", () => {
  it("executes desktop CLI argv through the Agent OS sandbox-owned host runner", async () => {
    const workspaceRoot = "/tmp/director-workspace";
    const dataDir = join(workspaceRoot, ".hotflow");
    const cliMainPath = join(workspaceRoot, "apps", "cli", "dist", "main.js");
    const runProcessCommand = vi.fn(async (request) => ({
      exitCode: 0,
      stdout: "Director workspace status\n",
      stderr: "",
      metadata: {
        signal: null,
      },
      process: {
        pid: 4321,
        signal: null,
        ownedProcess: true,
        terminationReason: "completed",
      },
    }));
    const runCliCommand = createDirectorDesktopCliSandboxRunner({
      workspaceRoot,
      dataDir,
      cliMainPath,
      resolveCliRuntime: () => ({
        executable: "/usr/local/bin/node",
        env: { ELECTRON_RUN_AS_NODE: "1" },
      }),
      runProcessCommand,
      now: () => "2026-05-08T06:00:00.000Z",
    });

    const result = await runCliCommand(["director", "status"]);

    expect(runProcessCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: "host",
        executable: "/usr/local/bin/node",
        argv: [cliMainPath, "director", "status"],
        cwd: workspaceRoot,
        env: expect.objectContaining({
          HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
          DIRECTOR_ANGEL_WORKSPACE_ROOT: workspaceRoot,
          HOTFLOW_DATA_DIR: dataDir,
          ELECTRON_RUN_AS_NODE: "1",
        }),
      }),
    );
    expect(result).toMatchObject({
      argv: ["director", "status"],
      exitCode: 0,
      stdout: "Director workspace status\n",
      stderr: "",
      signal: null,
      sandbox: {
        ok: true,
        status: "completed",
        backend: "host",
        providerId: "agent-os-sandbox.host",
        evidence: {
          backend: "host",
          providerId: "agent-os-sandbox.host",
          cwd: workspaceRoot,
          networkPolicy: "none",
          process: {
            pid: 4321,
            signal: null,
            ownedProcess: true,
            terminationReason: "completed",
          },
          planHash: expect.any(String),
          commandHash: expect.any(String),
          backendConfig: expect.objectContaining({
            commandPattern: {
              executable: "node",
              argv: ["director", "status"],
              operationId: "director status",
            },
          }),
        },
      },
    });
  });
});
