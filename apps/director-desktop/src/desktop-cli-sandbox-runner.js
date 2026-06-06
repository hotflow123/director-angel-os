import {
  admitAgentOsSandboxExecution,
  createAgentOsHostSandboxBackendAdapter,
  createAgentOsSandboxBackendRegistry,
  executeAgentOsSandboxCommand,
  planAgentOsSandboxExecution,
} from "@hotflow/agent-os-sandbox";

export function createDirectorDesktopCliSandboxRunner({
  workspaceRoot,
  dataDir,
  cliMainPath,
  resolveCliRuntime,
  runProcessCommand,
  now,
}) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim().length === 0) {
    throw new Error("Director desktop CLI sandbox runner requires workspaceRoot.");
  }
  if (typeof dataDir !== "string" || dataDir.trim().length === 0) {
    throw new Error("Director desktop CLI sandbox runner requires dataDir.");
  }
  if (typeof cliMainPath !== "string" || cliMainPath.trim().length === 0) {
    throw new Error("Director desktop CLI sandbox runner requires cliMainPath.");
  }
  if (typeof resolveCliRuntime !== "function") {
    throw new Error("Director desktop CLI sandbox runner requires resolveCliRuntime.");
  }
  if (typeof runProcessCommand !== "function") {
    throw new Error("Director desktop CLI sandbox runner requires runProcessCommand.");
  }

  return async function runDirectorDesktopCliCommand(argv) {
    assertDirectorDesktopCliArgv(argv);
    const startedAt = new Date();
    const cliRuntime = resolveCliRuntime();
    const env = createDirectorDesktopCliEnv({ workspaceRoot, dataDir, cliRuntime });
    const command = formatDirectorDesktopCliSandboxCommand(argv);
    const operationId = argv.join(" ");
    const registry = createAgentOsSandboxBackendRegistry({
      enabledBackends: ["host"],
      adapters: [
        createAgentOsHostSandboxBackendAdapter({
          allowHostExecution: true,
          allowedCommandPatterns: [
            {
              executable: "node",
              argv,
              operationId,
            },
          ],
          networkPolicy: "none",
          commandRunner: (request) =>
            runProcessCommand({
              ...request,
              executable: cliRuntime.executable,
              argv: [cliMainPath, ...argv],
              cwd: workspaceRoot,
              env,
            }),
        }),
      ],
    });
    const plan = planAgentOsSandboxExecution({
      toolName: "desktop-cli",
      operationId,
      providerId: "director-desktop-cli",
      cwd: workspaceRoot,
      command,
      argv,
      env,
      requestedNetworkPolicy: "none",
      preflight: {
        verdict: "allow",
        sandboxMode: "host",
        checkedAt: getNow(now),
        providerId: "director-desktop-cli",
        reason: "Desktop CLI command execution is routed through Agent OS host sandbox backend.",
      },
      policy: {
        enabledBackends: ["host"],
        readableRoots: [workspaceRoot],
        writableRoots: [workspaceRoot],
        networkPolicy: "none",
      },
    });
    const admission = await admitAgentOsSandboxExecution(plan, { registry, now: nowOrDefault(now) });
    const execution = await executeAgentOsSandboxCommand(plan, admission, {
      registry,
      now: nowOrDefault(now),
    });
    return createDirectorDesktopCliSandboxResult({
      argv,
      startedAt,
      endedAt: new Date(),
      execution,
    });
  };
}

function createDirectorDesktopCliEnv({ workspaceRoot, dataDir, cliRuntime }) {
  return {
    ...(cliRuntime.env ?? {}),
    HOTFLOW_WORKSPACE_ROOT: workspaceRoot,
    DIRECTOR_ANGEL_WORKSPACE_ROOT: workspaceRoot,
    HOTFLOW_DATA_DIR: dataDir,
  };
}

function createDirectorDesktopCliSandboxResult({ argv, startedAt, endedAt, execution }) {
  const metadata = isPlainObject(execution.metadata) ? execution.metadata : {};
  const signal = metadata.signal ?? null;
  return {
    argv,
    exitCode: execution.exitCode ?? (execution.ok ? 0 : 1),
    signal,
    stdout: execution.stdout ?? "",
    stderr: execution.stderr ?? execution.reason ?? execution.error ?? "",
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    sandbox: {
      ok: execution.ok,
      status: execution.status,
      ...(execution.backend === undefined ? {} : { backend: execution.backend }),
      ...(execution.providerId === undefined ? {} : { providerId: execution.providerId }),
      ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
      ...(execution.error === undefined ? {} : { error: execution.error }),
      ...(execution.reason === undefined ? {} : { reason: execution.reason }),
      ...(execution.evidence === undefined ? {} : { evidence: execution.evidence }),
    },
  };
}

function assertDirectorDesktopCliArgv(argv) {
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== "string")) {
    throw new Error("Director desktop CLI runner requires argv as string[].");
  }
  if (!["director", "task", "control"].includes(argv[0])) {
    throw new Error("Director desktop CLI runner only allows Director command catalog argv.");
  }
}

function formatDirectorDesktopCliSandboxCommand(argv) {
  return ["node", ...argv]
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(" ");
}

function nowOrDefault(now) {
  return typeof now === "function" ? now : () => new Date().toISOString();
}

function getNow(now) {
  return nowOrDefault(now)();
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
